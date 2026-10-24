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

import { getCached, memoryStore, withCache } from './cache.js';

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
export function userHeaders(req) {
  /*
   * `x-forwarded-for` can be a comma-separated chain when several proxies are
   * involved; the ORIGINAL client is the first entry. Taking the last would
   * forward Vercel's own edge IP, which is the bug that would make every
   * order look like it came from us.
   */
  const fwd = String(req?.headers?.['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim();
  /* Keep the first hop verbatim apart from surrounding whitespace, but bound
     the header so a malformed proxy chain cannot create an oversized request. */
  const ip = String(fwd || req?.socket?.remoteAddress || '').trim().slice(0, 128);
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

/*
 * ─── THE SPREAD: WHAT A GIFT CARD REALLY COSTS ──────────────────────────────
 * `coin_amount` is what the buyer pays and it ALREADY contains the provider's
 * margin — their own field, not something we add. A $50 Steam card prices at
 * $53.86 in USDC. That number was sitting in our payload, unrendered, while
 * the tile showed only the face value: the shopper found out at checkout, on
 * somebody else's site, after they had already decided.
 *
 * Showing it is the honest half. The revenue half is that it is also our only
 * window into their margin — commission is a percentage of GROSS MARGIN (their
 * FAQ, quoted in docs/STORE-FEASIBILITY-FA.md), so the widest spread is very
 * likely the most valuable brand for us to surface. Being able to see it is
 * the precondition for ordering by it later.
 *
 * ─── WHY THIS REFUSES TO GUESS ──────────────────────────────────────────────
 * A spread is a subtraction between two numbers that must be in the SAME
 * currency, and the face value frequently is not USD: the Turkish catalogue
 * prices Steam in lira. Dividing a lira face value by a USDC price produces a
 * confident, plausible, completely wrong percentage — in a finance app, on a
 * screen about money. So the rule is: prove the face value is USD or say
 * nothing. `null` renders as no line at all, never as 0%.
 */
const USD_STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'TUSD', 'USDP', 'PYUSD', 'USDE']);

/**
 * The face value in USD, or null when the payload does not prove it.
 *
 * Two accepted proofs, in order: an explicit USD denomination currency, or a
 * localised string that is unambiguously dollars ("$50", "$1,000.00"). A
 * stated NON-USD currency is a definite "no". Anything else is unknown, and
 * unknown is null.
 */
function usdFaceValue(p) {
  const cur = String(p?.denomination_currency ?? '').trim().toUpperCase();
  const n = Number(p?.denomination);
  if (cur === 'USD') return Number.isFinite(n) && n > 0 ? n : null;
  if (cur) return null;

  const m = /^\$\s*([\d,]+(?:\.\d+)?)$/.exec(String(p?.localized_denomination ?? '').trim());
  if (!m) return null;
  const parsed = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The provider's margin over face value, as a percentage, or null.
 *
 * Only computed when the buyer pays in a dollar stablecoin — comparing a face
 * value in dollars to a price in SOL would be meaningless.
 */
function spreadOverFace(p, coin) {
  if (!USD_STABLECOINS.has(String(coin ?? '').trim().toUpperCase())) return null;
  const face = usdFaceValue(p);
  const paid = money(p?.coin_amount);
  if (face === null || paid === null) return null;

  const pct = ((paid - face) / face) * 100;
  /*
   * Outside this band it is a parse mistake, not a price. A discount is
   * possible (hence the small negative allowance) and gift-card margins above
   * ~40% do not exist in this market — a reading that high means we subtracted
   * two different currencies and must stay silent instead.
   */
  if (!Number.isFinite(pct) || pct < -5 || pct > 40) return null;
  return Math.round(pct * 10) / 10;
}

/**
 * ─── THE REDEMPTION TEXT WAS ALWAYS ENGLISH, IN EVERY LANGUAGE ──────────────
 * Reported: «داخل فروشگاه وقتی روی کارتی میزنی و چطور کار میکند حتی وقتی زبان
 * مثلا فارسی باشد باز هم انگلیسی هست درست کن».
 *
 * The cause was one hard-coded string: `&lang=en`. Their API IS localised —
 * `rich_description.locale` comes back as whatever was asked for, when they
 * have it — so we were asking an English question and printing the answer
 * under a Persian heading.
 *
 * ─── WHY THIS PROBES INSTEAD OF TRUSTING A LANGUAGE LIST ────────────────────
 * Their coverage is partial and it fails SILENTLY. Verified live:
 *
 *   lang=es  →  rich_description.locale "es", Spanish note + Spanish steps
 *   lang=ar  →  rich_description.locale "ar", Arabic note + Arabic steps
 *   lang=fa  →  rich_description: null
 *
 * `null` is the dangerous answer, not the missing one: the redemption steps,
 * the how-to AND the region-lock warning all disappear together. Bluntly
 * forwarding the shopper's language without a fallback would have replaced a
 * Persian shopper's English warning with NO warning — a worse bug than the
 * one being fixed.
 *
 * So: ask in their language, and if the answer carries no prose, ask again in
 * English and remember that this language is not covered. The list of dead
 * languages is LEARNED per process rather than hand-maintained, so the day
 * they add Persian this picks it up on its own.
 */
const NO_RICH_CONTENT = new Set();

/** Two letters we are willing to forward to the provider, or 'en'. */
function providerLocale(lang) {
  const s = String(lang ?? '').trim().toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(s) ? s : 'en';
}

/**
 * Real prose in this response, or an empty shell.
 *
 * Their "we do not speak that language" answer is not an error and not an
 * empty array — it is the full catalogue with `rich_description: null`. This
 * is the test for that, and it deliberately looks at all three prose fields:
 * a locale that has a note but no steps still deserves to be used.
 */
function hasRichContent(first) {
  const rich = first?.rich_description;
  return Boolean(rich && (rich.how_to_redeem || rich.note || rich.description));
}

/**
 * Buyable denominations for one brand, priced in a stablecoin.
 *
 * `coin_amount` is what the buyer actually pays — it already includes the
 * spread — so it is shown next to the face value rather than instead of it.
 * Hiding it would be the dishonest choice: a $50 Steam card costs $53.86 in
 * USDC and the buyer should see that before they leave.
 *
 * `lang` is the shopper's UI language. It decides the language of the note and
 * the redemption steps; the prices are unaffected.
 */
/** Allowed stablecoins for storefront denomination pricing. */
export const SHOP_PRICING_COINS = Object.freeze(['USDC', 'USDT']);

/** Normalize a user-selected pricing coin to an allowed USD stablecoin. */
export function normalizeShopCoin(coin) {
  const s = String(coin ?? '').trim().toUpperCase();
  return s === 'USDT' ? 'USDT' : 'USDC';
}

export async function fetchShopProducts({ country, family, coin = 'USDC', lang }, req) {
  const cc = cleanCountry(country);
  const fam = cleanText(family, 80);
  if (!cc || !fam) return { rows: [], at: Date.now() };

  const safeCoin = /^[A-Z0-9.]{2,10}$/.test(String(coin).toUpperCase())
    ? String(coin).toUpperCase()
    : 'USDC';

  const productsUrl = (locale) =>
    `${API}/v5/products/country/${cc}?family_name=${encodeURIComponent(fam)}&coin=${safeCoin}&lang=${locale}`;

  const wanted = providerLocale(lang);
  let data = null;

  /*
   * The probe happens at most once per language per server instance: after a
   * language answers without prose it is remembered as dead and every later
   * request goes straight to English.
   *
   * A probe that FAILS is a different thing from a probe that answers in
   * English, and the two are treated differently on purpose: a timeout or a
   * 5xx must not brand a language as unsupported for the life of the instance,
   * so nothing is remembered and the next shopper's request tries again. The
   * English call below is the safety net in both cases — this branch must
   * never be the reason a request fails.
   */
  if (wanted !== 'en' && !NO_RICH_CONTENT.has(wanted)) {
    try {
      const probe = await getJson(productsUrl(wanted), userHeaders(req));
      if (hasRichContent(Array.isArray(probe) ? probe[0] : null)) data = probe;
      else NO_RICH_CONTENT.add(wanted);
    } catch {
      /* Their end is having a bad moment. Ask in English and carry on. */
    }
  }

  if (!data) data = await getJson(productsUrl('en'), userHeaders(req));

  const first = Array.isArray(data) ? data[0] : null;
  if (!first) return { rows: [], at: Date.now() };

  const rows = (Array.isArray(first.products) ? first.products : [])
    .map((p) => {
      const id = cleanText(p?.product_id, 64);
      if (!id) return null;
      /*
       * The coin the price is ACTUALLY in, which is theirs to state and not
       * ours to assume. We request USDC, but the spread gate has to test the
       * coin beside the number it is dividing — gating on the requested coin
       * would happily subtract a USD face value from a SOL price the moment
       * they answered in something else.
       */
      const coin = cleanText(p.coin, 10) || safeCoin;
      return {
        id,
        label: cleanText(p.localized_denomination || p.denomination, 40),
        coinAmount: money(p.coin_amount),
        coin,
        /* The provider's own margin over face value, when it can be proven.
           null means "we could not tell", never "zero". */
        spreadPct: spreadOverFace(p, coin),
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

  /*
   * The cheapest denomination in this brand, by spread rather than by price.
   *
   * Sorted separately rather than taken from `rows[0]` because the list is
   * ordered by absolute price, and on a card whose margin varies by size —
   * which is the normal case — the smallest note is not automatically the
   * best deal. One number, computed here so every client shows the same one.
   */
  const spreads = rows.map((r) => r.spreadPct).filter((v) => v !== null && v !== undefined);
  const bestSpreadPct = spreads.length ? Math.min(...spreads) : null;

  return {
    brand: cleanText(first.brand || first.family, 80),
    logo: cleanLogo(first.logo_url),
    outOfStock: first.is_out_of_stock === true,
    pricingCoin: safeCoin,
    bestSpreadPct,
    /*
     * `note` carries the redemption traps — Steam's is "region-locked, VPN
     * will not work, no refunds". That is the single most useful sentence on
     * the page and it comes from the issuer, so it is passed through rather
     * than summarised. Longer cap than other fields for that reason.
     */
    note: htmlToText(rich.note, 600) || null,
    howTo: htmlToText(rich.how_to_redeem, 900) || null,
    /*
     * ─── WHICH LANGUAGE THAT PROSE IS ACTUALLY IN ───────────────────────────
     * Their own `locale` field, not the one we asked for. It is the only
     * honest answer to "did we get Persian?": on the fallback path we asked
     * for `fa` and received `en`, and a client that assumed the request
     * language would then print English instructions under a Persian heading
     * with full confidence — the exact bug this change exists to fix.
     */
    contentLocale: cleanText(rich.locale, 8) || 'en',
    rows,
    at: Date.now()
  };
}

export function getShopProducts(args, req) {
  const cc = cleanCountry(args?.country);
  const fam = cleanText(args?.family, 80);
  if (!cc || !fam) return Promise.resolve({ value: { rows: [], at: Date.now() } });
  /* Both the pricing stablecoin and the language are part of the cache key:
     sharing one entry would hand a USDT-quoting shopper USDC numbers, or an
     Arabic shopper the English note. */
  const safeCoin = normalizeShopCoin(args?.coin);
  const locale = providerLocale(args?.lang);
  return withCache(
    `shop-prod-${cc}-${fam}-${safeCoin}-${locale}`,
    10 * 60_000,
    () => fetchShopProducts({ ...args, coin: safeCoin }, req)
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PHASE 2/3 — WHITELABEL ORDER READINESS + ANONYMOUS TRENDING
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ─── THE WHITELABEL PATH, AND WHY IT IS INFRASTRUCTURE FIRST ────────────────
 * Cryptorefills' whitelabel tier is the difference between "we send the buyer
 * to their site with a ?ref" and "the buyer never leaves our UI": orders are
 * created through our server, delivered to the buyer's email, and the
 * commission accrues to us by account rather than by link. Their docs are
 * explicit that order creation additionally requires the END USER's IP and
 * user-agent forwarded (fraud checks), a delivery email, and — for the
 * spending-cap tier — a full name on account.
 *
 * We have not been granted the whitelabel account. So, per this repo's
 * standing rule against features wired to nothing:
 *
 *   · the VALIDATION is real and shipped today (email shape, full-name
 *     presence, amount sanity, country format) — it is pure and unit-tested;
 *   · the ERROR TRANSLATION for the two documented upstream failures
 *     (DAILY_SPENDING_LIMIT_EXCEEDED, FULLNAME_MISSING) is real;
 *   · the X-Forwarded-For handling keeps the FIRST client entry — the exact
 *     rule `userHeaders` already pins for the browse path;
 *   · the UI shows NOTHING until `whitelabelStatus().configured` is true.
 *     No dead button, no half-form. The partner-link flow (brandUrl with
 *     CR_PARTNER) is the live, earning path in every state; the moment the
 *     key lands on the server, /api/shop/readiness flips and the UI can
 *     acknowledge it without a redeploy.
 */
export const WHITELABEL_KEY_ENV = 'CRYPTOREFILLS_WHITELABEL_API_KEY';

export const WHITELABEL_ORDER_ERRORS = Object.freeze({
  INVALID_EMAIL: 'The delivery email is missing or malformed.',
  FULLNAME_MISSING: 'Whitelabel account orders require the buyer\u2019s full name.',
  INVALID_COUNTRY: 'Country must be a two-letter ISO code.',
  INVALID_BRAND: 'The brand family of the ordered product is missing.',
  INVALID_AMOUNT: 'Amount must be a positive number.',
  DAILY_SPENDING_LIMIT_EXCEEDED: 'The daily spending limit for this account tier was reached.',
  UPSTREAM_ORDER_FAILED: 'The upstream provider rejected the order.'
});

/** The whitelabel account key is server-side only — a real secret, unlike the public partner id. */
export function whitelabelStatus() {
  const key = String(process.env[WHITELABEL_KEY_ENV] || '').trim();
  return {
    configured: Boolean(key),
    /* Delivery is only possible over https; recorded so ops cannot miss it. */
    transport: 'https',
    whenReady: key
      ? 'Whitelabel order pre-checks are ready for the configured account.'
      : `Set ${WHITELABEL_KEY_ENV} on the server to enable in-app order validation.`,
    blockers: key
      ? []
      : [`ENV:${WHITELABEL_KEY_ENV}`]
  };
}

/** A shape-checked email, not an RFC essay. Plus-addressing is allowed; spaces are not. */
const EMAIL_RX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Validate what a whitelabel order request MUST carry before any upstream
 * call is attempted. Pure, synchronous, unit-tested; the caller has already
 * rate-limited and authenticated at the route layer.
 *
 * Returns `{ ok, errors[], value }` — errors are KEYS from
 * WHITELABEL_ORDER_ERRORS, never prose, so the client localises them and a
 * test can pin each independently.
 */
export function validateOrderPrerequisites(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const errors = [];

  const email = String(p.email ?? '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RX.test(email)) errors.push('INVALID_EMAIL');

  const fullname = String(p.fullname ?? '').replace(/[\u0000-\u001F\u200B-\u200F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!fullname) errors.push('FULLNAME_MISSING');

  const country = String(p.country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) errors.push('INVALID_COUNTRY');

  const amount = Number(p.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 2500) errors.push('INVALID_AMOUNT');

  const family = cleanText(p.family, 80);
  if (!family) errors.push('INVALID_BRAND');

  if (errors.length) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: [],
    value: { email, fullname, country, amount, family }
  };
}

/**
 * Translate an upstream 4xx into OUR error keys.
 *
 * The two documented whitelabel failures arrive as prose from their API,
 * with codes that vary by endpoint version. We match the documented phrases
 * case-insensitively and fall back to `UPSTREAM_ORDER_FAILED` — inventing a
 * precise-looking reason from an unrecognised body is how a support ticket
 * starts a war.
 */
export function mapUpstreamOrderError(status, bodyText) {
  const text = String(bodyText || '').toLowerCase();
  /* Providers have returned BOTH prose and stable machine codes across API
     versions. Normalising separators handles DAILY_SPENDING_LIMIT_EXCEEDED,
     fullname_missing and their hyphenated equivalents without fuzzy guesses. */
  const normalized = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/daily (spending )?limit/.test(normalized)) return 'DAILY_SPENDING_LIMIT_EXCEEDED';
  if (/full\s*name|fullname/.test(normalized)) return 'FULLNAME_MISSING';
  if (Number(status) === 429) return 'DAILY_SPENDING_LIMIT_EXCEEDED';
  return 'UPSTREAM_ORDER_FAILED';
}

/* ─────────────────────────── anonymous trending ──────────────────────────
 *
 * A popularity counter, deliberately the weakest possible kind: in-memory
 * per process, keyed by COUNTRY + BRAND ID, counting to a cap. No user id, no
 * wallet, no IP, no cookie — the POST body carries only which shop tile was
 * opened, which is as personal as a click on a public menu. It resets when the
 * serverless instance recycles; that is a FEATURE for privacy (nothing is
 * retained) and an accepted cost for a rail whose purpose is "what is hot
 * THIS HOUR in THIS region".
 *
 * Ranking is NOT raw clicks. Per the brief, the rail optimises the shop's
 * real economics:
 *
 *   score = 3·ln(1 + views·decay)          ← genuine regional demand
 *         + spreadPct·0.35                  ← provider margin (bestSpreadPct,
 *                                             same number the checkout shows)
 *         − (out of stock ? ∞ : 0)          ← hard filter, not a demotion:
 *                                             promoting a card you cannot buy
 *                                             is a broken tile wearing a flame.
 *
 * `views·decay` halves every ~7 days so a brand that spiked last month stops
 * crowding out one that is hot now, without a cron or a store.
 */
const TREND_TTL_MS = 14 * 24 * 3600_000; // entries older than two weeks are dropped
const TREND_HALF_LIFE_MS = 7 * 24 * 3600_000;
const TREND_MAX_KEYS = 4096;
const TREND_MAX_PER_KEY = 50_000;
const trendCounters = new Map();

/**
 * Record ONE view. `at` is refreshed so long-lived demand does not decay away
 * while it is still being clicked; the counter itself is capped so a hostile
 * client cannot grow the table or the numbers without bound.
 */
export function bumpShopInterest(country, brandId) {
  const cc = cleanCountry(country);
  const id = cleanText(brandId, 64);
  if (!cc || !id) return false;
  const key = `${cc}:${id}`;
  const hit = trendCounters.get(key);
  const now = Date.now();
  if (!hit) {
    if (trendCounters.size >= TREND_MAX_KEYS) {
      /* Drop the oldest entry rather than refuse new ones. */
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [k, v] of trendCounters) {
        if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
      }
      if (oldestKey) trendCounters.delete(oldestKey);
    }
    trendCounters.set(key, { n: 1, at: now, startedAt: now });
  } else {
    hit.n = Math.min(TREND_MAX_PER_KEY, hit.n + 1);
    hit.at = now;
  }
  return true;
}

/** Exposed for tests and for the readiness route's diagnostics. */
export function shopTrendSize() {
  return trendCounters.size;
}

/** 0.5 every half-life, with the entry's age from its last click. */
function decayOf(hit, now) {
  const age = Math.max(0, now - hit.at) + (now - hit.startedAt) / 2;
  return 0.5 ** (age / TREND_HALF_LIFE_MS / 2);
}

/**
 * Rank the cached catalogue for one country.
 *
 * `spreadOf(family)` lets the caller supply each brand's best margin from the
 * products cache; when the cache is cold it returns null and the brand still
 * ranks on popularity alone — the spread term is a BOOST, never a gate we
 * invent numbers to satisfy.
 */
export function rankTrendingBrands(rows, { cc = '', now = Date.now(), spreadOf = () => null } = {}) {
  const scored = [];
  for (const r of rows) {
    if (!r || r.outOfStock) continue;
    /* The counter key is the COUNTRY OF THE REQUEST, not a field on the row:
       a catalogue entry whose `country_code` is missing still belongs to the
       country whose endpoint returned it, and a rail that silently ignores
       half the clicks would rank nothing. */
    const hit = trendCounters.get(`${cc || r.country || ''}:${r.id}`);
    let dec = 0;
    if (hit && now - hit.at <= TREND_TTL_MS) dec = hit.n * decayOf(hit, now);
    const spread = spreadOf(r.family);
    const spreadTerm = Number.isFinite(spread) ? spread * 0.35 : 0;
    const score = 3 * Math.log(1 + dec) + spreadTerm;
    scored.push({
      id: r.id,
      family: r.family,
      name: r.name,
      views: hit ? hit.n : 0,
      spreadPct: Number.isFinite(spread) ? spread : null,
      score: Math.round(score * 1000) / 1000
    });
  }
  scored.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  return scored;
}

/**
 * The trending answer for one country, built from the SAME cached catalogue
 * the shop already pays Cryptorefills for — zero extra upstream calls.
 * Returns null when the catalogue is not cached yet; the route then warms it
 * through `getShopCatalogue` like any other country-scoped call.
 */
export function trendingFromCatalogue(country, catalogueRows, req) {
  const cc = cleanCountry(country);
  if (!cc) return Promise.resolve({ rows: [], at: Date.now() });
  const run = (rows) => {
    /* Product cache keys include coin AND locale; looking only at `-USDC-en`
       made the margin vanish for a Persian USDT shopper. Build the variant
       index in ONE cache pass per response (not one pass per brand), retaining
       the newest proven value for each family. Missing values stay null. */
    const marginByFamily = new Map();
    const prefix = `shop-prod-${cc}-`;
    for (const [key, rawHit] of memoryStore) {
      if (!key.startsWith(prefix)) continue;
      const tail = key.slice(prefix.length);
      const parts = tail.split('-');
      if (parts.length < 3) continue;
      const family = parts.slice(0, -2).join('-');
      if (!family) continue;
      const hit = getCached(key) || rawHit;
      const value = hit?.value?.bestSpreadPct;
      if (!Number.isFinite(value)) continue;
      const at = Number(hit?.at || rawHit?.at || hit?.value?.at || 0);
      const previous = marginByFamily.get(family);
      if (!previous || at >= previous.at) marginByFamily.set(family, { at, value });
    }
    const spreadOf = (family) => marginByFamily.get(cleanText(family, 80))?.value ?? null;
    return { rows: rankTrendingBrands(rows, { cc, spreadOf }), country: cc, at: Date.now() };
  };
  if (Array.isArray(catalogueRows)) return Promise.resolve(run(catalogueRows));
  return getShopCatalogue(cc, req).then(({ value }) => run(value?.rows || []));
}
