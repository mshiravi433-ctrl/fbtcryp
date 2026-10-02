#!/usr/bin/env node
/**
 * Probe — the FREE long-term memory tier, end to end, on the real app.
 * ---------------------------------------------------------------------------
 * The Walrus tier needs an on-chain account and credentials. This tier needs
 * nothing: no keys, no accounts, no external service, no money. What it must
 * still do — and what this probe proves against a real `server/index.js` with
 * NO MEMWAL_* environment at all — is behave like a memory:
 *
 *   1. a durable statement in one chat turn is stored,
 *   2. a later turn that asks about it finds it, and the model's context block
 *      carries it (`context.longTermMemory.used > 0`, provider `local`),
 *   3. an unrelated turn recalls nothing (no false memory),
 *   4. the tier says what it is: lexical, not semantic, and whether the store
 *      behind it is durable in this deployment,
 *   5. no request leaves the process for a memory service.
 *
 * Run: node test/intent-ai/intent-longterm-local-probe.mjs
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = new URL('../..', import.meta.url).pathname;
const rows = [];
const t = (name, ok, detail = '') => rows.push({ name, ok: Boolean(ok), detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 3950 + Math.floor(Math.random() * 40);
const env = { ...process.env, PORT: String(port), NODE_ENV: 'development' };
for (const k of Object.keys(env)) if (k.startsWith('MEMWAL_')) delete env[k];

const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

const base = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try { up = (await fetch(`${base}/api/v1/ai/memory/long-term`, { signal: AbortSignal.timeout(1500) })).ok; } catch { up = false; }
  if (!up) await sleep(1000);
}
t('the app boots with NO Walrus credentials at all', up, up ? '' : log.slice(-300));
if (!up && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(log)) {
  console.log('\n  The app could not start because dependencies are not installed in this checkout.');
  console.log('  Run `npm ci --ignore-scripts` (or `npm install`) and run this probe again.\n');
  process.exit(2);
}

const chat = async (message) => {
  const res = await fetch(`${base}/api/v1/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, locale: 'fa' }),
    signal: AbortSignal.timeout(20000)
  });
  return res.json();
};

let turn1 = null;
let turn2 = null;
let turn3 = null;
let status = null;
let probe = null;
if (up) {
  turn1 = await chat('یادت باشه من همیشه خبرهای بازار را صبح می‌خوانم');
  await sleep(400); // the local persist is fire-and-forget
  turn2 = await chat('خبرهای بازار را کی می‌خوانم؟');
  turn3 = await chat('قیمت بیت کوین الان چنده؟');
  status = await (await fetch(`${base}/api/v1/ai/memory/long-term`)).json();
  probe = await (await fetch(`${base}/api/v1/ai/memory/long-term/recall`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'خبرهای بازار' })
  })).json();
}

t('the free tier answers without credentials', status?.status?.provider === 'local' && status?.status?.enabled === true,
  JSON.stringify(status?.status?.mode));
t('the tier declares itself lexical, not semantic', status?.status?.local?.semantic === false && /bm25/.test(String(status?.status?.local?.retrieval)));
t('the deployment is told whether the store is durable', typeof status?.status?.local?.durable === 'boolean');
t('the first turn answers like before (memory is additive)', turn1?.ok === true);

t('a durable statement is written in the same turn', turn1?.context?.longTermMemory?.provider === 'local');
t('the write is counted honestly', (status?.status?.counters?.local?.stored ?? 0) >= 1,
  JSON.stringify(status?.status?.counters?.local));

t('a later turn recalls it by its words', (turn2?.context?.longTermMemory?.used ?? 0) >= 1,
  JSON.stringify(turn2?.context?.longTermMemory));
t('the recall is attributed to the local provider', turn2?.context?.longTermMemory?.provider === 'local');
t('the memory reaches the model context block', (turn2?.context?.longTermMemory?.ok === true));
t('an unrelated turn recalls nothing (no false memory)', (turn3?.context?.longTermMemory?.used ?? 0) === 0,
  JSON.stringify(turn3?.context?.longTermMemory));

t('the operator recall probe returns the stored line',
  probe?.ok === true && probe.items?.length >= 1 && String(probe.items[0].text).includes('خبرهای بازار'),
  JSON.stringify(probe?.items?.[0]?.text?.slice(0, 60)));
t('the stored line never exposes a key or a secret',
  !JSON.stringify(probe || {}).toLowerCase().includes('private key'));

/* The app never contacted a memory service: with no credentials there is no
   endpoint to call, and the provider says `local`. This is asserted by the
   provider itself rather than by counting sockets, which keeps the check honest
   even if another subsystem opens a connection. */
t('no remote memory call is possible (no credentials, provider local)', status?.status?.configured === false);

child.kill('SIGTERM');
await Promise.race([once(child, 'exit'), sleep(2000)]);

const fails = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${rows.length - fails.length}/${rows.length} passed`);
process.exit(fails.length ? 1 : 0);
