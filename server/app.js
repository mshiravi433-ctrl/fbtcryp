/**
 * Shared Express application.
 *
 * Used by BOTH the local dev server (server/index.js, which adds static file
 * serving and the Telegram bot) and the Vercel serverless function
 * (api/index.js). One app definition means the deployed API cannot drift from
 * the one you test locally.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { withCache, cacheStats, memoryStore } from './cache.js';
import { blobConfigured, withPersistentCache } from './blobCache.js';
import {
  fetchChart,
  fetchCoinDetail,
  fetchCategory,
  fetchDexPools,
  fetchGlobal,
  fetchMarkets,
  fetchOhlc,
  fetchSearch,
  fetchSimplePrices,
  fetchTrending,
} from './providers.js';
import { telegramAuth } from './telegramAuth.js';
import { fetchAudio } from './audio.js';
import { fetchCalm } from './calm.js';
import { fetchThorPools, thorQuote, thorStatus } from './thorchain.js';
import { fetchNews } from './news.js';
import { fetchYields } from './yields.js';
import { fetchSolanaAssets } from './solanaAssets.js';
import { fetchPerpMarkets } from './perp.js';
import { resolveIds } from './coinIndex.js';
import { resolveVenue } from './coinVenue.js';
import { fiatOrder, fiatQuote, fiatRange, fiatStatus } from './fiat.js';
import { bridgeQuote, bridgeStatus } from './bridge.js';
import { dlnCreateTx, dlnQuote, dlnStatus } from './dln.js';
import { gaslessPrice, gaslessQuote, gaslessStatus, gaslessSubmit } from './gasless.js';
import { jupiterConfigured, referralAccount, solanaExecute, solanaOrder } from './solana.js';
import { oceanQuote, oceanStatus, oceanSwap } from './solanaOcean.js';
import { crossChainProbe, crossChainQuotes, crossChainStatus } from './xchain.js';
import { revenueReadiness } from './readiness.js';
import { timingSafeEqual } from 'node:crypto';
import { pushConfigured, sendDailyPromo } from './push.js';
import { fcmBroadcast, fcmConfigured, fcmDiagnose } from './fcm.js';
import { fetchNfts, nftChains, nftConfigured, nftDiagnose } from './nft.js';
import { clearWatches, putWatches, readWatches, runWatchCycle } from './watch.js';
import {
  addFcmToken,
  addSubscription,
  readFcmTokens,
  removeFcmToken,
  removeSubscription,
  storeDurable
} from './store.js';
import { aiConfigured, aiSelfTest, answerSupportQuestion, generateMarketBrief, generateOutlook, newsConfigured } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(telegramAuth(BOT_TOKEN)); // optional — populates req.tgUser when present

/* ------------------------------ rate limiting ----------------------------- */

const hits = new Map();
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT || 120);

app.use('/api', (req, res, next) => {
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.reset) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'RATE_LIMITED' });
  }
  return next();
});

// keep the rate-limit map from growing forever
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, WINDOW_MS).unref?.();

/* --------------------------- AI: a tighter budget ------------------------- */
/*
 * The limit above is sized for cached market data, where a request costs a
 * map lookup. The AI routes are a different economy: each one spends real
 * upstream quota that is shared by every user of the app, and the Developers
 * page publishes these paths openly.
 *
 * At 120/min a single script could exhaust the daily model quota in minutes
 * and take the feature down for everyone — not by attacking anything, just by
 * looping the documented example. Cheap-to-serve and expensive-to-serve
 * endpoints should not share a budget.
 *
 * 10/min per caller is far above what the UI generates (the client answers
 * common questions from its local FAQ and only escalates when unsure) and far
 * below what a loop costs.
 */
const aiHits = new Map();
const AI_MAX_PER_WINDOW = Number(process.env.AI_RATE_LIMIT || 10);

app.use('/api/ai', (req, res, next) => {
  // Reading status must never be throttled: the client polls it to decide
  // whether to show the feature at all, and a 429 there looks like an outage.
  if (req.method === 'GET') return next();

  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = aiHits.get(key);
  if (!rec || now > rec.reset) {
    aiHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > AI_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'AI_RATE_LIMITED' });
  }
  return next();
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of aiHits) if (now > v.reset) aiHits.delete(k);
}, WINDOW_MS).unref?.();

/* -------------------------------- helpers -------------------------------- */

function serve(res, ttlMs) {
  return async (producer, key) => {
    try {
      const { value, cached, stale } = await withCache(key, ttlMs, producer);
      res.set('cache-control', `public, max-age=${Math.floor(ttlMs / 1000)}`);
      if (stale) res.set('x-data-stale', '1');
      if (cached) res.set('x-cache', 'HIT');
      return res.json(value);
    } catch (err) {
      return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
    }
  };
}

/* --------------------------------- routes -------------------------------- */

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, uptime: process.uptime(), cache: cacheStats(), bot: Boolean(BOT_TOKEN) })
);

/*
 * ─── INDEXNOW OWNERSHIP KEY, SERVED FROM THE API ────────────────────────────
 * IndexNow proves domain ownership by fetching a key file and checking it
 * contains the key. The obvious place is `public/<key>.txt` at the site root,
 * and that file exists — but Vercel's CDN was still returning 404 for it long
 * after the deploy that added it, while older static files served fine.
 *
 * Rather than guess at CDN propagation, this serves the same key from a route
 * that provably works: /api/* is a serverless function, not a cached static
 * asset, so it is live the moment the function deploys.
 *
 * That is explicitly allowed. From Bing's own documentation:
 *
 *   "Option 2: Host one to many UTF-8 encoded text key files in other
 *    locations within the same host ... you must specify the key file
 *    location as keyLocation URLs parameter value"
 *
 * So the submitter passes this URL as `keyLocation` and the static file
 * remains as a belt-and-braces second copy for whenever the CDN catches up.
 *
 * The key is NOT a secret — publishing it at a public URL IS the ownership
 * proof, which is why it is a literal here rather than an env var. Keeping it
 * in the repository means one grep finds every copy, and a mismatch between
 * them is the failure mode: the submission silently 403s forever.
 */
const INDEXNOW_KEY = 'b5187e6cbc36ff99eb5f2b97efcdfb6e';

app.get(`/api/indexnow-key/${INDEXNOW_KEY}.txt`, (_req, res) => {
  res.type('text/plain; charset=utf-8');
  /* A day: long enough to be cheap, short enough that rotating the key
     propagates without waiting on a CDN. */
  res.set('cache-control', 'public, max-age=86400');
  res.send(INDEXNOW_KEY);
});

app.get('/api/me', (req, res) =>
  res.json({ authenticated: Boolean(req.tgUser), user: req.tgUser ?? null, startParam: req.tgStartParam ?? null })
);

app.get('/api/global', (_req, res) => serve(res, 45000)(fetchGlobal, 'global'));

app.get('/api/markets', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(250, Math.max(1, Number(req.query.per_page) || 50));
  const vs = String(req.query.vs || 'usd').toLowerCase();
  return serve(res, 30000)(() => fetchMarkets({ page, perPage, vs }), `markets:${vs}:${page}:${perPage}`);
});

app.get('/api/trending', (_req, res) => serve(res, 120000)(fetchTrending, 'trending'));

app.get('/api/chart/:id', (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 1));
  const vs = String(req.query.vs || 'usd').toLowerCase();
  return serve(res, 60000)(() => fetchChart(req.params.id, days, vs), `chart:${req.params.id}:${days}:${vs}`);
});

/**
 * CANDLES for the coin page.
 *
 * Separate from /api/chart because the upstream is a different endpoint with
 * different data: /market_chart gives closes only, /ohlc gives the four
 * numbers a candle needs. The high and low are exactly what a line chart
 * cannot express, which is why this exists at all.
 *
 * Same 60s TTL as the line chart — they are read side by side and a shorter
 * TTL here would just double our upstream traffic for two views of one truth.
 */
app.get('/api/ohlc/:id', (req, res) => {
  const days = Number(req.query.days) || 30;
  const vs = String(req.query.vs || 'usd').slice(0, 8);
  return serve(res, 60000)(() => fetchOhlc(req.params.id, days, vs), `ohlc:${req.params.id}:${days}:${vs}`);
});

app.get('/api/coin/:id', (req, res) =>
  serve(res, 120000)(() => fetchCoinDetail(req.params.id), `coin:${req.params.id}`)
);

/*
 * COIN SEARCH.
 *
 * `fetchSearch` was imported at the top of this file and then never routed —
 * the same "imported but never mounted" failure that hit push, leaderboard and
 * the watch routes. `/api/search?q=btc` answered `{"error":"NOT_FOUND"}` on the
 * live site while the import sat there looking correct.
 *
 * The client (src/lib/api.js searchCoins) hides this: when the backend 404s it
 * silently falls through to the public CoinGecko endpoint, which is rate
 * limited per user IP. So search "worked" while quietly bypassing our cache
 * and burning the user's own quota.
 */
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 64);
  if (q.length < 2) return res.json([]);
  return serve(res, 120000)(() => fetchSearch(q), `search:${q.toLowerCase()}`);
});

/*
 * NEWS.
 *
 * Same story: `fetchNews` imported, no route. The client then fell back to
 * public RSS through a third-party JSON bridge from every device — which is
 * exactly what aggregating server-side was supposed to avoid (one upstream
 * request per day for everyone, instead of one per user per open).
 *
 * TTL is 30 minutes rather than the 24h the client caches for: the client
 * decides how long to keep it, the server only decides how often to refetch.
 */
app.get('/api/news', (_req, res) => serve(res, 1_800_000)(fetchNews, 'news'));

/*
 * CRYPTO RADIO — spoken news from real podcast feeds.
 *
 * Cached for 30 minutes, same as headlines and for the same reason: these
 * shows publish once a day at most, so re-fetching four RSS documents per
 * visitor would spend our request budget to learn nothing new.
 *
 * Audio and not video. See server/audio.js for the whole argument, but the
 * short version is that youtube.com does not resolve on most Iranian
 * networks, so an embedded live stream would render as a permanently grey box
 * for the primary audience. Podcast MP3s are ordinary HTTPS files from CDNs
 * that are reachable, need no SDK, and keep playing with the screen off.
 */
/*
 * ─── WHY THIS ONE IS PERSISTENTLY CACHED AND /api/news IS NOT ─────────────
 *   «در اخبار قسمت رادیو هم دیر میاد»
 *
 * The radio tab was slow, and the memory cache above is the reason it stayed
 * slow no matter how long the TTL was. On Vercel every cold start begins with
 * an EMPTY Map, so `serve()` re-fetched four RSS documents from four
 * different podcast hosts — and because `fetchAudio` waits for all four, the
 * response could not arrive until the SLOWEST of them did. Measured against
 * the timeout that used to apply, that was up to 12 seconds of staring at a
 * skeleton, on a feature whose content changes once a day.
 *
 * Blob storage survives cold starts, so the fetch happens roughly twice an
 * hour for the whole site instead of once per visitor who got unlucky. It
 * degrades to memory-only when the token is missing, which is exactly what
 * happens in local development — the feature still works, it is just as slow
 * as it used to be.
 */
app.get('/api/audio', async (_req, res) => {
  try {
    const { value, cached, tier } = await withPersistentCache(
      'audio',
      1_800_000,
      fetchAudio,
      memoryStore
    );
    res.set('cache-control', 'public, max-age=900');
    if (cached) res.set('x-cache', tier.toUpperCase());
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * CALM MUSIC — the third news tab.
 *
 * Persistently cached like /api/audio and for a stronger reason: this endpoint
 * costs up to eleven upstream requests (three searches plus one metadata
 * lookup per item), and archive.org is a charity running on donated
 * bandwidth. Re-running that per visitor would be rude as well as slow.
 *
 * Six hours rather than thirty minutes. Podcast feeds publish daily; a
 * public-domain music catalogue from 2008 does not change at all, so there is
 * nothing to gain from asking more often.
 */
app.get('/api/calm', async (_req, res) => {
  try {
    const { value, cached, tier } = await withPersistentCache(
      'calm',
      6 * 3600_000,
      fetchCalm,
      memoryStore
    );
    res.set('cache-control', 'public, max-age=3600');
    if (cached) res.set('x-cache', tier.toUpperCase());
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/prices', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (!ids.length) return res.json({});
  return serve(res, 20000)(() => fetchSimplePrices(ids), `prices:${ids.sort().join(',')}`);
});

/* ------------------------------- AI routes ------------------------------- */
/* Keys stay here. Responses cached hard so cost stays flat as users grow.    */

const AI_TTL = Number(process.env.AI_CACHE_TTL_MS || 6 * 3600_000); // 6h

app.get('/api/ai/status', (_req, res) =>
  res.json({ enabled: aiConfigured(), news: newsConfigured(), persistentCache: blobConfigured() })
);

/**
 * Live AI diagnosis: actually calls the provider and reports why it failed.
 *
 * Guarded by CRON_SECRET because it costs a real (tiny) amount per call and
 * because the response describes your configuration. Without the secret set,
 * it still runs but only reports which keys are PRESENT — never their values,
 * and never a live call. That keeps it useful on a fresh deploy without
 * turning it into a free inference endpoint for strangers.
 */
app.get('/api/ai/diagnose', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  /*
   * Accept the secret as a query parameter as well as a header.
   *
   * The note below used to say `?Authorization: Bearer <CRON_SECRET>`, but a
   * leading `?` means a QUERY STRING while the code only ever read headers.
   * So the instruction was impossible to follow from a phone browser — the one
   * place this endpoint is actually opened — and the live test could never be
   * reached. Either the note or the code had to change; supporting `?key=` is
   * the one that helps, since typing a custom header on a phone is not
   * realistic.
   *
   * This is a diagnostic, not an authenticated action: it moves no money and
   * returns booleans, never key values. A secret in a URL can leak through
   * logs and referrers, so it stays acceptable ONLY because of that.
   */
  const provided =
    req.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.get('x-cron-secret') ||
    String(req.query.key || '') ||
    '';

  if (secret && provided !== secret) {
    return res.json({
      ok: aiConfigured(),
      /*
       * Report EVERY provider, not just two. Groq was omitted here, so a
       * working Groq setup showed `geminiKeyPresent:false,
       * openrouterKeyPresent:false` next to `enabled:true` — which reads as
       * "it works but nothing is configured" and sends you looking for a
       * problem that does not exist.
       */
      groqKeyPresent: Boolean(process.env.GROQ_API_KEY),
      geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
      openrouterKeyPresent: Boolean(process.env.OPENROUTER_API_KEY),
      enabled: aiConfigured(),
      note: 'Append ?key=<CRON_SECRET> to run a live provider test.'
    });
  }

  try {
    return res.json(await aiSelfTest());
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message).slice(0, 200) });
  }
});

app.post('/api/ai/outlook', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
  const { id, symbol, name, price, indicators, change24h, change7d, lang } = req.body ?? {};
  if (!id || !symbol) return res.status(400).json({ error: 'BAD_REQUEST' });

  // One entry per coin per language per day — a daily briefing doesn't need
  // regenerating for every user who opens the screen.
  const day = new Date().toISOString().slice(0, 10);
  const key = `ai:outlook:${id}:${lang || 'en'}:${day}`;

  try {
    const { value, cached, tier } = await withPersistentCache(
      key,
      AI_TTL,
      () => generateOutlook({ symbol, name, price, indicators, change24h, change7d, lang }),
      memoryStore
    );
    res.set('x-cache', cached ? `HIT:${tier}` : 'MISS');
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'AI_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.post('/api/ai/brief', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
  const { global: g, top, lang } = req.body ?? {};
  const day = new Date().toISOString().slice(0, 10);
  const hour = new Date().getUTCHours();
  // refresh the market brief every 6 hours
  const key = `ai:brief:${lang || 'en'}:${day}:${Math.floor(hour / 6)}`;

  try {
    const { value, cached, tier } = await withPersistentCache(
      key,
      AI_TTL,
      () => generateMarketBrief({ global: g, top, lang }),
      memoryStore
    );
    res.set('x-cache', cached ? `HIT:${tier}` : 'MISS');
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'AI_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * /api/ai/faq was removed with the Help chat box. Support questions are now
 * answered by a browsable FAQ built from src/lib/faqLocal.js — hand-written,
 * checked against what the code does, and impossible to hallucinate a fee or
 * a recovery path from. See the header of src/pages/Help.jsx.
 */

/**
 * SECTOR CATEGORY — gold, memecoins, RWA and friends.
 *
 * Proxied so the browser never talks to CoinGecko directly on this path and
 * so one server-side cache serves every user. The slug is allow-listed
 * against the client's own map rather than passed through: an open proxy to
 * an upstream API is a way to get our IP rate-limited by a stranger.
 */
app.get('/api/category/:slug', (req, res) => {
  const slug = String(req.params.slug || '').slice(0, 60);
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'BAD_CATEGORY' });
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 50));
  const vs = /^[a-z]{2,5}$/.test(String(req.query.vs || '')) ? String(req.query.vs) : 'usd';
  return serve(res, 300_000)(
    () => fetchCategory(slug, { perPage, vs }),
    `cat:${slug}:${vs}:${perPage}`
  );
});

/* ------------------------------ cross-chain ------------------------------- */
/*
 * Bridging via LI.FI. Proxied so the API key never reaches the browser and so
 * the fee parameters cannot be supplied by a caller — see server/bridge.js for
 * why the allow-list is the security boundary rather than a preference.
 */

app.get('/api/bridge/status', async (_req, res) => {
  try {
    res.set('cache-control', 'public, max-age=300');
    return res.json(await bridgeStatus());
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/bridge/quote', async (req, res) => {
  try {
    const { ok, status, body } = await bridgeQuote(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * ─── THE SECOND BRIDGE, AT MORE THAN TWICE THE FEE ──────────────────────────
 * deBridge DLN pays us 70 bps where LI.FI pays 30, needs no key and no
 * account. It is NOT a replacement: DLN adds a FIXED protocol fee in the
 * origin chain's native coin, which is negligible on a large transfer and
 * ruinous on a small one. Both are quoted and the user picks — see
 * server/dln.js for the measured numbers behind that decision.
 *
 * Same security boundary as LI.FI: the affiliate parameters are set on the
 * server and are never accepted from the query string.
 */
app.get('/api/dln/status', (_req, res) => {
  res.set('cache-control', 'public, max-age=300');
  return res.json(dlnStatus());
});

app.get('/api/dln/quote', async (req, res) => {
  try {
    const { ok, status, body } = await dlnQuote(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/dln/tx', async (req, res) => {
  try {
    const { ok, status, body } = await dlnCreateTx(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/* -------------------------------- gasless --------------------------------- */
/*
 * Swaps for users with no native coin. See server/gasless.js — the short
 * version is that someone holding USDT and no BNB can currently do nothing at
 * all in this app, and that is the most common dead end in crypto.
 *
 * Proxied so the 0x key stays server-side and so the fee parameters cannot be
 * supplied by a caller.
 */

app.get('/api/gasless/status', (_req, res) => {
  res.set('cache-control', 'public, max-age=300');
  res.json(gaslessStatus());
});

app.get('/api/gasless/price', async (req, res) => {
  try {
    const { ok, status, body } = await gaslessPrice(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/gasless/quote', async (req, res) => {
  try {
    const { ok, status, body } = await gaslessQuote(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.post('/api/gasless/submit', async (req, res) => {
  try {
    const { ok, status, body } = await gaslessSubmit(req.body);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/dex/:network', (req, res) =>
  serve(res, 60000)(() => fetchDexPools(req.params.network), `dex:${req.params.network}`)
);

/**
 * LIVE YIELDS — the Farm screen's data.
 *
 * ─── WHY THIS IS A SERVER ROUTE AND NOT A CLIENT FETCH ──────────────────────
 * The upstream (`yields.llama.fi/pools`) is free and keyless, which is the
 * only reason this feature is possible at all — but it returns EVERY pool
 * DefiLlama tracks, over 20,000 of them and several megabytes. Sending that to
 * a phone on an Iranian mobile connection to render eight rows would be
 * indefensible.
 *
 * Filtered here down to a few dozen rows. See server/yields.js for the safety
 * rules; the short version is that an unfiltered yield list sorted by APY is
 * a list sorted by scam.
 *
 * ─── ONE HOUR, NOT ONE MINUTE ───────────────────────────────────────────────
 * These are variable rates that move on the scale of days. A shorter TTL would
 * multiply our upstream traffic against a free service we depend on, for a
 * number that would look identical. Being a good citizen of a free API is also
 * how it stays free.
 */
app.get('/api/yields', (_req, res) => serve(res, 3_600_000)(fetchYields, 'yields'));

/**
 * LIVE DATA FOR THE CURATED SOLANA ASSETS — liquid staking + tokenized equities.
 *
 * The mint list is hard-coded (src/lib/solanaAssets.js) because searching for
 * these by name is actively dangerous: querying Jupiter for "AAPLx" returns
 * seven tokens, one real and six pump.fun clones carrying the same name, the
 * same symbol and in two cases the same scraped logo. This route fetches BY
 * MINT ADDRESS and re-checks the issuer authority on every refresh, so a stale
 * or mistyped address makes a row disappear rather than offering a stranger's
 * token under Apple's name.
 *
 * Five minutes rather than the hour used for /api/yields: these carry a live
 * PRICE, and a quote screen showing an hour-old equity price would be
 * misleading in a way an hour-old APY is not.
 */
app.get('/api/solana/assets', (_req, res) => serve(res, 300_000)(fetchSolanaAssets, 'solana-assets'));

/**
 * PERPETUAL FUNDING RATES — the Perp screen's data.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The Perp screen showed a spot price and three links. The one number that
 * decides whether a leveraged position is expensive to HOLD — funding — was
 * described in prose and never shown, even though it differs by several
 * percent a year between venues for the identical trade.
 *
 * ─── FIVE MINUTES ───────────────────────────────────────────────────────────
 * Shorter than /api/yields (an hour) because funding moves intraday and can
 * flip sign within a session; longer than the market feed (30s) because it is
 * settled at most hourly, so a fresher figure would be the same figure at
 * twelve times the upstream cost against a free service.
 *
 * See server/perp.js for the rule that shapes the whole module: a venue whose
 * settlement interval we have not verified is DROPPED, because annualising a
 * rate without its interval produces a confident wrong number.
 */
app.get('/api/perp/markets', (_req, res) => serve(res, 300_000)(fetchPerpMarkets, 'perp-markets'));

/**
 * CONTRACT ADDRESS → COINGECKO ID, for the automatic-order screen.
 *
 * ─── WHY THIS ROUTE EXISTS ──────────────────────────────────────────────────
 * An automatic order needs a PRICE FEED, not just a token. The order screen
 * was therefore limited to the 36 hand-curated entries in `chains.js` that
 * carry a `coingeckoId`, while the swap screen already offers thousands.
 *
 * This resolves the id for any token the user picks. See server/coinIndex.js
 * for why the upstream (the whole CoinGecko coin list, ~20 MB) can never be
 * fetched by a phone, and why an unresolvable address returns null rather than
 * a guess — an order watching the wrong coin's price is worse than no order.
 *
 * Not wrapped in `serve()`: the response depends on the query, and that helper
 * caches per key. coinIndex.js does its own six-hour caching of the expensive
 * part, so each call here is a Map lookup.
 */
app.get('/api/coin-id/:chainId', async (req, res) => {
  try {
    const out = await resolveIds(req.params.chainId, req.query.addresses);
    if (out.error) return res.status(400).json(out);
    /* An id mapping is near-permanent; let the browser hold it for an hour. */
    res.set('cache-control', 'public, max-age=3600');
    return res.json(out);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * GET /api/coin-venue/:id — "can we trade this coin, and where?"
 *
 * The coin page used to answer that from a 46-entry hand-written table and
 * told the user "no" for everything else, including Solana tokens our own
 * /solana screen trades happily. Reported as «بعضی از کویین ها مثل پنگوئن
 * میگه نمیشه سواپ کرد». See server/coinVenue.js.
 *
 * Not wrapped in `serve()` for the same reason as /api/coin-id: the response
 * depends on the path parameter, and that helper caches per fixed key.
 */
app.get('/api/coin-venue/:id', async (req, res) => {
  try {
    const out = await resolveVenue(req.params.id);
    if (out.error) return res.status(400).json(out);
    res.set('cache-control', 'public, max-age=3600');
    return res.json(out);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/* ------------------------- THORChain native swaps ------------------------- */
/*
 * Real BTC for real ETH — no wrapping, no bridge holding the coins. Our EVM
 * aggregator cannot do this, so it adds a trade rather than re-routing one we
 * already earn on.
 *
 * The affiliate address is attached SERVER-SIDE and never read from the
 * query, same rule as the LI.FI bridge: a caller who could set it would point
 * our commission at their own wallet.
 */
app.get('/api/thor/status', (_req, res) => res.json(thorStatus()));

/*
 * Pools are cached for five minutes and NOT longer, deliberately. This is the
 * list the UI uses to decide which pairs to offer, and THORChain halts
 * individual chains regularly — BSC, Solana and Base were all halted while
 * this was written. A stale list means offering a pair that cannot trade,
 * which is the dead-button failure this project keeps removing.
 */
app.get('/api/thor/pools', (_req, res) =>
  serve(res, 300_000)(fetchThorPools, 'thor-pools'));

app.get('/api/thor/quote', async (req, res) => {
  try {
    const out = await thorQuote({
      from: req.query.from,
      to: req.query.to,
      amount: req.query.amount,
      destination: req.query.destination,
      streaming: req.query.streaming === '1'
    });
    if (out.error) return res.status(400).json(out);
    /* Never cached: the response carries an inbound address and an expiry,
       and their own warning says "Do not cache this response." */
    res.set('cache-control', 'no-store');
    return res.json(out);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/* ---------------------------- fiat buy & sell ----------------------------- */
/*
 * Money in, crypto out — and crypto out, money in. NOT crypto-to-crypto:
 * that is our own product and routing it to a partner would be handing over
 * a customer we already have. See server/fiat.js, where `assertFiatLeg`
 * makes a crypto-to-crypto pair impossible to request.
 */
app.get('/api/fiat/status', (_req, res) => res.json(fiatStatus()));

/*
 * Limits. Keyless upstream, so it answers even before ChangeNOW switch our
 * fiat access on — which is the point: a user who cannot yet buy still gets
 * to see the real minimum instead of an empty form.
 */
app.get('/api/fiat/range', async (req, res) => {
  try {
    const { ok, status, body } = await fiatRange(req.query);
    return res.status(ok ? 200 : status).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/fiat/quote', async (req, res) => {
  try {
    const { ok, status, body } = await fiatQuote(req.query);
    return res.status(ok ? 200 : status).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * The call that actually earns.
 *
 * Commission is attributed to completed TRANSACTIONS, not to quotes. Without
 * this route the integration could price a purchase and never make a cent —
 * the "wired to nothing" failure already shipped twice on this project.
 *
 * POST because it creates something upstream and must never be reachable by
 * following a link: a GET that provisions a payment session can be triggered
 * by a crawler, a prefetch, or an <img> tag on somebody else's page.
 */
app.post('/api/fiat/order', async (req, res) => {
  try {
    const { ok, status, body } = await fiatOrder(req.body ?? {});
    return res.status(ok ? 200 : status).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});


/* --------------------------------- Solana --------------------------------- */
/*
 * Jupiter proxy. The client cannot hold the API key — a VITE_ variable is
 * compiled into the browser bundle and the APK — so these two routes exist to
 * attach it server-side. See server/solana.js for why the parameter list is an
 * allow-list rather than a pass-through.
 *
 * Placed above the AI budget's siblings but under the same /api rate limit as
 * everything else; these calls are cheap for us (one upstream request) and the
 * expensive-endpoint budget is reserved for the model routes.
 */
app.get('/api/solana/status', (_req, res) =>
  res.json({
    configured: jupiterConfigured(),
    // The honest signal the UI needs: swaps work without this, but our fee is
    // silently zero, which looks identical to a working integration.
    feeReady: Boolean(referralAccount()),
    referralAccount: referralAccount() || null
  })
);

app.get('/api/solana/order', async (req, res) => {
  const r = await solanaOrder(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.post('/api/solana/execute', async (req, res) => {
  const r = await solanaExecute(req.body);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/*
 * Solana via OpenOcean — the path that actually pays us.
 *
 * Jupiter above earns zero and cannot be fixed without on-chain account
 * creation we have no SOL for; see server/solanaOcean.js for the decoded
 * proof that this route splits a real 0.70% inside the swap transaction.
 *
 * `referrer` and `referrerFee` are attached server-side and are NOT in any
 * forwarded parameter list — from the browser they are unreachable, so nobody
 * can redirect our revenue or inflate the rate in our name.
 */
app.get('/api/solana/oo/status', (_req, res) => res.json(oceanStatus()));

app.get('/api/solana/oo/quote', async (req, res) => {
  const r = await oceanQuote(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/solana/oo/swap', async (req, res) => {
  const r = await oceanSwap(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/*
 * Cross-chain swaps, and the only route in the app that reaches TRON.
 *
 * The fee fields are attached in server/crosschain.js and are absent from
 * anything a caller can set, for the same reason as every other fee path:
 * exposed, they would let a stranger redirect our revenue.
 *
 * /probe is read-only and exists because the 0x key lives in Vercel and
 * cannot be exercised from a laptop. It answers whether Tron genuinely works
 * on OUR key rather than whether the documentation says it should.
 */
/*
 * One place to see every revenue line and what each is waiting on.
 *
 * The owner works from a phone and cannot read the source, and has been told
 * "it is ready, just set the variable" for five separate features. That claim
 * was unverifiable until now, which is the same shape as the "wired to
 * nothing" bug this repo has shipped three times.
 *
 * Reports booleans only, never the configured values.
 */
app.get('/api/revenue/readiness', (_req, res) => res.json(revenueReadiness()));

app.get('/api/xchain/status', (_req, res) => res.json(crossChainStatus()));

app.get('/api/xchain/probe', async (_req, res) => {
  const r = await crossChainProbe();
  return res.status(r.status).json(r.body);
});

app.get('/api/xchain/quotes', async (req, res) => {
  const r = await crossChainQuotes(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/* -------------------------------- support --------------------------------- */
/*
 * "Ask the AI" in Help.
 *
 * The client matches its local FAQ first and only calls this when the local
 * matcher is not confident, so the common questions never reach a model at
 * all — a hand-written answer about our own fee structure is strictly better
 * than a generated one, and free.
 *
 * `context` is the FAQ text the client already matched. The prompt in ai.js
 * forbids answering beyond it, which is what stops a model inventing a fee.
 */
app.post('/api/ai/ask', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });

  const { question, context, lang } = req.body ?? {};
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'EMPTY_QUESTION' });
  }

  try {
    const out = await answerSupportQuestion({
      question,
      context: Array.isArray(context) ? context : [],
      lang: typeof lang === 'string' ? lang.slice(0, 5) : 'fa'
    });
    return res.json(out);
  } catch (err) {
    const msg = String(err.message || '');
    // 503 not 500: the feature is unavailable, not broken. The client shows
    // the local FAQ instead of an error.
    const status = msg.includes('NOT_CONFIGURED') ? 503 : 502;
    return res.status(status).json({ error: 'AI_FAILED', detail: msg.slice(0, 200) });
  }
});

/* ------------------------------ order watch -------------------------------- */
/*
 * Server-side price watching for limit orders, so an alert arrives with the
 * app closed.
 *
 * PRIVACY: the payload carries no wallet address and no amount — see
 * server/watch.js. A watch list is a behavioural profile, and the less of one
 * we hold the less there is to leak. The server needs neither field to decide
 * whether a price was hit.
 *
 * This can never execute a swap. There is no signer, allowance or router in
 * this path by design.
 */
app.post('/api/orders/watch', async (req, res) => {
  const { endpoint, items, lang } = req.body ?? {};
  try {
    const out = await putWatches(endpoint, items, lang);
    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message).slice(0, 80) });
  }
});

app.post('/api/orders/unwatch', async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'BAD_ENDPOINT' });
  return res.json({ ok: true, ...(await clearWatches(endpoint)) });
});

/** Run one watch cycle. Cron-driven, guarded by the same secret. */
app.get('/api/cron/watch', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const { sendToEndpoint } = await import('./push.js');
  const { fcmSendToToken } = await import('./fcm.js');
  const { parseIdentity } = await import('./watch.js');

  const out = await runWatchCycle(async (endpoint, lang, payload) => {
    /*
     * Route by transport. A packaged Android user has an fcm: identity and no
     * web-push endpoint at all, so sending everything through web push made
     * order alerts silently web-only.
     */
    const id = parseIdentity(endpoint);
    if (!id) return false;

    const message = {
      title: ORDER_ALERT[lang]?.title ?? ORDER_ALERT.en.title,
      body: (ORDER_ALERT[lang]?.body ?? ORDER_ALERT.en.body)
        .replace('{base}', payload.base)
        .replace('{quote}', payload.quote)
        .replace('{rate}', String(payload.rate)),
      url: '/#/orders',
      tag: `fbt-order-${payload.id}`
    };

    return id.kind === 'fcm' ? fcmSendToToken(id.value, message) : sendToEndpoint(id.value, message);
  });
  return res.json(out);
});

/** How many watches are registered, for debugging a silent cron. */
app.get('/api/orders/watch/status', async (_req, res) => {
  const rows = await readWatches().catch(() => []);
  res.json({ watches: rows.length, cronSecretSet: Boolean(process.env.CRON_SECRET) });
});

/*
 * Alert copy lives here rather than in promos.js: this is transactional, not
 * promotional, and it must render in the OS shade without the app translating
 * it. Falls back to English for the nine partial locales rather than shipping
 * a machine translation of a message about someone's money.
 */
const ORDER_ALERT = {
  en: { title: 'Your order is ready', body: '1 {base} reached {rate} {quote}. Open the app to swap.' },
  fa: { title: 'سفارشت آماده است', body: '۱ {base} به {rate} {quote} رسید. برای سواپ اپ را باز کن.' },
  ar: { title: 'أمرك جاهز', body: '1 {base} وصل إلى {rate} {quote}. افتح التطبيق للتبادل.' }
};

/* --------------------------------- NFTs ----------------------------------- */
/*
 * Read-only viewer. Nothing here can move an asset — it is a GET against an
 * indexer, so the worst case is a stale or empty list.
 *
 * Cached for 5 minutes per address: NFT holdings change far less often than
 * prices, and an uncached endpoint would burn the free indexer quota every
 * time someone re-opened the tab.
 */
app.get('/api/nft/chains', (_req, res) =>
  res.json({ configured: nftConfigured(), chains: nftChains() })
);

/*
 * Why is the NFT key still rejected?
 *
 * `configured: true` above only proves the variable is SET, which is why
 * replacing the key and still seeing NFT_KEY_REJECTED gave no way forward.
 * This makes one real request to Alchemy and reports the status code plus a
 * 4+4 character fingerprint of the key — enough to tell whether a redeploy
 * actually picked up the new value, and never enough to use the key.
 */
app.get('/api/nft/diagnose', async (req, res) => {
  const chainId = Number(req.query.chainId) || 1;
  res.json(await nftDiagnose(chainId));
});

app.get('/api/nft/:chainId/:owner', (req, res) => {
  if (!nftConfigured()) return res.status(503).json({ error: 'NFT_NOT_CONFIGURED' });

  const { chainId, owner } = req.params;
  // Validate before it reaches the cache key, so a malformed address cannot
  // poison the cache with an error response.
  if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    return res.status(400).json({ error: 'BAD_ADDRESS' });
  }
  if (!nftChains().includes(Number(chainId))) {
    return res.status(400).json({ error: 'CHAIN_NOT_SUPPORTED', chains: nftChains() });
  }

  /*
   * Not `serve()` here.
   *
   * serve() wraps every throw as {error:'UPSTREAM_FAILED', detail:<message>},
   * which is right for market data but wrong here: fetchNfts raises specific,
   * actionable codes (NFT_KEY_REJECTED, NFT_RATE_LIMITED) and serve() buried
   * them under a generic failure that rendered as "something went wrong".
   *
   * It also leaked the raw upstream message into `detail` — and for Alchemy
   * the API key sits in the URL path, so an error string could carry it to
   * the browser. Fixed codes only.
   */
  const key = `nft:${chainId}:${owner.toLowerCase()}`;
  return withCache(key, 300000, () => fetchNfts(chainId, owner))
    .then(({ value }) => {
      res.set('cache-control', 'public, max-age=300');
      res.json(value);
    })
    .catch((err) => {
      const code = String(err?.message || 'FAILED');
      const known = [
        'NFT_KEY_REJECTED',
        'NFT_RATE_LIMITED',
        'NFT_UPSTREAM_DOWN',
        'NFT_NOT_CONFIGURED',
        'CHAIN_NOT_SUPPORTED',
        'BAD_ADDRESS'
      ];
      res.status(502).json({ error: known.includes(code) ? code : 'FAILED' });
    });
});

/* ----------------------------- points (was: leaderboard) ------------------ */
/*
 * ─── THE PUBLIC SCORE BOARD IS GONE, AND SO IS ITS ENDPOINT ─────────────────
 * The ranking screen was replaced by a private "your points" screen on the
 * owner's instruction: «تبدیلش کن به امتیاز تو و برترین ها نباشه [...] فقط
 * امتیاز همون فرد».
 *
 * GET and POST /api/leaderboard are REMOVED rather than left running with no
 * caller, for a reason that is worth stating: the POST accepted a display
 * name, a score and a referral count from any client and stored them in a
 * bucket that GET served to the whole world. That was a fair trade when the
 * point was a public ranking. With the ranking gone it is collection with no
 * purpose — and the new screen tells the user in three languages that their
 * score is not published anywhere. Leaving a live write endpoint behind would
 * make that sentence false, which is worse than the original design.
 *
 * Points now live only in the browser's own persisted store on the device that
 * earned them. Nothing is uploaded, so nothing can leak.
 *
 * The stored rows are deliberately NOT read or migrated anywhere: they are
 * self-reported numbers with display names attached, and the honest end for
 * them is to stop being served.
 */

/* -------------------------------- push ------------------------------------ */
/*
 * These routes were MISSING. `addSubscription`, `sendDailyPromo` and
 * pushConfigured were all imported at the top of this file but never mounted,
 * so the client's POST /api/push/subscribe always 404'd and no device was ever
 * registered. Notifications could not have worked no matter how the VAPID keys
 * were configured — which is exactly the reported symptom.
 */

/** Constant-time compare so the secret cannot be recovered by timing. */
function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const provided =
    req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-cron-secret') || '';
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Register a browser/PWA push subscription (VAPID). */
app.post('/api/push/subscribe', async (req, res) => {
  const { subscription, lang } = req.body ?? {};
  try {
    const out = await addSubscription(subscription, lang || 'fa');
    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message).slice(0, 120) });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ ok: false, error: 'NO_ENDPOINT' });
  return res.json({ ok: true, ...(await removeSubscription(endpoint)) });
});

/*
 * Register a native Android (FCM) token.
 *
 * A Capacitor WebView has no Push API at all, so an APK user can never receive
 * VAPID web push. FCM is the only channel that reaches them.
 */
app.post('/api/push/fcm', async (req, res) => {
  const { token, lang } = req.body ?? {};
  try {
    const out = await addFcmToken(token, lang || 'fa');
    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message).slice(0, 120) });
  }
});

/*
 * "Can the server actually push to me?"
 *
 * src/lib/notify.js has always called GET /api/push/status to decide between
 * 'server' and 'local' notification mode. The route did not exist, so the
 * fetch returned 404 → `data?.configured` was undefined → every WEB user was
 * pinned to 'local' (device-only) notifications, even with VAPID configured.
 * Native Android is unaffected because it short-circuits to 'server' earlier.
 *
 * This deliberately reports only booleans and counts, never key values.
 */
app.get('/api/push/status', async (_req, res) => {
  const webReady = pushConfigured();
  const fcmReady = fcmConfigured();
  res.json({
    /*
     * `configured` is what notify.js reads to choose 'server' over 'local'.
     *
     * It reports the WEB channel only, and deliberately so. This route is
     * reached from a browser or PWA, and a browser can only ever be delivered
     * to over VAPID — native Android never gets here, because pushMode()
     * short-circuits to 'server' before making this call. Reporting
     * `web || fcm` would tell a browser "the server can reach you" on the
     * strength of a channel that physically cannot, which is how the app ends
     * up promising notifications it will never deliver.
     */
    configured: webReady,
    web: webReady,
    fcm: fcmReady,
    subscribers: await readSubscriptionsSafe(),
    devices: await readFcmTokensSafe(),
    /*
     * Enough detail to fix a failed key rotation from a phone. `fcm: false`
     * alone has three possible causes with three different fixes; this names
     * which one. No secret is echoed — see fcmDiagnose().
     */
    fcmDetail: fcmDiagnose()
  });
});

app.post('/api/push/fcm/remove', async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) return res.status(400).json({ ok: false, error: 'NO_TOKEN' });
  return res.json({ ok: true, ...(await removeFcmToken(token)) });
});

/**
 * Say exactly what is blocking a send.
 *
 * Push has many independent ways to be silently off — missing keys, zero
 * subscribers, no cron secret. Reporting which one it is turns a
 * half-hour of guessing into a glance. Never returns key VALUES.
 */
app.get('/api/cron/status', async (_req, res) => {
  const [subs, fcm] = await Promise.all([readSubscriptionsSafe(), readFcmTokensSafe()]);
  const webReady = pushConfigured();
  const fcmReady = fcmConfigured();
  res.json({
    web: {
      configured: webReady,
      subscribers: subs,
      missing: webReady ? [] : ['VITE_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter(
        (k) => !process.env[k] && !(k === 'VITE_VAPID_PUBLIC_KEY' && process.env.VAPID_PUBLIC_KEY)
      )
    },
    fcm: {
      configured: fcmReady,
      devices: fcm,
      missing: fcmReady ? [] : ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'].filter(
        (k) => !process.env[k]
      ),
      /*
       * "not configured, but nothing missing" was a dead end.
       *
       * fcmConfigured() needs all three vars AND the key to actually contain
       * a PEM header. So a set-but-malformed FIREBASE_PRIVATE_KEY produced
       * `configured:false` with `missing:[]` — the report said everything was
       * present and still refused to work, which is the least actionable
       * output this endpoint could give.
       *
       * The overwhelmingly likely cause is pasting `private_key_id` (a short
       * hex string that sits directly above the real key in the JSON) instead
       * of `private_key`. Say so, without ever echoing the value.
       */
      problem: (() => {
        if (fcmReady) return null;
        const raw = process.env.FIREBASE_PRIVATE_KEY || '';
        if (!raw) return null; // genuinely absent — `missing` already says so
        if (!raw.replace(/\\n/g, '\n').includes('BEGIN PRIVATE KEY')) {
          return `FIREBASE_PRIVATE_KEY is set (${raw.length} chars) but has no "-----BEGIN PRIVATE KEY-----" header. You have most likely pasted private_key_id instead of private_key — they sit next to each other in the service-account JSON. Paste the whole private_key value, keeping its \\n sequences exactly as they are.`;
        }
        return null;
      })()
    },
    cronSecretSet: Boolean(process.env.CRON_SECRET),
    durableStorage: storeDurable(),
    canSend: (webReady && subs > 0) || (fcmReady && fcm > 0)
  });
});

async function readSubscriptionsSafe() {
  try {
    const { readSubscriptions } = await import('./store.js');
    return (await readSubscriptions()).length;
  } catch {
    return 0;
  }
}
async function readFcmTokensSafe() {
  try {
    return (await readFcmTokens()).length;
  } catch {
    return 0;
  }
}

/** Daily broadcast. Fans out to BOTH channels; each is independent. */
/*
 * WHY THE PRICE WATCH RUNS FROM HERE INSTEAD OF ITS OWN SCHEDULE.
 *
 * This used to be a second cron entry in vercel.json running every 15
 * minutes. That broke every deployment: Hobby allows at most 2 cron jobs and
 * only ONE INVOCATION PER DAY each, so 96/day is rejected. The project still
 * builds and then refuses to run, which is far more confusing than a build
 * error - the deploy list simply stops receiving new entries, which looks
 * exactly like a disconnected Git integration.
 *
 * So the watch cycle is folded into the daily job. Be honest about the cost:
 * a limit order is now checked ONCE A DAY, not every 15 minutes. That is a
 * real downgrade, and it is why orders.js must keep describing these as
 * alerts rather than fills. The alternative - a paid plan - is not worth
 * buying before the app has users.
 *
 * runWatchCycle sits in the same Promise.allSettled as the two sends: one
 * failing channel must not cancel the others.
 */
app.get('/api/cron/daily', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const [web, fcm, watch] = await Promise.allSettled([
    sendDailyPromo(),
    sendDailyFcm(),
    runWatchCycle()
  ]);
  res.json({
    web: web.status === 'fulfilled' ? web.value : { error: String(web.reason).slice(0, 120) },
    fcm: fcm.status === 'fulfilled' ? fcm.value : { error: String(fcm.reason).slice(0, 120) },
    watch: watch.status === 'fulfilled' ? watch.value : { error: String(watch.reason).slice(0, 120) }
  });
});

/** The FCM half of the daily promo, reusing push.js's copy deck. */
async function sendDailyFcm() {
  if (!fcmConfigured()) return { sent: 0, skipped: 'NOT_CONFIGURED' };
  const { promoForToday } = await import('./push.js');
  const { PROMOS } = await import('./promos.js');
  const key = promoForToday();
  return fcmBroadcast(
    (lang) => {
      const [title, body] = PROMOS[key][lang] ?? PROMOS[key].en;
      return { title, body, url: '/' };
    },
    { tag: 'fbt-daily' }
  );
}

/* ----------------------------- static frontend ---------------------------- */

const distDir = path.join(__dirname, '..', 'dist');

/*
 * ─── WHY THE CACHE LIFETIME DEPENDS ON THE FILENAME ─────────────────────────
 * This was a flat `maxAge: '1h'` for everything, and it was the main reason
 * the site felt slow on a second visit: a returning user re-downloaded the
 * entire ~770 KB first-paint payload — the entry bundle, React, framer-motion,
 * the stylesheet and the 109 KB Persian font — every hour, forever.
 *
 * Reported directly: «سرعت لود سایت خیلی کم شده و طول میکشه بیاد».
 *
 * The fix is not one number, because these files have genuinely different
 * lifetimes:
 *
 *   /assets/*  — Vite writes a CONTENT HASH into every filename
 *                (index-y4UH__tA.js). The URL changes whenever the bytes
 *                change, so a stale file can never be served: a new build
 *                produces new URLs and the old ones are never requested
 *                again. A year plus `immutable` is exactly correct here, and
 *                `immutable` additionally stops the browser sending a
 *                revalidation request at all.
 *
 *   /fonts/*   — not hashed, but replaced by editing index.html to point
 *                elsewhere rather than by swapping bytes under the same name.
 *
 *   index.html — MUST be revalidated every time. It is the one file naming
 *                the current hashed asset URLs, so caching it pins a
 *                returning visitor to the previous deploy's JavaScript. That
 *                is how somebody stays on an old build for hours after a fix
 *                ships, which is worse than a slow load. Handled by the SPA
 *                fallback below, and `index: false` here makes sure this
 *                middleware never serves it.
 *
 * Vercel serves /assets and /fonts from its edge using the headers in
 * vercel.json and never reaches this code. This matters for the APK, which
 * bundles the server, and for anyone self-hosting — the two paths must agree
 * or the app behaves differently depending on where it runs.
 */
app.use(
  express.static(distDir, {
    index: false,
    setHeaders(res, filePath) {
      if (/[\\/](assets|fonts)[\\/]/.test(filePath)) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        return;
      }
      /*
       * Icons and the manifest are unhashed AND do get replaced in place when
       * the branding changes, so a year would strand a stale icon on a home
       * screen with no way to force a refresh. A week is effectively free on
       * repeat visits and still lets a fix propagate.
       */
      res.setHeader('cache-control', 'public, max-age=604800');
    }
  })
);

// SPA fallback. Written as bare middleware because Express 5's router no
// longer accepts a plain '*' path pattern.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'NOT_FOUND' });
  /*
   * Never cached, and this is the counterpart to the year-long asset cache
   * above rather than an inconsistency with it. index.html is the only file
   * that names the current hashed asset URLs; caching it would pin a
   * returning visitor to the previous deploy's JavaScript while the assets it
   * points at are cached for a year. The revalidation costs a few hundred
   * bytes and usually answers 304.
   */
  res.setHeader('cache-control', 'public, max-age=0, must-revalidate');
  return res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'NOT_BUILT', hint: 'run `npm run build` first' });
  });
});

export default app;
