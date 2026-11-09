/**
 * «با توجه به گفتمان کاربر ادامه بده» — kind to kind, orders to orders,
 * swearing to swearing, and normal when nothing is readable.
 * ---------------------------------------------------------------------------
 * A person who writes «قربونت، لطف داری» and a person who writes «این بازار
 * گندش رو درآورد» are asking the same kind of question. Answering both in one
 * flat institutional voice fails both: the first reads as cold, the second as
 * being talked down to.
 *
 * `server/aiDiscourseMirror.js` reads the register and says how far the answer
 * may follow it — including profanity ABOUT THE SITUATION, which may be matched
 * at the user's own level once, and abuse AIMED AT THE ASSISTANT, which may not
 * be mirrored at all. Slurs are never mirrored, at any level. When nothing is
 * readable the renderer returns '' and the answer stays normal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCOURSE_SCHEMA,
  readDiscourse,
  renderDiscourseContract,
  checkDiscourseMirror,
  renderDiscourseDeficit
} from '../../server/aiDiscourseMirror.js';
import { readEmotion } from '../../server/aiEmotionRead.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';
import { planCollaboration } from '../../src/lib/intent-ai/os/collaborationRouter.js';

/* -------------------------------------------------------------------------- */
/*  A. THE READ                                                               */
/* -------------------------------------------------------------------------- */

const read = (message, extra = {}) => readDiscourse({ message, ...extra });

test('kindness, play, orders and swearing each read as themselves', () => {
  assert.equal(read('ممنون که جواب دادی، لطف داری').style, 'warm');
  assert.equal(read('😂 شوخی کردم، ولی جدی BTC چنده؟').style, 'playful');
  assert.equal(read('بگو الان BTC بخرم یا نه').style, 'commanding');
  assert.equal(read('این بازار گندش رو درآورد').style, 'charged');
  assert.equal(read('این بازار مزخرفه').style, 'frustrated');
  assert.equal(read('BTC چنده؟').style, 'neutral');
});

test('swearing about the situation is told apart from swearing at the assistant', () => {
  const atMarket = read('بازار گه خورد و همه چی ریخت');
  assert.equal(atMarket.profanity.level, 2);
  assert.equal(atMarket.profanity.targetedAtAssistant, false);
  assert.equal(atMarket.profanity.policy, 'match_at_level');

  const atBot = read('تو احمقی، گه خوردی با این جوابت');
  assert.equal(atBot.profanity.targetedAtAssistant, true);
  assert.equal(atBot.profanity.policy, 'do_not_mirror');

  /* Swearing at the product is the same case: it is aimed at us. */
  assert.equal(read('این برنامه مزخرفه و لعنتی کار نمی‌کنه').profanity.policy, 'do_not_mirror');
});

test('a slur is never a mirror, whatever else the message says', () => {
  const slur = read('با این کارت حرومزاده‌ای');
  assert.equal(slur.profanity.level, 3);
  assert.equal(slur.profanity.policy, 'never_slur');
});

test('a hurt person outranks a polite opener', () => {
  const message = 'ممنون که جواب دادی، ولی داغونم';
  assert.equal(read(message).style, 'warm');
  const emotion = readEmotion({ message: 'همه پولمو از دست دادم، دیگه فایده‌ای نداره' });
  assert.equal(read(message, { emotion }).style, 'hurt');
});

test('no readable register means normal — and costs nothing', () => {
  const neutral = read('BTC چنده؟');
  assert.equal(neutral.confidence, 'none');
  assert.equal(renderDiscourseContract(neutral), '');
  assert.equal(checkDiscourseMirror({ discourse: neutral, answer: 'BTC ۶۸ هزار است.' }).applicable, false);
});

test('energy follows punctuation and profanity', () => {
  assert.equal(read('BTC چنده؟!').energy, 'plain');
  assert.equal(read('این بازار گندش رو درآورد!!').energy, 'charged');
});

/* -------------------------------------------------------------------------- */
/*  B. THE CONTRACT                                                           */
/* -------------------------------------------------------------------------- */

test('warmth is mirrored, without flattery', () => {
  const text = renderDiscourseContract(read('ممنون، لطف داری. یه سؤال داشتم'));
  assert.match(text, /DISCOURSE/);
  assert.match(text, /they wrote warmly/);
  assert.match(text, /warmth is not flattery/);
  assert.match(text, /they did not swear/);
});

test('orders are answered in orders', () => {
  const text = renderDiscourseContract(read('بگو الان BTC بخرم یا نه'));
  assert.match(text, /they are giving orders/);
  assert.match(text, /Answer first, in the imperative mode/);
  assert.match(text, /no preamble/);
});

test('situational swearing may be matched at the same level, once', () => {
  const text = renderDiscourseContract(read('این بازار گندش رو درآورد، الان چیکار کنم؟'));
  assert.match(text, /their profanity is level 2 of 3 and is about the situation/);
  assert.match(text, /at most the SAME level, once/);
  assert.match(text, /Never stronger, never a slur, never at them, never gratuitous/);
});

test('abuse aimed at the assistant is not mirrored at all', () => {
  const text = renderDiscourseContract(read('تو احمقی، گه خوردی با این جوابت'));
  assert.match(text, /their swearing is aimed at you/);
  assert.match(text, /Do not mirror it, do not defend yourself, do not scold/);
});

test('a slur in the message forbids slurs in the answer', () => {
  const text = renderDiscourseContract(read('حرومزاده‌ای که پول منو خوردی'));
  assert.match(text, /must not repeat it or answer with any slur/);
});

test('a hurt turn forbids profanity even when the words are there', () => {
  const emotion = readEmotion({ message: 'همه پولمو از دست دادم، دیگه فایده‌ای نداره' });
  const hurt = read('ممنون، ولی گندش رو درآورد', { emotion });
  assert.equal(hurt.style, 'hurt');
  assert.match(renderDiscourseContract(hurt), /Warmth is welcome; profanity is not/);
});

/* -------------------------------------------------------------------------- */
/*  C. THE BOUNDARY                                                           */
/* -------------------------------------------------------------------------- */

test('a slur in the answer is HIGH, whatever the user wrote', () => {
  const discourse = read('این بازار گندش رو درآورد');
  const bad = checkDiscourseMirror({ discourse, answer: 'بازار کثافت‌کاری کرد، این حرومزاده‌ها...' });
  assert.ok(bad.issues.some((i) => i.id === 'SLUR_IN_ANSWER'));
  assert.match(renderDiscourseDeficit(bad), /DISCOURSE VIOLATIONS/);
});

test('answering abuse with abuse is HIGH', () => {
  const discourse = read('تو احمقی، گه خوردی با این جوابت');
  const bad = checkDiscourseMirror({ discourse, answer: 'خودت گه خوردی که اشتباه کردی.' });
  assert.ok(bad.issues.some((i) => i.id === 'MIRRORED_AT_ASSISTANT'));

  const calm = checkDiscourseMirror({ discourse, answer: 'اشتباه از من نبود، ولی بذار دقیق نشونت بدم کجای محاسبه فرق داشت.' });
  assert.equal(calm.compliant, true);
});

test('swearing at someone who did not swear is HIGH', () => {
  const discourse = read('ممنون، لطف داری. BTC چنده؟');
  const bad = checkDiscourseMirror({ discourse, answer: 'این بازار گه خورد، بذار بگم.' });
  assert.ok(bad.issues.some((i) => i.id === 'PROFANITY_WITHOUT_INVITATION'));
});

test('escalation above the user’s level is HIGH', () => {
  const discourse = read('این بازار مزخرفه، چیکار کنم؟');
  assert.equal(discourse.profanity.level, 1);
  const bad = checkDiscourseMirror({ discourse, answer: 'بازار گه خورد و کثافت‌کاری کرد.' });
  assert.ok(bad.issues.some((i) => i.id === 'MIRROR_ESCALATION'));
});

test('matching at the same level is allowed, and not required', () => {
  const discourse = read('این بازار گندش رو درآورد، الان چیکار کنم؟');
  assert.equal(checkDiscourseMirror({ discourse, answer: 'بازار واقعاً گه خورد؛ امروز فقط سطح ۶۴ هزار را ببین.' }).compliant, true);
  assert.equal(checkDiscourseMirror({ discourse, answer: 'بازار بد ریخت؛ امروز فقط سطح ۶۴ هزار را ببین.' }).compliant, true);
});

test('a formal notice to a warm message is caught, a warm answer is not', () => {
  const discourse = read('ممنون که جواب دادی، لطف داری');
  const cold = checkDiscourseMirror({ discourse, answer: 'لطفاً توجه داشته باشید که در پاسخ به درخواست شما باید گفت...' });
  assert.ok(cold.issues.some((i) => i.id === 'COLD_REPLY_TO_WARM_MESSAGE'));

  const warm = checkDiscourseMirror({ discourse, answer: 'خواهش می‌کنم، خوشحالم که به کارت می‌آید. سؤالت را بپرس.' });
  assert.equal(warm.compliant, true);
});

test('nothing readable means nothing to enforce', () => {
  assert.equal(checkDiscourseMirror({ discourse: null, answer: 'متن' }).compliant, true);
  assert.equal(checkDiscourseMirror({ discourse: read('BTC چنده؟'), answer: '۶۸ هزار.' }).applicable, false);
  assert.equal(renderDiscourseDeficit(null), '');
});

/* -------------------------------------------------------------------------- */
/*  D. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const WARM_TURN = 'ممنون که همیشه جواب می‌دی، لطف داری. استراتژی من با ۲۰۰۰۰ دلار چه باشد و ریسکش چقدر است؟ چرا؟';

function makeFleet({ finalAnswer = 'خواهش می‌کنم، لطف داری. ' } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: با ۲۰۰۰۰ دلار، تخصیص ۶۰/۴۰ و حد ضرر ۸٪.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer')),
    discourseCalls: () => calls.filter((c) => c.system.includes('DISCOURSE (match'))
  };
}

test('max: the register brief reaches the roles and the reply publishes it', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: WARM_TURN,
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.discourseCalls().length >= 2);
  assert.match(fleet.finalCalls()[0].system, /they wrote warmly/);

  assert.equal(out.discourse.schema, DISCOURSE_SCHEMA);
  assert.equal(out.discourse.style, 'warm');
  assert.equal(out.discourse.profanity.level, 0);
  assert.equal(out.discourse.compliant, true);
});

test('max: an institutional reply to a warm message is sent back to the reviewer', async () => {
  const fleet = makeFleet({
    finalAnswer: 'لطفاً توجه داشته باشید که در پاسخ به درخواست شما، تخصیص سرمایه به شرح زیر است. '
      + 'به استحضار می‌رساند که ریسک هر معامله باید محدود شود و مقتضی است حد ضرر تعیین گردد. '
      + 'بدینوسیله اعلام می‌شود که این پاسخ توصیهٔ مالی نیست و مسئولیت با شماست.'
  });
  const out = await runCollaborativeAnalysis({
    message: WARM_TURN,
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.match(fleet.critiqueCalls()[0].message, /DISCOURSE VIOLATIONS/);
  assert.match(fleet.critiqueCalls()[0].message, /COLD_REPLY_TO_WARM_MESSAGE/);
  assert.equal(out.discourse.compliant, false);
});

test('a warm opener with a real question is not answered as a thank-you', () => {
  const planned = planCollaboration({ message: WARM_TURN, intelligence: 'max' });
  assert.ok(planned.level >= 3, `expected a real level, got ${planned.level}`);
  assert.notEqual(planned.conversationKind, 'THANKS');

  /* A bare thank-you is still a thank-you. */
  assert.equal(planCollaboration({ message: 'ممنون، لطف کردی', intelligence: 'max' }).conversationKind, 'THANKS');
  assert.equal(planCollaboration({ message: 'سلام، چطوری؟', intelligence: 'max' }).conversationKind, 'GREETING');
});

test('balanced: no register brief reaches the models', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: WARM_TURN,
    locale: 'fa',
    context: {},
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.discourse, null);
  for (const call of fleet.calls) {
    assert.equal(call.system.includes('DISCOURSE (match'), false);
  }
});
