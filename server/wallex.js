/**
 * Wallex (wallex.ir) proxy — the "for Iranians" buy/sell tab.
 * ---------------------------------------------------------------------------
 * WHY A PROXY: the browser cannot call https://api.wallex.ir directly (no
 * CORS for third-party origins), and the API key must never be baked into the
 * client bundle. The server forwards whitelisted requests only — there is no
 * open passthrough — and the key travels per-request in the `x-wallex-key`
 * header from the user's OWN device storage, or (explicitly opted in) from
 * the server's WALLEX_API_KEY.
 *
 * KEY SAFETY (pinned):
 *   - The key is forwarded to Wallex and to NOTHING else. It is never logged,
 *     never stored, and never echoed back in any response body.
 *   - WALLEX_API_KEY alone is NOT enough to let every visitor trade on the
 *     operator's account: the env fallback activates only when the operator
 *     ALSO sets WALLEX_SERVER_KEY_ALLOW=true. Two deliberate variables, no
 *     accidents.
 *   - The server never places orders by itself; every order is the caller's
 *     authenticated Wallex act, forwarded verbatim.
 *
 * API reference: https://api-docs.wallex.ir — envelope { success, message,
 * result }; private endpoints take `X-API-Key`. Keys expire after ≤ 90 days
 * (the UI says so; expired keys surface Wallex's own message verbatim).
 */

export const WALLEX_BASE = 'https://api.wallex.ir';
export const WALLEX_TIMEOUT_MS = 10_000;

const SYMBOL_RE = /^[A-Z0-9]{4,20}$/;
const SIDES = new Set(['BUY', 'SELL']);
const ORDER_TYPES = new Set(['LIMIT', 'MARKET']);
const NUMERIC_RE = /^[0-9]+(\.[0-9]+)?$/;

/** The routes the browser may reach. Everything else is a 404, by design. */
export const WALLEX_ROUTES = Object.freeze({
  markets: { method: 'GET', path: '/v1/markets', auth: false, cacheTtlMs: 15_000 },
  otcMarkets: { method: 'GET', path: '/v1/otc/markets', auth: false, cacheTtlMs: 15_000 },
  depth: { method: 'GET', path: '/v1/depth', auth: false, cacheTtlMs: 4_000 },
  balances: { method: 'GET', path: '/v1/account/balances', auth: true },
  openOrders: { method: 'GET', path: '/v1/account/openOrders', auth: true },
  trades: { method: 'GET', path: '/v1/account/trades', auth: true },
  otcPrice: { method: 'GET', path: '/v1/account/otc/price', auth: true },
  cryptoDeposits: { method: 'GET', path: '/v1/account/crypto-deposit', auth: true },
  placeOrder: { method: 'POST', path: '/v1/account/orders', auth: true, order: true },
  cancelOrder: { method: 'DELETE', path: '/v1/account/orders', auth: true, order: true },
  placeOtc: { method: 'POST', path: '/v1/account/otc/orders', auth: true, order: true },
  withdrawCrypto: { method: 'POST', path: '/v1/account/crypto-withdrawal', auth: true, order: true }
});

/**
 * Resolve the key for this request: the user's own header wins; the server's
 * env key exists only when the operator explicitly allowed it.
 * The env value is trimmed — real env stores smuggle trailing newlines.
 */
export function resolveWallexKey(headerKey, env = process.env) {
  const user = String(headerKey || '').trim();
  if (user) return { key: user, source: 'user' };
  if (String(env.WALLEX_SERVER_KEY_ALLOW || '').trim() === 'true') {
    const server = String(env.WALLEX_API_KEY || '').trim();
    if (server) return { key: server, source: 'server' };
  }
  return { key: null, source: 'none' };
}

/** Body validation for POST /v1/account/orders — fail closed, upstream never sees junk. */
export function validateWallexOrderBody(body = {}) {
  const symbol = String(body.symbol || '').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return { ok: false, code: 'WALLEX_BAD_SYMBOL' };
  const type = String(body.type || 'LIMIT').toUpperCase();
  if (!ORDER_TYPES.has(type)) return { ok: false, code: 'WALLEX_BAD_TYPE' };
  const side = String(body.side || '').toUpperCase();
  if (!SIDES.has(side)) return { ok: false, code: 'WALLEX_BAD_SIDE' };
  const quantity = String(body.quantity ?? '').trim();
  if (!NUMERIC_RE.test(quantity) || Number(quantity) <= 0) return { ok: false, code: 'WALLEX_BAD_QUANTITY' };
  let price = null;
  if (type === 'LIMIT') {
    price = String(body.price ?? '').trim();
    if (!NUMERIC_RE.test(price) || Number(price) <= 0) return { ok: false, code: 'WALLEX_BAD_PRICE' };
  }
  return { ok: true, body: { symbol, type, side, quantity, ...(price !== null ? { price } : {}) } };
}

/** Body validation for POST /v1/account/otc/orders (instant buy/sell). */
export function validateWallexOtcBody(body = {}) {
  const symbol = String(body.symbol || '').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return { ok: false, code: 'WALLEX_BAD_SYMBOL' };
  const side = String(body.side || '').toUpperCase();
  if (!SIDES.has(side)) return { ok: false, code: 'WALLEX_BAD_SIDE' };
  const amount = String(body.amount ?? '').trim();
  if (!NUMERIC_RE.test(amount) || Number(amount) <= 0) return { ok: false, code: 'WALLEX_BAD_AMOUNT' };
  return { ok: true, body: { symbol, side, amount } };
}

/** Body validation for POST /v1/account/crypto-withdrawal — moves REAL funds,
    so shape discipline happens here, before the upstream sees anything. */
export function validateWallexWithdrawBody(body = {}) {
  const coin = String(body.coin || '').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(coin)) return { ok: false, code: 'WALLEX_BAD_COIN' };
  const network = String(body.network || '').toUpperCase();
  if (!/^[A-Z0-9]{2,16}$/.test(network)) return { ok: false, code: 'WALLEX_BAD_NETWORK' };
  const value = String(body.value ?? '').trim();
  if (!NUMERIC_RE.test(value) || Number(value) <= 0) return { ok: false, code: 'WALLEX_BAD_AMOUNT' };
  const address = String(body.wallet_address || '').trim();
  if (address.length < 15 || address.length > 160 || /\s/.test(address)) return { ok: false, code: 'WALLEX_BAD_ADDRESS' };
  const memo = String(body.memo ?? '').trim();
  if (memo && memo.length > 120) return { ok: false, code: 'WALLEX_BAD_MEMO' };
  return { ok: true, body: { coin, network, value, wallet_address: address, ...(memo ? { memo } : {}) } };
}

/**
 * One upstream call. `fetchImpl` is injectable so the probe can prove every
 * property below without network. Returns an express-style { status, body }.
 */
export async function wallexUpstream(routeName, {
  query = {},
  body = null,
  headerKey = '',
  fetchImpl = fetch,
  env = process.env
} = {}) {
  const route = WALLEX_ROUTES[routeName];
  if (!route) return { status: 404, body: { error: 'WALLEX_ROUTE_NOT_FOUND' } };

  let outbound = null;
  if (route.order === true) {
    const checked = routeName === 'placeOtc'
      ? validateWallexOtcBody(body)
      : routeName === 'withdrawCrypto'
        ? validateWallexWithdrawBody(body)
        : validateWallexOrderBody(body);
    if (!checked.ok) return { status: 400, body: { error: checked.code } };
    outbound = checked.body;
  }

  const { key, source } = resolveWallexKey(headerKey, env);
  if (route.auth && !key) {
    return { status: 401, body: { error: 'WALLEX_KEY_REQUIRED' } };
  }

  const url = new URL(`${WALLEX_BASE}${route.path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const headers = { accept: 'application/json' };
  if (key) headers['x-api-key'] = key;
  if (outbound) headers['content-type'] = 'application/json';

  let response;
  try {
    response = await fetchImpl(url, {
      method: route.method,
      headers,
      ...(outbound ? { body: JSON.stringify(outbound) } : {}),
      signal: AbortSignal.timeout(WALLEX_TIMEOUT_MS)
    });
  } catch {
    return { status: 502, body: { error: 'WALLEX_UNREACHABLE' } };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { status: 502, body: { error: 'WALLEX_BAD_RESPONSE' } };
  }

  /* Never echo the key, whatever upstream says. */
  const text = JSON.stringify(payload ?? {});
  if (key && text.includes(key)) return { status: 502, body: { error: 'WALLEX_BAD_RESPONSE' } };

  return {
    status: response.status === 200 && payload?.success === false ? 400 : response.status,
    body: { ...(payload ?? {}), wallexKeySource: route.auth ? source : undefined }
  };
}

/**
 * Markets, normalized for the tab: Toman pairs first (that is what an Iranian
 * buy/sell screen is FOR), ranked by 24h quote volume, then USDT pairs.
 */
export function normalizeWallexMarkets(symbolsMap) {
  if (!symbolsMap || typeof symbolsMap !== 'object' || Array.isArray(symbolsMap)) return [];
  const rows = Object.values(symbolsMap)
    .filter((m) => m && typeof m === 'object' && typeof m.symbol === 'string')
    .map((m) => ({
      symbol: m.symbol,
      baseAsset: String(m.baseAsset || ''),
      quoteAsset: String(m.quoteAsset || ''),
      faName: String(m.faName || ''),
      lastPrice: Number(m.stats?.lastPrice ?? 0),
      change24h: Number(m.stats?.['24h_ch'] ?? 0),
      bidPrice: Number(m.stats?.bidPrice ?? 0),
      askPrice: Number(m.stats?.askPrice ?? 0),
      quoteVolume24h: Number(m.stats?.['24h_quoteVolume'] ?? 0),
      high24h: Number(m.stats?.['24h_highPrice'] ?? 0),
      low24h: Number(m.stats?.['24h_lowPrice'] ?? 0),
      minQty: Number(m.minQty ?? 0),
      minNotional: Number(m.minNotional ?? 0),
      tickSize: Number(m.tickSize ?? 2),
      stepSize: Number(m.stepSize ?? 6)
    }));
  const rank = (m) => (m.quoteAsset === 'TMN' ? 0 : m.quoteAsset === 'USDT' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || b.quoteVolume24h - a.quoteVolume24h);
}

/**
 * A small dedicated budget for ORDER routes (real money upstream). Pattern
 * matches the anchor/watcher limiters: keyed by caller, per-minute, and the
 * probe can construct an isolated one.
 */
export function createWallexOrderLimiter({ max = Number(process.env.WALLEX_ORDER_RATE_LIMIT || 20), windowMs = 60_000 } = {}) {
  const hits = new Map();
  return function allow(identity) {
    const now = Date.now();
    const rec = hits.get(identity);
    if (!rec || now > rec.reset) {
      hits.set(identity, { count: 1, reset: now + windowMs });
      return true;
    }
    rec.count += 1;
    if (rec.count > max) return false;
    return true;
  };
}
