/**
 * HARDWARE WALLETS — the one affiliate programme that can actually pay us.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS ONE AND NOT THE OTHER TWENTY ──────────────────────────────────
 * A full audit of every "top crypto affiliate programme" list produced almost
 * nothing usable, and the reason was always the same one of three: OFAC
 * sanctions, mandatory KYC, or the programme wanting us to hand our own swap
 * customer to a competitor.
 *
 * The pattern underneath is worth stating plainly, because it predicts the
 * answer for anything considered next:
 *
 *   ANY PROGRAMME THAT SETTLES THROUGH THE BANKING SYSTEM IS CLOSED TO US.
 *   ANY PROGRAMME THAT SETTLES IN CRYPTO IS OPEN.
 *
 * Travala pays 4-5% on flights and hotels and is free to join — and it settles
 * "directly into your nominated bank account" via impact.com, which requires a
 * W-8BEN naming a country of residence. OFAC's own FAQ 54 answers what happens
 * next: "I have an account with a W-8 showing an address in Iran ... you
 * should consider the account restricted based on the W-8 filing." The money
 * never arrives. Bitrefill pays 1% but in STORE CREDIT, which is not money.
 * Koinly and CoinLedger pay PayPal only.
 *
 * Ledger states it on its own affiliate page: "you will receive a commission,
 * in Bitcoins", at "a 10% referral commission for each sale (net sale amount,
 * excluding VAT and shipping)". Trezor pays up to 15% in EUR or BTC with a
 * 30-day cookie. Crypto settlement means no bank, no W-8, no jurisdiction.
 *
 * ─── AND WHY IT IS HONEST TO PUT HERE, WHICH MATTERS MORE ───────────────────
 * A referral only belongs in this app if we would recommend it with no
 * commission at all. This one passes: the entire product is built on "your
 * keys are yours, we never hold your funds", and a hardware wallet is the
 * strongest possible version of that sentence. It is the recommendation we
 * already make in the security copy, now with a link attached.
 *
 * It also does not compete with us — the rule that killed most of the list.
 * Somebody who buys a Ledger still has to swap somewhere, and they arrive with
 * more capital than they had before.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── OFF UNTIL A REAL AFFILIATE ID EXISTS ───────────────────────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * Same pattern as `vault.js` and `venueReferral.js`, and for the same reason:
 * this repo has shipped "wired to nothing" three times (the bridge, the
 * gasless swap, the fiat integration). Every function returns the PLAIN
 * product URL when no id is configured, so the card is useful and truthful
 * from day one and simply starts paying later. There is no half-configured
 * state that produces a broken link.
 *
 * Setting the env vars is the ONLY step. No code change, no redeploy of
 * anything but the variable.
 */

const env = (k) => (typeof import.meta !== 'undefined' ? import.meta.env?.[k] : undefined) || '';

/**
 * The vendors.
 *
 * ─── WHY TWO AND NOT A LONG LIST ────────────────────────────────────────────
 * A page of eight hardware wallets is a comparison-shopping site, not a
 * recommendation, and it pushes the decision back onto somebody who came here
 * to be told. Two is enough to show we are not a single vendor's shopfront.
 *
 * `blurb` is a translation KEY, never a sentence: the copy has to be written
 * by a human in each language. Marketing text about protecting somebody's
 * savings is exactly the copy that must never be machine-translated.
 *
 * NOTE ON `param`: the two programmes use different link shapes. Ledger's
 * affiliate links carry `?r=<id>`; Trezor's carry `?offer_id=&aff_id=`. Rather
 * than encode a half-remembered format, only the documented single-parameter
 * form is built here, and anything more exotic goes in the env var as a full
 * URL. Guessing a tracking format produces a link that works but attributes
 * nothing — revenue that silently never arrives, which is the worst failure
 * mode because it looks exactly like success.
 */
export const HARDWARE_VENDORS = [
  {
    id: 'ledger',
    name: 'Ledger',
    /* Nano models and the Flex/Stax line. The generic shop URL, so a
       discontinued model never turns this into a 404. */
    url: 'https://shop.ledger.com/',
    param: 'r',
    envKey: 'VITE_AFFILIATE_LEDGER',
    blurb: 'hardware.ledgerBlurb',
    /* Stated so the disclosure can quote a real number rather than a vague
       "we may earn something". 10% of net sale, paid in BTC. */
    rate: 10
  },
  {
    id: 'trezor',
    name: 'Trezor',
    url: 'https://trezor.io/',
    param: 'offer_id',
    envKey: 'VITE_AFFILIATE_TREZOR',
    blurb: 'hardware.trezorBlurb',
    rate: 15
  }
];

/**
 * Is a vendor's affiliate id configured?
 *
 * Whitespace is trimmed before the test because an env var set to " " is the
 * single most common way a "configured" flag ends up true while the value is
 * useless.
 */
export const hardwareConfigured = (vendor) => Boolean(String(env(vendor?.envKey)).trim());

/**
 * Build the outbound URL for a vendor.
 *
 * @returns {string} the affiliate URL when an id is set, otherwise the plain
 *          product URL — never null, never a broken link. The caller must be
 *          able to render the card without knowing or caring which it got.
 */
export function hardwareUrl(vendor) {
  if (!vendor?.url) return '';
  const id = String(env(vendor.envKey)).trim();
  if (!id) return vendor.url;

  /*
   * A full URL in the env var wins outright.
   *
   * Both programmes hand out a complete tracking link from their dashboard,
   * and those links sometimes carry several parameters in an order their
   * tracker cares about. Reassembling one from parts is how attribution
   * quietly breaks. If the owner pastes the whole link, use it verbatim.
   *
   * Restricted to https so a mistyped or hostile value cannot become a
   * `javascript:` URL reaching an anchor href.
   */
  if (/^https:\/\//i.test(id)) return id;

  try {
    const u = new URL(vendor.url);
    u.searchParams.set(vendor.param, id);
    return u.toString();
  } catch {
    /* Malformed base URL — fall back to the plain one rather than throwing
       inside a render. */
    return vendor.url;
  }
}

/**
 * The honest sentence about the relationship, or null when there is none.
 *
 * ─── WHY THIS IS NOT OPTIONAL ───────────────────────────────────────────────
 * The moment a link earns us money, the reader is owed that fact before they
 * tap it — not in a footer, not in the terms page. This app already made that
 * call once for the venue links, and it must not quietly stop being true
 * here.
 *
 * Returns null when nothing is configured, so the UI shows no disclosure on a
 * link that genuinely earns nothing. Claiming a commission we do not receive
 * would be its own small dishonesty.
 */
export function hardwareDisclosure(vendor) {
  return hardwareConfigured(vendor) ? 'hardware.disclosure' : null;
}

/** Vendors to render. Always all of them — the card is useful either way. */
export const hardwareVendors = () => HARDWARE_VENDORS;

/** Does ANY vendor currently earn us anything? For tests and diagnostics. */
export const hardwareEarns = () => HARDWARE_VENDORS.some(hardwareConfigured);
