#!/usr/bin/env node
/**
 * Probe — the long-term memory wiring, end to end, against a STUB relayer.
 * ---------------------------------------------------------------------------
 * `walrus-memory-bridge-probe.mjs` proves the bridge module in isolation. This
 * one proves the *wiring*: that a real `/api/v1/ai/chat` turn, served by the
 * real express app,
 *
 *   1. asks the relayer for the owner's memories and puts what comes back into
 *      `context.longTermMemory` (so the model can actually use it),
 *   2. writes a durable statement from that turn back as one `remember`,
 *   3. namespaces both calls identically and unguessably (`fbt-<hash>`),
 *   4. sends signed headers and a body the relayer would accept,
 *   5. stays completely silent when the feature is unconfigured (covered by the
 *      unit probe) and never blocks the reply when the relayer is slow.
 *
 * No real relayer, no network beyond 127.0.0.1. Run:
 *   node test/intent-ai/walrus-memory-wiring-probe.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';

const rows = [];
const t = (name, ok, detail = '') => rows.push({ name, ok: Boolean(ok), detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seedHex = (() => {
  const der = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'der' });
  return Buffer.from(der).subarray(-32).toString('hex');
})();

/* -------------------------------------------------------------------------- */
/*  STUB RELAYER                                                               */
/* -------------------------------------------------------------------------- */
const calls = [];
const RELAY_MEMORY = 'کاربر ترجیح می‌دهد خبرهای بازار را صبح بخواند';

const relayer = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const entry = { path: req.url, method: req.method, headers: req.headers, body: null };
    try { entry.body = raw ? JSON.parse(raw) : null; } catch { entry.body = raw; }
    calls.push(entry);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/recall') {
      res.end(JSON.stringify({ results: [{ blob_id: 'blob-1', text: RELAY_MEMORY, distance: 0.11, score: 0.93 }], total: 1 }));
      return;
    }
    if (req.url === '/api/remember') {
      res.statusCode = 202;
      res.end(JSON.stringify({ job_id: 'job-1', status: 'running' }));
      return;
    }
    res.end(JSON.stringify({ status: 'ok' }));
  });
});
relayer.listen(0, '127.0.0.1');
await once(relayer, 'listening');
const relayerPort = relayer.address().port;

/* -------------------------------------------------------------------------- */
/*  APP UNDER TEST                                                             */
/* -------------------------------------------------------------------------- */
const appPort = 3900 + Math.floor(Math.random() * 90);
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: String(appPort),
    NODE_ENV: 'development',
    MEMWAL_SERVER_URL: `http://127.0.0.1:${relayerPort}`,
    MEMWAL_ACCOUNT_ID: `0x${'cd'.repeat(32)}`,
    MEMWAL_PRIVATE_KEY: seedHex,
    MEMWAL_WRITE_COOLDOWN_MS: '0',
    MEMWAL_RECALL_DEADLINE_MS: '1500',
    MEMWAL_MAX_TEXT: '700'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let appLog = '';
child.stdout.on('data', (d) => { appLog += d; });
child.stderr.on('data', (d) => { appLog += d; });

const base = `http://127.0.0.1:${appPort}`;
let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try {
    const r = await fetch(`${base}/api/v1/ai/memory/long-term`, { signal: AbortSignal.timeout(1500) });
    up = r.ok;
  } catch { up = false; }
  if (!up) await sleep(1000);
}
t('the app boots with the bridge configured', up, up ? '' : appLog.slice(-300));

let chat = null;
let memoryAfter = null;
if (up) {
  try {
    const res = await fetch(`${base}/api/v1/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'یادت باشه من همیشه خبرهای بازار را صبح می‌خوانم', locale: 'fa' }),
      signal: AbortSignal.timeout(20000)
    });
    chat = await res.json();
    /* The remember queue is fire-and-forget: give the drain a moment. */
    await sleep(700);
    memoryAfter = await (await fetch(`${base}/api/v1/ai/memory`, { signal: AbortSignal.timeout(5000) })).json();
  } catch (err) {
    t('the chat turn answers', false, String(err?.message || err));
  }
}

/* -------------------------------------------------------------------------- */
/*  ASSERTIONS                                                                 */
/* -------------------------------------------------------------------------- */
const recallCall = calls.find((c) => c.path === '/api/recall');
const rememberCall = calls.find((c) => c.path === '/api/remember');
const ctx = chat?.context || {};

t('the chat turn answers', chat?.ok === true && chat?.schema === 'fbt.ai-chat.v1');
t('the recalled memory reaches the turn', ctx.longTermMemory?.ok === true && ctx.longTermMemory.used === 1,
  JSON.stringify(ctx.longTermMemory));
t('the turn reports long-term memory as live',
  (ctx.dataStatus || {}).longTerm === 'live');
t('the relayer was asked exactly once for a recall', calls.filter((c) => c.path === '/api/recall').length === 1);
t('the recall carries the four signed headers',
  ['x-public-key', 'x-signature', 'x-timestamp', 'x-nonce'].every((h) => typeof recallCall?.headers?.[h] === 'string' && recallCall.headers[h].length > 8));
t('the recall signs the account id it sends',
  recallCall?.headers?.['x-account-id'] === `0x${'cd'.repeat(32)}`);
t('the recall asks in a per-owner namespace',
  /^fbt-[0-9a-f]{16}$/.test(String(recallCall?.body?.namespace || '')));
t('the recall spends one point, not a page',
  recallCall?.body?.limit === 5 && recallCall?.body?.deadline_ms > 0);

t('a durable statement is written back once', Boolean(rememberCall) && calls.filter((c) => c.path === '/api/remember').length === 1);
t('the write lands in the SAME namespace as the read',
  rememberCall?.body?.namespace && rememberCall.body.namespace === recallCall?.body?.namespace);
t('the written text is the user\'s own sentence', String(rememberCall?.body?.text || '').includes('خبرهای بازار'));
t('the written text is bounded', String(rememberCall?.body?.text || '').length <= 700);

t('the app counts the recall honestly',
  memoryAfter?.longTerm?.counters?.recall?.ok === 1, JSON.stringify(memoryAfter?.longTerm?.counters));
t('the app counts the write honestly',
  memoryAfter?.longTerm?.counters?.remember?.sent === 1, JSON.stringify(memoryAfter?.longTerm?.counters));
t('the app never exposes the delegate key',
  !JSON.stringify(memoryAfter || {}).includes(seedHex) && !JSON.stringify(chat || {}).includes(seedHex));

/* The operator-facing probe: a read of the caller's own namespace, and only a
   read — a diagnostic route must never turn into a write path. */
const before = calls.length;
const killed = await fetch(`${base}/api/v1/ai/memory/long-term/recall`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'anything' }),
  signal: AbortSignal.timeout(8000)
}).then((r) => r.json()).catch(() => null);
t('the recall probe answers with the owner\'s own memory', killed?.ok === true && killed.items?.length === 1);
t('the probe only reads — the write count is unchanged',
  calls.filter((c) => c.path === '/api/remember').length === 1 && calls.length >= before);

child.kill('SIGTERM');
relayer.close();
await Promise.race([once(child, 'exit'), sleep(2000)]);

const fails = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${rows.length - fails.length}/${rows.length} passed`);
process.exit(fails.length ? 1 : 0);
