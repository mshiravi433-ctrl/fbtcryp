import { ACTIVATION_SNAPSHOT } from './activation.snapshot.js';

export const COLLECTIVE_SCHEMA = 'fbt.collective.v1';
export const COLLECTIVE_CHAINS = Object.freeze({
  4663: Object.freeze({
    id: 4663,
    name: 'Robinhood Chain',
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    testnet: false,
    supported: true
  }),
  46630: Object.freeze({
    id: 46630,
    name: 'Robinhood Chain Testnet',
    rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    testnet: true,
    supported: true
  })
});

// Backwards-compatible mainnet constants for callers that need a known default.
export const COLLECTIVE_CHAIN_ID = 4663;
export const COLLECTIVE_CHAIN_NAME = COLLECTIVE_CHAINS[COLLECTIVE_CHAIN_ID].name;
export const COLLECTIVE_EXPLORER = COLLECTIVE_CHAINS[COLLECTIVE_CHAIN_ID].explorer;
export const COLLECTIVE_MAX_VAULTS = 32;
export const COLLECTIVE_DEFAULT_EVENT_SPAN = 20_000;
export const COLLECTIVE_MAX_EVENT_SPAN = 20_000;

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const isTrue = (value) => String(value ?? '').trim().toLowerCase() === 'true';
const validAddress = (value) => ADDRESS_RE.test(String(value ?? '').trim());
const isLoopbackHostname = (hostname) => {
  const host = String(hostname ?? '').toLowerCase();
  const normalized = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};
const intOrNull = (value) => {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

function deploymentCandidates(snapshot) {
  const rows = [];
  const byChain = snapshot?.liveDeployments;
  if (Array.isArray(byChain)) {
    rows.push(...byChain);
  } else if (byChain && typeof byChain === 'object') {
    rows.push(...Object.values(byChain));
  }
  if (snapshot?.liveDeployment && typeof snapshot.liveDeployment === 'object') {
    rows.push(snapshot.liveDeployment);
  }
  return rows.filter((row) => row && typeof row === 'object');
}

/** Return only the evidence record whose own chainId exactly matches. */
export function snapshotDeploymentForChain(snapshot, chainId) {
  const id = intOrNull(chainId);
  if (id == null) return null;
  return deploymentCandidates(snapshot).find((row) => Number(row.chainId) === id) ?? null;
}

function inferredSnapshotChainId(snapshot) {
  const preferred = intOrNull(snapshot?.defaultChainId);
  if (preferred != null && COLLECTIVE_CHAINS[preferred]) return preferred;

  const verified = deploymentCandidates(snapshot).filter((row) => {
    const id = intOrNull(row.chainId);
    return id != null && COLLECTIVE_CHAINS[id] && row.status === 'activated' && row.verified === true &&
      Boolean(COLLECTIVE_CHAINS[id].testnet) === (row.testnet === true);
  });
  if (verified.length === 1) return Number(verified[0].chainId);

  // Legacy single-record snapshots remain readable, but never across networks.
  const legacy = snapshot?.liveDeployment;
  if (legacy && legacy.status === 'activated' && legacy.verified === true) {
    const id = intOrNull(legacy.chainId);
    if (id != null && COLLECTIVE_CHAINS[id] && Boolean(COLLECTIVE_CHAINS[id].testnet) === (legacy.testnet === true)) return id;
  }
  return COLLECTIVE_CHAIN_ID;
}

/**
 * A live deployment written by CI is accepted only when it is activated,
 * verified, and belongs to the exact chain selected for this API process.
 * The record's chainId is authoritative when no COLLECTIVE_CHAIN_ID override
 * is set. An explicit COLLECTIVE_CHAIN_ID always wins, including an unsupported
 * value (which fails closed rather than falling back to another chain).
 */
export function readSnapshotDeployment(env = process.env, snapshot = ACTIVATION_SNAPSHOT, selectedChainId = undefined) {
  const explicit = String(env.COLLECTIVE_READS_ENABLED ?? '').trim().toLowerCase();
  if (explicit === 'false') return null;

  const envChain = String(env.COLLECTIVE_CHAIN_ID ?? '').trim();
  const chainId = selectedChainId !== undefined
    ? intOrNull(selectedChainId)
    : envChain !== '' ? intOrNull(envChain) : inferredSnapshotChainId(snapshot);
  const chain = chainId == null ? null : COLLECTIVE_CHAINS[chainId];
  if (!chain) return null;

  const live = snapshotDeploymentForChain(snapshot, chainId);
  if (!live || live.status !== 'activated' || live.verified !== true) return null;
  if (Number(live.chainId) !== chain.id || Boolean(live.testnet) !== chain.testnet) return null;

  const rpcUrl = String(live.rpcUrl ?? chain.rpcUrl).trim();
  const factoryAddress = String(live.factoryAddress ?? '').trim();
  const assetAddress = String(live.assetAddress ?? '').trim();
  const deploymentBlock = intOrNull(live.deploymentBlock);
  if (!rpcUrl || !validAddress(factoryAddress) || !validAddress(assetAddress) || deploymentBlock == null) return null;
  try {
    const url = new URL(rpcUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  } catch {
    return null;
  }
  return Object.freeze({
    chainId,
    testnet: chain.testnet,
    rpcUrl,
    factoryAddress,
    assetAddress,
    deploymentBlock,
    verifiedAt: live.verifiedAt ?? null
  });
}

/**
 * Read-only chain configuration. Contract/token/oracle/strategy addresses are
 * never inferred from symbols or copied between networks: only exact-chain
 * verified evidence or explicit operator-provided values are accepted.
 */
export function readCollectiveConfig(env = process.env, snapshot = ACTIVATION_SNAPSHOT) {
  const envChainId = String(env.COLLECTIVE_CHAIN_ID ?? '').trim();
  const chainId = envChainId !== '' ? intOrNull(envChainId) : inferredSnapshotChainId(snapshot);
  const chain = chainId == null ? null : COLLECTIVE_CHAINS[chainId] ?? null;
  const snapshotRecord = chain ? readSnapshotDeployment(env, snapshot, chainId) : null;
  const enabledValue = String(env.COLLECTIVE_READS_ENABLED ?? '').trim();
  const enabled = isTrue(enabledValue) || (snapshotRecord != null && enabledValue === '');
  const rpcUrl = String(env.COLLECTIVE_RPC_URL ?? '').trim() || snapshotRecord?.rpcUrl || chain?.rpcUrl || '';
  const factoryAddress = String(env.COLLECTIVE_FACTORY_ADDRESS ?? '').trim() || snapshotRecord?.factoryAddress || '';
  const assetAddress = String(env.COLLECTIVE_ASSET_ADDRESS ?? '').trim() || snapshotRecord?.assetAddress || '';
  const deploymentBlock = intOrNull(env.COLLECTIVE_DEPLOYMENT_BLOCK) ?? snapshotRecord?.deploymentBlock ?? null;
  const maxEventSpanRaw = intOrNull(env.COLLECTIVE_EVENT_MAX_BLOCK_SPAN);
  const maxEventSpan = maxEventSpanRaw == null
    ? COLLECTIVE_DEFAULT_EVENT_SPAN
    : Math.min(COLLECTIVE_MAX_EVENT_SPAN, Math.max(1, maxEventSpanRaw));
  const keeperEnabled = isTrue(env.COLLECTIVE_KEEPER_ENABLED);
  const issues = [];

  if (!chain) issues.push('UNSUPPORTED_CHAIN');
  if (!enabled) issues.push('READS_DISABLED');
  if (!rpcUrl) issues.push('RPC_NOT_CONFIGURED');
  else {
    try {
      const url = new URL(rpcUrl);
      const allowLocalHttp = (env.NODE_ENV === 'test' || isTrue(env.COLLECTIVE_ALLOW_LOCAL_RPC)) &&
        isLoopbackHostname(url.hostname);
      if (url.protocol !== 'https:' && !(allowLocalHttp && url.protocol === 'http:')) issues.push('RPC_MUST_USE_HTTPS');
      if (url.username || url.password || url.search || url.hash) issues.push('RPC_URL_CREDENTIALS_NOT_ALLOWED');
    } catch {
      issues.push('RPC_URL_INVALID');
    }
  }
  if (!validAddress(factoryAddress)) issues.push('FACTORY_ADDRESS_NOT_CONFIGURED');
  if (!validAddress(assetAddress)) issues.push('ASSET_ADDRESS_NOT_CONFIGURED');
  if (deploymentBlock == null) issues.push('DEPLOYMENT_BLOCK_NOT_CONFIGURED');

  const baseReady = enabled && Boolean(chain) && Boolean(rpcUrl) &&
    !issues.includes('RPC_MUST_USE_HTTPS') && !issues.includes('RPC_URL_INVALID') &&
    !issues.includes('RPC_URL_CREDENTIALS_NOT_ALLOWED') && validAddress(factoryAddress) &&
    validAddress(assetAddress) && deploymentBlock != null;
  const status = baseReady ? 'configured' : (enabled ? 'incomplete' : 'disabled');

  return Object.freeze({
    schema: COLLECTIVE_SCHEMA,
    chainId,
    chainName: chain?.name ?? 'Unsupported network',
    explorer: chain?.explorer ?? '',
    testnet: chain?.testnet ?? false,
    enabled,
    configured: baseReady,
    status,
    issues: Object.freeze(issues),
    rpcUrl,
    factoryAddress: validAddress(factoryAddress) ? factoryAddress : null,
    assetAddress: validAddress(assetAddress) ? assetAddress : null,
    deploymentBlock,
    maxEventSpan,
    keeperEnabled,
    keeperKeyConfigured: Boolean(String(env.COLLECTIVE_KEEPER_PRIVATE_KEY ?? '').trim())
  });
}

export function publicCollectiveConfig(config = readCollectiveConfig()) {
  const lane = (enabled, reason, state) => ({ enabled, state, reason });
  return {
    schema: config.schema,
    chain: {
      id: config.chainId,
      name: config.chainName,
      explorer: config.explorer,
      testnet: config.testnet === true,
      supported: Boolean(COLLECTIVE_CHAINS[config.chainId])
    },
    deployment: {
      status: config.status,
      configured: config.configured,
      verifiedOnChain: false,
      factoryAddress: config.factoryAddress,
      assetAddress: config.assetAddress,
      deploymentBlock: config.deploymentBlock,
      issues: [...config.issues]
    },
    modules: {
      stableYield: config.configured
        ? lane(true, null, 'read-configured')
        : lane(false, 'VERIFIED_DEPLOYMENT_CONFIGURATION_REQUIRED', config.status),
      farmingLiquidity: lane(false, 'DEDICATED_LP_ADAPTER_AND_ORACLE_REVIEW_REQUIRED', 'disabled'),
      approvedTokenTrading: lane(false, 'DEDICATED_TRADING_ACCOUNTING_AND_INDEPENDENT_REVIEW_REQUIRED', 'disabled')
    },
    operations: {
      userTransactions: config.configured,
      publicReads: config.configured,
      publicDashboard: true,
      serverSigning: false,
      privateKeysStoredByApi: false,
      aiCanSign: false,
      keeperEnabled: config.keeperEnabled,
      deploymentConfigured: config.configured,
      gasPayer: 'user-wallet',
      gasSponsorshipEnabled: false,
      userPaysGas: true,
      relayerEnabled: false
    },
    disclosures: [
      'Deposits use user-owned principal only; no company investment principal is supplied.',
      'Returns are variable and not guaranteed; principal can lose value.',
      'Withdrawal requests are queued and can be delayed by strategy liquidity.',
      'Every transaction is signed by the connected user wallet, which pays its own network gas. No sponsor, relayer or company gas subsidy is enabled.',
      'The fixed ERC-4626 target can report zero yield; the dashboard shows its live position and reported liquidity.',
      'The contracts have not been independently audited.'
    ]
  };
}

export function isCollectiveAddress(value) {
  return validAddress(value);
}

export function normalizeCollectiveAddress(value) {
  const input = String(value ?? '').trim();
  return validAddress(input) ? input.toLowerCase() : null;
}
