import { describe, expect, it } from 'vitest';
import {
  AUTOCOMPOUND_PROJECTS, FARM_EXECUTION_STATES, FbtFeeEngine, FarmAdapter, VAULT_PROJECTS,
  buildYieldStrategies, farmPoolResearch, metricFreshness, normalizeFarmOpportunity
} from '../src/lib/farmDeFi';

const pool = {
  id: 'pool-1', symbol: 'USDC-USDT', project: 'uniswap-v3', chain: 'Base',
  apy: 10, apyBase: 8, apyReward: 2, apr: 8, rewardApr: 2,
  tvlUsd: 500_000_000, stablecoin: true, ilRisk: true, exposure: 'multi'
};

const single = {
  id: 'pool-2', symbol: 'USDC', project: 'aave-v3', chain: 'Ethereum',
  apy: 5, apyBase: 5, apyReward: 0, apr: 5, rewardApr: 0,
  tvlUsd: 500_000_000, stablecoin: true, ilRisk: false, exposure: 'single'
};

describe('farm DeFi architecture', () => {
  it('calculates operation and net-yield economics from inputs', () => {
    const engine = new FbtFeeEngine({ platformFeeBps: 30 });
    expect(engine.quoteOperation({ amountUsd: 1000, protocolFeeUsd: 2, gasUsd: 3 })).toMatchObject({
      fbtFeeUsd: 3, totalCostUsd: 8
    });
    expect(engine.estimateNetYield({ grossApy: 20, protocolCostApy: 1.8, gasUsd: 2, amountUsd: 1000 })).toMatchObject({
      fbtFeeApy: 0.3, gasCostApy: 0.2, netApy: 17.7, complete: true
    });
  });

  it('refuses unsupported adapter execution', async () => {
    const adapter = new FarmAdapter({ id: 'read-only' });
    await expect(adapter.prepareDeposit()).resolves.toMatchObject({ status: 'UNAVAILABLE' });
    await expect(adapter.execute()).resolves.toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('normalizes risk, freshness and honest action availability', () => {
    const row = normalizeFarmOpportunity(pool, { source: 'defillama', updatedAt: new Date().toISOString() });
    expect(row.freshness).toBe('FRESH');
    expect(row.actions.addLiquidity).toBe('UNAVAILABLE');
    expect(row.actions.view).toBe('AVAILABLE');
    expect(row.score).toBeTypeOf('number');
    expect(metricFreshness(Date.now() - 3 * 60 * 60 * 1000)).toBe('STALE');
  });

  it('builds strategy categories from live rows without inventing products', () => {
    const strategies = buildYieldStrategies([pool]);
    expect(strategies.length).toBeGreaterThan(0);
    expect(strategies.every((row) => row.pool.id === pool.id)).toBe(true);
  });

  it('keeps the full execution lifecycle ordered', () => {
    expect(FARM_EXECUTION_STATES[0]).toBe('IDLE');
    expect(FARM_EXECUTION_STATES.at(-1)).toBe('COMPLETED');
    expect(FARM_EXECUTION_STATES.indexOf('SIMULATING')).toBeLessThan(FARM_EXECUTION_STATES.indexOf('AWAITING_SIGNATURE'));
  });

  it('offers the invest path for single-asset pools, not just pairs', () => {
    const row = normalizeFarmOpportunity(single, { source: 'defillama', updatedAt: new Date().toISOString() });
    expect(row.type).toBe('staking');
    expect(row.actions.getTokens).toBe('AVAILABLE');
    expect(row.actions.addLiquidity).toBe('UNAVAILABLE');
  });

  it('keeps a pair with an unlisted leg honestly unavailable', () => {
    // Base lists USDC but no USDT, so USDC-USDT cannot prefill a swap.
    const row = normalizeFarmOpportunity(pool, { source: 'defillama', updatedAt: new Date().toISOString() });
    expect(row.type).toBe('lp');
    expect(row.actions.getTokens).toBe('UNAVAILABLE');
  });

  it('maps the vault and auto-compound filters to real allow-list projects', () => {
    expect(VAULT_PROJECTS).toContain('yearn-finance');
    expect(VAULT_PROJECTS).toContain('beefy');
    expect(AUTOCOMPOUND_PROJECTS).toContain('lido');
    expect(AUTOCOMPOUND_PROJECTS).toContain('jupiter-staked-sol');
    const strategies = buildYieldStrategies([
      { ...single, project: 'beefy' },
      { ...single, id: 'pool-3', project: 'lido' }
    ]);
    expect(strategies.some((row) => row.category === 'vault')).toBe(true);
    expect(strategies.some((row) => row.category === 'staking')).toBe(true);
  });

  it('passes pool detail and 7d volume through to the analytics view', () => {
    const research = farmPoolResearch({ ...single, poolMeta: '0.05% fee tier', volumeUsd7d: 42 });
    expect(research.poolMeta).toBe('0.05% fee tier');
    expect(research.volumeUsd7d).toBe(42);
    const missing = farmPoolResearch(single);
    expect(missing.poolMeta).toBeNull();
    expect(missing.volumeUsd7d).toBeNull();
  });
});
