/**
 * FBT LAUNCH — fee schedule.
 *
 * THE FEE LAW (spec §19, made structural)
 * ---------------------------------------------------------------------------
 *   · Fees are a fixed, published number — never computed from the user's
 *     signature, never taken inside a token/liquidity call, never hidden.
 *   · The exact fee amount in the user's own units is shown in the review
 *     step BEFORE any signature, and again in each wallet prompt's summary.
 *   · Fees are paid in an EXPLICIT, separate, user-signed transaction to a
 *     public fee address — or are zero. v1 ships at zero: the launch itself
 *     costs the user only gas.
 *   · FBT never custody-holds a fee: any future fee receiver is a plain
 *     public address published in /api/launch/config.
 *
 * The swap fee (0.70%) is the DEX platform fee that ALREADY applies to every
 * swap on the launched pool (via the existing FeeRouter) — it is listed here
 * so the review screen shows the full cost picture, but it is not charged by
 * the launch flow.
 */

export const LAUNCH_FEES = Object.freeze({
  version: 'fbt.launch-fees.v1',
  /** Bps taken by FBT on a launch. v1 = 0. */
  launchFeeBps: 0,
  /** Bps on swaps that happen on the launched pool (existing platform fee). */
  swapFeeBps: 70,
  /** Bps protocol fee reserved for treasury. v1 = 0. */
  protocolFeeBps: 0
});

/**
 * Compute the fee for a launch plan in the quote asset (human units, as a
 * decimal string). Pure math — the UI and the API both call this so the
 * displayed number and the recorded number can never disagree.
 *
 * feeQuote = quoteAmount × launchFeeBps / 10000
 */
export function computeLaunchFee(quoteAmountHuman, feeBps = LAUNCH_FEES.launchFeeBps) {
  const q = Number(quoteAmountHuman);
  if (!Number.isFinite(q) || q < 0) return '0';
  const bps = Number(feeBps || 0);
  if (bps <= 0) return '0';
  const fee = (q * bps) / 10_000;
  // 12 significant digits is far more than any fee precision needs and keeps
  // the string stable across the client/server boundary.
  return String(Number(fee.toPrecision(12)));
}

export function feeSummary() {
  return {
    ...LAUNCH_FEES,
    notes: {
      launch: '0%',
      swap: '0.70%',
      protocol: '0%'
    }
  };
}
