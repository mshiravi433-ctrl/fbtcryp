/**
 * FIAT BUY & SELL — client side.
 * ---------------------------------------------------------------------------
 * Thin. The partner key, the commission arrangement and the pair validation
 * all live in `server/fiat.js`, because they decide where revenue goes and
 * must never be settable from a browser.
 *
 * ─── THIS FILE MUST NEVER LEARN TO SWAP ─────────────────────────────────────
 * The previous ChangeNOW integration quoted crypto-to-crypto and was deleted
 * for competing with our own swap. This one is fiat-only by construction: the
 * server rejects any pair that is not money→crypto or crypto→money, and the
 * lists below contain no crypto-to-crypto route.
 *
 * If a future change adds one, it will have re-created the deleted feature.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * Money we accept.
 *
 * ─── THE RIAL IS ABSENT, AND THAT IS NOT AN OVERSIGHT ───────────────────────
 * No international processor settles IRR. Visa, Mastercard and Amex have been
 * cut off from Iran's banking system at the network level since 2012, and
 * OFAC's Iran program (reviewed January 2026) shows no change. Listing it
 * would create a button that fails for every single user who taps it — the
 * dead-button problem the Buy screen was rebuilt to remove.
 *
 * Mirrors `FIAT_CURRENCIES` in server/fiat.js. A wiring check asserts the two
 * lists agree, because a code present here and absent there produces a picker
 * option whose every request 400s.
 */
export const FIAT_MONEY = [
  { code: 'usd', symbol: '$', name: 'US Dollar' },
  { code: 'eur', symbol: '€', name: 'Euro' },
  { code: 'gbp', symbol: '£', name: 'British Pound' },
  { code: 'try', symbol: '₺', name: 'Turkish Lira' },
  { code: 'aed', symbol: 'AED', name: 'UAE Dirham' }
];

/**
 * Crypto our own app can then do something useful with.
 *
 * `id` carries the network (`usdt-trx`, `usdt-bsc`) because on the fiat API an
 * asset is a currency-and-network pair, not a fused ticker. Two entries can
 * share a symbol — USDT exists on TRON and on BNB Chain — and they are
 * different destinations with different addresses. `chain` exists purely so
 * the picker can show which one, since "USDT" twice in a dropdown is a way to
 * lose somebody's money.
 */
export const FIAT_ASSETS = [
  { id: 'btc', symbol: 'BTC', name: 'Bitcoin', chain: 'Bitcoin' },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum', chain: 'Ethereum' },
  { id: 'usdt-trx', symbol: 'USDT', name: 'Tether', chain: 'TRON' },
  { id: 'usdt-bsc', symbol: 'USDT', name: 'Tether', chain: 'BNB Chain' },
  { id: 'usdc-bsc', symbol: 'USDC', name: 'USD Coin', chain: 'BNB Chain' },
  { id: 'bnb-bsc', symbol: 'BNB', name: 'BNB', chain: 'BNB Chain' },
  { id: 'sol', symbol: 'SOL', name: 'Solana', chain: 'Solana' }
];

let cachedStatus = null;

async function getJson(path, { timeout = 15000, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...(init.headers ?? {}) }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error || `HTTP ${res.status}`);
      err.code = body?.error;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is fiat actually live?
 *
 * Cached for the session: it is a deployment setting, not live data, and
 * re-asking on every render would be pure waste. A failure resolves to
 * `{enabled:false}` at the call site rather than throwing, because the panel
 * must degrade to an explanation instead of a blank screen.
 */
export async function getFiatStatus() {
  if (cachedStatus) return cachedStatus;
  cachedStatus = await getJson('/fiat/status', { timeout: 10000 });
  return cachedStatus;
}

/**
 * The accepted amount range for a pair.
 *
 * Worth its own call because it is keyless upstream: it answers even while
 * our fiat access is still pending, so the form can state a real minimum
 * instead of letting somebody type an amount that will be rejected.
 */
export function getFiatRange({ from, to }) {
  const qs = new URLSearchParams({ from, to });
  return getJson(`/fiat/range?${qs}`);
}

/**
 * Quote a fiat purchase or sale.
 *
 * Throws with a `code` so the UI can explain the specific failure —
 * `FIAT_NOT_ENABLED` is a setting on ChangeNOW's side and needs a different
 * message from `QUOTE_FAILED`, which is a transient upstream problem. A single
 * generic error would make the first look like a bug in our app.
 */
export function getFiatQuote({ from, to, amount }) {
  const qs = new URLSearchParams({ from, to, amount: String(amount) });
  return getJson(`/fiat/quote?${qs}`, { timeout: 20000 });
}

/**
 * Start the purchase. Returns a hosted checkout URL.
 *
 * ─── THIS IS THE CALL THAT EARNS ────────────────────────────────────────────
 * Commission is paid on completed transactions, not on quotes. Until this
 * existed the whole integration could display prices and never make a cent —
 * the same "wired to nothing" shape shipped twice before on the bridge and
 * the gasless swap.
 *
 * The 60s timeout is not laziness: creating an order provisions a checkout
 * session at a payment institution and is genuinely slower than a quote.
 * Aborting early would leave an order created upstream that our user never
 * sees a link to.
 */
export function createFiatOrder({ from, to, amount, address, extraId, email }) {
  return getJson('/fiat/order', {
    method: 'POST',
    timeout: 60000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, amount, address, extraId, email })
  });
}

/** Reset, for tests. */
export function _clearFiatStatus() {
  cachedStatus = null;
}
