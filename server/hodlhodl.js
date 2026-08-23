/**
 * HODL HODL P2P MARKET — server-side proxy (the ONLY place that talks upstream)
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * The Buy screen and the P2P screen used to be directories that handed our
 * users to competitors and earned exactly nothing. This module powers the
 * honest version of "we are the exchange": live Hodl Hodl offers (buying and
 * selling bitcoin against local money, escrowed by multisig), browsed and
 * compared INSIDE our app, with the escrow contract itself completed on their
 * site by construction.
 *
 * Why them and not a custody-light clone of our own: a fiat P2P desk without
 * real escrow is the one theatre prop on a money screen that costs people
 * everything. Hodl Hodl runs 2-of-3 multisig escrow, needs no KYC to start,
 * and — the part that makes this a business instead of a directory — pays a
 * referral on the trades started here while LOWERING the referred user's own
 * fee (0.75% -> 0.5% permanent). The user is better off, not marked up.
 *
 * ─── THE SWAP MUST NEVER MEET THIS MODULE ─────────────────────────────────
 * Revenue here is 5-10% of Hodl Hodl's ~0.5% fee ≈ 0.025-0.05% of volume.
 * Revenue on our own swap is 0.70% of volume straight to our wallet. Same
 * user, same amount — roughly 25x apart. So this module is read-only market
 * data for fiat<->BTC: it is NOT a price source for crypto-to-crypto, it
 * never competes in "best quote", and nothing on the swap path may import
 * it. test/wiring.mjs enforces the boundary; breaking it stars 25x of our
 * own revenue for somebody else's referral table.
 *
 * ─── WHY A PROXY AT ALL (THERE IS NOTHING SECRET TO HIDE) ─────────────────
 * The public endpoints need no key. The proxy exists for the same reason
 * server/solanaOcean.js does: CONTROL OF THE REVENUE FIELD. The referral
 * code is read from HODLHODL_REF on every call and the trade links are built
 * here, server-side. A browser-side build would let anyone swap in their own
 * code — a one-line theft of the feature's entire revenue. Same pattern as
 * `referrer` on the Solana route.
 *
 * ─── WHAT THIS MODULE REFUSES TO DO ───────────────────────────────────────
 * Create contracts. Contract operations need the USER's own API key AND their
 * payment password, which per Hodl Hodl's own docs can only be created on
 * their website — by design, so that an integrator can never touch a user's
 * funds. Their "Signature Key" is not an env var this project will EVER
 * accept: it grants direct access to user funds and has no place here.
 * HODLHODL_API_KEY, if ever set, only raises OUR read rate limit — it is
 * never used to act for a user.
 *
 * ─── UPSTREAM FACTS (verified against live responses + api/docs) ──────────
 *   GET /api/v1/offers            — { status, filters, sort, pagination, offers[] }
 *   GET /api/v1/payment_methods   — { payment_methods: [{id,type,name,country_codes,global}] }
 *   GET /api/v1/currencies        — currency list
 *   GET /api/v1/countries         — country list
 *   docs: https://hodlhodl.com/api/docs
 *
 *   Side mapping (getting this backwards flips the whole page):
 *     filters[side]=sell  ->  the counterparty SELLS BTC  ->  our BUY tab
 *     filters[side]=buy   ->  the counterparty BUYS BTC   ->  our SELL tab
 *   Verified empirically: buy-side offers sit BELOW reference price
 *   (exchange_price_sign="-"), sell-side above it.
 *
 *   Payment methods come in TWO shapes depending on side: sell offers carry
 *   `payment_method_instructions` (the seller's own receiving instructions),
 *   buy offers carry `payment_methods`. Normalisation below reads BOTH; a
 *   reader that knows one shape renders the other tab empty.
 *
 *   Fee fields are FRACTIONS, not percents: the docs show
 *   author_fee_rate "0.01000000" alongside exchange_fee_percent "1.0".
 *
 *   Errors always carry {"status":"error","error_code":...} with the HTTP
 *   status to match: 429 rate_limit_exceeded ("rate limit is 2 per 60s" —
 *   the upstream budget is genuinely tight, hence the caching), 503
 *   not_available, 404 not_found. We translate, never invent.
 */

import { withCache } from './cache.js';

const HH_API = String(process.env.HODLHODL_BASE_URL || 'https://hodlhodl.com/api/v1')
  .trim()
  .replace(/\/+$/, '');
/** The human site, where escrow and the referral code live. Never carries secrets. */
const HH_SITE = 'https://hodlhodl.com';

const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

/* Upstream hard-limits anonymous reads (2/60s). A short offers TTL plus a
   long meta TTL keeps a browsing session well inside budget; the cache
   serves stale-but-honest data when upstream says no. */
const OFFER_TTL_MS = 25_000;
const META_TTL_MS = 6 * 60 * 60 * 1000;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_OFFSET = 2000;

/** Multi-kilobyte offer prose exists; the card renders two lines of it. */
const DESCRIPTION_MAX = 280;
const TITLE_MAX = 80;

/** Read on EVERY call so a Vercel rotation takes effect on the next request. */
const refCode = () => String(process.env.HODLHODL_REF || '').trim();
const REF_OK = /^[A-Za-z0-9_-]{2,40}$/;

/**
 * The referral code is public (it appears in every invite link Hodl Hodl
 * prints) but it is STILL never hardcoded: env-only means it rotates without
 * a deploy, and an invalid value disables referral cleanly instead of
 * building a broken link. Without it the whole page keeps working — links
 * just open plain (spec: refConfigured=false, no fake code ever).
 */
export function referralCode() {
  const code = refCode();
  return REF_OK.test(code) ? code : '';
}

const apiKey = () => String(process.env.HODLHODL_API_KEY || '').trim();

export const upstreamBase = () => HH_API;

/* ------------------------------------------------------------------------- */
/* Health: traffic-derived ONLY. A status route that pings upstream on every  */
/* call would eat the tight anonymous budget and — worse — a status page     */
/* that claims health it never measured is exactly the /api/solana/oo bug.   */
/* ------------------------------------------------------------------------- */
const health = {
  lastOkAt: 0,
  lastErrAt: 0,
  lastErrCode: null,
  lastErrDetail: null,
  calls: 0
};

const markOk = () => { health.lastOkAt = Date.now(); health.lastErrCode = null; };
const markErr = (code, detail) => {
  health.lastErrAt = Date.now();
  health.lastErrCode = code;
  health.lastErrDetail = detail ? String(detail).slice(0, 160) : null;
};

/** A typed refusal, so the route layer can answer honestly instead of 500ing. */
class UpstreamError extends Error {
  constructor(code, status, detail) {
    super(detail || code);
    this.code = code;
    this.status = status;
    this.detail = detail || null;
  }
}

async function hhFetch(path, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  health.calls += 1;
  try {
    const url = new URL(`${HH_API}${path}`);
    /*
     * Parameters are appended from an allow-list built by the CALLER of this
     * function (offersParams() etc). Nothing from the browser reaches this
     * point that did not pass validation there — the brackets in their names
     * (filters[side]) are Hodl Hodl's API contract, not client input.
     */
    for (const [k, v] of params) url.searchParams.append(k, v);

    const headers = { accept: 'application/json' };
    const key = apiKey();
    /* Optional, for a better rate limit ONLY (docs: Authorization: Bearer).
       Never echoed anywhere; no route may include it in a response. */
    if (key) headers.authorization = `Bearer ${key}`;

    const res = await fetch(url, { signal: ctrl.signal, headers });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }

    const errorCode =
      body && typeof body === 'object' && body.status === 'error'
        ? String(body.error_code || '')
        : '';

    if (res.status === 429 || errorCode === 'rate_limit_exceeded') {
      markErr('UPSTREAM_RATE_LIMIT', body?.message || 'rate_limit_exceeded');
      throw new UpstreamError('UPSTREAM_RATE_LIMIT', 429, body?.message || 'Upstream rate limit reached');
    }
    if (res.status === 503 || errorCode === 'not_available') {
      markErr('UPSTREAM_UNAVAILABLE', 'not_available');
      throw new UpstreamError('UPSTREAM_UNAVAILABLE', 503, 'Upstream reports itself temporarily unavailable');
    }
    if (!res.ok || (body && body.status === 'error')) {
      const detail = errorCode || `http_${res.status}`;
      markErr('UPSTREAM_FAILED', detail);
      throw new UpstreamError('UPSTREAM_FAILED', 502, `Upstream answered ${res.status}${errorCode ? ` (${errorCode})` : ''}`);
    }

    markOk();
    return body ?? {};
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    /* abort / DNS / TLS / reset */
    const timedOut = err?.name === 'AbortError';
    markErr('UPSTREAM_FAILED', timedOut ? 'timeout' : err?.message);
    throw new UpstreamError(
      'UPSTREAM_FAILED',
      502,
      timedOut ? `Upstream did not answer within ${TIMEOUT}ms` : 'Upstream unreachable'
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- */
/* Allow-list: browser vocabulary -> upstream parameters.                     */
/*                                                                            */
/* The client describes what it wants in OUR words (side=buy means "the user*/
/* wants to buy BTC"). The inversion to Hodl Hodl's vocabulary (an offer    */
/* whose side is "sell" serves a buyer) happens HERE, in exactly one place, */
/* so both tabs can never disagree about which list they are showing.       */
/* ------------------------------------------------------------------------- */

const RE_CURRENCY = /^[A-Za-z]{3}$/;
const RE_PM_ID = /^\d{1,12}$/;
const RE_COUNTRY = /^[A-Za-z ]{2,24}$/;
const RE_AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
const RE_ASSET = /^[A-Za-z]{2,6}$/;

function offersParams(q) {
  /*
   * THE SIDE INVERSION. Getting this backwards shows sellers to buyers and
   * the market appears inverted — the single most damaging bug available on
   * this page, so it is mapped once and asserted by the probe.
   */
  const ours = String(q.side || 'buy').toLowerCase();
  if (ours !== 'buy' && ours !== 'sell') return { error: errBody(400, 'BAD_SIDE', 'side must be "buy" or "sell"') };
  const upstreamSide = ours === 'buy' ? 'sell' : 'buy';

  const params = new Map();
  params.set('filters[side]', upstreamSide);
  params.set('sort[by]', 'price');
  /* Cheapest counterparty first for our buyer, best bid first for our seller. */
  params.set('sort[direction]', ours === 'buy' ? 'asc' : 'desc');

  let currency = null;
  if (q.currency != null && q.currency !== '') {
    const c = String(q.currency).toUpperCase();
    if (!RE_CURRENCY.test(c)) return { error: errBody(400, 'BAD_CURRENCY', 'currency must be a 3-letter code') };
    currency = c;
    params.set('filters[currency_code]', c);
  }

  if (q.paymentMethod != null && q.paymentMethod !== '') {
    const pm = String(q.paymentMethod);
    if (!RE_PM_ID.test(pm)) return { error: errBody(400, 'BAD_PAYMENT_METHOD', 'payment method must be a numeric id') };
    params.set('filters[payment_method_id]', pm);
  }

  if (q.country != null && q.country !== '') {
    const c = String(q.country).trim();
    if (!RE_COUNTRY.test(c)) return { error: errBody(400, 'BAD_COUNTRY', 'country must be a code or name') };
    params.set('filters[country]', c);
    /* A country-scoped search that excludes global desks loses most of the
       market; upstream supports including them explicitly. */
    params.set('filters[include_global]', 'true');
  }

  let amount = null;
  if (q.amount != null && q.amount !== '') {
    const a = String(q.amount).trim();
    if (!RE_AMOUNT.test(a)) return { error: errBody(400, 'BAD_AMOUNT', 'amount must be a positive number with at most 2 decimals') };
    amount = Number(a);
    if (!(amount > 0)) return { error: errBody(400, 'BAD_AMOUNT', 'amount must be positive') };
    params.set('filters[amount]', a);
  }

  if (q.workingNow === '1' || q.workingNow === 'true') params.set('filters[only_working_now]', 'true');

  /* Only BTC exists upstream today; still validated so a future asset code
     arrives as a contract, not as injected text. */
  const asset = q.asset ? String(q.asset).toUpperCase() : 'BTC';
  if (!RE_ASSET.test(asset)) return { error: errBody(400, 'BAD_ASSET', 'unknown asset code') };
  params.set('filters[asset_code]', asset);

  let limit = Number.parseInt(String(q.limit ?? ''), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);
  params.set('pagination[limit]', String(limit));

  let offset = Number.parseInt(String(q.offset ?? ''), 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.min(offset, MAX_OFFSET);
  params.set('pagination[offset]', String(offset));

  /* Layer (on-chain vs Lightning/Ark) is not an upstream filter — it is a
     field ON each offer, so it is applied after normalisation. */
  const layer = ['onchain', 'fast', 'any'].includes(String(q.layer)) ? String(q.layer) : 'any';

  return { ours, upstreamSide, currency, amount, asset, layer, limit, offset, params };
}

const errBody = (status, error, detail) => ({ status, body: { error, detail } });

/* ------------------------------------------------------------------------- */
/* Normalisation: exactly what the UI renders, nothing else.                  */
/*                                                                            */
/* Not raw pass-through, deliberately: descriptions run to kilobytes, trader */
/* payloads repeat per offer, and every extra byte is paid by a phone on a   */
/* slow connection for data it never displays.                               */
/* ------------------------------------------------------------------------- */

const asNum = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const asText = (v, max) => {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * Both payment-method shapes (see the header note). Sell offers carry
 * payment_method_instructions; buy offers carry payment_methods. Reading
 * only one shape is how one whole tab renders without a single method chip.
 */
function paymentMethodsOf(o) {
  const out = [];
  const push = (id, name) => {
    const n = asText(name, 48);
    if (n && !out.some((m) => m.name === n)) out.push({ id: id != null ? String(id) : null, name: n });
  };
  for (const pm of Array.isArray(o.payment_method_instructions) ? o.payment_method_instructions : []) {
    if (typeof pm === 'string') push(null, pm);
    else if (pm && typeof pm === 'object') push(pm.payment_method_id ?? pm.id, pm.payment_method_name ?? pm.name);
  }
  for (const pm of Array.isArray(o.payment_methods) ? o.payment_methods : []) {
    if (typeof pm === 'string') push(pm, pm);
    else if (pm && typeof pm === 'object') push(pm.id, pm.name ?? pm.type);
  }
  return out.slice(0, 6);
}

/**
 * The referral link pair, built HERE and nowhere else.
 *
 * tradeUrl  — always a plain offer link. Opens the very offer the user is
 *             looking at; safe with or without a referral configured.
 * joinUrl   — only when HODLHODL_REF is set: account creation through our
 *             code (verified behaviour: /join/<CODE> lands on signup with
 *             "Referral code entered" and lowers the account's fee from
 *             0.75% to 0.5% permanently). null when unconfigured — never a
 *             fabricated code, never a hardcoded fallback.
 */
export function tradeLinks(offerId) {
  const id = String(offerId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return { offerUrl: null, joinUrl: null, refConfigured: false };
  const ref = referralCode();
  return {
    offerUrl: `${HH_SITE}/offers/${encodeURIComponent(id)}`,
    joinUrl: ref ? `${HH_SITE}/join/${encodeURIComponent(ref)}` : null,
    refConfigured: Boolean(ref)
  };
}

function normalizeOffer(o, ctx) {
  if (!o || typeof o !== 'object' || o.id == null) return null;
  const price = asNum(o.price);

  /* Fee fields are FRACTIONS upstream ("0.005" = 0.5%) — the docs put
     author_fee_rate "0.01000000" next to exchange_fee_percent "1.0" in the
     same payload, which pins the unit. A value that doesn't parse stays
     null: the UI then shows "—" rather than inventing a rate. */
  const takerRate = asNum(o.fee?.intermediary_fee_rate);
  const authorRate = asNum(o.fee?.author_fee_rate);
  const takerPct = takerRate != null && takerRate >= 0 && takerRate <= 0.05 ? takerRate * 100 : null;
  const authorPct = authorRate != null && authorRate >= 0 && authorRate <= 0.05 ? authorRate * 100 : null;

  const minAmount = asNum(o.min_amount);
  const maxAmount = asNum(o.max_amount);
  const firstTradeLimit = asNum(o.first_trade_limit);

  /* min/max screening the moment an amount is present. Upstream applies
     filters[amount] itself; this is the belt to its braces, because the
     alternative is a card that fails only after the user chose it. */
  let fitsAmount = null;
  if (ctx.amount != null) {
    fitsAmount =
      (minAmount == null || ctx.amount >= minAmount) &&
      (maxAmount == null || maxAmount === 0 || ctx.amount <= maxAmount);
  }
  const firstTradeLimited =
    ctx.amount != null && firstTradeLimit != null && firstTradeLimit > 0 && ctx.amount > firstTradeLimit;

  /* Effective price — what the user actually pays/earns per BTC once the
     desk's fee is inside the number. This is the sort key; raw price would
     rank a fee-heavy desk above an honest one. */
  let effectivePrice = null;
  if (price != null && price > 0) {
    const rate = takerPct != null ? takerPct / 100 : 0;
    effectivePrice = ctx.upstreamSide === 'sell' ? price * (1 + rate) : price * (1 - rate);
  }

  /* Server-side arithmetic ("how much you give / how much you get") so the
     client never invents money figures. All BTC figures rounded to sat. */
  let quote = null;
  if (ctx.amount != null && price != null && price > 0) {
    const btc = ctx.amount / price;
    const feeRate = takerPct != null ? takerPct / 100 : null;
    const estFeeBtc = feeRate != null ? btc * feeRate : null;
    const sat = (n) => (n == null ? null : Number(n.toFixed(8)));
    quote =
      ctx.upstreamSide === 'sell'
        ? {
            direction: 'buy',
            payFiat: ctx.amount,
            grossBtc: sat(btc),
            estFeeBtc: sat(estFeeBtc),
            netBtc: sat(estFeeBtc != null ? btc - estFeeBtc : null)
          }
        : {
            direction: 'sell',
            receiveFiat: ctx.amount,
            tradeBtc: sat(btc),
            estFeeBtc: sat(estFeeBtc),
            depositBtc: sat(estFeeBtc != null ? btc + estFeeBtc : null)
          };
  }

  const layer = asText(o.asset_layer, 12) || 'BTC';
  const trader = o.trader && typeof o.trader === 'object' ? o.trader : {};

  return {
    id: String(o.id),
    side: o.side === 'buy' ? 'buy' : 'sell',
    assetCode: asText(o.asset_code, 8) || 'BTC',
    assetLayer: layer,
    onchain: layer === 'BTC',
    title: asText(o.title, TITLE_MAX),
    description: asText(o.description, DESCRIPTION_MAX),
    currencyCode: asText(o.currency_code, 4) || ctx.currency,
    price,
    priceSource: asText(o.price_source, 16),
    exchangeRateProvider: asText(o.exchange_rate_provider, 24),
    exchangePriceDeviation: asNum(o.exchange_price_deviation),
    exchangePriceSign: o.exchange_price_sign === '+' || o.exchange_price_sign === '-' ? o.exchange_price_sign : null,
    exchangePriceUnit: asText(o.exchange_price_unit, 8),
    amountSource: asText(o.amount_source, 8),
    minAmount,
    maxAmount,
    minAmountSats: asNum(o.min_amount_sats),
    maxAmountSats: asNum(o.max_amount_sats),
    firstTradeLimit,
    workingNow: Boolean(o.working_now),
    country: asText(o.country, 40),
    countryCode: asText(o.country_code, 12),
    paymentWindowMinutes: asNum(o.payment_window_minutes),
    confirmations: asNum(o.confirmations),
    fee: { takerPct, authorPct },
    paymentMethods: paymentMethodsOf(o),
    trader: {
      login: asText(trader.login, 40),
      onlineStatus: asText(trader.online_status, 24),
      rating: asNum(trader.rating),
      tradesCount: asNum(trader.trades_count),
      verified: Boolean(trader.verified),
      strongHodler: Boolean(trader.strong_hodler),
      avgPaymentMinutes: asNum(trader.average_payment_time_minutes),
      avgReleaseMinutes: asNum(trader.average_release_time_minutes),
      daysSinceLastTrade: asNum(trader.days_since_last_trade),
      url: asText(trader.url, 120)
    },
    fitsAmount,
    firstTradeLimited,
    effectivePrice,
    quote,
    trade: tradeLinks(o.id)
  };
}

/* ------------------------------------------------------------------------- */
/* Public module API                                                          */
/* ------------------------------------------------------------------------- */

export async function p2pOffers(query) {
  const parsed = offersParams(query ?? {});
  if (parsed.error) return parsed.error;
  const ctx = parsed;

  /* The cache key is the NORMALISED parameter set — client key order, casing
     differences and junk parameters (rejected above) can never split it. The
     layer belongs in the key even though it is not an upstream parameter:
     it is applied AFTER normalisation, so a key built from upstream params
     alone would serve the unfiltered page to a filtered tab. Found exactly
     that way — the probe's layer toggle returned the cached "any" list. */
  const cacheKey = `hh:offers:${JSON.stringify([...ctx.params.entries(), ['layer', ctx.layer]])}`;

  try {
    const { value, stale } = await withCache(cacheKey, OFFER_TTL_MS, async () => {
      const raw = await hhFetch('/offers', [...ctx.params.entries()]);
      const list = Array.isArray(raw.offers) ? raw.offers : [];
      const normalized = list.map((o) => normalizeOffer(o, ctx)).filter(Boolean);

      /* Layer screening happens here: on-chain bitcoin desks vs the fast
         layers (Lightning/Ark) — the toggle never re-fetches. */
      const screened =
        ctx.layer === 'onchain' ? normalized.filter((o) => o.onchain)
        : ctx.layer === 'fast' ? normalized.filter((o) => !o.onchain)
        : normalized;

      /* Effective price decides the order; offers that can't price (or that
         reject the amount) sink below every comparable one rather than
         disappearing silently. */
      const rank = (o) => (o.price == null ? 1 : 0) * 2 + (o.fitsAmount === false ? 1 : 0);
      screened.sort((a, b) => {
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        const pa = a.effectivePrice ?? Number.POSITIVE_INFINITY;
        const pb = b.effectivePrice ?? Number.POSITIVE_INFINITY;
        /* buy tab: cheapest effective cost first; sell tab: best bid first */
        return ctx.ours === 'buy' ? pa - pb : pb - pa;
      });

      return {
        offers: screened,
        rawCount: list.length,
        fetchedAt: Date.now()
      };
    });

    return {
      status: 200,
      body: {
        side: ctx.ours,
        currency: ctx.currency,
        amount: ctx.amount,
        layer: ctx.layer,
        limit: ctx.limit,
        offset: ctx.offset,
        count: value.offers.length,
        /* full upstream page => there is very likely a next one */
        hasMore: value.rawCount >= ctx.limit,
        stale: Boolean(stale),
        fetchedAt: value.fetchedAt,
        refConfigured: Boolean(referralCode()),
        offers: value.offers
      }
    };
  } catch (err) {
    if (err instanceof UpstreamError) return { status: err.status, body: { error: err.code, detail: err.detail, retryable: true } };
    return { status: 502, body: { error: 'UPSTREAM_FAILED', detail: 'unexpected proxy failure', retryable: true } };
  }
}

/* ------------------------------ meta: currencies ------------------------- */

const normalizeCodeName = (item) => {
  if (typeof item === 'string' && item) return { code: item.slice(0, 12), name: item.slice(0, 60) };
  if (item && typeof item === 'object') {
    const code = item.code ?? item.currency ?? item.currency_code ?? null;
    if (code == null) return null;
    return { code: String(code).slice(0, 12), name: String(item.name ?? code).slice(0, 60) };
  }
  return null;
};

export async function p2pCurrencies() {
  try {
    const { value, stale } = await withCache('hh:currencies', META_TTL_MS, async () => {
      const raw = await hhFetch('/currencies', []);
      /* The docs example shape may drift; read the known arrays defensively
         rather than 500ing on the day one key is renamed. */
      const arr =
        (Array.isArray(raw.currencies) && raw.currencies) ||
        (Array.isArray(raw.data) && raw.data) ||
        (Array.isArray(raw) && raw) ||
        [];
      return arr.map(normalizeCodeName).filter(Boolean).slice(0, 300);
    });
    return { status: 200, body: { stale: Boolean(stale), currencies: value } };
  } catch (err) {
    if (err instanceof UpstreamError) return { status: err.status, body: { error: err.code, detail: err.detail, retryable: true } };
    return { status: 502, body: { error: 'UPSTREAM_FAILED', retryable: true } };
  }
}

export async function p2pCountries() {
  try {
    const { value, stale } = await withCache('hh:countries', META_TTL_MS, async () => {
      const raw = await hhFetch('/countries', []);
      const arr =
        (Array.isArray(raw.countries) && raw.countries) ||
        (Array.isArray(raw.data) && raw.data) ||
        (Array.isArray(raw) && raw) ||
        [];
      return arr.map(normalizeCodeName).filter(Boolean).slice(0, 300);
    });
    return { status: 200, body: { stale: Boolean(stale), countries: value } };
  } catch (err) {
    if (err instanceof UpstreamError) return { status: err.status, body: { error: err.code, detail: err.detail, retryable: true } };
    return { status: 502, body: { error: 'UPSTREAM_FAILED', retryable: true } };
  }
}

export async function p2pPaymentMethods(query) {
  const params = new Map();
  if (query?.country != null && query.country !== '') {
    const c = String(query.country).trim();
    if (!RE_COUNTRY.test(c)) return errBody(400, 'BAD_COUNTRY', 'country must be a code or name');
    params.set('filters[country]', c);
  }
  const cacheKey = `hh:pm:${params.get('filters[country]') ?? 'ALL'}`;
  try {
    const { value, stale } = await withCache(cacheKey, META_TTL_MS, async () => {
      const raw = await hhFetch('/payment_methods', [...params.entries()]);
      const arr = Array.isArray(raw.payment_methods) ? raw.payment_methods : [];
      const seen = new Set();
      const out = [];
      for (const pm of arr) {
        if (!pm || typeof pm !== 'object' || pm.id == null) continue;
        const id = String(pm.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const name = asText(pm.name, 48);
        if (!name) continue;
        out.push({
          id,
          name,
          type: asText(pm.type, 24),
          global: Boolean(pm.global),
          countryCodes: Array.isArray(pm.country_codes) ? pm.country_codes.slice(0, 12).map(String) : []
        });
        if (out.length >= 200) break;
      }
      return out;
    });
    return { status: 200, body: { stale: Boolean(stale), paymentMethods: value } };
  } catch (err) {
    if (err instanceof UpstreamError) return { status: err.status, body: { error: err.code, detail: err.detail, retryable: true } };
    return { status: 502, body: { error: 'UPSTREAM_FAILED', retryable: true } };
  }
}

/* ------------------------------- status ---------------------------------- */

/**
 * HONEST status — the /api/solana/oo/status lesson is one page over in this
 * repo: a status route that answers "healthy" while every query fails is
 * worse than no status at all. Everything here is derived from real calls
 * that already happened (or their absence — `unknown`, never `ok`).
 */
export function p2pStatus() {
  return {
    refConfigured: Boolean(referralCode()),
    keyConfigured: Boolean(apiKey()),
    upstream: HH_API,
    upstreamState:
      health.calls === 0 ? 'unknown'
      : health.lastOkAt >= health.lastErrAt ? 'ok'
      : 'error',
    lastOkAt: health.lastOkAt || null,
    lastErrorAt: health.lastErrAt || null,
    lastErrorCode: health.lastErrCode,
    lastErrorDetail: health.lastErrDetail,
    offerTtlSeconds: OFFER_TTL_MS / 1000,
    metaTtlHours: META_TTL_MS / 3600000,
    notes: [
      'read-only: offers, payment methods, currencies, countries',
      'escrow/contracts stay on hodlhodl.com by design',
      'referral link is built here from HODLHODL_REF, never in the browser'
    ]
  };
}

/** Test seam: reset cached health lines without restarting the process. */
export function _resetHealthForTests() {
  health.lastOkAt = 0;
  health.lastErrAt = 0;
  health.lastErrCode = null;
  health.lastErrDetail = null;
  health.calls = 0;
}
