/**
 * «از نظر اجتماعی و درک درخواست و تحلیل درخواست و جواب باهوش‌ترش کن»
 * ---------------------------------------------------------------------------
 * Three reads already existed: `socialRead` (the person), `dialogueRead` (the
 * question's shape) and the domain frames (market, strategy, decision). None of
 * them answered the question a reviewer of answers has to ask:
 *
 *   What is the user holding when this answer ends — a verdict, a number, a
 *   plan with weights, a mechanism? Which facts does that deliverable require,
 *   and did the user give them — or is the answer about to invent a budget that
 *   was never mentioned, and open with «سؤال خوبی پرسیدی» instead of the
 *   verdict?
 *
 * `server/aiRequestPlan.js` answers it deterministically, and then holds the
 * draft to five narrow promises. These tests pin the plan's arithmetic, the
 * five checks, their exemptions, and the wiring — including that `balanced`
 * never sees a single line of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REQUEST_PLAN_SCHEMA,
  normalizeText,
  readAmount,
  analyzeRequest,
  renderRequestPlan,
  checkRequestPlan,
  renderRequestDeficit
} from '../../server/aiRequestPlan.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

/* -------------------------------------------------------------------------- */
/*  A. WHAT WAS ASKED                                                         */
/* -------------------------------------------------------------------------- */

test('the deliverable is what the user ends up holding, not the topic', () => {
  const d = (message) => analyzeRequest({ message }).deliverable;
  assert.equal(d('به نظرت BTC بخرم یا نه؟'), 'verdict');
  assert.equal(d('BTC یا ETH کدوم بهتره؟'), 'comparison');
  assert.equal(d('استراتژی سرمایه‌گذاری با ۲۰۰۰۰ دلار'), 'plan');
  assert.equal(d('قیمت ETH چنده؟'), 'number');
  assert.equal(d('چرا فاندینگ منفی شد؟'), 'explanation');
  assert.equal(d('چطور کیف پول بسازم؟'), 'steps');
  assert.equal(d('تحلیل BTC تا سه ماه آینده'), 'scenario');
  assert.equal(d('تحلیل بازار امروز'), 'analysis');
  assert.equal(d('وضعیت بازار چطوره؟'), 'analysis');
  assert.equal(d('FBT چیست؟'), 'fact');
  assert.equal(d(''), 'fact');
});

test('constraints are read as numbers, not as vibes', () => {
  const c = (message) => analyzeRequest({ message }).constraints;
  assert.equal(c('با ۲۰۰۰۰ دلار BTC بخرم؟').amountUsd, 20000);
  assert.equal(c('با ۵ میلیون تومان چی بخرم؟').amountUsd, 5000000);
  assert.equal(c('budget $5k').amountUsd, 5000);
  assert.equal(c('BTC بخرم یا نه؟').amountUsd, null);

  assert.equal(c('BTC تا شش ماه آینده').horizonDays, 180);
  assert.equal(c('تا سه ماه آینده').horizonDays, 90);
  assert.equal(c('بلندمدت BTC بخرم؟').horizonDays, 365);
  assert.equal(c('هفته آینده چه می‌شود؟').horizonDays, 7);
  assert.equal(c('BTC چنده؟').horizonDays, null);

  assert.equal(c('حداکثر ۲ درصد ریسک کن').riskLimitPct, 2);
  assert.equal(c('فقط ۵ درصد ضرر').riskLimitPct, 5);

  assert.equal(c('خیلی کوتاه بگو').format, 'short');
  assert.equal(c('مفصل توضیح بده').format, 'detailed');
  assert.equal(c('در جدول بگو').format, 'table');
});

test('Persian thousands and decimals survive normalisation', () => {
  /* The obvious first move — turn «٬» into a space — splits 10 000 into two
     numbers and every amount check downstream then sees "10". */
  assert.equal(normalizeText('۶۸٬۰۰۰ دلار'), '68000 دلار');
  assert.equal(normalizeText('۲٫۵ درصد'), '2.5 درصد');
  assert.deepEqual(readAmount('۶۸٬۰۰۰ دلار'), { value: 68000, unit: 'دلار' });
});

test('the missing slots are the ones the deliverable requires', () => {
  const miss = (message, context = {}) => analyzeRequest({ message, context }).missing;

  assert.deepEqual(miss('به نظرت BTC بخرم یا نه؟'), ['capital', 'horizon']);
  assert.deepEqual(miss('به نظرت BTC بخرم یا نه؟', { portfolio: { totalValueUsd: 2500 } }), ['horizon']);
  assert.deepEqual(miss('BTC با ۲۰۰۰ دلار تا سه ماه آینده بخرم؟'), []);

  assert.deepEqual(miss('استراتژی با ۲۰۰۰۰ دلار'), ['horizon', 'risk']);
  /* Two assets named: the comparison has what it needs. */
  assert.deepEqual(miss('BTC یا ETH کدوم بهتره؟'), []);
  /* One asset named, one not: the comparison is missing its second side. */
  assert.deepEqual(miss('BTC یا استیبل‌کوین کدوم بهتره؟'), ['assets_two']);
  assert.deepEqual(miss('قیمت BTC چنده؟'), []);
  assert.deepEqual(miss('FBT چیست؟'), []);
});

test('the plan knows who it is talking to', () => {
  const x = (message) => analyzeRequest({ message }).expertise;
  assert.equal(x('من تازه‌کارم، این یعنی چی؟'), 'beginner');
  assert.equal(x('مبتدی‌ام، به زبان ساده بگو'), 'beginner');
  assert.equal(x('اثر فاندینگ روی بیس و لیکوییدیشن چیه؟'), 'expert');
  assert.equal(x('BTC چنده؟'), 'mixed');
});

test('length is a promise, and a substantial deliverable has a floor', () => {
  const short = analyzeRequest({ message: 'BTC چنده؟ کوتاه بگو' });
  assert.equal(short.constraints.length, 'short');
  assert.equal(short.blueprint.maxSentences, 4);

  /* A short question about a plan is still a plan, not a one-liner. */
  const plan = analyzeRequest({ message: 'استراتژی BTC با ۲۰۰۰۰ دلار' });
  assert.equal(plan.constraints.length, 'medium');
  assert.ok(plan.blueprint.maxSentences >= 8);

  const detailed = analyzeRequest({ message: 'مفصل و با جزئیات دربارهٔ فاندینگ توضیح بده' });
  assert.equal(detailed.constraints.length, 'detailed');
  assert.ok(detailed.blueprint.maxSentences > short.blueprint.maxSentences);

  const urgent = analyzeRequest({ message: 'فوری بگو BTC چنده؟' });
  assert.equal(urgent.constraints.length, 'short');
});

test('the social read sets the stance, and distress removes the plan entirely', () => {
  const anxious = analyzeRequest({ message: 'نگرانم پولم بسوزه، BTC نگه دارم؟', social: { tone: 'anxious' } });
  assert.equal(anxious.stance.warmth, 'warm_brief');

  const hostile = analyzeRequest({ message: 'چرت و پرت میگی، BTC نگه دارم؟', social: { tone: 'hostile' } });
  assert.equal(hostile.stance.warmth, 'neutral_firm');

  const careless = analyzeRequest({ message: 'همه پولمو از دست دادم', social: { distress: true } });
  assert.equal(careless.stance.warmth, 'careful');
});

test('the rendered plan names the deliverable, the order and the missing slots', () => {
  const plan = analyzeRequest({ message: 'به نظرت BTC بخرم یا نه؟' });
  const text = renderRequestPlan(plan);
  assert.match(text, /REQUEST READ/);
  assert.match(text, /- deliverable: verdict/);
  assert.match(text, /- order: verdict/);
  assert.match(text, /not given by the user, and the answer must not invent it: capital, horizon/);
  assert.match(text, /ask at most ONE question/);
  assert.match(text, /- avoid:/);

  const beginner = renderRequestPlan(analyzeRequest({ message: 'تازه‌کارم، فاندینگ یعنی چی؟' }));
  assert.match(beginner, /the user is new/);

  const expert = renderRequestPlan(analyzeRequest({ message: 'اثر فاندینگ روی بیس و لیکوییدیشن' }));
  assert.match(expert, /specialist vocabulary/);

  assert.equal(renderRequestPlan(null), '');
  assert.equal(renderRequestPlan({ schema: 'other' }), '');
});

/* -------------------------------------------------------------------------- */
/*  B. THE FIVE PROMISES                                                      */
/* -------------------------------------------------------------------------- */

const VERDICT_PLAN = analyzeRequest({ message: 'به نظرت BTC بخرم یا نه؟' });

test('a preamble instead of the verdict is a HIGH violation', () => {
  const bad = checkRequestPlan({
    plan: VERDICT_PLAN,
    answer: 'سؤال خوبی پرسیدی. بستگی به شرایط دارد و باید همهٔ جوانب را بسنجیم.'
  });
  assert.equal(bad.compliant, false);
  assert.deepEqual(bad.issues.map((i) => i.id), ['FIRST_SENTENCE_HIDES_ANSWER', 'MISSING_SLOT_IGNORED']);
  assert.match(renderRequestDeficit(bad), /REQUEST PLAN VIOLATIONS/);

  const good = checkRequestPlan({
    plan: VERDICT_PLAN,
    answer: 'نخر؛ تا وقتی حجم برنگشته وارد نشو. اگر سرمایه و افق را بگویی، دقیق‌تر می‌گویم.'
  });
  assert.equal(good.compliant, true);
  assert.equal(renderRequestDeficit(good), '');
});

test('when a critical slot is missing, a single ask-back is allowed as the opener', () => {
  const askBack = checkRequestPlan({ plan: VERDICT_PLAN, answer: 'چقدر سرمایه داری و افقت چند ماه است؟' });
  assert.equal(askBack.compliant, true);

  /* With no missing slot there is nothing to ask about: the verdict is owed. */
  const full = analyzeRequest({ message: 'BTC با ۲۰۰۰ دلار تا سه ماه آینده بخرم یا نه؟' });
  assert.deepEqual(full.missing, []);
  const hedged = checkRequestPlan({ plan: full, answer: 'بستگی به شرایط دارد. باید بررسی کنیم.' });
  assert.ok(hedged.issues.some((i) => i.id === 'FIRST_SENTENCE_HIDES_ANSWER'));
});

test('a number question without a number in the first sentence is caught', () => {
  const plan = analyzeRequest({ message: 'قیمت ETH چنده؟' });
  const bad = checkRequestPlan({ plan, answer: 'قیمت اتریوم به شرایط بازار بستگی دارد و در حال تغییر است.' });
  assert.ok(bad.issues.some((i) => i.id === 'FIRST_SENTENCE_HIDES_ANSWER'));

  const good = checkRequestPlan({ plan, answer: 'ETH همین حالا ۳٬۲۵۰ دلار است (خوانش زندهٔ ابزار).' });
  assert.equal(good.compliant, true);
});

test('a budget the user never mentioned is an invented constraint', () => {
  const plan = analyzeRequest({ message: 'استراتژی سرمایه‌گذاری BTC را بنویس' });
  assert.ok(plan.missing.includes('capital'));

  const invented = checkRequestPlan({
    plan,
    answer: 'با ۱۰٬۰۰۰ دلار، ۶۰٪ BTC و ۴۰٪ ETH بخر و حد ضرر را ۸٪ بگذار. فرض می‌کنم افق یک سال است.'
  });
  assert.ok(invented.issues.some((i) => i.id === 'INVENTED_CONSTRAINT'));

  /* The user's own figure is fine, to the number. */
  const given = analyzeRequest({ message: 'استراتژی سرمایه‌گذاری BTC را با ۱۰۰۰۰ دلار بنویس' });
  const honest = checkRequestPlan({
    plan: given,
    answer: 'با ۱۰۰۰۰ دلار، ۶۰٪ BTC و ۴۰٪ ETH. فرض می‌کنم افق یک سال و ریسک ۲٪ است.'
  });
  assert.equal(honest.issues.some((i) => i.id === 'INVENTED_CONSTRAINT'), false);

  /* A price is not an allocation: «BTC 68,400 دلار است» must never fire. */
  const price = checkRequestPlan({
    plan,
    answer: 'BTC ۶۸٬۴۰۰ دلار است. فرض می‌کنم افق یک سال است.'
  });
  assert.equal(price.issues.some((i) => i.id === 'INVENTED_CONSTRAINT'), false);
});

test('a missing slot that is neither asked nor assumed is ignored', () => {
  const plan = analyzeRequest({ message: 'استراتژی BTC را بنویس' });
  const ignored = checkRequestPlan({ plan, answer: 'نصف سرمایه را BTC بگذار و نصف را استیبل‌کوین نگه دار.' });
  assert.ok(ignored.issues.some((i) => i.id === 'MISSING_SLOT_IGNORED'));

  const assumed = checkRequestPlan({ plan, answer: 'با فرض سرمایهٔ کوچک و افق یک سال: نصف BTC و نصف استیبل.' });
  assert.equal(assumed.issues.some((i) => i.id === 'MISSING_SLOT_IGNORED'), false);

  const asked = checkRequestPlan({ plan, answer: 'سرمایه‌ات چقدر است و چه افقی داری؟' });
  assert.equal(asked.issues.some((i) => i.id === 'MISSING_SLOT_IGNORED'), false);
});

test('«کوتاه بگو» is enforced, and a detailed request is not', () => {
  const plan = analyzeRequest({ message: 'تحلیل BTC را کوتاه بگو' });
  const long = checkRequestPlan({ plan, answer: Array.from({ length: 14 }, () => 'این جمله دربارهٔ بازار است.').join(' ') });
  assert.ok(long.issues.some((i) => i.id === 'LENGTH_OVERSHOOT'));

  const brief = checkRequestPlan({ plan, answer: 'BTC امروز ۲٪ ریزش کرده و حجم پایین است. سطح ۶۴ هزار را ببین.' });
  assert.equal(brief.compliant, true);

  const detailed = analyzeRequest({ message: 'مفصل دربارهٔ فاندینگ توضیح بده' });
  const longButAsked = checkRequestPlan({ plan: detailed, answer: Array.from({ length: 12 }, () => 'فاندینگ یعنی هزینهٔ نگه‌داشتن پوزیشن.').join(' ') });
  assert.equal(longButAsked.issues.some((i) => i.id === 'LENGTH_OVERSHOOT'), false);
});

test('jargon aimed at a beginner is flagged, and a gloss clears it', () => {
  const plan = analyzeRequest({ message: 'تازه‌کارم؛ فاندینگ و لیکوییدیشن یعنی چی؟' });
  assert.equal(plan.expertise, 'beginner');

  const bare = checkRequestPlan({ plan, answer: 'فاندینگ نرخ تبادل بین لانگ و شورت است و لیکوییدیشن بستن اجباری پوزیشن.' });
  assert.ok(bare.issues.some((i) => i.id === 'JARGON_WITHOUT_GLOSS'));

  const glossed = checkRequestPlan({
    plan,
    answer: 'فاندینگ (هزینهٔ دوره‌ای نگه‌داشتن پوزیشن) را می‌پردازی و لیکوییدیشن یعنی بسته‌شدن اجباری پوزیشن.'
  });
  assert.equal(glossed.issues.some((i) => i.id === 'JARGON_WITHOUT_GLOSS'), false);

  /* An expert reader is not lectured. */
  const expert = analyzeRequest({ message: 'اثر فاندینگ روی بیس و لیکوییدیشن' });
  const expertAnswer = checkRequestPlan({ plan: expert, answer: 'بیس مثبت است و ریسک لیکوییدیشن لانگ‌ها بالا رفته.' });
  assert.equal(expertAnswer.issues.some((i) => i.id === 'JARGON_WITHOUT_GLOSS'), false);
});

test('nothing to check means nothing to complain about', () => {
  const plan = analyzeRequest({ message: 'به نظرت BTC بخرم یا نه؟' });
  assert.equal(checkRequestPlan({ plan, answer: '' }).applicable, false);
  assert.equal(checkRequestPlan({ plan: null, answer: 'متن' }).compliant, true);
  assert.equal(renderRequestDeficit(null), '');
  /* A plain factual question owes no blueprint, so it is never nagged. */
  const fact = analyzeRequest({ message: 'FBT چیست؟' });
  assert.equal(checkRequestPlan({ plan: fact, answer: 'یک پلتفرم معاملاتی است.' }).applicable, false);
});

/* -------------------------------------------------------------------------- */
/*  C. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

/* Level 4 on purpose: the adversarial reviewer (and therefore the MUST-FIX
   path) only exists in the deep rung, and these tests are about that path. */
const REQUEST = 'به نظرت BTC بخرم یا نه؟ ریسکش چقدر است و چرا؟ استراتژی‌ام چه باشد؟';

const GOOD = 'نخر؛ تا وقتی حجم برنگشته وارد نشو. BTC امروز ۲٫۴٪ ریزش کرده و نسبت به ETH ضعیف‌تر بوده. '
  + 'اگر سرمایه و افق را بگویی، دقیق‌تر می‌گویم؛ فرض من این است که افق کوتاه است.';

function makeFleet({ finalAnswer = GOOD } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: بازار در فاز تثبیت است و نقدینگی متوسط است.', claims: [], uncertainty: 'داده کم است' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer')),
    plannedCalls: () => calls.filter((c) => c.system.includes('REQUEST READ'))
  };
}

test('max: every role receives the request plan, and the reply publishes it', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: REQUEST,
    locale: 'fa',
    context: { market: { dataStatus: 'live', change24hPct: -2.4, priceMap: { BTC: 68400, ETH: 3250, SOL: 150 } } },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.plannedCalls().length >= 2, 'the plan must reach more than one role');
  assert.match(fleet.finalCalls()[0].system, /REQUEST READ/);
  assert.match(fleet.finalCalls()[0].system, /not given by the user/);

  assert.equal(out.request.schema, REQUEST_PLAN_SCHEMA);
  assert.equal(out.request.deliverable, 'verdict');
  assert.ok(out.request.missing.includes('horizon'), 'no horizon was given, and it is required for a verdict');
  assert.equal(out.request.compliant, true);
  assert.deepEqual(out.request.violations, []);
});

test('max: a preamble-and-invented-budget draft is sent back to the reviewer', async () => {
  /* Long enough for the reviewer to run at all (a three-line draft is never
     handed to it), and still breaking two promises. */
  const fleet = makeFleet({
    finalAnswer: 'سؤال خوبی پرسیدی و بستگی به شرایط دارد. با ۱۰٬۰۰۰ دلار ۶۰٪ BTC و ۴۰٪ ETH بخر و حد ضرر را ۸٪ بگذار. '
      + 'بازار امروز در فاز تثبیت است و نقدینگی متوسط است. ریسک اصلی ریزش بیشتر و از دست رفتن حمایت است. '
      + 'در ادامه باید حجم را ببینیم و تصمیم بگیریم که ادامه بدهیم یا نه.'
  });
  const out = await runCollaborativeAnalysis({
    message: REQUEST,
    locale: 'fa',
    context: { market: { dataStatus: 'live', change24hPct: -2.4, priceMap: { BTC: 68400, ETH: 3250, SOL: 150 } } },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  const critique = fleet.critiqueCalls()[0].message;
  assert.match(critique, /REQUEST PLAN VIOLATIONS/);
  assert.match(critique, /FIRST_SENTENCE_HIDES_ANSWER/);
  assert.match(critique, /INVENTED_CONSTRAINT/);

  assert.equal(out.request.compliant, false);
  assert.ok(out.request.violations.includes('FIRST_SENTENCE_HIDES_ANSWER'));
});

test('max: a distress turn keeps the safety brief and drops the plan', async () => {
  const fleet = makeFleet({ finalAnswer: 'واقعاً متأسفم. این ضرر را تنها تحمل نکن و با یک آدم مطمئن حرف بزن.' });
  const out = await runCollaborativeAnalysis({
    message: 'همه پولمو از دست دادم، دیگه فایده‌ای نداره',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.request, null);
  for (const call of fleet.calls) {
    assert.equal(call.system.includes('REQUEST READ'), false);
  }
});

test('balanced: the request plan never reaches the models', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: REQUEST,
    locale: 'fa',
    context: { market: { dataStatus: 'live', change24hPct: -2.4, priceMap: { BTC: 68400 } } },
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.request, null);
  for (const call of fleet.calls) {
    assert.equal(call.system.includes('REQUEST READ'), false);
  }
});
