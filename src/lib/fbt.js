/**
 * FBT — the in-app balance that a real token would one day replace.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS INSTEAD OF AN ACTUAL TOKEN ─────────────────────────────
 * Asked whether we could issue our own coin and make it swappable, like CAKE.
 * The full answer is in docs/FBT-TOKEN-FA.md; the short version is that the
 * ERC-20 contract costs $2-5 in gas and is worthless on its own, because price
 * and tradability come from a LIQUIDITY POOL — real money, locked. The market
 * rate for a working launch in 2026 is $35k-$280k, against a standing "no
 * money to spend" constraint.
 *
 * And the sequencing matters more than the money. CAKE shipped AFTER
 * PancakeSwap had users. A token keeps existing users; it does not create
 * them. Issuing one today would mean a pool thin enough for the first sizeable
 * buyer to drain, and a price chart that mostly goes down — which damages the
 * exchange's credibility, not just the holder's wallet.
 *
 * ─── SO THIS IS THE HONEST HALF, BUILT NOW, FOR FREE ────────────────────────
 * `points` has been accruing on every swap, referral and check-in since long
 * before this file. This module gives that number a NAME, a SYMBOL and — the
 * part that actually matters — a JOB, so that when a token is affordable the
 * conversion is one-to-one and nobody was ever promised something undeliverable.
 *
 * ─── THE RULE THIS FILE ENFORCES ────────────────────────────────────────────
 * FBT is NOT tradable, NOT withdrawable, and has NO price. It is a loyalty
 * balance. Every string in the UI says so. The moment we imply a dollar value
 * we have made an unregistered offering out of a discount scheme, which is the
 * exact licensing exposure this whole app is built to avoid.
 */

/** 1 point = 1 FBT. Deliberately trivial: a ratio invites a "rate" and a rate
 *  invites a price. */
export const POINTS_PER_FBT = 1;

/**
 * Benefits, by balance.
 *
 * ─── WHY FEE DISCOUNT IS THE FIRST TIER ─────────────────────────────────────
 * It is the only benefit here that is entirely ours to give. Everything on
 * this list must be deliverable by us alone, with no third party's permission,
 * or it becomes another promise that depends on somebody else's API staying
 * up — the failure mode this project has hit repeatedly.
 *
 * `feeBps` is the DISCOUNT off our 70 bps swap fee, not the fee itself. Capped
 * at 20 bps: below 50 bps the swap stops covering the aggregator's own cost
 * and we would be paying users to trade, which is how a loyalty scheme turns
 * into a leak.
 */
export const FBT_TIERS = [
  { id: 'base', min: 0, feeBps: 0, adDays: 0 },
  { id: 'bronze', min: 500, feeBps: 5, adDays: 0 },
  { id: 'silver', min: 2000, feeBps: 10, adDays: 1 },
  { id: 'gold', min: 6000, feeBps: 15, adDays: 7 },
  { id: 'diamond', min: 15000, feeBps: 20, adDays: 30 }
];

/** Largest discount we will ever give, as a hard ceiling rather than a
 *  consequence of the table above being edited carelessly. */
export const MAX_DISCOUNT_BPS = 20;

/**
 * Convert a points balance to FBT.
 *
 * `Number(null)` is 0 and 0 is finite, so the guard is explicit rather than
 * relying on `|| 0` — the same trap that has produced "$0.00" prices twice in
 * this codebase.
 */
export function fbtFromPoints(points) {
  const n = Number(points);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n / POINTS_PER_FBT);
}

/** The tier a balance sits in, and how far the next one is. */
export function fbtTier(balance) {
  const b = Number.isFinite(Number(balance)) ? Math.max(0, Number(balance)) : 0;

  let current = FBT_TIERS[0];
  for (const t of FBT_TIERS) if (b >= t.min) current = t;

  const next = FBT_TIERS.find((t) => t.min > b) ?? null;

  return {
    tier: current,
    next,
    toNext: next ? next.min - b : 0,
    /*
     * Progress through the CURRENT band, not through the whole ladder. A bar
     * that fills relative to the final tier barely moves for months and reads
     * as broken.
     */
    progress: next && next.min > current.min
      ? Math.min(1, Math.max(0, (b - current.min) / (next.min - current.min)))
      : 1
  };
}

/**
 * ─── NOT YET WIRED INTO THE LIVE SWAP, DELIBERATELY ─────────────────────────
 * `feeBpsFor` is exported and tested but the swap path still uses the flat
 * FEE_BPS. That is a considered stop, not an oversight.
 *
 * FEE_BPS is threaded through eight places including the 0x/KyberSwap quote
 * parameters and the hand-encoded calldata, and the fee the QUOTE was built
 * with must equal the fee the TRANSACTION carries. A mismatch does not show up
 * as a wrong number on screen — it shows up as a reverted swap, or as an
 * aggregator quoting one fee and the chain taking another.
 *
 * So the discount is displayed as the benefit it will be, and switching the
 * swap over is its own change with its own verification against a real quote.
 * Shipping half of it silently is how the Avantis link ended up working
 * perfectly while earning nothing.
 */

/**
 * The swap fee this balance actually pays, in bps.
 *
 * Clamped at both ends. The floor stops a mis-edited table from producing a
 * negative fee; the ceiling stops it exceeding the base fee and silently
 * charging more than a user with no balance.
 */
export function feeBpsFor(baseBps, balance) {
  const base = Number(baseBps);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const disc = Math.min(MAX_DISCOUNT_BPS, fbtTier(balance).tier.feeBps);
  return Math.max(0, Math.min(base, base - disc));
}
