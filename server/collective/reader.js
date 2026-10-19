import {
  Contract,
  JsonRpcProvider,
  formatUnits,
  getAddress,
  isAddress
} from 'ethers';
import {
  ACCESS_ABI,
  ADAPTER_ABI,
  EMERGENCY_ABI,
  EPOCH_ABI,
  ERC20_ABI,
  FACTORY_ABI,
  ORACLE_ABI,
  QUEUE_ABI,
  RISK_ABI,
  STRATEGY_TARGET_ABI,
  VAULT_ABI
} from './abi.js';
import { readCollectiveConfig, publicCollectiveConfig, COLLECTIVE_MAX_VAULTS } from './config.js';
import { scanVaultEvents } from './indexer.js';

const PRECISION = 10n ** 27n;
const s = (value) => String(value ?? 0n);
const lower = (value) => String(value ?? '').toLowerCase();
const codeExists = (code) => typeof code === 'string' && code !== '0x' && code !== '0x0';
const error = (code, status = 503) => Object.assign(new Error(code), { code, status });
const eventTimestamp = (value) => Number(value || 0);

function publicErrorCode(cause) {
  const known = new Set([
    'COLLECTIVE_NOT_CONFIGURED', 'CHAIN_ID_MISMATCH', 'FACTORY_HAS_NO_CODE',
    'ASSET_HAS_NO_CODE', 'FACTORY_ASSET_MISMATCH', 'VAULT_NOT_REGISTERED',
    'BAD_VAULT_ADDRESS', 'BAD_WALLET_ADDRESS', 'BAD_BLOCK_RANGE',
    'BLOCK_RANGE_TOO_LARGE', 'BLOCK_RANGE_BEFORE_DEPLOYMENT', 'BLOCK_RANGE_AFTER_HEAD',
    'EVENT_INDEX_NOT_CONFIGURED', 'PROVIDER_UNAVAILABLE'
  ]);
  return known.has(cause?.code) ? cause.code : 'COLLECTIVE_READ_FAILED';
}

function plainLimits(row) {
  return {
    maxTradeUsdE8: s(row.maxTradeUsdE8 ?? row[0]),
    maxTxCostUsdE8: s(row.maxTxCostUsdE8 ?? row[1]),
    minLiquidityUsdE8: s(row.minLiquidityUsdE8 ?? row[2]),
    maxAllocationBps: Number(row.maxAllocationBps ?? row[3]),
    maxConcentrationBps: Number(row.maxConcentrationBps ?? row[4]),
    maxSlippageBps: Number(row.maxSlippageBps ?? row[5]),
    reserveBps: Number(row.reserveBps ?? row[6]),
    maxOracleAgeSeconds: Number(row.maxOracleAgeSeconds ?? row[7]),
    enabled: Boolean(row.enabled ?? row[8])
  };
}

function wholeUnitClaimable(balance, perShare, priorRemainder) {
  const product = balance * perShare;
  const whole = product / PRECISION;
  const fraction = product % PRECISION + priorRemainder;
  return { whole: whole + fraction / PRECISION, remainder: fraction % PRECISION };
}

export function createCollectiveReader({ config = readCollectiveConfig(), provider: injectedProvider = null, providerFactory = null } = {}) {
  let providerPromise = null;
  let deploymentPromise = null;
  let deploymentCache = null;
  let deploymentCacheUntil = 0;

  async function getProvider() {
    if (injectedProvider) return injectedProvider;
    if (!config.configured) throw error('COLLECTIVE_NOT_CONFIGURED');
    if (!providerPromise) {
      providerPromise = Promise.resolve().then(() => providerFactory
        ? providerFactory(config)
        : new JsonRpcProvider(config.rpcUrl, config.chainId));
    }
    try {
      return await providerPromise;
    } catch {
      providerPromise = null;
      throw error('PROVIDER_UNAVAILABLE');
    }
  }

  async function verifyDeployment() {
    if (!config.configured) throw error('COLLECTIVE_NOT_CONFIGURED');
    if (deploymentCache && Date.now() < deploymentCacheUntil) return deploymentCache;
    if (!deploymentPromise) {
      deploymentPromise = (async () => {
        const provider = await getProvider();
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== Number(config.chainId)) throw error('CHAIN_ID_MISMATCH');
        const [factoryCode, assetCode] = await Promise.all([
          provider.getCode(config.factoryAddress),
          provider.getCode(config.assetAddress)
        ]);
        if (!codeExists(factoryCode)) throw error('FACTORY_HAS_NO_CODE');
        if (!codeExists(assetCode)) throw error('ASSET_HAS_NO_CODE');
        const factory = new Contract(config.factoryAddress, FACTORY_ABI, provider);
        const configuredAsset = await factory.usdt();
        if (lower(configuredAsset) !== lower(config.assetAddress)) throw error('FACTORY_ASSET_MISMATCH');
        const latestBlock = await provider.getBlockNumber();
        const [latest, allVaults] = await Promise.all([
          provider.getBlock(latestBlock),
          factory.allVaults()
        ]);
        if (!Array.isArray(allVaults) || allVaults.length > COLLECTIVE_MAX_VAULTS) throw error('FACTORY_VAULT_LIMIT_INVALID');
        return {
          provider,
          factory,
          latestBlock,
          latestTimestamp: Number(latest?.timestamp || 0),
          vaults: allVaults.map((address) => getAddress(address))
        };
      })().then((state) => {
        deploymentCache = state;
        deploymentCacheUntil = Date.now() + 10_000;
        return state;
      }).catch((cause) => {
        deploymentPromise = null;
        if (cause?.code) throw cause;
        throw error('PROVIDER_UNAVAILABLE');
      });
    }
    return deploymentPromise;
  }

  async function assertKnownVault(address, deployment = null) {
    if (!isAddress(address)) throw error('BAD_VAULT_ADDRESS', 400);
    const state = deployment || await verifyDeployment();
    const checksum = getAddress(address);
    if (!state.vaults.some((row) => lower(row) === lower(checksum))) throw error('VAULT_NOT_REGISTERED', 404);
    return checksum;
  }

  async function readSnapshot(vaultAddress, deployment, { includeQueue = true } = {}) {
    const { provider, latestBlock, latestTimestamp } = deployment;
    const vault = new Contract(vaultAddress, VAULT_ABI, provider);
    const [
      name, symbol, shareDecimals, assetAddress, totalAssets, totalSupply, grossAssets,
      liabilities, incomeLiability, withdrawalLiability, riskReserve, realizedIncomeAccrued,
      accruedExpenses, realizedLossCarry, lastSettledEpoch, availablePrincipalIdle,
      queueAvailable, epochAddress, adapterAddress, queueAddress, riskAddress,
      emergencyAddress, accessAddress
    ] = await Promise.all([
      vault.name(), vault.symbol(), vault.decimals(), vault.asset(), vault.totalAssets(),
      vault.totalSupply(), vault.grossAssets(), vault.liabilities(), vault.incomeLiability(),
      vault.withdrawalLiability(), vault.riskReserve(), vault.realizedIncomeAccrued(),
      vault.accruedExpenses(), vault.realizedLossCarry(), vault.lastSettledEpoch(),
      vault.availablePrincipalIdle(), vault.queuedPayoutAvailable(), vault.epochManager(),
      vault.strategyAdapter(), vault.withdrawalQueue(), vault.riskController(),
      vault.emergencyModule(), vault.accessController()
    ]);

    const asset = new Contract(assetAddress, ERC20_ABI, provider);
    const epoch = new Contract(epochAddress, EPOCH_ABI, provider);
    const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider);
    const queue = new Contract(queueAddress, QUEUE_ABI, provider);
    const risk = new Contract(riskAddress, RISK_ABI, provider);
    const emergency = new Contract(emergencyAddress, EMERGENCY_ABI, provider);
    const access = new Contract(accessAddress, ACCESS_ABI, provider);
    const kindPromise = risk.vaultKind(vaultAddress);
    const [assetSymbol, assetDecimals, adapterAssets, positionShares, principalBasis, protocolAddress, targetAddress,
      currentEpoch, currentEpochStart, currentEpochEnd, snapshotBlock, subscriptionDeadline,
      epochStarted, depositsOpen, withdrawalWindowOpen, queueHead, queueNextId, paused,
      riskLimits, vaultKind, priceOracleAddress, keeperRole, incidentNumber] = await Promise.all([
      asset.symbol(), asset.decimals(), adapter.totalAssets(), adapter.positionShares(), adapter.principalBasis(),
      adapter.protocol(), adapter.getFunction('target')(), epoch.currentEpoch(), epoch.currentEpochStart(),
      epoch.currentEpochEnd(), epoch.currentSnapshotBlock(), epoch.subscriptionDeadline(),
      epoch.started(), epoch.depositsOpen(), epoch.withdrawalWindowOpen(), queue.head(),
      queue.nextId(), emergency.paused(), risk.limits(vaultAddress), kindPromise,
      risk.priceOracle(), access.KEEPER_ROLE(), emergency.incidentNumber()
    ]);
    if (Number(assetDecimals) > 18) throw error('ASSET_DECIMALS_UNSUPPORTED');
    const strategyTarget = new Contract(targetAddress, STRATEGY_TARGET_ABI, provider);
    const [kindEnabled, assetAllowed, protocolAllowed, targetMaxWithdraw] = await Promise.all([
      risk.isKindEnabled(vaultKind), risk.isAssetAllowed(assetAddress), risk.isProtocolAllowed(protocolAddress),
      strategyTarget.maxWithdraw(adapterAddress)
    ]);

    const oracle = new Contract(priceOracleAddress, ORACLE_ABI, provider);
    const [assetPrice, nativePrice] = await Promise.all([
      oracle.tokenPriceUsdE8(assetAddress),
      oracle.nativePriceUsdE8()
    ]);
    const limits = plainLimits(riskLimits);
    const oracleAge = Math.max(0, latestTimestamp - eventTimestamp(assetPrice.updatedAt ?? assetPrice[1]));
    const nativeOracleAge = Math.max(0, latestTimestamp - eventTimestamp(nativePrice.updatedAt ?? nativePrice[1]));
    const assetOracleFresh = Boolean(assetPrice.priceUsdE8 ?? assetPrice[0]) &&
      eventTimestamp(assetPrice.updatedAt ?? assetPrice[1]) > 0 &&
      eventTimestamp(assetPrice.updatedAt ?? assetPrice[1]) <= latestTimestamp && oracleAge <= limits.maxOracleAgeSeconds;
    const nativeOracleFresh = Boolean(nativePrice.priceUsdE8 ?? nativePrice[0]) &&
      eventTimestamp(nativePrice.updatedAt ?? nativePrice[1]) > 0 &&
      eventTimestamp(nativePrice.updatedAt ?? nativePrice[1]) <= latestTimestamp && nativeOracleAge <= limits.maxOracleAgeSeconds;

    const queueRequests = [];
    if (includeQueue) {
      const head = BigInt(queueHead);
      const next = BigInt(queueNextId);
      const maxRows = 50n;
      const ids = [];
      for (let id = head; id < next && BigInt(ids.length) < maxRows; id += 1n) ids.push(id);
      const rows = await Promise.all(ids.map((id) => queue.request(id)));
      rows.forEach((row, index) => {
        const remainingAssets = BigInt(row.remainingAssets ?? row[2]);
        if (remainingAssets > 0n) {
          queueRequests.push({
            id: ids[index].toString(), owner: row.owner ?? row[0], shares: s(row.shares ?? row[1]),
            remainingAssets: remainingAssets.toString(), requestedAt: Number(row.requestedAt ?? row[3])
          });
        }
      });
    }

    return {
      schema: 'fbt.collective.vault.v1',
      chainId: config.chainId,
      address: vaultAddress,
      name,
      symbol,
      shareDecimals: Number(shareDecimals),
      asset: {
        address: getAddress(assetAddress),
        symbol: String(assetSymbol),
        decimals: Number(assetDecimals)
      },
      accounting: {
        totalAssetsRaw: s(totalAssets), totalAssets: formatUnits(totalAssets, Number(assetDecimals)),
        totalSupplyRaw: s(totalSupply), grossAssetsRaw: s(grossAssets), liabilitiesRaw: s(liabilities),
        incomeLiabilityRaw: s(incomeLiability), withdrawalLiabilityRaw: s(withdrawalLiability),
        riskReserveRaw: s(riskReserve), realizedIncomeAccruedRaw: s(realizedIncomeAccrued),
        accruedExpensesRaw: s(accruedExpenses), realizedLossCarryRaw: s(realizedLossCarry),
        availablePrincipalIdleRaw: s(availablePrincipalIdle), queuedPayoutAvailableRaw: s(queueAvailable),
        lastSettledEpoch: Number(lastSettledEpoch)
      },
      strategy: {
        adapter: getAddress(adapterAddress), target: getAddress(targetAddress), protocol: getAddress(protocolAddress),
        principalBasisRaw: s(principalBasis), totalAssetsRaw: s(adapterAssets),
        positionSharesRaw: s(positionShares), maxWithdrawRaw: s(targetMaxWithdraw)
      },
      epoch: {
        number: Number(currentEpoch), started: Boolean(epochStarted),
        start: Number(currentEpochStart), end: Number(currentEpochEnd),
        snapshotBlock: Number(snapshotBlock), subscriptionDeadline: Number(subscriptionDeadline),
        depositsOpen: Boolean(depositsOpen), withdrawalWindowOpen: Boolean(withdrawalWindowOpen)
      },
      queue: {
        address: getAddress(queueAddress), head: s(queueHead), nextId: s(queueNextId),
        pendingCount: (BigInt(queueNextId) - BigInt(queueHead)).toString(), requests: queueRequests,
        truncated: includeQueue && (BigInt(queueNextId) - BigInt(queueHead) > 50n)
      },
      risk: {
        controller: getAddress(riskAddress), kind: Number(vaultKind), kindEnabled: Boolean(kindEnabled),
        assetAllowed: Boolean(assetAllowed), protocolAllowed: Boolean(protocolAllowed), limits,
        reserveBps: Number(await risk.reserveBps(vaultAddress)),
        assetPriceUsdE8: s(assetPrice.priceUsdE8 ?? assetPrice[0]), assetPriceUpdatedAt: eventTimestamp(assetPrice.updatedAt ?? assetPrice[1]), assetOracleAgeSeconds: oracleAge, assetOracleFresh,
        nativePriceUsdE8: s(nativePrice.priceUsdE8 ?? nativePrice[0]), nativePriceUpdatedAt: eventTimestamp(nativePrice.updatedAt ?? nativePrice[1]), nativeOracleAgeSeconds: nativeOracleAge, nativeOracleFresh
      },
      emergency: { paused: Boolean(paused), incidentNumber: Number(incidentNumber) },
      access: { controller: getAddress(accessAddress), keeperRole },
      latestBlock,
      observedAt: latestTimestamp
    };
  }

  async function status() {
    const base = publicCollectiveConfig(config);
    if (!config.configured) return { ...base, ready: false, reason: config.issues[0] || 'COLLECTIVE_NOT_CONFIGURED' };
    try {
      const deployment = await verifyDeployment();
      return {
        ...base,
        ready: true,
        reason: null,
        modules: { ...base.modules, stableYield: { enabled: true, state: 'verified', reason: null } },
        deployment: { ...base.deployment, verifiedOnChain: true },
        verification: {
          chainId: config.chainId,
          latestBlock: deployment.latestBlock,
          factoryAddress: config.factoryAddress,
          assetAddress: config.assetAddress,
          factoryHasCode: true,
          assetHasCode: true,
          factoryAssetMatches: true
        }
      };
    } catch (cause) {
      const reason = publicErrorCode(cause);
      return {
        ...base,
        ready: false,
        reason,
        modules: { ...base.modules, stableYield: { enabled: false, state: 'verification-failed', reason } }
      };
    }
  }

  async function listVaults() {
    const deployment = await verifyDeployment();
    return Promise.all(deployment.vaults.map((address) => readSnapshot(address, deployment)));
  }

  async function getVault(vaultAddress) {
    const deployment = await verifyDeployment();
    const address = await assertKnownVault(vaultAddress, deployment);
    return readSnapshot(address, deployment);
  }

  async function getPosition(vaultAddress, walletAddress) {
    if (!isAddress(walletAddress)) throw error('BAD_WALLET_ADDRESS', 400);
    const snapshot = await getVault(vaultAddress);
    const provider = await getProvider();
    const vault = new Contract(snapshot.address, VAULT_ABI, provider);
    const [shareBalance, nextIncomeEpoch, fractionalRemainder] = await Promise.all([
      vault.balanceOf(walletAddress), vault.nextIncomeEpoch(walletAddress), vault.fractionalIncomeRemainder(walletAddress)
    ]);
    const redeemableAssets = shareBalance > 0n ? await vault.previewRedeem(shareBalance) : 0n;
    let cursor = Number(nextIncomeEpoch) || 1;
    const end = Number(snapshot.accounting.lastSettledEpoch);
    let remainder = BigInt(fractionalRemainder);
    let claimable = 0n;
    let processed = 0;
    for (; cursor <= end && processed < 12; cursor += 1, processed += 1) {
      const distribution = await vault.incomeDistribution(cursor);
      const perShare = BigInt(distribution.incomePerShare ?? distribution[3]);
      const block = BigInt(distribution.snapshotBlock ?? distribution[0]);
      if (perShare !== 0n) {
        const historical = await vault.getPastBalance(walletAddress, block);
        const result = wholeUnitClaimable(BigInt(historical), perShare, remainder);
        claimable += result.whole;
        remainder = result.remainder;
      }
    }
    return {
      schema: 'fbt.collective.position.v1',
      vault: snapshot.address,
      wallet: getAddress(walletAddress),
      shareBalanceRaw: s(shareBalance),
      redeemableAssetsRaw: s(redeemableAssets),
      claimableIncomeRaw: s(claimable),
      nextIncomeEpoch: Number(nextIncomeEpoch) || 1,
      lastSettledEpoch: end,
      claimScanTruncated: cursor <= end,
      fractionalIncomeRemainder: s(fractionalRemainder),
      observedAt: snapshot.observedAt
    };
  }

  async function getEvents(vaultAddress, { fromBlock, toBlock, walletAddress } = {}) {
    const deployment = await verifyDeployment();
    const address = await assertKnownVault(vaultAddress, deployment);
    if (config.deploymentBlock == null) throw error('EVENT_INDEX_NOT_CONFIGURED');
    const to = toBlock == null ? deployment.latestBlock : Number(toBlock);
    const from = fromBlock == null
      ? Math.max(config.deploymentBlock, to - config.maxEventSpan + 1)
      : Number(fromBlock);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) throw error('BAD_BLOCK_RANGE', 400);
    if (from < config.deploymentBlock) throw error('BLOCK_RANGE_BEFORE_DEPLOYMENT', 400);
    if (to > deployment.latestBlock) throw error('BLOCK_RANGE_AFTER_HEAD', 400);
    const snapshot = await readSnapshot(address, deployment, { includeQueue: false });
    return scanVaultEvents(deployment.provider, {
      vaultAddress: address,
      queueAddress: snapshot.queue.address,
      fromBlock: from,
      toBlock: to,
      walletAddress,
      maxSpan: config.maxEventSpan
    });
  }

  async function getProposals(vaultAddress) {
    const { buildCollectiveProposals } = await import('./strategyPolicy.js');
    const snapshot = await getVault(vaultAddress);
    return buildCollectiveProposals(snapshot, { chainId: config.chainId });
  }

  async function isKeeper(account) {
    if (!isAddress(account)) return false;
    const deployment = await verifyDeployment();
    const factory = deployment.factory;
    const riskAddress = await factory.riskController();
    const risk = new Contract(riskAddress, RISK_ABI, deployment.provider);
    const accessAddress = await risk.accessController();
    const access = new Contract(accessAddress, ACCESS_ABI, deployment.provider);
    const role = await access.KEEPER_ROLE();
    return Boolean(await access.hasRole(role, account));
  }

  return Object.freeze({
    config,
    getProvider,
    verifyDeployment,
    status,
    listVaults,
    getVault,
    getPosition,
    getEvents,
    getProposals,
    isKeeper,
    readSnapshot
  });
}

export const defaultCollectiveReader = createCollectiveReader();
