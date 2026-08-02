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
  fetchDexPools,
  fetchGlobal,
  fetchMarkets,
  fetchSearch,
  fetchSimplePrices,
  fetchTrending,
} from './providers.js';
import { telegramAuth } from './telegramAuth.js';
import { fetchNews } from './news.js';
import { jupiterConfigured, referralAccount, solanaExecute, solanaOrder } from './solana.js';
import { timingSafeEqual } from 'node:crypto';
import { pushConfigured, sendDailyPromo } from './push.js';
import { fcmBroadcast, fcmConfigured } from './fcm.js';
import { fetchNfts, nftChains, nftConfigured, nftDiagnose } from './nft.js';
import { clearWatches, putWatches, readWatches, runWatchCycle } from './watch.js';
import {
  addFcmToken,
  addSubscription,
  readFcmTokens,
  readLeaderboard,
  removeFcmToken,
  removeSubscription,
  storeDurable,
  submitScore
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

app.get('/api/dex/:network', (req, res) =>
  serve(res, 60000)(() => fetchDexPools(req.params.network), `dex:${req.params.network}`)
);

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

/* ----------------------------- leaderboard -------------------------------- */
/*
 * These were MISSING too. `readLeaderboard` and `submitScore` were imported at
 * the top of this file but never mounted, so GET /api/leaderboard always 404'd
 * and the client's catch-all turned that into "could not reach the server" —
 * a message that pointed at the network when the route simply did not exist.
 */

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const rows = await readLeaderboard();
    res.json({ rows, durable: storeDurable(), at: Date.now() });
  } catch (e) {
    res.status(500).json({ error: 'READ_FAILED', detail: String(e.message).slice(0, 120) });
  }
});

app.post('/api/leaderboard', async (req, res) => {
  const { name, points, swaps, referrals, clientId } = req.body ?? {};

  /*
   * Identity: prefer the Telegram id, which telegramAuth has already verified
   * against the bot token's HMAC. Fall back to the client-generated id, but
   * flag the row as unverified — anyone can POST a number to a public
   * endpoint, and a board that hides which rows are self-reported is just a
   * lie with a ranking on it.
   */
  const tgId = req.tgUser?.id;
  const id = tgId ? `tg:${tgId}` : (typeof clientId === 'string' && clientId.slice(0, 64));
  if (!id) return res.status(400).json({ error: 'NO_ID' });

  try {
    const out = await submitScore({
      id,
      name,
      points,
      swaps,
      referrals,
      verified: Boolean(tgId)
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ error: String(e.message).slice(0, 120) });
  }
});

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
    devices: await readFcmTokensSafe()
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
app.use(express.static(distDir, { maxAge: '1h', index: false }));

// SPA fallback. Written as bare middleware because Express 5's router no
// longer accepts a plain '*' path pattern.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'NOT_FOUND' });
  return res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'NOT_BUILT', hint: 'run `npm run build` first' });
  });
});

export default app;
