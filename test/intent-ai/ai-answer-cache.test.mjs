/*
 * THE AI ANSWER CACHE PROBE
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The fleet is three free tiers, and two ceilings bind it at once: about eight
 * minutes of CPU per day (the Hobby Fluid Active CPU allowance) and
 * OpenRouter's free catalogue's 50-requests-a-day cap. A `max` turn spends
 * three of those requests and seconds of CPU.
 *
 * A cache that is wrong is worse than no cache. A cache that serves one
 * user's portfolio-grounded answer to another user is a privacy leak. A cache
 * that replays a degraded fallback turns one transient outage into a
 * permanent one. A cache that serves a ten-minute-old price as current is
 * worse than a slow answer.
 *
 * So these tests are about the cache's HONESTY, not its hit rate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aiAnswerCacheKey,
  aiAnswerCacheTtlMs,
  isCacheableAnswer,
  aiAnswerCacheGet,
  aiAnswerCacheSet,
  aiAnswerCacheStats,
  aiAnswerCacheEnabled,
  withAiAnswerCache,
  __clearAiAnswerCacheForTests,
  AI_CACHE_TTL_MS
} from '../../server/aiAnswerCache.js';

function reset() {
  __clearAiAnswerCacheForTests();
}

/* -------------------------------------------------------------------------- */
/*  A. THE KEY                                                                */
/* -------------------------------------------------------------------------- */

test('the same question, locale and mode produce the same key', () => {
  reset();
  const a = aiAnswerCacheKey({ question: 'قیمت بیت‌کوین چنده؟', locale: 'fa', intelligence: 'max' });
  const b = aiAnswerCacheKey({ question: 'قیمت بیت‌کوین چنده؟', locale: 'fa', intelligence: 'max' });
  assert.equal(a, b);
  assert.ok(a, 'a key must exist');
});

test('a different question produces a different key', () => {
  reset();
  const a = aiAnswerCacheKey({ question: 'قیمت بیت‌کوین چنده؟', locale: 'fa' });
  const b = aiAnswerCacheKey({ question: 'قیمت اتریوم چنده؟', locale: 'fa' });
  assert.notEqual(a, b);
});

test('the locale is part of the key — the same words answer differently', () => {
  reset();
  const fa = aiAnswerCacheKey({ question: 'تحلیل بازار', locale: 'fa' });
  const en = aiAnswerCacheKey({ question: 'تحلیل بازار', locale: 'en' });
  assert.notEqual(fa, en);
});

test('the intelligence mode is part of the key — swift and max answer differently', () => {
  reset();
  const swift = aiAnswerCacheKey({ question: 'تحلیل ریسک', intelligence: 'swift' });
  const max = aiAnswerCacheKey({ question: 'تحلیل ریسک', intelligence: 'max' });
  assert.notEqual(swift, max);
});

test('the conversation id is part of the key — a follow-up is a different turn', () => {
  reset();
  const a = aiAnswerCacheKey({ question: 'و دومی؟', conversationId: 'conv-1' });
  const b = aiAnswerCacheKey({ question: 'و دومی؟', conversationId: 'conv-2' });
  assert.notEqual(a, b);
});

test('the user\'s own ground truth is part of the key — one user never gets another\'s answer', () => {
  reset();
  const userA = aiAnswerCacheKey({
    question: 'وضعیت پورتفوی من چیست؟',
    groundTruth: { portfolio: [{ asset: 'BTC', amount: 1 }] }
  });
  const userB = aiAnswerCacheKey({
    question: 'وضعیت پورتفوی من چیست؟',
    groundTruth: { portfolio: [{ asset: 'ETH', amount: 40 }] }
  });
  assert.notEqual(userA, userB, 'a portfolio-grounded answer must never be shared across users');
});

test('the conversation history is part of the key', () => {
  reset();
  const a = aiAnswerCacheKey({ question: 'قیمتش؟', priorMessages: [{ role: 'user', content: 'من BTC دارم' }] });
  const b = aiAnswerCacheKey({ question: 'قیمتش؟', priorMessages: [{ role: 'user', content: 'من ETH دارم' }] });
  assert.notEqual(a, b);
});

test('an empty question has no key — nothing to cache', () => {
  reset();
  assert.equal(aiAnswerCacheKey({ question: '' }), null);
  assert.equal(aiAnswerCacheKey({ question: '   ' }), null);
  assert.equal(aiAnswerCacheKey({}), null);
});

test('the key does not contain the user\'s words', () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'رمز عبور من 12345 است' });
  assert.ok(!key.includes('12345'), 'the key must not leak the message into a map');
});

test('a circular ground truth does not crash key building', () => {
  reset();
  const circular = { portfolio: [] };
  circular.self = circular;
  const key = aiAnswerCacheKey({ question: 'سؤال', groundTruth: circular });
  assert.ok(key, 'a key must still be produced');
});

/* -------------------------------------------------------------------------- */
/*  B. THE TTL                                                                */
/* -------------------------------------------------------------------------- */

test('the freshness class decides the TTL', () => {
  reset();
  assert.equal(aiAnswerCacheTtlMs('STATIC'), AI_CACHE_TTL_MS.STATIC);
  assert.equal(aiAnswerCacheTtlMs('LIVE'), AI_CACHE_TTL_MS.LIVE);
  assert.equal(aiAnswerCacheTtlMs('BREAKING'), AI_CACHE_TTL_MS.BREAKING);
  assert.equal(aiAnswerCacheTtlMs('RECENT'), AI_CACHE_TTL_MS.RECENT);
});

test('an unknown freshness class gets the CONSERVATIVE ttl, never the long one', () => {
  reset();
  /* A new class must not accidentally become a day-long cache. */
  assert.equal(aiAnswerCacheTtlMs('SOMETHING_NEW'), AI_CACHE_TTL_MS.RECENT);
  assert.equal(aiAnswerCacheTtlMs(undefined), AI_CACHE_TTL_MS.RECENT);
  assert.equal(aiAnswerCacheTtlMs(null), AI_CACHE_TTL_MS.RECENT);
});

test('a live answer expires far sooner than a static one', () => {
  reset();
  assert.ok(AI_CACHE_TTL_MS.LIVE < AI_CACHE_TTL_MS.RECENT);
  assert.ok(AI_CACHE_TTL_MS.RECENT < AI_CACHE_TTL_MS.STATIC);
  assert.ok(AI_CACHE_TTL_MS.BREAKING < AI_CACHE_TTL_MS.LIVE);
});

/* -------------------------------------------------------------------------- */
/*  C. WHAT MAY BE CACHED                                                     */
/* -------------------------------------------------------------------------- */

test('a good answer is cacheable', () => {
  reset();
  assert.equal(isCacheableAnswer({ answer: 'بیت‌کوین حدود ۶۰ هزار دلار است.' }, { freshness: 'RECENT' }), true);
});

test('a degraded answer is NOT cacheable — an outage must not become permanent', () => {
  reset();
  assert.equal(
    isCacheableAnswer({ answer: 'متأسفانه نمی‌توانم پاسخ دهم', degraded: true }, { freshness: 'RECENT' }),
    false
  );
});

test('an empty answer is NOT cacheable', () => {
  reset();
  assert.equal(isCacheableAnswer({ answer: '' }, { freshness: 'RECENT' }), false);
  assert.equal(isCacheableAnswer({ answer: '   ' }, { freshness: 'RECENT' }), false);
  assert.equal(isCacheableAnswer(null, { freshness: 'RECENT' }), false);
});

test('a low-confidence answer is NOT cacheable — the model said it was unsure', () => {
  reset();
  assert.equal(
    isCacheableAnswer({ answer: 'شاید این طور باشد؟', uncertainty: { confidence: 0.2 } }, { freshness: 'RECENT' }),
    false
  );
});

test('a confidence-bearing good answer IS cacheable', () => {
  reset();
  assert.equal(
    isCacheableAnswer({ answer: 'قیمت فعلی X است.', uncertainty: { confidence: 0.8 } }, { freshness: 'RECENT' }),
    true
  );
});

/* -------------------------------------------------------------------------- */
/*  D. THE STORE                                                              */
/* -------------------------------------------------------------------------- */

test('a stored answer is read back', () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'سلام', locale: 'fa' });
  aiAnswerCacheSet(key, { answer: 'سلام! چطور می‌تونم کمک کنم؟' }, 10000);
  const hit = aiAnswerCacheGet(key);
  assert.ok(hit);
  assert.equal(hit.answer, 'سلام! چطور می‌تونم کمک کنم؟');
});

test('an expired answer is a MISS — a stale model answer is a different answer', () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'قیمت', locale: 'fa' });
  aiAnswerCacheSet(key, { answer: 'قدیمی' }, 1);
  /* Wait past the TTL. */
  const until = Date.now() + 5;
  while (Date.now() < until) { /* spin briefly */ }
  assert.equal(aiAnswerCacheGet(key), null, 'an expired entry must not be served');
});

test('a zero or negative TTL stores nothing', () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'بی‌اعتبار', locale: 'fa' });
  aiAnswerCacheSet(key, { answer: 'x' }, 0);
  assert.equal(aiAnswerCacheGet(key), null);
  aiAnswerCacheSet(key, { answer: 'x' }, -5);
  assert.equal(aiAnswerCacheGet(key), null);
});

/* -------------------------------------------------------------------------- */
/*  E. THE PRODUCER PATH                                                      */
/* -------------------------------------------------------------------------- */

test('a miss calls the producer and a hit does not', async () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'تحلیل بازار', locale: 'fa' });
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return { answer: `پاسخ ${calls}` };
  };

  const first = await withAiAnswerCache(key, 10000, producer);
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(first.value.answer, 'پاسخ 1');

  const second = await withAiAnswerCache(key, 10000, producer);
  assert.equal(calls, 1, 'the producer must not run again on a hit');
  assert.equal(second.cached, true);
  assert.equal(second.value.answer, 'پاسخ 1');
});

test('a hit is marked as cached, and the answer itself is untouched', async () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'بازار', locale: 'fa' });
  const answer = { answer: 'متن', providersUsed: ['groq'], modelsConsulted: ['gpt-oss-120b'], claims: [] };
  await withAiAnswerCache(key, 10000, async () => answer);
  const second = await withAiAnswerCache(key, 10000, async () => answer);
  assert.equal(second.cached, true);
  /* The verdict is replayed exactly — a client cannot be misled by a cache. */
  assert.deepEqual(second.value.providersUsed, ['groq']);
  assert.deepEqual(second.value.modelsConsulted, ['gpt-oss-120b']);
  assert.deepEqual(second.value.claims, []);
});

test('two identical questions arriving together spend one producer', async () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'همزمان', locale: 'fa' });
  let calls = 0;
  const producer = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { answer: 'یک پاسخ' };
  };
  const [a, b] = await Promise.all([
    withAiAnswerCache(key, 10000, producer),
    withAiAnswerCache(key, 10000, producer)
  ]);
  assert.equal(calls, 1, 'the duplicate must not spend a second model call');
  assert.equal(a.value.answer, 'یک پاسخ');
  assert.equal(b.value.answer, 'یک پاسخ');
});

test('a disabled cache is a pass-through — every turn goes live', async () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'بدون کش', locale: 'fa' });
  let calls = 0;
  const producer = async () => { calls += 1; return { answer: 'زنده' }; };
  await withAiAnswerCache(key, 10000, producer, { enabled: false });
  await withAiAnswerCache(key, 10000, producer, { enabled: false });
  assert.equal(calls, 2, 'a disabled cache must never serve a stored answer');
});

/* -------------------------------------------------------------------------- */
/*  F. THE KILL SWITCH AND THE REPORT                                         */
/* -------------------------------------------------------------------------- */

test('the kill switch reads the environment', () => {
  assert.equal(aiAnswerCacheEnabled({ AI_ANSWER_CACHE: '0' }), false);
  assert.equal(aiAnswerCacheEnabled({ AI_ANSWER_CACHE: 'off' }), false);
  assert.equal(aiAnswerCacheEnabled({ AI_ANSWER_CACHE: 'false' }), false);
  assert.equal(aiAnswerCacheEnabled({ AI_ANSWER_CACHE: '1' }), true);
  assert.equal(aiAnswerCacheEnabled({}), true, 'the cache is on by default');
});

test('the report tells the operator what the cache is doing', async () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'گزارش', locale: 'fa' });
  await withAiAnswerCache(key, 10000, async () => ({ answer: 'x' }));
  await withAiAnswerCache(key, 10000, async () => ({ answer: 'x' }));
  const report = aiAnswerCacheStats();
  assert.equal(report.schema, 'fbt.ai-answer-cache.v1');
  assert.ok(report.hits >= 1, 'the hit must be counted');
  assert.ok(report.hitRate > 0, 'the hit rate is the number that matters');
  assert.equal(report.envVar, 'AI_ANSWER_CACHE');
});

test('clearing the cache empties it and resets the counters', async () => {
  reset();
  const key = aiAnswerCacheKey({ question: 'پاک‌سازی', locale: 'fa' });
  aiAnswerCacheSet(key, { answer: 'x' }, 10000);
  assert.ok(aiAnswerCacheStats().entries > 0);
  __clearAiAnswerCacheForTests();
  const after = aiAnswerCacheStats();
  assert.equal(after.entries, 0);
  assert.equal(after.hits, 0);
  assert.equal(after.stores, 0);
});
