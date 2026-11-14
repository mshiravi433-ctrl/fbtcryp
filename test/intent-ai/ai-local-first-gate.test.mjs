/* THE LOCAL-FIRST GATE — the contract.
 *
 * The gate decides, BEFORE the first provider call, whether a question can
 * be answered from the repository's own verified corpus. When it can, the
 * turn spends ZERO provider calls; when it cannot, the turn is exactly what
 * it was before.
 *
 * These tests lock down BOTH directions, because a gate that is too eager
 * produces confident non-answers and a gate that is too timid produces
 * nothing but cost.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { evaluateLocalFirst, preEvaluateLocalFirst, localFirstGateEnabled, LOCAL_FIRST_MIN_SCORE } from '../../server/aiLocalFirstGate.js';
import { searchKnowledge } from '../../src/lib/intent-ai/os/knowledgeCenter.js';
import { planCollaboration } from '../../src/lib/intent-ai/os/collaborationRouter.js';

const planFor = (message) => planCollaboration({ message, locale: 'fa', intelligence: 'max' });

const evaluate = (message, opts = {}) => {
  const plan = opts.plan || planFor(message);
  const knowledge = opts.knowledge || searchKnowledge(message, { limit: 3 });
  return evaluateLocalFirst({ message, plan, knowledge, locale: 'fa', context: opts.context || {}, env: opts.env || {} });
};

test('the gate is on by default and can be switched off', () => {
  assert.equal(localFirstGateEnabled({}), true);
  assert.equal(localFirstGateEnabled({ AI_LOCAL_FIRST_GATE: '0' }), false);
  assert.equal(localFirstGateEnabled({ AI_LOCAL_FIRST_GATE: 'false' }), false);
  assert.equal(localFirstGateEnabled({ AI_LOCAL_FIRST_GATE: 'off' }), false);
  assert.equal(localFirstGateEnabled({ AI_LOCAL_FIRST_GATE: '1' }), true);
});

test('the gate answers a verified product fact from the corpus', () => {
  const r = evaluate('کارمزد پلتفرم FBT چقدر است');
  assert.equal(r.used, true, `expected a local answer, got: ${r.reason}`);
  assert.equal(r.reason, 'answered-from-verified-knowledge');
  assert.ok(r.answer.length > 40);
  /* The answer must be the VERIFIED figure, not a paraphrase of it. */
  assert.match(r.answer, /۰٫۷|0\.7|70\s*bps/i);
});

test('the gate answers a definitional question from the corpus', () => {
  const r = evaluate('بیت کوین چیست؟');
  assert.equal(r.used, true, `expected a local answer, got: ${r.reason}`);
  assert.ok(r.answer.length > 40);
});

test('the gate refuses a question that needs live data', () => {
  for (const q of ['قیمت بیت کوین چنده؟', 'بازار امروز چطور است؟']) {
    const r = evaluate(q);
    assert.equal(r.used, false, `"${q}" must not be answered locally`);
    assert.ok(['needs-live-data', 'needs-web-research'].includes(r.reason), `unexpected reason: ${r.reason}`);
  }
});

test('the gate refuses a question that asks for a judgement', () => {
  /* The corpus holds a definition of Bitcoin and a definition of entry
     risk. Neither is an assessment of THIS user's entry. */
  for (const q of [
    'با این داده، ریسک ورود به بیت‌کوین چیست؟',
    'آیا بخرم؟',
    'چه استراتژی برای نوسانی بودن بازار دارم؟',
    'پورتفوی من چطور است؟',
    'سناریوهای استراتژی بیت‌کوین چیست؟'
  ]) {
    const r = evaluate(q);
    assert.equal(r.used, false, `"${q}" must not be answered locally`);
    assert.equal(r.reason, 'judgement-question');
  }
});

test('the gate refuses a multi-part question even when the first part is covered', () => {
  const r = evaluate('۱) قیمت BTC چنده؟ ۲) ریسک سبد من چیه؟');
  assert.equal(r.used, false);
  assert.equal(r.reason, 'judgement-question');
});

test('the gate refuses a question with no strong match', () => {
  /* The question is off-topic AND the corpus has nothing for it. The gate
     must refuse; the exact reason depends on which check fires first, and
     both are refusals. */
  const r = evaluate('این یک سؤال کاملاً بی‌ربط دربارهٔ هواشناسی است');
  assert.equal(r.used, false);
  assert.ok(['no-strong-match', 'needs-live-data', 'needs-web-research'].includes(r.reason), `unexpected reason: ${r.reason}`);
  /* And with a STATIC plan the score is what refuses it. */
  const r2 = evaluateLocalFirst({
    message: 'این یک سؤال کاملاً بی‌ربط دربارهٔ هواشناسی است',
    plan: { freshness: 'STATIC', needsWeb: false, level: 2 },
    knowledge: searchKnowledge('این یک سؤال کاملاً بی‌ربط دربارهٔ هواشناسی است', { limit: 3 }),
    locale: 'fa',
    env: {}
  });
  assert.equal(r2.used, false);
  assert.equal(r2.reason, 'no-strong-match');
});

test('the gate refuses a weak match rather than guessing', () => {
  /* A match below the threshold is not a match. The corpus must not be
     stretched to cover a question it does not cover. */
  const weak = [{ id: 'kb.x', version: 1, status: 'verified', score: LOCAL_FIRST_MIN_SCORE - 1, title: 't', body: 'b' }];
  const r = evaluate('بیت کوین چیست؟', { knowledge: weak });
  assert.equal(r.used, false);
  assert.equal(r.reason, 'no-strong-match');
});

test('the gate declines when the local reasoner itself declines', () => {
  /* A perfect score but a reasoner that returns nothing must NOT become a
     confident empty answer. */
  const r = evaluateLocalFirst({
    message: 'بیت کوین چیست؟',
    plan: { freshness: 'STATIC', needsWeb: false, level: 2 },
    knowledge: [{ id: 'kb.general.btc', version: 1, status: 'verified', score: 300, title: 't', body: 'b' }],
    locale: 'fa',
    env: {},
    synthesize: () => ({ ok: false, answer: '', knowledgeUsed: false, internalSynthesis: false })
  });
  assert.equal(r.used, false);
  assert.equal(r.reason, 'local-reasoner-declined');
});

test('the gate declines when the local reasoner returns a fragment', () => {
  const r = evaluateLocalFirst({
    message: 'بیت کوین چیست؟',
    plan: { freshness: 'STATIC', needsWeb: false, level: 2 },
    knowledge: [{ id: 'kb.general.btc', version: 1, status: 'verified', score: 300, title: 't', body: 'b' }],
    locale: 'fa',
    env: {},
    synthesize: () => ({ ok: true, answer: 'بیت کوین', knowledgeUsed: true, internalSynthesis: true })
  });
  assert.equal(r.used, false);
  assert.equal(r.reason, 'local-answer-too-short');
});

test('the gate is switched off entirely by the environment', () => {
  const r = evaluate('بیت کوین چیست؟', { env: { AI_LOCAL_FIRST_GATE: '0' } });
  assert.equal(r.used, false);
  assert.equal(r.reason, 'disabled');
});

test('the gate ignores a deprecated knowledge row', () => {
  const rows = [
    { id: 'kb.old', version: 1, status: 'deprecated', score: 999, title: 'old', body: 'old' }
  ];
  const r = evaluate('بیت کوین چیست؟', { knowledge: rows });
  assert.equal(r.used, false);
  assert.equal(r.reason, 'no-strong-match');
});

test('a live value question with no live price in the turn is refused', () => {
  /* The corpus holds definitions, not today's numbers. A question that asks
     for a live value must not be answered from a glossary. */
  const r = evaluateLocalFirst({
    message: 'قیمت BTC چنده؟',
    plan: { freshness: 'STATIC', needsWeb: false, level: 2 },
    knowledge: [{ id: 'kb.general.btc', version: 1, status: 'verified', score: 300, title: 't', body: 'b' }],
    locale: 'fa',
    context: {},
    env: {}
  });
  assert.equal(r.used, false);
  assert.ok(['asks-for-live-value', 'judgement-question'].includes(r.reason), `unexpected: ${r.reason}`);
});

/* ─── THE SAFETY FLOOR (2026-11-11) ────────────────────────────────────────
 *
 * The local path has no emotional reads, so it must never be the path that
 * answers a clearly distressed person. These tests lock that floor down in
 * both directions: a distressed message never gets a corpus answer, and an
 * ordinary question is not caught by the safety pattern.
 */
test('a distressed person is never answered from the corpus', () => {
  /* The corpus holds the fee sheet. The person holds a loss. The fee sheet
     is not the answer to that message. */
  for (const q of [
    'همه پولمو بفروشم',
    'خیلی ضرر کردم حالم بده',
    'از خودم بیزارم',
    'خسته شدم از این همه نوسان'
  ]) {
    const r = evaluate(q);
    assert.equal(r.used, false, `"${q}" must not be answered locally`);
    assert.equal(r.reason, 'safety-precheck', `unexpected reason for "${q}": ${r.reason}`);
  }
});

test('the safety pattern does not catch ordinary questions', () => {
  for (const q of [
    'کارمزد پلتفرم FBT چقدر است',
    'بیت کوین چیست؟',
    'کیف پول من کجا ذخیره می شود',
    'سقف برداشت چقدر است؟',
    'تیم FBT چه کسانی هستند؟'
  ]) {
    const r = evaluate(q);
    assert.notEqual(r.reason, 'safety-precheck', `"${q}" must not be caught by the safety floor`);
  }
});

test('the safety reads reach the local reasoner, so containment still fires', () => {
  /* The reasoner's containment contract fires on `socialRead.distress` and
     on `emotionRead.acute`. The gate used to pass null for both, so the
     emotional paths were silently lost on exactly the turns they mattered. */
  const seen = {};
  const r = evaluateLocalFirst({
    message: 'کارمزد پلتفرم FBT چقدر است',
    plan: { freshness: 'STATIC', needsWeb: false, level: 2 },
    knowledge: [{ id: 'kb.product.fee', version: 1, status: 'verified', score: 300, title: 't', body: 'b' }],
    locale: 'fa',
    context: {},
    env: {},
    socialRead: { distress: true },
    emotionRead: { acute: true, primary: 'grief', intensity: 0.9 },
    synthesize: (args) => {
      seen.socialRead = args.socialRead;
      seen.emotionRead = args.emotionRead;
      return { ok: true, answer: 'یک پاسخ امن و کافی که طولانی باشد تا از حداقل عبور کند.' };
    }
  });
  assert.equal(r.used, true);
  assert.equal(seen.socialRead?.distress, true, 'the social read must reach the reasoner');
  assert.equal(seen.emotionRead?.acute, true, 'the emotion read must reach the reasoner');
});

test('the pre-gate declines a live, a judgement and a multi-part question', () => {
  const pre = (message, plan = {}) => preEvaluateLocalFirst({ message, plan, env: {} });

  assert.equal(pre('قیمت BTC چنده؟', { freshness: 'LIVE' }).continue, false);
  assert.equal(pre('قیمت BTC چنده؟', { freshness: 'LIVE' }).reason, 'needs-live-data');

  assert.equal(pre('آیا بخرم؟').continue, false);
  assert.equal(pre('آیا بخرم؟').reason, 'judgement-question');

  /* A multi-part question is declined — but the reason reported is the
     FIRST rule that fired, and «ریسک سبد من چیه؟» is itself a judgement
     question, so the judgement rule is the honest answer here. */
  assert.equal(pre('۱) قیمت BTC چنده؟ ۲) ریسک سبد من چیه؟').continue, false);
  assert.equal(pre('۱) قیمت BTC چنده؟ ۲) ریسک سبد من چیه؟').reason, 'judgement-question');
  /* A multi-part question that is NOT a judgement reports the multi-part
     reason, so the two rules are independently visible. */
  assert.equal(pre('۱) کارمزد چقدر است؟ ۲) سقف برداشت چقدر است؟').reason, 'multi-part-question');

  assert.equal(pre('همه پولمو بفروشم').reason, 'safety-precheck');

  /* An ordinary product question is NOT declined: the gate gets to look. */
  assert.equal(pre('کارمزد پلتفرم FBT چقدر است', { freshness: 'STATIC' }).continue, true);
});

/* ─────────────────────────────────────────────────────────────────────────
 * THE RISK RULE (2026-11-12)
 *
 * «ریسک X چیست؟» asks for an ASSESSMENT. The corpus holds definitions, so
 * answering it from the corpus produces a fluent non-answer: the brain
 * confidently returned `kb.swap.price-impact` — an item about price impact —
 * as the answer to a question about liquidation risk.
 *
 * The subject is OPTIONAL and may be long: the QUESTION FORM decides what
 * kind of answer is wanted, not the topic.
 * ───────────────────────────────────────────────────────────────────────── */
test('a risk question is a judgement, never a glossary answer', () => {
  const gate = (message) => evaluateLocalFirst({
    message, locale: 'fa', knowledge: [], context: {}, env: {}
  });
  for (const q of [
    'ریسک لیکوییدیتی چیست؟',
    'ریسک نقدشوندگی چقدر است؟',
    'خطر لیکوییدشدن چقدر بزرگ است؟',
    'ریسک چیست؟',
    'ریسک کاربرد چیست؟',
    'ریسک بازار چطور مدیریت می‌شود؟'
  ]) {
    assert.equal(gate(q).used, false, `a risk question must not be answered from a glossary: ${q}`);
  }
});

test('the risk rule does not catch an ordinary lookup', () => {
  const gate = (message) => evaluateLocalFirst({
    message, locale: 'fa', knowledge: [], context: {}, env: {}
  });
  for (const q of [
    'کارمزد پلتفرم FBT چقدر است؟',
    'سقف برداشت چقدر است؟',
    'کیف پول من کجا ذخیره می شود؟',
    'بیت کوین چیست؟',
    'اتریوم چیست؟',
    'استیبل کوین چیست؟',
    'تیم FBT چه کسانی هستند؟',
    'لیکوییدشدن چیست؟',
    'نوسان بازار چیست؟'
  ]) {
    const r = gate(q);
    assert.notEqual(r.reason, 'judgement-question', `a lookup must not be read as a risk judgement: ${q}`);
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * THE SCENARIO RULE (2026-11-12)
 *
 * «سقوط بیت کوین چه اثری دارد؟» asks for a FUTURE, which the corpus does
 * not hold. The brain matched `kb.analytics.sopr-read` — an item about how
 * a historical rule is applied — and presented it as the answer.
 *
 * This rule is PLAN-INDEPENDENT on purpose: the other freshness rules read
 * `plan.freshness`, and the central brain has no collaboration plan, so a
 * plan-dependent rule silently does not apply there. That is exactly what
 * happened.
 * ───────────────────────────────────────────────────────────────────────── */
test('a scenario question is a live question, never a glossary answer', () => {
  const gate = (message) => evaluateLocalFirst({
    message, locale: 'fa', knowledge: [], context: {}, env: {}
  });
  for (const q of [
    'سقوط بیت کوین چه اثری دارد؟',
    'اگر بیت کوین بریزد چه می‌شود؟',
    'اگر بیت کوین دو برابر شود چه می‌شود؟',
    'اگر قیمت بیت کوین نصف شود چه می‌شود؟'
  ]) {
    const r = gate(q);
    assert.equal(r.used, false, `a scenario must not be answered from a glossary: ${q}`);
    assert.equal(r.reason, 'needs-live-data', `the reason must be the live one: ${q}`);
  }
});

test('the scenario rule does not catch an ordinary lookup', () => {
  const gate = (message) => evaluateLocalFirst({
    message, locale: 'fa', knowledge: [], context: {}, env: {}
  });
  for (const q of [
    'بیت کوین چیست؟',
    'کارمزد پلتفرم FBT چقدر است؟',
    'چطور کیف پول بسازم؟',
    'اگر بیت کوین را نمی‌فروشم چه؟',
    'قیمت بیت کوین چنده؟'
  ]) {
    const r = gate(q);
    assert.notEqual(r.skippedFor, 'scenario', `a lookup must not be read as a scenario: ${q}`);
  }
});

test('the pre-gate declines a risk question and a scenario', () => {
  const pre = (message) => preEvaluateLocalFirst({ message, plan: {}, env: {} });
  assert.equal(pre('ریسک لیکوییدیتی چیست؟').continue, false);
  assert.equal(pre('ریسک لیکوییدیتی چیست؟').reason, 'judgement-question');
  assert.equal(pre('سقوط بیت کوین چه اثری دارد؟').continue, false);
  assert.equal(pre('سقوط بیت کوین چه اثری دارد؟').reason, 'needs-live-data');
});
