/**
 * SOLANA SWAP — Jupiter Meta-Aggregator (Swap API V2)
 * ---------------------------------------------------------------------------
 * The EVM side of this app routes through KyberSwap and takes its fee inside
 * the same on-chain transaction. Solana needs an entirely separate path: a
 * different address format, a different signing scheme, and a different
 * aggregator. This module is that path.
 *
 * ─── WHY THE QUOTE GOES THROUGH OUR SERVER ──────────────────────────────────
 * Jupiter's V2 API requires an `x-api-key` header. Putting that key in a
 * `VITE_`-prefixed variable would compile it into the browser bundle and into
 * the APK, where anyone can extract it — the same mistake `geminiDirect.js`
 * documents as a deliberate, known trade-off. A swap key is not a trade-off we
 * should take: a leaked key is billed to us and can be rate-limited by a
 * stranger, taking swaps down for every real user.
 *
 * So the client calls OUR `/api/solana/order`, and the server attaches the key.
 * There is also a keyless fallback at 0.5 RPS for builds with no backend, which
 * is enough for one user tapping a button and honest about its limits.
 *
 * ─── HOW OUR FEE IS COLLECTED ───────────────────────────────────────────────
 * Not the same mechanism as EVM. Jupiter uses a *referral* account:
 *
 *   • We pass `referralAccount` + `referralFee` (in bps) to /order.
 *   • Jupiter keeps 20% of that fee; the rest lands in our referral token
 *     account for whichever mint Jupiter chose to charge in.
 *   • Valid range is 50-255 bps. Our 70 bps (0.70%) sits inside it, so the
 *     rate matches EVM exactly and no second number has to be explained.
 *
 * ⚠️ THE TRAP, STATED PLAINLY: if the `referralTokenAccount` for the fee mint
 * has not been initialised on-chain, Jupiter still returns a valid order and
 * the user's swap still succeeds — but OUR FEE IS SILENTLY ZERO. Nothing
 * fails, nothing warns. That is why `solanaFeeReady()` exists and why the UI
 * must surface it: an unconfigured integration looks identical to a working
 * one from the outside, and would quietly earn nothing forever.
 */

import { FEE_BPS } from './feeBps';
import { PAYOUT_ADDRESSES } from './payout';
import { apiBase } from './apiBase';

/** Jupiter's own hosted API, used only when we have no backend. */
const JUP_PUBLIC = 'https://api.jup.ag/swap/v2';

/** Well-known mints. `So111...112` is wrapped SOL and is what Jupiter expects. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

/**
 * Jupiter's referral fee range, from the V2 docs. Enforced rather than
 * assumed: passing a value outside it makes /order reject the request, and a
 * swap that fails only for users on one chain is a miserable bug to trace.
 */
export const REFERRAL_FEE_MIN_BPS = 50;
export const REFERRAL_FEE_MAX_BPS = 255;

/** Jupiter's cut of OUR fee. Documented as 20% when a referral is active. */
export const JUPITER_REFERRAL_CUT = 0.2;

/**
 * Our referral account, created once on-chain with @jup-ag/referral-sdk.
 *
 * This is NOT the same thing as the payout wallet in `payout.js`. The wallet
 * receives ordinary transfers; the referral account is a program-derived
 * account Jupiter pays integrator fees into. Leaving it unset is a supported
 * state — swaps work, we simply earn nothing — so the code must never assume
 * it exists.
 */
export const REFERRAL_ACCOUNT =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_JUP_REFERRAL_ACCOUNT) || '';

/** The wallet that owns the referral account, shown in the audit screen. */
export const SOLANA_PAYOUT = PAYOUT_ADDRESSES.solana;

/**
 * Is fee collection actually configured?
 *
 * Returns false when swaps would still work but earn us nothing. The Swap
 * screen uses this to avoid promising a fee it is not taking, and the Audit
 * screen uses it to report the real state rather than the intended one.
 */
export function solanaFeeReady() {
  return isSolanaAddress(REFERRAL_ACCOUNT);
}

/**
 * The referral fee we may legally request, clamped into Jupiter's range.
 *
 * Clamping rather than failing is deliberate here, unlike the EVM fee dial
 * which refuses out-of-range values. The reason is different consequences: an
 * EVM misconfiguration overcharges a user, while here the only options are
 * "ask for a legal rate" or "have /order reject every swap". A working swap at
 * the nearest legal rate beats a dead chain, and the clamp is logged.
 */
export function referralFeeBps(bps = FEE_BPS) {
  const n = Number(bps);
  if (!Number.isFinite(n)) return REFERRAL_FEE_MIN_BPS;
  if (n < REFERRAL_FEE_MIN_BPS) {
    // eslint-disable-next-line no-console
    console.warn(
      `[solana] fee ${n}bps is below Jupiter's ${REFERRAL_FEE_MIN_BPS}bps minimum; requesting ${REFERRAL_FEE_MIN_BPS}`
    );
    return REFERRAL_FEE_MIN_BPS;
  }
  if (n > REFERRAL_FEE_MAX_BPS) {
    // eslint-disable-next-line no-console
    console.warn(
      `[solana] fee ${n}bps exceeds Jupiter's ${REFERRAL_FEE_MAX_BPS}bps maximum; requesting ${REFERRAL_FEE_MAX_BPS}`
    );
    return REFERRAL_FEE_MAX_BPS;
  }
  return Math.round(n);
}

/**
 * What we actually keep, after Jupiter's 20% cut.
 * Exposed so the fee disclosure can state the real number instead of implying
 * the whole 0.70% reaches us.
 */
export function netFeeBps(bps = FEE_BPS) {
  return referralFeeBps(bps) * (1 - JUPITER_REFERRAL_CUT);
}

/**
 * Base58 check for a Solana address.
 *
 * Deliberately the same character class used in payout.js. It cannot prove the
 * value decodes to 32 bytes without a base58 decoder, and the payout tests do
 * assert that separately — but for a UI-level guard, rejecting obviously wrong
 * input is the job.
 */
export function isSolanaAddress(addr) {
  return typeof addr === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
}

/** Convert a decimal amount to the integer base units Jupiter expects. */
export function toBaseUnits(amount, decimals) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 18) return null;

  /*
   * String maths, not `n * 10 ** d`.
   *
   * A float multiplication loses precision well inside the range users type:
   * 0.1 SOL at 9 decimals evaluates to 100000000.00000001, and Jupiter rejects
   * a non-integer amount. Splitting on the decimal point and padding is exact
   * for every input a human can enter.
   */
  const [whole, frac = ''] = String(n).includes('e')
    ? [n.toFixed(d), '']
    : String(n).split('.');
  const padded = (frac + '0'.repeat(d)).slice(0, d);
  const joined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return joined === '' ? '0' : joined;
}

/** Convert integer base units back to a human decimal string. */
export function fromBaseUnits(raw, decimals) {
  if (raw == null) return null;
  const s = String(raw);
  const d = Number(decimals) || 0;
  if (d === 0) return s;
  const padded = s.padStart(d + 1, '0');
  const whole = padded.slice(0, -d);
  const frac = padded.slice(-d).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

async function jfetch(url, init) {
  /*
   * Hard 15s deadline. Without it a request over a lossy connection can hang
   * for minutes with the UI spinning — the timeout converts that into an
   * error the fallback path (or the user) can act on.
   */
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
  let res;
  try {
    res = await fetch(url, { ...(init || {}), ...(ctrl ? { signal: ctrl.signal } : {}) });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('QUOTE_NETWORK');
      e.network = true;
      throw e;
    }
    if (err instanceof TypeError) err.network = true;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* Jupiter returns plain text on some gateway errors */
  }
  if (!res.ok) {
    const detail = body?.error || body?.message || text.slice(0, 200);
    const err = new Error(detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * Get a swap order (quote + assembled transaction) from Jupiter.
 *
 * Tries our backend first so the API key stays server-side, then falls back to
 * Jupiter's keyless endpoint. The fallback is rate-limited to 0.5 RPS by
 * Jupiter, which is fine for a person tapping a button and useless for
 * anything automated — stated here so nobody later mistakes it for a
 * production path.
 *
 * @param {object} p
 * @param {string} p.inputMint
 * @param {string} p.outputMint
 * @param {string} p.amount     integer base units, as a string
 * @param {string} [p.taker]    the user's wallet; omit for a quote-only price
 * @param {number} [p.slippageBps]
 */
export async function getSolanaOrder({
  inputMint,
  outputMint,
  amount,
  taker,
  slippageBps
}) {
  if (!isSolanaAddress(inputMint) || !isSolanaAddress(outputMint)) {
    throw new Error('BAD_MINT');
  }
  if (inputMint === outputMint) throw new Error('SAME_TOKEN');
  if (!amount || !/^\d+$/.test(String(amount)) || String(amount) === '0') {
    throw new Error('BAD_AMOUNT');
  }

  const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount) });
  if (taker) {
    if (!isSolanaAddress(taker)) throw new Error('BAD_TAKER');
    params.set('taker', taker);
  }
  if (Number.isFinite(slippageBps)) params.set('slippageBps', String(Math.round(slippageBps)));

  /*
   * Only ask for a fee when the referral account exists. Sending
   * `referralFee` without a usable account does not error — Jupiter simply
   * ignores it — but it would make the request look configured in logs while
   * earning nothing, which is exactly the confusion to avoid.
   */
  if (solanaFeeReady()) {
    params.set('referralAccount', REFERRAL_ACCOUNT);
    params.set('referralFee', String(referralFeeBps()));
  }

  // 1. our backend — keeps the API key off the device
  try {
    return await jfetch(`${apiBase()}/solana/order?${params}`);
  } catch (err) {
    // A 4xx from our own server is a real answer (bad mint, no route); only a
    // transport/5xx failure means "no backend deployed", so only then fall back.
    if (err.status && err.status < 500) throw err;
  }

  // 2. Jupiter keyless — 0.5 RPS, prototyping only
  return jfetch(`${JUP_PUBLIC}/order?${params}`);
}

/**
 * Submit a transaction the user has signed.
 *
 * `partiallySignTransaction` is the right primitive on the client: JupiterZ
 * (RFQ) orders need a market-maker signature added afterwards during /execute,
 * so a fully-sealed transaction would be rejected on exactly the routes that
 * give the best price.
 */
export async function executeSolanaOrder({ signedTransaction, requestId }) {
  if (!signedTransaction || !requestId) throw new Error('MISSING_ORDER');
  const body = JSON.stringify({ signedTransaction, requestId });
  const headers = { 'Content-Type': 'application/json' };

  try {
    return await jfetch(`${apiBase()}/solana/execute`, { method: 'POST', headers, body });
  } catch (err) {
    if (err.status && err.status < 500) throw err;
  }
  return jfetch(`${JUP_PUBLIC}/execute`, { method: 'POST', headers, body });
}

/**
 * Human-readable reason an order could not be built.
 *
 * Jupiter returns `transaction: ""` with an errorCode whose MEANING DEPENDS ON
 * THE ROUTER — code 2 is "insufficient SOL for gas" on the aggregators and
 * "missing associated token account" on JupiterZ. Mapping on the code alone
 * would confidently show the wrong reason, so both fields are used.
 */
export function orderErrorKey(order) {
  if (!order || order.transaction == null) return null;
  if (order.transaction !== '') return null;

  const code = Number(order.errorCode);
  const rfq = order.router === 'jupiterz';

  if (rfq) {
    if (code === 1) return 'INSUFFICIENT_BALANCE';
    if (code === 2) return 'NO_TOKEN_ACCOUNT';
    if (code === 3) return 'NO_ROUTE';
    return 'ORDER_FAILED';
  }
  if (code === 1) return 'INSUFFICIENT_BALANCE';
  if (code === 2) return 'INSUFFICIENT_GAS';
  if (code === 3) return 'BELOW_MINIMUM';
  return 'ORDER_FAILED';
}

/** True when /execute reported an on-chain success. */
export const executeSucceeded = (r) => r?.status === 'Success' && Number(r?.code) === 0;
