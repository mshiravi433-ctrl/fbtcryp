/**
 * SHOP HUB — storefront logic (recent views, regional trending, Web3
 * identity checks).
 * ---------------------------------------------------------------------------
 * Everything here is pure or storage-guarded and framework-free, the same
 * discipline `shopCatalogTools.js` keeps: the UI in Shop.jsx decides what to
 * paint, this module decides what is TRUE, and both halves are testable
 * without a DOM.
 *
 * The rules this file exists to enforce:
 *
 *   · A shared card is a plain IN-APP deep link (`#/shop?c=..&b=..`)
 *     carrying the sharer's referral code. There is deliberately no
 *     "gift" state here: a link is not a purchased voucher, and the shop
 *     never dresses it up as one.
 *   · Recent views live in this device's localStorage, like the shop's
 *     favorites. Nothing about the visitor is sent anywhere.
 *   · Trending is a RE-RANK, never a replacement: brands the server has
 *     opinions about go up; brands it has not heard of keep their place.
 *     A cold or missing trending answer must produce the exact old rail.
 *   · Web3 identity checks validate FORMAT and honest costs only. The card
 *     never claims to know if a name is free — availability is a question
 *     for the on-chain registry, and the registration pages themselves are
 *     the only honest answer. Buying the gas/registration coin routes to
 *     our own swap, exactly like every other conversion in the shop.
 */

/* ─────────────────────────── recently viewed ────────────────────────────── */

export const SHOP_RECENT_KEY = 'fbt.shop.recent.v1';
const RECENT_MAX = 10;

/**
 * The brand was OPENED — remember the three fields a re-tap needs.
 *
 * A snapshot (id, family, name) rather than the full row on purpose: the
 * catalogue changes with the country and every few minutes with the cache,
 * and a stale price rendered from history is a lie waiting to be believed.
 * The rail re-joins the snapshot to the LIVE rows and hides whatever the
 * current country no longer carries.
 */
function cleanRecentRow(r) {
  if (!r || typeof r !== 'object') return null;
  const id = String(r.id ?? '').trim().slice(0, 64);
  const family = String(r.family ?? '').trim().slice(0, 80);
  const name = String(r.name ?? family).trim().slice(0, 80);
  if (!id || !family) return null;
  return { id, family, name, at: Date.now() };
}

export function getRecentViews(storage = globalThis?.localStorage) {
  try {
    const raw = storage?.getItem?.(SHOP_RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = new Set();
    for (const item of arr) {
      const r = cleanRecentRow(item);
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
      if (out.length >= RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Unshift the opened brand, de-dupe by id, cap at 10. Returns the new list. */
export function pushRecentView(brand, storage = globalThis?.localStorage) {
  const row = cleanRecentRow(brand);
  if (!row) return getRecentViews(storage);
  const next = [row, ...getRecentViews(storage).filter((r) => r.id !== row.id)].slice(0, RECENT_MAX);
  try { storage?.setItem?.(SHOP_RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
  return next;
}

/**
 * Join the stored snapshots onto the live catalogue rows. Items the current
 * country no longer has drop out of the rail (they stay in storage — the
 * shopper may switch back), and order follows recency.
 */
export function resolveRecentViews(recent, rows) {
  if (!Array.isArray(recent) || recent.length === 0) return [];
  const byId = new Map();
  for (const r of (rows || [])) {
    if (r?.id && !byId.has(r.id)) byId.set(r.id, r);
  }
  const out = [];
  for (const snap of recent) {
    const hit = byId.get(snap?.id);
    if (hit && !hit.outOfStock) out.push(hit);
  }
  return out;
}

/* ───────────────────────────── trend re-rank ─────────────────────────────── */

/**
 * Re-rank `rows` by the server's regional trend answer.
 *
 * `trending` is `[{ id, score }]` (server/shop.js `rankTrendingBrands`).
 * Rows the counter has not seen keep their relative order behind the ranked
 * ones; a brand with zero views and no margin signal scores no advantage —
 * silence is not a demotion, so unranked rows are simply NOT boosted. When
 * `trending` is empty the function returns the input untouched, which is
 * what keeps a cold counter invisible instead of rearranging the shelf by
 * nothing.
 */
export function orderRowsByTrending(rows, trending, { limit = 12 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (!Array.isArray(trending) || trending.length === 0) return rows;
  const scoreOf = new Map();
  trending.forEach((t) => {
    if (!t || typeof t.id !== 'string') return;
    const n = Number(t.score);
    /* The server returns the whole in-stock catalogue, including zero-signal
       rows. Treating those zeroes as a ranking used to alphabetise the rail
       on a completely cold counter. Only a real positive signal may boost a
       brand; all other rows keep their editorial order. */
    if (Number.isFinite(n) && n > 0) scoreOf.set(t.id, n);
    else if (!Number.isFinite(n) && Number(t.views) > 0) scoreOf.set(t.id, Number(t.views));
  });
  if (scoreOf.size === 0) return rows;
  const ranked = [];
  const rest = [];
  for (const r of rows) {
    if (r?.outOfStock || !scoreOf.has(r?.id)) { rest.push(r); continue; }
    ranked.push({ r, score: scoreOf.get(r.id) });
  }
  ranked.sort((a, b) => b.score - a.score);
  return [...ranked.map((x) => x.r), ...rest].slice(0, Math.max(1, limit));
}

/** How many of the ranked ids actually have at least one recorded view. */
export function trendingHasHeat(trending) {
  return Array.isArray(trending) && trending.some((t) => Number(t?.views) > 0);
}

/* ───────────────────────── web3 identity (.eth / .sol) ──────────────────── */

/**
 * A registration label, validated the way the registries validate: lowercase
 * alphanumeric plus interior hyphens, no leading/trailing hyphen.
 * Unicode labels exist (and ENS supports them); promising to handle them
 * here would be over-reach, so a non-ASCII label is answered honestly with
 * "not supported in this check" rather than mangled.
 */
export function normalizeIdLabel(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
    .replace(/\.(eth|sol|sns)$/i, '')
    .replace(/\s+/g, '');
  if (!s) return { ok: false, reason: 'empty', label: '' };
  /*
   * One printable-ASCII gate does all the work: anything outside
   * U+0020–U+007E (emoji, Persian, homoglyphs, zero-width joins) is refused
   * with `non_ascii`, which is the honest "this checker does not judge that
   * label" answer — not a claim that the registry would refuse it too.
   */
  if (/[^\u0020-\u007E]/.test(s)) return { ok: false, reason: 'non_ascii', label: s };
  if (!/^[a-z0-9-]+$/.test(s)) return { ok: false, reason: 'chars', label: s };
  if (s.startsWith('-') || s.endsWith('-') || s.includes('--')) return { ok: false, reason: 'hyphen', label: s };
  return { ok: true, reason: '', label: s };
}

/**
 * The published .eth annual price tiers (docs.ens.domains/faq): the fee is
 * per YEAR and is a function of label LENGTH and nothing else, which is why
 * it can be shown before asking the chain anything. A 1–2 character label is
 * simply not registrable — those are reserved — so it is answered as such
 * rather than as "expensive".
 */
export function ensYearlyUsd(label) {
  const n = String(label ?? '').length;
  if (n < 3) return { ok: false, reason: 'too_short', usd: null };
  if (n === 3) return { ok: true, reason: '', usd: 640 };
  if (n === 4) return { ok: true, reason: '', usd: 160 };
  return { ok: true, reason: '', usd: 5 };
}

/** Solana labels: 1–32 chars; SNS publishes no length-based price ladder, so no number is invented. */
export function solLabelOk(label) {
  const n = String(label ?? '').length;
  return n >= 1 && n <= 32;
}

/** The ONLY two places a registration happens. Search is prefilled by route. */
export const ENS_APP_URL = 'https://app.ens.domains/';
export const SNS_APP_URL = 'https://sns.id/';
