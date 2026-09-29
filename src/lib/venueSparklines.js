/*
 * VENUE SPARKLINES — the second source for a row's 7-day line.
 *
 * ─── WHY A SECOND SOURCE EXISTS AT ALL ──────────────────────────────────────
 *   «فقط ۶ توکن اول نمودار دارن، بقیه فقط قیمت»
 *
 * CoinGecko's `/coins/markets` is the only endpoint that returns an image AND
 * a `sparkline_in_7d` for 250 coins in ONE request, and it is blocked from the
 * datacenter IP the market list is served from. Everything left in that
 * provider is PER COIN (`/coins/{id}/market_chart`), and the free tier answers
 * roughly thirty calls a minute — so hydrating a 250-row page from it is not a
 * budget problem, it is eight minutes of rate limit, per page, per instance.
 * That is how the market screen ended up with six charts and 244 bare rows.
 *
 * A venue's own market-data API does not have that shape problem: Binance
 * lists ~400 USDT pairs, one kline call returns the whole 7-day series for one
 * of them, and the public weight limit allows several hundred of those calls a
 * minute. So ALL 250 rows can be covered in one pass, in about the time the
 * page already spends waiting on its price fetch.
 *
 * ─── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 * The series is REAL: Binance's own hourly closes for that pair, the same 168
 * points and the same 7 days CoinGecko's sparkline carries, so every consumer
 * (the 40-point row slice, the market-cap trend rebuild) sees the identical
 * shape it saw before. It is a SINGLE VENUE's series, not an aggregate, and
 * the row is labelled `sparklineSource: 'binance-klines'` so no screen can
 * quietly present it as CoinGecko's number. Only the line is taken from here —
 * prices, changes, caps and every other figure on the row stay exactly what
 * the live ticker said.
 *
 * ─── IDENTITY IS BY EXACT TICKER, AND BY THE VENUE'S OWN MAPPING ────────────
 * `exchangeInfo` (one call, cached for half a day) is the venue listing every
 * pair it trades with its base asset. A row is matched only when the venue's
 * own base asset equals the row's ticker, and only for a USDT market that is
 * in TRADING status, and one pair per base asset. A ticker the venue does not
 * list gets no line — never a line borrowed from a lookalike.
 *
 * ─── FAIL-SILENT, ALWAYS ────────────────────────────────────────────────────
 * A blocked region, an HTTP 451, a timeout or a change in the response shape
 * leaves the rows exactly as they arrived; the caller's next layer (CoinGecko
 * per-coin hydration) then carries on. Hosts are tried in order and a total
 * failure trips a breaker so a dead venue costs one attempt, not one per row.
 */

/** Public market-data endpoints, tried in order. The `data-api` host is the
    one Binance documents as reachable where the main API is restricted. */
const DEFAULT_HOSTS = [
  'https://data-api.binance.vision',
  'https://api-gcp.binance.com',
  'https://api.binance.com'
];

/** One hourly close per point, 168 points: the exact shape CoinGecko returns
    for `sparkline_in_7d`, so nothing downstream has to know the source. */
const INTERVAL = '1h';
const POINTS = 168;

/** A 7-day line barely moves in three hours — same reasoning as the visual
    memory's TTL, and the reason a re-poll costs no upstream calls. */
const SERIES_TTL_MS = 3 * 60 * 60 * 1000;

/** The pair list changes when a token is listed or delisted, not hourly. */
const PAIRS_TTL_MS = 12 * 60 * 60 * 1000;

/** How long a total venue failure silences the whole layer. */
const BREAKER_MS = 10 * 60 * 1000;

export const DEFAULT_VENUE_CONCURRENCY = 16;
/** More than a page's worth: the whole 250-row market list in one pass. */
export const DEFAULT_VENUE_BUDGET = 300;

/** pair → { at, series }. Keyed by the venue's pair, not our row id, so two
    rows that resolve to the same market share one fetch. */
const seriesCache = new Map();
/** symbol → pair, rebuilt from `exchangeInfo`. */
let pairsCache = null;
let pairsInflight = null;
let preferredHost = 0;
let blockedUntil = 0;

const nowMs = () => Date.now();

/** Tests and hard resets only. */
export function clearVenueMemory() {
  seriesCache.clear();
  pairsCache = null;
  pairsInflight = null;
  preferredHost = 0;
  blockedUntil = 0;
}

function isFresh(at, ttl) {
  return Number.isFinite(at) && nowMs() - at < ttl;
}

function hasLine(row) {
  return Array.isArray(row?.sparkline) && row.sparkline.length > 2;
}

/**
 * GET one path with host failover.
 *
 * The working host is remembered, so the steady state is one attempt against
 * one host. When every host fails the breaker opens: without it, a venue
 * blocked from this network would cost three timeouts on EVERY row.
 */
async function venueGet(path, { fetchJson, timeoutMs, hosts }) {
  if (nowMs() < blockedUntil) throw new Error('venue hosts unavailable');
  const seen = new Set();
  let lastErr = null;
  for (let i = 0; i < hosts.length; i += 1) {
    const index = (preferredHost + i) % hosts.length;
    const host = hosts[index];
    if (!host || seen.has(host)) continue;
    seen.add(host);
    try {
      const out = await fetchJson(`${host}${path}`, { timeoutMs });
      preferredHost = index;
      return out;
    } catch (err) {
      lastErr = err;
    }
  }
  blockedUntil = nowMs() + BREAKER_MS;
  throw lastErr || new Error('venue hosts unavailable');
}

/**
 * ticker → USDT pair, from the venue's own listing.
 *
 * Single-flight and cached: this is a large response and every row needs the
 * same answer, so it must be fetched once per instance, not once per row.
 */
function pairMap(ctx) {
  if (pairsCache && isFresh(pairsCache.at, PAIRS_TTL_MS)) return Promise.resolve(pairsCache.map);
  if (pairsInflight) return pairsInflight;
  pairsInflight = (async () => {
    const info = await venueGet('/api/v3/exchangeInfo', ctx);
    const map = new Map();
    for (const s of Array.isArray(info?.symbols) ? info.symbols : []) {
      if (String(s?.status || '') !== 'TRADING') continue;
      if (String(s?.quoteAsset || '').toUpperCase() !== 'USDT') continue;
      const base = String(s?.baseAsset || '').toUpperCase();
      /* One USDT market per base asset: the first is the venue's canonical one. */
      if (base && s?.symbol && !map.has(base)) map.set(base, String(s.symbol));
    }
    pairsCache = { at: nowMs(), map };
    return map;
  })()
    .catch((err) => {
      pairsCache = null;
      throw err;
    })
    .finally(() => {
      pairsInflight = null;
    });
  return pairsInflight;
}

/** Closes of the last 168 hourly bars, oldest first. */
async function fetchSeries(pair, ctx) {
  const raw = await venueGet(
    `/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${INTERVAL}&limit=${POINTS}`,
    ctx
  );
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const series = raw
    /* [openTime, open, high, low, close, …] — index 4 is the close. */
    .map((bar) => Number(bar?.[4]))
    .filter((n) => Number.isFinite(n) && n > 0);
  return series.length > 2 ? series.slice(-POINTS) : null;
}

/**
 * Concurrency-capped runner with a WALL-CLOCK guard.
 *
 * The cap bounds how many calls are in flight; the deadline bounds how long
 * the pass may take at all. Both matter: a caller inside a serverless function
 * must be able to say "spend at most five seconds on this" and get that back
 * even if the venue answers every single request with a timeout. Work already
 * in flight finishes; nothing new starts after the deadline.
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
        /* One pair failing is one row without a line — never a broken page. */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
}

/**
 * Attach a real 7-day line to every row whose ticker the venue trades.
 *
 * @param {Array<object>} rows   live market rows (CoinLore tickers, usually)
 * @param {object} opts
 * @param {(url: string, opts?: object) => Promise<any>} opts.fetchJson
 * @param {string} [opts.vs]     display currency — USDT pairs are USD only
 * @param {number} [opts.concurrency]
 * @param {number} [opts.budget] max kline calls this pass
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.deadlineMs] wall-clock cap for the whole pass
 * @param {string[]} [opts.hosts]
 * @returns {Promise<Array<object>>} rows; rows without a line are unchanged
 */
export async function attachVenueSparklines(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const {
    fetchJson,
    vs = 'usd',
    concurrency = DEFAULT_VENUE_CONCURRENCY,
    budget = DEFAULT_VENUE_BUDGET,
    timeoutMs,
    deadlineMs = Infinity,
    hosts = DEFAULT_HOSTS
  } = opts;

  /* A USDT pair is not a EUR chart. Rather than relabel one, refuse. */
  if (typeof fetchJson !== 'function' || String(vs || 'usd').toLowerCase() !== 'usd') return list;
  if (!list.length || !Array.isArray(hosts) || !hosts.length) return list;

  const wanted = list.filter((row) => row?.id && !row.offline && !hasLine(row));
  if (!wanted.length) return list;

  const ctx = { fetchJson, timeoutMs, hosts };
  let pairs;
  try {
    pairs = await pairMap(ctx);
  } catch {
    return list;
  }
  if (!pairs?.size) return list;

  const jobs = [];
  const claimed = new Set();
  for (const row of list) {
    if (jobs.length >= Math.max(0, Math.floor(budget))) break;
    if (!row?.id || row.offline || hasLine(row)) continue;
    const pair = pairs.get(String(row.symbol || '').toUpperCase());
    if (!pair || claimed.has(pair)) continue;
    const hit = seriesCache.get(pair);
    if (hit && isFresh(hit.at, SERIES_TTL_MS)) continue;
    claimed.add(pair);
    jobs.push(async () => {
      const series = await fetchSeries(pair, ctx);
      if (series) seriesCache.set(pair, { at: nowMs(), series });
    });
  }
  if (jobs.length) await runLimited(jobs, concurrency, deadlineMs);

  return list.map((row) => {
    if (!row?.id || row.offline || hasLine(row)) return row;
    const pair = pairs.get(String(row.symbol || '').toUpperCase());
    const hit = pair ? seriesCache.get(pair) : null;
    if (!hit || !isFresh(hit.at, SERIES_TTL_MS)) return row;
    return { ...row, sparkline: hit.series, sparklineSource: 'binance-klines' };
  });
}
