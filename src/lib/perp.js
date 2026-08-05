/**
 * PERPETUAL FUTURES — client side.
 * ---------------------------------------------------------------------------
 * Thin, like lib/yields.js and lib/bridge.js. All the filtering, the funding
 * annualisation and the per-venue interval table live in `server/perp.js`,
 * because the upstream response is the entire derivatives universe and must
 * never reach a phone.
 *
 * ─── WHY THERE IS NO OFFLINE FALLBACK ───────────────────────────────────────
 * Same rule as the yield screen, for a stronger reason. A funding rate is a
 * live cost that flips sign within a day. A cached one shown as current would
 * tell somebody that holding a long is being PAID for when it is in fact
 * costing them — and they would find out only after the money had gone. When
 * we cannot fetch, the correct output is "we cannot show you this right now".
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * How far price must move against a position before it is liquidated.
 *
 * `100 / leverage`, minus nothing. The real figure at every venue is slightly
 * WORSE than this, because maintenance margin and fees are deducted before
 * the collateral is exhausted — which is why the screen labels it as the
 * best case rather than the outcome. Erring toward "you survive longer than
 * you actually will" would be the wrong direction for a risk number, so the
 * label carries the correction that the arithmetic cannot.
 */
export function liquidationMove(leverage) {
  const x = Number(leverage);
  if (!Number.isFinite(x) || x <= 0) return null;
  return 100 / x;
}

/**
 * What funding costs to hold a position, in money, over a period.
 *
 * ─── WHY THIS IS THE CALCULATOR THE SCREEN NEEDED ───────────────────────────
 * "Funding is 0.01% per 8 hours" is a sentence people read and forget. "A
 * $1,000 position at 5x costs about $16 a month to hold, before you are right
 * or wrong about the price" is a sentence that changes a decision.
 *
 * The size that matters is the POSITION, not the collateral: funding is
 * charged on notional. Someone putting up $200 at 5x pays funding on $1,000.
 * That multiplication is the part people get wrong, so it happens here rather
 * than being left to the user.
 *
 * A negative result means funding is being PAID TO the position, which is a
 * real and common state and must not be clamped to zero.
 */
export function fundingCost({ collateralUsd, leverage, aprPct, days = 30 }) {
  const c = Number(collateralUsd);
  const x = Number(leverage);
  const apr = Number(aprPct);
  const d = Number(days);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (!Number.isFinite(x) || x <= 0) return null;
  if (!Number.isFinite(apr)) return null;
  if (!Number.isFinite(d) || d <= 0) return null;

  const notional = c * x;
  const cost = notional * (apr / 100) * (d / 365);

  return {
    notional,
    cost,
    /*
     * The same cost expressed against what the user actually put in. This is
     * the number that lands: 20% a year of funding on a 10x position is 200%
     * a year of the money in your pocket, and the leverage multiplies the
     * holding cost exactly as fast as it multiplies the gain.
     */
    pctOfCollateral: (cost / c) * 100
  };
}

/**
 * Cheapest venue to HOLD a given direction.
 *
 * Direction matters and is easy to get backwards: positive funding is paid BY
 * longs, so a long wants the lowest rate and a short wants the highest. Both
 * are "best" and they are opposite venues, which is precisely why this is a
 * function rather than a sort in the UI.
 *
 * Returns null when no venue reported a rate, rather than falling back to the
 * first row — presenting an arbitrary venue as the best one would be a
 * recommendation we did not compute.
 */
export function bestVenue(asset, side = 'long') {
  const venues = (asset?.venues ?? []).filter((v) => v?.fundingApr != null);
  if (venues.length === 0) return null;
  const sorted = [...venues].sort((a, b) =>
    side === 'short' ? b.fundingApr - a.fundingApr : a.fundingApr - b.fundingApr
  );
  return sorted[0];
}

/**
 * Fetch live perp markets.
 *
 * No client cache: the server already caches for five minutes, and a second
 * layer here would make pull-to-refresh a lie.
 */
export async function getPerpMarkets({ timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/perp/markets`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.assets)) throw new Error('BAD_SHAPE');
    return data;
  } finally {
    clearTimeout(timer);
  }
}
