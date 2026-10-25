/**
 * SMART MONEY — PRICING HELPERS
 * ---------------------------------------------------------------------------
 * Two pricing needs, two real sources, both cached:
 *
 *   · CURRENT price/liquidity for ANY traded token — DexScreener pairs. This
 *     prices the long tail of tokens that CoinGecko has never listed. We take
 *     the deepest pair and its real on-chain liquidity.
 *   · HISTORICAL daily prices for P&L — CoinGecko market_chart, which keys
 *     off the curated coingeckoId in chainsLite (majors only). Tokens without
 *     a cg id simply have no tx-time USD cost; P&L reports reduced coverage
 *     rather than inventing one.
 */

import { withCache, getCached, setCached } from '../cache.js';
import { dexPairsForTokens } from './dataSources.js';

const TTL_PAIR = 120_000;
const EVM_ADDR = /^0x[a-f0-9]{40}$/;
const SOL_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/* One cache entry per (chain, token): the same address on two chains is two
   different pools, and a shared key would let one price the other. */
const pairKey = (address, chain = null) => `sm:pair:${chain || 'any'}:${address}`;

/** Aggregate one token's pairs into the market picture the pages use. */
function marketFromPairs(pairs) {
  if (!pairs.length) return null;
  const liq = pairs.slice().sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  const best = liq[0];
  return {
    dataStatus: 'live',
    priceUsd: best.priceUsd,
    liquidityUsd: liq.reduce((s, p) => s + (p.liquidityUsd || 0), 0),
    deepestDex: best.dexId,
    volumeH24: liq.reduce((s, p) => s + (p.volume?.h24 || 0), 0),
    symbol: best.baseToken?.symbol || null,
    ageMs: best.ageMs,
    pairCreatedAt: best.pairCreatedAt,
    markets: liq.length
  };
}

async function lookupTokenMarket(address, chain = null, timeoutMs = 9_000) {
  const res = await dexPairsForTokens([address], { timeoutMs });
  const pairs = chain ? (res.pairs || []).filter((p) => p.chain === chain) : (res.pairs || []);
  if (res.dataStatus !== 'live' || !pairs.length) return { dataStatus: res.dataStatus || 'unavailable' };
  return marketFromPairs(pairs) || { dataStatus: 'no-pairs' };
}

export async function tokenMarket(tokenRef, { chain = null, timeoutMs = 9_000 } = {}) {
  const rawAddress = String(tokenRef?.address || tokenRef || '').trim();
  const address = chain === 'solana' ? rawAddress : rawAddress.toLowerCase();
  if (!address || !(EVM_ADDR.test(address) || (chain === 'solana' && SOL_MINT.test(address)))) return null;
  let value;
  try {
    ({ value } = await withCache(pairKey(address, chain), TTL_PAIR, async () => {
      const market = await lookupTokenMarket(address, chain, timeoutMs);
      if (market?.dataStatus === 'unavailable') throw new Error('TOKEN_MARKET_UNAVAILABLE');
      return market;
    }));
  } catch { return null; }
  return value?.dataStatus === 'live' ? value : null;
}

/**
 * Price a bounded token set inside one shared deadline. DexScreener accepts up
 * to 30 addresses per request; quote-token fallbacks are parallel and capped
 * rather than serially spending up to nine seconds on every holding.
 */
export async function tokenMarkets(refs, { chain = null, timeoutMs = 9_000, maxFallbacks = 6 } = {}) {
  const budgetMs = Math.max(250, Math.min(14_000, Number(timeoutMs) || 9_000));
  const deadlineAt = Date.now() + budgetMs;
  const addrs = [...new Set((refs || [])
    .map((r) => String(r?.address || r || '').trim())
    .map((a) => (chain === 'solana' ? a : a.toLowerCase()))
    .filter((a) => EVM_ADDR.test(a) || (chain === 'solana' && SOL_MINT.test(a))) )];
  const out = new Map();
  if (!addrs.length) return out;

  const missing = [];
  for (const a of addrs) {
    const hit = getCached(pairKey(a, chain));
    if (hit && !hit.stale) {
      if (hit.value?.dataStatus === 'live') out.set(a, hit.value);
      continue;
    }
    missing.push(a);
  }

  const fallbackCandidates = [];
  for (let i = 0; i < missing.length; i += 30) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs < 250) break;
    const batch = missing.slice(i, i + 30);
    let res = { dataStatus: 'unavailable', pairs: [] };
    try {
      res = await dexPairsForTokens(batch, { timeoutMs: remainingMs });
    } catch { /* no price from this batch; do not fan out more requests */ }
    const byBase = new Map();
    for (const p of res.pairs || []) {
      const base = p?.baseToken?.address;
      if (!base) continue;
      if (chain && p.chain !== chain) continue;
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(p);
    }
    for (const a of batch) {
      const market = byBase.get(a) ? marketFromPairs(byBase.get(a)) : null;
      if (market) {
        out.set(a, market);
        setCached(pairKey(a, chain), market, TTL_PAIR);
      } else if (res.dataStatus === 'live') {
        /* Some registries only return a pair when the requested token is the
           quote side. Retain that fallback, but never serialise one call per
           holding or let it outlive this wallet read's deadline. */
        fallbackCandidates.push(a);
      }
    }
  }

  const fallbackBudgetMs = deadlineAt - Date.now();
  const fallbackLimit = Math.max(0, Math.min(12, Number(maxFallbacks) || 0, fallbackCandidates.length));
  if (fallbackBudgetMs >= 250 && fallbackLimit) {
    await Promise.all(fallbackCandidates.slice(0, fallbackLimit).map(async (address) => {
      try {
        const single = await lookupTokenMarket(address, chain, fallbackBudgetMs);
        if (single?.dataStatus === 'live' || single?.dataStatus === 'no-pairs') {
          setCached(pairKey(address, chain), single, TTL_PAIR);
        }
        if (single?.dataStatus === 'live') out.set(address, single);
      } catch {
        /* One unpriceable holding does not block the rest of the wallet. */
      }
    }));
  }
  return out;
}

/* ── Historical prices (CoinGecko, majors) ─────────────────────────────── */

async function cgMarketChart(cgId, days, timeoutMs = 9_000) {
  const key = String(process.env.COINGECKO_API_KEY || '').trim();
  const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const headers = key ? { 'x-cg-pro-api-key': key } : {};
  const ctrl = new AbortController();
  const boundedTimeout = Math.max(250, Math.min(14_000, Number(timeoutMs) || 9_000));
  const t = setTimeout(() => ctrl.abort(), boundedTimeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`CoinGecko market chart ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.prices) ? j.prices : []; // [[ts, price], ...]
  } finally {
    clearTimeout(t);
  }
}

/**
 * Daily price series for a cg id, cached 30 min (history barely moves).
 * Returns a function priceAt(epochMs) → number|null (nearest daily point).
 */
export async function historicalPriceFn(cgId, days = 90, { timeoutMs = 9_000 } = {}) {
  if (!cgId) return () => null;
  let value;
  try {
    ({ value } = await withCache(`sm:hist:${cgId}:${days}`, 30 * 60_000, () => cgMarketChart(cgId, days, timeoutMs)));
  } catch { return () => null; }
  if (!Array.isArray(value) || !value.length) return () => null;
  const series = value
    .map(([ts, p]) => ({ ts: Number(ts), p: Number(p) }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.p) && r.p > 0)
    .sort((a, b) => a.ts - b.ts);
  if (!series.length) return () => null;
  return (ts) => {
    const target = Number(ts);
    if (!Number.isFinite(target)) return null;
    let best = series[0];
    let bestD = Math.abs(best.ts - target);
    for (const row of series) {
      const d = Math.abs(row.ts - target);
      if (d < bestD) { best = row; bestD = d; }
    }
    // Don't claim a price for a time farther than 3 days from any daily point.
    return bestD <= 3 * 86_400_000 ? best.p : null;
  };
}

/* ── Timestamped intraday prices for native-quote EVM swaps (phase 3) ─────
 * A daily close can be many percent away from the price at the minute a
 * WETH/WBNB quote leg moved. Native-quote rows may therefore only use a
 * timestamped intraday point: the median spacing of the whole returned
 * series must be hourly-or-finer (75 minutes allows timestamp jitter), and
 * the nearest actual point for an individual swap must be within one hour.
 * We inspect the spacing CoinGecko returned instead of trusting an
 * `interval` label or plan tier. */

export const MAX_NATIVE_QUOTE_PRICE_DISTANCE_MS = 3_600_000;
const MAX_NATIVE_QUOTE_SERIES_GAP_MS = 75 * 60_000;

function normalizePriceSeries(seriesInput) {
  return (Array.isArray(seriesInput) ? seriesInput : [])
    .map((row) => Array.isArray(row)
      ? { ts: Number(row[0]), p: Number(row[1]) }
      : { ts: Number(row?.ts ?? row?.timestamp ?? row?.at), p: Number(row?.p ?? row?.usd ?? row?.priceUsd ?? row?.price) })
    .filter((r) => Number.isFinite(r.ts) && r.ts > 0 && Number.isFinite(r.p) && r.p > 0)
    .sort((a, b) => a.ts - b.ts)
    .filter((r, i, rows) => i === 0 || r.ts !== rows[i - 1].ts);
}

/** Pure lookup used by the range endpoint below and directly by probes. */
export function intradayPriceLookup(seriesInput, {
  maxGapMs = MAX_NATIVE_QUOTE_SERIES_GAP_MS,
  maxDistanceMs = MAX_NATIVE_QUOTE_PRICE_DISTANCE_MS,
  source = 'timestamped-intraday-series'
} = {}) {
  const series = normalizePriceSeries(seriesInput);
  if (series.length < 2) return () => null;
  const gaps = [];
  for (let i = 1; i < series.length; i++) gaps.push(series[i].ts - series[i - 1].ts);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] || Infinity;
  if (!Number.isFinite(medianGap) || medianGap > maxGapMs) return () => null;
  const granularity = medianGap <= 10 * 60_000 ? '5m' : 'hourly';
  return (ts) => {
    const target = Number(ts);
    if (!Number.isFinite(target) || target <= 0) return null;
    let lo = 0;
    let hi = series.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (series[mid].ts < target) lo = mid + 1; else hi = mid;
    }
    const candidates = [series[lo - 1], series[lo]].filter(Boolean);
    if (!candidates.length) return null;
    candidates.sort((a, b) => Math.abs(a.ts - target) - Math.abs(b.ts - target));
    const best = candidates[0];
    const distanceMs = Math.abs(best.ts - target);
    if (distanceMs > maxDistanceMs) return null;
    return { usd: best.p, at: best.ts, granularity, source, distanceMs };
  };
}

async function cgMarketChartRange(cgId, fromTs, toTs, timeoutMs = 9_000) {
  const key = String(process.env.COINGECKO_API_KEY || '').trim();
  const from = Math.floor(Number(fromTs) / 1000);
  const to = Math.ceil(Number(toTs) / 1000);
  // No explicit interval: auto-granularity is hourly (or finer) for ranges up
  // to 90 days, while an explicitly gated interval can fail by plan. The
  // returned spacing is still verified by intradayPriceLookup above.
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
  const headers = key ? { 'x-cg-pro-api-key': key } : {};
  const ctrl = new AbortController();
  const boundedTimeout = Math.max(250, Math.min(14_000, Number(timeoutMs) || 9_000));
  const t = setTimeout(() => ctrl.abort(), boundedTimeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`CoinGecko market chart range ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.prices) ? j.prices : [];
  } finally {
    clearTimeout(t);
  }
}

/** Hourly-or-finer historical price lookup. Returns rich provenance or null;
 * deliberately never degrades to the daily historicalPriceFn above. */
export async function historicalHourlyPriceFn(cgId, { fromTs, toTs, timeoutMs = 9_000 } = {}) {
  const from = Number(fromTs);
  const to = Number(toTs);
  if (!cgId || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return () => null;
  // Above this range CoinGecko's auto-granularity becomes daily. Chunking
  // years of hourly points inside one wallet read would be slow and is not
  // needed for the explorer page this feature values; fail unpriced instead.
  if (to - from > 90 * 86_400_000) return () => null;
  const hour = 3_600_000;
  const cacheFrom = Math.floor(from / hour);
  const cacheTo = Math.ceil(to / hour);
  let value;
  try {
    // Fetch the rounded bounds named by the cache key; otherwise a later
    // request could inherit a narrower series that happens to share the key.
    ({ value } = await withCache(`sm:hist-range:${cgId}:${cacheFrom}:${cacheTo}`, 30 * 60_000,
      () => cgMarketChartRange(cgId, cacheFrom * hour, cacheTo * hour, timeoutMs)));
  } catch { return () => null; }
  return intradayPriceLookup(value, { source: 'coingecko-market-chart-range' });
}

/** Sigmoid-ish normaliser used to map a USD P&L into a 0..1 factor. */
export function normByLog(value, scale) {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return null;
  const x = value / scale;
  return Math.max(0, Math.min(1, 0.5 + 0.5 * Math.tanh(x / 2)));
}
