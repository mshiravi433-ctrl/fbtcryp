/**
 * Local development / self-hosted server.
 *
 * Takes the shared Express app (server/app.js) and adds the two things a
 * long-running process can do that a serverless function cannot: serve the
 * built frontend, and hold the Telegram bot's polling connection open.
 *
 * On Vercel, api/index.js imports the same app without these.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import app from './app.js';
import { startBot } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || '';

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

/* --------------------------------- boot ---------------------------------- */

app.listen(PORT, () => {
  console.log(`▸ API + app listening on http://localhost:${PORT}`);
  if (!process.env.COINGECKO_API_KEY) console.log('  (no COINGECKO_API_KEY — using the public rate limit)');
  if (!process.env.OPENROUTER_API_KEY) console.log('  (no OPENROUTER_API_KEY — AI features disabled)');
  if (BOT_TOKEN) {
    startBot({ token: BOT_TOKEN, webAppUrl: WEBAPP_URL }).catch((e) => console.error('bot failed:', e.message));
  } else {
    console.log('  (no TELEGRAM_BOT_TOKEN — bot disabled, API only)');
  }
});
