/**
 * Upstream market-data providers.
 *
 * Keys live here (server-side, from env) and are never shipped to the browser.
 * Every provider has a timeout and normalises into the shape `src/lib/api.js`
 * expects, so the client doesn't care which source answered.
 */

import { fetchCoinLoreTickers, COINLORE_BASE, COINLORE_MAX_PAGE_SIZE } from '../src/lib/coinLore.js';
import { hydrateCoinRows, mergeVisuals, rememberVisuals } from '../src/lib/marketVisuals.js';
import { attachVenueSparklines } from '../src/lib/venueSparklines.js';
import { attachIndexLogos } from '../src/lib/coinLogoIndex.js';
import { MARKET_CATEGORIES, sectorFromRows } from '../src/lib/marketSectors.js';

const CG_BASE = process.env.COINGECKO_BASE || 'https://api.coingecko.com/api/v3';
const CG_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
const GT_BASE = 'https://api.geckoterminal.com/api/v2';

const CG_KEY = process.env.COINGECKO_API_KEY || '';
const CG_IS_PRO = process.env.COINGECKO_PLAN === 'pro';

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

/*
 * RETRY POLICY — what is transient and what is not.
 *
 * 429 and 5xx are the two answers worth asking again: a rate-limit window on
 * CoinGecko's free tier lasts seconds, and upstream 502s clear on their own.
 * A 403 is NOT transient — it is an IP/plan block that the same request will
 * receive again, and burning seconds of mobile attention to rediscover it
 * delays the live CoinLore backup that exists for exactly this case. Timeouts
 * are also not retried: the attempt already spent its whole budget.
 */
const RETRY_ATTEMPTS = Number(process.env.UPSTREAM_RETRY_ATTEMPTS || 3);
const RETRY_BASE_MS = 700;
const RETRY_MAX_WAIT_MS = 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransient(err) {
  const s = err?.status;
  return s === 429 || (Number.isFinite(s) && s >= 500) || (s == null && err?.name !== 'AbortError');
}

function retryWaitMs(err, attempt) {
  /* Honour Retry-After when the upstream states one; otherwise back off with
     jitter so parallel routes don't retry in lockstep. */
  const stated = Number(err?.retryAfterMs);
  const backoff = RETRY_BASE_MS * 2 ** attempt;
  const wait = Number.isFinite(stated) && stated > 0 ? stated : backoff;
  return Math.min(RETRY_MAX_WAIT_MS, wait) * (0.75 + Math.random() * 0.5);
}

async function reqOnce(url, { headers, timeout }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0', ...headers }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Upstream ${res.status} for ${url}: ${body.slice(0, 160)}`);
      err.status = res.status;
      const retryAfter = Number(res.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function req(url, { headers = {}, timeout = TIMEOUT_MS, retry = false } = {}) {
  const attempts = retry ? Math.max(1, RETRY_ATTEMPTS) : 1;
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(retryWaitMs(lastErr, attempt - 1));
    try {
      return await reqOnce(url, { headers, timeout });
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) break;
    }
  }
  throw lastErr;
}

/**
 * CoinGecko reads are the PRIMARY rail and get the retry budget; the CoinLore
 * backup and third-party feeds stay single-shot so the fallback chain cannot
 * multiply its latency.
 */
const cgReq = (url, opts = {}) => req(url, { ...opts, retry: true });

function cgUrl(path, params = {}) {
  const base = CG_IS_PRO ? CG_PRO_BASE : CG_BASE;
  const qs = new URLSearchParams(params);
  if (CG_KEY) qs.set(CG_IS_PRO ? 'x_cg_pro_api_key' : 'x_cg_demo_api_key', CG_KEY);
  return `${base}${path}?${qs.toString()}`;
}

/* ------------------------------- normalisers ------------------------------ */

export function normalizeCoin(c) {
  return {
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.image,
    price: c.current_price ?? 0,
    change1h: c.price_change_percentage_1h_in_currency ?? 0,
    change24h: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? null,
    change7d: c.price_change_percentage_7d_in_currency ?? 0,
    mcap: c.market_cap ?? 0,
    /*
     * The 24h CHANGE OF MARKET CAPITALISATION, in the quote currency — the one
     * field the feed gives us that measures capital being added to (or pulled
     * out of) an asset instead of its price moving. The News → هوشمندی tab
     * ranks «جذب سرمایه ۲۴ ساعته» by it. Null when the upstream did not report
     * it (the CoinLore backup does not), so a card can say «unread» instead of
     * treating an absent number as zero flow.
     */
    mcapChange24h: c.market_cap_change_24h ?? null,
    mcapChangePct24h: c.market_cap_change_percentage_24h ?? null,
    volume: c.total_volume ?? 0,
    rank: c.market_cap_rank ?? 0,
    high24h: c.high_24h ?? 0,
    low24h: c.low_24h ?? 0,
    ath: c.ath ?? 0,
    athChange: c.ath_change_percentage ?? 0,
    supply: c.circulating_supply ?? 0,
    sparkline: c.sparkline_in_7d?.price ?? []
  };
}

function normalizeGlobalLore(g = {}) {
  return {
    coins: Number(g.coins_count) || 0,
    markets: Number(g.active_markets) || 0,
    mcap: Number(g.total_mcap) || 0,
    volume: Number(g.total_volume) || 0,
    btcDominance: Number(g.btc_d) || 0,
    ethDominance: Number(g.eth_d) || 0,
    mcapChange: Number(g.mcap_change) || 0,
    volumeChange: Number(g.volume_change) || 0,
    avgChange: Number(g.avg_change_percent) || 0,
    source: 'coinlore'
  };
}

function normalizeGlobalCg(raw = {}) {
  const d = raw.data ?? {};
  return {
    coins: d.active_cryptocurrencies ?? 0,
    markets: d.markets ?? 0,
    mcap: d.total_market_cap?.usd ?? 0,
    volume: d.total_volume?.usd ?? 0,
    btcDominance: d.market_cap_percentage?.btc ?? 0,
    ethDominance: d.market_cap_percentage?.eth ?? 0,
    mcapChange: d.market_cap_change_percentage_24h_usd ?? 0,
    volumeChange: 0,
    avgChange: 0,
    source: 'coingecko'
  };
}

/* -------------------------------- endpoints ------------------------------- */

/** CoinGecko primary (richer fields with API key), CoinLore as the fallback. */
export async function fetchGlobal() {
  try {
    const raw = await cgReq(cgUrl('/global'));
    return normalizeGlobalCg(raw);
  } catch {
    const raw = await req(`${COINLORE_BASE}/global/`);
    return normalizeGlobalLore(Array.isArray(raw) ? raw[0] : raw);
  }
}

/*
 * The paging itself lives in the shared adapter (src/lib/coinLore.js) so the
 * server and the browser fallback cannot page differently: CoinLore answers
 * 100 tickers per request, the market screen asks for 250, and the difference
 * used to be a page that arrived a hundred rows short.
 */
async function fetchCoinLoreMarkets({ page = 1, perPage = 50 } = {}) {
  return fetchCoinLoreTickers({
    fetchJson: (url) => req(url),
    base: COINLORE_BASE,
    page,
    perPage,
    maxPages: 3
  });
}

/**
 * CoinGecko is the primary feed; CoinLore is an independent live backup for
 * USD markets. This is deliberately server-side so one upstream 403/429 does
 * not send every browser to a fake snapshot or fan out across user IPs.
 * CoinLore allows up to 100 tickers per request, so the fallback keeps that
 * cap even when the market screen asks for 250 rows.
 *
 * The backup rows are visually enriched before they leave this layer — logos
 * and sparklines restored from CoinGecko's unthrottled endpoints or from the
 * last healthy CoinGecko read — so a throttle window no longer strips the
 * market screen of artwork and charts. Numbers stay exactly what CoinLore
 * said; only the two visual fields are ever filled in.
 */
/**
 * ─── EVERY ROW, NOT THE FIRST SIX ───────────────────────────────────────────
 *   «در صفحه بازار فقط ۶ توکن اول لوگو و نمودار دارن»
 *
 * The fallback rows are live tickers and nothing else, so their artwork and
 * their 7-day line have to come from somewhere after the fact. Doing that per
 * coin against CoinGecko is what produced the "first six" screen: one chart
 * and one logo lookup per row, on a tier that answers a few dozen calls a
 * minute, with a per-call budget that only ever covered the top of the list.
 *
 * Three sources, cheapest first, all of them real and all of them labelled:
 *
 *   1. ARTWORK IN BULK — one keyless coin-list request carries thousands of
 *      tickers with their image URLs, so every row that can be verified by
 *      ticker AND name gets a face for the cost of one call. (lib/coinLogoIndex.js)
 *   2. THE 7-DAY LINE FROM A VENUE — one kline call per pair covers a row's
 *      whole week, and venues allow hundreds of those a minute, so the WHOLE
 *      page fills in one pass instead of trickling in six rows at a time.
 *      (lib/venueSparklines.js)
 *   3. COINGECKO FOR THE REST — coins no venue lists, and the exact-id logo
 *      check as a backstop. Budgeted, memory-first, so each poll advances
 *      until nothing is missing.
 *
 * Every step is fail-silent: a source that is unreachable, blocked or just
 * wrong about a ticker leaves the rows exactly as honest as they arrived, and
 * the price the user sees is never touched by any of it.
 *
 * The whole pass is deadline-bounded, and so is every stage inside it: this
 * runs in a request a phone is waiting on, so "try everything" has to still
 * mean "and then answer". Each stage's cap is clamped to whatever time is
 * left of the pass, so a slow first source cannot starve the ones behind it
 * — nor hold the response open behind a fetch nobody asked for. Whatever the
 * deadline cuts off is simply not known yet: the next poll picks it up, from
 * the top of the list, until the page is covered.
 */
async function fillFallbackVisuals(rows, vs = 'usd', { deadlineMs = 6000 } = {}) {
  const started = Date.now();
  const left = () => Math.max(0, deadlineMs - (Date.now() - started));
  const stage = (cap) => Math.max(200, Math.min(cap, left()));
  const fetchJson = (url, { timeoutMs } = {}) => req(url, { timeout: timeoutMs || 5000 });

  let out = rows;

  /* 1 — bulk artwork. One request, remembered for a day. */
  if (left() > 400) {
    try {
      out = await attachIndexLogos(out, { fetchJson, timeoutMs: stage(4000) });
    } catch {
      /* no artwork from here; the per-coin logo lookup below still can */
    }
  }

  /* 2 — the venue's own 7-day line for every pair it trades. */
  if (left() > 400) {
    try {
      const budget = stage(3500);
      out = await attachVenueSparklines(out, { fetchJson, vs, timeoutMs: budget, deadlineMs: budget });
    } catch {
      /* the per-coin charts below remain the source of last resort */
    }
  }

  /* 3 — CoinGecko, for whatever the two bulk sources could not answer. */
  if (left() > 300) {
    out = await hydrateCoinRows(out, { fetchJson, cgBase: CG_BASE, vs, deadlineMs: stage(2000) });
  }

  /*
   * Memory last, and unconditionally. Whatever earlier polls fetched — and
   * whatever the two bulk passes above could only partly finish — belongs on
   * these rows too, and merging it costs nothing. Without this the deadline
   * could cut the pass short and hand back a page that DROPPED visuals it
   * already had.
   */
  return out.map(mergeVisuals);
}

export async function fetchMarkets({ page = 1, perPage = 50, vs = 'usd' } = {}) {
  const currency = String(vs || 'usd').toLowerCase();
  try {
    const raw = await cgReq(
      cgUrl('/coins/markets', {
        vs_currency: currency,
        order: 'market_cap_desc',
        per_page: String(Math.min(250, perPage)),
        page: String(page),
        sparkline: 'true',
        price_change_percentage: '1h,24h,7d'
      })
    );
    if (!Array.isArray(raw)) throw new Error('CoinGecko returned an invalid market response');
    if (raw.length) {
      const rows = raw.map((coin) => ({ ...normalizeCoin(coin), marketProvider: 'coingecko' }));
      rememberVisuals(rows);
      return rows;
    }
    /* An empty USD market page can also be a provider-side block page. */
    if (currency !== 'usd') return [];
  } catch (coinGeckoError) {
    /*
     * CoinLore quotes USD only. Do not relabel its dollar values as another
     * currency if a legacy client asks for EUR/IRT/etc.
     */
    if (currency !== 'usd') throw coinGeckoError;
  }

  try {
    const rows = await fetchCoinLoreMarkets({ page, perPage });
    return await fillFallbackVisuals(rows, currency);
  } catch {
    /* Do not leak a provider URL (or its API key query parameter) in an error
       payload. The client can still use its own direct-provider/offline chain. */
    throw new Error('MARKET_DATA_UNAVAILABLE: CoinGecko and CoinLore returned no usable market data');
  }
}

export async function fetchTrending() {
  const raw = await cgReq(cgUrl('/search/trending'));
  return (raw.coins || []).slice(0, 10).map(({ item }) => ({
    id: item.id,
    symbol: (item.symbol || '').toUpperCase(),
    name: item.name,
    image: item.small,
    rank: item.market_cap_rank,
    score: item.score
  }));
}

export async function fetchChart(id, days = 1, vs = 'usd') {
  const raw = await cgReq(cgUrl(`/coins/${encodeURIComponent(id)}/market_chart`, { vs_currency: vs, days: String(days) }));
  return (raw.prices || []).map(([t, p]) => ({ t, p }));
}

/**
 * OHLC CANDLES.
 *
 * ─── WHY THIS IS A SEPARATE CALL FROM fetchChart ────────────────────────────
 * `/market_chart` returns CLOSING prices only — a single number per point.
 * That is all a line chart needs and it is why the coin page has only ever
 * had a line.
 *
 * A candle needs four numbers per bar (open, high, low, close), and the high
 * and the low are the two the line literally cannot show: a day that opened
 * at 100, spiked to 130, and closed back at 101 is a flat line and a very
 * loud candle. That intraday range is most of what a trader reads a chart
 * for, so it cannot be derived — it has to be fetched.
 *
 * `/coins/{id}/ohlc` is free, keyless, and returns exactly that.
 *
 * ─── CoinGecko PICKS THE CANDLE WIDTH, WE DO NOT ────────────────────────────
 * The granularity is decided by `days` and is not a parameter: 1-2 days gives
 * 30-minute candles, 3-30 days gives 4-hourly, beyond that daily. Worth
 * stating because a caller asking for 90 days and expecting hourly bars would
 * get four-day-old-looking data and assume the feed was broken.
 */
export async function fetchOhlc(id, days = 30, vs = 'usd') {
  const raw = await cgReq(cgUrl(`/coins/${encodeURIComponent(id)}/ohlc`, { vs_currency: vs, days: String(days) }));
  if (!Array.isArray(raw)) return [];
  return raw
    .map(([t, o, h, l, c]) => ({ t, o, h, l, c }))
    /*
     * Drop malformed bars rather than rendering them. A candle with a high
     * below its low draws inverted and looks like a rendering bug; silently
     * omitting one bad bar from 180 is invisible and honest.
     */
    .filter((d) => [d.t, d.o, d.h, d.l, d.c].every(Number.isFinite) && d.h >= d.l);
}

export async function fetchSimplePrices(ids = [], vs = 'usd') {
  if (!ids.length) return {};
  return req(cgUrl('/simple/price', { ids: ids.join(','), vs_currencies: vs, include_24hr_change: 'true' }));
}

/** GeckoTerminal trending DEX pools (no key required). */
export async function fetchDexPools(network = 'bsc') {
  const raw = await req(`${GT_BASE}/networks/${encodeURIComponent(network)}/trending_pools`);
  return (raw.data || []).slice(0, 12).map((p) => {
    const a = p.attributes || {};
    return {
      id: p.id,
      name: a.name,
      price: Number(a.base_token_price_usd) || 0,
      change24h: Number(a.price_change_percentage?.h24) || 0,
      volume24h: Number(a.volume_usd?.h24) || 0,
      liquidity: Number(a.reserve_in_usd) || 0,
      dex: p.relationships?.dex?.data?.id || '—'
    };
  });
}

/**
 * One coin, in the SAME shape as a `/markets` row.
 *
 * The client's coin screen renders market rows, so returning a different shape
 * here meant the detail page silently lost 1h/7d change, high/low and the
 * sparkline. We try `/coins/markets?ids=` first for exactly that reason and
 * only fall back to the heavier detail endpoint for ids it does not cover.
 */
export async function fetchCoinDetail(id, vs = 'usd') {
  let coinGeckoError = null;
  try {
    const rows = await cgReq(
      cgUrl('/coins/markets', {
        vs_currency: vs,
        ids: id,
        sparkline: 'true',
        price_change_percentage: '1h,24h,7d'
      })
    );
    if (Array.isArray(rows) && rows[0]) {
      const coin = { ...normalizeCoin(rows[0]), marketProvider: 'coingecko' };
      rememberVisuals([coin]);
      return coin;
    }
  } catch (err) {
    coinGeckoError = err;
  }

  try {
    const raw = await cgReq(
      cgUrl(`/coins/${encodeURIComponent(id)}`, {
        localization: 'false',
        tickers: 'false',
        market_data: 'true',
        community_data: 'false',
        developer_data: 'false'
      })
    );
    const md = raw.market_data || {};
    const coin = {
      id: raw.id,
      symbol: (raw.symbol || '').toUpperCase(),
      name: raw.name,
      image: raw.image?.large ?? raw.image?.small,
      description: raw.description?.en?.slice(0, 700) || '',
      homepage: raw.links?.homepage?.[0] || null,
      price: md.current_price?.[vs] ?? 0,
      change1h: md.price_change_percentage_1h_in_currency?.[vs] ?? 0,
      change24h: md.price_change_percentage_24h ?? null,
      change7d: md.price_change_percentage_7d ?? 0,
      mcap: md.market_cap?.[vs] ?? 0,
      volume: md.total_volume?.[vs] ?? 0,
      rank: raw.market_cap_rank ?? 0,
      high24h: md.high_24h?.[vs] ?? 0,
      low24h: md.low_24h?.[vs] ?? 0,
      ath: md.ath?.[vs] ?? 0,
      atl: md.atl?.[vs] ?? 0,
      athChange: md.ath_change_percentage?.[vs] ?? 0,
      supply: md.circulating_supply ?? 0,
      sparkline: md.sparkline_7d?.price ?? [],
      marketProvider: 'coingecko'
    };
    rememberVisuals([coin]);
    return coin;
  } catch (err) {
    coinGeckoError = err;
  }

  if (String(vs || 'usd').toLowerCase() !== 'usd') throw coinGeckoError;

  /* CoinLore cannot look up a slug directly. Scan the same 250 live rows
     the home page shows, not only its first 100. */
  try {
    const rows = await fetchCoinLoreMarkets({ page: 1, perPage: 250 });
    let coin = rows.find((row) => row.id === id);
    if (!coin && rows.length === 250) {
      const next = await fetchCoinLoreMarkets({ page: 2, perPage: 250 });
      coin = next.find((row) => row.id === id);
    }
    if (coin) {
      /* Same visual enrichment as the market list: the detail page's header
         artwork and its 7d sparkline come from CoinGecko's unthrottled
         endpoints (or the last healthy read), while every number on screen
         stays the live CoinLore quote. */
      const [enriched] = await fillFallbackVisuals([{ ...coin, description: '', homepage: null }]);
      return enriched;
    }
  } catch {
    /* Return one safe failure below; never serve a CoinGecko API key in it. */
  }
  throw new Error('COIN_DETAIL_UNAVAILABLE: CoinGecko and CoinLore did not return this coin');
}

/** Universe-wide coin search by name or ticker. */
export async function fetchSearch(query) {
  const raw = await cgReq(cgUrl('/search', { query }));
  return (raw.coins || []).slice(0, 25).map((c) => ({
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.thumb || c.large,
    rank: c.market_cap_rank ?? 0
  }));
}


/** Reuse one backup ticker read across sector tabs on an instance. */
const sectorBackups = new Map();
async function backupSectorRows(page = 1) {
  let entry = sectorBackups.get(page);
  if (!entry || Date.now() - entry.at > 30_000) {
    const promise = fetchCoinLoreMarkets({ page, perPage: 250 });
    entry = { at: Date.now(), promise };
    sectorBackups.set(page, entry);
    promise.catch(() => { if (sectorBackups.get(page)?.promise === promise) sectorBackups.delete(page); });
  }
  return entry.promise;
}

/** A blocked CoinGecko category must not turn an entire sector into a blank tab.
 * Backup rows are real USD quotes, selected by an explicit CoinGecko ID list.
 * CoinLore has no EUR quotes or 24h extrema, so never synthesize either. */
export async function fetchCategory(slug, { perPage = 50, vs = 'usd' } = {}) {
  const sector = Object.keys(MARKET_CATEGORIES).find((key) => MARKET_CATEGORIES[key] === slug);
  if (!sector) throw new Error('BAD_CATEGORY');
  try {
    const raw = await cgReq(
      cgUrl('/coins/markets', {
        vs_currency: vs, category: slug, order: 'market_cap_desc',
        per_page: Math.min(100, perPage), page: 1, sparkline: true,
        price_change_percentage: '1h,24h,7d'
      })
    );
    if (Array.isArray(raw) && raw.length) {
      const rows = raw.map(normalizeCoin);
      rememberVisuals(rows);
      return rows;
    }
    // An empty category can also mean a changed upstream slug. Try the
    // independent ID-curated ticker feed before declaring the sector empty.
  } catch (err) {
    if (String(vs).toLowerCase() !== 'usd') throw err;
  }
  if (String(vs).toLowerCase() !== 'usd') throw new Error('CATEGORY_DATA_UNAVAILABLE');
  const first = await backupSectorRows();
  let matches = sectorFromRows(sector, first).slice(0, perPage);
  if (!matches.length && first.length === 250) {
    matches = sectorFromRows(sector, await backupSectorRows(2)).slice(0, perPage);
  }
  if (!matches.length) throw new Error('CATEGORY_DATA_UNAVAILABLE');
  // Visuals are best-effort; never block quotes for the full 6s market budget.
  return fillFallbackVisuals(matches, 'usd', { deadlineMs: 2500 });
}
