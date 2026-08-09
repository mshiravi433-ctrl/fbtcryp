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
 * Avantis referral code. Public by design, like the GMX one.
 *
 * ─── WHY THIS VENUE WAS ADDED ───────────────────────────────────────────────
 * Asked how futures could earn. The three venues already listed answer that
 * badly: dYdX needs $10,000 of volume before a referral pays anything,
 * ApolloX has no programme at all, and GMX — the one that does work — is
 * crypto-only.
 *
 * Avantis is the one perps venue found that is permissionless like GMX AND
 * covers forex, metals, commodities, indices and equities. From their own
 * referral page: "Avantis features a FULLY PERMISSIONLESS referral system,
 * meaning anyone (any trader, LP, community member, or influencer) can be a
 * referrer" and "Referrers: Earn 5% Rebates". No volume gate, no application,
 * no approval queue — the same shape as GMX, which is why it costs nothing to
 * prepare and only a wallet signature to switch on.
 *
 * It is also the venue whose markets match what this app already sells: we
 * list tokenised gold and tokenised equities, and Avantis is where someone
 * would go to take a leveraged view on the same things.
 */
/*
 * ─── REGISTERED 2026-08-09, SO THE DEFAULT IS THE REAL CODE ─────────────────
 * Confirmed on Base, not taken on trust. Transaction
 * 0x05d5708acd26efe1a32d6a51699dffde93513e45954218456bf3ebe02df2c869 succeeded
 * in block 49725972 and its calldata decodes to selector 0x36def2c8 with a
 * single UTF-8 argument: `fbtswap`. That is the code, on-chain, bound to
 * 0xF0b09A0c472100bfa70b666442d77Db6D35dB3D5.
 *
 * ─── WHY THIS IS A DEFAULT AND NOT ONLY AN ENV VAR ──────────────────────────
 * The env var still wins if set, but leaving the default empty would have
 * meant earning zero on the ANDROID BUILD indefinitely: `VITE_AVANTIS_REF_CODE`
 * is not in the `env:` block of .github/workflows/build-apk.yml, so Vite bakes
 * the empty default into the APK no matter what is configured in Vercel. The
 * agent token is not permitted to edit workflow files, so a code that lives
 * only in an env var is a code the app never carries on the platform most of
 * our users are on.
 *
 * A referral code is a public identifier — it is meant to be inside a link we
 * hand out — so committing it breaks no secret-handling rule. The rule is
 * about secrets, and this is the opposite of one.
 */
export const AVANTIS_CODE = env('VITE_AVANTIS_REF_CODE') || 'fbtswap';

/**
 * UTEX campaign id. Public by design, like the two above.
 *
 * ─── WHY THIS ONE SURVIVED THE AUDIT WHEN THE OTHERS DID NOT ────────────────
 * Asked to look hard for platforms we had missed. Most of the shortlist failed
 * for the same two reasons — a mandatory API key, or terms that name Iran. The
 * full list and the evidence for each is in docs/API-AUDIT-FA.md.
 *
 * UTEX clears both bars, and for an unusual reason: it settles ENTIRELY IN
 * USDT and never touches the banking system. Its own partner guide says the
 * platform gives "investors and traders worldwide simple and truly free access
 * to the US market — no matter where they live or what market restrictions
 * they face". There is no W-8BEN, no bank transfer, and therefore none of the
 * machinery that blocks every other stock broker on the list.
 *
 * Attribution is a plain `?campaignId=` on any UTEX URL, so it needs no API
 * integration at all — the same shape as the GMX and Avantis codes.
 *
 * ⚠️ WHAT THE USER MUST BE TOLD, AND IS: UTEX is registered in Saint Vincent
 * and the Grenadines and holds NO broker licence. Its "stocks" are margin
 * positions settled in USDT, not shares — the buyer is not on any shareholder
 * register and has no investor-compensation scheme behind them. That is a
 * materially different product from the tokenised equities this app already
 * sells, which are backed 1:1 by real shares in custody, and the screen must
 * not let the two blur together.
 */
/*
 * Registered 2026-08-09. The partner tool produced
 * `https://utex.io/?campaignId=517433`, so 517433 is the campaign id.
 *
 * Defaulted for the same reason as the Avantis code above: it is absent from
 * the APK workflow's env block, so an env-var-only value earns nothing on
 * Android. A campaign id is a public identifier by construction — it travels
 * in the query string of a link we publish.
 */
export const UTEX_CAMPAIGN = env('VITE_UTEX_CAMPAIGN_ID') || '517433';

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
  avantis: {
    /* 5% of the referred trader's fees, permissionless, no volume minimum. */
    earns: true,
    /* Their docs also give the referee a fee discount, so the link is good
       for the user as well — the same test applied to the GMX link. */
    userBenefit: true,
    /*
     * ─── `code`, NOT `ref`, AND ON /referral, NOT /trade ────────────────────
     * This was wrong and would have earned exactly zero while looking correct.
     * We had `param: 'ref'` appended to `/trade`, which is the GMX convention
     * copied across without checking. Avantis does not read `ref` anywhere.
     *
     * The evidence is not a guess: after registering the code, Avantis' own
     * UI produced the share link
     *
     *     https://www.avantisfi.com/referral?code=fbtswap
     *
     * and third-party listings of other people's Avantis codes use the
     * identical `avantisfi.com/referral?code=…` shape. Both the PARAMETER NAME
     * and the PATH differ from what we had, so appending to /trade would have
     * produced a link that loads a perfectly good trading page and attributes
     * the trader to nobody.
     *
     * `base` overrides the caller's URL when — and only when — a code exists.
     * With no code the caller's own /trade link is returned untouched, so the
     * "no half-configured state can break a link" property is preserved.
     */
    param: 'code',
    base: 'https://www.avantisfi.com/referral'
  },
  utex: {
    /* 40-60% of the referred trader's fees, by cumulative referred volume. */
    earns: true,
    /*
     * FALSE, deliberately, and it is the only earning venue here marked so.
     * GMX and Avantis both discount the referee's fees, so those links are
     * genuinely good for the user. UTEX gives a signup bonus that must be
     * activated by an account manager, which is not a reliable benefit we can
     * promise on their behalf. Claiming one we cannot guarantee is worse than
     * claiming none.
     */
    userBenefit: false,
    param: 'campaignId'
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
/**
 * The configured code for a venue, or ''.
 *
 * ─── WHY THIS IS ITS OWN FUNCTION ───────────────────────────────────────────
 * It was inlined in `withReferral`, and `venueDisclosure` had its own copy
 * that only ever looked at GMX:
 *
 *   isValidGmxCode(venueId === 'gmx' ? GMX_CODE : '')
 *
 * For any venue that was not GMX that expression is `isValidGmxCode('')`,
 * which is always false. So the moment the Avantis code is registered, links
 * would correctly carry it and start earning while the notice on screen kept
 * telling the user we earn nothing from this venue.
 *
 * That is the wrong direction to be wrong in — we would be taking a share and
 * denying it — and it is invisible from the outside, because the link works.
 * Both callers now read the same source, so a new venue cannot be half-wired.
 *
 * Every venue uses the same code shape (letters, digits, underscore) and the
 * same validator: a lax check on one of them is how a malformed code silently
 * earns nothing, which is exactly what the LI.FI integrator id did.
 */
export function referralCodeFor(venueId) {
  if (venueId === 'gmx') return GMX_CODE;
  if (venueId === 'avantis') return AVANTIS_CODE;
  if (venueId === 'utex') return UTEX_CAMPAIGN;
  return '';
}

export function withReferral(venueId, url) {
  const cfg = VENUE_REFERRAL[venueId];
  if (!cfg?.earns || !cfg.param) return url;
  if (typeof url !== 'string' || !url) return url;

  const code = referralCodeFor(venueId);
  if (!isValidGmxCode(code)) return url;

  try {
    /*
     * Some venues attribute on a DIFFERENT page from the one we link to.
     * Avantis reads `?code=` on /referral and ignores it on /trade, so
     * decorating the caller's /trade URL would be a silent zero. Swapping the
     * base happens only once a valid code exists — see the `base` note in
     * VENUE_REFERRAL.
     */
    const u = new URL(cfg.base ?? url);
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
  /*
   * Reads the SAME source `withReferral` uses. It used to hard-code GMX, so
   * every other venue reported 'none' even once its code was live — we would
   * have been earning while telling the user we were not. See
   * `referralCodeFor` for the full explanation.
   */
  return isValidGmxCode(referralCodeFor(venueId)) ? 'earning' : 'none';
}

/** Do we earn from ANY venue on screen? Drives which notice the page shows. */
export function anyVenueEarns(venueIds = []) {
  return venueIds.some((id) => venueDisclosure(id) === 'earning');
}
