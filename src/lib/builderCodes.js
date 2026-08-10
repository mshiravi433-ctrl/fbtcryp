/**
 * BUILDER CODES — taking a fee on somebody else's exchange, without becoming
 * a broker and without ever touching their money.
 * ---------------------------------------------------------------------------
 * ─── THE QUESTION THIS MODULE ANSWERS ───────────────────────────────────────
 * Asked, with a link to the CCXT unified API spec: can we run our own futures,
 * or take a commission on trades, spot and wallet activity, through an API?
 *
 * CCXT itself is the wrong tool and that is not an opinion — see
 * docs/CCXT-BUILDER-CODES-FA.md for the full working. Short version: CCXT is a
 * CLIENT library. Calling it earns nobody anything. The money in that world
 * comes from EXCHANGE BROKER PROGRAMMES (Binance, Bybit, OKX), which all need
 * three things we do not have and mostly cannot get: a KYB'd legal entity, a
 * monthly volume floor (Bybit's lowest broker tier is $2M spot OR $10M
 * derivatives PER MONTH), and — fatally — the user's own API key held in our
 * backend. An API key with trade permission is not custody in the legal sense
 * but it is custody in every sense that matters when it leaks.
 *
 * ─── WHAT REPLACES IT ───────────────────────────────────────────────────────
 * BUILDER CODES. They are the same economics — a fee on somebody's trade,
 * charged by the interface that routed it — with none of the three blockers:
 *
 *   • permissionless: no application, no company, no approval queue
 *   • non-custodial: the user signs their own order with their own wallet;
 *     the fee is enforced by the venue's own contract, not by us
 *   • no volume floor
 *
 * And they are worth an order of magnitude more per dollar of volume than the
 * referral links we already ship. That is the whole point of this module and
 * the arithmetic is in `referralMultiple()` below: a referral pays us a SLICE
 * of the venue's fee; a builder code pays us a fee WE set, in full.
 *
 * ─── WHY THIS IS DATA AND MATH, NOT AN INTEGRATION ──────────────────────────
 * A builder code only pays when WE construct and submit the order. A link,
 * however decorated, earns nothing here — that is the difference between this
 * and lib/venueReferral.js and it is the reason this file ships no URL
 * builder. Wiring an actual order path is a real build per venue (see
 * `integration` on each row), and shipping a half-wired one would be the
 * fourth "wired to nothing" bug in this repo.
 *
 * So this module carries the verified facts and the money arithmetic, the
 * readiness endpoint reports them honestly as NOT BUILT, and nothing on screen
 * claims a revenue line that does not exist.
 */

/**
 * OUR BUILDER FEE, IN BASIS POINTS OF NOTIONAL.
 *
 * ─── WHY 5 AND NOT THE CAP ──────────────────────────────────────────────────
 * Every venue below would let us charge far more — Hyperliquid allows 10 bps
 * on perps and 100 bps on spot, dYdX allows 100 bps, Ostium 50 bps. Taking the
 * cap would be the same mistake the deBridge rate nearly was: earning more per
 * trade by making the product worse than the alternative the user can reach in
 * two taps.
 *
 * The market rate, measured from what the largest builders actually charge:
 *
 *   Axiom 1 bp · Hyperdash 1.5 bps · Based 2.5 bps · Phantom 5 bps ·
 *   MetaMask 10 bps
 *
 * 5 bps sits at Phantom's rate — the largest builder on Hyperliquid by both
 * revenue and users, so it is demonstrably a rate people will pay — and stays
 * below the biggest wallet in the market.
 *
 * ─── AND WHY THE CAP IS 10, NOT THE VENUE'S ─────────────────────────────────
 * A perp fee is charged on NOTIONAL, and notional is leveraged. At 20x, 5 bps
 * of notional is 1% of the money the user actually put up. That multiplication
 * is invisible in the number "5 bps" and is exactly how a fee that reads as
 * tiny becomes the largest cost in the trade. Ten is the ceiling this app will
 * allow regardless of what a venue permits.
 */
const BUILDER_BPS_DEFAULT = 5;
const BUILDER_BPS_MAX = 10;

function resolveBuilderBps() {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_BUILDER_BPS : undefined;
  if (raw == null || raw === '') return BUILDER_BPS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > BUILDER_BPS_MAX) {
    // eslint-disable-next-line no-console
    console.warn(
      `[builder] VITE_BUILDER_BPS="${raw}" is invalid (want an integer 0-${BUILDER_BPS_MAX}); using ${BUILDER_BPS_DEFAULT}`
    );
    return BUILDER_BPS_DEFAULT;
  }
  return n;
}

export const BUILDER_BPS = resolveBuilderBps();
export { BUILDER_BPS_MAX, BUILDER_BPS_DEFAULT };

/**
 * THE VENUES, AND WHAT EACH ONE ACTUALLY COSTS TO SWITCH ON.
 *
 * Every field here was read out of the venue's own developer documentation in
 * August 2026, not from an aggregator or a referral blog. Where a number
 * differs from what this repo previously believed, the row says so — the dYdX
 * row in particular corrects a claim in lib/venueReferral.js that has been
 * wrong since it was written.
 *
 * `capBps` is the VENUE's hard limit. `setupCostUsd` is what it costs us to
 * become eligible, and `refundable` says whether that money is spent or merely
 * parked — a distinction that matters a great deal under a no-spending rule.
 */
export const BUILDER_VENUES = {
  /*
   * ─── THE ONE THAT COSTS NOTHING AT ALL ──────────────────────────────────
   * Ostium's docs: "Any address can act as a builder without prior approval or
   * registration." No account, no deposit, no rent, no signup. The fee is
   * transferred atomically to our address when the trade opens — "with no
   * accrual, claiming, or withdrawal step required", so there is not even a
   * claim transaction to pay gas for.
   *
   * It is also the venue whose markets match what this app already sells:
   * gold, oil, forex and equity indices, the same instruments the Stocks and
   * gold screens already show prices for and cannot currently sell.
   */
  ostium: {
    chain: 'arbitrum',
    capBps: 50,
    /* Charged on the OPENING of a trade only; nothing on close. */
    charged: 'open',
    /* Our payout address is the whole registration. */
    setupCostUsd: 0,
    refundable: true,
    permissionless: true,
    /* An @ostium/builder-sdk client takes { address, feeBps } at construction
       and applies it to every openTrade — the user still signs in their own
       wallet in the self-self mode. */
    integration: 'SDK_ORDER_PATH',
    markets: 'crypto, forex, gold, oil, indices, equities'
  },

  /*
   * ─── THE CORRECTION ─────────────────────────────────────────────────────
   * lib/venueReferral.js says dYdX earns us nothing because their AFFILIATE
   * programme requires $10,000 of personal trading volume. That sentence is
   * true and it is about the wrong programme.
   *
   * Builder codes are a separate, protocol-level mechanism on dYdX and the
   * docs are explicit: "No governance proposal is required to use builder
   * codes." There is no application, no volume floor and no account — the
   * order message simply carries `BuilderCodeParameters { builder_address,
   * fee_ppm }` and the fee is paid out on fill, on top of the fill rather
   * than split out of the venue's own revenue.
   *
   * feePpm is validated into the range (0, 10000], i.e. up to 1%. Our 5 bps
   * is 500 ppm.
   */
  dydx: {
    chain: 'dydx-chain',
    capBps: 100,
    charged: 'fill',
    setupCostUsd: 0,
    refundable: true,
    permissionless: true,
    integration: 'SDK_ORDER_PATH',
    markets: 'crypto perps, 200+ pairs',
    /* Kept as a field rather than prose so the readiness note and the doc
       cannot drift from each other on the thing we previously got wrong. */
    correctsPreviousClaim: 'VOLUME_REQUIRED applies to the affiliate programme, not to builder codes'
  },

  /*
   * ─── THE BIGGEST POT, AND THE ONE THAT COSTS 100 USDC ───────────────────
   * This is where the money in this market actually is: the top ten builders
   * have taken more than $63M, Phantom alone over $20M at 5 bps — the same
   * rate this module defaults to.
   *
   * The 100 USDC is NOT a fee. Hyperliquid's docs require the builder to hold
   * "at least 100 USDC in perps account value" for fees to be collectable; it
   * stays our money and can be withdrawn. Under a strict no-spending rule that
   * still blocks it today, but it is a deposit and not a purchase, and it
   * belongs in a different column from the $9 THORName.
   *
   * The other cost is a UX one that must not be glossed over: every user has
   * to sign an ApproveBuilderFee action from their MAIN wallet, once, before
   * any fee can be charged. That is a real extra step in front of a trade.
   */
  hyperliquid: {
    chain: 'hyperliquid',
    capBps: 10,
    /* Both sides of a perp trade; on spot, the SELL side only, because the
       fee can only be taken in the quote asset. */
    charged: 'fill',
    setupCostUsd: 100,
    refundable: true,
    permissionless: true,
    integration: 'APPROVAL_PLUS_ORDER_PATH',
    markets: 'crypto perps and spot'
  },

  /*
   * ─── SOLANA, AND WHY IT IS LAST DESPITE BEING FREE-ISH ──────────────────
   * Drift's builder codes are permissionless too, but the account model puts
   * two on-chain initialisations in the way: we need a RevenueShareAccount,
   * and every USER needs a RevenueShareEscrow before they can pay us anything.
   * Drift's own docs describe that second one as "an onboarding step provided
   * by the builder", i.e. we pay the rent — roughly 0.035 SOL per Drift
   * account, and historically much more during sybil spikes.
   *
   * So the cost is small but it is PER USER and it is paid by us before any
   * revenue arrives. That is the wrong shape for a product with no float, and
   * it is the reason this sits below the two that cost literally zero.
   */
  drift: {
    chain: 'solana',
    capBps: 20,
    charged: 'fill',
    setupCostUsd: 6,
    refundable: true,
    permissionless: true,
    integration: 'ESCROW_PLUS_ORDER_PATH',
    markets: 'crypto perps on Solana'
  }
};

/**
 * The fee, in money, on one trade.
 *
 * ─── THE NUMBER THIS FUNCTION EXISTS TO MAKE VISIBLE ────────────────────────
 * It takes NOTIONAL, not collateral, because that is what every venue in the
 * table above charges on and it is the step people get wrong. $200 of margin
 * at 10x is $2,000 of notional and the fee is charged on the $2,000.
 *
 * Returns null rather than 0 for unusable input. `Number(null)` is 0 and 0 is
 * finite, so a null-guard has to come first — the same reflex that has printed
 * "$0.00" twice in this codebase.
 */
export function builderFeeUsd({ notionalUsd, bps = BUILDER_BPS }) {
  if (notionalUsd == null || bps == null) return null;
  const n = Number(notionalUsd);
  const b = Number(bps);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isFinite(b) || b < 0) return null;
  return (n * b) / 10_000;
}

/**
 * The same fee expressed against the money the user actually put up.
 *
 * This is the honesty function. 5 bps sounds like nothing; at 20x leverage it
 * is 1% of the trader's capital, charged before the position has moved. Any
 * screen that shows the bps figure must be able to show this one next to it.
 */
export function feeAsPctOfCollateral({ leverage, bps = BUILDER_BPS }) {
  const x = Number(leverage);
  const b = Number(bps);
  if (!Number.isFinite(x) || x <= 0) return null;
  if (!Number.isFinite(b) || b < 0) return null;
  return (b / 100) * x;
}

/**
 * How much notional has to pass through us to earn a given amount.
 *
 * The planning number. It is deliberately the inverse of the fee rather than a
 * forecast: this app has no traffic model and inventing one would produce a
 * confident wrong projection, which is worse than a rate the reader can
 * multiply themselves.
 */
export function notionalNeededFor({ targetUsd, bps = BUILDER_BPS }) {
  const t = Number(targetUsd);
  const b = Number(bps);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (!Number.isFinite(b) || b <= 0) return null;
  return (t * 10_000) / b;
}

/**
 * HOW MANY TIMES BETTER THIS IS THAN THE REFERRAL LINK WE ALREADY SHIP.
 *
 * ─── WHY THIS COMPARISON IS THE POINT ───────────────────────────────────────
 * docs/REFERRAL-LINKS-ANSWER-FA.md worked out that our Avantis referral needs
 * $22,000,000 of somebody else's trading to match $14,300 of our own swap
 * volume. That ratio is not a failure of the link, it is the shape of a
 * referral: the venue charges its fee and hands us a slice of it.
 *
 *   Avantis referral: 5% of their 0.04% fee = 0.002% of notional to us.
 *   Builder code:     our own 0.05% of notional, in full.
 *
 * A referral share is `venueFeePct * sharePct`. A builder fee is just ours. So
 * the multiple is exactly `ourBps / (venueFeeBps * share)`. With the numbers
 * above that is 25× per dollar of volume routed — which is why this is worth
 * a build and the referral links are worth keeping only because they are free.
 *
 * Returns null when the referral pays nothing, because dividing by it would
 * produce Infinity and "infinitely better" is not a number anyone can act on.
 */
export function referralMultiple({ venueFeeBps, sharePct, bps = BUILDER_BPS }) {
  const v = Number(venueFeeBps);
  const s = Number(sharePct);
  const b = Number(bps);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!Number.isFinite(s) || s <= 0) return null;
  if (!Number.isFinite(b) || b <= 0) return null;
  const referralBps = v * (s / 100);
  if (referralBps <= 0) return null;
  return b / referralBps;
}

/**
 * Venues ordered the way we would actually do them: free first, then by how
 * much of somebody else's money has to sit still before we earn anything.
 *
 * Ties broken by cap DESCENDING is deliberately NOT what happens here — a
 * higher cap is not a better venue for the user and sorting by it would be the
 * "route to the worse product because it pays more" failure this project has
 * refused twice. Ties break alphabetically, which is arbitrary and honest.
 */
export function venuesByCost() {
  return Object.entries(BUILDER_VENUES)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.setupCostUsd - b.setupCostUsd) || a.id.localeCompare(b.id));
}

/**
 * What a venue would cost us today, given the no-spending rule.
 *
 * `refundable` is why this is a function and not a number: 100 USDC that stays
 * ours and can be withdrawn is a fundamentally different obstacle from $9 paid
 * to a registrar, and collapsing them into one "cost" field would make the
 * cheapest real option look identical to a purchase.
 */
export function blockerFor(venueId) {
  const v = BUILDER_VENUES[venueId];
  if (!v) return null;
  if (v.setupCostUsd === 0) return 'BUILD';
  return v.refundable ? 'DEPOSIT' : 'PURCHASE';
}
