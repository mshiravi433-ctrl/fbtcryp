/**
 * FIAT BUY & SELL — client side.
 * ---------------------------------------------------------------------------
 * Thin. The partner key, our commission rate and the pair validation all live
 * in `server/fiat.js`, because they decide where revenue goes and must never
 * be settable from a browser.
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
 */
export const FIAT_MONEY = [
  { code: 'usd', symbol: '$', name: 'US Dollar' },
  { code: 'eur', symbol: '€', name: 'Euro' },
  { code: 'gbp', symbol: '£', name: 'British Pound' },
  { code: 'try', symbol: '₺', name: 'Turkish Lira' },
  { code: 'aed', symbol: 'AED', name: 'UAE Dirham' }
];

/** Crypto our own app can then do something useful with. */
export const FIAT_ASSETS = [
  { ticker: 'btc', symbol: 'BTC', name: 'Bitcoin' },
  { ticker: 'eth', symbol: 'ETH', name: 'Ethereum' },
  { ticker: 'usdttrc20', symbol: 'USDT', name: 'Tether (TRON)' },
  { ticker: 'usdtbsc', symbol: 'USDT', name: 'Tether (BNB Chain)' },
  { ticker: 'usdcbsc', symbol: 'USDC', name: 'USD Coin (BNB Chain)' },
  { ticker: 'bnbbsc', symbol: 'BNB', name: 'BNB' },
  { ticker: 'sol', symbol: 'SOL', name: 'Solana' }
];

let cachedStatus = null;

/**
 * Is fiat actually live?
 *
 * Cached for the session: it is a deployment setting, not live data, and
 * re-asking on every render would be pure waste. A failure resolves to
 * `{enabled:false}` at the call site rather than throwing, because the panel
 * must degrade to an explanation instead of a blank screen.
 */
export async function getFiatStatus({ timeout = 10000 } = {}) {
  if (cachedStatus) return cachedStatus;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/fiat/status`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedStatus = await res.json();
    return cachedStatus;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quote a fiat purchase or sale.
 *
 * Throws with a `code` so the UI can explain the specific failure —
 * `FIAT_NOT_ENABLED` is a setting on ChangeNOW's side and needs a different
 * message from `QUOTE_FAILED`, which is a transient upstream problem. A single
 * generic error would make the first look like a bug in our app.
 */
export async function getFiatQuote({ from, to, amount, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const qs = new URLSearchParams({ from, to, amount: String(amount) });
    const res = await fetch(`${API_BASE}/fiat/quote?${qs}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const body = await res.json();
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

/** Reset, for tests. */
export function _clearFiatStatus() {
  cachedStatus = null;
}
