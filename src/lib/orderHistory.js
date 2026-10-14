/**
 * LEVEL 2 — statistics and history over the user's own orders.
 *
 * Everything here is a pure function of the orders array. Nothing is stored
 * separately and nothing is sent anywhere: the stats are recomputed from the
 * same localStorage list the Orders screen already reads.
 *
 * ─── WHAT THE PERCENTAGES MEAN ───────────────────────────────────────────────
 * An order that is still open (active or paused) has not succeeded or failed
 * yet. Dividing filled by ALL orders would count every live order as a miss
 * and make the fill rate fall while the user is simply waiting. So the rates
 * are computed over CLOSED orders only: filled + expired.
 *
 * ─── WHAT IS NOT COUNTED ─────────────────────────────────────────────────────
 * • Cancelled orders. `removeOrder` deletes the record, so there is nothing to
 *   count. Adding a "cancelled" status would change the cancel behaviour, which
 *   is outside this release.
 * • DCA and TWAP plans. They fill run by run and reach `filled` only when every
 *   run is done, so a fill rate for them would mean something different.
 */

export const DAY_MS = 24 * 3600000;

/** Price-triggered types that end in `filled` or `expired`. */
export const STATS_TYPES = ['limit', 'trailing', 'bracket', 'ladder', 'rebalance'];

/** Window choices for the stats card. 0 means all time. */
export const STATS_WINDOWS = [30, 90, 0];

/**
 * A type needs at least this many closed orders before it can be called the
 * "best". With one filled order a type would show 100%, which says nothing.
 */
export const BEST_TYPE_MIN_CLOSED = 5;

const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);

/**
 * Statistics for the stats card.
 *
 * @param {object[]} orders
 * @param {{windowDays?: number, now?: number}} [opts]  windowDays 0 = all time
 */
export function computeOrderStats(orders = [], { windowDays = 0, now = Date.now() } = {}) {
  const cutoff = windowDays > 0 ? now - windowDays * DAY_MS : -Infinity;
  const list = (Array.isArray(orders) ? orders : []).filter(
    (o) => o && STATS_TYPES.includes(o.type) && Number(o.createdAt) >= cutoff
  );

  const isFilled = (o) => o.status === 'filled';
  const isExpired = (o) => o.status === 'expired';
  const isOpen = (o) => o.status === 'active' || o.status === 'paused';

  const total = list.length;
  const filled = list.filter(isFilled).length;
  const expired = list.filter(isExpired).length;
  const open = list.filter(isOpen).length;
  const closed = filled + expired;

  const timed = list.filter(
    (o) => isFilled(o) && Number.isFinite(o.filledAt) && Number.isFinite(o.createdAt) && o.filledAt >= o.createdAt
  );
  const avgFillTimeDays = timed.length
    ? timed.reduce((sum, o) => sum + (o.filledAt - o.createdAt), 0) / timed.length / DAY_MS
    : null;

  const byType = {};
  for (const type of STATS_TYPES) {
    const mine = list.filter((o) => o.type === type);
    const f = mine.filter(isFilled).length;
    const e = mine.filter(isExpired).length;
    byType[type] = {
      total: mine.length,
      filled: f,
      expired: e,
      closed: f + e,
      fillRate: pct(f, f + e)
    };
  }

  let bestType = null;
  for (const type of STATS_TYPES) {
    const b = byType[type];
    if (b.closed < BEST_TYPE_MIN_CLOSED) continue;
    if (bestType === null || b.fillRate > byType[bestType].fillRate) bestType = type;
  }

  return {
    total,
    open,
    filled,
    expired,
    closed,
    fillRate: pct(filled, closed),
    expireRate: pct(expired, closed),
    avgFillTimeDays,
    byType,
    bestType
  };
}

/** Start of a history range, in ms. `today` is local midnight. */
export function rangeStart(range, now = Date.now()) {
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === 'week') return now - 7 * DAY_MS;
  if (range === 'month') return now - 30 * DAY_MS;
  return -Infinity;
}

export const HISTORY_RANGES = ['today', 'week', 'month', 'all'];

/**
 * Every filled order, newest first. Not capped: the Orders screen shows the
 * last ten, the history screen shows all of them.
 */
export function selectFilledHistory(orders = [], { type = 'all', range = 'all', now = Date.now() } = {}) {
  const start = rangeStart(range, now);
  return (Array.isArray(orders) ? orders : [])
    .filter(
      (o) =>
        o &&
        o.status === 'filled' &&
        (type === 'all' || o.type === type) &&
        Number.isFinite(o.filledAt) &&
        o.filledAt >= start
    )
    .sort((a, b) => b.filledAt - a.filledAt);
}

/**
 * The details shown for one filled order.
 *
 * `aboveFloor` is how far the recorded quotation was above the user's minimum.
 * Profit or loss is NOT computed: the order does not store the price the
 * position was bought at, so a P&L figure would be invented. `pnl` is always
 * null and `pnlReason` says why.
 */
export function describeFill(order) {
  const amountOut = finiteOrNull(order?.filledAmountOut);
  const minOut = finiteOrNull(order?.filledMinAmountOut);
  return {
    rate: finiteOrNull(order?.filledRate),
    amountOut,
    minAmountOut: minOut,
    aboveFloor: amountOut !== null && minOut !== null ? amountOut - minOut : null,
    source: order?.filledQuoteSource || null,
    side: order?.filledSide || null,
    pnl: null,
    pnlReason: 'NO_COST_BASIS'
  };
}

function finiteOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
