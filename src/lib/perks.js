import { TIERS, tierFor } from './ranks';
import { GMX_CODE, AVANTIS_CODE, UTEX_CAMPAIGN, isValidGmxCode, withReferral } from './venueReferral';

/**
 * RANK PERKS — what points are actually FOR.
 * ---------------------------------------------------------------------------
 * ─── THE QUESTION THIS ANSWERS ──────────────────────────────────────────────
 * Asked whether each rank could unlock redeemable services, so users get
 * something real for their points, and whether that could earn revenue.
 *
 * Both yes — but only if the thing behind the code is real. That constraint
 * decided the entire design, so it is worth stating before the code:
 *
 * ─── WHY THESE ARE NOT GIFT CARDS ───────────────────────────────────────────
 * The obvious build is a shop: spend points, receive a voucher for flights,
 * games, shopping. Every route to that was checked and every one fails for us:
 *
 *   • Bitrefill — 7,000 products, but their affiliate page states the
 *     commission is paid in "Bitrefill Store Credits". Credit we cannot spend
 *     is not revenue.
 *   • Travala — pays real cash, 4-5.5% on flights and hotels, but only via
 *     Impact.com, which requires a tax form and a bank account. Already
 *     recorded as blocked in docs/REVENUE-FULL-REVIEW-FA.md under OFAC FAQ 54.
 *   • Buying voucher inventory ourselves — needs working capital we do not
 *     have, and turns a non-custodial exchange into a merchant holding stock.
 *
 * Issuing a code for a voucher we cannot actually deliver would be the worst
 * possible version of this feature: the user spends points, receives a code,
 * and discovers it buys nothing. That is not a bug, it is a broken promise.
 *
 * ─── SO A PERK IS A REAL DISCOUNT ON A REAL VENUE ───────────────────────────
 * Every perk here routes to a venue we have MEASURED paying us, and the
 * benefit to the user is the referral discount that venue already gives —
 * GMX's own docs: a Tier 1 code gives the referred trader a 5% fee discount
 * while paying the affiliate 5%. That is the honest shape of this: the user
 * genuinely pays less, we genuinely earn, and nothing is invented.
 *
 * ─── AND WHY A PERK CAN BE LOCKED BUT NEVER FAKE ────────────────────────────
 * A perk whose venue code is not configured yet is `available: false` with a
 * stated reason, exactly like `revenueReadiness()` on the server. It is never
 * shown as claimable and then found to be empty.
 */

/**
 * Points are NOT spent.
 *
 * ─── THIS IS THE MOST IMPORTANT DECISION IN THE FILE ────────────────────────
 * The instinct is to deduct points on redemption, like a shop. That would be
 * wrong here for a reason lib/ranks.js already documents: points are "a score,
 * not a currency — they buy nothing, transfer to nobody". Making them
 * spendable turns them into a balance, and a balance in a non-custodial
 * exchange is the exact confusion the header's NX chip was removed to avoid.
 *
 * It is also worse product design. Deducting points would demote the user's
 * rank the moment they use a perk, which punishes the behaviour we want. A
 * rank is a THRESHOLD you cross and keep; the perks it unlocks stay unlocked.
 */
export const PERKS = [
  {
    id: 'gmxFee',
    tier: 'bronze',
    venue: 'gmx',
    /* GMX docs, Tier 1: trader discount 5%, affiliate reward 5%. */
    benefitPct: 5,
    url: 'https://app.gmx.io/#/trade'
  },
  {
    id: 'avantisFee',
    tier: 'silver',
    venue: 'avantis',
    /* Avantis: "Referrers: Earn 5% Rebates", fully permissionless. */
    benefitPct: 5,
    url: 'https://www.avantisfi.com/trade'
  },
  {
    id: 'utexStocks',
    tier: 'gold',
    venue: 'utex',
    benefitPct: null,
    url: 'https://utex.io/'
  }
];

/** Rank order, so a higher tier inherits everything below it. */
const TIER_ORDER = TIERS.map((t) => t.id);

/**
 * Has this user reached the tier a perk requires?
 *
 * Compares POSITION in the ladder, not points, so adding a tier between two
 * existing ones cannot silently revoke a perk somebody already had.
 */
export function tierMeets(userTierId, requiredTierId) {
  const a = TIER_ORDER.indexOf(userTierId);
  const b = TIER_ORDER.indexOf(requiredTierId);
  if (a < 0 || b < 0) return false;
  return a >= b;
}

/** The configured code for a venue, or '' — the same source venueReferral uses. */
function codeFor(venue) {
  if (venue === 'gmx') return GMX_CODE;
  if (venue === 'avantis') return AVANTIS_CODE;
  if (venue === 'utex') return UTEX_CAMPAIGN;
  return '';
}

/**
 * Every perk, with its live state for this user.
 *
 * Three states, deliberately distinct — collapsing them would lie in one
 * direction or the other:
 *
 *   locked      — the user has not reached the tier yet. Shown, with the
 *                 points needed, because an invisible reward motivates nobody.
 *   unavailable — the tier is reached but the venue code is not registered, so
 *                 there is no discount to give. Says so rather than handing
 *                 over a link that quietly does nothing.
 *   ready       — reached and configured. The link carries the code.
 */
export function perksFor(points) {
  const userTier = tierFor(Number(points) || 0);

  return PERKS.map((p) => {
    const unlocked = tierMeets(userTier.id, p.tier);
    const code = codeFor(p.venue);
    const configured = isValidGmxCode(code);
    const required = TIERS.find((t) => t.id === p.tier);

    return {
      ...p,
      unlocked,
      configured,
      /* Only a perk that is BOTH unlocked and backed by a real code. */
      available: unlocked && configured,
      requiredPoints: required?.min ?? 0,
      pointsToGo: unlocked ? 0 : Math.max(0, (required?.min ?? 0) - (Number(points) || 0)),
      tierColor: required?.color ?? null,
      tierIcon: required?.icon ?? null,
      /*
       * The code shown to the user IS the venue's referral code — not a
       * generated coupon. Generating our own would imply a redemption system
       * behind it that does not exist, and the user would eventually find out.
       */
      code: unlocked && configured ? code : null,
      link: unlocked && configured ? withReferral(p.venue, p.url) : null
    };
  });
}

/** How many perks this user can use right now. Drives the summary line. */
export const availablePerkCount = (points) => perksFor(points).filter((p) => p.available).length;
