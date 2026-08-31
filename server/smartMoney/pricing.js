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

import { withCache } from '../cache.js';
import { dexPairsForTokens } from './dataSources.js';

const TTL_PAIR = 120_000;

/** Deepest pair for a token = best price + liquidity reference. */
export async function tokenMarket(tokenRef) {
  const address = String(tokenRef?.address || tokenRef || '').toLowerCase();
  if (!address || !/^0x[a-f0-9]{40}$/.test(address)) return null;
  const { value } = await withCache(`sm:pair:${address}`, TTL_PAIR, async () => {
    const res = await dexPairsForTokens([address]);
    if (res.dataStatus !== 'live' || !res.pairs.length) return { dataStatus: res.dataStatus || 'unavailable' };
    const liq = res.pairs.slice().sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
    const best = liq[0];
    const totalLiquidity = liq.reduce((s, p) => s + (p.liquidityUsd || 0), 0);
    const volumeH24 = liq.reduce((s, p) => s + (p.volume?.h24 || 0), 0);
    return {
      dataStatus: 'live',
      priceUsd: best.priceUsd,
      liquidityUsd: totalLiquidity,
      deepestDex: best.dexId,
      volumeH24,
      symbol: best.baseToken?.symbol || null,
      ageMs: best.ageMs,
      pairCreatedAt: best.pairCreatedAt,
      markets: liq.length
    };
  });
  return value?.dataStatus === 'live' ? value : null;
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
