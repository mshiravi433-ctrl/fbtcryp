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
export function fetchDydxCandles(ticker, resolution = '1HOUR', limit = 96) {
  if (!validTicker(ticker)) throw upstreamError('BAD_DYDX_TICKER', 400);
  const RESOLUTIONS = ['1MIN', '5MINS', '15MINS', '30MINS', '1HOUR', '4HOURS', '1DAY'];
  const res = RESOLUTIONS.includes(resolution) ? resolution : '1HOUR';
  const count = Math.max(2, Math.min(500, Number(limit) || 96));
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
