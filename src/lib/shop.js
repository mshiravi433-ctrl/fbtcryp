/**
 * SHOP — client.
 * ---------------------------------------------------------------------------
 * Reads /api/shop/*, which proxies Cryptorefills. See server/shop.js for why
 * that provider and not Bitrefill, Travala or Reloadly.
 *
 * Nothing here throws. The Shop is a whole screen built on one third party,
 * and a bad afternoon at their end must produce an honest empty state rather
 * than a crashed route.
 */

import { apiBase } from './apiBase.js';

/*
 * THE API ORIGIN IS NOT A CONSTANT ANY MORE.
 *
 * This used to read `import.meta.env?.VITE_API_BASE || '/api'`. That is the
 * exact expression lib/apiBase.js was written to replace, and it is wrong in
 * one place only — but the place that matters: inside the packaged Android
 * app the WebView serves the bundle from https://localhost, so a relative
 * '/api' resolves to the phone's OWN static asset server and every request
 * 404s. On the website the same expression is correct (same origin), which is
 * precisely why these modules looked fine and quietly died in the APK.
 *
 * apiBase() answers the question once: VITE_API_BASE when it is a usable
 * absolute origin, the canonical origin inside the native shell, '/api'
 * everywhere else.
 */
const API_BASE = apiBase();

/**
 * A bare two-letter language code, or an empty string.
 *
 * Deliberately strict and deliberately local: this value ends up inside a
 * query string, and `slice(0, 2)` before the test is what guarantees that a
 * language-shaped string from anywhere (a stored preference, a URL) cannot
 * carry anything else into the request.
 */
function twoLetter(lang) {
  const s = String(lang ?? '').trim().toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(s) ? s : '';
}

async function get(path, { timeout = 14000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Countries the provider serves. Used to answer "does this work for me". */
export async function fetchShopCountries() {
  const d = await get('/shop/countries');
  return { rows: Array.isArray(d?.rows) ? d.rows : [], live: Boolean(d) };
}

/** The catalogue for one country. */
export async function fetchShopCatalogue(country) {
  const cc = String(country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return { rows: [], categories: [], live: false };
  const d = await get(`/shop/catalogue?country=${cc}`);
  return {
    rows: Array.isArray(d?.rows) ? d.rows : [],
    categories: Array.isArray(d?.categories) ? d.categories : [],
    live: Boolean(d)
  };
}

/**
 * Denominations for one brand.
 *
 * ─── AND THE LANGUAGE OF THE PROSE THAT COMES WITH THEM ─────────────────────
 * `lang` is the language the shopper is reading the app in. The provider
 * localises their own redemption note and how-to, but not in every language —
 * server/shop.js asks in ours and falls back to English when they have
 * nothing — so `contentLocale` reports what actually came back. It is the only
 * field a client can trust here: assuming the request language was honoured
 * prints English under a Persian heading, which is the reported bug.
 */
export async function fetchShopProducts(country, family, { lang } = {}) {
  const cc = String(country ?? '').trim().toUpperCase();
  const fam = String(family ?? '').trim();
  if (!/^[A-Z]{2}$/.test(cc) || !fam) return { rows: [], live: false };
  /* `fa-IR`, `fa_IR` and `fa` are all Persian. i18next hands us whichever of
     those its resolution produced, and the API wants the bare language. */
  const lc = twoLetter(lang);
  const d = await get(`/shop/products?country=${cc}&family=${encodeURIComponent(fam)}${lc ? `&lang=${lc}` : ''}`);
  return {
    rows: Array.isArray(d?.rows) ? d.rows : [],
    brand: d?.brand ?? null,
    logo: d?.logo ?? null,
    note: d?.note ?? null,
    howTo: d?.howTo ?? null,
    /* Their own `locale`, never the one we asked for. */
    contentLocale: typeof d?.contentLocale === 'string' ? d.contentLocale.toLowerCase().slice(0, 2) : null,
    outOfStock: d?.outOfStock === true,
    /* Cheapest margin in this brand. Strictly a number or null: a `?? null`
       on its own would let a non-numeric value through into a sentence. */
    bestSpreadPct: Number.isFinite(d?.bestSpreadPct) ? d.bestSpreadPct : null,
    live: Boolean(d)
  };
}

/**
 * The shopper's country, remembered.
 *
 * ─── WHY THIS IS ASKED AND NOT GUESSED ──────────────────────────────────────
 * Guessing from the browser locale is wrong constantly: a Persian-language
 * phone in Dubai should see the UAE catalogue, and an English phone in
 * Istanbul should see Turkey. Guessing from IP is wrong for anyone on a VPN,
 * which in this audience is most people. And a gift card bought for the wrong
 * country is frequently unredeemable with no refund — Steam say so in their
 * own product note.
 *
 * So the user picks, once, and we remember it.
 */
const KEY = 'fbt.shop.country';

export function getShopCountry() {
  try {
    const v = localStorage.getItem(KEY);
    return /^[A-Z]{2}$/.test(String(v)) ? v : null;
  } catch {
    return null;
  }
}

export function setShopCountry(cc) {
  try {
    const v = String(cc ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v)) localStorage.setItem(KEY, v);
  } catch {
    /* Private mode. The screen still works, it just asks again next time. */
  }
}
