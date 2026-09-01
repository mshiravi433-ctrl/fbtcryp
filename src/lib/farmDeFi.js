import { FEE_BPS } from './feeBps';
import { farmScore, pairSwapRoute, pairTokens, realShare } from './yields';

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

/** Discovery-only adapter for the real filtered DefiLlama feed. */
export class DefiLlamaYieldAdapter extends YieldAdapter {
  constructor(pools = []) {
    super({ id: 'defillama', capabilities: ['getPools', 'getPool', 'getAPY', 'getAPR', 'getTVL'] });
    this.pools = Array.isArray(pools) ? pools : [];
  }
  async getPools() { return { status: 'AVAILABLE', data: this.pools }; }
  async getPool(id) {
    const data = this.pools.find((pool) => pool.id === id) || null;
    return data ? { status: 'AVAILABLE', data } : this.unavailable('getPool');
  }
  async getAPY(id) { const row = await this.getPool(id); return row.data ? { status: 'AVAILABLE', value: row.data.apy } : row; }
  async getAPR(id) { const row = await this.getPool(id); return row.data ? { status: row.data.apr == null ? 'UNAVAILABLE' : 'AVAILABLE', value: row.data.apr ?? null } : row; }
  async getTVL(id) { const row = await this.getPool(id); return row.data ? { status: 'AVAILABLE', value: row.data.tvlUsd } : row; }
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
    const knownProtocol = Number.isFinite(Number(protocolFeeUsd));
    const knownGas = Number.isFinite(Number(gasUsd));
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
    if (!Number.isFinite(gross) || !Number.isFinite(amount) || amount <= 0) return { status: 'UNAVAILABLE' };
    const fbtFeeApy = (this.platformFeeBps / 100) * Math.max(1, Number(operationsPerYear) || 1);
    const gasApy = Number.isFinite(Number(gasUsd)) ? (Number(gasUsd) * Math.max(1, Number(operationsPerYear) || 1) / amount) * 100 : null;
    const protocolApy = Number.isFinite(Number(protocolCostApy)) ? Number(protocolCostApy) : null;
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
  const at = new Date(updatedAt).getTime();
  if (!Number.isFinite(at)) return 'UNAVAILABLE';
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

export function normalizeFarmOpportunity(pool, metadata = {}) {
  const score = farmScore(pool);
  const route = pairSwapRoute(pool);
  return {
    ...pool,
    score,
    type: pool.exposure === 'single' ? 'staking' : 'lp',
    source: metadata.source || pool.source || 'defillama',
    updatedAt: metadata.updatedAt || pool.updatedAt || null,
    freshness: metricFreshness(metadata.updatedAt || pool.updatedAt),
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
    ['lp', pick((p) => p.type === 'lp', byScore)]
  ].filter(([, pool]) => pool).map(([category, pool]) => ({ category, pool }));
}
