/**
 * Alpha Vantage provider — ETF quotes/profiles + gold spot/history (read-only).
 * ---------------------------------------------------------------------------
 * Server-side only. The API key is read from ALPHA_VANTAGE_API_KEY and must
 * never appear in a response body, log line, error message, or client bundle.
 *
 * Contract:
 *   - fail-closed: no synthetic/estimated prices, no crypto→ETF conversion
 *   - Information / Note / Error Message payloads are NOT success
 *   - at most one controlled retry for transient network/5xx (never 4xx/rate-limit)
 *   - AbortController timeout on every upstream call
 *   - cache-first + single-flight via withCache; stale-if-error via memory fallback
 *
 * Endpoints used (official):
 *   ETF_PROFILE, GLOBAL_QUOTE, GOLD_SILVER_SPOT, GOLD_SILVER_HISTORY
 */

import { withCache, getCached, memoryStore } from '../cache.js';

export const AV_SCHEMA = 'fbt.alpha-vantage.v1';
export const AV_PROVIDER = 'alpha-vantage';

const BASE = 'https://www.alphavantage.co/query';
const TIMEOUT_MS = Number(process.env.ALPHA_VANTAGE_TIMEOUT_MS || 10_000);

/** Phase-1 allowlist — only these symbols are served. */
export const ETF_UNIVERSE = Object.freeze({
  bitcoin: Object.freeze(['IBIT', 'FBTC', 'ARKB', 'BITB', 'GBTC', 'BTCW', 'HODL', 'BRRR', 'EZBC']),
  ethereum: Object.freeze(['ETHA', 'FETH', 'ETHE', 'ETHW', 'ETHV', 'EZET']),
  gold: Object.freeze(['GLD', 'IAU', 'GLDM', 'SGOL', 'BAR'])
});

export const ALL_ETF_SYMBOLS = Object.freeze([
  ...ETF_UNIVERSE.bitcoin,
  ...ETF_UNIVERSE.ethereum,
  ...ETF_UNIVERSE.gold
]);

const ETF_CATEGORY = Object.freeze(
  Object.fromEntries([
    ...ETF_UNIVERSE.bitcoin.map((s) => [s, 'bitcoin']),
    ...ETF_UNIVERSE.ethereum.map((s) => [s, 'ethereum']),
    ...ETF_UNIVERSE.gold.map((s) => [s, 'gold'])
  ])
);

/** Display names when the profile endpoint has not answered yet. */
const ETF_DISPLAY = Object.freeze({
  IBIT: 'iShares Bitcoin Trust',
  FBTC: 'Fidelity Wise Origin Bitcoin Fund',
  ARKB: 'ARK 21Shares Bitcoin ETF',
  BITB: 'Bitwise Bitcoin ETF',
  GBTC: 'Grayscale Bitcoin Trust ETF',
  BTCW: 'WisdomTree Bitcoin Fund',
  HODL: 'VanEck Bitcoin Trust',
  BRRR: 'Valkyrie Bitcoin Fund',
  EZBC: 'Franklin Bitcoin ETF',
  ETHA: 'iShares Ethereum Trust',
  FETH: 'Fidelity Ethereum Fund',
  ETHE: 'Grayscale Ethereum Trust ETF',
  ETHW: 'Bitwise Ethereum ETF',
  ETHV: 'VanEck Ethereum ETF',
  EZET: 'Franklin Ethereum ETF',
  GLD: 'SPDR Gold Shares',
  IAU: 'iShares Gold Trust',
  GLDM: 'SPDR Gold MiniShares',
  SGOL: 'abrdn Physical Gold Shares',
  BAR: 'GraniteShares Gold Trust'
});

export const TTL = Object.freeze({
  quoteMs: 15 * 60_000,
  profileMs: 24 * 3600_000,
  goldSpotMs: 12 * 60_000,
  goldHistoryMs: 12 * 3600_000,
  /** How long a last-good value may be served as stale after upstream failure. */
  staleGraceMs: 7 * 24 * 3600_000
});

const MEM_CAP = 256;
const memFallback = new Map(); // key → { value, at }

function remember(key, value) {
  if (memFallback.size >= MEM_CAP) {
    const oldest = memFallback.keys().next().value;
    memFallback.delete(oldest);
  }
  memFallback.set(key, { value, at: Date.now() });
}

function recall(key) {
  const hit = memFallback.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL.staleGraceMs) {
    memFallback.delete(key);
    return null;
  }
  return hit;
}

/* ── key hygiene ─────────────────────────────────────────────────────────── */

export function alphaVantageConfigured() {
  const k = process.env.ALPHA_VANTAGE_API_KEY;
  return typeof k === 'string' && k.trim().length >= 8;
}

function apiKey() {
  const k = process.env.ALPHA_VANTAGE_API_KEY;
  return typeof k === 'string' ? k.trim() : '';
}

/** Strip any apikey=… query fragment so logs/errors never leak the secret. */
export function redactUrl(url) {
  return String(url || '').replace(/([?&]apikey=)[^&]*/gi, '$1***');
}

export function assertNoSecretLeak(text, key = apiKey()) {
  if (!key || key.length < 4) return true;
  const s = String(text || '');
  if (s.includes(key)) throw new Error('SECRET_LEAK_BLOCKED');
  return true;
}

/* ── errors ──────────────────────────────────────────────────────────────── */

export class AlphaVantageError extends Error {
  constructor(code, { status = 0, detail = null, retryable = false } = {}) {
    super(code);
    this.name = 'AlphaVantageError';
    this.code = code;
    this.status = status;
    this.detail = detail ? String(detail).slice(0, 160) : null;
    this.retryable = retryable === true;
  }
}

function isRateLimitPayload(json) {
  if (!json || typeof json !== 'object') return false;
  const blob = `${json.Note || ''} ${json.Information || ''} ${json['Error Message'] || ''}`.toLowerCase();
  return /rate limit|thank you for using alpha vantage|call frequency|per minute|premium/.test(blob);
}

function isErrorPayload(json) {
  if (!json || typeof json !== 'object') return true;
  if (json['Error Message']) return true;
  if (json.Note) return true;
  if (json.Information) return true;
  return false;
}

/* ── transport ───────────────────────────────────────────────────────────── */

async function rawFetch(params, { timeout = TIMEOUT_MS } = {}) {
  const key = apiKey();
  if (!key) throw new AlphaVantageError('PROVIDER_NOT_CONFIGURED', { status: 503 });

  const qs = new URLSearchParams({ ...params, apikey: key });
  const url = `${BASE}?${qs.toString()}`;
  const safe = redactUrl(url);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (res.status === 429) {
      throw new AlphaVantageError('RATE_LIMITED', { status: 429, detail: 'upstream 429', retryable: false });
    }
    if (res.status >= 500) {
      throw new AlphaVantageError('UPSTREAM_5XX', { status: res.status, detail: `HTTP ${res.status}`, retryable: true });
    }
    if (!res.ok) {
      throw new AlphaVantageError('UPSTREAM_HTTP', { status: res.status, detail: `HTTP ${res.status}`, retryable: false });
    }
    let json;
    try {
      json = await res.json();
    } catch {
      throw new AlphaVantageError('MALFORMED_JSON', { status: res.status, detail: 'body was not JSON', retryable: false });
    }
    if (isRateLimitPayload(json)) {
      throw new AlphaVantageError('RATE_LIMITED', {
        status: 429,
        detail: String(json.Note || json.Information || 'rate limit').slice(0, 120),
        retryable: false
      });
    }
    if (isErrorPayload(json)) {
      throw new AlphaVantageError('UPSTREAM_ERROR', {
        status: 502,
        detail: String(json['Error Message'] || json.Information || json.Note || 'provider error').slice(0, 120),
        retryable: false
      });
    }
    return json;
  } catch (err) {
    if (err instanceof AlphaVantageError) throw err;
    if (err?.name === 'AbortError') {
      throw new AlphaVantageError('TIMEOUT', { status: 504, detail: `timeout after ${timeout}ms @ ${safe}`, retryable: true });
    }
    throw new AlphaVantageError('NETWORK', {
      status: 502,
      detail: redactUrl(String(err?.message || err)).slice(0, 120),
      retryable: true
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * At most ONE controlled retry for transient failures (timeout / 5xx / network).
 * Never retries rate-limit or 4xx.
 */
async function fetchOnce(params, { timeout = TIMEOUT_MS } = {}) {
  try {
    return await rawFetch(params, { timeout });
  } catch (err) {
    if (!(err instanceof AlphaVantageError) || !err.retryable) throw err;
    await sleep(400 + Math.floor(Math.random() * 200));
    return rawFetch(params, { timeout });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── normalisers ─────────────────────────────────────────────────────────── */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const round = (v, d = 4) => {
  const n = num(v);
  if (n === null) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

function metaBase({ cached = false, stale = false, fetchedAt = Date.now(), cacheAgeMs = 0, delayed = true } = {}) {
  return {
    provider: AV_PROVIDER,
    schema: AV_SCHEMA,
    fetchedAt,
    cached: cached === true,
    stale: stale === true,
    cacheAgeMs: Math.max(0, Number(cacheAgeMs) || 0),
    delayed: delayed !== false,
    realtime: delayed === false
  };
}

export function normalizeGlobalQuote(json, symbol) {
  const g = json?.['Global Quote'] || json?.globalQuote || null;
  if (!g || typeof g !== 'object') {
    throw new AlphaVantageError('QUOTE_SHAPE_UNUSABLE', { detail: 'missing Global Quote' });
  }
  const sym = String(g['01. symbol'] || symbol || '').toUpperCase();
  const price = num(g['05. price']);
  if (!sym || price === null || price <= 0) {
    throw new AlphaVantageError('QUOTE_SHAPE_UNUSABLE', { detail: 'price missing or non-positive' });
  }
  const change = num(g['09. change']);
  const changePctRaw = g['10. change percent'] ?? g['10. change percent '];
  const changePct = num(String(changePctRaw || '').replace(/%/g, ''));
  const category = ETF_CATEGORY[sym] || null;
  return {
    symbol: sym,
    name: ETF_DISPLAY[sym] || sym,
    category,
    priceUsd: round(price, 4),
    open: round(g['02. open'], 4),
    high: round(g['03. high'], 4),
    low: round(g['04. low'], 4),
    previousClose: round(g['08. previous close'], 4),
    changeUsd: round(change, 4),
    changePct: round(changePct, 4),
    volume: num(g['06. volume']),
    latestTradingDay: g['07. latest trading day'] || null,
    currency: 'USD',
    assetClass: 'etf',
    readOnly: true,
    executes: false
  };
}

export function normalizeEtfProfile(json, symbol) {
  if (!json || typeof json !== 'object') {
    throw new AlphaVantageError('PROFILE_SHAPE_UNUSABLE', { detail: 'empty profile' });
  }
  const sym = String(json.symbol || json.Symbol || symbol || '').toUpperCase();
  if (!sym) throw new AlphaVantageError('PROFILE_SHAPE_UNUSABLE', { detail: 'no symbol' });

  const netAssets = num(json.net_assets ?? json.netAssets ?? json.total_assets);
  const expense = num(json.expense_ratio ?? json.expenseRatio ?? json.net_expense_ratio);
  const holdingsRaw = json.holdings || json.Holdings || json.portfolio_holdings || null;
  let holdings = [];
  if (Array.isArray(holdingsRaw)) {
    holdings = holdingsRaw.slice(0, 40).map((h) => ({
      symbol: String(h.symbol || h.Symbol || h.name || '').slice(0, 24) || null,
      name: String(h.name || h.Name || h.description || '').slice(0, 80) || null,
      weight: num(h.weight || h.Weighting || h.pct)
    })).filter((h) => h.symbol || h.name);
  } else if (holdingsRaw && typeof holdingsRaw === 'object') {
    holdings = Object.entries(holdingsRaw).slice(0, 40).map(([k, v]) => ({
      symbol: String(k).slice(0, 24),
      name: typeof v === 'object' ? String(v?.name || '').slice(0, 80) : null,
      weight: typeof v === 'object' ? num(v?.weight) : num(v)
    }));
  }

  return {
    symbol: sym,
    name: String(json.name || json.Name || ETF_DISPLAY[sym] || sym).slice(0, 120),
    description: String(json.description || json.Description || '').slice(0, 800) || null,
    category: ETF_CATEGORY[sym] || String(json.asset_type || json.category || 'etf').toLowerCase(),
    exchange: json.exchange || json.Exchange || null,
    currency: json.currency || json.Currency || 'USD',
    inceptionDate: json.inception_date || json.inceptionDate || null,
    netAssetsUsd: netAssets,
    expenseRatioPct: expense,
    dividendYieldPct: num(json.dividend_yield ?? json.dividendYield),
    holdings,
    assetClass: 'etf',
    readOnly: true,
    executes: false,
    source: AV_PROVIDER
  };
}

export function normalizeGoldSpot(json) {
  /* Documented shapes vary slightly across rollouts; accept the known keys. */
  const price =
    num(json?.price) ??
    num(json?.spot_price) ??
    num(json?.['spot price']) ??
    num(json?.value) ??
    num(json?.close) ??
    num(json?.data?.price) ??
    num(json?.data?.spot_price) ??
    (() => {
      const items = json?.data || json?.items || json?.prices;
      if (Array.isArray(items) && items[0]) {
        return num(items[0].price ?? items[0].value ?? items[0].close);
      }
      return null;
    })();

  if (price === null || price <= 0) {
    throw new AlphaVantageError('GOLD_SPOT_SHAPE_UNUSABLE', { detail: 'no positive spot price' });
  }

  const unit = String(json?.unit || json?.price_unit || 'USD per troy ounce');
  const asOf =
    json?.timestamp ||
    json?.as_of ||
    json?.date ||
    json?.data?.timestamp ||
    json?.data?.date ||
    null;

  return {
    symbol: 'XAU',
    name: 'Gold Spot',
    priceUsd: round(price, 4),
    currency: 'USD',
    unit: /troy/i.test(unit) ? 'USD per troy ounce' : unit,
    unitLabel: 'USD per troy ounce',
    asOf: asOf ? (Number.isFinite(Number(asOf)) ? Number(asOf) : Date.parse(asOf) || asOf) : null,
    changePct: num(json?.change_percent ?? json?.changePct ?? json?.data?.change_percent),
    changeUsd: num(json?.change ?? json?.changeUsd ?? json?.data?.change),
    assetClass: 'commodities',
    kind: 'spot_metal',
    metal: 'gold',
    readOnly: true,
    executes: false,
    source: AV_PROVIDER
  };
}

export function normalizeGoldHistory(json, interval = 'daily') {
  /* Prefer an explicit series key; fall back to scanning object values. */
  let series =
    json?.['Time Series (Daily)'] ||
    json?.['Time Series (Weekly)'] ||
    json?.['Time Series (Monthly)'] ||
    json?.data ||
    json?.prices ||
    json?.history ||
    null;

  if (Array.isArray(series)) {
    const points = series
      .map((row) => {
        const t = Date.parse(row.date || row.timestamp || row.t || row.time || '');
        const p = num(row.close ?? row.price ?? row.value ?? row.c);
        if (!Number.isFinite(t) || p === null || p <= 0) return null;
        return { t, price: round(p, 4) };
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
    if (!points.length) throw new AlphaVantageError('GOLD_HISTORY_SHAPE_UNUSABLE', { detail: 'empty array series' });
    return { interval, unit: 'USD per troy ounce', points, count: points.length };
  }

  if (series && typeof series === 'object') {
    const points = Object.entries(series)
      .map(([date, row]) => {
        const t = Date.parse(date);
        const p = num(
          typeof row === 'object'
            ? (row['4. close'] ?? row.close ?? row.price ?? row.value)
            : row
        );
        if (!Number.isFinite(t) || p === null || p <= 0) return null;
        return { t, price: round(p, 4) };
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
    if (!points.length) throw new AlphaVantageError('GOLD_HISTORY_SHAPE_UNUSABLE', { detail: 'empty object series' });
    return { interval, unit: 'USD per troy ounce', points, count: points.length };
  }

  throw new AlphaVantageError('GOLD_HISTORY_SHAPE_UNUSABLE', { detail: 'no recognised series key' });
}

/* ── cache-aware readers ─────────────────────────────────────────────────── */

async function cachedRead(cacheKey, ttlMs, producer) {
  try {
    const { value, cached, stale } = await withCache(cacheKey, ttlMs, async () => {
      const fresh = await producer();
      if (fresh == null) throw new AlphaVantageError('EMPTY_PRODUCER', { detail: 'producer returned null' });
      remember(cacheKey, fresh);
      return fresh;
    });
    if (value == null) {
      /* A prior test reset may have left a null sentinel in the TTL map. */
      throw new AlphaVantageError('CACHE_MISS', { detail: 'null cache entry', retryable: true });
    }
    const mem = recall(cacheKey);
    const fetchedAt = value?.meta?.fetchedAt || mem?.at || Date.now();
    const cacheAgeMs = Math.max(0, Date.now() - fetchedAt);
    return {
      ...value,
      meta: {
        ...(value.meta || metaBase()),
        cached: cached === true || stale === true,
        stale: stale === true,
        cacheAgeMs,
        fetchedAt
      }
    };
  } catch (err) {
    const mem = recall(cacheKey);
    if (mem?.value) {
      return {
        ...mem.value,
        meta: {
          ...(mem.value.meta || metaBase()),
          cached: true,
          stale: true,
          cacheAgeMs: Date.now() - mem.at,
          fetchedAt: mem.at,
          staleReason: err?.code || 'UPSTREAM_FAILED'
        }
      };
    }
    /* Also try the shared TTL cache's expired entry (skip null sentinels). */
    const hit = getCached(cacheKey);
    if (hit?.value != null) {
      return {
        ...hit.value,
        meta: {
          ...(hit.value.meta || metaBase()),
          cached: true,
          stale: true,
          cacheAgeMs: Date.now() - (hit.at || 0),
          fetchedAt: hit.at || Date.now(),
          staleReason: err?.code || 'UPSTREAM_FAILED'
        }
      };
    }
    throw err;
  }
}

/* ── public API ──────────────────────────────────────────────────────────── */

export function isKnownEtf(symbol) {
  const s = String(symbol || '').toUpperCase();
  return Boolean(ETF_CATEGORY[s]);
}

export function etfCategory(symbol) {
  return ETF_CATEGORY[String(symbol || '').toUpperCase()] || null;
}

export async function fetchEtfQuote(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!isKnownEtf(sym)) throw new AlphaVantageError('SYMBOL_NOT_ALLOWLISTED', { status: 400, detail: sym });
  if (!alphaVantageConfigured()) throw new AlphaVantageError('PROVIDER_NOT_CONFIGURED', { status: 503 });

  const cacheKey = `av:etf:quote:${sym}`;
  return cachedRead(cacheKey, TTL.quoteMs, async () => {
    const json = await fetchOnce({ function: 'GLOBAL_QUOTE', symbol: sym });
    const quote = normalizeGlobalQuote(json, sym);
    const fetchedAt = Date.now();
    return {
      ok: true,
      quote,
      meta: metaBase({ fetchedAt, delayed: true })
    };
  });
}

export async function fetchEtfProfile(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!isKnownEtf(sym)) throw new AlphaVantageError('SYMBOL_NOT_ALLOWLISTED', { status: 400, detail: sym });
  if (!alphaVantageConfigured()) throw new AlphaVantageError('PROVIDER_NOT_CONFIGURED', { status: 503 });

  const cacheKey = `av:etf:profile:${sym}`;
  return cachedRead(cacheKey, TTL.profileMs, async () => {
    const json = await fetchOnce({ function: 'ETF_PROFILE', symbol: sym });
    const profile = normalizeEtfProfile(json, sym);
    const fetchedAt = Date.now();
    return {
      ok: true,
      profile,
      meta: metaBase({ fetchedAt, delayed: true })
    };
  });
}

/**
 * Batch ETF quotes for the whole phase-1 universe (or a category subset).
 * Sequential with a tiny gap so a free-tier key is not burst-limited; results
 * are individually cached so subsequent page loads hit cache, not upstream.
 */
export async function fetchEtfUniverse({ category = null, symbols = null } = {}) {
  if (!alphaVantageConfigured()) throw new AlphaVantageError('PROVIDER_NOT_CONFIGURED', { status: 503 });

  let list;
  if (Array.isArray(symbols) && symbols.length) {
    list = symbols.map((s) => String(s).toUpperCase()).filter(isKnownEtf);
  } else if (category && ETF_UNIVERSE[category]) {
    list = [...ETF_UNIVERSE[category]];
  } else {
    list = [...ALL_ETF_SYMBOLS];
  }

  const cacheKey = `av:etf:universe:${category || 'all'}:${list.join(',')}`;
  return cachedRead(cacheKey, TTL.quoteMs, async () => {
    const rows = [];
    const failed = [];
    for (const sym of list) {
      try {
        const one = await fetchEtfQuote(sym);
        if (one?.quote) rows.push({ ...one.quote, meta: one.meta });
        else failed.push({ symbol: sym, code: 'EMPTY' });
      } catch (err) {
        failed.push({ symbol: sym, code: err?.code || 'FAILED', detail: err?.detail || null });
      }
      /* Gentle spacing between symbols on a cold fill — cache hits skip this path. */
      if (list.length > 1) await sleep(80);
    }
    if (!rows.length) {
      throw new AlphaVantageError('NO_ETF_QUOTES', {
        status: 502,
        detail: failed.map((f) => `${f.symbol}:${f.code}`).join(',').slice(0, 160)
      });
    }
    const fetchedAt = Date.now();
    const byCategory = { bitcoin: [], ethereum: [], gold: [] };
    for (const r of rows) {
      const cat = r.category || etfCategory(r.symbol);
      if (byCategory[cat]) byCategory[cat].push(r);
    }
    return {
      ok: true,
      count: rows.length,
      rows,
      byCategory,
      failed,
      partial: failed.length > 0,
      readOnly: true,
      executes: false,
      meta: metaBase({ fetchedAt, delayed: true })
    };
  });
}

export async function fetchGoldSpot() {
  if (!alphaVantageConfigured()) throw new AlphaVantageError('PROVIDER_NOT_CONFIGURED', { status: 503 });
  const cacheKey = 'av:gold:spot:XAU';
  return cachedRead(cacheKey, TTL.goldSpotMs, async () => {
    let json;
    try {
      json = await fetchOnce({ function: 'GOLD_SILVER_SPOT', symbol: 'XAU' });
    } catch (err) {
      if (err?.code === 'UPSTREAM_ERROR' || err?.code === 'GOLD_SPOT_SHAPE_UNUSABLE') {
        json = await fetchOnce({ function: 'GOLD_SILVER_SPOT', symbol: 'GOLD' });
      } else {
        throw err;
      }
    }
    const spot = normalizeGoldSpot(json);
    const fetchedAt = Date.now();
    return {
      ok: true,
      spot,
      meta: metaBase({ fetchedAt, delayed: true })
    };
  });
}

export async function fetchGoldHistory({ interval = 'daily' } = {}) {
  if (!alphaVantageConfigured()) throw new AlphaVantageError('PROVIDER_NOT_CONFIGURED', { status: 503 });
  const iv = ['daily', 'weekly', 'monthly'].includes(String(interval)) ? String(interval) : 'daily';
  const cacheKey = `av:gold:history:XAU:${iv}`;
  return cachedRead(cacheKey, TTL.goldHistoryMs, async () => {
    let json;
    try {
      json = await fetchOnce({ function: 'GOLD_SILVER_HISTORY', symbol: 'XAU', interval: iv });
    } catch (err) {
      if (err?.code === 'UPSTREAM_ERROR' || err?.code === 'GOLD_HISTORY_SHAPE_UNUSABLE') {
        json = await fetchOnce({ function: 'GOLD_SILVER_HISTORY', symbol: 'GOLD', interval: iv });
      } else {
        throw err;
      }
    }
    const history = normalizeGoldHistory(json, iv);
    const fetchedAt = Date.now();
    return {
      ok: true,
      history,
      meta: metaBase({ fetchedAt, delayed: true })
    };
  });
}

/* ── health / probe state (process-local; honest across cold starts via UNOBSERVED) */

const probeState = {
  lastOkAt: 0,
  lastErrorAt: 0,
  lastError: null,
  lastSuccessKind: null,
  observed: false
};

export function getAlphaVantageProbeState() {
  return { ...probeState, configured: alphaVantageConfigured() };
}

export function recordAlphaVantageProbe(ok, { kind = null, error = null } = {}) {
  probeState.observed = true;
  if (ok) {
    probeState.lastOkAt = Date.now();
    probeState.lastSuccessKind = kind || probeState.lastSuccessKind;
    probeState.lastError = null;
  } else {
    probeState.lastErrorAt = Date.now();
    probeState.lastError = String(error || 'PROBE_FAILED').slice(0, 120);
  }
  return getAlphaVantageProbeState();
}

/**
 * Health classification for Central Brain:
 *   UNAVAILABLE — key not set
 *   UNOBSERVED  — key set, no successful or failed real probe yet
 *   HEALTHY     — at least one valid read since process start (or recent ok)
 *   DEGRADED    — last success exists but recent failure / serving stale
 *   DOWN        — configured, observed failures, no valid cache
 */
export function alphaVantageHealth({ hasValidCache = false, servingStale = false } = {}) {
  if (!alphaVantageConfigured()) {
    return {
      status: 'UNAVAILABLE',
      detail: 'ALPHA_VANTAGE_API_KEY is not configured',
      configured: false,
      observed: false,
      executes: false
    };
  }
  if (!probeState.observed) {
    return {
      status: 'UNOBSERVED',
      detail: 'provider configured; no real probe has completed yet',
      configured: true,
      observed: false,
      executes: false
    };
  }
  if (probeState.lastOkAt > 0 && (!probeState.lastErrorAt || probeState.lastOkAt >= probeState.lastErrorAt)) {
    if (servingStale) {
      return {
        status: 'DEGRADED',
        detail: 'serving last valid cache after upstream error',
        configured: true,
        observed: true,
        lastOkAt: probeState.lastOkAt,
        executes: false
      };
    }
    return {
      status: 'HEALTHY',
      detail: 'provider returned a valid read',
      configured: true,
      observed: true,
      lastOkAt: probeState.lastOkAt,
      executes: false
    };
  }
  if (hasValidCache || servingStale || probeState.lastOkAt > 0) {
    return {
      status: 'DEGRADED',
      detail: probeState.lastError || 'partial failure; stale cache available',
      configured: true,
      observed: true,
      lastOkAt: probeState.lastOkAt || null,
      lastError: probeState.lastError,
      executes: false
    };
  }
  return {
    status: 'DOWN',
    detail: probeState.lastError || 'provider configured but probe failed with no valid cache',
    configured: true,
    observed: true,
    lastError: probeState.lastError,
    executes: false
  };
}

/** Lightweight probe used by health endpoints — one cheap gold spot or single ETF. */
export async function probeAlphaVantage() {
  if (!alphaVantageConfigured()) {
    return { ok: false, status: 'UNAVAILABLE', code: 'PROVIDER_NOT_CONFIGURED' };
  }
  try {
    const spot = await fetchGoldSpot();
    recordAlphaVantageProbe(true, { kind: 'gold-spot' });
    return {
      ok: true,
      status: spot.meta?.stale ? 'DEGRADED' : 'HEALTHY',
      kind: 'gold-spot',
      stale: spot.meta?.stale === true,
      meta: spot.meta
    };
  } catch (err) {
    /* Try one ETF as a second chance before declaring down. */
    try {
      const q = await fetchEtfQuote('IBIT');
      recordAlphaVantageProbe(true, { kind: 'etf-quote' });
      return {
        ok: true,
        status: q.meta?.stale ? 'DEGRADED' : 'HEALTHY',
        kind: 'etf-quote',
        stale: q.meta?.stale === true,
        meta: q.meta
      };
    } catch (err2) {
      recordAlphaVantageProbe(false, { error: err2?.code || err?.code || 'PROBE_FAILED' });
      const health = alphaVantageHealth({ hasValidCache: false });
      return {
        ok: false,
        status: health.status,
        code: err2?.code || err?.code || 'PROBE_FAILED',
        detail: err2?.detail || err?.detail || null
      };
    }
  }
}

/** Test-only: clear probe + memory fallback + av:* TTL entries. */
export function _resetAlphaVantageForTests() {
  probeState.lastOkAt = 0;
  probeState.lastErrorAt = 0;
  probeState.lastError = null;
  probeState.lastSuccessKind = null;
  probeState.observed = false;
  memFallback.clear();
  for (const k of [...memoryStore.keys()]) {
    if (String(k).startsWith('av:')) memoryStore.delete(k);
  }
}

export {
  ETF_DISPLAY,
  ETF_CATEGORY,
  fetchOnce as _fetchOnceForTests,
  rawFetch as _rawFetchForTests
};
