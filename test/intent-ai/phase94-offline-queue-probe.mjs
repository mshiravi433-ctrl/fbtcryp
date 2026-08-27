/**
 * PHASE 94 — OFFLINE-FIRST
 * Public pages survive a dropped connection, and a confirmed intent waits in a
 * queue instead of failing. The queue never pretends to be an execution: no
 * receipt, no tx hash, and changed terms go back to the user.
 */
import { readFileSync } from 'node:fs';
import {
  cachePolicyFor, enqueueIntent, flushQueue, offlineStatus, assertNoOfflineExecution,
  QUEUE_STATES, QUEUE_TTL_MS, MAX_QUEUE_LENGTH, CACHEABLE_ROUTES, QUEUE_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const HASH = '0x'.concat('c'.repeat(64));
const TERMS = { amountIn: '25', tokenIn: 'USDT', tokenOut: 'ETH', slippageBps: 50 };
const CONFIRMED = { userConfirmed: true, decision: 'CONFIRM', at: NOW - 1000 };
const intent = { id: 'i1', action: 'swap', terms: TERMS };

try {
  /* ---------- what may be cached ---------- */
  check('the landing page is cacheable', cachePolicyFor('/').cacheable === true);
  check('the terms page is cacheable', cachePolicyFor('/terms').cacheable === true);
  check('a personal route is never cached', cachePolicyFor('/portfolio').cacheable === false);
  check('the swap route is never cached', cachePolicyFor('/swap').cacheable === false);
  check('the cache never serves stale prices', CACHEABLE_ROUTES.every((r) => cachePolicyFor(r).servesStalePrices === false));
  check('a cached page is announced as a saved copy', cachePolicyFor('/').i18nKey === 'intentAI.offline.cachedPage');
  check('an uncacheable page says it needs a connection', cachePolicyFor('/portfolio').i18nKey === 'intentAI.offline.pageUnavailable');
  check('the reason is explicit', cachePolicyFor('/portfolio').reason === 'PERSONAL_OR_LIVE');

  /* ---------- only confirmed intents may queue ---------- */
  const first = enqueueIntent({ queue: [], intent, confirmation: CONFIRMED, now: NOW });
  check('a confirmed intent is queued', first.ok === true && first.queued === true);
  check('the queued item is in the queued state', first.item.status === 'queued');
  check('the queue state is one of the known states', QUEUE_STATES.includes(first.item.status));
  check('the queued item has NO transaction hash', first.item.txHash === null);
  check('the queued item has NO receipt', first.item.receipt === null);
  check('the queued item claims no execution authority', first.item.executionAuthorized === false);
  check('the queued item remembers when it was confirmed', first.item.confirmedAt === CONFIRMED.at);
  check('the queued item expires', first.item.expiresAt === NOW + QUEUE_TTL_MS);
  check('the queued item is frozen', Object.isFrozen(first.item));
  check('the user is told it is waiting, not done', first.i18nKey === 'intentAI.offline.queued');
  check('an unconfirmed intent is NOT queued', enqueueIntent({ queue: [], intent, now: NOW }).queued === false);
  check('the refusal is an authorization failure', enqueueIntent({ queue: [], intent, now: NOW }).error.code === 'USER_AUTHORIZATION_REQUIRED');
  check('a rejected decision is not a confirmation',
    enqueueIntent({ queue: [], intent, confirmation: { userConfirmed: true, decision: 'REJECT', at: NOW }, now: NOW }).queued === false);
  check('an untimestamped confirmation is not accepted',
    enqueueIntent({ queue: [], intent, confirmation: { userConfirmed: true, decision: 'CONFIRM' }, now: NOW }).reasons.includes('CONFIRMATION_NOT_TIMESTAMPED'));
  check('queuing nothing is refused', enqueueIntent({ queue: [], confirmation: CONFIRMED, now: NOW }).queued === false);
  const full = Array.from({ length: MAX_QUEUE_LENGTH }, (_, i) => ({ ...first.item, id: `q${i}` }));
  check('the queue has a bound', enqueueIntent({ queue: full, intent, confirmation: CONFIRMED, now: NOW }).reasons.includes('QUEUE_FULL'));
  check('a full queue is a friendly notice, not a crash', enqueueIntent({ queue: full, intent, confirmation: CONFIRMED, now: NOW }).i18nKey === 'intentAI.offline.notQueued');

  /* ---------- what the user sees while offline ---------- */
  const waiting = offlineStatus({ online: false, queue: first.queue, now: NOW });
  check('offline with a queue says it is waiting', waiting.i18nKey === 'intentAI.offline.waiting');
  check('nothing is reported as executed while offline', waiting.executed === 0);
  check('the waiting count is shown', waiting.queued === 1);
  check('offline with nothing queued says plainly nothing was sent',
    offlineStatus({ online: false, queue: [], now: NOW }).i18nKey === 'intentAI.offline.offline');
  check('back online with a queue says it is sending',
    offlineStatus({ online: true, queue: first.queue, now: NOW }).i18nKey === 'intentAI.offline.sending');
  check('expired items are counted separately',
    offlineStatus({ online: false, queue: first.queue, now: NOW + QUEUE_TTL_MS + 1 }).expired === 1);

  /* ---------- the flush ---------- */
  const sentRun = await flushQueue({
    queue: first.queue, send: async () => ({ ok: true, txHash: HASH }), currentTerms: { [first.item.id]: TERMS }, now: NOW + 1000
  });
  check('an unchanged item is sent when the network returns', sentRun.sent.length === 1 && sentRun.sent[0].txHash === HASH);
  check('the queue is emptied of the sent item', sentRun.queue.length === 0);
  check('the send is announced', sentRun.i18nKey === 'intentAI.offline.sent');
  const changed = await flushQueue({
    queue: first.queue, send: async () => ({ ok: true, txHash: HASH }),
    currentTerms: { [first.item.id]: { ...TERMS, slippageBps: 400 } }, now: NOW + 1000
  });
  check('changed terms are NOT sent silently', changed.sent.length === 0);
  check('the item goes back to the user', changed.returnedToUser[0].reason === 'TERMS_CHANGED');
  check('the user must confirm again', changed.returnedToUser[0].requiresReconfirmation === true);
  check('the change is explained', changed.returnedToUser[0].diff.length > 0);
  check('the reconfirmation is a translatable notice', changed.i18nKey === 'intentAI.offline.needsReconfirmation');
  const stale = await flushQueue({ queue: first.queue, send: async () => ({ ok: true, txHash: HASH }), now: NOW + QUEUE_TTL_MS + 1 });
  check('an expired item is never sent', stale.sent.length === 0 && stale.expired.length === 1);
  const failed = await flushQueue({ queue: first.queue, send: async () => { throw new Error('offline'); }, now: NOW + 1000 });
  check('a failed send keeps the item queued, it does not vanish', failed.queue.length === 1);
  check('the failure is recorded on the item', failed.queue[0].lastError === 'SEND_FAILED');
  check('a rejected send is not counted as sent',
    (await flushQueue({ queue: first.queue, send: async () => ({ ok: false }), now: NOW + 1000 })).sent.length === 0);
  check('with no transport the queue simply waits',
    (await flushQueue({ queue: first.queue, now: NOW + 1000 })).queue.length === 1);

  /* ---------- the guard ---------- */
  check('an honest queue passes', assertNoOfflineExecution({ queue: first.queue, status: waiting, cache: [cachePolicyFor('/')] }).ok === true);
  check('a queued item with a tx hash is caught',
    assertNoOfflineExecution({ queue: [{ ...first.item, txHash: HASH }] }).reasons.includes('QUEUED_ITEM_HAS_TX_HASH'));
  check('a queued item with a receipt is caught',
    assertNoOfflineExecution({ queue: [{ ...first.item, receipt: { status: 'COMPLETED' } }] }).reasons.includes('QUEUED_ITEM_HAS_RECEIPT'));
  check('a queued item claiming authority is caught',
    assertNoOfflineExecution({ queue: [{ ...first.item, executionAuthorized: true }] }).reasons.includes('QUEUED_ITEM_CLAIMS_AUTHORITY'));
  check('a queued item with no confirmation is caught',
    assertNoOfflineExecution({ queue: [{ ...first.item, confirmedAt: null }] }).reasons.includes('QUEUED_WITHOUT_CONFIRMATION'));
  check('an immortal queue item is caught',
    assertNoOfflineExecution({ queue: [{ ...first.item, expiresAt: null }] }).reasons.includes('QUEUED_ITEM_NEVER_EXPIRES'));
  check('an invented queue state is caught',
    assertNoOfflineExecution({ queue: [{ ...first.item, status: 'completed' }] }).reasons.includes('UNKNOWN_QUEUE_STATE'));
  check('claiming an execution while offline is caught',
    assertNoOfflineExecution({ status: { online: false, executed: 1 } }).reasons.includes('EXECUTED_WHILE_OFFLINE'));
  check('caching stale prices is caught',
    assertNoOfflineExecution({ cache: [{ cacheable: true, servesStalePrices: true }] }).reasons.includes('CACHED_STALE_PRICES'));
  check('the guard rejection is a guardian rejection',
    assertNoOfflineExecution({ queue: [{ ...first.item, txHash: HASH }] }).error.code === 'GUARDIAN_REJECTED');
  check('the queue schema is stable', first.schema === QUEUE_SCHEMA);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the offline copy is translated in en, fa and ar',
    locales.every((loc) => ['offline', 'waiting', 'queued', 'sent', 'needsReconfirmation', 'cachedPage', 'pageUnavailable']
      .every((k) => typeof loc?.intentAI?.offline?.[k] === 'string')));
  check('the english offline copy never claims something was executed',
    /nothing has been sent/i.test(locales[0].intentAI.offline.offline));
  check('the queued copy is about sending later, not about success',
    /when you are back online/i.test(locales[0].intentAI.offline.queued));

  console.log(JSON.stringify({ probe: 'phase94-offline-queue', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
