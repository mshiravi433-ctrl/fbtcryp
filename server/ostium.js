/**
 * Ostium public-data proxy.
 *
 * Ostium's market feed and GraphQL subgraph are public, but the upstream does
 * not provide the CORS headers the browser needs. These fixed-origin proxies
 * keep the browser same-origin while ensuring that callers cannot turn the
 * server into an arbitrary HTTP proxy.
 */

const OSTIUM_API = process.env.OSTIUM_API_URL || 'https://builder.prod.bedrock.ostium.io';
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
    const response = await fetch(`${OSTIUM_API}${path}`, {
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
      throw upstreamError(`OSTIUM_UPSTREAM_${response.status}`, 502);
    }
    return body;
  } catch (error) {
    if (error?.status) throw error;
    throw upstreamError('OSTIUM_UPSTREAM_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

export function fetchOstiumPrices() {
  return request('/v1/prices');
}

/**
 * OHLC candles from the same keyless builder API (`POST /v1/ohlc`), the exact
 * request shape @ostium/builder-sdk 0.7.0 sends. Resolutions are the API's own
 * vocabulary; anything else is refused here rather than forwarded.
 */
export const OSTIUM_OHLC_RESOLUTIONS = Object.freeze(['1', '5', '15', '60', '240', '1D']);

export function fetchOstiumOhlc({ pair, fromTimestampSeconds, toTimestampSeconds, resolution = '60' } = {}) {
  const raw = String(pair || '').toUpperCase();
  if (!/^[A-Z0-9]{1,12}-[A-Z0-9]{1,12}$/.test(raw)) throw upstreamError('BAD_OSTIUM_PAIR', 400);
  const res = String(resolution || '60');
  if (!OSTIUM_OHLC_RESOLUTIONS.includes(res)) throw upstreamError('BAD_OSTIUM_RESOLUTION', 400);
  const from = Math.floor(Number(fromTimestampSeconds));
  const to = Math.floor(Number(toTimestampSeconds));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= from) throw upstreamError('BAD_OSTIUM_RANGE', 400);
  return request('/v1/ohlc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pair: raw, fromTimestampSeconds: from, toTimestampSeconds: to, resolution: res })
  });
}

export function fetchOstiumSubgraph({ query, variables = {} } = {}) {
  if (typeof query !== 'string' || query.trim().length === 0 || query.length > 40_000) {
    throw upstreamError('BAD_OSTIUM_QUERY', 400);
  }
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    throw upstreamError('BAD_OSTIUM_VARIABLES', 400);
  }

  return request('/v1/subgraph/gn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
}

export { OSTIUM_API };
