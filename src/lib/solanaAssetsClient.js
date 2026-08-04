/**
 * CLIENT ACCESS TO THE CURATED SOLANA ASSETS.
 * ---------------------------------------------------------------------------
 * Thin, like lib/yields.js and for the same reason: the verification work
 * happens on the server (see server/solanaAssets.js), because it queries eight
 * mints and re-checks issuer authorities, and neither belongs on a phone.
 *
 * ─── NO OFFLINE FALLBACK, DELIBERATELY ──────────────────────────────────────
 * Most data modules here fall back to a bundled snapshot so the UI is never
 * blank. Not this one. A stale crypto price corrects itself on the next tick;
 * a stale EQUITY price is a number that was true when the US market last
 * closed and may be hours old across a weekend. Worse, a cached row would
 * survive the issuer check being revoked — the exact failure the server-side
 * verification exists to catch.
 *
 * When we cannot fetch, the correct output is "we cannot show you prices right
 * now", not a plausible-looking table.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * Minimum liquidity before an equity is offered at all.
 *
 * Separate from the per-trade gate in `liquidityVerdict`. That one asks "is
 * THIS order too big for the pool"; this one asks "is this pool deep enough to
 * be worth listing". A market with $5k of depth is not a market, and listing
 * it invites someone to buy something they will not be able to sell.
 */
export const MIN_EQUITY_LIQUIDITY = 25_000;

export async function getSolanaAssets({ timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/solana/assets`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.equities) || !Array.isArray(data?.lst)) throw new Error('BAD_SHAPE');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estimated annual staking yield for an LST, joined from the live DefiLlama
 * feed the Farm screen already fetches.
 *
 * ─── WHY THIS IS A JOIN AND NOT A CONSTANT ──────────────────────────────────
 * Writing `apy: 7.5` into the asset list would be wrong within a week and
 * nobody would notice, which is exactly the bug the old Farm screen had with
 * its hand-written "15–40%" ranges. Matching on the DefiLlama `project` field
 * means the number is always the one the protocol is actually paying.
 *
 * Returns null when the pool is not in the feed. The UI then shows no yield
 * rather than a stale one — an LST with an unknown yield is still a perfectly
 * good token to hold, it just cannot advertise a number.
 */
export function yieldForLst(asset, pools = []) {
  if (!asset?.llamaProject) return null;
  const match = pools.find(
    (p) =>
      p.project === asset.llamaProject &&
      String(p.symbol ?? '').toUpperCase() === String(asset.llamaSymbol ?? '').toUpperCase()
  );
  if (!match) return null;
  return {
    apy: match.apy,
    apyMean30d: match.apyMean30d ?? null,
    tvlUsd: match.tvlUsd ?? null
  };
}

/**
 * What a stake would be worth after a year at today's rate.
 *
 * Simple, not compounded: APY is already the compounded figure and compounding
 * it again overstates the result. Same reasoning as lib/yields.js — a mistake
 * that always errs in the flattering direction is one to guard explicitly.
 */
export function projectStake(apy, amountUsd) {
  /*
   * `apy == null` is checked BEFORE the Number() coercion, because
   * `Number(null)` is 0 — not NaN — so `Number.isFinite` happily accepts it
   * and an unknown yield would project a confident "$0 a year" instead of
   * declining to answer. Caught by a test that expected null and got a
   * number; the same trap applies to `''` and `false`.
   *
   * A missing rate must produce NO projection, not a zero one: zero is a
   * claim about the yield, and we do not have one to make.
   */
  if (apy == null || apy === '') return null;
  const rate = Number(apy);
  const amt = Number(amountUsd);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(amt) || amt <= 0) return null;
  const year = (amt * rate) / 100;
  return { year, month: year / 12 };
}
