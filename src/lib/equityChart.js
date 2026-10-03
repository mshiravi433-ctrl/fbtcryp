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
  const key = `${coinId}:${days}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.series;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const job = (async () => {
    let raw = null;
    try {
      raw = await getJson(`${apiBase()}/chart/${encodeURIComponent(coinId)}?days=${days}&vs=usd`);
    } catch {
      try {
        raw = await getJson(
          `${PUBLIC_CG}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`
        );
      } catch {
        /* Both upstreams failed. An empty series is the honest answer. */
        return [];
      }
    }

    const prices = Array.isArray(raw?.prices) ? raw.prices : [];
    const series = prices
      .map(([t, p]) => ({ t: Number(t), p: Number(p) }))
      .filter((d) => Number.isFinite(d.t) && Number.isFinite(d.p) && d.p > 0);

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
 * sample size, not a pattern. A series that short renders as a sparkline and
 * no facts, never as an empty panel with a spinner.
 */
export function isUsableSeries(series, minPoints = 20) {
  return Array.isArray(series) && series.filter((d) => Number.isFinite(d?.p) && d.p > 0).length >= minPoints;
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
  let lastSeries = [];
  for (const w of order) {
    const series = await fetchEquityChart(id, w);
    if (isUsableSeries(series)) return { series, days: w };
    if (series.length > lastSeries.length) lastSeries = series;
  }
  /* Nothing usable at any window: the honest empty answer, still with the
     REQUESTED label so the error copy names 90 days, not 14. */
  return { series: [], days };
}
