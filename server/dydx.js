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

export function fetchDydxAccount(address, number = 0) {
  if (!validAddress(address)) throw upstreamError('BAD_DYDX_ADDRESS', 400);
  const subaccount = Number(number);
  if (!Number.isInteger(subaccount) || subaccount < 0 || subaccount > 31) {
    throw upstreamError('BAD_DYDX_SUBACCOUNT', 400);
  }
  return request(`/v4/addresses/${encodeURIComponent(address)}/subaccountNumber/${subaccount}`);
}

export { INDEXER as DYDX_INDEXER };
