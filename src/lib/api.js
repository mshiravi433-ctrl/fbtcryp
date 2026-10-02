/**
 * Market data layer.
 *
 * All requests go through our own backend (`/api/...`) which caches responses
 * and — crucially — keeps the CoinGecko / Kraken keys server-side. The browser
 * never sees an API key.
 *
 * If the backend is unreachable, the client tries public CoinGecko, then the
 * independent public CoinLore ticker feed for USD markets, and finally a
 * deterministic offline dataset. Offline prices are visibly labelled.
 *
 * CoinLore tickers carry no artwork and no price history, and CoinGecko's bulk
 * endpoint — the one call that used to carry both for every row — is blocked
 * from the datacenter IP the backend runs on. So the visuals are rebuilt from
 * three real sources, cheapest first, and never invented (see the rescue
 * section below and lib/marketVisuals.js):
 *
 *   1. this browser, asking CoinGecko directly — one bulk request, all rows;
 *   2. a venue's own klines for its own USDT pairs, which covers a whole week
 *      per call (lib/venueSparklines.js);
 *   3. CoinGecko's per-coin endpoints for whatever is left, budgeted and
 *      memory-first so coverage advances instead of stopping at six rows.
 *
 * Global stats follow the same order: backend, CoinGecko, CoinLore, offline.
 */

import { offlineGlobal, offlineMarkets, offlineTrending, offlineChart } from './offlineData.js';
import { apiBase } from './apiBase.js';
import { fetchCoinLoreTickers, normalizeCoinLoreMarket, COINLORE_MAX_PAGE_SIZE } from './coinLore.js';
import { hydrateCoinRows, mergeVisuals, needsVisuals, rememberVisuals } from './marketVisuals.js';
import { attachVenueSparklines } from './venueSparklines.js';
import { MARKET_CATEGORIES } from './marketSectors.js';

// `apiBase()` is deliberately resolved at request time. In the Capacitor
// shell the page origin is https://localhost, so a relative `/api` would hit
// the WebView's asset server instead of the deployed backend. The helper also
// keeps the ordinary browser same-origin path unchanged.
const PUBLIC_CG = 'https://api.coingecko.com/api/v3';
const PUBLIC_COINLORE = 'https://api.coinlore.net/api';

const memo = new Map();

async function fetchJson(url, { timeout = 12000, withMeta = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return withMeta ? { data, stale: res.headers.get('x-data-stale') === '1' } : data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How long an EMPTY fallback result is allowed to be cached.
 *
 * ─── THE BUG THIS NUMBER FIXES ──────────────────────────────────────────────
 *   «وقتی وارد بازار نمیشوی و روی یک کوین میزنی کرش میخوره ... اما بار دوم
 *    خوب میشه»
 *
 * Open a coin WITHOUT visiting the market list first — error screen. Tap again
 * — fine. That "second time works" shape is the diagnosis, and it is a
 * different bug from the chunk-loading one in lib/lazyRetry.js. The page
 * loads perfectly here; it is the DATA that is missing.
 *
 * The sequence, all of it inside this function:
 *
 *   1. A cold open fires several requests at once — coin, chart, btc chart,
 *      global, markets. CoinGecko's free tier rate-limits that burst, so
 *      `backend` and `direct` both throw for the coin.
 *   2. `fallback()` runs. For getCoin that is a lookup in a 50-coin offline
 *      snapshot, and any coin outside those 50 — PENGU, and most of the
 *      market list — is genuinely absent, so it returns **null**.
 *   3. That null is written into `memo` and served for the full 30s TTL.
 *      A now-healthy backend is never consulted.
 *   4. CoinDetail sees `coin === null` with nothing loading and renders
 *      "ارز پیدا نشد" with Back and Refresh buttons — the screen reported.
 *
 * Step 3 is the actual defect. Caching a SUCCESS for 30s is the point of this
 * function; caching "we found nothing" for 30s is caching a failure and
 * calling it data.
 *
 * ─── WHY IT WORKS THE SECOND TIME ───────────────────────────────────────────
 * Two independent reasons, which is why it feels so reliable:
 *   • by the second tap the burst has passed and the rate limit has reset;
 *   • and if the user went via the market list, `coins` is populated so
 *     CoinDetail's `find()` supplies the row without needing this call.
 * Hence "when you don't enter Market first" — that is precisely the path with
 * no second source of the same data.
 *
 * Four seconds is long enough to still absorb a genuine burst of duplicate
 * calls for the same key, and short enough that a user retrying by hand
 * always gets a real request.
 */
const EMPTY_TTL_MS = 4000;

/** Try our backend, then live public providers, then the offline snapshot. */
async function resilient(key, { backend, direct, fallback, ttl = 30000 }) {
  const cached = memo.get(key);
  if (cached) {
    /*
     * An empty answer expires far sooner than a real one.
     *
     * `empty` is recorded at write time rather than re-derived here: by the
     * time we read it back, `[]` and `null` are indistinguishable from a
     * legitimately empty successful response, and treating a real empty list
     * as a failure would re-request it forever.
     */
    const maxAge = cached.empty ? Math.min(EMPTY_TTL_MS, ttl) : cached.stale ? Math.min(15000, ttl) : ttl;
    if (Date.now() - cached.at < maxAge) return cached.data;
  }

  let lastError = null;
  for (const attempt of [backend, direct]) {
    if (!attempt) continue;
    try {
      const data = await attempt();
      if (data) {
        memo.set(key, { at: Date.now(), data });
        return data;
      }
    } catch (err) {
      /*
       * Remembered, not swallowed. A caller that gets `null` cannot tell
       * "this coin does not exist" from "both sources were rate-limited",
       * and those two deserve completely different screens.
       */
      lastError = err;
    }
  }

  const data = fallback();
  /*
   * `stale` says the value came from the offline snapshot. `empty` says the
   * snapshot had nothing to give — the case that used to pin a null in place
   * for 30 seconds while the network recovered without us.
   */
  const empty = data == null || (Array.isArray(data) && data.length === 0);
  memo.set(key, { at: Date.now(), data, stale: true, empty, error: lastError });
  return data;
}

/**
 * Did the last attempt for this key fail because of the NETWORK, rather than
 * because the thing genuinely does not exist?
 *
 * Lets a screen say "try again in a moment" instead of "this coin does not
 * exist", which are opposite messages and only one of them is ever true.
 * Reads the cache rather than changing what `resilient` returns, so no caller
 * has to be updated to benefit.
 */
export function lastFetchFailed(key) {
  return Boolean(memo.get(key)?.error);
}

/** Forget one key so the next call is guaranteed to hit the network. */
export function invalidate(key) {
  memo.delete(key);
}

/** Clear all in-memory memoized API responses. */
export function clearApiCache() {
  memo.clear();
}

/* -------------------------------------------------------------------------- */
/* Global market stats                                                         */
/* -------------------------------------------------------------------------- */

/**
 * CoinGecko `/global` first — the same feed the market rows use, so the
 * summary strip and the rows can never disagree about the day. The CoinLore
 * ticker stays as the live last resort, and the offline snapshot as the final
 * answer. `normalizeGlobal` accepts BOTH raw shapes.
 */
export function getGlobal() {
  return resilient('global', {
    ttl: 45000,
    backend: async () => {
      const { data, stale } = await fetchJson(`${apiBase()}/global`, { withMeta: true });
      return { ...data, dataProvenance: stale ? 'stale' : 'live' };
    },
    direct: async () => {
      try {
        const raw = await fetchJson(`${PUBLIC_CG}/global`);
        return { ...normalizeGlobal(raw), dataProvenance: 'live' };
      } catch {
        /* Fall through to the independent live backup below. */
      }
      const raw = await fetchJson(`${PUBLIC_COINLORE}/global/`);
      return { ...normalizeGlobal(Array.isArray(raw) ? raw[0] : raw), dataProvenance: 'live' };
    },
    fallback: () => ({ ...offlineGlobal(), dataProvenance: 'offline' })
  });
}

/**
 * Normalize BOTH provider shapes into one:
 *   CoinLore `/global/` ticker: { coins_count, active_markets, total_mcap, … }
 *   CoinGecko `/global`:        { data: { active_cryptocurrencies, markets,
 *                                    total_market_cap: { usd }, … } }
 * A field missing from a provider stays 0 rather than being invented.
 */
export function normalizeGlobal(g = {}) {
  const d = g && typeof g.data === 'object' && g.data !== null ? g.data : g;
  const objOrNum = (v, key) => {
    if (v && typeof v === 'object') return Number(v[key]) || 0;
    return Number(v) || 0;
  };
  return {
    coins: Number(d.coins_count) || Number(d.active_cryptocurrencies) || 0,
    markets: Number(d.active_markets) || Number(d.markets) || 0,
    mcap: Number(d.total_mcap) || objOrNum(d.total_market_cap, 'usd'),
    volume: objOrNum(d.total_volume, 'usd'),
    btcDominance: Number(d.btc_d) || Number(d.market_cap_percentage?.btc) || 0,
    ethDominance: Number(d.eth_d) || Number(d.market_cap_percentage?.eth) || 0,
    mcapChange: Number(d.mcap_change) || Number(d.market_cap_change_percentage_24h_usd) || 0,
    volumeChange: Number(d.volume_change) || Number(d.volume_change_percentage_24h_usd) || 0,
    avgChange: Number(d.avg_change_percent) || 0
  };
}

/* -------------------------------------------------------------------------- */
/* Bulk visual rescue for fallback rows                                        */
/* -------------------------------------------------------------------------- */

/**
 * ─── WHY THIS IS IN THE BROWSER AT ALL ──────────────────────────────────────
 *   «فقط ۶ توکن اول لوگو و نمودار دارن»
 *
 * The rows come from our backend, and when CoinGecko's bulk endpoint is
 * blocked from the DATACENTER the backend can only hand over live tickers:
 * price, change, no artwork, no history. The visual enrichment behind it is
 * per coin and budgeted, so it reaches the top of the list first and the
 * remainder a few rows per poll.
 *
 * The user's own connection does not share that block. CoinGecko's
 * `/coins/markets` — ONE request carrying the image AND the 7-day sparkline
 * for all 250 rows — is exactly the call this screen used to make directly,
 * and from a phone or a home connection it usually answers. So the client asks
 * for it once, merges the VISUALS into the rows the backend sent, and the
 * page looks the way it looked before the datacenter IP got throttled.
 *
 * Rules this follows, all of them the same rules the server layer follows:
 *   • gap-fill only — the price, the changes and every other number on the
 *     row stay exactly what the live backend said;
 *   • the merge is by CoinGecko id, never by ticker;
 *   • it must not hold the screen open. The rescue gets a short window to
 *     answer; if it misses it, it keeps running in the background and the
 *     NEXT poll picks the visuals up from memory;
 *   • a failure cools the whole thing down, so a blocked user pays one failed
 *     request every few minutes instead of one per poll.
 */
const VISUAL_RESCUE_WAIT_MS = 250;
const VISUAL_RESCUE_TIMEOUT_MS = 8000;
const VISUAL_RESCUE_COOLDOWN_MS = 5 * 60 * 1000;

let visualRescueBlockedUntil = 0;
let visualRescueInFlight = null;
const visualListeners = new Set();
export function onMarketVisualsReady(listener) {
  visualListeners.add(listener);
  return () => visualListeners.delete(listener);
}

/** One in-flight bulk read per client, however many screens ask for it. */
function startVisualRescue({ vs, perPage, page }) {
  if (visualRescueInFlight) return visualRescueInFlight;
  visualRescueInFlight = (async () => {
    const raw = await fetchJson(
      `${PUBLIC_CG}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${Math.min(250, perPage)}` +
        `&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d`,
      { timeout: VISUAL_RESCUE_TIMEOUT_MS }
    );
    if (!Array.isArray(raw) || !raw.length) throw new Error('CoinGecko returned no market rows');
    /* Remembered, not spliced: the same call also seeds the memory that gets
       the coin detail screen and the next poll its logos and lines. */
    rememberVisuals(raw.map((coin) => normalizeCoin(coin)));
    for (const listener of visualListeners) listener();
  })()
    .then(() => {
      visualRescueBlockedUntil = 0;
    })
    .catch(() => {
      visualRescueBlockedUntil = Date.now() + VISUAL_RESCUE_COOLDOWN_MS;
    })
    .finally(() => {
      visualRescueInFlight = null;
    });
  return visualRescueInFlight;
}

async function rescueMissingVisuals(rows, ctx) {
  const list = Array.isArray(rows) ? rows : [];
  /*
   * `needsVisuals` consults the visual memory, so a row whose artwork or line
   * was already fetched — by this screen, by another screen, by the server —
   * completes here with NO request at all. That is the steady state: the
   * backend keeps sending bare tickers and the page keeps rendering them
   * complete, which is why the merge below is unconditional. Only the fetch
   * is conditional.
   */
  const missing = list.some(needsVisuals);
  if (missing && Date.now() >= visualRescueBlockedUntil) {
    await Promise.race([
      startVisualRescue(ctx),
      new Promise((resolve) => setTimeout(resolve, VISUAL_RESCUE_WAIT_MS))
    ]);
  }
  /* A rescue that lands AFTER the wait window still fills the next poll,
     because it wrote to the memory above rather than to this array. */
  return list.map(mergeVisuals);
}

/* -------------------------------------------------------------------------- */
/* Coin markets                                                                */
/* -------------------------------------------------------------------------- */

export function getMarkets({ page = 1, perPage = 50, vs = 'usd' } = {}) {
  const withProvenance = (rows, dataProvenance) =>
    (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, dataProvenance }));

  return resilient(`markets:${vs}:${page}:${perPage}`, {
    ttl: 30000,
    backend: async () => {
      const { data, stale } = await fetchJson(`${apiBase()}/markets?page=${page}&per_page=${perPage}&vs=${vs}`, { withMeta: true });
      // The server may fall back to an expired in-memory cache on failure.
      // Its x-data-stale header must survive this client layer; a stale quote
      // is useful for browsing but is not an executable strategy observation.
      // The rescue then fills whatever artwork and history the backend could
      // not (see above) — numbers untouched, gaps only.
      const rows = await rescueMissingVisuals(data, { vs, perPage, page });
      return withProvenance(rows, stale ? 'stale' : 'live');
    },
    direct: async () => {
      let coinGeckoError;
      try {
        const raw = await fetchJson(
          `${PUBLIC_CG}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${perPage}` +
            `&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d`
        );
        if (Array.isArray(raw) && raw.length) {
          const rows = raw.map((coin) => ({ ...normalizeCoin(coin), marketProvider: 'coingecko' }));
          rememberVisuals(rows);
          return withProvenance(rows, 'live');
        }
        coinGeckoError = new Error('CoinGecko returned no market rows');
      } catch (err) {
        coinGeckoError = err;
      }

      // CoinLore quotes USD only; do not mislabel dollars for a legacy currency.
      if (String(vs || 'usd').toLowerCase() !== 'usd') throw coinGeckoError;
      /* Paged by the shared adapter: 250 rows is three requests, in order. */
      let rows;
      try {
        rows = await fetchCoinLoreTickers({
          fetchJson: (url, opts) => fetchJson(url, { timeout: opts?.timeoutMs || 12000 }),
          base: PUBLIC_COINLORE,
          page,
          perPage,
          maxPages: 3
        });
      } catch {
        throw coinGeckoError;
      }
      /*
       * The backend is unreachable and CoinGecko's bulk endpoint just failed
       * here too, so the visuals are rebuilt from what this browser CAN reach:
       * a venue's klines for the whole week at a time (one call per pair, so
       * the page is covered in one pass), then CoinGecko's per-coin endpoints
       * for the leftovers — logos, and coins no venue lists. Both are
       * fail-silent and both are deadline-bounded, because the prices above
       * are already a complete answer.
       */
      const jsonFetch = (url, opts) => fetchJson(url, { timeout: opts?.timeoutMs || 8000 });
      let enriched = rows;
      try {
        enriched = await attachVenueSparklines(enriched, {
          fetchJson: jsonFetch,
          vs,
          timeoutMs: 5000,
          deadlineMs: 5000
        });
      } catch {
        /* per-coin charts below remain the fallback */
      }
      enriched = await hydrateCoinRows(enriched, {
        fetchJson: jsonFetch,
        cgBase: PUBLIC_CG,
        vs,
        chartBudget: 24,
        logoBudget: 24,
        deadlineMs: 4000
      });
      return withProvenance(enriched, 'live');
    },
    // The deterministic snapshot keeps the ordinary market screen useful
    // offline, but the Intelligence tab must never relabel it as a live fact.
    fallback: () => withProvenance(offlineMarkets(perPage), 'offline')
  });
}

/**
 * SECTOR CATEGORIES — gold, memecoins, RWA, AI…
 *
 * ─── WHY THIS IS A SEPARATE FUNCTION AND NOT A FILTER ───────────────────────
 * The Market screen's existing filters (gainers, losers, volume) all re-sort
 * the SAME 250 rows already in memory. A sector cannot work that way: there
 * are only a handful of tokenized-gold tokens in existence and none of them
 * is in the top 250 by market cap, so filtering the loaded page for "gold"
 * would correctly return almost nothing.
 *
 * CoinGecko's `category` parameter queries the whole universe instead. It is
 * free, needs no key, and is the same endpoint we already use — verified
 * live before writing this: `category=tokenized-gold` returns XAUT, PAXG,
 * Kinesis and others, none of which appear in the default list.
 *
 * ─── WHY THE CATEGORY IDS ARE HARD-CODED ────────────────────────────────────
 * CoinGecko's category slugs are not guessable ("meme-token", not "memes";
 * "tokenized-gold", not "gold"). A wrong slug returns an empty array rather
 * than an error, which would render as a blank screen with no explanation.
 * The map in marketSectors.js is shared with the server allowlist.
 */
export function getCategory(category, { perPage = 100, vs = 'usd' } = {}) {
  const slug = MARKET_CATEGORIES[category];
  if (!slug) return Promise.resolve([]);

  return resilient(`cat:${slug}:${vs}:${perPage}`, {
    /*
     * Five minutes. A sector list moves far more slowly than a price ticker,
     * and every extra request here is spent against a free public rate limit
     * we share with the rest of the app.
     */
    ttl: 300_000,
    backend: async () => {
      const { data, stale } = await fetchJson(`${apiBase()}/category/${slug}?per_page=${perPage}&vs=${vs}`, { withMeta: true });
      return (Array.isArray(data) ? data : []).map((row) => ({ ...row, dataProvenance: stale ? 'stale' : 'live' }));
    },
    direct: async () => {
      const raw = await fetchJson(
        `${PUBLIC_CG}/coins/markets?vs_currency=${vs}&category=${slug}` +
          `&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true` +
          `&price_change_percentage=1h,24h,7d`
      );
      if (!Array.isArray(raw) || !raw.length) throw new Error('Empty category response');
      return raw.map((coin) => ({ ...normalizeCoin(coin), dataProvenance: 'live' }));
    },
    /*
     * Empty, not the offline snapshot. That snapshot is the top coins by
     * market cap — showing Bitcoin under a "Gold" tab because the network was
     * down would be worse than an honest empty state.
     */
    fallback: () => []
  });
}

export function normalizeCoin(c = {}) {
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
     * The direct (no-backend) CoinGecko path has to carry the SAME fields the
     * server path does, or the هوشمندی tab would rank capital flows when the
     * app talks to our API and show an honest gap when it talks to CoinGecko
     * directly. Null — never 0 — when the feed omits it.
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
    sparkline: c.sparkline_in_7d?.price ?? c.sparkline ?? []
  };
}

/* -------------------------------------------------------------------------- */
/* Single coin                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Look up ONE coin by id.
 *
 * WHY THIS EXISTS
 * The coin detail screen used to search the already-loaded markets page for
 * the id and render "coin not found" when it wasn't there. That is not an API
 * failure — the markets list is paged (top 60 by market cap), so tapping any
 * coin found via search, trending, or a deep link outside that window always
 * produced the error, and it looked like the data provider was broken.
 *
 * Now the detail screen asks for the coin directly. Order: our backend, then
 * public CoinGecko `/coins/markets?ids=`, then the single-coin endpoint, then
 * the offline snapshot. Only a coin that exists nowhere returns null.
 */
/**
 * The memo key for one coin, exported so a screen can ask `lastFetchFailed()`
 * about it. Derived in one place because a hand-built key that drifts from
 * this one would silently always answer false.
 */
export const coinKey = (id, vs = 'usd') => `coin:${id}:${vs}`;

export function getCoin(id, vs = 'usd') {
  if (!id) return Promise.resolve(null);
  return resilient(coinKey(id, vs), {
    ttl: 30000,
    backend: () => fetchJson(`${apiBase()}/coin/${encodeURIComponent(id)}`),
    direct: async () => {
      let coinGeckoError;
      try {
        // The markets endpoint gives us sparkline + 1h/7d changes in one call,
        // which is exactly the shape the detail screen renders.
        const rows = await fetchJson(
          `${PUBLIC_CG}/coins/markets?vs_currency=${vs}&ids=${encodeURIComponent(id)}` +
            `&sparkline=true&price_change_percentage=1h,24h,7d`
        );
        if (Array.isArray(rows) && rows[0]) {
          const coin = { ...normalizeCoin(rows[0]), marketProvider: 'coingecko' };
          rememberVisuals([coin]);
          return coin;
        }

        // Some ids only resolve on the detail endpoint (delisted, or an id that
        // came from /search rather than /markets).
        const raw = await fetchJson(
          `${PUBLIC_CG}/coins/${encodeURIComponent(id)}?localization=false&tickers=false` +
            `&market_data=true&community_data=false&developer_data=false`
        );
        const md = raw.market_data ?? {};
        const coin = {
          id: raw.id,
          symbol: (raw.symbol || '').toUpperCase(),
          name: raw.name,
          image: raw.image?.large ?? raw.image?.small,
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
          athChange: md.ath_change_percentage?.[vs] ?? 0,
          supply: md.circulating_supply ?? 0,
          description: raw.description?.en?.slice(0, 700) || '',
          homepage: raw.links?.homepage?.[0] || null,
          sparkline: md.sparkline_7d?.price ?? [],
          marketProvider: 'coingecko'
        };
        rememberVisuals([coin]);
        return coin;
      } catch (err) {
        coinGeckoError = err;
      }

      if (String(vs || 'usd').toLowerCase() !== 'usd') throw coinGeckoError;
      const raw = await fetchJson(`${PUBLIC_COINLORE}/tickers/?start=0&limit=${COINLORE_MAX_PAGE_SIZE}`);
      if (!Array.isArray(raw?.data)) throw coinGeckoError;
      let coin = raw.data.map(normalizeCoinLoreMarket).find((row) => row?.id === id);
      for (let page = 2; !coin && page <= 5; page += 1) {
        // CoinLore caps each request at 100. Scan only until this coin is
        // found or the provider returns its last page (market can show 500).
        const rest = await fetchCoinLoreTickers({
          fetchJson: (url) => fetchJson(url), base: PUBLIC_COINLORE,
          page, perPage: 100, maxPages: 1
        });
        coin = rest.find((row) => row.id === id);
        if (rest.length < 100) break;
      }
      if (!coin) throw coinGeckoError;
      /*
       * The detail screen renders the SAME row shape as the list, so it wants
       * the same two things: a line and a face. A venue gets the line for the
       * whole week in one call (reachable where CoinGecko's bulk endpoint is
       * not), and CoinGecko's per-coin endpoints cover whatever is left — the
       * logo, and coins the venue does not trade. Both fail silent.
       */
      const jsonFetch = (url, opts) => fetchJson(url, { timeout: opts?.timeoutMs || 8000 });
      let candidate = { ...coin, description: '', homepage: null };
      try {
        [candidate] = await attachVenueSparklines([candidate], {
          fetchJson: jsonFetch,
          vs: 'usd',
          timeoutMs: 5000,
          deadlineMs: 5000
        });
      } catch {
        /* the per-coin hydration below remains the fallback */
      }
      const [enriched] = await hydrateCoinRows([candidate], {
        fetchJson: jsonFetch,
        cgBase: PUBLIC_CG,
        vs: 'usd',
        deadlineMs: 4000
      });
      return enriched;
    },
    fallback: () => offlineMarkets(250).find((c) => c.id === id) ?? null
  });
}

/**
 * Search the whole coin universe by name/ticker, not just the loaded page.
 * Falls back to filtering the offline snapshot so the box still does something
 * useful with no network.
 */
export function searchCoins(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  return resilient(`search:${q.toLowerCase()}`, {
    ttl: 120000,
    backend: () => fetchJson(`${apiBase()}/search?q=${encodeURIComponent(q)}`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/search?query=${encodeURIComponent(q)}`);
      return (raw.coins || []).slice(0, 25).map((c) => ({
        id: c.id,
        symbol: (c.symbol || '').toUpperCase(),
        name: c.name,
        image: c.thumb || c.large,
        rank: c.market_cap_rank ?? 0
      }));
    },
    fallback: () => {
      const lower = q.toLowerCase();
      return offlineMarkets(250)
        .filter((c) => c.symbol.toLowerCase().includes(lower) || c.name.toLowerCase().includes(lower))
        .slice(0, 25);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Trending / charts / DEX                                                     */
/* -------------------------------------------------------------------------- */

export function getTrending() {
  return resilient('trending', {
    ttl: 120000,
    backend: () => fetchJson(`${apiBase()}/trending`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/search/trending`);
      return (raw.coins || []).slice(0, 10).map(({ item }) => ({
        id: item.id,
        symbol: (item.symbol || '').toUpperCase(),
        name: item.name,
        image: item.small,
        rank: item.market_cap_rank,
        score: item.score
      }));
    },
    fallback: () => offlineTrending()
  });
}

/**
 * OHLC candles.
 *
 * Deliberately NO offline fallback, unlike getChart. The bundled snapshot
 * holds closing prices only, so a fabricated candle would have to invent its
 * high and low — and those two numbers are the entire reason someone switched
 * to the candle view. Inventing them would be making up the data the user
 * came for. When it cannot load, the UI says so.
 */
export function getOhlc(id, days = 30, vs = 'usd') {
  return resilient(`ohlc:${id}:${days}`, {
    ttl: 60000,
    backend: () => fetchJson(`${apiBase()}/ohlc/${id}?days=${days}&vs=${vs}`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/coins/${id}/ohlc?vs_currency=${vs}&days=${days}`);
      return (Array.isArray(raw) ? raw : [])
        .map(([t, o, h, l, c]) => ({ t, o, h, l, c }))
        .filter((d) => [d.t, d.o, d.h, d.l, d.c].every(Number.isFinite) && d.h >= d.l);
    },
    fallback: () => []
  });
}

export function getChart(id, days = 1, vs = 'usd') {
  return resilient(`chart:${id}:${days}`, {
    ttl: 60000,
    backend: () => fetchJson(`${apiBase()}/chart/${id}?days=${days}&vs=${vs}`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/coins/${id}/market_chart?vs_currency=${vs}&days=${days}`);
      return (raw.prices || []).map(([t, p]) => ({ t, p }));
    },
    fallback: () => offlineChart(id, days)
  });
}

/** GeckoTerminal — hottest DEX pools on a given network. */
export function getDexPools(network = 'bsc') {
  return resilient(`dex:${network}`, {
    ttl: 60000,
    backend: () => fetchJson(`${apiBase()}/dex/${network}`),
    direct: async () => {
      const raw = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools`);
      return (raw.data || []).slice(0, 12).map(normalizePool);
    },
    fallback: () => []
  });
}

export function normalizePool(p = {}) {
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
}

/** Simple spot price for a handful of symbols — used by the trade screen. */
export async function getSimplePrices(ids = []) {
  if (!ids.length) return {};
  const key = `simple:${ids.join(',')}`;
  return resilient(key, {
    ttl: 20000,
    backend: () => fetchJson(`${apiBase()}/prices?ids=${ids.join(',')}`),
    direct: () => fetchJson(`${PUBLIC_CG}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`),
    fallback: () =>
      Object.fromEntries(
        offlineMarkets(60)
          .filter((c) => ids.includes(c.id))
          .map((c) => [c.id, { usd: c.price, usd_24h_change: c.change24h }])
      )
  });
}
