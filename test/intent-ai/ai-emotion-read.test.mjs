/**
 * «هوش مصنوعی باید بقدری باهوش باشد که احساسات را متوجه شود»
 * ---------------------------------------------------------------------------
 * `socialRead` already gives one label per message (hostile, anxious, confused).
 * One label is not a feeling: a person can be grieving, ashamed and still
 * hoping, and those states owe different answers.
 *
 *   «همه پولمو از دست دادم»  → acknowledge, no advice, no «نگران نباش»
 *   «چقدر احمقم که فروختم»   → separate the decision from their worth
 *   «برنامه‌تون خراب شد»      → no grovelling, no defensiveness
 *   «خیالم راحت شد»           → do not dampen it
 *
 * `server/aiEmotionRead.js` reads the emotion deterministically (three axes,
 * mixed states, self- vs other-directed, cause, trajectory, needs), renders the
 * obligations, and then holds the draft to four narrow checks. These tests pin
 * the reading, the contract, the checks with their exemptions, and the wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMOTION_SCHEMA,
  readEmotion,
  renderEmpathyContract,
  checkEmotionTone,
  renderEmotionDeficit
} from '../../server/aiEmotionRead.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

/* -------------------------------------------------------------------------- */
/*  A. THE READ                                                               */
/* -------------------------------------------------------------------------- */

const read = (message, extra = {}) => readEmotion({ message, ...extra });

test('each feeling is read as itself, not as one generic "negative"', () => {
  assert.equal(read('همه پولمو از دست دادم').primary, 'grief');
  assert.equal(read('خیلی می‌ترسم پولم بسوزه').primary, 'fear');
  assert.equal(read('برنامه‌تون مزخرفه و کلاهبردارید').primary, 'anger');
  assert.equal(read('چقدر احمقم که فروختم').primary, 'shame');
  assert.equal(read('بالاخره خوب شد، خیالم راحت شد').primary, 'relief');
  assert.equal(read('خوشحالم، ETH پرواز کرد').primary, 'joy');
  assert.equal(read('خسته شدم، دیگه نمی‌کشم').primary, 'burnout');
  assert.equal(read('هیچ‌کس نیست، تنهام').primary, 'loneliness');
  assert.equal(read('امیدوارم سال بعد بهتر شه').primary, 'hope');
  assert.equal(read('BTC چنده؟').primary, 'neutral');
});

test('intensity comes from the words, not from the topic', () => {
  const plain = read('نگرانم');
  const strong = read('خیلی نگرانم و استرس دارم');
  const soft = read('کمی نگرانم');
  assert.ok(strong.intensity > plain.intensity);
  assert.ok(soft.intensity < plain.intensity);
  assert.equal(read('BTC چنده؟').intensity, 0);
});

test('a negated feeling is not a feeling', () => {
  const notWorried = read('نگران نیستم، فقط می‌خوام قیمت رو بدونم');
  assert.ok(notWorried.intensity < 0.35);
  assert.equal(renderEmpathyContract(notWorried), '');
  assert.equal(checkEmotionTone({ read: notWorried, answer: 'BTC ۶۸ هزار است.' }).applicable, false);
});

test('despair is acute even when the sentence is short', () => {
  const despair = read('همه پولمو از دست دادم');
  assert.equal(despair.acute, true);
  assert.ok(despair.intensity >= 0.55);
  assert.ok(despair.needs.includes('no_advice_yet'));

  assert.equal(read('ناراحت شدم که دیر رسیدم').acute, false);
});

test('mixed feelings are held, not flattened', () => {
  const mixed = read('امیدوارم ولی خیلی می‌ترسم');
  assert.ok(['hope', 'fear'].includes(mixed.primary));
  assert.ok(mixed.mixed.length >= 1);
  assert.match(renderEmpathyContract(mixed), /mixed feelings/);
});

test('shame is self-directed; anger points at who caused it', () => {
  const shame = read('تقصیر خودم بود، چقدر خنگم');
  assert.equal(shame.selfDirected, true);
  assert.equal(shame.cause, 'self');
  assert.ok(shame.needs.includes('no_lecture'));

  const atPlatform = read('برنامه‌تون خراب شد و پشتیبانی جواب نمی‌دهد، مسخره‌ست');
  assert.equal(atPlatform.primary, 'anger');
  assert.equal(atPlatform.cause, 'platform');

  const atMarket = read('بازار ریخت و حالم گرفته شد');
  assert.equal(atMarket.primary, 'grief');
  assert.equal(atMarket.cause, 'market');
});

test('the three axes move together, and fear at high intensity is acute', () => {
  const fear = read('خیلی می‌ترسم همه‌چیو از دست بدم');
  assert.ok(fear.valence < 0);
  assert.ok(fear.arousal > 0.5);
  assert.ok(fear.arousal <= 1);
  assert.equal(fear.acute, true);

  const joy = read('خوشحالم، عالیه');
  assert.ok(joy.valence > 0);
});

test('the trajectory uses the history, and never invents a feeling', () => {
  const rising = read('هنوز نگرانم و می‌ترسم', { history: 'کاربر گفت نگران ضرر است و استرس دارد' });
  assert.equal(rising.trajectory, 'rising');

  const cooling = read('باشه، ممنون', { history: 'کاربر عصبانی بود و از ضرر حرف می‌زد' });
  assert.equal(cooling.trajectory, 'cooling');

  assert.equal(read('BTC چنده؟').trajectory, 'unknown');
});

/* -------------------------------------------------------------------------- */
/*  B. THE CONTRACT                                                           */
/* -------------------------------------------------------------------------- */

test('grief gets acknowledgement and no plan; a neutral turn gets nothing', () => {
  const grief = renderEmpathyContract(read('همه پولمو از دست دادم، دیگه فایده‌ای نداره'));
  assert.match(grief, /EMOTION READ/);
  assert.match(grief, /acknowledge the loss in ONE plain sentence/);
  assert.match(grief, /do not give trading advice/);
  assert.match(grief, /never use toxic positivity/);

  assert.equal(renderEmpathyContract(read('BTC چنده؟')), '');
  assert.equal(renderEmpathyContract(read('کمی نگرانم')), '');
  assert.equal(renderEmpathyContract(null), '');
});

test('shame is separated from worth; anger is answered without defence', () => {
  const shame = renderEmpathyContract(read('چقدر احمقم که فروختم'));
  assert.match(shame, /Separate the decision from their worth/);
  assert.match(shame, /never agree that they are stupid/);

  const anger = renderEmpathyContract(read('برنامه‌تون دوباره خراب شد، مزخرفه'));
  assert.match(anger, /do not grovel, do not defend yourself/);

  const relief = renderEmpathyContract(read('بالاخره خوب شد، خیالم راحت شد'));
  assert.match(relief, /do not dampen it/);

  const burnout = renderEmpathyContract(read('خسته شدم، دیگه نمی‌کشم'));
  assert.match(burnout, /smallest next step/);
});

test('escalation and high intensity change pacing, not just wording', () => {
  const acute = renderEmpathyContract(read('خیلی می‌ترسم و استرس دارم', { history: 'نگران بود و از ضرر می‌گفت' }));
  assert.match(acute, /keep sentences short/);
  assert.match(acute, /escalating across turns/);
});

/* -------------------------------------------------------------------------- */
/*  C. THE CHECKS                                                             */
/* -------------------------------------------------------------------------- */

const GRIEF = read('همه پولمو از دست دادم، دیگه فایده‌ای نداره');

test('toxic positivity and moralising are HIGH on an acute grief turn', () => {
  const bad = checkEmotionTone({
    read: GRIEF,
    answer: 'نگران نباش، همه چی خوب میشه. باید صبور باشی و بیشتر دقت کنی.'
  });
  assert.equal(bad.compliant, false);
  assert.ok(bad.issues.some((i) => i.id === 'TOXIC_POSITIVITY'));
  assert.ok(bad.issues.some((i) => i.id === 'MORALISING'));
  assert.match(renderEmotionDeficit(bad), /EMOTION VIOLATIONS/);

  const good = checkEmotionTone({
    read: GRIEF,
    answer: 'واقعاً متأسفم. این ضرر سنگینی است و حق داری ناراحت باشی. امروز تصمیم معاملاتی نگیر و با یک آدم مطمئن حرف بزن.'
  });
  assert.equal(good.compliant, true);
  assert.equal(renderEmotionDeficit(good), '');
});

test('confirming self-blame is its own violation', () => {
  const shame = read('چقدر احمقم که فروختم، تقصیر خودم بود');
  const bad = checkEmotionTone({ read: shame, answer: 'اشتباه تو بود و باید بیشتر دقت می‌کردی.' });
  assert.ok(bad.issues.some((i) => i.id === 'SELF_BLAME_CONFIRMED'));

  const good = checkEmotionTone({
    read: shame,
    answer: 'این یک تصمیم بد بود، نه یک آدم بد. متأسفم که این‌طور شد؛ بگو چه شد تا با هم ببینیم کجای تصمیم اشتباه بود.'
  });
  assert.equal(good.issues.some((i) => i.id === 'SELF_BLAME_CONFIRMED'), false);
});

test('an acute state answered with content and no acknowledgement is caught', () => {
  const fear = read('خیلی می‌ترسم همه‌چیو از دست بدم');
  const cold = checkEmotionTone({ read: fear, answer: 'BTC امروز ۲٪ ریزش کرده و حجم پایین است.' });
  assert.ok(cold.issues.some((i) => i.id === 'NO_ACKNOWLEDGEMENT'));

  const warm = checkEmotionTone({ read: fear, answer: 'می‌فهمم این ترس واقعی است. BTC امروز ۲٪ ریزش کرده و حجم پایین است.' });
  assert.equal(warm.issues.some((i) => i.id === 'NO_ACKNOWLEDGEMENT'), false);
});

test('trading advice has no place in grief', () => {
  const advice = checkEmotionTone({ read: GRIEF, answer: 'متأسفم. به نظرم الان BTC بخر تا جبران شود.' });
  assert.ok(advice.issues.some((i) => i.id === 'ADVICE_IN_GRIEF'));

  /* A statement of fact is not advice. */
  const fact = checkEmotionTone({ read: GRIEF, answer: 'متأسفم. قیمت BTC همین حالا ۶۸٬۴۰۰ دلار است.' });
  assert.equal(fact.issues.some((i) => i.id === 'ADVICE_IN_GRIEF'), false);
});

test('a calm turn is never nagged', () => {
  const calm = read('BTC چنده؟');
  assert.equal(checkEmotionTone({ read: calm, answer: 'BTC ۶۸ هزار است.' }).applicable, false);
  assert.equal(checkEmotionTone({ read: null, answer: 'متن' }).compliant, true);
  assert.equal(checkEmotionTone({ read: GRIEF, answer: '' }).applicable, false);
  assert.equal(renderEmotionDeficit(null), '');

  /* Relief is positive: no acknowledgement is owed, nothing fires. */
  const relief = read('بالاخره خوب شد، خیالم راحت شد');
  const answer = checkEmotionTone({ read: relief, answer: 'خوبه که این‌طور شد. فقط حجم را یک هفته ببین.' });
  assert.equal(answer.compliant, true);
});

/* -------------------------------------------------------------------------- */
/*  D. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const GRIEF_TURN = 'همه پولمو از دست دادم، دیگه فایده‌ای نداره. چرا این اتفاق افتاد و تقصیر کی بود؟';

function makeFleet({ finalAnswer = 'واقعاً متأسفم. این ضرر سنگینی است و حق داری ناراحت باشی. ' } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: ضرر سنگین است و تصمیم فوری لازم نیست.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer')),
    emotionCalls: () => calls.filter((c) => c.system.includes('EMOTION READ'))
  };
}

test('max: the emotion contract reaches the roles and the reply publishes the read', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: GRIEF_TURN,
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.emotionCalls().length >= 2);
  assert.match(fleet.finalCalls()[0].system, /EMOTION READ/);
  assert.match(fleet.finalCalls()[0].system, /acknowledge the loss/);

  assert.equal(out.emotion.schema, EMOTION_SCHEMA);
  assert.equal(out.emotion.primary, 'grief');
  assert.equal(out.emotion.acute, true);
  assert.equal(out.emotion.compliant, true);
  assert.deepEqual(out.emotion.violations, []);
});

test('max: a cheerful platitude is sent back to the reviewer', async () => {
  const fleet = makeFleet({
    finalAnswer: 'نگران نباش، همه چی خوب میشه. باید صبور باشی و بیشتر دقت کنی. '
      + 'بازار همیشه بالا و پایین دارد و این طبیعی است. دفعهٔ بعد بهتر عمل می‌کنی و جبران می‌شود.'
  });
  const out = await runCollaborativeAnalysis({
    message: GRIEF_TURN,
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  const critique = fleet.critiqueCalls()[0].message;
  assert.match(critique, /EMOTION VIOLATIONS/);
  assert.match(critique, /TOXIC_POSITIVITY/);
  assert.equal(out.emotion.compliant, false);
  assert.ok(out.emotion.violations.includes('TOXIC_POSITIVITY'));
});

test('balanced: emotion read reaches the models', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: GRIEF_TURN,
    locale: 'fa',
    context: {},
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.ok(out.emotion);
  assert.ok(fleet.calls.some(call => call.system.includes('EMOTION READ')));
});
