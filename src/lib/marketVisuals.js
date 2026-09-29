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
 *
 * ─── LATER LAYERS, SAME RULES ───────────────────────────────────────────────
 * Per-coin CoinGecko reads are the LAST thing tried now, not the first: they
 * are rate limited to a few dozen calls a minute, which is what made a
 * 250-row page un-fillable from here. `lib/coinLogoIndex.js` answers the
 * artwork question for every row in one request, `lib/venueSparklines.js`
 * answers the 7-day line for every pair a venue trades, and this module
 * spends its remaining budget only on the rows those two could not cover. A
 * row's own data and the memory always win; a missing number stays missing.
 */

/** A 7-day line is hourly (~168 points) on CoinGecko; keep the same shape. */
const MAX_SPARK_POINTS = 168;

/**
 * How long a remembered sparkline stays usable.
 *
 * ─── WHY THREE HOURS AND NOT ONE ────────────────────────────────────────────
 * The market screen asks for 250 rows and this layer refills whatever is
 * missing on every poll, so this TTL is the real cost driver: at one hour a
 * warm instance re-fetched 250 charts an hour — every hour — which is the
 * CoinGecko rate limit we are trying to stay under. Three hours divides that
 * by three and is still invisible on the screen: the series is a 7-DAY line
 * whose last point is up to nine hours old (the venue reads are hourly), and
 * the sparkline carries no axis to contradict. Prices, changes and market
 * caps are never taken from here — they stay live on every row.
 */
const SPARK_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * ─── THE BUDGET IS PER CALL; THE COVERAGE IS PER ROW ────────────────────────
 *   «در صفحه بازار فقط ۶ توکن اول قیمت و لوگو و نمودار دارن، بقیه فقط قیمت»
 *
 * That report is exactly a budget of six with the slots handed to the FIRST
 * six rows of every response: rows 7…250 were never reached, so they stayed
 * as bare as the ticker they came from. Two things fix it and both matter:
 *
 *   1. SLOTS GO TO ROWS THAT STILL NEED ONE. The incoming CoinLore row never
 *      carries an image or a line, so the old loop re-spent its whole budget
 *      on the same first six rows every poll (their fetches were skipped by
 *      the memory, but the SLOTS were already gone). Now a row is merged from
 *      memory first and only the rows still missing something consume budget,
 *      so every poll advances the frontier down the list until the page is
 *      covered — and then costs nothing at all.
 *   2. THE BUDGET IS BIG ENOUGH TO MAKE PROGRESS. Six per poll against a 250
 *      row page was 40+ polls. Forty-eight per poll covers the page in a few
 *      polls, and the fetch runs with bounded concurrency so the wall-clock
 *      cost stays around a second instead of forty round trips.
 *
 * The budget is still bounded on purpose: a response must never fan out to
 * 250 upstream calls, and the caller (server route or browser) must never
 * hold a screen open for a fetch it did not ask for.
 */
export const DEFAULT_CHART_BUDGET = 48;
export const DEFAULT_LOGO_BUDGET = 48;

/**
 * Upstream calls in flight at once. Unbounded `Promise.all` on a 250-row page
 * is a socket storm on a phone; one at a time is a minute of latency. Twelve
 * is the same number the venue readers use and keeps a full page's worth of
 * hydration inside a second or two on a warm connection.
 */
export const DEFAULT_CONCURRENCY = 12;

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
 * Does this row still have a gap the visuals layer could fill?
 *
 * Reads MEMORY as well as the row itself, which is the distinction that makes
 * the budget advance: a CoinLore row arrives bare every single poll, but once
 * its line has been fetched it is not missing anything any more — it only
 * looks that way to a check that ignores the memory.
 */
export function needsVisuals(row) {
  if (!row || !row.id || row.offline || !hydratable(row.id)) return false;
  const merged = mergeVisuals(row);
  return !hasSpark(merged) || !merged.image;
}

/**
 * Run jobs with a hard cap on how many are in flight at once, and an optional
 * wall-clock cap on the pass as a whole.
 *
 * The concurrency cap is what keeps a 250-row page from opening 250 sockets;
 * the deadline is what keeps a slow upstream from holding the response open
 * behind a fetch nobody asked for. Jobs already running finish, nothing new
 * starts once the deadline passes.
 */
async function runLimited(jobs, limit, deadlineMs = Infinity) {
  const width = Math.max(1, Math.floor(Number(limit) || 1));
  const deadline = Number.isFinite(deadlineMs) ? nowMs() + deadlineMs : Infinity;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      if (nowMs() > deadline) return;
      const job = jobs[next];
      next += 1;
      try {
        await job();
      } catch {
        /* A dead upstream leaves the row exactly as honest as it was. */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
}

/**
 * Best-effort enrichment of fallback rows. Never throws: the rows are already
 * a valid live answer — visuals are a bonus on top, not a gate in front.
 *
 * The two upstream permissions are budgeted separately because they come from
 * different endpoints with different costs, and because a row can need one
 * without the other (a remembered logo with an expired line, a CoinGecko logo
 * on a row whose chart only a venue can supply).
 *
 * @param {Array<object>} rows      normalized market rows (CoinLore or mixed)
 * @param {object} opts
 * @param {(url: string, opts?: object) => Promise<any>} opts.fetchJson
 * @param {string} opts.cgBase      e.g. 'https://api.coingecko.com/api/v3'
 * @param {string} [opts.vs]        display currency for the chart fetch
 * @param {number} [opts.chartBudget]  max charts fetched this call
 * @param {number} [opts.logoBudget]   max logos fetched this call
 * @param {number} [opts.concurrency]  upstream calls in flight at once
 * @param {number} [opts.deadlineMs]   wall-clock cap for the whole pass
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
    concurrency = DEFAULT_CONCURRENCY,
    deadlineMs = Infinity,
    timeoutMs
  } = opts;

  /*
   * Memory first, budget second — in that order, for every row.
   * `pending` holds the rows as the memory alone can draw them; `jobs` only
   * receives the gaps that remain, and only until the budgets run out. The
   * rows are re-merged after the fetches so the ones whose work just finished
   * come back complete in THIS response rather than the next one.
   */
  const pending = [];
  const jobs = [];
  if (typeof fetchJson === 'function' && cgBase) {
    const ctx = { fetchJson, cgBase, timeoutMs };
    let chartSlots = 0;
    let logoSlots = 0;
    for (const row of list) {
      const merged = mergeVisuals(row);
      if (!row?.id || row.offline || !hydratable(row.id)) {
        pending.push(merged);
        continue;
      }
      if (chartSlots < chartBudget && !hasSpark(merged)) {
        chartSlots += 1;
        jobs.push(() => fillChart(row.id, vs, ctx));
      }
      if (logoSlots < logoBudget && !merged.image) {
        logoSlots += 1;
        jobs.push(() => fillLogo(row.id, row.symbol, ctx));
      }
      pending.push(merged);
    }
    await runLimited(jobs, concurrency, deadlineMs);
  } else {
    for (const row of list) pending.push(mergeVisuals(row));
  }

  return pending.map(mergeVisuals);
}
