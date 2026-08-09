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
 * Country page for one brand.
 *
 * ─── WHY THE COUNTRY IS IN THE PATH ─────────────────────────────────────────
 * Their catalogue is per-country and a gift card bought on the wrong one is
 * frequently unredeemable — Steam's own note says region-locked cards fail
 * even over a VPN, with no refund. Sending a Turkish shopper to the US page
 * would be actively harmful, so the country the user selected travels with
 * them.
 */
export function brandUrl(countryCode, family) {
  const cc = String(countryCode ?? '').trim().toUpperCase();
  const fam = String(family ?? '').trim();
  if (!fam) return withRef(`${BASE}/gift_cards`);
  const slug = fam.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return withRef(`${BASE}/gift_cards`);
  return withRef(`${BASE}/buy/${slug}${/^[A-Z]{2}$/.test(cc) ? `?country=${cc}` : ''}`);
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
