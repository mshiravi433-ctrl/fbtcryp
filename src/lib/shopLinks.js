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
 * Empty until registered. Registration is free and instant at
 * cryptorefills.com/account — no approval step.
 */
export const CR_PARTNER = env('VITE_CRYPTOREFILLS_PARTNER_ID') || '';

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
 * ─── FLIGHTS ARE NOT IN THE REST API ────────────────────────────────────────
 * Checked before building anything: the developer reference lists what it
 * covers — "Gift cards, Mobile top-ups, eSIM purchases" — and then states
 * "Not covered here: Flights, Stays". There is no endpoint to search flights,
 * so the app CANNOT render live fares. Faking a results list would be the
 * worst possible version of this feature.
 *
 * What exists is a search page that accepts a route in its path. Verified
 * live: /en/flights/new_york-to-london loads with JFK and LHR already
 * selected in the form. So the app collects origin, destination, date and
 * passengers, and hands over a page that opens with the search prefilled.
 *
 * The slug is city names joined by "-to-", lowercase, spaces as underscores —
 * read off their own destination links (`washington,_dc-to-toronto`).
 */
export function flightUrl({ from, to, depart, ret, adults, cabin, direct } = {}) {
  const slug = (v) =>
    String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9,\s_-]/g, '')
      .replace(/\s+/g, '_');

  const a = slug(from);
  const b = slug(to);
  const path = a && b ? `${BASE}/flights/${a}-to-${b}` : `${BASE}/flights`;

  try {
    const u = new URL(path);
    /*
     * Query parameters are passed on a best-effort basis. Their form reads the
     * ROUTE from the path reliably; the date fields are a React date picker
     * and may or may not hydrate from the query. Passing them costs nothing
     * and cannot break the page, and the route — the tedious part — always
     * survives.
     */
    if (depart) u.searchParams.set('departure_date', depart);
    if (ret) u.searchParams.set('return_date', ret);
    if (adults && Number(adults) > 1) u.searchParams.set('adults', String(Number(adults)));
    if (cabin && cabin !== 'economy') u.searchParams.set('cabin_class', cabin);
    if (direct) u.searchParams.set('direct', 'true');
    if (CR_PARTNER) u.searchParams.set('ref', CR_PARTNER);
    return u.toString();
  } catch {
    return withRef(path);
  }
}

/** Stays. Same shape, same caveat: a search page, not an API. */
export function stayUrl({ city, checkIn, checkOut, guests } = {}) {
  try {
    const u = new URL(`${BASE}/stays`);
    if (city) u.searchParams.set('location', String(city).slice(0, 80));
    if (checkIn) u.searchParams.set('check_in', checkIn);
    if (checkOut) u.searchParams.set('check_out', checkOut);
    if (guests && Number(guests) > 1) u.searchParams.set('guests', String(Number(guests)));
    if (CR_PARTNER) u.searchParams.set('ref', CR_PARTNER);
    return u.toString();
  } catch {
    return withRef(`${BASE}/stays`);
  }
}

export function esimUrl() {
  return withRef(`${BASE}/esim`);
}

/** Do we earn from these links today? Drives the honest sentence in the UI. */
export function shopEarns() {
  return Boolean(CR_PARTNER);
}
