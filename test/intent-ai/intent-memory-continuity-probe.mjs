#!/usr/bin/env node
/**
 * Probe — the memory-continuity fix in `server/aiIntentOS.js`.
 * ---------------------------------------------------------------------------
 * THE BUG THIS LOCKS SHUT: `appendMemory` wrote `summary` on every turn while
 * every reader (the context builder and the app's startup restore) asked for
 * `conversationSummary`. So the assistant appeared to remember nothing across
 * sessions, and the model was never handed the user's earlier turns at all.
 *
 * Asserted here:
 *   · both field names are populated on read, in both directions
 *   · a write is immediately readable (read-your-writes through the store)
 *   · the durable half is fail-open: a broken Blob backend is a logged error,
 *     not a thrown 500 out of `/chat`
 *
 * No network: Blob/Upstash are unset for the in-process part, and the one child
 * process that simulates a failing backend stubs `fetch`.
 *
 * Run: node test/intent-ai/intent-memory-continuity-probe.mjs
 */
import { execFileSync } from 'node:child_process';

const rows = [];
const t = (name, ok, detail = '') => rows.push({ name, ok: Boolean(ok), detail });

/* The store reads its backend credentials at import time — clear them first. */
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const { __memoryInternals } = await import('../../server/aiIntentOS.js');
const { normalizeMemoryRow, readMemory, appendMemory } = __memoryInternals;

/* -------------------------------------------------------------------------- */
/*  1. BOTH NAMES, BOTH DIRECTIONS                                             */
/* -------------------------------------------------------------------------- */
/* (ZWNJ-free on purpose: `safeMemoryText` normalizes half-spaces to spaces, and
   this probe is about key names, not about that normalization.) */
const SUMMARY = 'کاربر در بازار نوسانی صبر می کند';
const written = normalizeMemoryRow({ conversationId: 'c1', summary: SUMMARY });
t('a row written with `summary` reads back as `conversationSummary`',
  written.summary === SUMMARY && written.conversationSummary === SUMMARY);

const legacy = normalizeMemoryRow({ conversationSummary: 'خلاصه قدیمی' });
t('a legacy row with only `conversationSummary` reads back as `summary`',
  legacy.summary === 'خلاصه قدیمی' && legacy.conversationSummary === 'خلاصه قدیمی');

const blank = normalizeMemoryRow(null);
t('an empty store yields both keys as empty strings, not undefined',
  blank.summary === '' && blank.conversationSummary === '' && Array.isArray(blank.goals));
t('a corrupt row degrades to the empty shape', normalizeMemoryRow([1, 2, 3]).summary === '');
t('an explicit empty summary falls through to the other name',
  normalizeMemoryRow({ summary: '', conversationSummary: 'x' }).summary === 'x');

/* -------------------------------------------------------------------------- */
/*  2. ROUND TRIP                                                              */
/* -------------------------------------------------------------------------- */
const owner = `probe-${Date.now().toString(36)}`;
t('a fresh owner starts empty', (await readMemory(owner)).conversationSummary === '');

const next = await appendMemory(owner, {
  conversationId: 'conv-1',
  summary: SUMMARY,
  goals: ['financial-goal'],
  recentIntents: ['PREFERENCE', 'صبر در نوسان']
});
t('appendMemory returns both names', next.summary === next.conversationSummary && next.summary.length > 0);
t('appendMemory persists the alias too', next.conversationSummary === SUMMARY);

const read = await readMemory(owner);
t('the next turn reads the summary back', read.conversationSummary === SUMMARY);
t('and can still read it under the legacy name', read.summary === read.conversationSummary);
t('goals survive the round trip', read.goals.includes('financial-goal'));
t('recentIntents keep both entries', read.recentIntents.includes('PREFERENCE') && read.recentIntents.length >= 2);
t('a write is visible to a read in the same process', read.conversationId === 'conv-1');

/* Data written BEFORE the fix must keep working — no migration step. */
const { storeSet, EPHEMERAL_TTL_MS } = await import('../../server/store.js');
const legacyOwner = `probe-legacy-${Date.now().toString(36)}`;
await storeSet(`ai:memory:v1:${legacyOwner}`, { summary: 'ردیف نوشته‌شده قبل از اصلاح', goals: ['old'] }, EPHEMERAL_TTL_MS);
const legacyRead = await readMemory(legacyOwner);
t('a legacy row (only `summary`) is upgraded on read', legacyRead.conversationSummary === 'ردیف نوشته‌شده قبل از اصلاح');
t('…and keeps its other fields', legacyRead.goals.includes('old'));

const second = await appendMemory(owner, { summary: 'خط دوم' });
t('a second summary replaces the first (the caller owns concatenation)', second.summary === 'خط دوم');
t('field de-duplication still holds', (await appendMemory(owner, { goals: ['financial-goal'] })).goals.length === 1);

/* -------------------------------------------------------------------------- */
/*  3. FAIL-OPEN DURABILITY (child process: Blob configured but unreachable)    */
/* -------------------------------------------------------------------------- */
const childScript = `
  process.env.AI_MEMORY_WRITE_WAIT_MS = '60';
  /* A configured-but-unreachable durable backend: Upstash is chosen over Blob
     so the failing write goes through the plain fetch this probe controls. */
  process.env.UPSTASH_REDIS_REST_URL = 'https://probe-fbt.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'probe-token-0123456789abcdef';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  globalThis.fetch = () => new Promise((_res, rej) => setTimeout(() => rej(new Error('offline')), 400));
  const { __memoryInternals } = await import('./server/aiIntentOS.js');
  const row = await __memoryInternals.appendMemory('probe-durable', { summary: 'خلاصه' });
  await new Promise((r) => setTimeout(r, 900));
  console.log(JSON.stringify({
    returned: row && row.summary === 'خلاصه',
    readable: (await __memoryInternals.readMemory('probe-durable')).conversationSummary === 'خلاصه',
    lastError: __memoryInternals.memoryPersist.lastError,
    capped: __memoryInternals.memoryPersist.lastCappedWait
  }));
  process.exit(0);
`;
let durable = null;
try {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: new URL('../..', import.meta.url).pathname,
    encoding: 'utf8',
    timeout: 30000
  });
  durable = JSON.parse(out.trim().split('\n').pop());
} catch (err) {
  t('a failing durable backend does not throw out of appendMemory', false, String(err?.message || err).slice(0, 200));
}
if (durable) {
  t('a failing durable backend does not throw out of appendMemory', durable.returned === true);
  t('the turn still reads its own write', durable.readable === true);
  t('the failure is recorded, not swallowed', typeof durable.lastError === 'string' && durable.lastError.length > 0, durable.lastError);
  t('the reply was not held for the slow backend', durable.capped === true);
}

/* -------------------------------------------------------------------------- */
/*  4. WHAT THE MODEL NOW SEES (the one place external models read context)     */
/* -------------------------------------------------------------------------- */
const { buildSafeContextBlock } = await import('../../server/aiCollaboration.js');
const block = buildSafeContextBlock({
  context: {
    market: { priceMap: { BTC: 100000 }, change24hPct: 1.25 },
    portfolio: { totalValueUsd: 1000, holdings: [{ symbol: 'USDC', valueUsd: 900 }] },
    conversationSummary: 'کاربر گفت که هدفش رسیدن به ۱۰۰۰ دلار است',
    longTermMemory: {
      ok: true,
      items: [
        { text: 'کاربر صبح‌ها خبرهای بازار را می‌خواند' },
        { text: 'x'.repeat(500) },
        ...Array.from({ length: 6 }, (_, i) => ({ text: `حافظه شماره ${i}` }))
      ]
    }
  }
});
t('the session summary reaches the model prompt', block.includes('CONVERSATION SO FAR') && block.includes('۱۰۰۰ دلار'));
t('long-term memory reaches the model prompt', block.includes('USER LONG-TERM MEMORY') && block.includes('صبح‌ها خبرهای بازار'));
t('the memory block is labelled as background, not data', /BACKGROUND ONLY/.test(block));
t('market data still reaches the prompt (no regression)', block.includes('LIVE MARKET DATA') && block.includes('BTC'));
t('memory items are capped at five', (block.match(/^- /gm) || []).length === 5, String((block.match(/^- /gm) || []).length));
t('a single memory line is bounded to 200 chars', !block.includes('x'.repeat(201)));

const noMemory = buildSafeContextBlock({ context: { market: { priceMap: { BTC: 1 } } } });
t('no long-term memory → no empty header', !noMemory.includes('USER LONG-TERM MEMORY') && !noMemory.includes('CONVERSATION SO FAR'));

/* A key that somehow reached the memory tier must still be redacted on the way
   out — the prompt sanitiser is the last line, not the first. */
const dirty = buildSafeContextBlock({
  context: { longTermMemory: { items: [{ text: 'private key 0x' + 'a'.repeat(64) }] } }
});
t('a secret in a memory line is redacted before the model sees it',
  !dirty.includes('a'.repeat(64)) && /REDACTED/.test(dirty));

/* -------------------------------------------------------------------------- */
const fails = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${rows.length - fails.length}/${rows.length} passed`);
process.exit(fails.length ? 1 : 0);
