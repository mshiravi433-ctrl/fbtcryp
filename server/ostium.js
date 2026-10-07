/**
 * Ostium public-data proxy.
 *
 * Ostium's market feed and GraphQL subgraph are public, but the upstream does
 * not provide the CORS headers the browser needs. These fixed-origin proxies
 * keep the browser same-origin while ensuring that callers cannot turn the
 * server into an arbitrary HTTP proxy.
 *
 * ─── WHY SUBGRAPH READS HAVE A SECOND DOOR ──────────────────────────────────
 * The builder gateway (`/v1/subgraph/gn`) is the documented endpoint — it is
 * what @ostium/builder-sdk ships as DEFAULT_SUBGRAPH_ENDPOINT — but it is a
 * proxy in front of the deployment, and its GraphQL handling is stricter than
 * a plain Graph node's. When it refuses a read, the whole market catalogue
 * disappears while `/v1/prices` on the same host keeps answering: the feed
 * looks dead while it is only unavailable through one door. The public
 * deployment the official python SDK reads (its `graph_url`) is a documented,
 * keyless alternative, so a refused subgraph read is retried there once.
 *
 * The retry is deliberately narrow. It fires on a REFUSAL — the gateway
 * answered with an error status, or answered 200 without data — and never on a
 * transport failure, where the network path (not the gateway's query handling)
 * is the suspect and a second host only doubles the wait before the honest
 * error. `OSTIUM_SUBGRAPH_FALLBACK_URL=''` turns the second door off.
 */

const OSTIUM_API = process.env.OSTIUM_API_URL || 'https://builder.prod.bedrock.ostium.io';
const TIMEOUT_MS = 12_000;
/*
 * Budgets, not round numbers: the futures health probe races a whole market
 * read against 9s, and the browser gives /api/ostium/subgraph 12s before it
 * aborts and shows the offline note. So the two subgraph attempts TOGETHER
 * must stay under both, or a hanging gateway would make the second door
 * unreachable exactly when it is needed. 5s + 4s leaves the caller time to
 * receive the answer; a refusal, which is the case the retry exists for,
 * comes back in well under a second anyway.
 */
const SUBGRAPH_TIMEOUT_MS = 5_000;
const FALLBACK_TIMEOUT_MS = 4_000;

/* The mainnet deployment read by ostium-python-sdk (`graph_url` in
   ostium_python_sdk/config.py). Testnet has its own host; this server only
   ever talks to mainnet (OSTIUM_CHAIN_ID 42161). */
const DEFAULT_SUBGRAPH_FALLBACK =
  'https://api.subgraph.ormilabs.com/api/public/67a599d5-c8d2-4cc4-9c4d-2975a97bc5d8/subgraphs/ost-prod/live/gn';

const OSTIUM_SUBGRAPH_FALLBACK = process.env.OSTIUM_SUBGRAPH_FALLBACK_URL === undefined
  ? DEFAULT_SUBGRAPH_FALLBACK
  : String(process.env.OSTIUM_SUBGRAPH_FALLBACK_URL || '').trim();

function upstreamError(message, status = 502, { transport = false } = {}) {
  const error = new Error(message);
  error.status = status;
  if (transport) error.transport = true;
  return error;
}

async function requestUrl(url, init = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
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

    if (!response.ok) throw upstreamError(`OSTIUM_UPSTREAM_${response.status}`, 502);
    return body;
  } catch (error) {
    /* An upstream that ANSWERED with an error status is a refusal (see the
       header note); a timeout, a DNS failure or a socket error is not. */
    if (error?.status) throw error;
    throw upstreamError('OSTIUM_UPSTREAM_FAILED', 502, { transport: true });
  } finally {
    clearTimeout(timer);
  }
}

function request(path, init = {}) {
  return requestUrl(`${OSTIUM_API}${path}`, init);
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

/**
 * A GraphQL body that carries no data is not a read. A gateway can answer 200
 * with `errors: [...]` and no `data`; returning that would let every caller
 * treat "the server refused the query" as "the venue has no markets", which is
 * the exact confusion that emptied the market list in production.
 */
function subgraphUnusable(body) {
  if (!body || typeof body !== 'object') return true;
  if (body.data && typeof body.data === 'object') return false;
  return Array.isArray(body.errors) ? body.errors.length > 0 : true;
}

export function fetchOstiumSubgraph({ query, variables = {}, timeoutMs = SUBGRAPH_TIMEOUT_MS } = {}) {
  if (typeof query !== 'string' || query.trim().length === 0 || query.length > 40_000) {
    throw upstreamError('BAD_OSTIUM_QUERY', 400);
  }
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    throw upstreamError('BAD_OSTIUM_VARIABLES', 400);
  }

  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  };

  return (async () => {
    let primaryError = null;
    const primaryTimeout = Math.max(1_000, Math.min(TIMEOUT_MS, Number(timeoutMs) || SUBGRAPH_TIMEOUT_MS));
    try {
      const body = await requestUrl(`${OSTIUM_API}/v1/subgraph/gn`, init, primaryTimeout);
      if (!subgraphUnusable(body)) return body;
      primaryError = upstreamError('OSTIUM_SUBGRAPH_ERROR', 502);
    } catch (error) {
      /* Our own validation never reached the network — do not retry it, and
         do not let a transport failure masquerade as a refusal. */
      if (Number(error?.status) === 400 || error?.transport) throw error;
      primaryError = error;
    }

    if (OSTIUM_SUBGRAPH_FALLBACK) {
      try {
        const body = await requestUrl(OSTIUM_SUBGRAPH_FALLBACK, init, FALLBACK_TIMEOUT_MS);
        if (!subgraphUnusable(body)) return body;
      } catch { /* the gateway's refusal stays the error we report */ }
    }
    throw primaryError || upstreamError('OSTIUM_SUBGRAPH_ERROR', 502);
  })();
}

export { OSTIUM_API, OSTIUM_SUBGRAPH_FALLBACK };
