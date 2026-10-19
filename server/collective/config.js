import { ACTIVATION_SNAPSHOT } from './activation.snapshot.js';

export const COLLECTIVE_SCHEMA = 'fbt.collective.v1';
export const COLLECTIVE_CHAIN_ID = 4663;
export const COLLECTIVE_CHAIN_NAME = 'Robinhood Chain';
export const COLLECTIVE_EXPLORER = 'https://robinhoodchain.blockscout.com';
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

/**
 * A live deployment written by the keyless CI workflow and committed to the
 * repository. It is the ONLY automatic source of addresses, and it is accepted
 * only when the activation workflow itself verified it on-chain:
 *
 *   status === 'activated'  — phase 2 (after the 1-day timelock) ran,
 *   verified === true       — `collective-activate.mjs --check` passed,
 *   chainId === 4663        — the deployed chain is Robinhood Chain,
 *   addresses + block set   — nothing is guessed or defaulted.
 *
 * An explicit `COLLECTIVE_READS_ENABLED=false` always wins, so an operator can
 * turn the automatic path off without deleting the record.
 */
export function readSnapshotDeployment(env = process.env, snapshot = ACTIVATION_SNAPSHOT) {
  const explicit = String(env.COLLECTIVE_READS_ENABLED ?? '').trim().toLowerCase();
  if (explicit === 'false') return null;
  const live = snapshot?.liveDeployment;
  if (!live || typeof live !== 'object') return null;
  if (String(live.status ?? '') !== 'activated') return null;
  if (live.verified !== true) return null;
  if (Number(live.chainId) !== COLLECTIVE_CHAIN_ID) return null;
  const rpcUrl = String(live.rpcUrl ?? '').trim();
  const factoryAddress = String(live.factoryAddress ?? '').trim();
  const assetAddress = String(live.assetAddress ?? '').trim();
  const deploymentBlock = intOrNull(live.deploymentBlock);
  if (!rpcUrl || !validAddress(factoryAddress) || !validAddress(assetAddress) || deploymentBlock == null) return null;
  try {
    if (new URL(rpcUrl).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return Object.freeze({ rpcUrl, factoryAddress, assetAddress, deploymentBlock, verifiedAt: live.verifiedAt ?? null });
}

/**
 * Read-only chain configuration. Contract/token/oracle/strategy addresses are
 * never inferred from symbols or copied from another network: operators must
 * provide the deployed factory and accounting asset explicitly — or the
 * activation workflow must have verified and committed them (see above).
 */
export function readCollectiveConfig(env = process.env, snapshot = ACTIVATION_SNAPSHOT) {
  const chainId = intOrNull(env.COLLECTIVE_CHAIN_ID) ?? COLLECTIVE_CHAIN_ID;
  // The workflow-verified record is a fallback only: an explicit value in the
  // environment always wins, and `COLLECTIVE_READS_ENABLED=false` disables the
  // automatic path outright.
  const snapshotRecord = readSnapshotDeployment(env, snapshot);
  const enabled = isTrue(env.COLLECTIVE_READS_ENABLED) || (snapshotRecord != null && String(env.COLLECTIVE_READS_ENABLED ?? '').trim() === '');
  const rpcUrl = String(env.COLLECTIVE_RPC_URL ?? '').trim() || snapshotRecord?.rpcUrl || '';
  const factoryAddress = String(env.COLLECTIVE_FACTORY_ADDRESS ?? '').trim() || snapshotRecord?.factoryAddress || '';
  const assetAddress = String(env.COLLECTIVE_ASSET_ADDRESS ?? '').trim() || snapshotRecord?.assetAddress || '';
  const deploymentBlock = intOrNull(env.COLLECTIVE_DEPLOYMENT_BLOCK) ?? snapshotRecord?.deploymentBlock ?? null;
  const maxEventSpanRaw = intOrNull(env.COLLECTIVE_EVENT_MAX_BLOCK_SPAN);
  const maxEventSpan = maxEventSpanRaw == null
    ? COLLECTIVE_DEFAULT_EVENT_SPAN
    : Math.min(COLLECTIVE_MAX_EVENT_SPAN, Math.max(1, maxEventSpanRaw));
  const keeperEnabled = isTrue(env.COLLECTIVE_KEEPER_ENABLED);
  const issues = [];

  if (chainId !== COLLECTIVE_CHAIN_ID) issues.push('UNSUPPORTED_CHAIN');
  if (!enabled) issues.push('READS_DISABLED');
  if (!rpcUrl) issues.push('RPC_NOT_CONFIGURED');
  else {
    try {
      const url = new URL(rpcUrl);
      const allowLocalHttp = (env.NODE_ENV === 'test' || isTrue(env.COLLECTIVE_ALLOW_LOCAL_RPC)) &&
        isLoopbackHostname(url.hostname);
      if (url.protocol !== 'https:' && !(allowLocalHttp && url.protocol === 'http:')) issues.push('RPC_MUST_USE_HTTPS');
      if (url.username || url.password) issues.push('RPC_URL_CREDENTIALS_NOT_ALLOWED');
    } catch {
      issues.push('RPC_URL_INVALID');
    }
  }
  if (!validAddress(factoryAddress)) issues.push('FACTORY_ADDRESS_NOT_CONFIGURED');
  if (!validAddress(assetAddress)) issues.push('ASSET_ADDRESS_NOT_CONFIGURED');
  if (deploymentBlock == null) issues.push('DEPLOYMENT_BLOCK_NOT_CONFIGURED');

  const baseReady = enabled && chainId === COLLECTIVE_CHAIN_ID &&
    Boolean(rpcUrl) && !issues.includes('RPC_MUST_USE_HTTPS') && !issues.includes('RPC_URL_INVALID') &&
    !issues.includes('RPC_URL_CREDENTIALS_NOT_ALLOWED') && validAddress(factoryAddress) &&
    validAddress(assetAddress) && deploymentBlock != null;
  const status = baseReady ? 'configured' : (enabled ? 'incomplete' : 'disabled');

  return Object.freeze({
    schema: COLLECTIVE_SCHEMA,
    chainId,
    chainName: COLLECTIVE_CHAIN_NAME,
    explorer: COLLECTIVE_EXPLORER,
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
      id: COLLECTIVE_CHAIN_ID,
      name: COLLECTIVE_CHAIN_NAME,
      explorer: COLLECTIVE_EXPLORER
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
      // Gas policy is part of the public contract with users: the connected
      // user wallet signs and pays every deposit/claim/withdrawal request.
      // There is no relayer, paymaster, sponsor or server-held key in the API.
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
