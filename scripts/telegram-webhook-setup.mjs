#!/usr/bin/env node
/**
 * REGISTER THE BOT'S WEBHOOK — the step that actually puts the bot live.
 * ---------------------------------------------------------------------------
 * Deploying the code is not enough. Telegram does not know where to deliver
 * updates until someone calls setWebhook, and until then the bot is silent no
 * matter how correct the handlers are. That was the real state of this project:
 * server/bot.js was complete and tested, and nothing in production ever ran it,
 * because Vercel runs api/index.js (no long-polling process) and no webhook was
 * ever registered.
 *
 * This script does the three things that make it live, and nothing else:
 *
 *   1. setWebhook with a SECRET TOKEN, so a public URL cannot be driven by
 *      anyone but Telegram;
 *   2. setMyCommands, so the menu in the chat matches the handlers that exist;
 *   3. getWebhookInfo, printed back, so you SEE the result instead of trusting
 *      a green checkmark.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=...  \
 *   TELEGRAM_WEBHOOK_SECRET=... \
 *   WEBAPP_URL=https://fbtswap.ir \
 *   node scripts/telegram-webhook-setup.mjs
 *
 *   node scripts/telegram-webhook-setup.mjs --status   (inspect, change nothing)
 *   node scripts/telegram-webhook-setup.mjs --delete   (turn the webhook off)
 *
 * ─── ON THE SECRET ──────────────────────────────────────────────────────────
 * TELEGRAM_WEBHOOK_SECRET must be the SAME value here and in the server's
 * environment. Telegram echoes it back on every delivery and the route rejects
 * anything that does not match, so a mismatch is a bot that receives updates
 * and refuses all of them — which looks exactly like a bot that is down. The
 * script prints a generated value if you have not chosen one, and never prints
 * the bot token.
 *
 * ─── WHY POLLING AND WEBHOOK MUST NOT BOTH RUN ──────────────────────────────
 * Telegram allows exactly one delivery method per bot. Calling setWebhook
 * silently stops getUpdates, so a local `npm start` will no longer receive
 * anything while the webhook is registered — and if it did, both would answer
 * the same message twice. Use --delete before developing against polling.
 */

import { randomBytes } from 'node:crypto';

const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const WEBAPP_URL = String(process.env.WEBAPP_URL || process.env.VITE_PUBLIC_URL || '').trim();

const args = new Set(process.argv.slice(2));
const wantStatus = args.has('--status');
const wantDelete = args.has('--delete');

const die = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

if (!TOKEN) die('TELEGRAM_BOT_TOKEN is not set. Get it from @BotFather → /mybots → API Token.');
if (!/^\d{5,20}:[A-Za-z0-9_-]{30,}$/.test(TOKEN)) {
  die('TELEGRAM_BOT_TOKEN does not look like a bot token (expected 1234567890:AA...).');
}

/** Call the Bot API. The token appears only in the URL of this one request. */
async function api(method, payload) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    /* api.telegram.org is blocked on many Iranian networks and inside some CI
       sandboxes. A raw ECONNRESET stack reads like a bug in this script; it is
       not, and the fix is a different network, not a code change. */
    die(
      `Cannot reach api.telegram.org (${err?.cause?.code ?? err?.name ?? 'network error'}).\n\n` +
        '  This machine has no route to Telegram. Run this script from a network\n' +
        '  that can reach it, or from GitHub Actions, which can.'
    );
  }
  const json = await response.json().catch(() => null);
  if (!json?.ok) {
    /* Telegram's description is the actionable part ("wrong URL host",
       "HTTPS required"). Surface it verbatim rather than a generic failure. */
    throw new Error(`${method} failed: ${json?.description ?? `HTTP ${response.status}`}`);
  }
  return json.result;
}

const printInfo = (info) => {
  console.log('\n── Telegram webhook status ─────────────────────────');
  console.log(`  url                  ${info.url || '(none — the bot is NOT receiving updates)'}`);
  console.log(`  pending updates      ${info.pending_update_count ?? 0}`);
  console.log(`  max connections      ${info.max_connections ?? '(default)'}`);
  console.log(`  allowed updates      ${(info.allowed_updates ?? ['(all)']).join(', ')}`);
  console.log(`  secret token set     ${info.has_custom_certificate ? '(custom cert)' : ''}`);
  if (info.last_error_message) {
    /* The single most useful line when "I deployed and it is still silent". */
    console.log(`  ⚠ last error         ${info.last_error_message}`);
    console.log(`    at                 ${new Date((info.last_error_date ?? 0) * 1000).toISOString()}`);
  } else {
    console.log('  last error           none');
  }
  console.log('────────────────────────────────────────────────────\n');
};

/*
 * Validate everything local BEFORE touching the network.
 *
 * The earlier order called getMe first, so a missing WEBAPP_URL surfaced as a
 * connection stack trace on a blocked network — the one message that tells you
 * nothing about the actual mistake. Configuration errors are now reported
 * offline, instantly, and only a correctly configured run makes a request.
 */
let origin = '';
if (!wantStatus && !wantDelete) {
  if (!WEBAPP_URL) die('WEBAPP_URL is not set (e.g. https://fbtswap.ir). The webhook URL is derived from it.');
  try {
    origin = new URL(WEBAPP_URL).origin;
  } catch {
    die(`WEBAPP_URL is not a valid URL: ${WEBAPP_URL}`);
  }
  if (!origin.startsWith('https://')) die('Telegram only delivers webhooks over HTTPS.');
}

if (!wantStatus && !wantDelete && !SECRET) {
  const suggestion = randomBytes(32).toString('base64url');
  die(
    'TELEGRAM_WEBHOOK_SECRET is not set.\n\n' +
      '  Without it the webhook route stays closed (503) by design — a public\n' +
      '  bot endpoint with no proof of origin can be driven by anyone.\n\n' +
      `  Generated one for you:\n\n    ${suggestion}\n\n` +
      '  Put that SAME value in the server environment (Vercel → Settings →\n' +
      '  Environment Variables → TELEGRAM_WEBHOOK_SECRET), redeploy, then run\n' +
      '  this script again with it exported.'
  );
}
/* Telegram's own constraint; a longer or odd-charactered secret is rejected
   by setWebhook with a description that is easy to misread as a URL problem. */
if (!wantStatus && !wantDelete && !/^[A-Za-z0-9_-]{1,256}$/.test(SECRET)) {
  die('TELEGRAM_WEBHOOK_SECRET may contain only A-Z a-z 0-9 _ - and be at most 256 characters.');
}

/* ---- from here on, the configuration is valid and we may talk to Telegram --- */

const me = await api('getMe');
console.log(`\n▸ Bot: @${me.username} (id ${me.id})`);

if (wantStatus) {
  printInfo(await api('getWebhookInfo'));
  process.exit(0);
}

if (wantDelete) {
  /* drop_pending_updates: a queue that built up while the webhook was broken
     would otherwise be replayed all at once the moment polling starts. */
  await api('deleteWebhook', { drop_pending_updates: true });
  console.log('▸ Webhook removed. Long polling (npm start) can receive updates again.');
  printInfo(await api('getWebhookInfo'));
  process.exit(0);
}

const webhookUrl = `${origin}/api/telegram/webhook`;

console.log(`▸ Registering webhook: ${webhookUrl}`);
await api('setWebhook', {
  url: webhookUrl,
  secret_token: SECRET,
  /*
   * Ask only for what the handlers use. Telegram will not send anything else,
   * which keeps invocation count (and cost) down and means an update type we
   * do not handle cannot wake the function at all.
   */
  allowed_updates: ['message', 'callback_query', 'inline_query'],
  /* Anything queued from before this deploy is stale — a /price from an hour
     ago answered now is worse than not answered. */
  drop_pending_updates: true
});

console.log('▸ Publishing the command menu…');
const { BOT_COMMANDS } = await import('../server/bot.js');
await api('setMyCommands', { commands: BOT_COMMANDS });
console.log(`  ${BOT_COMMANDS.length} commands published: ${BOT_COMMANDS.map((c) => `/${c.command}`).join(' ')}`);

const info = await api('getWebhookInfo');
printInfo(info);

if (info.url !== webhookUrl) {
  die(`Telegram reports a different URL than we set (${info.url}). Something else is managing this bot.`);
}

console.log('✓ The bot is live. Open the chat and send /help.\n');
console.log('  If it stays silent, the cause is almost always one of:');
console.log('   · TELEGRAM_WEBHOOK_SECRET differs between here and the server → every update is rejected 401');
console.log('   · the deploy has not finished, so /api/telegram/webhook is still 404');
console.log(`   · check: curl -s ${origin}/api/telegram/webhook-status | jq\n`);
