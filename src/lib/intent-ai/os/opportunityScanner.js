/**
 * OpportunityScanner — live yield / lending / farm scan.
 * Never claims guaranteed profit. Missing data is unavailable, not $0.
 */

import { tokenKey } from './tokenResolver.js';

export const OPPORTUNITY_SCANNER_SCHEMA = 'fbt.opportunity-scanner.v1';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function riskOf(pool) {
  const tvl = num(pool.tvlUsd);
  const apy = num(pool.apy);
  if (apy != null && apy > 40) return 'high';
  if (tvl != null && tvl < 1_000_000) return 'high';
  if (apy != null && apy > 15) return 'medium';
  return pool.risk || 'medium';
}

function mapPool(pool, kind = 'yield') {
  const apy = num(pool.apy ?? pool.apyPct ?? pool.supplyApyPct);
  return {
    id: pool.pool || pool.id || `${kind}:${pool.protocol || pool.project || 'unknown'}:${pool.symbol || ''}`,
    kind,
    protocol: pool.project || pool.protocol || pool.symbol || 'unknown',
    symbol: pool.symbol || pool.asset || null,
    chain: pool.chain || pool.network || null,
    chainId: pool.chainId ?? null,
    apy,
    tvlUsd: num(pool.tvlUsd ?? pool.tvl),
    risk: riskOf(pool),
    ilRisk: pool.ilRisk || (pool.exposure === 'multi' ? 'medium' : 'low'),
    url: pool.url || null,
    tokenKey: tokenKey({ chainId: pool.chainId, symbol: pool.symbol, address: pool.pool }),
    estimated: true,
    guaranteed: false
  };
}

export async function scanOpportunities({
  services = {},
  portfolio = null,
  riskTolerance = 'medium',
  asset = null,
  limit = 5
} = {}) {
  const started = Date.now();
  const sources = [];
  const found = [];
  const errors = [];

  const trySource = async (name, run) => {
    try {
      const res = await run();
      sources.push({ name, ok: res?.ok !== false, freshness: res?.dataStatus || 'live', at: Date.now() });
      return res;
    } catch (err) {
      sources.push({ name, ok: false, error: String(err?.message || err).slice(0, 160), at: Date.now() });
      errors.push({ name, error: String(err?.message || err).slice(0, 160) });
      return null;
    }
  };

  const yieldRes = await trySource('yield.discover', async () => {
    if (services.yieldService?.discover) return services.yieldService.discover({ asset, riskTolerance });
    return { ok: false, reason: 'NO_YIELD_SERVICE' };
  });
  const pools = yieldRes?.opportunities || yieldRes?.pools || [];
  if (Array.isArray(pools)) {
    for (const pool of pools) found.push(mapPool(pool, pool.exposure === 'multi' ? 'lp' : 'yield'));
  }

  const farmRes = await trySource('farm.list', async () => {
    if (services.farmService?.list) return services.farmService.list({});
    return { ok: false, reason: 'NO_FARM_SERVICE' };
  });
  const farmPools = farmRes?.pools || farmRes?.opportunities || [];
  if (Array.isArray(farmPools)) {
    for (const pool of farmPools) found.push(mapPool(pool, 'farm'));
  }

  const lendRes = await trySource('lending.markets', async () => {
    if (services.lendingService?.getMarkets) return services.lendingService.getMarkets({ asset });
    return { ok: false, reason: 'NO_LENDING_SERVICE' };
  });
  const markets = lendRes?.markets || [];
  if (Array.isArray(markets)) {
    for (const m of markets) {
      found.push(mapPool({
        protocol: m.protocol || 'aave-v3',
        symbol: m.symbol,
        chainId: m.chain,
        apy: m.supplyApyPct,
        risk: m.risk,
        tvlUsd: null
      }, 'lending'));
    }
  }

  const want = asset ? String(asset).toUpperCase() : null;
  let ranked = found.filter((o) => o.apy != null);
  if (want) ranked = ranked.filter((o) => String(o.symbol || '').toUpperCase().includes(want));
  if (riskTolerance === 'low') ranked = ranked.filter((o) => o.risk !== 'high');
  ranked.sort((a, b) => (b.apy || 0) - (a.apy || 0));

  const liveSources = sources.filter((s) => s.ok);
  const dataQuality = liveSources.length >= 2 ? 'HIGH' : liveSources.length === 1 ? 'MEDIUM' : 'NONE';
  const dataStatus = ranked.length ? 'live' : (liveSources.length ? 'empty' : 'unavailable');

  return {
    schema: OPPORTUNITY_SCANNER_SCHEMA,
    ok: true,
    opportunities: ranked.slice(0, limit),
    scanned: found.length,
    dataFreshness: liveSources.length ? 'FRESH' : 'NONE',
    dataStatus,
    dataQuality,
    confidence: ranked.length ? Math.min(0.9, 0.4 + ranked.length * 0.1) : (liveSources.length ? 0.5 : 0),
    sources,
    errors,
    portfolioHint: portfolio?.totalValueUsd ?? null,
    guaranteed: false,
    latencyMs: Date.now() - started,
    updatedAt: new Date().toISOString()
  };
}
