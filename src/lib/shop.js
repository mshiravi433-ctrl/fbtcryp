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

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

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

/** Denominations for one brand. */
export async function fetchShopProducts(country, family) {
  const cc = String(country ?? '').trim().toUpperCase();
  const fam = String(family ?? '').trim();
  if (!/^[A-Z]{2}$/.test(cc) || !fam) return { rows: [], live: false };
  const d = await get(`/shop/products?country=${cc}&family=${encodeURIComponent(fam)}`);
  return {
    rows: Array.isArray(d?.rows) ? d.rows : [],
    brand: d?.brand ?? null,
    logo: d?.logo ?? null,
    note: d?.note ?? null,
    howTo: d?.howTo ?? null,
    outOfStock: d?.outOfStock === true,
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
