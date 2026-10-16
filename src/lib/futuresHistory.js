/**
 * Futures trade history — PURE, read-only.
 *
 * Nothing in this module can send, cancel or edit anything. It turns the
 * indexer's fills and orders into rows the history table shows, with the
 * direction and open/close flag worked out from the order that filled.
 *
 * Venue coverage is stated, not implied:
 *   · dYdX     — fills + orders from the indexer, through the same-origin proxy.
 *   · Ostium   — no history source in this repository; reported as unavailable.
 *   · Velocity — only the current positions are read; reported as unavailable.
 */

export const HISTORY_RANGES = Object.freeze({
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: null
});

export const HISTORY_PAGE_SIZE = 25;

/** Fetch at most this many fills per request — the table pages, it never pulls all. */
export const HISTORY_FETCH_LIMIT = 100;

const ms = (iso) => {
  const t = typeof iso === 'number' ? iso : Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : NaN;
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
};

/**
 * Normalise one dYdX indexer fill. Returns null for anything whose time, size
 * or price is not a finite number: a row we cannot place in time is not shown.
 */
export function normaliseDydxFill(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const time = ms(raw.createdAt);
  const size = num(raw.size);
  const price = num(raw.price);
  const fee = num(raw.fee);
  if (!Number.isFinite(time) || !Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  const side = String(raw.side || '').toUpperCase();
  return {
    id: String(raw.id || raw.eventId || `${raw.orderId || 'fill'}-${time}`),
    venue: 'dydx',
    time,
    market: String(raw.market || ''),
    side: side === 'BUY' || side === 'SELL' ? side : null,
    size,
    price,
    fee: Number.isFinite(fee) ? fee : null,
    orderId: raw.orderId ? String(raw.orderId) : null,
    liquidity: raw.liquidity ? String(raw.liquidity) : null,
    /* What the indexer says the fill was (LIMIT, MARKET, LIQUIDATED, …). */
    fillType: raw.type ? String(raw.type) : null,
    orderType: null,
    /* The cursor for «بارگذاری بیشتر»: the indexer pages by timestamp. */
    iso: new Date(time).toISOString(),
    /* dYdX fills carry no realised PnL; the column says so instead of showing 0. */
    realizedPnl: null,
    direction: null,
    closing: null
  };
}

/**
 * Work out LONG / SHORT and whether the fill opened or closed exposure, from
 * the order it belongs to. Without the order the direction stays null and the
 * UI shows «نامشخص» — a guessed direction would be a wrong fact.
 *
 *   reduceOnly + SELL → closed a LONG      reduceOnly + BUY → closed a SHORT
 *   not reduceOnly + BUY → opened a LONG   not reduceOnly + SELL → opened a SHORT
 */
export function annotateFills(fills = [], orders = []) {
  const byId = new Map();
  for (const o of Array.isArray(orders) ? orders : []) {
    if (o && o.id !== undefined && o.id !== null) byId.set(String(o.id), o);
  }
  return (Array.isArray(fills) ? fills : []).map((f) => {
    if (!f || !f.orderId || !byId.has(f.orderId) || !f.side) return f;
    const order = byId.get(f.orderId);
    const reduce = order.reduceOnly === true;
    const direction = reduce
      ? (f.side === 'SELL' ? 'LONG' : 'SHORT')
      : (f.side === 'BUY' ? 'LONG' : 'SHORT');
    return {
      ...f,
      direction,
      closing: reduce,
      orderType: order.type ? String(order.type) : null
    };
  });
}

/** Newest first, ties broken by id so paging is stable. */
export function sortNewestFirst(rows = []) {
  return [...rows].sort((a, b) => (b.time - a.time) || String(b.id).localeCompare(String(a.id)));
}

/**
 * Keep rows for one market (or 'all') within one range. `now` is injectable.
 */
export function filterHistory(rows = [], { market = 'all', range = 'all', now = Date.now() } = {}) {
  const span = Object.prototype.hasOwnProperty.call(HISTORY_RANGES, range) ? HISTORY_RANGES[range] : null;
  const cutoff = span === null ? -Infinity : now - span;
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false;
    if (market && market !== 'all' && r.market !== market) return false;
    return r.time >= cutoff;
  });
}

/**
 * One page of an already-sorted list. `offset` is a row index, not a cursor,
 * so "load more" appends and never re-fetches what is already on screen.
 */
export function paginate(rows = [], { offset = 0, pageSize = HISTORY_PAGE_SIZE } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const end = start + Math.max(1, Math.trunc(Number(pageSize) || HISTORY_PAGE_SIZE));
  return {
    items: list.slice(start, end),
    nextOffset: end,
    hasMore: end < list.length
  };
}

/** Distinct markets present in the rows, sorted, for the market filter. */
export function marketsIn(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.market).filter(Boolean))].sort();
}

/**
 * The per-venue status the history screen shows. Each venue states its own
 * source, so a missing source can never look like an empty history.
 */
export const HISTORY_VENUES = Object.freeze([
  { id: 'dydx', source: 'dYdX indexer (fills, orders)', available: true },
  {
    id: 'ostium',
    source: null,
    available: false,
    reasonKey: 'futures.history.venue.ostiumUnavailable'
  },
  {
    id: 'velocity',
    source: null,
    available: false,
    reasonKey: 'futures.history.venue.velocityUnavailable'
  }
]);
