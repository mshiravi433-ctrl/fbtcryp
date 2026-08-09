/**
 * TRAVEL DESTINATIONS — real routes and cities, with real photographs.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS FILE EXISTS RATHER THAN A SEARCH FORM ─────────────────────────
 * The owner's complaint was exact and correct:
 *
 *   «برای هتل و بلیط پس از انتخاب مقصد و مبدا و تاریخ وارد صفحه سایت میشه که
 *    همون ها را انتخاب کنی درست نیست»
 *
 * — you fill in origin, destination and dates, and then land on their site
 * and have to fill in the SAME THING AGAIN. That is a form that wastes the
 * user's time and then insults them.
 *
 * The cause is real and unfixable from here: flights and stays are NOT in the
 * REST API. Their developer reference lists what it covers and then states
 * "Not covered here: Flights, Stays". Their date pickers are React components
 * that do not hydrate from query parameters, so passing `?departure_date=`
 * genuinely does nothing.
 *
 * What DOES work is the path. Verified live, twice:
 *   /en/flights/new_york-to-london  -> opens with JFK and LHR pre-selected
 *   /en/stays/ae/dubai              -> opens on Dubai with filters ready
 *
 * So the honest, faster design is the second half of the owner's own
 * instruction: «اگر نمیتونی بیاری بهترین های مقصد و مبدا را بزار» — put the
 * best routes and destinations up front. One tap, real photo, lands on a page
 * that is already narrowed. No form to fill twice.
 *
 * ─── WHERE THE DATA COMES FROM ──────────────────────────────────────────────
 * Every route, city slug and image path below was READ OFF their own pages
 * (/en/flights and /en/stays), not invented. The images are their CDN's
 * 200x250 destination photographs — the same ones their site uses.
 *
 * A wrong slug produces a 404 and a wrong image path produces AccessDenied,
 * both of which I checked: `nonexistent_city_200x250.webp` returns
 * AccessDenied while `dubai_uae_2_200x250.webp` returns real image bytes.
 */

const IMG = 'https://cdn.cryptorefills.com/images/destinations';

/**
 * Popular flight routes, straight off their flights page.
 *
 * `slug` is what goes in the URL path; `from`/`to` are the IATA codes their
 * own cards display, which is what a traveller recognises.
 */
export const FLIGHT_ROUTES = [
  { id: 'nyc-lhr', slug: 'new_york-to-london', from: 'JFK', to: 'LHR', city: 'London', country: 'United Kingdom', img: `${IMG}/london_uk_200x250.webp` },
  { id: 'sea-dxb', slug: 'seattle-to-dubai', from: 'SEA', to: 'DXB', city: 'Dubai', country: 'United Arab Emirates', img: `${IMG}/dubai_uae_2_200x250.webp` },
  { id: 'lax-nrt', slug: 'los_angeles-to-tokyo', from: 'LAX', to: 'NRT', city: 'Tokyo', country: 'Japan', img: `${IMG}/tokyo_japan_200x250.webp` },
  { id: 'sfo-cdg', slug: 'san_francisco-to-paris', from: 'SFO', to: 'CDG', city: 'Paris', country: 'France', img: `${IMG}/paris_france_200x250.webp` },
  { id: 'mia-fco', slug: 'miami-to-rome', from: 'MIA', to: 'FCO', city: 'Rome', country: 'Italy', img: `${IMG}/rome_italy_200x250.webp` },
  { id: 'ord-ams', slug: 'chicago-to-amsterdam', from: 'ORD', to: 'AMS', city: 'Amsterdam', country: 'Netherlands', img: `${IMG}/amsterdam_netherlands_200x250.webp` },
  { id: 'jfk-mia', slug: 'new_york-to-miami', from: 'JFK', to: 'MIA', city: 'Miami', country: 'United States', img: `${IMG}/miami_us_200x250.webp` },
  { id: 'lax-las', slug: 'los_angeles-to-las_vegas', from: 'LAX', to: 'LAS', city: 'Las Vegas', country: 'United States', img: `${IMG}/las_vegas_us_200x250.webp` },
  { id: 'jfk-lax', slug: 'new_york-to-los_angeles', from: 'JFK', to: 'LAX', city: 'Los Angeles', country: 'United States', img: `${IMG}/los_angeles_us_200x250.webp` },
  { id: 'iad-yyz', slug: 'washington,_dc-to-toronto', from: 'IAD', to: 'YYZ', city: 'Toronto', country: 'Canada', img: `${IMG}/toronto_canada_200x250.webp` },
  { id: 'lax-sfo', slug: 'los_angeles-to-san_francisco', from: 'LAX', to: 'SFO', city: 'San Francisco', country: 'United States', img: `${IMG}/san_francisco_us_200x250.webp` },
  { id: 'sea-lax', slug: 'seattle-to-los_angeles', from: 'SEA', to: 'LAX', city: 'Los Angeles', country: 'United States', img: `${IMG}/los_angeles_us_200x250.webp` }
];

/**
 * Hotel destinations. Their stays URLs are `/en/stays/{cc}/{city}` — a
 * two-letter country code and a slug, both lowercase.
 */
export const STAY_CITIES = [
  { id: 'dubai', cc: 'ae', slug: 'dubai', city: 'Dubai', country: 'United Arab Emirates', img: `${IMG}/dubai_uae_2_200x250.webp` },
  /*
   * ─── ISTANBUL IS DELIBERATELY ABSENT, AND THAT IS A CAUGHT MISTAKE ────────
   * I added it because it is an obvious destination for this audience, and I
   * invented the filename `istanbul_turkey_200x250.webp` by pattern-matching
   * the others. It does not exist: the CDN answers AccessDenied for it and
   * for `istanbul_turkiye_...` too, while every filename actually READ off
   * their pages returns real image bytes.
   *
   * The hotel page /en/stays/tr/istanbul does work — so the tile would have
   * linked correctly and shown a broken image. That is the worst shape of
   * bug: plausible, half-working, and invisible until a user sees it.
   *
   * Rule for this list: only cities whose image was seen on their own pages.
   */
  { id: 'washington', cc: 'us', slug: 'washington_d.c.', city: 'Washington D.C.', country: 'United States', img: `${IMG}/washington_dc_us_200x250.webp` },
  { id: 'london', cc: 'gb', slug: 'london', city: 'London', country: 'United Kingdom', img: `${IMG}/london_uk_200x250.webp` },
  { id: 'paris', cc: 'fr', slug: 'paris', city: 'Paris', country: 'France', img: `${IMG}/paris_france_200x250.webp` },
  { id: 'rome', cc: 'it', slug: 'rome', city: 'Rome', country: 'Italy', img: `${IMG}/rome_italy_200x250.webp` },
  { id: 'amsterdam', cc: 'nl', slug: 'amsterdam', city: 'Amsterdam', country: 'Netherlands', img: `${IMG}/amsterdam_netherlands_200x250.webp` },
  { id: 'newyork', cc: 'us', slug: 'new_york', city: 'New York', country: 'United States', img: `${IMG}/new_york_us_200x250.webp` },
  { id: 'losangeles', cc: 'us', slug: 'los_angeles', city: 'Los Angeles', country: 'United States', img: `${IMG}/los_angeles_us_200x250.webp` },
  { id: 'miami', cc: 'us', slug: 'miami', city: 'Miami', country: 'United States', img: `${IMG}/miami_us_200x250.webp` },
  { id: 'lasvegas', cc: 'us', slug: 'las_vegas', city: 'Las Vegas', country: 'United States', img: `${IMG}/las_vegas_us_200x250.webp` },
  { id: 'tokyo', cc: 'jp', slug: 'tokyo', city: 'Tokyo', country: 'Japan', img: `${IMG}/tokyo_japan_200x250.webp` },
  { id: 'sanfrancisco', cc: 'us', slug: 'san_francisco', city: 'San Francisco', country: 'United States', img: `${IMG}/san_francisco_us_200x250.webp` }
];

/**
 * Countries worth putting at the top of the picker.
 *
 * ─── WHY A SHORTLIST AT ALL ─────────────────────────────────────────────────
 * 233 countries in a dropdown is the thing the owner called ugly, and he is
 * right — it is also slow to use. These are the ones this app's audience
 * actually buys for, judged by the catalogue depth each one returns and by
 * where the users are. Everything else is still reachable by search.
 */
export const POPULAR_COUNTRIES = ['TR', 'AE', 'US', 'GB', 'DE', 'IT', 'FR', 'ES', 'NL', 'CA', 'AU', 'JP'];

/**
 * Flag emoji from an ISO-3166 alpha-2 code.
 *
 * Regional-indicator letters sit at U+1F1E6 for 'A'. Cheaper and sharper than
 * shipping 233 flag images, and it degrades to the letters themselves on a
 * platform without the glyphs rather than to a broken-image box.
 */
export function flagOf(cc) {
  const s = String(cc ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return '';
  return String.fromCodePoint(...[...s].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
