/**
 * CROSS-CHAIN TO TRON — client side.
 * ---------------------------------------------------------------------------
 * ─── WHY TRON, SPECIFICALLY ─────────────────────────────────────────────────
 * A large share of the stablecoin our users actually hold is USDT on TRC-20,
 * because Tron's fees are the lowest of anywhere it is widely available. The
 * app has had `server/xchain.js` — 368 lines, the ONLY route we have that
 * reaches Tron — with zero UI consumers since it was written.
 *
 * ─── WHAT IS AND IS NOT PROVEN ──────────────────────────────────────────────
 * Measured against production before writing this, $1,000 USDC Base → USDT
 * Tron:
 *
 *   "integratorFee": { "amount": "3000000" }   → $3.00, exactly 0.30%
 *   "lossPercent": 0.48,  "severeLoss": false
 *
 * ⚠️ AND THE HALF THAT DOES NOT EARN: 0x refuse fees on a Tron ORIGIN. Not
 * silently — a hard 400 naming the field. The server's `feeSupportedOn()`
 * guard is what makes Tron work at all, because sending the fee fields kills
 * the entire quote. So Tron pays us as a DESTINATION and nothing as a source,
 * and the UI must not imply otherwise.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── THE TRAP THIS FILE EXISTS TO SURFACE ───────────────────────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * Tron charges a near-FLAT account-activation cost on the receiving side.
 * Measured on the same route, same minute:
 *
 *   $10 in    → 8.29 USDT out   = 17.1% lost
 *   $1,000 in → 995.24 USDT out =  0.48% lost
 *
 * Our fee is 0.30% in both. The rest is a fixed cost that is invisible as a
 * percentage until the amount is small — structurally the same trap as the
 * deBridge fixed fee, and the reason both now get an explicit warning rather
 * than a number in small text.
 *
 * The server already computes `lossPercent` and `severeLoss`; this module
 * makes them impossible for a screen to ignore.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/** 0x's identifier for Tron. The string, not the numeric id — see server. */
export const TRON_CHAIN = 'tron';

/** USDT on Tron (TRC-20). The canonical Tether contract, not a wrapper. */
export const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * Is this a well-formed Tron address?
 *
 * Shape-only, and that is stated because it matters: this catches a truncated
 * paste or an EVM address in the wrong box, but it cannot catch a valid-looking
 * address with a transposed character. The UI must still tell the user to check
 * it themselves — a bridge into a wrong address is unrecoverable.
 */
export const isTronAddress = (a) => TRON_ADDRESS.test(String(a ?? '').trim());

/**
 * Origin chains we offer for a Tron destination.
 *
 * Deliberately the stablecoin-carrying EVM chains only. Offering an origin
 * whose only asset is a volatile token would produce a bridge whose output the
 * user cannot sanity-check while it is in flight.
 */
export const TRON_ORIGINS = [
  { id: 8453, name: 'Base' },
  { id: 42161, name: 'Arbitrum' },
  { id: 1, name: 'Ethereum' },
  { id: 56, name: 'BNB Chain' },
  { id: 137, name: 'Polygon' }
];

/**
 * Below this, the flat Tron cost eats an unreasonable share of the transfer.
 *
 * Not a hard block — someone may have a good reason, and refusing outright
 * would be us deciding how they spend their money. It drives a warning the
 * user has to read past, the same treatment the deBridge fixed fee gets.
 */
export const TRON_MIN_SENSIBLE_USD = 50;

export async function getTronQuote(params, { timeout = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${API_BASE}/xchain/quotes?${qs}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error || body?.message || `HTTP ${res.status}`);
      err.code = body?.error;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reduce the response to what a screen needs.
 *
 * `lossPercent` and `severeLoss` are passed straight through from the server
 * rather than recomputed. Deriving them twice is how two places end up
 * disagreeing about whether a transfer is safe, and the server is the side
 * that has both amounts in the same unit.
 */
export function summariseTron(res) {
  const q = res?.quotes?.[0];
  if (!q) return null;

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const f = q.fees ?? {};
  const ourFeeRaw = Array.isArray(f.integratorFees)
    ? f.integratorFees.reduce((n, x) => n + num(x?.amount), 0)
    : num(f.integratorFee?.amount);

  return {
    sellAmount: q.sellAmount ?? null,
    buyAmount: q.buyAmount ?? null,
    minBuyAmount: q.minBuyAmount ?? null,
    /* Both sides are 6-decimal dollar stablecoins on the routes we offer. */
    ourFee: ourFeeRaw / 1e6,
    etaSeconds: Number(q.estimatedTimeSeconds) || null,
    provider: q.steps?.[0]?.provider ?? null,
    allowanceTarget: res.allowanceTarget ?? null,
    tx: q.transaction?.details ?? null,
    /* The server's own numbers. Never re-derived here. */
    lossPercent: res.lossPercent ?? null,
    severeLoss: Boolean(res.severeLoss),
    feeApplied: Boolean(res.feeApplied),
    feeSupported: res.feeSupported !== false,
    liquidityAvailable: res.liquidityAvailable !== false
  };
}

/**
 * Would this amount be eaten by the flat cost?
 *
 * Returns null when the amount is unknown, NOT false. `Number(null)` is 0 and
 * 0 is finite, so a null-tolerant check that folds the two together would
 * report "this is fine" for an amount nobody has entered yet — the wrong
 * direction to be wrong in, and a mistake this repo has made before.
 */
export function tronAmountWarning(amountUsd) {
  if (amountUsd == null) return null;
  const n = Number(amountUsd);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < TRON_MIN_SENSIBLE_USD ? { tooSmall: true, minUsd: TRON_MIN_SENSIBLE_USD } : null;
}
