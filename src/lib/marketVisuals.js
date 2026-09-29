/*
 * VISUAL ENRICHMENT FOR FALLBACK MARKET ROWS.
 *
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «به جای CoinGecko اومده روی یک api دیگه که اصلا نمودار و لوگو نداره»
 *
 * The market screen lost its logos and sparklines. Not because the artwork
 * broke — because the ROWS stopped coming from CoinGecko.
 *
 * ─── WHY THE ROWS SWITCHED FEEDS ────────────────────────────────────────────
 * CoinGecko's `/coins/markets` — the only endpoint that answers in bulk with
 * `image` AND `sparkline_in_7d` — is their most aggressively throttled one.
 * From a datacenter IP without an API key it 403/429s while `/global`,
 * `/search`, `/ping` and even `/coins/{id}/market_chart` keep answering fine
 * (measured, repeatedly). When it fails, the provider layer correctly falls
 * back to CoinLore's live tickers… whose ticker rows carry NO image and NO
 * historical series. Prices stayed honest; the screen went blind.
 *
 * ─── WHAT THIS MODULE DOES ──────────────────────────────────────────────────
 * It restores the missing visuals WITHOUT inventing any of them:
 *
 *   1. REMEMBER — every real CoinGecko row that ever passes through keeps its
 *      image + sparkline here (a 7-day line barely moves in an hour; the
 *      artwork never changes).
 *   2. HYDRATE — for rows still missing visuals, fetch them from the
 *      CoinGecko endpoints that are NOT throttled: `/coins/{id}/market_chart`
 *      for the line, `/search?query=` for the artwork (matched by EXACT coin
 *      id, never by symbol — two coins may share a ticker, they may not share
 *      an identity).
 *   3. MERGE — attach whatever was remembered or hydrated to the fallback row.
 *
 * What is NEVER done here: synthesising a sparkline from percent changes, or
 * guessing an image URL. `normalizeCoinLoreMarket` stays a pure, honest
 * adapter — a ticker is still not a history — and this layer adds only data
 * that genuinely came from CoinGecko, labelled `sparklineSource` /
 * `imageSource` so every screen can say where a line came from.
 *
 * Shared by `server/providers.js` and the browser fallback in `src/lib/api.js`
 * so the two paths cannot drift.
 */

/** A 7-day line is hourly (~168 points) on CoinGecko; keep the same shape. */
const MAX_SPARK_POINTS = 168;

/**
 * How long a remembered sparkline stays usable.
 * An hour: long enough to survive a throttle window, short enough that a
 * "7d" line is never months of lies.
 */
const SPARK_TTL_MS = 60 * 60 * 1000;

/**
 * Default per-call hydration budget. The market screen asks for 250 rows;
 * refetching 250 charts would re-create the rate limit we are hiding from.
 * The FIRST rows are the hero, the visible list and the global-trend
 * aggregation — hydrate those now, and the rest on later polls as the budget
 * window advances (hydrated rows are served from memory afterwards).
 */
export const DEFAULT_CHART_BUDGET = 6;
export const DEFAULT_LOGO_BUDGET = 6;

/** id → { image, imageSource, imageAt, sparkline, sparklineSource, sparklineAt } */
const visuals = new Map();

/** Single-flight registry so concurrent requests hydrate each id once. */
const inflight = new Map();

const nowMs = () => Date.now();

function isFresh(at, ttl) {
  return Number.isFinite(at) && nowMs() - at < ttl;
}

function hasSpark(row) {
  return Array.isArray(row?.sparkline) && row.sparkline.length >= 2;
}

/** Namespaced fake ids (`coinlore-900001`) have no CoinGecko counterpart. */
function hydratable(id) {
  return typeof id === 'string' && id.length > 0 && !id.startsWith('coinlore-');
}

/**
 * Remember real visuals from a healthy CoinGecko row. Called on every
 * successful `/coins/markets` / coin read so a later fallback can serve the
 * same artwork and the same (recent) line.
 */
export function rememberVisuals(rows = []) {
  const at = nowMs();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.id) continue;
    const v = visuals.get(row.id) || {};
    if (typeof row.image === 'string' && /^https:\/\//i.test(row.image)) {
      v.image = row.image;
      v.imageSource = 'coingecko-markets';
      v.imageAt = at;
    }
    if (hasSpark(row)) {
      v.sparkline = row.sparkline;
      v.sparklineSource = 'coingecko';
      v.sparklineAt = at;
    }
    if (v.image || v.sparkline) visuals.set(row.id, v);
  }
}

/**
 * Attach remembered/hydrated visuals to ONE row. Pure: the input row is never
 * mutated (callers memoize their arrays). Only `image` and `sparkline` are
 * ever filled — prices, highs, ath and every number stay exactly what the
 * live ticker said, including null.
 */
export function mergeVisuals(row) {
  if (!row || !row.id || row.offline) return row;
  const v = visuals.get(row.id);
  if (!v) return row;

  let out = row;
  const put = (patch) => {
    out = out === row ? { ...row } : out;
    Object.assign(out, patch);
  };

  if (!out.image && v.image && isFresh(v.imageAt, Infinity)) {
    put({ image: v.image, imageSource: v.imageSource || 'coingecko' });
  }
  if (!hasSpark(out) && hasSpark({ sparkline: v.sparkline }) && isFresh(v.sparklineAt, SPARK_TTL_MS)) {
    put({ sparkline: v.sparkline, sparklineSource: v.sparklineSource || 'coingecko' });
  }
  return out;
}

/** Forget everything — tests and hard resets only. */
export function clearVisualMemory() {
  visuals.clear();
  inflight.clear();
}

function singleFlight(key, run) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(run)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function fillChart(id, vs, { fetchJson, cgBase, timeoutMs }) {
  const key = `chart:${vs}:${id}`;
  return singleFlight(key, async () => {
    const cached = visuals.get(id);
    if (hasSpark({ sparkline: cached?.sparkline }) && isFresh(cached.sparklineAt, SPARK_TTL_MS)) return;
    const url =
      `${cgBase}/coins/${encodeURIComponent(id)}/market_chart` +
      `?vs_currency=${encodeURIComponent(vs || 'usd')}&days=7`;
    const raw = await fetchJson(url, { timeoutMs });
    const prices = Array.isArray(raw?.prices) ? raw.prices : null;
    if (!prices || prices.length < 2) return;
    const series = prices
      .map((p) => (Array.isArray(p) ? Number(p[1]) : Number(p?.p)))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (series.length < 2) return;
    const at = nowMs();
    const prev = visuals.get(id) || {};
    visuals.set(id, {
      ...prev,
      sparkline: series.slice(-MAX_SPARK_POINTS),
      sparklineSource: 'coingecko-chart',
      sparklineAt: at
    });
  });
}

async function fillLogo(id, symbol, { fetchJson, cgBase, timeoutMs }) {
  const key = `logo:${id}`;
  return singleFlight(key, async () => {
    const cached = visuals.get(id);
    if (cached?.image) return;
    const q = String(symbol || id || '').trim();
    if (!q) return;
    const raw = await fetchJson(`${cgBase}/search?query=${encodeURIComponent(q)}`, { timeoutMs });
    const coins = Array.isArray(raw?.coins) ? raw.coins : [];
    /* EXACT id match only. `/search?query=BTC` returns half a dozen "BTC"
       impostors; only the row whose CoinGecko id equals ours is that coin. */
    const hit = coins.find((c) => c?.id === id);
    const image = hit?.large || hit?.thumb || hit?.small;
    if (typeof image !== 'string' || !/^https:\/\//i.test(image)) return;
    const prev = visuals.get(id) || {};
    visuals.set(id, { ...prev, image, imageSource: 'coingecko-search', imageAt: nowMs() });
  });
}

/**
 * Best-effort enrichment of fallback rows. Never throws: the rows are already
 * a valid live answer — visuals are a bonus on top, not a gate in front.
 *
 * @param {Array<object>} rows      normalized market rows (CoinLore or mixed)
 * @param {object} opts
 * @param {(url: string, opts?: object) => Promise<any>} opts.fetchJson
 * @param {string} opts.cgBase      e.g. 'https://api.coingecko.com/api/v3'
 * @param {string} [opts.vs]        display currency for the chart fetch
 * @param {number} [opts.chartBudget]  max charts fetched this call
 * @param {number} [opts.logoBudget]   max logos fetched this call
 * @param {number} [opts.timeoutMs]    per upstream call
 * @returns {Promise<Array<object>>}   rows with visuals merged in
 */
export async function hydrateCoinRows(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const {
    fetchJson,
    cgBase = 'https://api.coingecko.com/api/v3',
    vs = 'usd',
    chartBudget = DEFAULT_CHART_BUDGET,
    logoBudget = DEFAULT_LOGO_BUDGET,
    timeoutMs
  } = opts;

  if (typeof fetchJson === 'function' && cgBase) {
    const ctx = { fetchJson, cgBase, timeoutMs };
    const work = [];
    for (const row of list) {
      if (!row?.id || !hydratable(row.id)) continue;
      if (work.filter((w) => w.kind === 'chart').length < chartBudget && !hasSpark(row)) {
        work.push({ kind: 'chart', p: fillChart(row.id, vs, ctx) });
      }
      if (work.filter((w) => w.kind === 'logo').length < logoBudget && !row.image) {
        work.push({ kind: 'logo', p: fillLogo(row.id, row.symbol, ctx) });
      }
    }
    await Promise.all(
      work.map((w) =>
        w.p.catch(() => {
          /* A dead upstream leaves the row exactly as honest as it was. */
        })
      )
    );
  }

  return list.map(mergeVisuals);
}
