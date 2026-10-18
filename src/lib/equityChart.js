/**
 * A REAL PRICE SERIES FOR A TOKENIZED EQUITY — AND NOTHING ELSE.
 * ---------------------------------------------------------------------------
 * The Stocks screen now shows a 90-day history on every row, and every number
 * in it has to be measured. That rules out the obvious tool.
 *
 * `getChart()` in lib/api.js falls back to `offlineChart()`, which SYNTHESISES
 * a plausible-looking series for any id it is given: it hashes the id, seeds a
 * random walk from a base price (100 for anything it does not know), and pins
 * the last point to the live price. For bitcoin that is a reasonable offline
 * placeholder. For `apple-xstock` it would be an invented history of Apple
 * stock — and `historyFacts()` would then happily report "support at $102,
 * tested four times, held three" about a price level that never existed.
 *
 * A fabricated level is worse than no level: the whole point of the panel is
 * that its numbers can be checked. So this module has NO synthetic fallback.
 * When the series cannot be fetched it returns an empty array, and the panel
 * says so.
 *
 * ─── WHY IT IS A SEPARATE MODULE AND NOT A FLAG ON getChart ────────────────
 * A flag would be set once and then inherited by every future caller, which is
 * how the fabricated fallback got attached to gold in the first place. Keeping
 * the honest path in its own file makes the default the safe one.
 *
 * ─── THE WINDOW CASCADE («اگر نمیتونی هم داده ۱ ماهه داده بده») ───────────
 * Reported: for several tickers the 90-day request was the one that came back
 * empty — an upstream rate limit, a truncated response, a market_chart window
 * the provider refused — and the panel then showed «تاریخ قیمتی در دسترس
 * نیست» even though a shorter window of REAL history was right there.
 *
 * `fetchEquityChartWindowed()` asks for 90 days, then falls back to 30, then
 * 14, and REPORTS which window actually loaded. A measured one-month chart is
 * strictly better than an empty 90-day slot, and the label follows the data,
 * so the screen can never show a 30-day series under a "90 روز گذشته" heading.
 */

import { apiBase } from './apiBase.js';

const PUBLIC_CG = 'https://api.coingecko.com/api/v3';

/** Same 60s TTL the rest of the market data uses — a chart is not a ticker. */
const TTL_MS = 60_000;

/**
 * The windows the cascade tries, longest first.
 * 90 → 30 → 14: the panel asks for a quarter, settles for a month, and only
 * then for two weeks. Below two weeks there are too few daily points for the
 * facts to say anything honest about levels.
 */
export const FALLBACK_WINDOWS = [90, 30, 14];

/** `${id}:${days}` -> { at, series } — keyed on BOTH, see below. */
const cache = new Map();

/** In-flight requests, so two rows opening at once cost one upstream call. */
const inFlight = new Map();

async function getJson(url, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
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

/** Accept our normalized proxy and CoinGecko's public wire format.
 * Strictly validate before coercion: null/false are not measured prices. */
export function normalizeEquityChart(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.prices;
  if (!Array.isArray(rows)) return [];
  const points = new Map();
  for (const row of rows) {
    const t = Array.isArray(row) ? row[0] : row?.t;
    const p = Array.isArray(row) ? row[1] : row?.p;
    if (typeof t === 'number' && Number.isFinite(t) && t > 0 &&
        typeof p === 'number' && Number.isFinite(p) && p > 0) points.set(t, { t, p });
  }
  return [...points.values()].sort((a, b) => a.t - b.t);
}

/**
 * Pull the closing-price series for one CoinGecko coin id.
 *
 * Order matters and is deliberate: our own proxy first (it is same-origin, it
 * is cached server-side, and it keeps the free CoinGecko quota in one place),
 * then the public API as a direct fallback, then NOTHING.
 *
 * ─── WHY THE CACHE KEY NOW INCLUDES THE WINDOW ──────────────────────────────
 * It used to key on `id` alone, which silently gave a 30-day caller the
 * 90-day series the previous caller had fetched — the same bug the cascade
 * below exists to avoid. Both live under `${id}:${days}` now.
 *
 * @param {string|null|undefined} id  CoinGecko coin id
 * @param {number} days               window length, for labels and requests
 * @returns {Promise<Array<{t:number,p:number}>>} empty when unavailable
 */
export async function fetchEquityChart(id, days = 90) {
  const coinId = String(id ?? '').trim();
  if (!coinId) return [];
  if (!Number.isFinite(days) || days <= 0 || days > 365) return [];
  const key = `${coinId}:${days}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.series;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const job = (async () => {
    let series = [];
    const sources = [
      `${apiBase()}/chart/${encodeURIComponent(coinId)}?days=${days}&vs=usd`,
      `${PUBLIC_CG}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`
    ];
    for (const source of sources) {
      try {
        const candidate = normalizeEquityChart(await getJson(source));
        if (candidate.length > series.length) series = candidate;
        if (isDrawableSeries(series)) break;
      } catch { /* Try the next real source; never synthesize a history. */ }
    }

    cache.set(key, { at: Date.now(), series });
    return series;
  })();

  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Is this series real enough to draw and measure?
 *
 * Twenty points is the same floor `historyFacts()` uses, and it is there for
 * the same reason: a support level "tested twice" is a coincidence with a
 * sample size, not a pattern. Drawing has a lower bar: two measured prices make
 * a real line, but they do not make a meaningful analysis sample. Both helpers
 * accept the API's `{ p }` rows and the component's normalized number arrays.
 */
const pointPrice = (point) => (typeof point === 'number' ? point : point?.p);

export function isDrawableSeries(series) {
  return Array.isArray(series) && series.filter((point) => {
    const price = pointPrice(point);
    return Number.isFinite(price) && price > 0;
  }).length >= 2;
}

export function isUsableSeries(series, minPoints = 20) {
  return Array.isArray(series) && series.filter((point) => {
    const price = pointPrice(point);
    return Number.isFinite(price) && price > 0;
  }).length >= minPoints;
}

/**
 * The 90-day chart, with a real shorter window when 90 days are not there.
 *
 * Windows are tried LONGEST FIRST and the caller is told which one answered:
 * a "short" series must never be silently rendered under a long label. The
 * sequence is sequential on purpose — firing three upstream requests at once
 * for every row would triple our CoinGecko quota spend on a resource that
 * most often answers on the first try.
 *
 * @param {string} id
 * @param {number} [days=90]
 * @returns {Promise<{series: Array<{t:number,p:number}>, days: number}>}
 *   `days` is the window that PRODUCED the series, or the requested window
 *   when nothing was usable (series is then the longest empty-looking answer
 *   we got, i.e. []).
 */
export async function fetchEquityChartWindowed(id, days = 90, windows = FALLBACK_WINDOWS) {
  const order = [days, ...windows.filter((w) => w < days)].filter((w) => Number.isFinite(w) && w > 0);
  let bestDrawable = null;
  for (const w of order) {
    const series = await fetchEquityChart(id, w);
    /* Prefer the first window with enough observations for analysis. */
    if (isUsableSeries(series)) return { series, days: w };
    /* A sparse but genuine history is still a chart. Keep the densest available
       window for the visual, while the component withholds sample-size facts. */
    if (isDrawableSeries(series) && (!bestDrawable || series.length > bestDrawable.series.length)) {
      bestDrawable = { series, days: w };
    }
  }
  /* Never fabricate a history: return the best measured short series when one
     exists, otherwise the honest empty answer with the requested window label. */
  return bestDrawable || { series: [], days };
}
