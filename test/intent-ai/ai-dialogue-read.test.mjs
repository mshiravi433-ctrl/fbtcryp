/**
 * «درک سؤال و جواب با کاربر را باهوش‌تر کن» — the DIALOGUE CONTRACT.
 * ---------------------------------------------------------------------------
 * The social read answers «چه کسی این را می‌پرسد؟». This layer answers the two
 * things that decide whether the answer is about the right thing:
 *
 *   · WHAT IS BEING ASKED — the shape. «چرا» wants a mechanism, «چقدر» wants a
 *     number, «کدوم بهتره» wants a comparison with a verdict, «یعنی چی» wants a
 *     definition. Answering a why-question with a checklist, or a quantity
 *     question with «بستگی دارد», is answering a different question.
 *
 *   · WHAT THE TURN IS DOING — its act. A correction («نه، اشتباه گفتی») is not
 *     a new question; answering it as one repeats the wrong thing louder. An
 *     elliptical follow-up («چرا؟», «همون رو بیشتر توضیح بده») points at
 *     something already said; a reply that starts fresh has dropped the thread.
 *
 * The checks are narrow and deterministic: each fires only when the ask is
 * unambiguous and the answer lacks the ONE element that ask cannot do without.
 * Both `max` and `balanced` send the contract on substantive turns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIALOGUE_READ_SCHEMA,
  readDialogue,
  renderDialogueBrief,
  checkDialogueCompliance,
  renderDialogueDeficit
} from '../../src/lib/intent-ai/os/conversation/dialogueRead.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const HISTORY = 'قیمت BTC حدود ۶۸٬۰۰۰ دلار است و نقدینگی بازار ضعیف شده است.';

/* -------------------------------------------------------------------------- */
/*  A. THE ASK                                                                */
/* -------------------------------------------------------------------------- */

test('the shape of the question is read, not guessed from keywords alone', () => {
  const shapeOf = (message) => readDialogue({ message }).askShape;
  assert.equal(shapeOf('قیمت بیت‌کوین چنده؟'), 'QUANTITY');
  assert.equal(shapeOf('چرا BTC این هفته ریخت؟'), 'CAUSAL');
  assert.equal(shapeOf('کدوم بهتره، BTC یا ETH؟'), 'COMPARISON');
  assert.equal(shapeOf('یعنی چی صرافی غیرمتمرکز؟'), 'DEFINITION');
  assert.equal(shapeOf('چطور سرمایه‌ام را تقسیم کنم؟'), 'METHOD');
  assert.equal(shapeOf('آیا الان بخرم؟'), 'YES_NO');
  assert.equal(shapeOf('پیش‌بینی می‌کنی BTC تا ماه آینده چه شود؟'), 'PREDICTION');
  assert.equal(shapeOf('یک تحلیل کلی از بازار بده.'), 'OPEN');
});

test('the act of the turn is separate from its shape', () => {
  assert.equal(readDialogue({ message: 'نه، اشتباه گفتی؛ گفتی کارمزد صفره' }).act, 'CORRECTION');
  assert.equal(readDialogue({ message: 'چرا؟', history: HISTORY }).act, 'FOLLOW_UP');
  assert.equal(readDialogue({ message: 'همون رو بیشتر توضیح بده', history: HISTORY }).act, 'FOLLOW_UP');
  assert.equal(readDialogue({ message: 'ممنون، کاری نیست' }).act, 'CLOSING');
  assert.equal(readDialogue({ message: 'همه پولمو از دست دادم، دیگه فایده‌ای نداره' }).act, 'DISTRESS');
  /* A full question that happens to contain «چرا» is not a follow-up. */
  assert.equal(readDialogue({ message: 'چرا BTC ریخت؟', history: HISTORY }).act, 'QUESTION');
});

test('a follow-up resolves to the concrete thing that was said, not to a category', () => {
  const read = readDialogue({ message: 'چرا؟', history: HISTORY });
  assert.equal(read.applicable, true);
  assert.ok(read.referent.words.includes('نقدینگی'), `expected a specific referent, got ${read.referent.words.join(',')}`);
  assert.equal(read.referent.words.includes('قیمت'), false, 'a generic topic word is not a referent');
});

test('social turns and distress are never gated', () => {
  for (const message of ['سلام', 'مرسی دستت درد نکنه', 'همه پولمو از دست دادم']) {
    const read = readDialogue({ message });
    assert.equal(read.applicable, false, message);
    assert.equal(renderDialogueBrief(read), '', message);
  }
});

test('the contract says what this turn needs, in the model prompt', () => {
  const causal = renderDialogueBrief(readDialogue({ message: 'چرا BTC ریخت؟' }));
  assert.match(causal, /DIALOGUE CONTRACT/);
  assert.match(causal, /WHY/);

  const quantity = renderDialogueBrief(readDialogue({ message: 'قیمت BTC چنده؟' }));
  assert.match(quantity, /HOW MUCH/);

  const correction = renderDialogueBrief(readDialogue({ message: 'نه، اشتباه گفتی؛ گفتی کارمزد صفره' }));
  assert.match(correction, /CORRECTING/);

  assert.equal(renderDialogueBrief(readDialogue({ message: 'یک تحلیل کلی از بازار بده.' })), '');
});

/* -------------------------------------------------------------------------- */
/*  B. THE ANSWER THAT MATCHES IT                                             */
/* -------------------------------------------------------------------------- */

test('a why-question answered without a mechanism is flagged', () => {
  const read = readDialogue({ message: 'چرا BTC ریخت؟' });
  const checklist = checkDialogueCompliance({
    read,
    answer: 'سه عامل مهم وجود دارد: حجم، نوسان و اخبار. هر سه را باید بررسی کرد.'
  });
  assert.equal(checklist.compliant, false);
  assert.deepEqual(checklist.issues.map((i) => i.id), ['CAUSAL_WITHOUT_MECHANISM']);
  assert.match(renderDialogueDeficit(checklist), /DIALOGUE DEFICIT/);

  const mechanism = checkDialogueCompliance({
    read,
    answer: 'چون نقدینگی بازار نازک شده، هر سفارش فروش بزرگ قیمت را بیشتر پایین می‌آورد.'
  });
  assert.equal(mechanism.compliant, true);
  assert.equal(renderDialogueDeficit(mechanism), '');
});

test('a quantity question answered with «بستگی دارد» is flagged', () => {
  const read = readDialogue({ message: 'قیمت BTC چنده؟' });
  const vague = checkDialogueCompliance({ read, answer: 'بستگی به بازار دارد و باید صبر کرد.' });
  assert.equal(vague.compliant, false);
  assert.deepEqual(vague.issues.map((i) => i.id), ['QUANTITY_WITHOUT_NUMBER']);

  assert.equal(checkDialogueCompliance({ read, answer: 'حدود ۶۸٬۰۰۰ دلار است.' }).compliant, true);
});

test('a which-is-better question answered with two descriptions is flagged', () => {
  const read = readDialogue({ message: 'کدوم بهتره، BTC یا ETH؟' });
  const both = checkDialogueCompliance({ read, answer: 'BTC بزرگ‌ترین شبکه است. ETH قراردادهای هوشمند دارد.' });
  assert.equal(both.compliant, false);
  assert.deepEqual(both.issues.map((i) => i.id), ['COMPARISON_WITHOUT_CONTRAST']);

  const verdict = checkDialogueCompliance({ read, answer: 'برای این هدف ETH بهتر است، اما نوسانش از BTC بیشتر است.' });
  assert.equal(verdict.compliant, true);
});

test('an ignored correction is flagged; an acknowledged one is not', () => {
  const read = readDialogue({ message: 'نه، اشتباه گفتی؛ گفتی کارمزد صفره' });
  const ignored = checkDialogueCompliance({ read, answer: 'کارمزد در این صرافی ۰٫۷٪ است.' });
  assert.equal(ignored.compliant, false);
  assert.deepEqual(ignored.issues.map((i) => i.id), ['CORRECTION_IGNORED']);

  const acknowledged = checkDialogueCompliance({
    read,
    answer: 'حق با شماست؛ کارمزد صفر نبود. کارمزد رفت‌وبرگشت ۱٫۴٪ است.'
  });
  assert.equal(acknowledged.compliant, true);
});

test('a follow-up that starts a new topic is flagged', () => {
  const read = readDialogue({ message: 'چرا؟', history: HISTORY });
  const fresh = checkDialogueCompliance({ read, answer: 'به طور کلی بازارهای مالی چرخه‌ای هستند و باید صبور بود.' });
  assert.equal(fresh.compliant, false);
  assert.ok(fresh.issues.some((i) => i.id === 'REFERENT_UNRESOLVED'));

  const grounded = checkDialogueCompliance({
    read,
    answer: 'چون نقدینگی بازار ضعیف شده بود؛ عمق دفتر سفارش کم بود و فروش‌ها قیمت را جابه‌جا کردند.'
  });
  assert.equal(grounded.compliant, true);
});

test('a non-gated turn is compliant by construction', () => {
  const read = readDialogue({ message: 'سلام' });
  const out = checkDialogueCompliance({ read, answer: 'سلام!' });
  assert.equal(out.compliant, true);
  assert.deepEqual(out.issues, []);
  assert.equal(out.schema, DIALOGUE_READ_SCHEMA);
});

/* -------------------------------------------------------------------------- */
/*  C. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const CHECKLIST_ANSWER = 'سه عامل مهم وجود دارد: حجم معاملات، نوسان بازار و اخبار کلان. هر سه را باید جدا بررسی کرد و '
  + 'در نهایت با هم جمع‌بندی کرد تا تصویر کامل شود. توصیه می‌شود هر عامل را در بازه‌های زمانی مختلف نگاه کنید.';

function makeFleet({ finalAnswer = CHECKLIST_ANSWER } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: نقدینگی ضعیف است و حجم کم.', claims: [], uncertainty: 'داده کم است' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer'))
  };
}

test('max: a why-question carries the contract to the model and the deficit to the reviewer', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'چرا قیمت BTC این هفته ۱۲٪ ریخت؟ علت اصلی چیست؟',
    locale: 'fa',
    context: { market: { priceMap: { BTC: 68000 }, dataStatus: 'live' }, conversationSummary: HISTORY },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.match(fleet.finalCalls()[0].system, /DIALOGUE CONTRACT/);
  assert.match(fleet.finalCalls()[0].system, /WHY/);
  assert.match(fleet.critiqueCalls()[0].message, /DIALOGUE DEFICIT/);

  assert.equal(out.dialogue.schema, DIALOGUE_READ_SCHEMA);
  assert.equal(out.dialogue.askShape, 'CAUSAL');
  assert.equal(out.dialogue.compliant, false);
  assert.deepEqual(out.dialogue.issues, ['CAUSAL_WITHOUT_MECHANISM']);
});

test('max: a mechanism answer passes, and the reply reports it', async () => {
  const fleet = makeFleet({
    finalAnswer: 'چون نقدینگی بازار نازک شده بود، هر فروش بزرگ قیمت را جابه‌جا کرد: عمق دفتر سفارش کم بود و '
      + 'سفارش‌های بازار در سطح‌های نازک اجرا شدند. همین باعث شد افت سریع‌تر از حد معمول شود.'
  });
  const out = await runCollaborativeAnalysis({
    message: 'چرا قیمت BTC این هفته ریخت؟',
    locale: 'fa',
    context: { conversationSummary: HISTORY },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.dialogue.compliant, true);
  assert.deepEqual(out.dialogue.issues, []);
  assert.equal(fleet.critiqueCalls()[0].message.includes('DIALOGUE DEFICIT'), false);
});

test('balanced: the dialogue contract follows the question', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'چرا قیمت BTC این هفته ریخت؟',
    locale: 'fa',
    context: { conversationSummary: HISTORY },
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.dialogue.askShape, 'CAUSAL');
  assert.ok(fleet.calls.some(call => call.system.includes('DIALOGUE CONTRACT')));
});

test('a distress turn is exempt even in max', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'همه پولمو از دست دادم، دیگه فایده‌ای نداره',
    locale: 'fa',
    context: { conversationSummary: HISTORY },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.dialogue, null);
  for (const call of fleet.calls) assert.equal(call.system.includes('DIALOGUE CONTRACT'), false);
});
