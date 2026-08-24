/**
 * YIELD DATA — client side.
 * ---------------------------------------------------------------------------
 * Thin. All the filtering happens in `server/yields.js`, because the upstream
 * response is 20,000+ pools and several megabytes and must never reach a
 * phone. This module fetches our filtered slice, degrades honestly when the
 * backend is unreachable, and holds the maths the UI needs.
 *
 * ─── WHY THERE IS NO OFFLINE FALLBACK LIST ──────────────────────────────────
 * Every other data module in this app falls back to a bundled snapshot so the
 * UI is never blank. This one deliberately does not.
 *
 * A stale price is a small lie that corrects itself on the next refresh. A
 * stale APY is a different thing: yields move on the scale of days, a pool can
 * be paused or drained, and someone deciding where to put money based on a
 * number baked into an APK three months ago is exactly the harm this screen
 * exists to prevent. When we cannot fetch live rates, the correct output is
 * "we cannot show you rates right now", not a plausible-looking table.
 */

import { TOKENS } from './chains';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/** Risk bands, ordered least to most. Exported so the filter UI cannot drift. */
export const RISK_BANDS = ['low', 'medium', 'high'];

/**
 * How much of the headline yield is real revenue rather than token emissions.
 *
 * ─── WHY THIS IS THE MOST IMPORTANT NUMBER ON THE SCREEN ────────────────────
 * `apyBase` is interest actually paid by borrowers and fees actually paid by
 * traders. `apyReward` is governance tokens minted and handed out. The second
 * kind stops the day the incentive programme ends, and those tokens are
 * usually falling in price the entire time they are being earned.
 *
 * Every yield aggregator shows the combined number and buries the split. A
 * "24% APY" that is 22% emissions is a countdown, not an income, and the user
 * has no way to tell the two apart from the headline.
 *
 * Returns null rather than a guess when the feed did not break the yield down
 * — an unknown split must not be rendered as "100% real".
 */
export function realShare(pool) {
  if (!pool) return null;
  const apy = Number(pool.apy);
  const base = Number(pool.apyBase);
  if (!Number.isFinite(apy) || apy <= 0 || !Number.isFinite(base)) return null;
  return Math.max(0, Math.min(1, base / apy));
}

/**
 * Is today's rate unusual for this pool?
 *
 * A pool showing 40% today with a 30-day mean of 6% is not a 40% pool, and
 * somebody deciding on the strength of the headline is deciding on a spike
 * that will be gone by the time their deposit confirms.
 *
 * The threshold is a ratio rather than a fixed gap so it works the same on a
 * 3% pool and a 30% one. Returns null when there is no mean to compare
 * against, which the UI renders as nothing rather than as "normal".
 */
export function rateIsUnusual(pool, factor = 1.6) {
  const apy = Number(pool?.apy);
  const mean = Number(pool?.apyMean30d);
  if (!Number.isFinite(apy) || !Number.isFinite(mean) || mean <= 0) return null;
  const ratio = apy / mean;
  if (ratio >= factor) return { direction: 'above', ratio: Math.round(ratio * 10) / 10, mean };
  if (ratio <= 1 / factor) return { direction: 'below', ratio: Math.round(ratio * 10) / 10, mean };
  return null;
}

/**
 * What two tokens does an LP pair need?
 *
 * DefiLlama's `symbol` is "CAKE-BNB" for a pair and "STETH" for a single
 * asset. Splitting on the hyphen is what lets the UI offer "get the tokens" —
 * you cannot enter a CAKE-BNB pool without holding both.
 *
 * Returns an empty array for single-asset pools, which is correct: there is
 * nothing to pair up.
 */
export function pairTokens(pool) {
  const sym = String(pool?.symbol ?? '').trim();
  if (!sym || pool?.exposure === 'single') return [];
  const parts = sym.split(/[-/]/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2) : [];
}

/**
 * DefiLlama chain labels → our EVM chain ids. Unknown chains stay null so
 * Farm never invents a swap the registry cannot fill.
 */
const LLAMA_CHAIN_IDS = {
  ethereum: 1,
  eth: 1,
  bsc: 56,
  binance: 56,
  'binance smart chain': 56,
  polygon: 137,
  matic: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  avax: 43114,
  linea: 59144,
  sonic: 146
};

export function llamaChainId(chain) {
  const key = String(chain ?? '').trim().toLowerCase();
  return LLAMA_CHAIN_IDS[key] ?? null;
}

function tokenOnChain(chainId, symbol) {
  const list = TOKENS[chainId] ?? [];
  const want = String(symbol ?? '').trim().toUpperCase();
  if (!want) return null;
  return list.find((tk) => String(tk.symbol).toUpperCase() === want) ?? null;
}

/**
 * Both legs of an LP pair must exist in OUR registry on that chain.
 * A "get tokens" button that lands on a missing ticker is a dead swap.
 */
export function pairSwapRoute(pool) {
  const pair = pairTokens(pool);
  const chainId = llamaChainId(pool?.chain);
  if (pair.length !== 2 || !chainId) return null;
  if (!tokenOnChain(chainId, pair[0]) || !tokenOnChain(chainId, pair[1])) return null;
  return { chainId, from: pair[0], to: pair[1] };
}

/**
 * What this pool would pay on a given deposit, for one year, at today's rate.
 *
 * ─── WHY A CALCULATOR AND WHY IT IS PHRASED THIS WAY ────────────────────────
 * "12.4% APY" means nothing to most people. "$1,000 would earn about $124 a
 * year, if the rate never changed" means something immediately, and the
 * conditional is the honest half of the sentence — variable rates never stay
 * still, and this is the number people quietly assume is guaranteed.
 *
 * Simple interest, not compounded. APY is already the compounded figure, so
 * compounding it again would overstate the result — a mistake that is easy to
 * make and always errs in the flattering direction.
 */
export function projectEarnings(pool, amountUsd) {
  const apy = Number(pool?.apy);
  const amt = Number(amountUsd);
  if (!Number.isFinite(apy) || !Number.isFinite(amt) || amt <= 0) return null;

  const year = (amt * apy) / 100;
  const real = realShare(pool);

  return {
    year,
    month: year / 12,
    day: year / 365,
    /*
     * The part of the projection backed by actual revenue. Shown beside the
     * headline so "you would earn $124" is immediately qualified by "of which
     * about $40 is real and the rest depends on a token price".
     */
    fromRealYield: real == null ? null : year * real
  };
}

/**
 * Fetch our filtered pool list.
 *
 * No client-side cache beyond the request itself: the server already caches
 * for an hour, and a second layer here would only make "pull to refresh" a lie.
 */
export async function getYields({ timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/yields`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.pools)) throw new Error('BAD_SHAPE');
    return data;
  } finally {
    clearTimeout(timer);
  }
}
