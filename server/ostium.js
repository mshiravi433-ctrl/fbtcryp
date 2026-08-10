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
