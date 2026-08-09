/**
 * AVANTIS EQUITIES — the real ticker list, with real prices.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Asked directly: «سهام ها باشد در صفحه سهام فقط بنر تبلیغاتی نباشد» — put the
 * actual stocks on the stocks screen, not just an advertising banner.
 *
 * That is the right call and the previous version deserved the criticism. A
 * row saying "UTEX has hundreds of tickers, tap here" is an advert: it asks
 * the user to leave before showing them anything. A list of names with live
 * prices is a feature — the user can look, compare, and decide.
 *
 * ─── WHY AVANTIS AND NOT UTEX FOR THE DATA ──────────────────────────────────
 * UTEX pays us more (30-60% vs 5%) and I tried it first. It cannot be done:
 *
 *   GET https://margin.utex.io/api/v1/public/instruments
 *   -> "UTEX is not available in your country"
 *
 * Their whole domain geo-blocks our server, so there is no endpoint we can
 * read a ticker list from — not the public one, not any of them. Shipping a
 * hard-coded list of UTEX symbols instead would be a list we cannot verify,
 * cannot price, and cannot notice going stale. That is the "wired to nothing"
 * failure this repo keeps re-learning, so UTEX stays a single honest link and
 * the LIST is built from Avantis, which publishes everything openly.
 *
 * ─── THE ENDPOINT, AND WHY IT NEEDS NO KEY ──────────────────────────────────
 * Avantis' own SDK reads its pair table from a public, unauthenticated URL —
 * found in their config.py, not guessed:
 *
 *   AVANTIS_SOCKET_API = "https://socket-api-pub.avantisfi.com/socket-api/v1/data"
 *
 * `pub` is in the hostname. Called it live: it returns `groupInfo` (group 6 is
 * EQUITIES) and `pairInfos`, each carrying `from`, `to`, a Pyth `feedId`, open
 * interest, leverage caps and a market-hours schedule.
 *
 * Prices come from Pyth Hermes, also public and keyless, using the feed ids
 * the pair table hands us. Verified live: AAPL returned price 31333600 at
 * expo -5, i.e. $313.336.
 *
 * ─── WHAT IS DELIBERATELY NOT DONE HERE ─────────────────────────────────────
 * No trading, no signing, no wallet. This module READS. Avantis positions are
 * leveraged perpetuals — a different and far riskier instrument than the
 * tokenised equities on the same screen — and the app's job here is to show
 * what exists and let the user go to Avantis to act on it.
 */

import { withCache } from './cache.js';

const PAIRS_URL = 'https://socket-api-pub.avantisfi.com/socket-api/v1/data';
const HERMES_URL = 'https://hermes.pyth.network/v2/updates/price/latest';

/**
 * Group 6 is EQUITIES in the live payload.
 *
 * Matched by NAME rather than by the number, because a group index is
 * positional and Avantis can reorder them. A wrong index would silently
 * publish forex pairs onto a stocks screen, which is exactly the kind of
 * failure that looks fine until someone reads it closely.
 */
const EQUITY_GROUP = 'EQUITIES';

const TIMEOUT_MS = 12_000;

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** `0x…` or bare hex, normalised to bare lowercase — Hermes returns bare. */
function bareId(id) {
  const s = String(id ?? '').toLowerCase();
  return s.startsWith('0x') ? s.slice(2) : s;
}

/**
 * Pyth prices are integers with a separate exponent, e.g. 31333600 at expo -5.
 *
 * Guarded rather than trusted: `Number(null)` is 0 and 0 is finite, so a
 * missing price would render as "$0.00" — a real, plausible-looking, wrong
 * number. Returns null instead so the UI can omit the row's price.
 */
function pythPrice(entry) {
  const raw = entry?.price?.price;
  const expo = entry?.price?.expo;
  if (raw === null || raw === undefined || expo === null || expo === undefined) return null;
  const n = Number(raw);
  const e = Number(expo);
  if (!Number.isFinite(n) || !Number.isFinite(e)) return null;
  const v = n * 10 ** e;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * One equity row from a raw pair entry, or null if it is not usable.
 *
 * Fails closed on every field that matters. A row without a symbol or without
 * a feed id cannot be priced or labelled, and half a row is worse than none.
 */
function toRow(pair, index) {
  if (!pair || typeof pair !== 'object') return null;

  /* Delisted pairs stay in the payload with isPairListed:false. */
  if (pair.isPairListed === false) return null;

  const symbol = String(pair.from ?? '').trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9.]{1,12}$/.test(symbol)) return null;

  /*
   * ─── THE ALL-ZERO FEED ID IS A PLACEHOLDER, NOT A FEED ──────────────────
   * Caught on the LIVE endpoint after deploying, not in testing: SPCX ships
   * with feedId 0x0000…0000, and Hermes rejects the WHOLE batch when any id
   * is unknown —
   *
   *   "Price ids not found: 0x0000000000000000000000000000000000000000…"
   *
   * — which is why the first live response had 27 correct rows and every
   * single price null. One placeholder poisoned all of them. The row is
   * dropped here rather than filtered at the price step, because a ticker we
   * can never price is not a row worth showing on a screen about prices.
   */
  const feedId = bareId(pair.feed?.feedId);
  if (!/^[0-9a-f]{64}$/.test(feedId)) return null;
  if (/^0+$/.test(feedId)) return null;

  const attrs = pair.feed?.attributes ?? {};

  /*
   * Market hours. US equities are shut most of the week in Tehran's timezone,
   * and a price with no "closed" label looks stale or broken. Both spellings
   * appear in the live payload (`isOpen` and `is_open`), so read either.
   */
  const isOpen = attrs.isOpen ?? attrs.is_open;
  const nextOpen = Number(attrs.nextOpen ?? attrs.next_open ?? 0) || 0;

  /*
   * Leverage cap. `leverageOverride` is applied by Avantis during volatile
   * periods and is the number that actually binds — the live payload showed
   * pairs whose base maxLeverage was 10 while the override held them at 2.
   * Showing the base figure would overstate what the venue will allow.
   */
  const baseMax = Number(pair.leverages?.maxLeverage);
  const ovr = pair.leverageOverride;
  const ovrMax = ovr?.active ? Number(ovr.maxLeverage) : NaN;
  const maxLeverage = Number.isFinite(ovrMax)
    ? ovrMax
    : (Number.isFinite(baseMax) ? baseMax : null);

  const oiLong = Number(pair.openInterest?.long);
  const oiShort = Number(pair.openInterest?.short);
  const openInterest =
    Number.isFinite(oiLong) && Number.isFinite(oiShort) ? oiLong + oiShort : null;

  return {
    id: `avantis-${symbol}`,
    symbol,
    /* `Equity.US.AAPL/USD` -> country code, so the UI can badge non-US names. */
    country: String(attrs.symbol ?? '').split('.')[1] || null,
    feedId,
    pairIndex: Number.isFinite(Number(pair.index)) ? Number(pair.index) : index,
    maxLeverage,
    openInterest,
    marketOpen: typeof isOpen === 'boolean' ? isOpen : null,
    nextOpen: nextOpen > 0 ? nextOpen * 1000 : null,
    price: null
  };
}

/**
 * The equity list, priced.
 *
 * ─── WHY PRICES ARE FETCHED IN ONE CALL ─────────────────────────────────────
 * Hermes accepts repeated `ids[]`, so all ~40 equities cost ONE request rather
 * than forty. Forty outbound calls per cache miss would be slower than the
 * client timeout and would get us rate-limited off a free public endpoint.
 *
 * ─── AND WHY A PRICE FAILURE IS NOT FATAL ───────────────────────────────────
 * If Hermes is down the list still returns, with `price: null` on every row.
 * The names, market hours and leverage caps are all still true and useful.
 * Throwing instead would blank a whole section of the Stocks screen because a
 * third-party price feed hiccuped.
 */
export async function fetchAvantisEquities() {
  const data = await getJson(PAIRS_URL);

  const groups = data?.data?.groupInfo ?? {};
  const pairs = data?.data?.pairInfos ?? {};

  /* Find the equities group by name, then keep pairs pointing at it. */
  const equityGroupIds = Object.entries(groups)
    .filter(([, g]) => String(g?.name ?? '').toUpperCase() === EQUITY_GROUP)
    .map(([id]) => Number(id));

  if (!equityGroupIds.length) return { rows: [], at: Date.now() };

  const rows = Object.values(pairs)
    .filter((p) => equityGroupIds.includes(Number(p?.groupIndex)))
    .map(toRow)
    .filter(Boolean);

  if (!rows.length) return { rows: [], at: Date.now() };

  /*
   * ─── ONE CALL, WITH A PER-FEED RETRY — AND WHY BOTH ARE NEEDED ──────────
   * Hermes is all-or-nothing: a single id it does not recognise fails the
   * ENTIRE request with "Price ids not found", taking every other price down
   * with it. That is exactly what happened on the first live deploy.
   *
   * The all-zero placeholder is already excluded above, but that fixes the
   * one case we found rather than the class. Avantis can list a pair before
   * Pyth publishes its feed at any time, so the batch is retried once with
   * `ignore_invalid_price_ids`, which makes Hermes return what it does know.
   * Belt and braces on purpose: the guard above keeps unpriceable rows off
   * the screen, and this keeps one unexpected id from blanking the rest.
   */
  const applyPrices = (feed) => {
    const byId = new Map(
      (Array.isArray(feed?.parsed) ? feed.parsed : []).map((p) => [bareId(p?.id), p])
    );
    for (const r of rows) {
      const hit = byId.get(r.feedId);
      if (hit) r.price = pythPrice(hit);
    }
  };

  const qs = rows.map((r) => `ids[]=${r.feedId}`).join('&');
  try {
    applyPrices(await getJson(`${HERMES_URL}?${qs}&parsed=true&encoding=hex`));
  } catch {
    try {
      applyPrices(
        await getJson(`${HERMES_URL}?${qs}&parsed=true&encoding=hex&ignore_invalid_price_ids=true`)
      );
    } catch {
      /* Prices unavailable; names, hours and leverage caps are still true. */
    }
  }

  /*
   * Sorted by open interest, biggest first. That is the honest proxy for "what
   * are people actually trading here" — alphabetical would bury the liquid
   * names, and there is no volume field in this payload to sort on instead.
   */
  rows.sort((a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0));

  return { rows, at: Date.now() };
}

/**
 * Cached for 60s, for callers that are not going through `serve()`.
 *
 * The route in app.js uses `serve(res, ttl)`, which already wraps the producer
 * in the same `withCache`. Double-wrapping would be harmless but pointless, so
 * the route passes `fetchAvantisEquities` directly and this helper exists for
 * any other caller.
 */
export function getAvantisEquities() {
  return withCache('avantis-equities', 60_000, fetchAvantisEquities);
}
