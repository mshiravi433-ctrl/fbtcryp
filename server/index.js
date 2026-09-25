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
import './intentSandboxOps.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import app from './app.js';
import { normalizeBotToken } from './telegramAuth.js';
import { getFleetSummary } from './aiGateway.js';
import { startBot } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
// Explicitly bind every local/self-hosted instance to all interfaces. This is
// required for an HTTPS tunnel or the Arena live preview to reach the app; the
// browser still uses relative /api URLs and never calls localhost itself.
const HOST = process.env.HOST || '0.0.0.0';
// Same normalization as server/app.js: env stores smuggle newlines, quotes
// and zero-width characters into secrets, and local polling must use the
// exact same token bytes the API verifies initData against.
const BOT_TOKEN = normalizeBotToken(process.env.TELEGRAM_BOT_TOKEN);
const WEBAPP_URL = process.env.WEBAPP_URL || '';

/* ----------------------------- static frontend ---------------------------- */

const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir, {
  index: false,
  setHeaders(res, filePath) {
    // Hashed assets and fonts are immutable; everything else must revalidate.
    if (filePath.includes(`${path.sep}assets${path.sep}`) || filePath.includes('/assets/') || filePath.endsWith('.woff2') || filePath.endsWith('.woff')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// SPA fallback. Written as bare middleware because Express 5's router no
// longer accepts a plain '*' path pattern.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'NOT_FOUND' });
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  return res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'NOT_BUILT', hint: 'run `npm run build` first' });
  });
});

/* --------------------------------- boot ---------------------------------- */

app.listen(PORT, HOST, () => {
  console.log(`▸ API + app listening on http://${HOST}:${PORT}`);
  if (!process.env.COINGECKO_API_KEY) console.log('  (no COINGECKO_API_KEY — using the public rate limit)');
  /*
   * The AI boot line used to test ONE variable and print «AI features disabled»
   * when it was missing. On the deployment that prompted this fix, all nine keys
   * were present, eight providers were refusing every call, and the log said
   * nothing — which is why the outage was invisible from the Vercel console.
   * Print the fleet instead: how many keys exist, which brain is serving right
   * now, and if a provider already failed its last real call, why.
   */
  try {
    const fleet = getFleetSummary();
    if (!fleet.configured) {
      console.log('  (no AI provider keys — every answer comes from the internal rule engine)');
    } else {
      console.log(`  ▸ AI fleet: ${fleet.configured} provider key(s) present — serving from ${fleet.servingFrom.join(', ')}`);
      if (fleet.failing) {
        console.log(`    ⚠ ${fleet.failing} failed their last real call: ${fleet.failingIds.map((f) => `${f.id}(${f.reason || f.verdict})`).join(', ')}`);
        console.log('      fix per provider: /api/ai/diagnose?key=<CRON_SECRET>');
      } else if (fleet.untested === fleet.configured) {
        console.log('    (no provider has answered a real call yet — /api/v1/ai/gateway/health will know after the first request)');
      }
    }
  } catch (e) {
    console.log(`  (AI fleet summary unavailable: ${e.message})`);
  }
  if (BOT_TOKEN) {
    startBot({ token: BOT_TOKEN, webAppUrl: WEBAPP_URL }).catch((e) => console.error('bot failed:', e.message));
  } else {
    console.log('  (no TELEGRAM_BOT_TOKEN — bot disabled, API only)');
  }
});
