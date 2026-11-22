/**
 * FBT INTENT OS — a failed turn may not read like a deaf assistant.
 * ---------------------------------------------------------------------------
 * The reported bubble was three lines long and none of them was true:
 *
 *   «نتوانستم این کار را کامل کنم. دارایی شما جابه‌جا نشده است.»   ← UNKNOWN copy
 *   «Service temporarily unavailable. Retrying...»                ← operator English
 *   «مطمئن نشدم دقیقاً کدام بخش را می‌خواهید…»                    ← OS reading
 *
 * They were assembled CLIENT-SIDE from one non-ok response: the code was
 * `AI_RATE_LIMITED`, which had no copy (→ UNKNOWN), and the recovery helper
 * classified it TRANSIENT by default (→ English "Retrying", while the retry it
 * named was itself a 429).
 *
 * These tests pin the three things that turned one throttle into a broken
 * assistant: the throttle must be honest and NOT retried, no Persian bubble may
 * contain operator English, and a transport/throttle failure may not staple the
 * "I did not understand" line under a question that was never read locally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { humanizeError } from '../../src/lib/intent-ai/errorHumanizer.js';
import { readPartialInput } from '../../src/lib/intent-ai/os/conversation/partialInput.js';
import { partialReadingLine, withPartialReading } from '../../src/lib/intent-ai/humanResponse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const componentSource = readFileSync(join(ROOT, 'src/components/IntentAIUnified.jsx'), 'utf8');
const clientSource = readFileSync(join(ROOT, 'src/lib/aiIntentClient.js'), 'utf8');

const OPERATOR_ENGLISH = [
  'Service temporarily unavailable',
  'temporarily unavailable',
  'Retrying...',
  'Retrying…',
  'Unknown error',
  'undefined'
];

/* -------------------------------------------------------------------------- */
/*  1. THE THROTTLE IS NAMED, EXPLAINED AND NOT RETRIED                       */
/* -------------------------------------------------------------------------- */

test('a 429 is humanized in the user’s language, not through UNKNOWN', () => {
  for (const code of ['AI_RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMIT', 'TOO_MANY_REQUESTS', 429]) {
    const human = humanizeError(code, { locale: 'fa' });
    assert.equal(human.code, 'RATE_LIMITED', String(code));
    assert.notEqual(human.message, humanizeError('UNKNOWN', { locale: 'fa' }).message, String(code));
    assert.match(human.message, /سهمیه|دقیقه/, String(code));
    /* The message must say the turn was NOT lost — that is the difference
       between a throttle and "the AI broke". */
    assert.match(human.message, /از دست نرفته/, String(code));
    assert.equal(human.retry, false, 'a 429 will be a 429 again in 800 ms');
  }
});

test('the English copy of the same code exists for the English UI', () => {
  const human = humanizeError('AI_RATE_LIMITED', { locale: 'en' });
  assert.match(human.message, /allowance/i);
  assert.match(human.message, /not lost/i);
});

test('a fleet that answered nothing has its own honest code', () => {
  const human = humanizeError('AI_UNAVAILABLE', { locale: 'fa' });
  assert.equal(human.code, 'AI_UNAVAILABLE');
  assert.match(human.message, /مدل/);
  /* It must not blame the question. */
  assert.doesNotMatch(human.message, /نفهمیدم|متوجه نشدم/);
});

/* -------------------------------------------------------------------------- */
/*  2. NO OPERATOR ENGLISH REACHES A PERSIAN BUBBLE                           */
/* -------------------------------------------------------------------------- */

test('every failure code the AI surface can produce speaks Persian', () => {
  const codes = [
    'AI_RATE_LIMITED', 'AI_UNAVAILABLE', 'NETWORK_UNAVAILABLE', 'TIMEOUT', 'UNKNOWN',
    'PROVIDER_FAILED', 'WALLET_REQUIRED', 'VALIDATION_FAILED', 'EMPTY_PORTFOLIO',
    'EXECUTION_FAILED', 0, 500, 502, 503, 504, undefined, null
  ];
  for (const code of codes) {
    const message = humanizeError(code, { locale: 'fa' }).message;
    assert.ok(message && message.trim().length > 8, `empty copy for ${String(code)}`);
    for (const phrase of OPERATOR_ENGLISH) {
      assert.ok(!message.includes(phrase), `${String(code)} leaked "${phrase}"`);
    }
  }
});

test('the chat component no longer prints the operator recovery line', () => {
  /* The bubble used to append `toolChecker.getRecoveryMessage(...)`, which
     speaks to an operator. The call is gone from the render path. */
  assert.ok(!/toolChecker\.getRecoveryMessage\s*\(/.test(componentSource), 'getRecoveryMessage still called in the bubble path');
  assert.ok(!/temporarily unavailable/.test(componentSource), 'operator copy hard-coded in the component');
});

test('the component refuses to auto-retry a throttle', () => {
  assert.match(componentSource, /const rateLimited =/);
  const retrySource = readFileSync(join(ROOT, 'src/lib/aiChatRetry.js'), 'utf8');
  assert.match(retrySource, /status !== 429/);
  /* And it publishes the wait the server sent, when there is one. */
  assert.match(componentSource, /res\?\.retryAfter/);
});

test('the client passes the server’s throttling fields through', () => {
  /* `retryAfter` only survives if the non-ok body is spread into the result. */
  assert.match(clientSource, /if \(!res\.ok\) return \{ ok: false, status: res\.status, \.\.\.json \};/);
});

/* -------------------------------------------------------------------------- */
/*  3. ONE FAILURE MAY NOT BECOME THREE LINES OF EXCUSES                      */
/* -------------------------------------------------------------------------- */

test('the OS reading is never stapled under a failed request', () => {
  assert.doesNotMatch(componentSource, /const localReading =/);
});

test('a carried-over asset is never read back as if the user said it', () => {
  /* One «تحلیل بیت کوین» used to make every later turn open with
     «اگر درست خوانده باشم، منظورت BTC است» — including «اخبار بازار امروز». */
  const carried = readPartialInput({ message: 'اخبار بازار امروز', locale: 'fa', context: { lastAssets: ['BTC'] } });
  assert.equal(carried.carriedAsset, 'BTC');
  assert.deepEqual(carried.ownAssets, []);
  assert.equal(withPartialReading('پاسخ واقعی', carried, { lang: 'fa' }), 'پاسخ واقعی');

  for (const message of ['اخبار بازار امروز', 'هدف مالی بساز', 'کمک', 'سود کردم؟', 'چرا هوش مصنوعی جواب نمیده؟']) {
    const read = readPartialInput({ message, locale: 'fa', context: { lastAssets: ['BTC'] } });
    assert.deepEqual(read.ownAssets, [], message);
    assert.ok(!partialReadingLine(read, 'fa').includes('BTC'), `${message} still echoed BTC`);
  }
});

test('an asset the user actually named is still read back to them', () => {
  const read = readPartialInput({ message: 'بیتکوین؟', locale: 'fa', context: {} });
  assert.deepEqual(read.ownAssets, ['BTC']);
  assert.match(partialReadingLine(read, 'fa'), /BTC/);
});

test('a follow-up still inherits the asset as context — just not as a quote', () => {
  const read = readPartialInput({ message: 'قیمتش چنده؟', locale: 'fa', context: { lastAssets: ['ETH'] } });
  assert.equal(read.carriedAsset, 'ETH');
  assert.ok(read.inferred.assets.includes('ETH'));
  assert.equal(withPartialReading('پاسخ', read, { lang: 'fa' }), 'پاسخ');
});

/* -------------------------------------------------------------------------- */
/*  4. «WHY DON'T YOU ANSWER?» IS A QUESTION, NOT A DEAD END                   */
/* -------------------------------------------------------------------------- */

test('a question about the assistant itself is answered by the product brain', async () => {
  const { answerProduct } = await import('../../server/aiProductBrain.js');
  const asked = answerProduct({ message: 'چرا هوش مصنوعی جواب نمیده؟', locale: 'fa' });
  assert.equal(asked.intent, 'self_status');
  assert.equal(asked.confidence, 'verified');
  /* It names the real causes instead of asking for an asset and a time window. */
  assert.match(asked.answer, /سهمیه/);
  assert.match(asked.answer, /مدل/);
  assert.doesNotMatch(asked.answer, /بازهٔ زمانی/);

  for (const message of ['کمک', 'help']) {
    const help = answerProduct({ message, locale: 'fa' });
    assert.equal(help.intent, 'help', message);
    assert.match(help.answer, /قابلیت/, message);
  }
});
