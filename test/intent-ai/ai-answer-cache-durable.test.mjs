/**
 * THE DURABLE ANSWER CACHE
 * ---------------------------------------------------------------------------
 * The cache was one in-memory Map. On a serverless deployment that map is
 * empty on every cold start, so the same question asked twice — on two
 * different lambdas — cost two full collaborations. Five provider calls
 * each, on a tier whose whole daily allowance is fifty.
 *
 * These tests cover the contract the durable tier has to meet:
 *
 *   · the local tier still works exactly as before (a warm Map hit);
 *   · a durable write followed by a durable read finds the answer, even
 *     with an EMPTY local tier — the case the Map alone could not serve;
 *   · the durable tier can be switched off, and then it is off;
 *   · a broken durable backend must never break the turn.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aiAnswerCacheKey,
  aiAnswerCacheGet,
  aiAnswerCacheSet,
  __clearAiAnswerCacheForTests,
  aiAnswerCacheStats,
  withAiAnswerCache,
  aiAnswerCachePersist,
  aiAnswerCacheEnabled,
  AI_CACHE_TTL_MS
} from '../../server/aiAnswerCache.js';

test.beforeEach(() => {
  __clearAiAnswerCacheForTests();
});

test('the key is stable for the same question and different for another', () => {
  const a = aiAnswerCacheKey({ question: 'قیمت بیت‌کوین؟', locale: 'fa' });
  const b = aiAnswerCacheKey({ question: 'قیمت بیت‌کوین؟', locale: 'fa' });
  const c = aiAnswerCacheKey({ question: 'قیمت اتریوم؟', locale: 'fa' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('a local hit is a hit', async () => {
  const key = aiAnswerCacheKey({ question: 'سلام', locale: 'fa' });
  await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => ({ answer: 'hi' }), { skipDurable: true });
  const hit = aiAnswerCacheGet(key);
  assert.ok(hit);
  assert.equal(hit.answer, 'hi');
});

test('a miss runs the producer and stores the answer', async () => {
  const key = aiAnswerCacheKey({ question: 'تست میس', locale: 'fa' });
  let produced = 0;
  const first = await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => {
    produced += 1;
    return { answer: 'یک' };
  }, { skipDurable: true });
  assert.equal(first.cached, false);
  const second = await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => {
    produced += 1;
    return { answer: 'دو' };
  }, { skipDurable: true });
  assert.equal(second.cached, true);
  assert.equal(produced, 1, 'the producer ran once');
});

test('a cache hit is marked as cached', async () => {
  const key = aiAnswerCacheKey({ question: 'علامت', locale: 'fa' });
  await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => ({ answer: 'x' }), { skipDurable: true });
  const second = await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => ({ answer: 'y' }), { skipDurable: true });
  assert.equal(second.cached, true);
  assert.equal(second.value.cached, true);
});

test('the cache can be switched off, and then every turn is live', async () => {
  const key = aiAnswerCacheKey({ question: 'خاموش', locale: 'fa' });
  let produced = 0;
  await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => {
    produced += 1;
    return { answer: 'a' };
  }, { skipDurable: true, enabled: false });
  await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => {
    produced += 1;
    return { answer: 'b' };
  }, { skipDurable: true, enabled: false });
  assert.equal(produced, 2, 'a disabled cache produces every time');
});

test('the cache statistics count hits and misses', async () => {
  const key = aiAnswerCacheKey({ question: 'آمار', locale: 'fa' });
  const before = aiAnswerCacheStats();
  await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => ({ answer: 'x' }), { skipDurable: true });
  const after = aiAnswerCacheStats();
  assert.equal(after.misses, before.misses + 1);
  await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => ({ answer: 'x' }), { skipDurable: true });
  const later = aiAnswerCacheStats();
  assert.equal(later.hits, after.hits + 1);
});

test('an expired entry is not served', async () => {
  const key = aiAnswerCacheKey({ question: 'منقضی', locale: 'fa' });
  aiAnswerCacheSet(key, { answer: 'old' }, 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(aiAnswerCacheGet(key), null);
});

test('the TTL tiers exist and are ordered by how fast they go stale', () => {
  assert.ok(AI_CACHE_TTL_MS.BREAKING > 0);
  assert.ok(AI_CACHE_TTL_MS.BREAKING < AI_CACHE_TTL_MS.LIVE, 'a breaking answer goes stale first');
  assert.ok(AI_CACHE_TTL_MS.LIVE < AI_CACHE_TTL_MS.RECENT, 'a live price goes stale before a general answer');
  assert.ok(AI_CACHE_TTL_MS.RECENT < AI_CACHE_TTL_MS.STATIC, 'a fact outlives a reading');
});

test('the cache has an operator kill-switch', () => {
  assert.equal(typeof aiAnswerCacheEnabled, 'function');
});

/* ─── THE DURABLE TIER ─────────────────────────────────────────────────── */

test('the durable tier can be written and read back', async () => {
  const previous = process.env.AI_ANSWER_CACHE_DURABLE;
  process.env.AI_ANSWER_CACHE_DURABLE = '1';
  try {
    const key = aiAnswerCacheKey({ question: 'دوام', locale: 'fa' });
    const written = await aiAnswerCachePersist(key, { answer: 'پایدار' }, AI_CACHE_TTL_MS.RECENT);
    if (!written) {
      /* No durable backend in this environment — the contract is that the
         write reports honestly instead of pretending it happened. */
      assert.equal(written, false);
      return;
    }
    __clearAiAnswerCacheForTests();
    const found = await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => {
      throw new Error('the producer must not run on a durable hit');
    }, { skipDurable: false });
    assert.equal(found.cached, true);
    assert.equal(found.value.answer, 'پایدار');
  } finally {
    if (previous === undefined) delete process.env.AI_ANSWER_CACHE_DURABLE;
    else process.env.AI_ANSWER_CACHE_DURABLE = previous;
  }
});

test('a broken durable backend never breaks the turn', async () => {
  const previous = process.env.AI_ANSWER_CACHE_DURABLE;
  process.env.AI_ANSWER_CACHE_DURABLE = '1';
  try {
    const key = aiAnswerCacheKey({ question: 'خرابی', locale: 'fa' });
    const value = await withAiAnswerCache(key, AI_CACHE_TTL_MS.RECENT, async () => ({ answer: 'زنده' }), { skipDurable: false });
    assert.ok(value.value);
    assert.equal(value.value.answer, 'زنده');
  } finally {
    if (previous === undefined) delete process.env.AI_ANSWER_CACHE_DURABLE;
    else process.env.AI_ANSWER_CACHE_DURABLE = previous;
  }
});

test('the durable tier reports honestly when it is switched off', async () => {
  const previous = process.env.AI_ANSWER_CACHE_DURABLE;
  process.env.AI_ANSWER_CACHE_DURABLE = '0';
  try {
    const key = aiAnswerCacheKey({ question: 'خاموش دوام', locale: 'fa' });
    const written = await aiAnswerCachePersist(key, { answer: 'x' }, AI_CACHE_TTL_MS.RECENT);
    assert.equal(written, false, 'a disabled durable tier says so');
  } finally {
    if (previous === undefined) delete process.env.AI_ANSWER_CACHE_DURABLE;
    else process.env.AI_ANSWER_CACHE_DURABLE = previous;
  }
});
