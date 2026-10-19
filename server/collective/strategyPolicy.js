import { Interface } from 'ethers';
import { VAULT_ABI } from './abi.js';
import { COLLECTIVE_CHAINS } from './config.js';

const DEFAULT_COLLECTIVE_CHAIN_ID = 4663;

const vaultInterface = new Interface(VAULT_ABI);
const BPS = 10_000n;
const text = (value) => String(value ?? '0');
const bigint = (value) => {
  try { return BigInt(value ?? 0); } catch { return 0n; }
};
const min = (...values) => values.reduce((a, b) => a < b ? a : b);

function makeProposal(snapshot, action, args, reason, constraints) {
  const encoded = vaultInterface.encodeFunctionData(action, args);
  const epoch = Number(snapshot.epoch?.number || 0);
  const amount = args.length ? args[0] : '';
  return {
    id: `${snapshot.address.toLowerCase()}:${epoch}:${action}:${amount}`,
    vault: snapshot.address,
    chainId: snapshot.chainId ?? null,
    epoch,
    action,
    args: args.map((value) => typeof value === 'bigint' ? value.toString() : String(value)),
    reason,
    constraints,
    transaction: { to: snapshot.address, data: encoded, value: '0x0' },
    requiresUserOrKeeperSignature: true,
    aiCanSign: false,
    onChainRiskChecksRemainAuthoritative: true
  };
}

function empty(snapshot, status, reason) {
  return {
    schema: 'fbt.collective.proposals.v1',
    agent: { id: 'collective-policy-engine', mode: 'deterministic-read-only' },
    vault: snapshot.address,
    chainId: snapshot.chainId ?? null,
    generatedAt: new Date().toISOString(),
    status,
    reason,
    proposals: [],
    noForecastOrReturnPromise: true
  };
}

/**
 * A deterministic, read-only action planner. It can suggest only the fixed
 * vault methods below; it has no signing capability and never creates swap
 * calldata, changes risk limits, selects an arbitrary target, or promises a
 * yield. The on-chain roles, oracle checks, timelocked policy, and pause remain
 * the actual execution boundary.
 */
export function buildCollectiveProposals(snapshot, {
  nowSeconds = Math.floor(Date.now() / 1000),
  chainId: requestedChainId = undefined
} = {}) {
  const candidateChainId = Number(requestedChainId ?? snapshot?.chainId ?? DEFAULT_COLLECTIVE_CHAIN_ID);
  const chainId = Number.isSafeInteger(candidateChainId) && candidateChainId > 0 ? candidateChainId : null;
  const networkSnapshot = snapshot && typeof snapshot === 'object'
    ? { ...snapshot, chainId }
    : { address: null, chainId };
  if (!chainId || !COLLECTIVE_CHAINS[chainId]) {
    return empty(networkSnapshot, 'unavailable', 'UNSUPPORTED_CHAIN');
  }
  if (!snapshot?.address || !snapshot?.epoch || !snapshot?.accounting || !snapshot?.strategy) {
    return empty(networkSnapshot, 'unavailable', 'VAULT_STATE_INCOMPLETE');
  }
  if (snapshot.emergency?.paused) return empty(networkSnapshot, 'paused', 'EMERGENCY_PAUSE_ACTIVE');

  const plannerSnapshot = networkSnapshot;
  const epoch = snapshot.epoch;
  const accounting = snapshot.accounting;
  const strategy = snapshot.strategy;
  const withdrawalLiability = bigint(accounting.withdrawalLiabilityRaw);
  const strategyAssets = bigint(strategy.totalAssetsRaw);
  const strategyShares = bigint(strategy.positionSharesRaw);
  const hasStrategyPosition = strategyShares > 0n || strategyAssets > 0n;
  const strategyWithdrawable = bigint(strategy.maxWithdrawRaw);
  const strategyExitAmount = min(strategyAssets, strategyWithdrawable);
  const availableIdle = bigint(accounting.availablePrincipalIdleRaw);
  const queueAvailable = bigint(accounting.queuedPayoutAvailableRaw);
  const totalSupply = bigint(accounting.totalSupplyRaw);
  const proposals = [];
  let status = 'no-action';
  let reason = 'NO_SAFE_ACTION_AVAILABLE';

  if (epoch.started && Number(epoch.end) > 0 && nowSeconds >= Number(epoch.end)) {
    if (withdrawalLiability > 0n && queueAvailable > 0n) {
      proposals.push(makeProposal(
        plannerSnapshot,
        'processWithdrawals',
        [20],
        'PAY_FUNDED_FIFO_PRINCIPAL_WITHDRAWALS',
        ['FIFO order is enforced by WithdrawalQueue', 'payout is capped by idle principal after income/reserve/expense obligations']
      ));
      status = 'action-ready';
      reason = 'FUNDED_WITHDRAWAL_QUEUE';
    } else if (hasStrategyPosition && strategyExitAmount > 0n) {
      proposals.push(makeProposal(
        plannerSnapshot,
        'withdrawFromStrategy',
        [strategyExitAmount],
        'REALIZE_STRATEGY_POSITION_BEFORE_INCOME_SNAPSHOT',
        ['fixed ERC-4626 target only', 'each bounded exit is rechecked against target liquidity and slippage', 'settlement waits until all strategy shares are exited']
      ));
      status = 'action-ready';
      reason = 'STRATEGY_EXIT_PRECEDES_SETTLEMENT';
    } else if (hasStrategyPosition) {
      status = 'liquidity-blocked';
      reason = 'TARGET_REPORTS_NO_WITHDRAWABLE_LIQUIDITY';
    } else {
      proposals.push(makeProposal(
        plannerSnapshot,
        'settleEpoch',
        [],
        'EPOCH_ENDED_FINALIZE_REALIZED_INCOME_SNAPSHOT',
        ['income is allocated only from realized net income', 'all strategy shares must be exited before settlement', 'epoch snapshot and settlement period are checked on-chain']
      ));
      status = 'action-ready';
      reason = 'EPOCH_SETTLEMENT_DUE';
    }
  } else if (withdrawalLiability > 0n) {
    if (queueAvailable > 0n) {
      proposals.push(makeProposal(
        plannerSnapshot,
        'processWithdrawals',
        [20],
        'PAY_FUNDED_FIFO_PRINCIPAL_WITHDRAWALS',
        ['FIFO order is enforced by WithdrawalQueue', 'payout is capped by idle principal after income/reserve/expense obligations']
      ));
      status = 'action-ready';
      reason = 'FUNDED_WITHDRAWAL_QUEUE';
    } else if (hasStrategyPosition && strategyExitAmount > 0n) {
      proposals.push(makeProposal(
        plannerSnapshot,
        'withdrawFromStrategy',
        [strategyExitAmount],
        'RAISE_LIQUIDITY_FOR_QUEUED_PRINCIPAL',
        ['fixed ERC-4626 target only', 'does not promise immediate or full payment', 'queue remains FIFO']
      ));
      status = 'action-ready';
      reason = 'QUEUED_WITHDRAWALS_NEED_LIQUIDITY';
    } else {
      status = 'liquidity-blocked';
      reason = hasStrategyPosition ? 'TARGET_REPORTS_NO_WITHDRAWABLE_LIQUIDITY' : 'NO_IDLE_OR_STRATEGY_LIQUIDITY';
    }
  } else if (!epoch.started) {
    const deadline = Number(epoch.subscriptionDeadline || 0);
    if (nowSeconds < deadline) {
      status = 'subscription-window';
      reason = 'WAIT_FOR_SUBSCRIPTION_AND_WITHDRAWAL_WINDOW_TO_CLOSE';
    } else if (totalSupply === 0n) {
      status = 'empty-vault';
      reason = 'NO_SHARES_TO_START_AN_EPOCH';
    } else {
      proposals.push(makeProposal(
        plannerSnapshot,
        'startFirstEpoch',
        [],
        'START_NEXT_EPOCH_AFTER_SUBSCRIPTION_WINDOW',
        ['a previous-block share snapshot is required', 'deposits close while active; principal requests reopen at period end']
      ));
      status = 'action-ready';
      reason = 'EPOCH_START_DUE';
    }
  } else if (availableIdle > 0n) {
    const limits = snapshot.risk?.limits || {};
    const price = bigint(snapshot.risk?.assetPriceUsdE8);
    const decimals = Number(snapshot.asset?.decimals);
    const policyReady = Boolean(
      limits.enabled && snapshot.risk?.kindEnabled && snapshot.risk?.assetAllowed &&
      snapshot.risk?.protocolAllowed && snapshot.risk?.assetOracleFresh &&
      snapshot.risk?.nativeOracleFresh && price > 0n && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18
    );
    if (!policyReady) {
      status = 'risk-blocked';
      reason = 'RISK_POLICY_OR_ORACLE_NOT_READY';
    } else {
      const maxTrade = bigint(limits.maxTradeUsdE8) * (10n ** BigInt(decimals)) / price;
      const targetAssets = bigint(strategy.totalAssetsRaw);
      const allocationLimit = bigint(accounting.totalAssetsRaw) * BigInt(limits.maxAllocationBps || 0) / BPS;
      const concentrationLimit = bigint(accounting.totalAssetsRaw) * BigInt(limits.maxConcentrationBps || 0) / BPS;
      const remainingAllocation = allocationLimit > targetAssets ? allocationLimit - targetAssets : 0n;
      const remainingConcentration = concentrationLimit > targetAssets ? concentrationLimit - targetAssets : 0n;
      const amount = min(availableIdle, maxTrade, remainingAllocation, remainingConcentration);
      const targetWithdrawable = bigint(strategy.maxWithdrawRaw);
      const prospectiveLiquidityUsdE8 = (targetWithdrawable + amount) * price / (10n ** BigInt(decimals));
      if (amount === 0n) {
        status = 'risk-blocked';
        reason = 'RISK_LIMITS_ALLOW_NO_INVESTMENT';
      } else if (prospectiveLiquidityUsdE8 < bigint(limits.minLiquidityUsdE8)) {
        status = 'risk-blocked';
        reason = 'TARGET_LIQUIDITY_BELOW_POLICY_MINIMUM';
      } else {
        proposals.push(makeProposal(
          plannerSnapshot,
          'invest',
          [amount],
          'INVEST_IDLE_PRINCIPAL_WITHIN_CURRENT_ONCHAIN_LIMITS',
          [
            `maximum raw investment ${amount.toString()}`,
            'exact allowlisted ERC-4626 target only',
            `target-reported redeemable liquidity after investment must exceed ${text(limits.minLiquidityUsdE8)} USD E8`,
            'price freshness, slippage, max trade, allocation, gas cost, keeper role, and pause are rechecked on-chain'
          ]
        ));
        status = 'action-ready';
        reason = 'POLICY_BOUNDED_IDLE_INVESTMENT';
      }
    }
  } else {
    status = 'active';
    reason = 'ACTIVE_EPOCH_HAS_NO_UNENCUMBERED_IDLE_PRINCIPAL';
  }

  return {
    schema: 'fbt.collective.proposals.v1',
    agent: { id: 'collective-policy-engine', mode: 'deterministic-read-only' },
    vault: snapshot.address,
    chainId,
    generatedAt: new Date().toISOString(),
    observedBlock: snapshot.latestBlock,
    status,
    reason,
    proposals,
    noForecastOrReturnPromise: true
  };
}

export function isAllowedKeeperAction(action) {
  return new Set(['startFirstEpoch', 'invest', 'withdrawFromStrategy', 'liquidateStrategy', 'settleEpoch', 'processWithdrawals']).has(action);
}
