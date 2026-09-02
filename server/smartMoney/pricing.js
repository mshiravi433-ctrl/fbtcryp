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

async function lookupTokenMarket(address, chain = null) {
  const res = await dexPairsForTokens([address]);
  const pairs = chain ? (res.pairs || []).filter((p) => p.chain === chain) : (res.pairs || []);
  if (res.dataStatus !== 'live' || !pairs.length) return { dataStatus: res.dataStatus || 'unavailable' };
  return marketFromPairs(pairs) || { dataStatus: 'no-pairs' };
}

export async function tokenMarket(tokenRef, { chain = null } = {}) {
  const address = String(tokenRef?.address || tokenRef || '').toLowerCase();
  if (!address || !(EVM_ADDR.test(address) || (chain === 'solana' && SOL_MINT.test(address)))) return null;
  const { value } = await withCache(pairKey(address, chain), TTL_PAIR, () => lookupTokenMarket(address, chain));
  return value?.dataStatus === 'live' ? value : null;
}

/**
 * Price MANY tokens in ONE DexScreener round-trip.
 *
 * WHY THIS EXISTS — the wallet page used to call `tokenMarket()` once per
 * holding, serially. A wallet with 25 ERC-20s therefore cost 25 upstream calls
 * of up to 9s each, which is longer than the client's own 30s budget: the
 * screen reported «بارگیری هوش کیف‌پول ممکن نشد» while the data was fine.
 * DexScreener's `/latest/dex/tokens/` endpoint accepts a comma-separated list
 * (30 per call), so the whole holdings table is one request.
 *
 * A pair only counts for the token it is the BASE of — the same token looked
 * up as a quote token can legitimately price differently, so those addresses
 * fall back to their own single lookup rather than being given a borrowed price.
 */
export async function tokenMarkets(refs, { chain = null } = {}) {
  const addrs = [...new Set((refs || [])
    .map((r) => String(r?.address || r || '').toLowerCase())
    .filter((a) => EVM_ADDR.test(a) || (chain === 'solana' && SOL_MINT.test(a))))];
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

  for (let i = 0; i < missing.length; i += 30) {
    const batch = missing.slice(i, i + 30);
    let res = { dataStatus: 'unavailable', pairs: [] };
    try {
      res = await dexPairsForTokens(batch);
    } catch { /* batch dead — the per-token fallback below still runs */ }
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
        continue;
      }
      /* Not a base token in this batch: ask for it directly, once. */
      // eslint-disable-next-line no-await-in-loop
      const single = await lookupTokenMarket(a, chain).catch(() => ({ dataStatus: 'unavailable' }));
      setCached(pairKey(a, chain), single, TTL_PAIR);
      if (single?.dataStatus === 'live') out.set(a, single);
    }
  }
  return out;
}

/* ── Historical prices (CoinGecko, majors) ─────────────────────────────── */

async function cgMarketChart(cgId, days) {
  const key = String(process.env.COINGECKO_API_KEY || '').trim();
  const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const headers = key ? { 'x-cg-pro-api-key': key } : {};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j?.prices) ? j.prices : null; // [[ts, price], ...]
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Daily price series for a cg id, cached 30 min (history barely moves).
 * Returns a function priceAt(epochMs) → number|null (nearest daily point).
 */
export async function historicalPriceFn(cgId, days = 90) {
  if (!cgId) return () => null;
  const { value } = await withCache(`sm:hist:${cgId}:${days}`, 30 * 60_000, () => cgMarketChart(cgId, days));
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

/** Sigmoid-ish normaliser used to map a USD P&L into a 0..1 factor. */
export function normByLog(value, scale) {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return null;
  const x = value / scale;
  return Math.max(0, Math.min(1, 0.5 + 0.5 * Math.tanh(x / 2)));
}
