/**
 * OUTBOUND REFERRAL LINKS — revenue that is not a swap.
 * ---------------------------------------------------------------------------
 * ─── THE HOLE THIS CLOSES ───────────────────────────────────────────────────
 * The Perp screen sends people to GMX, dYdX and ApolloX. The Earn screen sends
 * them to PancakeSwap, Venus and Lido. Every one of those links is a user we
 * found, informed and handed over — and we earn EXACTLY NOTHING from any of
 * them. The screens even say so, honestly, in a notice.
 *
 * Some of that is unavoidable and this module says which parts. But one of
 * them is free money we have simply not collected.
 *
 * ─── WHAT WAS ACTUALLY CHECKED, PROTOCOL BY PROTOCOL ────────────────────────
 * GMX — YES. Their docs are unambiguous: "Anyone can create a Tier 1 code",
 *   paying the affiliate 5% of the opening/closing fees of referred traders,
 *   with NO volume requirement. That last part is what makes it usable for us:
 *   dYdX requires $10,000 of personal trading volume before it will issue a
 *   code, and Hyperliquid requires $10,000 of volume for a referral code or
 *   100 USDC on deposit for a builder code. We have none of those. GMX asks
 *   for a single on-chain transaction.
 *
 *   Verified live on Arbiscan rather than assumed: `setTraderReferralCode`
 *   transactions land on ReferralStorage every few minutes and cost about
 *   $0.02 in gas. The programme is alive and the barrier is two cents.
 *
 * dYdX — NO, for us. Their own help centre: affiliates "must meet specific
 *   eligibility criteria, including trading at least $10,000 on dYdX".
 *
 * Hyperliquid — NO, for us. Their docs: a referral code needs $10,000 of
 *   volume; a builder code needs "at least 100 USDC in perps account value".
 *
 * ApolloX / PancakeSwap / Venus — no permissionless integrator programme
 *   found. Left as plain links, and the UI keeps saying we earn nothing.
 *
 * Aave / Morpho — NO. There is no permissionless referral, and in April 2026
 *   Aave governance voted to direct interface revenue to tokenholders.
 *
 * Lido / Rocket Pool / Jito / Marinade — NO. Their fee is a cut of staking
 *   REWARDS taken by the protocol; there is no integrator share to claim.
 *
 * ─── WHY THIS IS SAFE TO SHIP BEFORE ANY CODE EXISTS ────────────────────────
 * Every function here returns the PLAIN url when no code is configured. So
 * shipping this today changes nothing for the user and earns nothing; the
 * moment the owner registers `fbtswap` on GMX and sets one env var, the same
 * links start paying. There is no half-configured state that breaks a link,
 * which is the failure mode that matters when the link is how somebody
 * reaches their money.
 *
 * ─── AND WHY THE USER IS TOLD ───────────────────────────────────────────────
 * A referral link is not free for the person clicking it — on GMX it is
 * actively GOOD for them (a referred trader gets a 5% fee discount they would
 * not otherwise have), but they still deserve to know the relationship exists.
 * `venueDisclosure()` gives the UI the honest sentence, per venue, and the
 * Perp screen's "we earn nothing from these" notice must switch to it rather
 * than keep claiming something that stopped being true.
 */

const env = (k) => (typeof import.meta !== 'undefined' ? import.meta.env?.[k] : undefined) || '';

/**
 * Our GMX affiliate code, once registered.
 *
 * A `VITE_` variable is correct here and is NOT a leak: a referral code is
 * public by design — it is embedded in a link we want shared. The rule this
 * repo enforces is about SECRETS, and this is the opposite of one.
 *
 * Empty until the owner registers it. See docs/GMX-REFERRAL-FA.md.
 */
export const GMX_CODE = env('VITE_GMX_REF_CODE');

/**
 * GMX referral codes are on-chain bytes32 and the docs restrict them to
 * letters, digits and underscores, up to 20 characters. They are also
 * CASE-SENSITIVE, which is the trap: `FBTSwap` and `fbtswap` are two different
 * codes and only one of them exists. So the value is validated, never
 * "normalised" — lower-casing it here would silently point at a code nobody
 * owns and earn zero forever, which is precisely how the LI.FI integrator id
 * failed before it was caught.
 */
export function isValidGmxCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,20}$/.test(code);
}

/**
 * Venues we can currently earn from, and what the arrangement is.
 *
 * `earns: false` entries are here on purpose rather than omitted — the UI has
 * to be able to say "this one pays us, this one does not" for every link it
 * shows, and a missing entry would silently render as the wrong claim.
 */
export const VENUE_REFERRAL = {
  gmx: {
    /* 5% of the referred trader's opening/closing fees, Tier 1, permissionless. */
    earns: true,
    /* The referred trader gets 5% off their fees — this link is good for them. */
    userBenefit: true,
    param: 'ref'
  },
  dydx: { earns: false, userBenefit: false, reason: 'VOLUME_REQUIRED' },
  apx: { earns: false, userBenefit: false, reason: 'NO_PROGRAMME' },
  hyperliquid: { earns: false, userBenefit: false, reason: 'DEPOSIT_REQUIRED' }
};

/**
 * Attach our referral code to a venue URL, when we have one.
 *
 * Returns the URL UNCHANGED when there is no code, when the code is malformed,
 * or when the venue has no programme. That is the whole safety property: this
 * function can never produce a broken link, only a plain one.
 *
 * The existing query string and hash are preserved. GMX's app is hash-routed
 * (`https://app.gmx.io/#/trade`), and naively appending `?ref=` after the hash
 * would put the parameter somewhere the app never reads it — the link would
 * look right and attribute nothing.
 */
export function withReferral(venueId, url) {
  const cfg = VENUE_REFERRAL[venueId];
  if (!cfg?.earns || !cfg.param) return url;
  if (typeof url !== 'string' || !url) return url;

  const code = venueId === 'gmx' ? GMX_CODE : '';
  if (!isValidGmxCode(code)) return url;

  try {
    const u = new URL(url);
    /*
     * GMX reads `ref` from the query INSIDE the hash route, e.g.
     * `https://app.gmx.io/#/trade/?ref=CODE`. Verified against the format in
     * their own docs rather than guessed, because a parameter in the wrong
     * half of the URL is a silent zero.
     */
    if (u.hash) {
      const [path, existing = ''] = u.hash.split('?');
      const qs = new URLSearchParams(existing);
      qs.set(cfg.param, code);
      /* GMX's documented link ends the path with a slash before the query. */
      const withSlash = path.endsWith('/') ? path : `${path}/`;
      u.hash = `${withSlash}?${qs.toString()}`;
      return u.toString();
    }
    u.searchParams.set(cfg.param, code);
    return u.toString();
  } catch {
    /* An unparseable URL is a bug elsewhere; do not make it a broken link. */
    return url;
  }
}

/**
 * Which honest sentence should the UI show about this venue?
 *
 * Three distinct states, because collapsing them would be a lie in one
 * direction or the other:
 *
 *   'earning'   — we get a share AND the user gets a discount. Say both.
 *   'none'      — we get nothing. The existing notice is still true.
 *   'pending'   — the venue pays, but we have not registered yet, so today we
 *                 earn nothing. Treated exactly like 'none' for the user,
 *                 because what matters to them is what is true right now.
 */
export function venueDisclosure(venueId) {
  const cfg = VENUE_REFERRAL[venueId];
  if (!cfg?.earns) return 'none';
  return isValidGmxCode(venueId === 'gmx' ? GMX_CODE : '') ? 'earning' : 'none';
}

/** Do we earn from ANY venue on screen? Drives which notice the page shows. */
export function anyVenueEarns(venueIds = []) {
  return venueIds.some((id) => venueDisclosure(id) === 'earning');
}
