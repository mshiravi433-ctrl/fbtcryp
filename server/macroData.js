/**
 * FBT — Macro Market Data (Phase 211.1 — the macro connection).
 * ---------------------------------------------------------------------------
 * The Global Intelligence Engine's `macro` domain used to be a keyword
 * classifier over crypto-desk headlines alone. On a day when no crypto
 * headline happened to mention the Fed, the domain reported
 * NO_MACRO_HEADLINES_IN_WINDOW and the whole «global → macro» connection was
 * silently down. This module is the other half of the fix: REAL macro quotes
 * — the dollar index, five commodities, the equity index, the 10-year yield
 * and the 2s10s curve — with their 1-day and 7-day changes, so the macro domain
 * (and the cross-asset economic outlook) has numbers to read even when the
 * news desks are quiet.
 *
 * ─── THE KEYLESS RULE ───────────────────────────────────────────────────────
 * Upstreams in priority order:
 *   1. stooq    daily CSV history (no key, no account)
 *   2. yahoo    the chart endpoint (no key)
 *   3. fredcsv  the FRED graph CSV export (NO KEY — the same series the API
 *               serves: DGS10, DGS2, DGS30, T10Y2Y, DCOILWTICO, DCOILBRENTEU,
 *               GOLDPMGBD228NLBM). This is why the yield curve and the 10-year
 *               are now read on a deployment that never configured FRED.
 *   4. fred     the official API, only when FRED_API_KEY is configured
 *   5. av       Alpha Vantage (ALPHA_VANTAGE_API_KEY) — the equity index and
 *               the treasury ladder when every keyless desk is dark, under a
 *               hard daily budget because the free tier is 25 requests/DAY.
 * A source is ACCEPTED as the primary only when it returns ≥3 usable
 * instruments — one survivor among nine is an outage with a survivor, not a
 * data source. If every source fails, fetchMacroQuotes THROWS; the caller (the
 * global intel engine) turns the throw into the honest UNAVAILABLE it always
 * has.
 *
 * ─── TOP-UP (why «منحنی بازده خوانده نشد» happened) ─────────────────────────
 * The first desk that answered used to be the ONLY desk: stooq returns the
 * dollar, the metals, the crudes and the equity future — but stooq has no
 * treasury series at all, so on every deployment where stooq won, the 2s10s
 * curve stayed unread and the card said so forever. After a primary succeeds,
 * the remaining desks are now asked ONLY for the symbols still missing, inside
 * a hard deadline, and every topped-up instrument keeps the source that
 * actually produced it. A top-up that fails changes nothing.
 *
 * ─── HONESTY (inherited §11/§49) ────────────────────────────────────────────
 * Every instrument keeps its own `source` (`stooq:DX.F`, `yahoo:^TNX`,
 * `fred:T10Y2Y`) and its observation time. Nothing is interpolated between
 * series, nothing is carried from yesterday when today is missing, and the
 * 7-day change is computed from the closest observation to seven days ago —
 * when the series is too short to know, the change is null, not a guess.
 *
 * This module reads; it never writes, never signs, never holds a key (§50).
 */

const TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 10 * 60_000;
const MIN_ACCEPTABLE_INSTRUMENTS = 3;
const DAY = 86_400_000;

/* The top-up phase runs AFTER a primary desk answered, so it must not be able
   to blow the global-intel provider timeout (8s) on a cold cache. Every
   top-up request gets a shorter budget and the whole phase a hard deadline. */
const TOPUP_TIMEOUT_MS = Number(process.env.MACRO_TOPUP_TIMEOUT_MS || 3_500);
const TOPUP_DEADLINE_MS = Number(process.env.MACRO_TOPUP_DEADLINE_MS || 5_000);
/** How far back the keyless FRED CSV export is asked for (40 days is plenty
 *  for a 1d and a 7d change, and keeps a 50-year series off the wire). */
const FRED_CSV_LOOKBACK_DAYS = 40;

/* ── Alpha Vantage: the last-resort desk, on a hard daily budget ────────────
 * The free tier is 25 requests per DAY and 1 per second, and the ETF/gold
 * panels already spend from the same key. This desk therefore (a) is tried
 * last, (b) only asks for symbols nothing else produced, (c) caches each
 * series for 12 hours, (d) spaces calls by ≥1.1s, and (e) stops when the
 * day's budget is gone. Running out of budget is a normal, silent skip. */
const AV_BASE = 'https://www.alphavantage.co/query';
const AV_DAILY_BUDGET = Number(process.env.ALPHA_VANTAGE_MACRO_DAILY_BUDGET || 6);
const AV_MIN_SPACING_MS = Number(process.env.ALPHA_VANTAGE_MIN_SPACING_MS || 1_100);
const AV_SERIES_TTL_MS = Number(process.env.ALPHA_VANTAGE_MACRO_CACHE_MS || 12 * 3600_000);
const AV_SYMBOLS_PER_PASS = Number(process.env.ALPHA_VANTAGE_MACRO_MAX_PER_PASS || 4);
const avBudget = { day: null, used: 0, lastRequestAt: 0 };
const avSeriesCache = new Map(); // `${symbol}` → { series, at }

/** The macro domain reads the market series below, including five commodity
 *  contracts. `unit` is carried with each observation so the UI can label a
 *  USD value without guessing whether it is per ounce, barrel, or pound.
 *
 *  Each entry lists the upstreams that can produce it: `stooq` / `yahoo` /
 *  `fredcsv` (keyless FRED CSV) / `fred` (keyed API) / `av` (Alpha Vantage,
 *  with the endpoint kind). An entry with no source for a desk is simply not
 *  asked of that desk. */
export const MACRO_SYMBOLS = Object.freeze([
  { symbol: 'DXY', name: 'US Dollar Index', kind: 'currency', unit: 'index points', stooq: 'DX.F', yahoo: 'DX-Y.NYB', fred: null, fredcsv: null },
  { symbol: 'GOLD', name: 'Gold (USD/troy oz)', kind: 'safe_haven', unit: 'USD/troy oz', stooq: 'GC.F', yahoo: 'GC=F', fred: 'GOLDPMGBD228NLBM', fredcsv: 'GOLDPMGBD228NLBM' },
  { symbol: 'SILVER', name: 'Silver (USD/troy oz)', kind: 'industrial_metal', unit: 'USD/troy oz', stooq: 'SI.F', yahoo: 'SI=F', fred: null, fredcsv: null },
  { symbol: 'WTI', name: 'WTI Crude (USD/bbl)', kind: 'energy', unit: 'USD/barrel', stooq: 'CL.F', yahoo: 'CL=F', fred: 'DCOILWTICO', fredcsv: 'DCOILWTICO' },
  { symbol: 'BRENT', name: 'Brent Crude (USD/bbl)', kind: 'energy', unit: 'USD/barrel', stooq: 'BRN.F', yahoo: 'BZ=F', fred: 'DCOILBRENTEU', fredcsv: 'DCOILBRENTEU' },
  { symbol: 'COPPER', name: 'Copper (USD/lb)', kind: 'industrial_metal', unit: 'USD/lb', stooq: 'HG.F', yahoo: 'HG=F', fred: null, fredcsv: null },
  { symbol: 'SPX', name: 'S&P 500 E-mini futures', kind: 'equity', unit: 'index points', stooq: 'ES.F', yahoo: 'ES=F', fred: null, fredcsv: null },
  { symbol: 'US10Y', name: 'US 10Y Treasury yield (%)', kind: 'rate', unit: '%', stooq: null, yahoo: '^TNX', fred: 'DGS10', fredcsv: 'DGS10', avKind: 'treasury', avMaturity: '10year' },
  { symbol: 'US2Y', name: 'US 2Y Treasury yield (%)', kind: 'rate', unit: '%', stooq: null, yahoo: null, fred: 'DGS2', fredcsv: 'DGS2', avKind: 'treasury', avMaturity: '2year' },
  { symbol: 'US30Y', name: 'US 30Y Treasury yield (%)', kind: 'rate', unit: '%', stooq: null, yahoo: null, fred: 'DGS30', fredcsv: 'DGS30', avKind: 'treasury', avMaturity: '30year' },
  { symbol: 'US2S10S', name: 'US 2s10s spread (pct)', kind: 'curve', unit: 'percentage points', stooq: null, yahoo: null, fred: 'T10Y2Y', fredcsv: 'T10Y2Y' },
  /* The tokenised-equity venue and stooq/yahoo can both go dark on an
     Iranian network; the two biggest US index ETFs are the honest stand-in
     for «شاخص سهام» — an ETF price is labelled as an ETF price, never as the
     index it tracks. */
  { symbol: 'SPY', name: 'S&P 500 ETF (SPDR)', kind: 'equity', unit: 'USD/share', stooq: null, yahoo: 'SPY', fred: null, fredcsv: null, avKind: 'daily', avSymbol: 'SPY' },
  { symbol: 'QQQ', name: 'Nasdaq-100 ETF (Invesco)', kind: 'equity', unit: 'USD/share', stooq: null, yahoo: 'QQQ', fred: null, fredcsv: null, avKind: 'daily', avSymbol: 'QQQ' }
]);

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/* ── pure parsers (exported so the probe can drive them directly) ────────── */

/** stooq daily history: `Date,Open,High,Low,Close` — keep the closes. */
export function parseStooqCsv(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const cols = line.split(',');
    if (cols.length < 5) continue;
    const ts = Date.parse(cols[0]);
    const close = num(cols[4]);
    if (Number.isFinite(ts) && close !== null) out.push({ ts, price: close });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** yahoo chart endpoint: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } */
export function parseYahooChart(json) {
  const result = json?.result?.[0];
  const stamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(json?.result?.[0]?.indicators?.quote?.[0]?.close) ? json.result[0].indicators.quote[0].close : [];
  const out = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const price = num(closes[i]);
    if (price === null) continue;
    out.push({ ts: stamps[i] * 1000, price });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** FRED observations: { observations: [{ date, value }] } — 'na' is missing. */
export function parseFredJson(json) {
  const rows = Array.isArray(json?.observations) ? json.observations : [];
  const out = [];
  for (const row of rows) {
    const ts = Date.parse(row?.date);
    const price = num(row?.value);
    if (Number.isFinite(ts) && price !== null) out.push({ ts, price });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * FRED graph CSV (KEYLESS): `observation_date,SERIES` — one row per day, and
 * a holiday/gap is an empty cell or a single `.`. Both are missing data, not
 * zero: a zero yield and an unobserved yield are different facts.
 */
export function parseFredCsv(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    const ts = Date.parse(cols[0]);
    const raw = String(cols[1] ?? '').trim();
    if (!Number.isFinite(ts) || raw === '' || raw === '.') continue;
    const price = num(raw);
    if (price !== null) out.push({ ts, price });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Alpha Vantage TIME_SERIES_DAILY: { 'Time Series (Daily)': { '2026-10-01': { '4. close': '655.1200' } } } */
export function parseAvDaily(json) {
  const series = json?.['Time Series (Daily)'] || json?.['Time Series'] || null;
  if (!series || typeof series !== 'object') return [];
  const out = [];
  for (const [date, row] of Object.entries(series)) {
    const ts = Date.parse(date);
    const price = num(row?.['4. close'] ?? row?.['close'] ?? null);
    if (Number.isFinite(ts) && price !== null) out.push({ ts, price });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Alpha Vantage TREASURY_YIELD: { maturities: [{ date, value }] } — 'N/A' is missing. */
export function parseAvTreasury(json) {
  const rows = Array.isArray(json?.maturities) ? json.maturities : (Array.isArray(json?.data) ? json.data : []);
  const out = [];
  for (const row of rows) {
    const ts = Date.parse(row?.date);
    const raw = String(row?.value ?? '').trim();
    if (!Number.isFinite(ts) || raw === '' || raw.toUpperCase() === 'N/A') continue;
    const price = num(raw);
    if (price !== null) out.push({ ts, price });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * 1-day and 7-day percentage changes from an ascending [{ ts, price }] series.
 * The 7-day reference is the closest observation at or before `last − 7d` —
 * a short or gappy series yields null, never an interpolated number.
 */
export function changesFromSeries(series) {
  const rows = (series || []).filter((r) => r && Number.isFinite(r.ts) && Number.isFinite(r.price));
  if (rows.length < 2) return { priceUsd: null, change1dPct: null, change7dPct: null, at: null, points: rows.length };
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const pct = (a, b) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
  const target = last.ts - 7 * DAY;
  let ref = null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].ts <= target) { ref = rows[i]; break; }
  }
  const c1 = pct(last.price, prev.price);
  const c7 = ref ? pct(last.price, ref.price) : null;
  const round2 = (v) => (v === null ? null : Math.round(v * 100) / 100);
  return { priceUsd: last.price, change1dPct: round2(c1), change7dPct: round2(c7), at: last.ts, points: rows.length };
}

/** One instrument from one upstream series: the item keeps its source. */
function quoteFrom(entry, series, provider) {
  const ch = changesFromSeries(series);
  if (ch.priceUsd === null) return null;
  return {
    symbol: entry.symbol,
    name: entry.name,
    kind: entry.kind,
    unit: entry.unit || null,
    priceUsd: ch.priceUsd,
    change1dPct: ch.change1dPct,
    change7dPct: ch.change7dPct,
    points: ch.points,
    source: `${provider}:${sourceRef(provider, entry)}`,
    at: ch.at
  };
}

/** Which ticker/series id a provider actually answered with — printed next to
 *  every number, so a reader can go and look at the same series. */
function sourceRef(provider, entry) {
  if (provider === 'yahoo') return entry.yahoo;
  if (provider === 'fred') return entry.fred;
  if (provider === 'fredcsv') return entry.fredcsv;
  if (provider === 'av') return entry.avSymbol || `TREASURY_${entry.avMaturity}`;
  return entry.stooq;
}

/* ── the upstream fetchers (each wrapped: a dead desk is a reason, not a crash) */

async function fetchText(url, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json, text/csv, text/plain, */*', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** The keyless FRED CSV export: the same series ids as the keyed API, no key,
 *  no account — asked for a short window so a 50-year series stays off the wire. */
const fredCsvUrl = (id) => {
  const cosd = new Date(Date.now() - FRED_CSV_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10);
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${cosd}`;
};

const sourceFor = (provider, timeout = TIMEOUT_MS) => (
  provider === 'stooq'
    ? (e) => fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(e.stooq)}&i=d`, timeout).then(parseStooqCsv)
    : provider === 'yahoo'
      ? (e) => fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(e.yahoo)}?range=1mo&interval=1d`, timeout).then((t) => parseYahooChart(JSON.parse(t)))
      : provider === 'fredcsv'
        ? (e) => fetchText(fredCsvUrl(e.fredcsv), timeout).then(parseFredCsv)
        : (e) => fetchText(`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(e.fred)}&api_key=${encodeURIComponent(process.env.FRED_API_KEY || '')}&file_type=json&sort_order=asc&limit=40`, timeout).then((t) => parseFredJson(JSON.parse(t)))
);

/* ── Alpha Vantage: budgeted, spaced, cached, and never guessed ───────────── */

export function alphaVantageMacroConfigured() {
  const k = process.env.ALPHA_VANTAGE_API_KEY;
  return typeof k === 'string' && k.trim().length >= 8;
}

const utcDay = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Requests this desk may still spend today (the key's free tier is 25/DAY and
 *  the ETF/gold panels spend from the same key). */
export function avBudgetLeft(now = new Date()) {
  const today = (now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()).toISOString().slice(0, 10);
  if (avBudget.day !== today) { avBudget.day = today; avBudget.used = 0; }
  return Math.max(0, AV_DAILY_BUDGET - avBudget.used);
}

/** A successful macro read is a real fact about the same key the ETF desk
 *  uses, so it is reported to that desk's probe state. Failures are NOT: an
 *  exhausted budget or a refused symbol is not a provider outage, and marking
 *  one would dim a lamp that is genuinely lit. Lazy and swallowed — the macro
 *  desk must work even if the provider module cannot be imported. */
function recordAvSuccess(kind) {
  import('./providers/alphaVantage.js')
    .then((m) => { if (typeof m?.recordAlphaVantageProbe === 'function') m.recordAlphaVantageProbe(true, { kind: `macro:${kind}` }); })
    .catch(() => {});
}

async function readAlphaVantage(entry, timeout = TIMEOUT_MS) {
  const key = String(process.env.ALPHA_VANTAGE_API_KEY || '').trim();
  if (!key) throw new Error('PROVIDER_NOT_CONFIGURED');

  const cacheKey = `av:${entry.symbol}`;
  const hit = avSeriesCache.get(cacheKey);
  if (hit && Date.now() - hit.at < AV_SERIES_TTL_MS) return hit.series;
  if (avBudgetLeft() <= 0) throw new Error('DAILY_BUDGET_EXHAUSTED');

  /* 1 request/second is the free tier's burst limit, not a courtesy: the
     second call inside the same second comes back as a Note, not a series. */
  const wait = AV_MIN_SPACING_MS - (Date.now() - avBudget.lastRequestAt);
  if (wait > 0) await sleep(wait);

  const params = entry.avKind === 'treasury'
    ? { function: 'TREASURY_YIELD', interval: 'daily', maturity: entry.avMaturity }
    : { function: 'TIME_SERIES_DAILY', symbol: entry.avSymbol, outputsize: 'compact' };
  const url = `${AV_BASE}?${new URLSearchParams({ ...params, apikey: key }).toString()}`;
  avBudget.lastRequestAt = Date.now();
  avBudget.used += 1;

  const text = await fetchText(url, timeout);
  let json = null;
  try { json = JSON.parse(text); } catch { throw new Error('MALFORMED_JSON'); }
  /* Note / Information / Error Message are refusals. A rate-limit refusal
     closes today's budget so the rest of the pass does not hammer it. */
  const refusal = String(json?.Note || json?.Information || json?.['Error Message'] || '');
  if (refusal) {
    if (/rate limit|per day|premium|sparing|frequency/i.test(refusal)) avBudget.used = AV_DAILY_BUDGET;
    throw new Error('AV_REFUSED');
  }
  const series = entry.avKind === 'treasury' ? parseAvTreasury(json) : parseAvDaily(json);
  if (series.length < 2) throw new Error('AV_SERIES_TOO_SHORT');
  avSeriesCache.set(cacheKey, { series, at: Date.now() });
  recordAvSuccess(entry.symbol);
  return series;
}

/** Read instruments through ONE upstream. Returns the quotes that survived; a
 *  dead instrument is skipped, a dead source returns [].
 *  `only` restricts the read to the symbols a previous desk did not deliver —
 *  that is what keeps the top-up phase cheap instead of re-reading the world. */
async function readSource(provider, now, { only = null, timeout = TIMEOUT_MS } = {}) {
  const wanted = only instanceof Set && only.size ? only : null;
  let entries = MACRO_SYMBOLS.filter((e) => (provider === 'av' ? Boolean(e.avKind) : Boolean(e[provider])));
  if (wanted) entries = entries.filter((e) => wanted.has(e.symbol));
  if (!entries.length) return [];

  if (provider === 'av') {
    /* Sequential on purpose: a shared daily budget and a 1/second limit mean a
       parallel burst spends the day's allowance and gets refused. */
    const out = [];
    for (const entry of entries.slice(0, AV_SYMBOLS_PER_PASS)) {
      try {
        const quote = quoteFrom(entry, await readAlphaVantage(entry, timeout), 'av');
        if (quote) out.push(quote);
      } catch {
        /* a skipped symbol stays missing — it is never filled with a guess */
      }
    }
    return out;
  }

  const fetcher = sourceFor(provider, timeout);
  const results = await Promise.allSettled(
    entries.map(async (e) => quoteFrom(e, await fetcher(e), provider))
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])).filter(Boolean);
}

/** First reading of a symbol wins: a topped-up instrument never overwrites one
 *  an earlier desk already produced. */
function mergeItems(items, added) {
  const seen = new Set(items.map((i) => i.symbol));
  const out = [...items];
  for (const item of added || []) {
    if (!item || seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    out.push(item);
  }
  return out;
}

const providersFor = () => [
  'stooq',
  'yahoo',
  'fredcsv',
  ...(process.env.FRED_API_KEY ? ['fred'] : []),
  ...(alphaVantageMacroConfigured() ? ['av'] : [])
];

/* ── the provider ─────────────────────────────────────────────────────────── */

let cache = null; // { value, at }

/**
 * The macro quotes for the global intel engine. Real series only; when no
 * upstream answers with ≥3 usable instruments, this THROWS — the engine
 * converts that into the macro domain's honest UNAVAILABLE.
 */
export async function fetchMacroQuotes() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const startedAt = Date.now();
  const tried = [];
  let items = [];
  let primary = null;

  for (const provider of providersFor()) {
    const missing = new Set(
      MACRO_SYMBOLS.map((e) => e.symbol).filter((symbol) => !items.some((i) => i.symbol === symbol))
    );
    if (!missing.size) break;
    const isTopUp = primary !== null;
    /* The top-up phase lives inside a deadline: the caller has its own 8s
       provider timeout, and a slow extra desk must not turn a good primary
       read into no read at all. */
    if (isTopUp && Date.now() - startedAt > TOPUP_DEADLINE_MS) {
      tried.push({ provider, count: 0, role: 'top-up', error: 'TOPUP_DEADLINE' });
      break;
    }
    try {
      const read = await readSource(provider, Date.now(), {
        only: isTopUp ? missing : null,
        timeout: isTopUp ? TOPUP_TIMEOUT_MS : TIMEOUT_MS
      });
      tried.push({ provider, count: read.length, role: isTopUp ? 'top-up' : 'primary' });
      if (!read.length) continue;
      if (!primary && read.length >= MIN_ACCEPTABLE_INSTRUMENTS) primary = provider;
      /* Before a primary exists, a desk with 1–2 survivors is an outage with a
         survivor and is dropped (the old rule, kept). After one exists, every
         real read is welcome — one honest curve beats an unread one. */
      if (primary) items = mergeItems(items, read);
    } catch (err) {
      tried.push({
        provider,
        count: 0,
        role: isTopUp ? 'top-up' : 'primary',
        error: String(err?.message || err).slice(0, 60)
      });
    }
  }

  if (!primary || items.length < MIN_ACCEPTABLE_INSTRUMENTS) throw new Error('NO_MACRO_DATA_SOURCE');

  const topped = items.some((i) => !String(i.source || '').startsWith(`${primary}:`));
  const value = {
    items,
    at: Date.now(),
    source: `macroData:${primary}${topped ? '+topup' : ''}`,
    tried,
    note: 'real macro quotes: 1d/7d changes from daily series — data, not authority'
  };
  cache = { value, at: Date.now() };
  return value;
}

/** Test-only: drop the pass cache, the AV series cache and today's spending. */
export function _resetMacroDataForTests() {
  cache = null;
  avSeriesCache.clear();
  avBudget.day = null;
  avBudget.used = 0;
  avBudget.lastRequestAt = 0;
}

export default fetchMacroQuotes;
