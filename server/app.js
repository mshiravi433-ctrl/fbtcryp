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
import { timingSafeEqual } from 'node:crypto';
import { pushConfigured, sendDailyPromo } from './push.js';
import {
  addSubscription,
  readLeaderboard,
  removeSubscription,
  storeDurable,
  submitScore
} from './store.js';
import { aiConfigured, aiSelfTest, generateMarketBrief, generateOutlook, newsConfigured } from './ai.js';

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
  const provided =
    req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-cron-secret') || '';

  if (secret && provided !== secret) {
    return res.json({
      ok: aiConfigured(),
      note: 'Add ?Authorization: Bearer <CRON_SECRET> for a live provider test.',
      geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
      openrouterKeyPresent: Boolean(process.env.OPENROUTER_API_KEY),
      enabled: aiConfigured()
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
