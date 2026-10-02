#!/usr/bin/env node
/**
 * Probe — server/walrusMemoryBridge.js
 * ---------------------------------------------------------------------------
 * The bridge is the only place in Intent OS that talks to a third-party memory
 * relayer, so every property that could hurt is asserted here, offline:
 *
 *   · OFF BY DEFAULT      — no keys → every entry point is a no-op
 *   · KEY DISCIPLINE      — the delegate key signs, never leaks, and the
 *                           signature verifies against the public key we send
 *   · CANONICAL MESSAGE   — the exact `{ts}.{method}.{path}.{hash}.{nonce}.{id}`
 *                           shape the relayer documents, GET hashing empty body
 *   · REDACTION FIRST     — nothing key/seed/PII-shaped reaches the wire
 *   · NEVER BLOCKS FOREVER— a hung relayer becomes TIMEOUT, not a hung chat
 *   · NEVER THROWS        — every failure is a named reason
 *   · BUDGET              — de-dupe, cooldown, sliding windows, queue ceiling
 *
 * No network: `fetch` is stubbed. Run: node test/intent-ai/walrus-memory-bridge-probe.mjs
 */
import { createPublicKey, verify as cryptoVerify, generateKeyPairSync } from 'node:crypto';

const rows = [];
const t = (name, ok, detail = '') => rows.push({ name, ok: Boolean(ok), detail });
const mod = await import('../../server/walrusMemoryBridge.js');
const {
  bridgeStatus, bridgeRecall, bridgeRemember, durableMemoryLine, redactForThirdParty,
  namespaceFor, signedHeaders, canonicalMessage, __flushForTests, __internals
} = mod;

const realFetch = globalThis.fetch;
const seedHex = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  publicKeyEncoding: { type: 'spki', format: 'der' }
});

/* A real Ed25519 seed in the shape MemWal uses: 32 bytes, hex. */
function makeSeedHex() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  return Buffer.from(der).subarray(-32).toString('hex');
}
const ACCOUNT = '0x' + 'ab'.repeat(32);
const SEED = makeSeedHex();

function configure() {
  process.env.MEMWAL_PRIVATE_KEY = SEED;
  process.env.MEMWAL_ACCOUNT_ID = ACCOUNT;
  process.env.MEMWAL_SERVER_URL = 'https://relayer.invalid';
  delete process.env.MEMWAL_ENABLED;
}
function unconfigure() {
  delete process.env.MEMWAL_PRIVATE_KEY;
  delete process.env.MEMWAL_KEY;
  delete process.env.MEMWAL_ACCOUNT_ID;
  delete process.env.MEMWAL_ENABLED;
}

/* -------------------------------------------------------------------------- */
/*  1. NO CREDENTIALS → THE FREE LOCAL TIER, NOT SILENCE                       */
/* -------------------------------------------------------------------------- */
unconfigure();
__internals.reset();
t('no keys → the local provider answers', bridgeStatus().provider === 'local' && bridgeStatus().mode === 'local');
t('no keys → status never leaks a key field', !JSON.stringify(bridgeStatus()).toLowerCase().includes('private'));
t('no keys → the walrus half reports itself unconfigured', bridgeStatus().configured === false);

const localWrite = bridgeRemember({ owner: 'u-local', text: 'کاربر همیشه صبح‌ها خبرهای بازار را می‌خواند' });
t('local remember is queued and stored in-process', localWrite.ok === true && localWrite.provider === 'local');
await new Promise((r) => setTimeout(r, 60));
const localHit = await bridgeRecall({ owner: 'u-local', query: 'خبرهای بازار را کی می‌خوانم؟' });
t('local recall finds the line by its words', localHit.ok === true && localHit.provider === 'local' && localHit.items.length === 1,
  JSON.stringify(localHit.items));
t('local recall reports a score and the kind', localHit.items[0]?.score > 0 && localHit.items[0]?.kind === 'note');
t('local recall is honest about its source', localHit.items[0]?.source === 'local' && localHit.items[0]?.blobId === null);
t('an unrelated query recalls nothing',
  (await bridgeRecall({ owner: 'u-local', query: 'قیمت بیت کوین چنده' })).items.length === 0);
t('a synonym with no shared word is NOT recalled (lexical tier, stated)',
  (await bridgeRecall({ owner: 'u-local', query: 'چه چشم‌اندازی دارم' })).items.length === 0);
t('the local tier never claims to be semantic', bridgeStatus().local.semantic === false);

/* The free tier must obey the same discipline as the paid one. */
__internals.reset();
bridgeRemember({ owner: 'u-local2', text: 'اولین حافظهٔ محلی برای آزمون تکراری' });
await new Promise((r) => setTimeout(r, 40));
const dup = bridgeRemember({ owner: 'u-local2', text: 'اولین حافظهٔ محلی برای آزمون تکراری' });
t('local writes are de-duplicated', dup.stored === false && dup.reason === 'DUPLICATE');
t('a secret never survives into local memory',
  bridgeRemember({ owner: 'u-local3', text: 'seed phrase alpha beta gamma delta' }).reason === 'NOTHING_AFTER_REDACTION');
t('a goal outranks a note in local recall', await (async () => {
  __internals.reset();
  /* Two writes to one owner inside one tick would hit the cooldown; the
     ranking question is separate from the budget question. */
  const cooldown = process.env.MEMWAL_WRITE_COOLDOWN_MS;
  process.env.MEMWAL_WRITE_COOLDOWN_MS = '0';
  bridgeRemember({ owner: 'u-rank', text: 'کاربر دربارهٔ صبر در بازار نوسانی صحبت کرد', kind: 'note' });
  bridgeRemember({ owner: 'u-rank', text: 'هدف کاربر: صبر در بازار نوسانی و خرید پله‌ای', kind: 'goal' });
  if (cooldown === undefined) delete process.env.MEMWAL_WRITE_COOLDOWN_MS; else process.env.MEMWAL_WRITE_COOLDOWN_MS = cooldown;
  await new Promise((r) => setTimeout(r, 80));
  const res = await bridgeRecall({ owner: 'u-rank', query: 'صبر در بازار نوسانی' });
  return res.items[0]?.kind === 'goal';
})());

/* The whole tier has one kill switch, and it kills the local half too. */
process.env.MEMWAL_PROVIDER = 'off';
__internals.reset();
t('MEMWAL_PROVIDER=off stops the local tier', bridgeStatus().provider === 'off' && bridgeStatus().enabled === false);
t('…and remember reports the named reason',
  bridgeRemember({ owner: 'u1', text: 'من ترجیح می‌دهم حالت تاریک' }).reason === 'NOT_CONFIGURED');
t('…and recall does too', (await bridgeRecall({ owner: 'u1', query: 'preferences' })).reason === 'NOT_CONFIGURED');
delete process.env.MEMWAL_PROVIDER;
__internals.reset();

/* -------------------------------------------------------------------------- */
/*  2. CONFIGURED — signing, namespace, headers                                */
/* -------------------------------------------------------------------------- */
configure();
__internals.reset();
const st = bridgeStatus();
t('with credentials → the walrus provider takes over', st.mode === 'on' && st.provider === 'walrus' && st.enabled === true);
t('status masks the account', st.account === `${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-4)}`);
t('status says secrets:false', st.secrets === false);

const ns1 = namespaceFor('user-a');
const ns2 = namespaceFor('user-a');
const ns3 = namespaceFor('user-b');
t('namespace is stable per owner', ns1 === ns2);
t('namespace differs per owner', ns1 !== ns3);
t('namespace is prefixed + lowercase', ns1.startsWith('fbt-') && ns1 === ns1.toLowerCase());
t('namespace hides the owner id', !ns1.includes('user-a'));

const msgGet = canonicalMessage({ timestamp: 1, method: 'GET', pathAndQuery: '/api/remember/x', body: null, nonce: 'n', accountId: ACCOUNT });
const msgPost = canonicalMessage({ timestamp: 1, method: 'POST', pathAndQuery: '/api/remember', body: '{"a":1}', nonce: 'n', accountId: ACCOUNT });
t('canonical message has 6 dot-parts', msgGet.split('.').length === 6 && msgPost.split('.').length === 6);
t('GET signs the empty-body hash', msgGet.split('.')[3] === __internals.sha256Hex('') && msgGet.split('.')[3] !== msgPost.split('.')[3]);

const headers = signedHeaders({ method: 'POST', pathAndQuery: '/api/recall', body: '{"b":2}' });
t('x-public-key is 32 bytes hex', /^[0-9a-f]{64}$/.test(headers['x-public-key']));
t('x-signature is 64 bytes hex', /^[0-9a-f]{128}$/.test(headers['x-signature']));
t('x-nonce looks like a uuid v4', /^[0-9a-f-]{36}$/i.test(headers['x-nonce']));
t('x-timestamp is unix seconds', Math.abs(Number(headers['x-timestamp']) - Math.floor(Date.now() / 1000)) <= 5);
t('x-account-id is sent (and signed)', headers['x-account-id'] === ACCOUNT);
const rebuilt = canonicalMessage({
  timestamp: Number(headers['x-timestamp']), method: 'POST', pathAndQuery: '/api/recall',
  body: '{"b":2}', nonce: headers['x-nonce'], accountId: ACCOUNT
});
const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(headers['x-public-key'], 'hex')]);
const okSig = cryptoVerify(null, Buffer.from(rebuilt), createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(headers['x-signature'], 'hex'));
t('signature verifies over the documented message', okSig);
t('the private key never appears in headers', !JSON.stringify(headers).includes(SEED));

/* -------------------------------------------------------------------------- */
/*  3. REDACTION                                                               */
/* -------------------------------------------------------------------------- */
t('seed-phrase text is dropped entirely', redactForThirdParty('my seed phrase is alpha beta gamma') === '');
t('a 64-hex key inside a sentence is masked', !/_?[0-9a-fA-F]{40,}/.test(redactForThirdParty('this is my key ' + 'ab'.repeat(32))));
t('e-mail is masked', redactForThirdParty('mail me at ali@example.com please').includes('[ایمیل]'));
t('iranian mobile is masked (persian digits)', redactForThirdParty('شماره من ۰۹۱۲۳۴۵۶۷۸۹').includes('[تلفن]'));
t('a dollar amount survives redaction', redactForThirdParty('هدف من رسیدن به 1000000 دلار است').includes('1000000'));

/* -------------------------------------------------------------------------- */
/*  4. WHAT DESERVES STORAGE                                                   */
/* -------------------------------------------------------------------------- */
t('explicit remember → note', durableMemoryLine({ message: 'یادت باشه من ترجیح می‌دهم حالت تاریک' })?.kind === 'note');
t('explicit remember (en) → note', durableMemoryLine({ message: 'remember that I prefer dark mode' })?.kind === 'note');
t('goal turn → goal', durableMemoryLine({ message: 'می‌خواهم سرمایه‌ام را دو برابر کنم', goalDetected: true })?.kind === 'goal');
t('stated preference → preference', durableMemoryLine({ message: 'من همیشه از کیف پول سرد استفاده می‌کنم برای ذخیره' })?.kind === 'preference');
t('a question is not a memory', durableMemoryLine({ message: 'معنی ترجیح چیه؟' }) === null);
t('a greeting is not a memory', durableMemoryLine({ message: 'سلام' }) === null);
t('remember inside a question is still stored', durableMemoryLine({ message: 'یادت باشه من ترجیح می‌دهم USDC نگه دارم؟' })?.kind === 'note');

/* -------------------------------------------------------------------------- */
/*  5. SYNC PATH — never throws, always a named reason                         */
/* -------------------------------------------------------------------------- */
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ results: [{ blob_id: 'blob-1', text: 'User prefers dark mode', distance: 0.1, score: 0.9 }], total: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const rec = await bridgeRecall({ owner: 'user-a', query: 'what do I prefer?' });
t('recall maps items', rec.ok === true && rec.items.length === 1 && rec.items[0].blobId === 'blob-1');
t('recall sends namespace + weights + deadline', (() => {
  const body = JSON.parse(calls.at(-1).init.body);
  return body.namespace === namespaceFor('user-a')
    && body.scoring_weights?.recency > 0
    && Number.isFinite(body.deadline_ms)
    && body.limit === 5;
})());
t('recall carries the four signed headers', ['x-public-key', 'x-signature', 'x-timestamp', 'x-nonce'].every((h) => calls.at(-1).init.headers[h]));

globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
const netErr = await bridgeRecall({ owner: 'user-a', query: 'anything' });
t('a dead relayer is NETWORK, not a throw', netErr.ok === false && netErr.reason === 'NETWORK' && Array.isArray(netErr.items));

globalThis.fetch = async () => new Response('{"error":"slow down"}', { status: 429 });
__internals.reset();
const limited = await bridgeRecall({ owner: 'user-a', query: 'anything' });
t('429 becomes RATE_LIMITED', limited.reason === 'RATE_LIMITED');
t('the failed call is counted', bridgeStatus().counters.recall.failed >= 1 && bridgeStatus().lastError != null);

/* A hung relayer must become TIMEOUT within the budget, not a hung turn. */
globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    reject(err);
  });
});
__internals.reset();
const t0 = Date.now();
const timed = await bridgeRecall({ owner: 'user-a', query: 'anything', deadlineMs: 300 });
const waited = Date.now() - t0;
t('a hung relayer returns TIMEOUT', timed.reason === 'TIMEOUT' && timed.ok === false);
t('…and it returns inside the deadline budget', waited < 2000, `${waited}ms`);

/* -------------------------------------------------------------------------- */
/*  6. WRITE PATH — queued, de-duped, budgeted                                 */
/* -------------------------------------------------------------------------- */
calls = [];
__internals.reset();
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ job_id: 'job-1', status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
};
process.env.MEMWAL_WRITE_COOLDOWN_MS = '60000';
const w1 = bridgeRemember({ owner: 'user-a', text: 'من همیشه در بازارهای نوسانی صبر می‌کنم' });
t('remember is queued, never awaited', w1.ok === true && w1.queued === true);
const w2 = bridgeRemember({ owner: 'user-a', text: 'من همیشه در بازارهای نوسانی صبر می‌کنم' });
t('the same sentence is de-duped', w2.queued === false && w2.reason === 'DUPLICATE');
const w3 = bridgeRemember({ owner: 'user-a', text: 'یک جمله کاملاً متفاوت درباره ترجیحم' });
t('the per-owner cooldown holds the second write', w3.queued === false && w3.reason === 'COOLDOWN');
t('a redaction-only payload is refused honestly', bridgeRemember({ owner: 'user-b', text: 'seed phrase alpha beta gamma delta' }).reason === 'NOTHING_AFTER_REDACTION');
await __flushForTests();
t('the queue drains to the relayer', calls.length === 1 && JSON.parse(calls[0].init.body).namespace === namespaceFor('user-a'));
t('sent writes are counted', bridgeStatus().counters.remember.sent === 1);

/* Queue ceiling: a stuck relayer must not grow an unbounded backlog. */
__internals.reset();
process.env.MEMWAL_QUEUE_MAX = '1';
process.env.MEMWAL_WRITE_COOLDOWN_MS = '0';
globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    reject(err);
  });
});
process.env.MEMWAL_TIMEOUT_MS = '600';
/* The first job is shifted into flight synchronously, so with a ceiling of 1
   the second waits in the queue and the third is refused — the point being
   that a stuck relayer cannot grow an unbounded backlog. */
const q1 = bridgeRemember({ owner: 'user-c', text: 'اولین حافظه بلندمدت برای آزمون صف' });
const q2 = bridgeRemember({ owner: 'user-c', text: 'دومین حافظه بلندمدت برای آزمون صف' });
const q3 = bridgeRemember({ owner: 'user-c', text: 'سومین حافظه بلندمدت برای آزمون صف' });
t('queue ceiling is enforced', q1.ok === true && q2.queued === true && q3.ok === false && q3.reason === 'QUEUE_FULL');
globalThis.fetch = realFetch;

/* -------------------------------------------------------------------------- */
/*  7. HARD KILL SWITCH                                                        */
/* -------------------------------------------------------------------------- */
process.env.MEMWAL_ENABLED = 'false';
__internals.reset();
t('MEMWAL_ENABLED=false stops reads', (await bridgeRecall({ owner: 'u', query: 'x' })).reason === 'DISABLED');
t('MEMWAL_ENABLED=false stops writes', bridgeRemember({ owner: 'u', text: 'من ترجیح می‌دهم آزمایش کنم' }).reason === 'DISABLED');
t('MEMWAL_ENABLED=false is still the master kill switch', bridgeStatus().enabled === false && bridgeStatus().mode === 'disabled');
t('…and it overrides an explicit provider request', bridgeStatus().provider === 'off');
delete process.env.MEMWAL_ENABLED;
unconfigure();
__internals.reset();

/* -------------------------------------------------------------------------- */
const fails = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${rows.length - fails.length}/${rows.length} passed`);
process.exit(fails.length ? 1 : 0);
