/**
 * MORPHO BLUE · BASE (8453) · ONE MARKET · USDC LOAN / cbBTC COLLATERAL
 * ---------------------------------------------------------------------------
 * This is a deliberately narrow, non-custodial adapter. It does NOT discover
 * pools, follow a DefiLlama symbol, or treat a Morpho vault/ERC-4626 as a
 * Morpho Blue market. The immutable market parameters and marketId are pinned
 * here and verified again on-chain before every plan.
 *
 * Scope: supply and withdraw the market's LOAN token (native Base USDC). The
 * cbBTC leg is identified and verified as the market collateral; this adapter
 * never supplies, borrows, or transfers collateral and never creates debt.
 */

import { ERC20_ABI, EVM_CHAINS, getToken } from '../chains';
import { NATIVE_GAS_FLOOR } from '../swap';
import { decodeRevertReason } from '../preSignSimulation';
import {
  assertProviderChain, assertSuccessfulReceipt, parseReceiptLogs, ExecutionGuardError, sameAddress
} from './executionGuards';
import { verifyRoutedDeposit } from './splitRouter.js';
const loadEthers = () => import('ethers');
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const isAddr = (value) => typeof value === 'string' && ADDRESS.test(value);
const ZERO = '0x0000000000000000000000000000000000000000';
const MAX_UINT256 = (1n << 256n) - 1n;
const ASSET_ROUNDING_TOLERANCE_WEI = 1n;

const usdc = getToken(8453, 'USDC');
const cbBtc = getToken(8453, 'cbBTC');
if (!usdc || !cbBtc || !isAddr(usdc.address) || !isAddr(cbBtc.address)) {
  throw new Error('MORPHO_BASE_MARKET_ASSETS_UNAVAILABLE');
}

export const MORPHO_BLUE_BASE = Object.freeze({
  chainId: 8453,
  morpho: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  marketId: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
  loanToken: usdc.address,
  loanSymbol: usdc.symbol,
  loanDecimals: usdc.decimals,
  collateralToken: cbBtc.address,
  collateralSymbol: cbBtc.symbol,
  collateralDecimals: cbBtc.decimals,
  oracle: '0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9',
  irm: '0x46415998764C29aB2a25CbeA6254146D50D22687',
  lltv: 860000000000000000n,
  /** Off-chain data identifier only; never a transaction target. */
  defiLlamaPoolId: '7d33d57d-36dc-414b-9538-22a223250468',
  explorer: EVM_CHAINS[8453].explorer
});

const MARKET_PARAMS_ABI = 'tuple(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv)';
const MARKET_PARAMS_FLAT = 'address loanToken, address collateralToken, address oracle, address irm, uint256 lltv';

/**
 * Morpho Blue's deployed ABI, exactly as verified at
 * 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb on Base.
 *
 * `MarketParams` is a static tuple, so it is encoded inline as five words and
 * `idToMarketParams` returns those same five words flat. The two money actions
 * are NOT symmetric — the orders below are what the deployment answers with:
 *
 *   supply((address,address,address,address,uint256),uint256,uint256,address,bytes)
 *     -> 0xa99aad89  (amounts FIRST, then onBehalf, then the callback data)
 *   withdraw((address,address,address,address,uint256),uint256,uint256,address,address)
 *     -> 0x5c2bea49  (assets, shares, onBehalf, receiver; no callback)
 *
 * A 4-byte selector that the contract does not implement reverts with NO
 * return data, which ethers reports as `execution reverted (no data present;
 * likely require(false) occurred)` — indistinguishable, in the UI, from a real
 * protocol refusal. So the pinned selectors below are re-checked against this
 * ABI on every encode (see `morphoActionsInterface`) and re-derived from the
 * canonical signatures in the unit suite: an ABI edit that drifts away from the
 * deployment fails closed with a code, before anything is signed.
 */
const MORPHO_ABI = [
  `function idToMarketParams(bytes32 id) view returns (${MARKET_PARAMS_FLAT})`,
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  `function supply(${MARKET_PARAMS_ABI} marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)`,
  `function withdraw(${MARKET_PARAMS_ABI} marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)`
];
/** Selectors derived from the deployed signatures; the encode path refuses to run without them. */
export const MORPHO_ACTION_SELECTORS = Object.freeze({
  supply: '0xa99aad89',
  withdraw: '0x5c2bea49'
});
const MORPHO_EVENT_ABI = [
  'event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)',
  'event Withdraw(bytes32 indexed id, address indexed caller, address indexed onBehalf, address receiver, uint256 assets, uint256 shares)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

export class MorphoAdapterError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.name = 'MorphoAdapterError';
    this.code = code;
    this.detail = detail;
  }
}

async function contracts(provider) {
  const { Contract } = await loadEthers();
  return {
    provider,
    morpho: new Contract(MORPHO_BLUE_BASE.morpho, MORPHO_ABI, provider),
    usdc: new Contract(MORPHO_BLUE_BASE.loanToken, ERC20_ABI, provider)
  };
}

function normalizeParams(row) {
  return {
    loanToken: String(row?.loanToken ?? row?.[0] ?? ''),
    collateralToken: String(row?.collateralToken ?? row?.[1] ?? ''),
    oracle: String(row?.oracle ?? row?.[2] ?? ''),
    irm: String(row?.irm ?? row?.[3] ?? ''),
    lltv: BigInt(String(row?.lltv ?? row?.[4] ?? 0))
  };
}

function paramsArray() {
  return [
    MORPHO_BLUE_BASE.loanToken,
    MORPHO_BLUE_BASE.collateralToken,
    MORPHO_BLUE_BASE.oracle,
    MORPHO_BLUE_BASE.irm,
    MORPHO_BLUE_BASE.lltv
  ];
}

function asBigInt(value) {
  return typeof value === 'bigint' ? value : BigInt(String(value ?? 0));
}

/**
 * The write-side interface. It refuses to be used as soon as this file's ABI
 * stops hashing to the selectors Morpho Blue answers with on Base, so a drifted
 * signature is an adapter error instead of an unexplained on-chain revert.
 */
async function morphoActionsInterface() {
  const { Interface } = await loadEthers();
  const iface = new Interface(MORPHO_ABI);
  for (const [action, expected] of Object.entries(MORPHO_ACTION_SELECTORS)) {
    const found = iface.getFunction(action).selector.toLowerCase();
    if (found !== expected.toLowerCase()) {
      throw new MorphoAdapterError('MORPHO_ABI_SELECTOR_MISMATCH', { action, expected, found });
    }
  }
  return iface;
}

/**
 * Pure `supply` calldata for the pinned market: `supply(marketParams, assets,
 * 0, onBehalf, 0x)`. Only one of `assets`/`shares` may be non-zero — Morpho
 * Blue reverts otherwise — and the callback `data` stays empty because FBT
 * signs from an EOA and has no `onMorphoSupply` to be called back.
 */
export async function encodeSupplyCalldata({ owner, amountWei = 0n, sharesWei = 0n, callbackData = '0x' } = {}) {
  if (!isAddr(owner)) throw new MorphoAdapterError('MORPHO_BAD_OWNER', { owner });
  const assets = asBigInt(amountWei);
  const shares = asBigInt(sharesWei);
  if (assets <= 0n && shares <= 0n) throw new MorphoAdapterError('MORPHO_INVALID_AMOUNT', { assets, shares });
  if (assets > 0n && shares > 0n) throw new MorphoAdapterError('MORPHO_INPUT_ASSETS_OR_SHARES', { assets, shares });
  const iface = await morphoActionsInterface();
  return iface.encodeFunctionData('supply', [paramsArray(), assets, shares, owner, callbackData]);
}

/**
 * Pure `withdraw` calldata for the pinned market:
 * `withdraw(marketParams, assets, 0, onBehalf, receiver)` for an amount, or
 * `withdraw(marketParams, 0, shares, onBehalf, receiver)` for a max exit.
 */
export async function encodeWithdrawCalldata({
  owner, receiver = owner, amountWei = 0n, sharesWei = 0n
} = {}) {
  if (!isAddr(owner)) throw new MorphoAdapterError('MORPHO_BAD_OWNER', { owner });
  if (!isAddr(receiver)) throw new MorphoAdapterError('MORPHO_BAD_RECEIVER', { receiver });
  const assets = asBigInt(amountWei);
  const shares = asBigInt(sharesWei);
  if (assets <= 0n && shares <= 0n) throw new MorphoAdapterError('MORPHO_INVALID_AMOUNT', { assets, shares });
  if (assets > 0n && shares > 0n) throw new MorphoAdapterError('MORPHO_INPUT_ASSETS_OR_SHARES', { assets, shares });
  const iface = await morphoActionsInterface();
  return iface.encodeFunctionData('withdraw', [paramsArray(), assets, shares, owner, receiver]);
}

const verifiedByProvider = new WeakMap();

/** Verify chain, marketId and every immutable MarketParams field on-chain. */
export async function verifyDeployment(provider, { force = false } = {}) {
  if (!provider) throw new MorphoAdapterError('MORPHO_NO_PROVIDER');
  try {
    await assertProviderChain(provider, MORPHO_BLUE_BASE.chainId);
  } catch (err) {
    if (err?.code === 'EXECUTION_WRONG_CHAIN') throw new MorphoAdapterError('MORPHO_WRONG_CHAIN', err.detail);
    if (err instanceof ExecutionGuardError) throw new MorphoAdapterError('MORPHO_NETWORK_UNREADABLE', err.detail);
    throw err;
  }
  if (!force && verifiedByProvider.has(provider)) return verifiedByProvider.get(provider);

  const c = await contracts(provider);
  let live;
  let state;
  try {
    [live, state] = await Promise.all([
      c.morpho.idToMarketParams(MORPHO_BLUE_BASE.marketId),
      c.morpho.market(MORPHO_BLUE_BASE.marketId)
    ]);
  } catch (err) {
    throw new MorphoAdapterError('MORPHO_MARKET_UNREADABLE', { reason: decodeRevertReason(err) });
  }
  const params = normalizeParams(live);
  const checks = [
    ['loanToken', params.loanToken, MORPHO_BLUE_BASE.loanToken],
    ['collateralToken', params.collateralToken, MORPHO_BLUE_BASE.collateralToken],
    ['oracle', params.oracle, MORPHO_BLUE_BASE.oracle],
    ['irm', params.irm, MORPHO_BLUE_BASE.irm]
  ];
  for (const [field, found, expected] of checks) {
    if (!sameAddress(found, expected)) {
      throw new MorphoAdapterError('MORPHO_MARKET_PARAMS_MISMATCH', { field, expected, found });
    }
  }
  if (params.lltv !== MORPHO_BLUE_BASE.lltv) {
    throw new MorphoAdapterError('MORPHO_MARKET_PARAMS_MISMATCH', {
      field: 'lltv', expected: MORPHO_BLUE_BASE.lltv, found: params.lltv
    });
  }
  const lastUpdate = asBigInt(state?.lastUpdate ?? state?.[4]);
  if (lastUpdate === 0n) throw new MorphoAdapterError('MORPHO_MARKET_NOT_INITIALIZED');

  const evidence = Object.freeze({
    schema: 'fbt.morpho-blue-base-market.verification.v1',
    ok: true,
    chainId: MORPHO_BLUE_BASE.chainId,
    morpho: MORPHO_BLUE_BASE.morpho,
    marketId: MORPHO_BLUE_BASE.marketId,
    loanToken: MORPHO_BLUE_BASE.loanToken,
    collateralToken: MORPHO_BLUE_BASE.collateralToken,
    oracle: MORPHO_BLUE_BASE.oracle,
    irm: MORPHO_BLUE_BASE.irm,
    lltv: MORPHO_BLUE_BASE.lltv,
    lastUpdate,
    verifiedAt: Date.now()
  });
  verifiedByProvider.set(provider, evidence);
  return evidence;
}

function assetsForShares(shares, state) {
  const s = asBigInt(shares);
  const totalShares = asBigInt(state?.totalSupplyShares ?? state?.[1]);
  const totalAssets = asBigInt(state?.totalSupplyAssets ?? state?.[0]);
  if (s === 0n) return 0n;
  if (totalShares === 0n) throw new MorphoAdapterError('MORPHO_SUPPLY_SHARES_UNREADABLE');
  return (s * totalAssets) / totalShares;
}

export async function getMarketState(provider) {
  const deployment = await verifyDeployment(provider);
  const c = await contracts(provider);
  const state = await c.morpho.market(MORPHO_BLUE_BASE.marketId);
  return Object.freeze({
    totalSupplyAssets: asBigInt(state?.totalSupplyAssets ?? state?.[0]),
    totalSupplyShares: asBigInt(state?.totalSupplyShares ?? state?.[1]),
    totalBorrowAssets: asBigInt(state?.totalBorrowAssets ?? state?.[2]),
    totalBorrowShares: asBigInt(state?.totalBorrowShares ?? state?.[3]),
    lastUpdate: asBigInt(state?.lastUpdate ?? state?.[4]),
    fee: asBigInt(state?.fee ?? state?.[5]),
    verifiedVia: deployment.schema,
    readAt: Date.now()
  });
}

export async function getPosition(provider, owner) {
  if (!isAddr(owner)) throw new MorphoAdapterError('MORPHO_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const c = await contracts(provider);
  const [pos, state] = await Promise.all([
    c.morpho.position(MORPHO_BLUE_BASE.marketId, owner),
    c.morpho.market(MORPHO_BLUE_BASE.marketId)
  ]);
  const supplyShares = asBigInt(pos?.supplyShares ?? pos?.[0]);
  const borrowShares = asBigInt(pos?.borrowShares ?? pos?.[1]);
  const collateral = asBigInt(pos?.collateral ?? pos?.[2]);
  return Object.freeze({
    owner,
    marketId: MORPHO_BLUE_BASE.marketId,
    supplyShares,
    suppliedUsdc: assetsForShares(supplyShares, state),
    borrowShares,
    collateralCbBtc: collateral,
    hasBorrow: borrowShares > 0n,
    readAt: Date.now()
  });
}

function parseUsdc(value) {
  const s = String(value ?? '').trim();
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const [whole = '0', fraction = ''] = s.split('.');
  if (fraction.length > MORPHO_BLUE_BASE.loanDecimals) return null;
  return BigInt((whole || '0') + (fraction + '0'.repeat(MORPHO_BLUE_BASE.loanDecimals)).slice(0, MORPHO_BLUE_BASE.loanDecimals));
}

export function fromUsdcWei(value) {
  const amount = asBigInt(value);
  const text = amount.toString().padStart(MORPHO_BLUE_BASE.loanDecimals + 1, '0');
  return `${text.slice(0, -MORPHO_BLUE_BASE.loanDecimals)}.${text.slice(-MORPHO_BLUE_BASE.loanDecimals)}`;
}

export async function buildSupplyPlan({ provider, owner, amountUsdc, nativeBalance = null } = {}) {
  if (!isAddr(owner)) throw new MorphoAdapterError('MORPHO_BAD_OWNER', { owner });
  const deployment = await verifyDeployment(provider);
  const c = await contracts(provider);
  const checks = {
    schema: 'fbt.morpho-blue-base.supply-checks.v1',
    deploymentVerified: Boolean(deployment?.ok),
    amountWei: null,
    amountUsdc: null,
    balanceSufficient: null,
    nativeGasFloorOk: null,
    allowanceWei: null,
    needsApproval: null,
    positionUsdcWei: null,
    blocked: []
  };
  const amount = parseUsdc(amountUsdc);
  if (amount == null || amount <= 0n) checks.blocked.push('MORPHO_INVALID_AMOUNT');
  else {
    checks.amountWei = amount;
    checks.amountUsdc = Number(amount) / 10 ** MORPHO_BLUE_BASE.loanDecimals;
  }
  if (amount == null || amount <= 0n) return { checks, steps: [] };

  const pos = await getPosition(provider, owner);
  checks.positionUsdcWei = pos.suppliedUsdc;

  try {
    const balance = asBigInt(await c.usdc.balanceOf(owner));
    checks.balanceSufficient = balance >= amount;
    if (!checks.balanceSufficient) checks.blocked.push('MORPHO_INSUFFICIENT_BALANCE');
  } catch {
    checks.balanceSufficient = null;
    checks.blocked.push('MORPHO_BALANCE_UNREADABLE');
  }
  const floor = NATIVE_GAS_FLOOR[MORPHO_BLUE_BASE.chainId];
  if (floor == null || nativeBalance == null) {
    checks.nativeGasFloorOk = null;
    checks.blocked.push('MORPHO_NATIVE_BALANCE_UNKNOWN');
  } else {
    const { parseUnits } = await loadEthers();
    checks.nativeGasFloorOk = asBigInt(nativeBalance) >= parseUnits(String(floor), 18);
    if (!checks.nativeGasFloorOk) checks.blocked.push('MORPHO_NATIVE_GAS_FLOOR');
  }
  if (checks.blocked.length) return { checks, steps: [] };

  const allowance = asBigInt(await c.usdc.allowance(owner, MORPHO_BLUE_BASE.morpho));
  checks.allowanceWei = allowance;
  checks.needsApproval = allowance < amount;
  const { Interface } = await loadEthers();
  const erc20 = new Interface(ERC20_ABI);
  const steps = [];
  if (checks.needsApproval) steps.push({
    kind: 'approve', to: MORPHO_BLUE_BASE.loanToken,
    data: erc20.encodeFunctionData('approve', [MORPHO_BLUE_BASE.morpho, amount]), value: 0n,
    description: { key: 'farm.morpho.step.approve', amount: fromUsdcWei(amount) }
  });
  steps.push({
    kind: 'supply', to: MORPHO_BLUE_BASE.morpho,
    data: await encodeSupplyCalldata({ owner, amountWei: amount }), value: 0n,
    description: { key: 'farm.morpho.step.supply', amount: fromUsdcWei(amount) }
  });
  return { checks, steps };
}

export async function buildWithdrawPlan({ provider, owner, amountUsdc } = {}) {
  if (!isAddr(owner)) throw new MorphoAdapterError('MORPHO_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const position = await getPosition(provider, owner);
  const checks = {
    schema: 'fbt.morpho-blue-base.withdraw-checks.v1', deploymentVerified: true,
    isMax: String(amountUsdc).toLowerCase() === 'max', amountWei: null,
    positionUsdcWei: position.suppliedUsdc, withinPosition: null,
    blocked: []
  };
  let assets = 0n;
  let shares = 0n;
  if (checks.isMax) {
    shares = position.supplyShares;
    checks.withinPosition = true;
    if (shares === 0n) checks.blocked.push('MORPHO_NOTHING_TO_WITHDRAW');
  } else {
    assets = parseUsdc(amountUsdc);
    if (assets == null || assets <= 0n) checks.blocked.push('MORPHO_INVALID_AMOUNT');
    else {
      checks.amountWei = assets;
      checks.withinPosition = assets <= position.suppliedUsdc;
      if (!checks.withinPosition) checks.blocked.push('MORPHO_WITHDRAW_EXCEEDS_POSITION');
    }
  }
  if (checks.blocked.length) return { checks, steps: [] };
  const step = {
    kind: 'withdraw', to: MORPHO_BLUE_BASE.morpho,
    data: await encodeWithdrawCalldata({ owner, receiver: owner, amountWei: assets, sharesWei: shares }), value: 0n,
    description: { key: checks.isMax ? 'farm.morpho.step.withdrawMax' : 'farm.morpho.step.withdraw', amount: checks.isMax ? null : fromUsdcWei(assets) }
  };
  return { checks, steps: [step] };
}

export async function buildRevokePlan({ provider, owner, spender = null } = {}) {
  if (!isAddr(owner)) throw new MorphoAdapterError('MORPHO_BAD_OWNER', { owner });
  await verifyDeployment(provider);
  const { Interface } = await loadEthers();
  const erc20 = new Interface(ERC20_ABI);
  return { checks: { schema: 'fbt.morpho-blue-base.revoke-checks.v1', blocked: [] }, steps: [{
    kind: 'revoke', to: MORPHO_BLUE_BASE.loanToken,
    data: erc20.encodeFunctionData('approve', [spender ?? MORPHO_BLUE_BASE.morpho, 0n]), value: 0n,
    description: { key: 'farm.morpho.step.revoke' }
  }] };
}

export async function verifyMorphoReceipt({
  provider, receipt, owner, action, amountWei, beforePositionWei = null, beforeSupplyShares = null,
  splitRouter = null, expectedSpender = null
} = {}) {
  assertSuccessfulReceipt(receipt);
  if (!isAddr(owner)) throw new MorphoAdapterError('MORPHO_BAD_OWNER');
  const { Interface } = await loadEthers();
  const iface = new Interface(MORPHO_EVENT_ABI);
  const amount = amountWei == null ? null : asBigInt(amountWei);
  const events = action === 'approve' || action === 'revoke'
    ? parseReceiptLogs(receipt, iface, MORPHO_BLUE_BASE.loanToken, 'Approval')
    : parseReceiptLogs(receipt, iface, MORPHO_BLUE_BASE.morpho, action === 'supply' ? 'Supply' : 'Withdraw');
  if (!events.length) throw new MorphoAdapterError('MORPHO_EXPECTED_EVENT_MISSING', { action });
  const args = events[0].parsed.args;
  if (action === 'approve' || action === 'revoke') {
    if (!sameAddress(String(args.owner), owner)
      || !sameAddress(
        String(args.spender),
        expectedSpender ?? (splitRouter ? splitRouter.address : MORPHO_BLUE_BASE.morpho)
      )) {
      throw new MorphoAdapterError('MORPHO_APPROVAL_EVENT_MISMATCH');
    }
    const value = asBigInt(args.value);
    if (action === 'revoke' && value !== 0n) throw new MorphoAdapterError('MORPHO_REVOKE_AMOUNT_MISMATCH');
    if (action === 'approve' && amount != null && value !== amount) throw new MorphoAdapterError('MORPHO_APPROVAL_AMOUNT_MISMATCH');
    return Object.freeze({ ok: true, action, event: 'Approval' });
  }
  if (splitRouter && action === 'supply') {
    /*
     * Routed through the split router. Two proofs:
     *   · the router's Routed event pins the split — user, Morpho, the
     *     pinned loan token, gross, quoted fee, net;
     *   · Morpho's own Supply event must credit the OWNER (onBehalf) in the
     *     ONE pinned market with the NET amount. The router is only the
     *     caller; the shares are the owner's.
     */
    const { routed } = await verifyRoutedDeposit({
      receipt,
      routerAddress: splitRouter.address,
      owner,
      target: MORPHO_BLUE_BASE.morpho,
      asset: MORPHO_BLUE_BASE.loanToken,
      amountIn: amount,
      feeTaken: splitRouter.feeAmount,
      netAmount: splitRouter.netAmount
    });
    const supplies = parseReceiptLogs(receipt, iface, MORPHO_BLUE_BASE.morpho, 'Supply');
    const credited = supplies.find(({ parsed }) =>
      String(parsed.args.id).toLowerCase() === MORPHO_BLUE_BASE.marketId.toLowerCase()
      && sameAddress(String(parsed.args.onBehalf ?? parsed.args.onBehalfOf), owner)
      && asBigInt(parsed.args.assets) === routed.netAmount);
    if (!credited) {
      throw new MorphoAdapterError('MORPHO_PROTOCOL_EVENT_MISMATCH', {
        action, eventAmount: routed.netAmount, expected: routed.netAmount,
        reason: 'ROUTED_SUPPLY_NOT_CREDITED_TO_OWNER'
      });
    }
    const eventShares = asBigInt(credited.parsed.args.shares);
    const after = await getPosition(provider, owner);
    let sharesDelta = null;
    if (beforeSupplyShares != null) {
      const beforeShares = asBigInt(beforeSupplyShares);
      sharesDelta = after.supplyShares - beforeShares;
      if (sharesDelta !== eventShares) {
        throw new MorphoAdapterError('MORPHO_POSITION_UNCHANGED', {
          action,
          expectedShares: eventShares,
          sharesDelta,
          beforeSupplyShares: beforeShares,
          afterSupplyShares: after.supplyShares
        });
      }
    }
    if (beforePositionWei != null) {
      const before = asBigInt(beforePositionWei);
      if (!(after.suppliedUsdc + ASSET_ROUNDING_TOLERANCE_WEI >= before + routed.netAmount)) {
        throw new MorphoAdapterError('MORPHO_POSITION_UNCHANGED', {
          action,
          before,
          after: after.suppliedUsdc,
          eventAmount: routed.netAmount,
          eventShares,
          assetRoundingToleranceWei: ASSET_ROUNDING_TOLERANCE_WEI
        });
      }
    }
    return Object.freeze({
      ok: true,
      action,
      event: 'Supply',
      position: after,
      eventAmount: routed.netAmount,
      eventShares,
      sharesDelta,
      proof: Object.freeze({ eventAmount: routed.netAmount, eventShares, sharesDelta }),
      routed
    });
  }

  const eventAmount = asBigInt(args.assets);
  const eventShares = asBigInt(args.shares);
  const eventId = String(args.id).toLowerCase();
  if (eventId !== MORPHO_BLUE_BASE.marketId.toLowerCase()) throw new MorphoAdapterError('MORPHO_MARKET_EVENT_MISMATCH');
  const onBehalf = args.onBehalf ?? args.onBehalfOf;
  const beneficiary = action === 'supply' ? onBehalf : args.receiver;
  if (!sameAddress(String(beneficiary), owner) || !sameAddress(String(onBehalf), owner) || (amount != null && amount !== MAX_UINT256 && eventAmount !== amount)) {
    throw new MorphoAdapterError('MORPHO_PROTOCOL_EVENT_MISMATCH', { action, eventAmount, eventShares, expected: amount });
  }
  const after = await getPosition(provider, owner);
  let sharesDelta = null;
  if (beforeSupplyShares != null) {
    const beforeShares = asBigInt(beforeSupplyShares);
    sharesDelta = action === 'supply' ? after.supplyShares - beforeShares : beforeShares - after.supplyShares;
    if (sharesDelta !== eventShares) {
      throw new MorphoAdapterError('MORPHO_POSITION_UNCHANGED', {
        action,
        expectedShares: eventShares,
        sharesDelta,
        beforeSupplyShares: beforeShares,
        afterSupplyShares: after.supplyShares,
        beforePositionWei: beforePositionWei == null ? null : asBigInt(beforePositionWei),
        afterPositionWei: after.suppliedUsdc,
        eventAmount
      });
    }
  }
  if (beforePositionWei != null) {
    const before = asBigInt(beforePositionWei);
    const changed = action === 'supply'
      ? after.suppliedUsdc + ASSET_ROUNDING_TOLERANCE_WEI >= before + eventAmount
      : after.suppliedUsdc < before + ASSET_ROUNDING_TOLERANCE_WEI;
    if (!changed) {
      throw new MorphoAdapterError('MORPHO_POSITION_UNCHANGED', {
        action,
        before,
        after: after.suppliedUsdc,
        eventAmount,
        eventShares,
        sharesDelta,
        assetRoundingToleranceWei: ASSET_ROUNDING_TOLERANCE_WEI
      });
    }
  }
  return Object.freeze({
    ok: true,
    action,
    event: action === 'supply' ? 'Supply' : 'Withdraw',
    position: after,
    eventAmount,
    eventShares,
    sharesDelta,
    proof: Object.freeze({ eventAmount, eventShares, sharesDelta })
  });
}

export function isMorphoBlueBaseMarket(pool) {
  if (!pool) return false;
  return String(pool.project ?? '').toLowerCase() === 'morpho-blue'
    && String(pool.chain ?? '').toLowerCase() === 'base'
    && String(pool.pool ?? pool.id ?? '') === MORPHO_BLUE_BASE.defiLlamaPoolId;
}
