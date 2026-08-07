/**
 * deBridge DLN — client side.
 * ---------------------------------------------------------------------------
 * Thin, like lib/bridge.js. The affiliate percentage and address live in
 * `server/dln.js`, because they decide where our revenue goes and must never
 * be settable from a browser.
 *
 * ─── WHAT THIS SCREEN HAS TO GET RIGHT, AND WHY IT IS NOT "PICK THE BIGGER
 *     NUMBER" ──────────────────────────────────────────────────────────────
 * DLN quotes an output that is usually BETTER than LI.FI's on a large
 * transfer and WORSE on a small one, and the reason is invisible in the output
 * amount: a fixed protocol fee charged separately in the origin chain's native
 * coin, in the transaction's `value`, not deducted from the tokens.
 *
 * So a naive comparison — "which toAmount is larger" — would recommend
 * deBridge for a $10 bridge where the fixed fee alone is nearly 20% of the
 * transfer. The comparison below therefore refuses to declare a winner
 * whenever the fixed fee cannot be priced, and the UI shows it as a separate
 * line rather than folding it into a total.
 *
 * ─── THIS COMPARISON IS NOT DECORATION; IT CAUGHT A REAL MISTAKE ────────────
 * The server module was first written to charge 0.7% on DLN, because that is
 * more than double the 0.3% LI.FI pays us. Running this comparison against
 * live quotes showed that at 0.7% the user ends up $25 worse off on a $10,000
 * transfer than on the route we already had — we would have been promoting the
 * option that was better for us and worse for them. The rate is now 0.4%,
 * which is the most we can take while still leaving the user ahead. See
 * `dlnFeePercent()` in server/dln.js for the measured table.
 *
 * The break-even moves with the price of the origin chain's native coin, so
 * the answer is recomputed on every quote rather than assumed to hold.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * Chains DLN reaches that our LI.FI list does not include.
 *
 * Linea is the practical addition today. Solana and Tron are supported by DLN
 * as origins but need a non-EVM fee address and a non-EVM signer, so they are
 * deliberately not offered here yet — half-support would produce a route the
 * user can select and not complete.
 */
export const DLN_EXTRA_CHAINS = [{ id: 59144, name: 'Linea', symbol: 'ETH' }];

/** Native coin symbol per chain, for labelling the fixed fee honestly. */
export const NATIVE_SYMBOL = {
  1: 'ETH',
  10: 'ETH',
  56: 'BNB',
  137: 'POL',
  8453: 'ETH',
  42161: 'ETH',
  43114: 'AVAX',
  59144: 'ETH'
};

async function get(path, params, { timeout = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${API_BASE}${path}?${qs}`, {
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

/** A price, with no wallet involved. */
export const getDlnQuote = (params, opts) => get('/dln/quote', params, opts);

/** The signable order. Needs the sender, because the order is theirs. */
export const getDlnTx = (params, opts) => get('/dln/tx', params, opts);

/**
 * The fixed fee, as a decimal string in the origin chain's native coin.
 *
 * String maths on the raw wei value rather than `Number(wei) / 1e18`. A float
 * divide is fine for display at these magnitudes but starts losing digits as
 * soon as anyone reuses this for a comparison, and the identical shortcut is
 * what `toBaseUnits` in lib/bridge.js exists to avoid.
 */
export function fixFeeNative(fixFee, decimals = 18) {
  if (fixFee == null) return null;
  const s = String(fixFee);
  if (!/^\d+$/.test(s)) return null;
  const d = Number(decimals) || 18;
  const padded = s.padStart(d + 1, '0');
  const whole = padded.slice(0, -d);
  const frac = padded.slice(-d).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Compare the two providers for THIS transfer.
 *
 * ─── WHY IT CAN RETURN "UNKNOWN" AND WHY THAT IS THE POINT ──────────────────
 * A winner is declared only when the fixed fee has been converted to the same
 * unit as the token amounts. Without a native-coin price we would be comparing
 * "9.68 USDC out" against "9.94 USDC out, plus 0.001 ETH you also pay" —
 * and picking the larger number would recommend the route that costs the user
 * more while paying us more. That is the one conflict of interest this screen
 * has, so the code refuses to resolve it silently.
 *
 * @param {object} a  { toAmount, label } for LI.FI
 * @param {object} b  { toAmount, fixFee, fixFeeUsd, label } for DLN
 * @param {number} tokenDecimals decimals of the OUTPUT token
 */
export function compareRoutes(a, b, tokenDecimals = 6) {
  const aOut = Number(a?.toAmount);
  const bOut = Number(b?.toAmount);
  if (!Number.isFinite(aOut) || !Number.isFinite(bOut)) return { winner: null, reason: 'MISSING' };

  /*
   * `Number(null)` is 0 and 0 is finite — a trap this repo has hit before, so
   * the null check comes FIRST and is not folded into the finite check.
   */
  if (b?.fixFeeUsd == null) return { winner: null, reason: 'FIXED_FEE_UNPRICED' };

  const scale = 10 ** (Number(tokenDecimals) || 6);
  /* Output tokens here are stablecoins, so base units map to dollars 1:1. */
  const bNet = bOut / scale - Number(b.fixFeeUsd);
  const aNet = aOut / scale;

  if (!Number.isFinite(bNet)) return { winner: null, reason: 'FIXED_FEE_UNPRICED' };
  return {
    winner: bNet > aNet ? 'dln' : 'lifi',
    reason: 'PRICED',
    aNet,
    bNet,
    differenceUsd: Math.abs(bNet - aNet)
  };
}

/**
 * Is the fixed fee large enough relative to the transfer that showing DLN as
 * an option would be misleading?
 *
 * ─── THE THRESHOLD, AND WHY IT IS NOT A HIDDEN FILTER ───────────────────────
 * Measured today, Base -> Arbitrum: a $10 transfer pays a $1.90 fixed fee,
 * about 19%. A $1,000 transfer pays the same $1.90, about 0.19%.
 *
 * The route is not REMOVED when the ratio is bad — hiding an option the user
 * could rationally still want is its own kind of dishonesty, and they may be
 * bridging urgently. It is flagged, loudly, with the actual percentage. Same
 * treatment as the EVM->Tron `severeLoss` flag, which was built for exactly
 * this failure shape.
 */
export const FIXED_FEE_WARN_PERCENT = 3;

export function fixedFeeBurden(fixFeeUsd, transferUsd) {
  if (fixFeeUsd == null || transferUsd == null) return null;
  const fee = Number(fixFeeUsd);
  const total = Number(transferUsd);
  if (!Number.isFinite(fee) || !Number.isFinite(total) || total <= 0) return null;
  const percent = (fee / total) * 100;
  return { percent, severe: percent > FIXED_FEE_WARN_PERCENT };
}
