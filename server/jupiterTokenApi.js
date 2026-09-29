/** Shared server-only access to Jupiter's token metadata API. */
// Use the current API host; the deprecated Lite host may be removed after its
// announced postponement, and the official Tokens V2 API requires x-api-key.
const DEFAULT_BASE = 'https://api.jup.ag/tokens/v2';

export function jupiterTokenUrl(endpoint, params = {}) {
  let url;
  const customSearch = endpoint === 'search' && process.env.JUP_TOKEN_SEARCH_URL;
  if (customSearch) {
    url = new URL(String(process.env.JUP_TOKEN_SEARCH_URL));
  } else {
    const base = String(process.env.JUPITER_TOKEN_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
    const path = String(endpoint || '').replace(/^\/+/, '');
    url = new URL(`${base}/${path}`);
  }
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function jupiterTokenHeaders() {
  const headers = { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' };
  const key = String(process.env.JUPITER_API_KEY || '').trim();
  if (key) headers['x-api-key'] = key;
  return headers;
}
