/**
 * SHOP — outbound links, with our partner id attached.
 * ---------------------------------------------------------------------------
 * Every link a shopper can follow out of the Shop screen is built here, so
 * there is exactly one place where attribution can be forgotten. The Avantis
 * bug — a link that worked perfectly and credited nobody, because the
 * parameter name was copied from a different venue — came from having that
 * logic spread across pages.
 */

const env = (k) => (typeof import.meta !== 'undefined' ? import.meta.env?.[k] : undefined) || '';

/**
 * Our Cryptorefills partner id.
 *
 * Public by construction: it travels in the query string of links we publish,
 * exactly like the Avantis code and the UTEX campaign id. Compiled in as a
 * default for the same reason those two are — `VITE_` variables absent from
 * the env block of .github/workflows/build-apk.yml get baked in EMPTY, so a
 * value that lives only in Vercel earns on the website and nothing in the
 * APK, and the agent token cannot edit workflow files.
 *
 * REGISTERED 2026-08-10 as `mYf7QvsDKa`, from the owner's own account.
 */
export const CR_PARTNER = env('VITE_CRYPTOREFILLS_PARTNER_ID') || 'mYf7QvsDKa';

const BASE = 'https://www.cryptorefills.com/en';

/** Attach `ref` when we have one. Never produces a broken link, only a plain one. */
function withRef(url) {
  if (!CR_PARTNER) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('ref', CR_PARTNER);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * ─── COUNTRY SLUGS, BECAUSE THE ISO CODE IS NOT WHAT THE PATH WANTS ─────────
 * Reported: most brand pages 404. They did, and the cause was mine — I built
 * `/en/buy/{brand}?country=TR`, which does not exist on their site at all.
 * Confirmed by opening it: /en/buy/steam returns "We couldn't find that page".
 *
 * The real grammar, read off their own catalogue links:
 *
 *   /en/{country_slug}/gift_cards/{brand_slug}
 *   e.g. /en/turkiye/gift_cards/steam        (verified, loads)
 *        /en/united_states/gift_cards/steam  (verified, loads)
 *        /en/united_arab_emirates/gift_cards/noon (verified, loads)
 *
 * The country segment is a NAME slug, not an ISO code — `turkiye`, not `TR` —
 * so a mapping is unavoidable. Only the countries this app actually surfaces
 * are listed; everything else falls back to the brand's global page, which is
 * a real page with its own country picker rather than a 404.
 */
const COUNTRY_SLUG = {
  TR: 'turkiye', US: 'united_states', AE: 'united_arab_emirates',
  GB: 'united_kingdom', DE: 'germany', IT: 'italy', FR: 'france',
  ES: 'spain', NL: 'netherlands', CA: 'canada', AU: 'australia',
  JP: 'japan', BR: 'brazil', MX: 'mexico', IN: 'india', ID: 'indonesia',
  PH: 'philippines', NG: 'nigeria', ZA: 'south_africa', PL: 'poland',
  PT: 'portugal', SE: 'sweden', NO: 'norway', DK: 'denmark', FI: 'finland',
  IE: 'ireland', AT: 'austria', BE: 'belgium', CH: 'switzerland',
  GR: 'greece', RO: 'romania', SA: 'saudi_arabia', EG: 'egypt',
  MA: 'morocco', KE: 'kenya', AR: 'argentina', CL: 'chile', CO: 'colombia',
  PE: 'peru', MY: 'malaysia', SG: 'singapore', TH: 'thailand',
  VN: 'vietnam', KR: 'south_korea', NZ: 'new_zealand', CZ: 'czechia',
  HU: 'hungary', UA: 'ukraine', IL: 'israel', PK: 'pakistan', BD: 'bangladesh'
};

/**
 * Their brand slug: lowercase, spaces to underscores, and DOTS KEPT.
 *
 * That last part is not a detail — their own link for Amazon.com is
 * `/gift_cards/amazon.com`, so stripping punctuation the way my first version
 * did produced `amazon-com` and a 404. Ampersands become underscores
 * (`travel_&_flights` appears in their category list, but brand names use the
 * plain form), and everything else that is not a letter, digit or dot
 * collapses to a single underscore.
 */
function brandSlug(family) {
  return String(family ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, '_')
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The page for one brand in one country.
 *
 * Falls back to `/en/{brand}-bitcoin` when the country is not in the map —
 * verified that /en/steam-bitcoin loads and carries its own country selector,
 * so an unmapped country costs the user one extra tap instead of a dead end.
 */
export function brandUrl(countryCode, family) {
  const cc = String(countryCode ?? '').trim().toUpperCase();
  const slug = brandSlug(family);
  if (!slug) return withRef(`${BASE}/united_states/gift_cards`);

  const country = COUNTRY_SLUG[cc];
  if (!country) return withRef(`${BASE}/${slug.replace(/[._]/g, '-')}-bitcoin`);
  return withRef(`${BASE}/${country}/gift_cards/${slug}`);
}

/** The whole gift-card catalogue for a country, for "see everything". */
export function countryUrl(countryCode) {
  const country = COUNTRY_SLUG[String(countryCode ?? '').trim().toUpperCase()];
  return withRef(`${BASE}/${country || 'united_states'}/gift_cards`);
}

/** Mobile top-up and data, which is a sibling section rather than a category. */
export function topUpUrl(countryCode) {
  const country = COUNTRY_SLUG[String(countryCode ?? '').trim().toUpperCase()];
  return withRef(`${BASE}/${country || 'united_states'}/mobile_top_up`);
}

/**
 * ─── FLIGHTS ARE NOT IN THE REST API, AND THE FORM WAS THE WRONG ANSWER ─────
 * Their developer reference lists what it covers and then says plainly "Not
 * covered here: Flights, Stays". There is no endpoint returning fares.
 *
 * The first version of this file built a query string from a form: origin,
 * destination, departure date, return date, passengers, cabin. The owner
 * found the flaw immediately —
 *
 *   «پس از انتخاب مقصد و مبدا و تاریخ وارد صفحه سایت میشه که همون ها را
 *    انتخاب کنی درست نیست»
 *
 * — you fill it in here, then fill in the same thing again on their site.
 * That is exactly what happened, because their date pickers are React
 * components that do not hydrate from query parameters. The parameters were
 * accepted and ignored, so the form cost the user time and bought nothing.
 *
 * What DOES survive is the PATH. Verified live: /en/flights/new_york-to-london
 * opens with JFK and LHR already selected. So the app offers real routes and
 * passes only the slug, which actually works.
 *
 * @param slug e.g. `new_york-to-london`, or null for the flights home page.
 */
export function flightUrl(slug) {
  const s = String(slug ?? '').trim();
  /*
   * Whitelist the shape rather than the value: lowercase letters, digits,
   * underscore, comma and hyphen are everything their own slugs use
   * (`washington,_dc-to-toronto`). Anything else falls back to the index page
   * rather than building a URL that 404s.
   */
  if (!s || !/^[a-z0-9_,-]+$/.test(s)) return withRef(`${BASE}/flights`);
  return withRef(`${BASE}/flights/${s}`);
}

/**
 * One city's hotel page.
 *
 * Their format is /en/stays/{cc}/{city} — verified live that
 * /en/stays/ae/dubai opens on Dubai with the filter panel ready.
 */
export function stayCityUrl(cc, slug) {
  const c = String(cc ?? '').trim().toLowerCase();
  const s = String(slug ?? '').trim();
  if (!/^[a-z]{2}$/.test(c) || !/^[a-z0-9_.,-]+$/.test(s)) return withRef(`${BASE}/stays`);
  return withRef(`${BASE}/stays/${c}/${s}`);
}

export function esimUrl() {
  return withRef(`${BASE}/esim`);
}

/** Do we earn from these links today? Drives the honest sentence in the UI. */
export function shopEarns() {
  return Boolean(CR_PARTNER);
}
