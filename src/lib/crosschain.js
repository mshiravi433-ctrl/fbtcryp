/**
 * NATIVE-COIN QUOTES — client side.
 * ---------------------------------------------------------------------------
 * Thin, like lib/yields.js and lib/perp.js. The allow-lists and the upstream
 * calls live in `server/crosschain.js`.
 *
 * ─── READ THE COMMENT IN THE SERVER MODULE BEFORE EXTENDING THIS ────────────
 * This is quote-only ON PURPOSE, not because the API lacks the ability.
 * ChangeNOW's terms §11.4 permit them to seize funds from users in restricted
 * jurisdictions — which under §11.1 includes anywhere on an OFAC-equivalent
 * list, and that is most of this app's users. So we show the numbers and hand
 * the user off to ChangeNOW's own site to decide, rather than routing their
 * money through a service that may refuse them halfway.
 *
 * If someone later adds a "create exchange" call here, they will have moved
 * the app from showing information to handling other people's money under
 * terms that let a third party keep it.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * Coins on their own chains that this app cannot otherwise touch.
 *
 * Duplicated from the server deliberately? No — the UI needs the list before
 * any request, and a second copy would drift. It is fetched once with the
 * status call and cached here.
 */
let cachedMeta = null;

export async function getCrosschainStatus({ timeout = 10000 } = {}) {
  if (cachedMeta) return cachedMeta;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/crosschain/status`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedMeta = await res.json();
    return cachedMeta;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quote a native coin into something this app can use.
 *
 * @returns {{estimatedAmount:number|null, minAmount:number|null,
 *            belowMinimum:boolean|null, etaMinutes:string|null}}
 *
 * `estimatedAmount` is null — never 0 — when the pair cannot be priced right
 * now. Zero would render as a real answer meaning "you would get nothing",
 * and a user comparing that against another service would draw exactly the
 * wrong conclusion.
 */
export async function getCrosschainQuote({ from, to, amount, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const qs = new URLSearchParams({ from, to, amount: String(amount) });
    const res = await fetch(`${API_BASE}/crosschain/quote?${qs}`, {
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

/**
 * The URL that actually performs the exchange, on ChangeNOW's own site.
 *
 * ─── WHY WE SEND THEM AWAY RATHER THAN EMBED IT ─────────────────────────────
 * On their site the user meets ChangeNOW's own jurisdiction checks, their
 * refund policy and their support — before any coin moves. Embedding the flow
 * would put our name on a transaction we cannot refund, cannot trace and
 * cannot recover, under terms (§11.4) that allow the funds to be seized.
 *
 * The referral code is appended only when configured. Absent, this is a plain
 * link and behaves identically — the same pattern as the GMX code.
 */
export function exchangeUrl({ from, to, amount }) {
  const base = 'https://changenow.io/exchange';
  const qs = new URLSearchParams({
    from: String(from || ''),
    to: String(to || ''),
    amount: String(amount || ''),
    amountField: 'from'
  });
  const link =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CHANGENOW_LINK_ID) || '';
  /* Their link id is alphanumeric; validated rather than trusted, so a
     malformed value produces a plain link instead of a broken one. */
  if (/^[a-zA-Z0-9]{1,32}$/.test(link)) qs.set('link_id', link);
  return `${base}?${qs.toString()}`;
}
