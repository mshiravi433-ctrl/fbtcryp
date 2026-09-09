import { FEE_BPS } from './feeBps';
import { farmScore, getYields, getYieldHistory, investRoute, pairTokens, rateIsUnusual, realShare } from './yields';

/**
 * Which feed projects are auto-compounding vaults, for the Farm "vault"
 * filter. These protocols take a deposit and handle the compounding
 * themselves — the user never touches the underlying LP. The set only
 * contains slugs from the server allow-list, so a filter chip can never
 * promise a vault the feed cannot deliver.
 */
export const VAULT_PROJECTS = Object.freeze(['yearn-finance', 'convex-finance', 'beefy']);

/**
 * Which feed projects compound by themselves, for the Farm "auto compound"
 * filter. Liquid-staking tokens grow against their underlying on their own —
 * there is no reward to claim and nothing to restake — which is exactly what
 * "auto compound" means on this screen. Same rule as above: allow-list slugs
 * only.
 */
export const AUTOCOMPOUND_PROJECTS = Object.freeze([
  'lido', 'rocket-pool', 'binance-staked-eth', 'ether.fi-stake',
  'jito-liquid-staking', 'marinade-liquid-staking', 'jupiter-staked-sol'
]);

export const FARM_EXECUTION_STATES = Object.freeze([
  'IDLE', 'VALIDATING', 'QUOTING', 'PREPARING', 'SIMULATING',
  'AWAITING_SIGNATURE', 'SIGNED', 'BROADCAST', 'PENDING',
  'CONFIRMED', 'VERIFYING', 'COMPLETED'
]);

export const FARM_EXECUTION_ERRORS = Object.freeze([
  'USER_REJECTED', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_ALLOWANCE',
  'WRONG_NETWORK', 'GAS_ESTIMATION_FAILED', 'SIMULATION_FAILED',
  'CONTRACT_REVERT', 'RPC_ERROR', 'TIMEOUT', 'TRANSACTION_DROPPED', 'INDEXER_DELAY'
]);

/**
 * Feed chain name → the network-mark key vendored in lib/assetIconData.js.
 * The feed spells chains as names ("Ethereum", "BNB Chain", "zkSync Era"…);
 * AssetIcon wants chain ids / lowercase slugs. Unknown chains return null and
 * the UI falls back to the symbol monogram — an icon must never be missing.
 */
export const CHAIN_ICON_KEYS = Object.freeze({
  Ethereum: '1',
  Optimism: '10',
  'BNB Chain': '56',
  BSC: '56',
  Binance: '56',
  Unichain: '130',
  Polygon: '137',
  Monad: '143',
  Sonic: '146',
  Mantle: '5000',
  Base: '8453',
  Arbitrum: '42161',
  Avalanche: '43114',
  Linea: '59144',
  Berachain: '80094',
  Tron: 'tron',
  Solana: 'solana',
  Bitcoin: 'bitcoin',
  Cosmos: 'cosmos',
  TON: 'ton'
});

/** The network-mark key for a feed chain name, or null when unknown. */
export function chainIconKey(name) {
  return CHAIN_ICON_KEYS[String(name ?? '')] ?? null;
}

/**
 * Feed slugs are not labels. This is the canonical display form for the
 * well-known projects; anything else gets a title-case fallback so a row
 * never renders the raw slug ("aave-v3") to a human.
 */
export const PROJECT_DISPLAY_NAMES = Object.freeze({
  'aave-v3': 'Aave v3',
  'compound-v3': 'Compound III',
  'morpho-blue': 'Morpho Blue',
  lido: 'Lido',
  'rocket-pool': 'Rocket Pool',
  'uniswap-v3': 'Uniswap v3',
  'curve-dex': 'Curve',
  'pancakeswap-amm': 'PancakeSwap',
  'yearn-finance': 'Yearn',
  'convex-finance': 'Convex',
  beefy: 'Beefy',
  'jito-liquid-staking': 'Jito',
  'marinade-liquid-staking': 'Marinade',
  'jupiter-staked-sol': 'Jupiter',
  'binance-staked-eth': 'Binance stETH',
  'ether.fi-stake': 'Ether.fi',
  gmx: 'GMX',
  pendle: 'Pendle',
  'balancer-v2': 'Balancer',
  sushi: 'SushiSwap',
  velodrome: 'Velodrome',
  aerodrome: 'Aerodrome',
  camelot: 'Camelot',
  'trader-joe': 'Trader Joe',
  spookyswap: 'SpookySwap',
  'benqi-lending': 'Benqi',
  stargate: 'Stargate',
  'woofi': 'WOO Fi'
});

export function projectDisplayName(slug) {
  const s = String(slug ?? '');
  if (PROJECT_DISPLAY_NAMES[s]) return PROJECT_DISPLAY_NAMES[s];
  return s
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Localised label for a feed chain name, so «سوییچ به {{chain}}» reads
 * «سوییچ به اتریوم» on a Persian device instead of «سوییچ به Ethereum».
 * Unknown names fall back to the raw name (English), never a raw key.
 */
export function localChainLabel(name, t) {
  return t(`farm.chainLabels.${name}`, { defaultValue: name });
}

export const FARM_EVENTS = Object.freeze([
  'FARM_DISCOVERED', 'POOL_UPDATED', 'POSITION_UPDATED', 'REWARD_UPDATED',
  'FARM_DEPOSIT_STARTED', 'FARM_DEPOSIT_CONFIRMED', 'FARM_WITHDRAW_CONFIRMED',
  'FARM_STAKE_CONFIRMED', 'FARM_UNSTAKE_CONFIRMED', 'REWARD_CLAIMED',
  'COMPOUND_COMPLETED', 'FBT_FEE_APPLIED'
]);

export function emitFarmEvent(type, detail = {}) {
  if (!FARM_EVENTS.includes(type) || typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent(`fbt:${type}`, {
    detail: { ...detail, emittedAt: new Date().toISOString() }
  }));
  return true;
}

/**
 * Protocol-neutral contract. UI code consumes these methods and never embeds
 * protocol calldata. A method that is not backed by a verified integration
 * returns UNAVAILABLE rather than a plausible transaction.
 */
export class FarmAdapter {
  constructor({ id, networks = [], capabilities = [] } = {}) {
    this.id = id || 'unavailable';
    this.networks = Object.freeze([...networks]);
    this.capabilities = Object.freeze([...capabilities]);
  }
  supports(action) { return this.capabilities.includes(action); }
  unavailable(action) { return { status: 'UNAVAILABLE', action, adapter: this.id }; }
  async getPools() { return this.unavailable('getPools'); }
  async getPool() { return this.unavailable('getPool'); }
  async getFarm() { return this.unavailable('getFarm'); }
  async getVaults() { return this.unavailable('getVaults'); }
  async getRewards() { return this.unavailable('getRewards'); }
  async getAPY() { return this.unavailable('getAPY'); }
  async getAPR() { return this.unavailable('getAPR'); }
  async getTVL() { return this.unavailable('getTVL'); }
  async getLiquidity() { return this.unavailable('getLiquidity'); }
  async getPositions() { return this.unavailable('getPositions'); }
  async getUserPosition() { return this.unavailable('getUserPosition'); }
  async quoteDeposit() { return this.unavailable('quoteDeposit'); }
  async quoteWithdraw() { return this.unavailable('quoteWithdraw'); }
  async quoteStake() { return this.unavailable('quoteStake'); }
  async quoteUnstake() { return this.unavailable('quoteUnstake'); }
  async quoteCompound() { return this.unavailable('quoteCompound'); }
  async prepareDeposit() { return this.unavailable('prepareDeposit'); }
  async prepareWithdraw() { return this.unavailable('prepareWithdraw'); }
  async prepareStake() { return this.unavailable('prepareStake'); }
  async prepareUnstake() { return this.unavailable('prepareUnstake'); }
  async prepareClaim() { return this.unavailable('prepareClaim'); }
  async prepareCompound() { return this.unavailable('prepareCompound'); }
  async simulate() { return this.unavailable('simulate'); }
  async execute() { return this.unavailable('execute'); }
  async verify() { return this.unavailable('verify'); }
}

export class PoolAdapter extends FarmAdapter {}
export class LiquidityAdapter extends FarmAdapter {}
export class StakingAdapter extends FarmAdapter {}
export class VaultAdapter extends FarmAdapter {}
export class YieldAdapter extends FarmAdapter {}
export class RewardAdapter extends FarmAdapter {}

const finiteMetric = (value) => value != null && (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value));

/** Discovery-only adapter for the real filtered DefiLlama feed. */
export class DefiLlamaYieldAdapter extends YieldAdapter {
  constructor(pools = null) {
    super({ id: 'defillama', capabilities: ['getPools', 'getPool', 'getAPY', 'getAPR', 'getTVL', 'getHistory'] });
    this.pools = Array.isArray(pools) ? pools : null;
    this.snapshot = null;
    this.pending = null;
  }
  async getPools({ refresh = false, ...options } = {}) {
    const expired = this.snapshot && Date.now() - this.snapshot.at >= 60 * 60_000;
    if (this.pools && !refresh && !expired) return { status: 'AVAILABLE', data: this.pools, meta: this.snapshot };
    if (!this.pending) {
      this.pending = getYields(options).then((snapshot) => {
        this.snapshot = snapshot;
        this.pools = snapshot.pools;
        return { status: 'AVAILABLE', data: this.pools, meta: snapshot };
      }).catch(() => {
        this.pools = null;
        this.snapshot = null;
        return this.unavailable('getPools');
      }).finally(() => { this.pending = null; });
    }
    return this.pending;
  }
  async getPool(id) {
    const rows = await this.getPools();
    const data = rows.data?.find((pool) => pool.id === id) || null;
    return data ? { status: 'AVAILABLE', data, meta: rows.meta } : this.unavailable('getPool');
  }
  async getMetric(id, key) {
    const row = await this.getPool(id);
    return row.data ? { status: finiteMetric(row.data[key]) ? 'AVAILABLE' : 'UNAVAILABLE', value: finiteMetric(row.data[key]) ? Number(row.data[key]) : null, freshness: row.meta?.freshness || row.data.freshness || 'UNAVAILABLE' } : row;
  }
  async getAPY(id) { return this.getMetric(id, 'apy'); }
  async getAPR(id) { return this.getMetric(id, 'apr'); }
  async getTVL(id) { return this.getMetric(id, 'tvlUsd'); }
  async getHistory(id, options) {
    try { return { status: 'AVAILABLE', data: await getYieldHistory(id, options) }; }
    catch { return this.unavailable('getHistory'); }
  }
}

export class FbtFeeEngine {
  constructor({ platformFeeBps = FEE_BPS } = {}) {
    const bps = Number(platformFeeBps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 100) throw new Error('INVALID_FBT_FEE_BPS');
    this.platformFeeBps = bps;
  }

  quoteOperation({ amountUsd, protocolFeeUsd = null, gasUsd = null } = {}) {
    const amount = Number(amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) return { status: 'UNAVAILABLE', reason: 'INVALID_AMOUNT' };
    const fbtFeeUsd = amount * this.platformFeeBps / 10_000;
    const knownProtocol = finiteMetric(protocolFeeUsd) && Number(protocolFeeUsd) >= 0;
    const knownGas = (finiteMetric(gasUsd) && Number(gasUsd) >= 0);
    const totalCostUsd = knownProtocol && knownGas ? Number(protocolFeeUsd) + Number(gasUsd) + fbtFeeUsd : null;
    return {
      status: 'AVAILABLE', amountUsd: amount, protocolFeeUsd: knownProtocol ? Number(protocolFeeUsd) : null,
      gasUsd: knownGas ? Number(gasUsd) : null, fbtFeeBps: this.platformFeeBps,
      fbtFeeUsd, totalCostUsd
    };
  }

  recordFee(record = {}) {
    const required = ['requestId', 'intentId', 'executionId', 'transactionHash', 'walletAddress', 'protocol', 'network', 'operation', 'feeAmount', 'feeCurrency', 'status'];
    if (required.some((key) => record[key] == null || record[key] === '')) return { status: 'UNAVAILABLE', reason: 'INCOMPLETE_FEE_RECORD' };
    const safe = Object.fromEntries(required.map((key) => [key, record[key]]));
    safe.recordedAt = new Date().toISOString();
    if (typeof localStorage !== 'undefined') {
      const key = 'fbt:farm-fees:v1';
      let rows = [];
      try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch { rows = []; }
      rows.push(safe);
      localStorage.setItem(key, JSON.stringify(rows.slice(-250)));
    }
    emitFarmEvent('FBT_FEE_APPLIED', { executionId: safe.executionId, transactionHash: safe.transactionHash, feeAmount: safe.feeAmount, feeCurrency: safe.feeCurrency });
    return { status: 'RECORDED', record: safe };
  }

  estimateNetYield({ grossApy, protocolCostApy = null, gasUsd = null, amountUsd, operationsPerYear = 1 } = {}) {
    const gross = Number(grossApy);
    const amount = Number(amountUsd);
    if (!finiteMetric(grossApy) || !Number.isFinite(gross) || !Number.isFinite(amount) || amount <= 0) return { status: 'UNAVAILABLE' };
    const fbtFeeApy = (this.platformFeeBps / 100) * Math.max(1, Number(operationsPerYear) || 1);
    const gasApy = (finiteMetric(gasUsd) && Number(gasUsd) >= 0) ? (Number(gasUsd) * Math.max(1, Number(operationsPerYear) || 1) / amount) * 100 : null;
    const protocolApy = (finiteMetric(protocolCostApy) && Number(protocolCostApy) >= 0) ? Number(protocolCostApy) : null;
    const allKnown = gasApy != null && protocolApy != null;
    return {
      status: 'AVAILABLE', grossApy: gross, protocolCostApy: protocolApy,
      gasCostApy: gasApy, fbtFeeApy,
      netApy: allKnown ? Math.max(-100, gross - protocolApy - gasApy - fbtFeeApy) : null,
      complete: allKnown
    };
  }
}

export const fbtFeeEngine = new FbtFeeEngine();

export function metricFreshness(updatedAt, now = Date.now()) {
  if (updatedAt == null || updatedAt === '') return 'UNAVAILABLE';
  const at = new Date(updatedAt).getTime();
  if (!Number.isFinite(at) || at > now + 60_000) return 'UNAVAILABLE';
  return now - at <= 2 * 60 * 60 * 1000 ? 'FRESH' : 'STALE';
}

export function poolRiskFactors(pool) {
  const pair = pairTokens(pool);
  return {
    smartContract: 'unknown',
    protocol: pool?.risk || 'high',
    liquidity: Number(pool?.tvlUsd) >= 100_000_000 ? 'low' : 'medium',
    oracle: pool?.exposure === 'single' ? 'low' : 'unknown',
    impermanentLoss: pool?.ilRisk ? 'high' : 'low',
    rewardToken: realShare(pool) == null ? 'unknown' : realShare(pool) < 0.5 ? 'high' : 'medium',
    lock: 'unknown', bridge: 'unknown',
    concentration: pair.length > 1 ? 'medium' : 'low'
  };
}

/**
 * The data protocol the Farm screen uses for discovery and analysis.
 *
 * This is deliberately a READ-ONLY adapter. It streams the safety-filtered
 * DefiLlama pools and answers the metrics the Farm screen needs (APY, APR,
 * TVL, pool, pools). It does NOT claim to prepare, simulate or broadcast a
 * deposit — that requires a verified execution adapter, which is still a
 * separate contract and is reported honestly elsewhere.
 */
export const FARM_PROTOCOL = Object.freeze({
  id: 'defillama',
  name: 'DefiLlama',
  source: 'yields.llama.fi',
  mode: 'READ_ONLY_ANALYSIS',
  capabilities: Object.freeze(['getPools', 'getPool', 'getAPY', 'getAPR', 'getTVL', 'getHistory'])
});

export const LIDO_PROTOCOL = Object.freeze({
  id: 'lido',
  name: 'Lido',
  chainId: 1,
  chainName: 'Ethereum',
  contracts: Object.freeze({
    stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca',
    withdrawalQueue: '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B2c'
  }),
  mode: 'EXECUTABLE',
  capabilities: Object.freeze(['stake', 'wrap', 'unwrap', 'requestWithdraw', 'claim', 'getBalances', 'getWithdrawalRequests'])
});

export function isLidoPool(pool) {
  if (!pool) return false;
  const project = String(pool.project ?? '').toLowerCase();
  const chain = String(pool.chain ?? '').toLowerCase();
  const sym = String(pool.symbol ?? '').toUpperCase();
  return project === 'lido' && chain === 'ethereum' && (sym.includes('STETH') || sym.includes('WSTETH') || sym === 'STETH' || sym === 'WSTETH');
}

export function isLidoChain(chainId) {
  return Number(chainId) === LIDO_PROTOCOL.chainId;
}

/** A single source of truth for the Farm protocol status shown at the top. */
export function farmProtocolSummary({ pools = [], at = null, source = null, freshness = null, error = null } = {}) {
  const ok = !error && (at != null || (Array.isArray(pools) && pools.length > 0));
  return {
    ...FARM_PROTOCOL,
    status: error ? 'UNAVAILABLE' : ok ? (freshness === 'STALE' || metricFreshness(at) === 'STALE' ? 'STALE' : 'ACTIVE') : 'CONNECTING',
    poolCount: Array.isArray(pools) ? pools.length : 0,
    updatedAt: at,
    source: source || FARM_PROTOCOL.source,
    error: error ? String(error.message || error).slice(0, 120) : null
  };
}

/**
 * Research data for one pool.
 *
 * The Farm screen previously left this blank whenever it did not have a gas
 * or protocol quote for the execution path. That conflated two questions:
 * "can we analyse the position?" and "can we transact it?". The analytics path
 * needs only what the live yield feed already returned, so this returns the
 * research view without inventing a transaction quote.
 */
export function farmPoolResearch(pool) {
  const share = realShare(pool);
  return {
    adapter: FARM_PROTOCOL.id,
    apyBase: pool?.apyBase ?? null,
    apyReward: pool?.apyReward ?? null,
    realShare: share,
    emissionShare: share == null ? null : Math.max(0, 1 - share),
    apyMean30d: pool?.apyMean30d ?? null,
    unusual: rateIsUnusual(pool),
    risk: pool?.risk ?? null,
    ilRisk: Boolean(pool?.ilRisk),
    stablecoin: Boolean(pool?.stablecoin),
    type: pool?.exposure === 'single' ? 'staking' : 'lp',
    poolMeta: pool?.poolMeta ?? null,
    volumeUsd7d: pool?.volumeUsd7d ?? null,
    source: pool?.source || 'defillama',
    updatedAt: pool?.updatedAt || null,
    freshness: pool?.freshness || 'UNAVAILABLE',
    url: pool?.url || null
  };
}

export function normalizeFarmOpportunity(pool, metadata = {}) {
  const score = farmScore(pool);
  const route = investRoute(pool);
  return {
    ...pool,
    score,
    type: pool.exposure === 'single' ? 'staking' : 'lp',
    source: metadata.source || pool.source || 'defillama',
    updatedAt: metadata.updatedAt || pool.updatedAt || null,
    freshness: metadata.freshness === 'STALE' || pool.freshness === 'STALE' ? 'STALE' : metricFreshness(metadata.updatedAt || pool.updatedAt),
    riskFactors: poolRiskFactors(pool),
    actions: {
      view: 'AVAILABLE',
      getTokens: route ? 'AVAILABLE' : 'UNAVAILABLE',
      addLiquidity: 'UNAVAILABLE', removeLiquidity: 'UNAVAILABLE',
      stake: 'UNAVAILABLE', unstake: 'UNAVAILABLE', claim: 'UNAVAILABLE', compound: 'UNAVAILABLE'
    }
  };
}

export function buildYieldStrategies(pools, metadata = {}) {
  const rows = (Array.isArray(pools) ? pools : []).map((pool) => normalizeFarmOpportunity(pool, metadata));
  const pick = (filter, sorter) => rows.filter(filter).sort(sorter)[0] || null;
  const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1);
  const byApy = (a, b) => Number(b.apy || 0) - Number(a.apy || 0);
  return [
    ['stable', pick((p) => p.stablecoin, byScore)],
    ['balanced', pick((p) => p.risk === 'medium', byScore)],
    ['highYield', pick((p) => p.risk === 'high', byApy)],
    ['blueChip', pick((p) => Number(p.tvlUsd) >= 500_000_000, byScore)],
    ['lowGas', pick((p) => !['Ethereum'].includes(p.chain), byScore)],
    ['lp', pick((p) => p.type === 'lp', byScore)],
    ['staking', pick((p) => p.type === 'staking', byScore)],
    ['vault', pick((p) => VAULT_PROJECTS.includes(p.project), byScore)]
  ].filter(([, pool]) => pool).map(([category, pool]) => ({ category, pool }));
}
