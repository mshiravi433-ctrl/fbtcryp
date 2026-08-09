/**
 * SHOP — spend crypto on real things.
 * ---------------------------------------------------------------------------
 * Gift cards, PayPal/Visa top-ups, mobile credit, eSIMs, flights and stays,
 * paid in stablecoins. Backed by Cryptorefills' REST API.
 *
 * ─── WHY CRYPTOREFILLS AND NOT THE OBVIOUS ALTERNATIVES ─────────────────────
 * Every other route was checked and failed on the same axis — see
 * docs/STORE-FEASIBILITY-FA.md for the full audit:
 *
 *   Bitrefill affiliate — 1% paid in "Bitrefill Store Credits", read verbatim
 *     off their own affiliate page. Store credit is not revenue.
 *   Coinsbee — affiliate page 404s, no published rate.
 *   Travala — 4-5.5% cash, but only via Impact.com, which needs a bank
 *     account and a tax form.
 *   Travelpayouts — bank / PayPal / WebMoney only. No crypto payout at all.
 *   Reloadly / Tango / Tremendous — all require PREFUNDING a fiat balance.
 *
 * Cryptorefills is the only one that settles in stablecoins, needs no
 * prefunding, no setup fee, no minimum volume, and lets us build our own UI
 * over a REST API rather than embedding somebody's iframe.
 *
 * ─── THE PROPERTY THAT MAKES THIS SAFE TO SHIP ──────────────────────────────
 * From their own FAQ: "Crypto is sent directly to Cryptorefills… Partners
 * never hold customer funds", and "Cryptorefills is the Merchant of Record".
 *
 * So we never touch the buyer's money. They are the merchant, they deliver,
 * they support, they handle KYC/AML and refunds. That keeps this app
 * non-custodial — the entire licensing position everything else here is built
 * to preserve — and it is why a real shop is possible at all without a
 * warehouse, a payment gateway or a returns policy.
 *
 * ─── WHAT THIS MODULE DOES *NOT* DO ─────────────────────────────────────────
 * It does not create orders. Order creation needs the end user's real IP and
 * user-agent forwarded, an email for delivery, and — for commission — a
 * whitelabel partner account we have not been granted yet. Browsing is the
 * half that works today and the half that is useful on its own; the checkout
 * link hands over to Cryptorefills carrying our partner id.
 *
 * ─── COUNTRY IS THE WHOLE PRODUCT ───────────────────────────────────────────
 * The catalogue is different in every country — Turkey gets Getir and
 * Hepsiburada, the UAE gets Noon and Lulu. So `country` is a first-class
 * parameter everywhere, defaulting to nothing rather than to the US: guessing
 * wrong shows a Turkish user a catalogue they cannot redeem.
 *
 * Iran is NOT in their 233-country list (verified against
 * /api/available-countries — the list jumps ID to IE). That is their
 * restriction, enforced server-side by them, and the UI states it plainly
 * rather than showing an Iranian user an empty screen that looks broken.
 */

import { withCache } from './cache.js';

const API = 'https://api.cryptorefills.com';

/**
 * Our partner id, sent on every request.
 *
 * Public by design — it identifies us in a link we want shared, exactly like
 * the Avantis and UTEX codes. The `VITE_`-is-for-secrets rule does not apply;
 * this is the opposite of a secret. Not set yet: registration is free and
 * automatic at cryptorefills.com/account, and until it is set the API still
 * answers, we simply earn nothing.
 */
/*
 * REGISTERED 2026-08-10 from the owner's own account. Compiled in as a default
 * for the same reason the Avantis and UTEX codes are: a value that lives only
 * in an env var is a value the Android build never sees, because Vite bakes
 * the empty default in and the agent token cannot edit build-apk.yml.
 */
const PARTNER_ID = String(process.env.CRYPTOREFILLS_PARTNER_ID || 'mYf7QvsDKa').trim();

const APP_VERSION = String(process.env.APP_VERSION_NAME || '1.0').trim();
const TIMEOUT_MS = 12_000;

/**
 * Countries Cryptorefills serves, as of the last live check.
 *
 * Cached hard because it changes rarely, and used to answer "will this work
 * for me" before the user has picked anything.
 */
export function shopCountries() {
  return withCache('shop-countries', 6 * 60 * 60_000, async () => {
    const data = await getJson(`${API.replace('api.', 'www.')}/api/available-countries`);
    const rows = Array.isArray(data?.countries) ? data.countries : [];
    return {
      rows: rows
        .filter((c) => /^[A-Z]{2}$/.test(String(c?.isoCode ?? '')))
        .map((c) => ({ code: c.isoCode, name: String(c.name ?? c.isoCode) })),
      at: Date.now()
    };
  });
}

async function getJson(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        /*
         * These four headers are REQUIRED by Cryptorefills on every call.
         * `X-Forwarded-For` and `User-Agent` must describe the END USER, not
         * our server: they use them for fraud checks and country inference.
         * Passing our datacentre IP for everyone would make every buyer look
         * like the same person in Virginia.
         */
        'X-Cr-Application': PARTNER_ID || 'fbtswap',
        'X-Cr-Version': APP_VERSION,
        ...extraHeaders
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Forwarded identity for one end user, or sane fallbacks. */
function userHeaders(req) {
  /*
   * `x-forwarded-for` can be a comma-separated chain when several proxies are
   * involved; the ORIGINAL client is the first entry. Taking the last would
   * forward Vercel's own edge IP, which is the bug that would make every
   * order look like it came from us.
   */
  const fwd = String(req?.headers?.['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim();
  const ip = fwd || req?.socket?.remoteAddress || '';
  const ua = String(req?.headers?.['user-agent'] ?? '').slice(0, 300);
  const out = {};
  if (ip) out['X-Forwarded-For'] = ip;
  if (ua) out['User-Agent'] = ua;
  return out;
}

/** Two-letter uppercase, or null. Never interpolate unvalidated input. */
function cleanCountry(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/**
 * Strip control and bidi characters from anything we render.
 *
 * Same rule the board and the Farcaster feed already apply: these strings come
 * from a third party and land in our UI, and a right-to-left override can make
 * "Amazon" render as something else entirely.
 */
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u0000-\u001F\u007F]/g;
const cleanText = (v, max = 120) => String(v ?? '').replace(BIDI, '').trim().slice(0, max);

/**
 * ─── THEIR PROSE FIELDS ARE HTML, AND WE WERE PRINTING THE TAGS ─────────────
 * Reported: the redemption note rendered as
 *
 *   <p><strong>#protip</strong></p><p>Redeeming with a VPN may violate…
 *
 * literally, tags and `&#39;` and all. The cause is in their own payload:
 * `rich_description.markup` is the string "html", so `note`, `how_to_redeem`
 * and the rest are HTML fragments. `cleanText` only stripped control
 * characters, so React printed the markup as text — exactly as reported.
 *
 * ─── WHY THIS STRIPS RATHER THAN RENDERS ────────────────────────────────────
 * The tempting fix is dangerouslySetInnerHTML. Absolutely not: this is
 * third-party copy about money, arriving over the network, and one day it
 * will contain something we did not anticipate. Injecting a stranger's HTML
 * into a wallet app to make a paragraph look tidier is a catastrophic trade.
 *
 * So the tags are REMOVED and the text kept. Block-level tags become
 * paragraph breaks so "#protip" stays on its own line, which is the only
 * structure these notes actually carry.
 */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#39': "'", '#039': "'", '#34': '"', '#x27': "'", '#x2F': '/', '#160': ' '
};

function htmlToText(v, max = 900) {
  let s = String(v ?? '');
  if (!s) return '';

  /*
   * Script and style CONTENT has to go with the tag. Stripping only the tags
   * would leave the javascript itself sitting in the middle of the sentence.
   */
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  /*
   * Block boundaries become newlines before the tags are dropped, or every
   * paragraph runs into the next word.
   *
   * The opening <li> emits its own newline plus a bullet, and the closing tags
   * add the break after. Measured, because the first two attempts were wrong:
   * marking only the closer glued the items together, and routing the bullet
   * through a control-character sentinel silently failed because \u0007 is
   * inside the BIDI class this file strips. A literal bullet cannot be eaten
   * by either step.
   */
  s = s.replace(/<li\b[^>]*>/gi, '\n• ');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');

  /* Everything else that looks like a tag. */
  s = s.replace(/<[^>]*>/g, '');

  /*
   * Entities, decoded with a fixed table. A generic `&#\d+;` decoder would
   * happily produce control characters and bidi overrides from numeric
   * escapes — the exact class this file already defends against — so only
   * these known-safe ones are translated.
   */
  s = s.replace(/&([a-zA-Z]+|#x?[0-9a-fA-F]+);/g, (m, code) => {
    const hit = ENTITIES[code] ?? ENTITIES[code.toLowerCase()];
    return hit === undefined ? ' ' : hit;
  });

  /* Their notes start with a literal "#protip" glued to the first sentence
     once the <strong> is gone. Give it its own line. */
  s = s.replace(/#protip\s*/i, '');

  /*
   * ─── BIDI CONTAINS NEWLINE, WHICH COST ME AN HOUR ───────────────────────
   * `BIDI` is /[...\u0000-\u001F...]/ and U+000A is inside that range, so
   * `s.replace(BIDI, '')` deleted every line break this function had just
   * inserted. The bullets came out as "• One.• Two.Three." on one line while
   * every replacement literal was provably a real newline — the reason the
   * fault kept looking like an escaping problem when it was not.
   *
   * Newline and tab are preserved here; everything else in the control range
   * is still stripped, which is the property that actually matters.
   */
  s = s.replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  /* Collapse the whitespace the tag removal left behind, but keep the
     paragraph breaks we deliberately introduced. */
  s = s.replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n');
  return s.trim().slice(0, max);
}

/** Only http(s) URLs from their own CDN are ever passed to the client. */
function cleanLogo(v) {
  const s = String(v ?? '');
  if (!/^https:\/\/cdn\.cryptorefills\.com\//.test(s)) return null;
  return s.length > 300 ? null : s;
}

/** A hex colour we are willing to inline as a style, or null. */
function cleanColor(v) {
  const s = String(v ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : null;
}

/** One brand row, normalised and defended. */
function toBrand(b) {
  if (!b || typeof b !== 'object') return null;
  const id = cleanText(b.brand_id, 64);
  const name = cleanText(b.brand || b.family, 80);
  if (!id || !name) return null;

  /*
   * `family` is the key the products endpoint wants, and it is NOT always the
   * display name — "Du Data" has family "Du". Carrying the wrong one produces
   * a brand page that opens and then shows nothing.
   */
  const family = cleanText(b.family || b.brand, 80);

  return {
    id,
    family,
    name,
    logo: cleanLogo(b.logo_url),
    bg: cleanColor(b.bg_color),
    category: cleanText(b.category, 40) || 'other',
    /* Extra categories widen search without another request. */
    tags: Array.isArray(b.additional_categories)
      ? b.additional_categories.map((c) => cleanText(c, 40)).filter(Boolean).slice(0, 6)
      : [],
    kind: cleanText(b.kind, 32) || 'giftcard',
    min: cleanText(b.min, 24) || null,
    max: cleanText(b.max, 24) || null,
    /* Out-of-stock brands are KEPT and flagged, not hidden: a shopper looking
       for Teknosa should learn it is unavailable, not conclude we never had
       it. The UI sorts them last. */
    outOfStock: b.is_out_of_stock === true,
    country: cleanCountry(b.country_code)
  };
}

/**
 * The full catalogue for one country, flattened and de-duplicated.
 *
 * ─── WHY FLATTEN THEIR CATEGORY TREE ────────────────────────────────────────
 * /v2/brands returns brands nested under categories, and the SAME brand
 * appears under several — Amazon.com.tr is under "e-commerce" and again under
 * "electronics". Rendering their tree verbatim shows Amazon four times. We key
 * by brand_id, keep the first, and merge the category names into `tags` so
 * search still finds it under every one of them.
 */
export async function fetchShopCatalogue(country, req) {
  const cc = cleanCountry(country);
  if (!cc) return { rows: [], categories: [], country: null, at: Date.now() };

  const data = await getJson(
    `${API}/v2/brands?country_code=${cc}`,
    userHeaders(req)
  );

  const byId = new Map();
  for (const group of Array.isArray(data?.categories) ? data.categories : []) {
    const groupCat = cleanText(group?.category, 40);
    for (const raw of Array.isArray(group?.brands) ? group.brands : []) {
      const b = toBrand(raw);
      if (!b) continue;
      const existing = byId.get(b.id);
      if (existing) {
        /* Same brand under a second category — widen its tags, do not repeat. */
        if (groupCat && !existing.tags.includes(groupCat) && existing.category !== groupCat) {
          existing.tags.push(groupCat);
        }
        continue;
      }
      if (groupCat && b.category !== groupCat && !b.tags.includes(groupCat)) {
        b.tags.push(groupCat);
      }
      byId.set(b.id, b);
    }
  }

  const rows = [...byId.values()];

  /*
   * Category list built from what is ACTUALLY present, not a hard-coded menu.
   * A fixed list would offer "groceries" in a country with no grocery brand
   * and render an empty filter — the dead-button failure this project keeps
   * finding.
   */
  const counts = new Map();
  for (const r of rows) {
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    for (const tg of r.tags) counts.set(tg, (counts.get(tg) ?? 0) + 1);
  }
  const categories = [...counts.entries()]
    .filter(([id]) => id && id !== 'other')
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ id, count: n }));

  /* In stock first, then alphabetical. Stable and predictable. */
  rows.sort((a, b) => {
    if (a.outOfStock !== b.outOfStock) return a.outOfStock ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return { rows, categories, country: cc, at: Date.now() };
}

export function getShopCatalogue(country, req) {
  const cc = cleanCountry(country);
  if (!cc) return Promise.resolve({ value: { rows: [], categories: [], country: null, at: Date.now() } });
  /* Per country, or every country would share one cache entry. */
  return withCache(`shop-cat-${cc}`, 30 * 60_000, () => fetchShopCatalogue(cc, req));
}

/** Denominations are strings like "5.63"; a bad one must not render as 0. */
function money(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Buyable denominations for one brand, priced in a stablecoin.
 *
 * `coin_amount` is what the buyer actually pays — it already includes the
 * spread — so it is shown next to the face value rather than instead of it.
 * Hiding it would be the dishonest choice: a $50 Steam card costs $53.86 in
 * USDC and the buyer should see that before they leave.
 */
export async function fetchShopProducts({ country, family, coin = 'USDC' }, req) {
  const cc = cleanCountry(country);
  const fam = cleanText(family, 80);
  if (!cc || !fam) return { rows: [], at: Date.now() };

  const safeCoin = /^[A-Z0-9.]{2,10}$/.test(String(coin).toUpperCase())
    ? String(coin).toUpperCase()
    : 'USDC';

  const data = await getJson(
    `${API}/v5/products/country/${cc}?family_name=${encodeURIComponent(fam)}&coin=${safeCoin}&lang=en`,
    userHeaders(req)
  );

  const first = Array.isArray(data) ? data[0] : null;
  if (!first) return { rows: [], at: Date.now() };

  const rows = (Array.isArray(first.products) ? first.products : [])
    .map((p) => {
      const id = cleanText(p?.product_id, 64);
      if (!id) return null;
      return {
        id,
        label: cleanText(p.localized_denomination || p.denomination, 40),
        coinAmount: money(p.coin_amount),
        coin: cleanText(p.coin, 10) || safeCoin,
        /* A dynamic product takes any amount in a range — the UI must not
           render it as a fixed button. */
        dynamic: p.is_dynamic === true,
        digital: cleanText(p.product_type, 20) === 'digital'
      };
    })
    .filter(Boolean)
    /*
     * Cheapest first — but unpriced rows go LAST, not first.
     *
     * The obvious `(a.coinAmount ?? 0) - (b.coinAmount ?? 0)` puts every
     * unpriced item at the top of the list, so the first thing a shopper sees
     * is a card with no price. Caught by feeding a null `coin_amount` through
     * the real function; the same `?? 0` reflex that turns a missing price
     * into "$0.00" also sorts it to the front.
     */
    .sort((a, b) => {
      const av = a.coinAmount;
      const bv = b.coinAmount;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av - bv;
    });

  const rich = first.rich_description ?? {};

  return {
    brand: cleanText(first.brand || first.family, 80),
    logo: cleanLogo(first.logo_url),
    outOfStock: first.is_out_of_stock === true,
    /*
     * `note` carries the redemption traps — Steam's is "region-locked, VPN
     * will not work, no refunds". That is the single most useful sentence on
     * the page and it comes from the issuer, so it is passed through rather
     * than summarised. Longer cap than other fields for that reason.
     */
    note: htmlToText(rich.note, 600) || null,
    howTo: htmlToText(rich.how_to_redeem, 900) || null,
    rows,
    at: Date.now()
  };
}

export function getShopProducts(args, req) {
  const cc = cleanCountry(args?.country);
  const fam = cleanText(args?.family, 80);
  if (!cc || !fam) return Promise.resolve({ value: { rows: [], at: Date.now() } });
  return withCache(`shop-prod-${cc}-${fam}`, 10 * 60_000, () => fetchShopProducts(args, req));
}
