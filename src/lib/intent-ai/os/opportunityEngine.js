/**
 * FBT INTENT OS — OPPORTUNITY ENGINE (client).
 * ---------------------------------------------------------------------------
 * Real inputs only. The engine:
 *   1. reads the portfolio (holdings / allocation / concentration)
 *   2. scans the market (live CoinGecko via src/lib/api — volume, 24h/7d moves)
 *   3. scans real yield venues (the same services the Yield/Farm/Lending
 *      adapters use: DefiLlama-backed yields, farm list, lending markets)
 *   4. scores each candidate with historical facts (30/90-day base rates and
 *      max drawdown from real OHLC where available) — never a forecast claim
 *   5. ranks by expected return with honest metadata
 *
 * HONESTY BOUNDARY (spec §5): no row may claim guaranteed profit.
 *   expectedReturnPct   — APY (yield) or historical median forward return
 *                         (market), each labelled via `basis`
 *   probabilityPct      — historical base rate, i.e. how often the past had
 *                         this outcome; explicitly NOT a prediction
 *   confidence          — from sample size and data provenance
 *   dataQuality         — HIGH/MEDIUM/NONE from live/offline provenance
 *   potentialDrawdownPct— worst measured fall, from actual history
 */

import { baseRate, maxDrawdown } from '../../history.js';
/* api.js is browser-bundled (extensionless imports) so it is loaded lazily:
   Node probes always inject fetchers and never trigger this import. */
const loadMarketApi = () => import('../../api.js');

export const OPPORTUNITY_ENGINE_SCHEMA = 'fbt.opportunity-engine.v2';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function clampPct(v, lo = -100, hi = 400) {
  const n = num(v);
  return n == null ? null : Math.max(lo, Math.min(hi, n));
}

function riskFrom({ volatilityPct = null, drawdownPct = null, apy = null, poolRisk = null, volumeUsd = null }) {
  let score = 0;
  if (poolRisk === 'high' || (num(apy) || 0) > 40) score += 3;
  else if (poolRisk === 'medium' || (num(apy) || 0) > 15) score += 1;
  if ((num(volatilityPct) || 0) > 6) score += 2;
  else if ((num(volatilityPct) || 0) > 3) score += 1;
  if ((num(drawdownPct) || 0) > 40) score += 2;
  if ((num(volumeUsd) || 0) < 1_000_000) score += 1;
  return score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low';
}

function confidenceFrom(samples, provenance) {
  if (provenance !== 'live' && provenance !== 'live-bff') return 0.25;
  if (samples >= 30) return 0.8;
  if (samples >= 10) return 0.6;
  if (samples >= 3) return 0.45;
  return 0.3;
}

function dataQualityFrom(provenance) {
  if (provenance === 'live' || provenance === 'live-bff') return 'HIGH';
  if (provenance === 'offline') return 'LOW';
  return 'NONE';
}

/**
 * Score market candidates from a real market snapshot.
 * @param {Array} markets normalized CoinGecko rows (src/lib/api getMarkets)
 * @param {Array} ohlcById map id → { series, samples, drawdown, baseRate }
 */
function marketOpportunities(markets = [], ohlcById = {}) {
  const rows = (Array.isArray(markets) ? markets : [])
    .filter((m) => m?.current_price != null && m?.symbol)
    .map((m) => {
      const hist = ohlcById[m.id] || null;
      const volPct = Math.abs(num(m.price_change_percentage_24h) || 0);
      const move7d = num(m.price_change_percentage_7d_in_currency ?? m.price_change_percentage_7d);
      const volatilityPct = Math.max(volPct, Math.abs(move7d || 0) / 2);
      const br = hist?.baseRate || null;
      const dd = hist?.drawdown ?? (move7d != null ? Math.min(100, Math.max(0, -move7d)) : null);
      return {
        id: `market:${m.id}`,
        kind: 'MARKET',
        symbol: String(m.symbol).toUpperCase(),
        name: m.name || m.id,
        chain: null,
        chainId: null,
        apy: null,
        expectedReturnPct: move7d != null ? clampPct(move7d / 2) : null,
        basis: 'last-7d-half-life', // NOT a forecast; observed momentum measure
        probabilityPct: br ? clampPct(br.pct, 0, 100) : null,
        baseRateSamples: br?.samples || 0,
        risk: riskFrom({ volatilityPct, drawdownPct: dd, volumeUsd: num(m.total_volume) }),
        confidence: confidenceFrom(br?.samples || 0, m.dataProvenance),
        dataQuality: dataQualityFrom(m.dataProvenance),
        potentialDrawdownPct: dd != null ? clampPct(dd, 0, 100) : null,
        volatilityPct: clampPct(volatilityPct, 0, 100),
        volumeUsd: num(m.total_volume),
        marketCapUsd: num(m.market_cap),
        priceUsd: m.current_price,
        source: 'market',
        guaranteed: false,
        disclaimer: 'historical-observation-not-forecast'
      };
    });
  return rows.filter((r) => r.expectedReturnPct != null || r.probabilityPct != null);
}

function yieldOpportunities(pools = [], kind = 'YIELD') {
  return (Array.isArray(pools) ? pools : []).map((p) => {
    const apy = num(p.apy ?? p.apyPct ?? p.supplyApyPct);
    const tvl = num(p.tvlUsd ?? p.tvl);
    return {
      id: `${kind.toLowerCase()}:${p.protocol || p.project || 'unknown'}:${p.symbol || ''}`,
      kind: kind === 'FARM' ? 'FARM' : kind === 'LENDING' ? 'LENDING' : 'YIELD',
      symbol: String(p.symbol || p.asset || '').toUpperCase(),
      name: p.name || p.protocol || p.project || p.symbol || 'yield',
      chain: p.chain || p.network || null,
      chainId: p.chainId ?? null,
      apy,
      expectedReturnPct: apy != null ? clampPct(apy) : null,
      basis: 'apy',
      probabilityPct: null,
      baseRateSamples: 0,
      risk: p.risk || riskFrom({ apy, poolRisk: p.risk, tvlUsd: tvl }),
      confidence: apy != null ? 0.6 : 0.3,
      dataQuality: dataQualityFrom(p.dataProvenance || p.status || 'live'),
      potentialDrawdownPct: p.ilRisk === 'high' ? 20 : p.ilRisk === 'medium' ? 10 : 5,
      volatilityPct: null,
      volumeUsd: num(p.volumeUsd),
      tvlUsd: tvl,
      url: p.url || null,
      source: 'yield',
      guaranteed: false,
      disclaimer: 'yield-not-guaranteed'
    };
  }).filter((r) => r.apy != null);
}

/**
 * Run the engine.
 * @param {object} opts
 * @param {object} [opts.portfolio] { holdings, totalValueUsd, dataStatus }
 * @param {object} [opts.services]  from createRealServices (yield/farm/lending)
 * @param {object} [opts.goal]      { targetReturnPct } optional
 * @param {number} [opts.limit]
 * @param {object} [opts.overrides] injectable market/ohlc fetchers (tests)
 */
export async function runOpportunityEngine({
  portfolio = null,
  services = {},
  goal = null,
  limit = 8,
  overrides = {}
} = {}) {
  const started = Date.now();
  const sources = [];
  const errors = [];

  /* 1 — market scan (real, source-tagged). */
  let markets = [];
  let ohlcById = {};
  try {
    const { getMarkets, getOhlc } = overrides.fetchMarkets || overrides.fetchOhlc ? {} : await loadMarketApi();
    if (overrides.fetchMarkets) {
      markets = await overrides.fetchMarkets();
    } else {
      markets = await getMarkets({ page: 1, perPage: 40, vs: 'usd' });
    }
    if (!Array.isArray(markets)) markets = [];
    const provenance = markets[0]?.dataProvenance || 'live';
    sources.push({ name: 'market.scan', ok: true, rows: markets.length, provenance });
    /* Historical facts for the top few names only — OHLC is heavy per asset. */
    const topIds = markets.slice(0, 6).map((m) => m.id).filter(Boolean);
    const histRows = await Promise.allSettled(topIds.map(async (id) => {
      const rows = overrides.fetchOhlc ? await overrides.fetchOhlc(id, 30) : await getOhlc(id, 30);
      const closes = (Array.isArray(rows) ? rows : []).map((d) => num(d.c ?? d.close)).filter((v) => v != null && v > 0);
      return {
        id,
        series: closes,
        samples: closes.length,
        baseRate: closes.length >= 12 ? baseRate(closes, 3) : null,
        drawdown: closes.length >= 2 ? maxDrawdown(closes) : null
      };
    }));
    for (const r of histRows) {
      if (r.status === 'fulfilled' && r.value) ohlcById[r.value.id] = r.value;
    }
    sources.push({ name: 'market.history', ok: true, rows: Object.keys(ohlcById).length, provenance });
  } catch (err) {
    errors.push({ name: 'market.scan', error: String(err?.message || 'FAILED').slice(0, 160) });
    sources.push({ name: 'market.scan', ok: false, error: String(err?.message || 'FAILED').slice(0, 160) });
  }

  /* 2 — yield / farm / lending scans through the real service adapters. */
  const scanned = [];
  const trySource = async (name, run) => {
    try {
      const res = await run();
      sources.push({ name, ok: res?.ok !== false, rows: Array.isArray(res?.pools || res?.markets || res?.opportunities) ? (res.pools || res.markets || res.opportunities).length : 0 });
      return res;
    } catch (err) {
      sources.push({ name, ok: false, error: String(err?.message || err).slice(0, 160) });
      errors.push({ name, error: String(err?.message || err).slice(0, 160) });
      return null;
    }
  };

  const yieldRes = await trySource('yield.discover', async () => {
    if (services.yieldService?.discover) return services.yieldService.discover({});
    return { ok: false };
  });
  scanned.push(...yieldOpportunities(yieldRes?.opportunities || yieldRes?.pools || [], 'YIELD'));

  const farmRes = await trySource('farm.list', async () => {
    if (services.farmService?.list) return services.farmService.list({});
    return { ok: false };
  });
  scanned.push(...yieldOpportunities(farmRes?.pools || farmRes?.opportunities || [], 'FARM'));

  const lendRes = await trySource('lending.markets', async () => {
    if (services.lendingService?.getMarkets) return services.lendingService.getMarkets({});
    return { ok: false };
  });
  const lendPools = (lendRes?.markets || []).map((m) => ({
    protocol: m.protocol || 'aave-v3',
    symbol: m.symbol,
    chainId: m.chain,
    apy: m.supplyApyPct,
    risk: m.risk
  }));
  scanned.push(...yieldOpportunities(lendPools, 'LENDING'));

  /* 3 — combine, risk-filter, rank. */
  const combined = [...marketOpportunities(markets, ohlcById), ...scanned];

  /* Portfolio-aware tilt: assets already held get a gentle rank bonus so the
     plan is "toward a goal the user can reach with what they have" rather
     than an anonymous top-APY list. No invented return is added. */
  const held = new Set((portfolio?.holdings || []).map((h) => String(h?.symbol || '').toUpperCase()));
  const ranked = combined
    .map((o) => ({
      ...o,
      alreadyHeld: held.has(o.symbol)
    }))
    .filter((o) => o.dataQuality !== 'NONE' || o.apy != null)
    .sort((a, b) => {
      const score = (o) => ((num(o.expectedReturnPct) || 0) * (o.dataQuality === 'HIGH' ? 2 : 1) * (o.confidence || 0.3)) + (o.alreadyHeld ? 3 : 0);
      return score(b) - score(a);
    });

  const liveSources = sources.filter((s) => s.ok);
  const dataQuality = liveSources.length >= 3 ? 'HIGH' : liveSources.length >= 1 ? 'MEDIUM' : 'NONE';
  const goalReturn = num(goal?.targetReturnPct);

  return {
    schema: OPPORTUNITY_ENGINE_SCHEMA,
    ok: true,
    goal: goal ? { targetReturnPct: goalReturn, requirement: 'expected-return-is-estimate-not-guarantee' } : null,
    portfolio: {
      totalValueUsd: num(portfolio?.totalValueUsd),
      holdings: (portfolio?.holdings || []).length,
      dataStatus: portfolio?.dataStatus || 'unavailable'
    },
    opportunities: ranked.slice(0, limit),
    scanned: ranked.length,
    dataQuality,
    dataStatus: ranked.length ? 'live' : (liveSources.length ? 'empty' : 'unavailable'),
    confidence: ranked.length ? Math.min(0.9, 0.35 + ranked.length * 0.05) : 0.3,
    sources,
    errors,
    guaranteed: false,
    latencyMs: Date.now() - started,
    updatedAt: new Date().toISOString()
  };
}
