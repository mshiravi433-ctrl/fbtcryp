/**
 * FBT — Macro Market Data (Phase 211.1 — the macro connection).
 * ---------------------------------------------------------------------------
 * The Global Intelligence Engine's `macro` domain used to be a keyword
 * classifier over crypto-desk headlines alone. On a day when no crypto
 * headline happened to mention the Fed, the domain reported
 * NO_MACRO_HEADLINES_IN_WINDOW and the whole «global → macro» connection was
 * silently down. This module is the other half of the fix: REAL macro quotes
 * — the dollar index, gold, crude, the equity index, the 10-year yield and
 * the 2s10s curve — with their 1-day and 7-day changes, so the macro domain
 * (and the cross-asset economic outlook) has numbers to read even when the
 * news desks are quiet.
 *
 * ─── THE KEYLESS RULE ───────────────────────────────────────────────────────
 * Three upstreams in priority order, all keyless:
 *   1. stooq   daily CSV history (no key, no account)
 *   2. yahoo   the chart endpoint (no key)
 *   3. FRED    only when FRED_API_KEY is configured (real Treasury series:
 *              T10YIE the 10y yield, T10Y2Y the 2s10s spread — the classic
 *              recession indicator)
 * A source is ACCEPTED only when it returns ≥3 usable instruments — one
 * survivor among six is an outage with a survivor, not a data source. If
 * every source fails, fetchMacroQuotes THROWS; the caller (the global intel
 * engine) turns the throw into the honest UNAVAILABLE it always has.
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

/** The six instruments the macro domain and the economic outlook read.
 *  `kind` is the outlook's signal vocabulary (dollar pressure, safe-haven
 *  bid, energy/inflation, equity risk, rates, the curve). */
export const MACRO_SYMBOLS = Object.freeze([
  { symbol: 'DXY', name: 'US Dollar Index', kind: 'currency', stooq: 'DX.F', yahoo: 'DX-Y.NYB', fred: 'DTXBGS' },
  { symbol: 'GOLD', name: 'Gold (USD/oz)', kind: 'safe_haven', stooq: 'GC.F', yahoo: 'GC=F', fred: 'GOLDPMGBD228NLBM' },
  { symbol: 'WTI', name: 'WTI Crude (USD/bbl)', kind: 'energy', stooq: 'CL.F', yahoo: 'CL=F', fred: 'DCOILWTICO' },
  { symbol: 'SPX', name: 'S&P 500 futures', kind: 'equity', stooq: 'ES.F', yahoo: '^GSPC', fred: 'SP500' },
  { symbol: 'US10Y', name: 'US 10Y Treasury yield (%)', kind: 'rate', stooq: null, yahoo: '^TNX', fred: 'T10YIE' },
  { symbol: 'US2S10S', name: 'US 2s10s spread (pct)', kind: 'curve', stooq: null, yahoo: null, fred: 'T10Y2Y' }
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
    priceUsd: ch.priceUsd,
    change1dPct: ch.change1dPct,
    change7dPct: ch.change7dPct,
    points: ch.points,
    source: `${provider}:${provider === 'yahoo' ? entry.yahoo : provider === 'fred' ? entry.fred : entry.stooq}`,
    at: ch.at
  };
}

/* ── the upstream fetchers (each wrapped: a dead desk is a reason, not a crash) */

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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

const sourceFor = (provider) => (
  provider === 'stooq'
    ? (e) => fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(e.stooq)}&i=d`).then(parseStooqCsv)
    : provider === 'yahoo'
      ? (e) => fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(e.yahoo)}?range=1mo&interval=1d`).then((t) => parseYahooChart(JSON.parse(t)))
      : (e) => fetchText(`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(e.fred)}&api_key=${encodeURIComponent(process.env.FRED_API_KEY || '')}&file_type=json&sort_order=asc&limit=40`).then((t) => parseFredJson(JSON.parse(t)))
);

/** Read every instrument through ONE upstream. Returns the quotes that
 *  survived; a dead instrument is skipped, a dead source returns []. */
async function readSource(provider, now) {
  const entries = MACRO_SYMBOLS.filter((e) => e[provider]);
  const results = await Promise.allSettled(
    entries.map(async (e) => quoteFrom(e, await sourceFor(provider)(e), provider))
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])).filter(Boolean);
}

/* ── the provider ─────────────────────────────────────────────────────────── */

let cache = null; // { value, at }

/**
 * The macro quotes for the global intel engine. Real series only; when no
 * upstream answers with ≥3 usable instruments, this THROWS — the engine
 * converts that into the macro domain's honest UNAVAILABLE.
 */
export async function fetchMacroQuotes() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const providers = ['stooq', 'yahoo', ...(process.env.FRED_API_KEY ? ['fred'] : [])];
  const tried = [];
  for (const provider of providers) {
    try {
      const items = await readSource(provider, Date.now());
      tried.push({ provider, count: items.length });
      if (items.length >= MIN_ACCEPTABLE_INSTRUMENTS) {
        const value = {
          items,
          at: Date.now(),
          source: `macroData:${provider}`,
          tried,
          note: 'real macro quotes: 1d/7d changes from daily series — data, not authority'
        };
        cache = { value, at: Date.now() };
        return value;
      }
    } catch {
      tried.push({ provider, count: 0 });
    }
  }
  throw new Error('NO_MACRO_DATA_SOURCE');
}

export default fetchMacroQuotes;
