/**
 * dYdX public indexer proxy.
 *
 * The dYdX indexer is public, but its browser responses are not reliably
 * reachable from every deployment because of CORS and network filtering. Keep
 * the upstream URL here, on the server, and expose only the three read-only
 * resources the app needs. No wallet keys or order submission pass through
 * these routes.
 */

const INDEXER = process.env.DYDX_INDEXER_URL || 'https://indexer.dydx.trade';
const TIMEOUT_MS = 12_000;

function upstreamError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${INDEXER}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(init.headers || {})
      }
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      throw upstreamError(`DYDX_UPSTREAM_${response.status}`, response.status === 404 ? 404 : 502);
    }
    return body;
  } catch (error) {
    if (error?.status) throw error;
    throw upstreamError('DYDX_UPSTREAM_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

const validTicker = (ticker) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(String(ticker || ''));
const validAddress = (address) => /^dydx1[02-9ac-hj-np-z]{38}$/.test(String(address || '').toLowerCase());

export function fetchDydxMarkets() {
  return request('/v4/perpetualMarkets?limit=500');
}

export function fetchDydxOrderbook(ticker) {
  if (!validTicker(ticker)) throw upstreamError('BAD_DYDX_TICKER', 400);
  return request(`/v4/orderbooks/perpetualMarket/${encodeURIComponent(ticker)}`);
}

export const DYDX_CANDLE_RESOLUTIONS = Object.freeze([
  '1MIN', '5MINS', '15MINS', '30MINS', '1HOUR', '4HOURS', '1DAY'
]);
export const DYDX_CANDLE_RESOLUTION_DEFAULT = '1HOUR';
export const DYDX_CANDLE_LIMIT_DEFAULT = 96;
export const DYDX_CANDLE_LIMIT_MAX = 500;

/**
 * Clamp a caller's resolution/limit to what we will actually ask upstream for.
 *
 * The route calls this BEFORE it builds a cache key, which is the whole point.
 * The response cache (server/cache.js) is an unbounded Map — entries expire but
 * are never swept, so a stale key stays resident forever. An endpoint that
 * interpolated raw query strings into its key would let any anonymous caller
 * allocate permanent entries one request at a time. Every other route here
 * clamps before keying (`/api/markets` bounds page/per_page, `/api/chart/:id`
 * bounds days, `/api/search` slices q); this keeps candles to the same rule.
 *
 * Shared with the fetch below so the two can never drift: what is cached is
 * exactly what was requested.
 */
export function normaliseCandleQuery(resolution, limit) {
  const asked = String(resolution || '').toUpperCase();
  /* `?limit=` (empty) must fall back to the default, not to the floor:
     Number('') is 0, which would clamp to 2 and quietly return two candles. */
  const raw = typeof limit === 'string' ? limit.trim() : limit;
  const n = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
  return {
    resolution: DYDX_CANDLE_RESOLUTIONS.includes(asked) ? asked : DYDX_CANDLE_RESOLUTION_DEFAULT,
    limit: Number.isFinite(n)
      ? Math.min(DYDX_CANDLE_LIMIT_MAX, Math.max(2, Math.trunc(n)))
      : DYDX_CANDLE_LIMIT_DEFAULT
  };
}

/**
 * Historical candles for one perpetual market.
 *
 * Added because the dYdX screen asked a person to size a leveraged position
 * with nothing but a single oracle price and an open-interest figure — no shape
 * of the market at all. This is the same read-only indexer the other three
 * routes use; no wallet keys and no order submission pass through it.
 *
 * The upstream response is `{ candles: [{ startedAt, ticker, resolution, low,
 * high, open, close, baseTokenVolume, ... }] }`, newest first. It is normalised
 * oldest-first with numbers, because a chart that has to remember the upstream
 * sort order is a chart that will one day draw backwards.
 */
export function fetchDydxCandles(ticker, resolution = DYDX_CANDLE_RESOLUTION_DEFAULT, limit = DYDX_CANDLE_LIMIT_DEFAULT) {
  if (!validTicker(ticker)) throw upstreamError('BAD_DYDX_TICKER', 400);
  const { resolution: res, limit: count } = normaliseCandleQuery(resolution, limit);
  return request(
    `/v4/candles/perpetualMarkets/${encodeURIComponent(ticker)}?resolution=${res}&limit=${count}`
  );
}

/**
 * 24h high/low for one market, built from the venue's OWN hourly candles.
 *
 * `perpetualMarkets` publishes a 24h CHANGE but no 24h range, which is why the
 * terminal's top bar had a gap where every other desk prints a high and a low.
 * The indexer does publish the range that matters — 24 hourly bars — so the
 * high and low here are the extremes of real trades over the last 24 hours, not
 * a percentage applied to a price.
 *
 * Cached for 60s by the route (the hourly bar itself only changes once an hour,
 * but the newest bar is still filling). Returns nulls rather than zeros when the
 * indexer gives us fewer than two bars: "no range yet" is a fact, "0.00" is a
 * claim.
 */
export const DYDX_RANGE_RESOLUTION = '1HOUR';
export const DYDX_RANGE_BARS = 24;
export async function fetchDydx24hRange(ticker) {
  if (!validTicker(ticker)) throw upstreamError('BAD_DYDX_TICKER', 400);
  const body = await fetchDydxCandles(ticker, DYDX_RANGE_RESOLUTION, DYDX_RANGE_BARS);
  const rows = Array.isArray(body?.candles) ? body.candles : [];
  const highs = rows.map((c) => Number(c.high)).filter((n) => Number.isFinite(n) && n > 0);
  const lows = rows.map((c) => Number(c.low)).filter((n) => Number.isFinite(n) && n > 0);
  if (rows.length < 2 || !highs.length || !lows.length) {
    return { ticker, high24h: null, low24h: null, bars: rows.length, resolution: DYDX_RANGE_RESOLUTION };
  }
  return {
    ticker,
    high24h: Math.max(...highs),
    low24h: Math.min(...lows),
    bars: rows.length,
    resolution: DYDX_RANGE_RESOLUTION,
    /* Which bars the extremes came from, so a screen can say "of the last 24
       hourly candles" instead of implying a rolling 60-minute window. */
    firstBarAt: rows[0]?.startedAt ? new Date(rows[0].startedAt).toISOString() : null,
    lastBarAt: rows[rows.length - 1]?.startedAt ? new Date(rows[rows.length - 1].startedAt).toISOString() : null
  };
}

/**
 * Recent public trades for one market — the tape the terminal draws beside the
 * book. `/v4/trades/perpetualMarket/:ticker?limit=` is public and keyless, and
 * the limit is clamped here (not in the route) so the cached key-space stays
 * bounded: 1–100 only.
 */
export const DYDX_TRADES_LIMIT_MAX = 100;
export const DYDX_TRADES_LIMIT_DEFAULT = 50;
/**
 * Clamp a caller's limit to the range we will ask upstream for, and do it in a
 * function the ROUTE can also call before it builds its cache key. That is the
 * rule `normaliseCandleQuery` set: the response cache is an unbounded Map, so a
 * raw query string in a key lets an anonymous caller allocate entries forever.
 * Two numbers, one function, no drift between what is cached and what is asked.
 */
export function normaliseTradesLimit(limit) {
  const raw = typeof limit === 'string' ? limit.trim() : limit;
  const n = raw === '' || raw == null ? NaN : Number(raw);
  return Number.isFinite(n)
    ? Math.min(DYDX_TRADES_LIMIT_MAX, Math.max(1, Math.trunc(n)))
    : DYDX_TRADES_LIMIT_DEFAULT;
}

export function fetchDydxTrades(ticker, limit = DYDX_TRADES_LIMIT_DEFAULT) {
  if (!validTicker(ticker)) throw upstreamError('BAD_DYDX_TICKER', 400);
  return request(`/v4/trades/perpetualMarket/${encodeURIComponent(ticker)}?limit=${normaliseTradesLimit(limit)}`);
}

/**
 * Historical funding for one market — what the position actually COST to hold,
 * as opposed to the single forward-looking `nextFundingRate` the market row
 * carries. Same clamp discipline; the indexer caps at 100 rows per page.
 */
export const DYDX_FUNDING_LIMIT_MAX = 100;
export const DYDX_FUNDING_LIMIT_DEFAULT = 48;
export function normaliseFundingLimit(limit) {
  const raw = typeof limit === 'string' ? limit.trim() : limit;
  const n = raw === '' || raw == null ? NaN : Number(raw);
  return Number.isFinite(n)
    ? Math.min(DYDX_FUNDING_LIMIT_MAX, Math.max(1, Math.trunc(n)))
    : DYDX_FUNDING_LIMIT_DEFAULT;
}

export function fetchDydxHistoricalFunding(ticker, limit = DYDX_FUNDING_LIMIT_DEFAULT) {
  if (!validTicker(ticker)) throw upstreamError('BAD_DYDX_TICKER', 400);
  return request(`/v4/historicalFunding/${encodeURIComponent(ticker)}?limit=${normaliseFundingLimit(limit)}`);
}

export function fetchDydxAccount(address, number = 0) {
  if (!validAddress(address)) throw upstreamError('BAD_DYDX_ADDRESS', 400);
  const subaccount = Number(number);
  if (!Number.isInteger(subaccount) || subaccount < 0 || subaccount > 31) {
    throw upstreamError('BAD_DYDX_SUBACCOUNT', 400);
  }
  return request(`/v4/addresses/${encodeURIComponent(address)}/subaccountNumber/${subaccount}`);
}

/*
 * Fills for one subaccount, newest first, one page at a time. The caller pages
 * with `createdBeforeOrAt` (an ISO timestamp). Never fetches the full history
 * in one request: the client asks for a page and «بارگذاری بیشتر» asks for the
 * next one.
 */
export const DYDX_FILLS_LIMIT_MAX = 100;
export function fetchDydxFills(address, number = 0, { limit = 25, before = null } = {}) {
  if (!validAddress(address)) throw upstreamError('BAD_DYDX_ADDRESS', 400);
  const subaccount = Number(number);
  if (!Number.isInteger(subaccount) || subaccount < 0 || subaccount > 31) {
    throw upstreamError('BAD_DYDX_SUBACCOUNT', 400);
  }
  const count = Math.min(DYDX_FILLS_LIMIT_MAX, Math.max(1, Math.trunc(Number(limit) || 25)));
  const qs = new URLSearchParams({
    address,
    subaccountNumber: String(subaccount),
    limit: String(count)
  });
  if (before) {
    const t = Date.parse(String(before));
    if (!Number.isFinite(t)) throw upstreamError('BAD_DYDX_CURSOR', 400);
    qs.set('createdBeforeOrAt', new Date(t).toISOString());
  }
  return request(`/v4/fills?${qs.toString()}`);
}

/*
 * Orders for one subaccount in one status. The status is checked against an
 * allow-list so the proxy cannot be used to ask for arbitrary indexer filters.
 */
export const DYDX_ORDER_STATUS_ALLOWED = Object.freeze([
  'UNTRIGGERED', 'OPEN', 'FILLED', 'CANCELED', 'BEST_EFFORT_CANCELED'
]);
export function fetchDydxOrders(address, number = 0, status = 'UNTRIGGERED') {
  if (!validAddress(address)) throw upstreamError('BAD_DYDX_ADDRESS', 400);
  const subaccount = Number(number);
  if (!Number.isInteger(subaccount) || subaccount < 0 || subaccount > 31) {
    throw upstreamError('BAD_DYDX_SUBACCOUNT', 400);
  }
  if (!DYDX_ORDER_STATUS_ALLOWED.includes(String(status))) throw upstreamError('BAD_DYDX_STATUS', 400);
  const qs = new URLSearchParams({
    address,
    subaccountNumber: String(subaccount),
    status: String(status),
    limit: String(DYDX_FILLS_LIMIT_MAX)
  });
  return request(`/v4/orders?${qs.toString()}`);
}

/*
 * Response shapes. The indexer wraps fills as `{ fills }` but answers orders
 * with a bare array. Both are normalised here, so the route cannot silently
 * return an empty list because it read the wrong property.
 */
export function normaliseFillsBody(body) {
  const rows = Array.isArray(body?.fills) ? body.fills : [];
  return rows.slice(0, DYDX_FILLS_LIMIT_MAX);
}
export function normaliseOrdersBody(body) {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.orders) ? body.orders : [];
  return rows.slice(0, DYDX_FILLS_LIMIT_MAX);
}

export { INDEXER as DYDX_INDEXER };
