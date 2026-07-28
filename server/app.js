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
import { pushConfigured, sendDailyPromo } from './push.js';
import {
  addSubscription,
  readLeaderboard,
  removeSubscription,
  storeDurable,
  submitScore
} from './store.js';
import { aiConfigured, answerFaq, generateMarketBrief, generateOutlook, newsConfigured } from './ai.js';

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

app.post('/api/ai/faq', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
  const { question, lang } = req.body ?? {};
  if (!question || String(question).trim().length < 3) return res.status(400).json({ error: 'BAD_REQUEST' });

  const key = `ai:faq:${lang || 'en'}:${String(question).trim().toLowerCase().slice(0, 120)}`;
  try {
    const { value, cached, tier } = await withPersistentCache(
      key,
      24 * 3600_000,
      () => answerFaq({ question, lang }),
      memoryStore
    );
    res.set('x-cache', cached ? `HIT:${tier}` : 'MISS');
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'AI_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/* ------------------------------- news ------------------------------------ */
/* One upstream sweep per 24h, shared by every user.                          */

app.get('/api/news', (_req, res) =>
  // 24h TTL matches the product promise ("new headlines every day") and keeps
  // us far inside every publisher's fair-use expectations.
  serve(res, 24 * 3600_000)(fetchNews, 'news:v1')
);

/* ---------------------------- coin lookup -------------------------------- */
/* The client falls back to public CoinGecko, but going through here means the
 * key (if configured) is used and the response is cached for everyone.       */

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return res.json([]);
  return serve(res, 300_000)(() => fetchSearch(q), `search:${q.toLowerCase()}`);
});

/* ---------------------------- leaderboard -------------------------------- */

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const rows = await readLeaderboard();
    // `durable` tells the client whether this is a real global board or a
    // per-instance one that a cold start will wipe. The UI labels it either
    // way rather than implying a global ranking that isn't there.
    res.json({ rows, durable: storeDurable(), at: Date.now() });
  } catch (err) {
    res.status(502).json({ error: 'LEADERBOARD_FAILED', detail: String(err.message).slice(0, 160) });
  }
});

app.post('/api/leaderboard', async (req, res) => {
  const { name, points, swaps, referrals, clientId } = req.body ?? {};
  // A verified Telegram id is preferred; an anonymous client id is accepted
  // but recorded as unverified, because anyone can POST a score.
  const tgId = req.tgUser?.id;
  const id = tgId ? `tg:${tgId}` : clientId ? `anon:${String(clientId).slice(0, 40)}` : null;
  if (!id) return res.status(400).json({ error: 'NO_IDENTITY' });

  try {
    const result = await submitScore({
      id,
      name: name ?? req.tgUser?.first_name,
      points,
      swaps,
      referrals,
      verified: Boolean(tgId)
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: String(err.message).slice(0, 80) });
  }
});

/* ------------------------------- push ------------------------------------ */

/** Lets the client state plainly whether push is real here or local-only. */
app.get('/api/push/status', (_req, res) =>
  res.json({ configured: pushConfigured(), durable: storeDurable() })
);

/**
 * Daily promotional broadcast.
 *
 * Intended for a scheduler (Vercel Cron, GitHub Actions, or plain cron) once
 * per day. Protected by a shared secret rather than left open: an unprotected
 * endpoint that notifies every user is a button anyone on the internet can
 * press repeatedly, and the punishment for spamming is the user revoking
 * notification permission — after which we cannot reach them for the things
 * that matter either.
 */
app.post('/api/push/daily', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET_NOT_SET' });

  const provided =
    req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-cron-secret') || '';
  if (provided !== secret) return res.status(401).json({ error: 'UNAUTHORIZED' });

  try {
    return res.json(await sendDailyPromo());
  } catch (err) {
    return res.status(500).json({ error: 'SEND_FAILED', detail: String(err.message).slice(0, 160) });
  }
});

app.post('/api/push/subscribe', async (req, res) => {
  const { subscription, lang } = req.body ?? {};
  try {
    return res.json(await addSubscription(subscription, lang));
  } catch (err) {
    return res.status(400).json({ error: String(err.message).slice(0, 80) });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: 'NO_ENDPOINT' });
  return res.json(await removeSubscription(endpoint));
});

app.get('/api/dex/:network', (req, res) =>
  serve(res, 60000)(() => fetchDexPools(req.params.network), `dex:${req.params.network}`)
);

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
