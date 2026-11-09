/**
 * «باهوش‌تر کن» — the FIFTH depth layer: a dissenting seat and a repair gate.
 * ---------------------------------------------------------------------------
 * Two weaknesses survived the earlier layers:
 *
 *   1. THREE READS, ONE VIEW. All three analyses reasoned from the same obvious
 *      reading; agreement between them proved nothing. The last analytical seat
 *      is now a RED TEAM seat: it is told to assume the obvious conclusion is
 *      wrong and build the strongest evidence-bound case against it.
 *
 *   2. A REPAIR COULD BE WORSE. The adversarial review was accepted on length
 *      alone (≥60% of the draft), so it could legitimately "fix" the answer and
 *      add an invented number, or drop half of a two-part question. The gate now
 *      refuses both, and a refused repair leaves the draft untouched.
 *
 * Neither adds a model call: the red-team brief rides on an existing seat, the
 * gate is pure comparison. Fully offline: the fleet is injected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const CONTEXT = { market: { priceMap: { BTC: 108000 } } };
const MESSAGE = 'سناریوهای استراتژی برای بیت‌کوین با توجه به ریسک بازار چیست؟';

function fleetWith({ draft, repaired }) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: repaired, claims: [{ claim: 'reviewed', type: 'opinion', confidence: 80 }], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: draft, claims: [], uncertainty: '' });
    if (system.includes('RED TEAM')) return reply({ answer: 'دیدگاه مخالف: داده زنده فقط یک قیمت است و هر نتیجه‌گیری دربارهٔ روند، خوانش اضافه می‌خواهد.', claims: [], uncertainty: 'نیاز به داده جریان' });
    return reply({ answer: 'تحلیل نقش: داده زنده فشار فروش را نشان می‌دهد.', claims: [], uncertainty: 'خوانش بعدی لازم است' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    analysisCalls: () => calls.filter((c) => /FBT's (?:Market|Risk|Crypto Research|Strategy|Portfolio|News) AI/.test(c.system)),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer'))
  };
}

const DRAFT = 'بر اساس داده زنده، بیت‌کوین حدود ۱۰۸٬۰۰۰ دلار معامله می‌شود و فشار فروش امروز محسوس است. '
  + 'این خوانش قطعی نیست و تصمیم به داده تازه و رویدادهای کلان وابسته است؛ بدون خواندن جریان صندوق‌ها عدد بعدی را حدس نمی‌زنم.';

/* -------------------------------------------------------------------------- */
/*  A. RED TEAM SEAT                                                          */
/* -------------------------------------------------------------------------- */

test('max: exactly the last analytical seat is asked to argue the opposite case', async () => {
  const fleet = fleetWith({ draft: DRAFT, repaired: DRAFT });
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  const analysisCalls = fleet.analysisCalls();
  assert.equal(analysisCalls.length, 3);
  const dissenting = analysisCalls.filter((c) => c.system.includes('RED TEAM'));
  assert.equal(dissenting.length, 1, 'one seat dissents, not three');
  assert.equal(analysisCalls[analysisCalls.length - 1].system.includes('RED TEAM'), true,
    'the dissenting brief belongs to the last analytical seat');

  assert.ok(out.counterCase.role, 'the dissenting seat is named');
  assert.equal(['final_answer', 'verification'].includes(out.counterCase.role), false,
    'the dissent is a specialist seat, not the synthesiser or the verifier');
  assert.equal(out.counterCase.answered, true);
  /* The dissenting seat is an analyst, not the synthesiser or the reviewer. */
  for (const c of fleet.calls) {
    if (c.system.includes('Final Answer AI') || c.system.includes('adversarial self-reviewer')) {
      assert.equal(c.system.includes('RED TEAM'), false);
    }
  }
});

test('balanced: no dissenting seat and no counter-case metadata', async () => {
  const fleet = fleetWith({ draft: DRAFT, repaired: DRAFT });
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.counterCase, null);
  for (const c of fleet.calls) assert.equal(c.system.includes('RED TEAM'), false);
});

/* -------------------------------------------------------------------------- */
/*  B. REPAIR ACCEPTANCE GATE                                                 */
/* -------------------------------------------------------------------------- */

test('a repair that invents a new unsourced number is refused', async () => {
  const repaired = `${DRAFT} سطح بعدی را ۹۹٬۰۰۰ دلار می‌بینم و در همین محدوده تصمیم می‌گیریم.`;
  const fleet = fleetWith({ draft: DRAFT, repaired });
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.equal(out.answer, DRAFT, 'the draft stands: the review may withdraw a figure, never add one');
  assert.equal(out.critique.used, false);
  assert.equal(out.critique.reason, 'REPAIR_ADDED_UNSOURCED_NUMBER');
  assert.deepEqual(out.critique.rejectedNumbers, [99000]);
  /* The published audit still describes the text the user reads. */
  assert.equal(out.numericAudit.clean, true);
});

test('a repair that drops a part the draft answered is refused', async () => {
  const twoPart = '۱) قیمت BTC چنده؟ ۲) ریسک سبد من چیه؟';
  const draft = 'قیمت BTC حدود ۱۰۸٬۰۰۰ دلار است و ریسک سبد شما به وزن همین دارایی وابسته است. '
    + 'این خوانش قطعی نیست و تصمیم به داده تازه وابسته است، پس بدون خواندن جریان صندوق‌ها عددی را حدس نمی‌زنم.';
  const repaired = 'قیمت BTC حدود ۱۰۸٬۰۰۰ دلار است و این خوانش قطعی نیست؛ تصمیم به داده تازه وابسته است '
    + 'و بدون خواندن جریان صندوق‌ها عددی را حدس نمی‌زنم و توصیه‌ای هم نمی‌دهم.';

  const fleet = fleetWith({ draft, repaired });
  const out = await runCollaborativeAnalysis({
    message: twoPart,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.equal(out.critique.used, false);
  assert.equal(out.critique.reason, 'REPAIR_LOST_COVERAGE');
  assert.equal(out.answer, draft, 'half an answer is not an improvement');
  assert.equal(out.subQuestions.parts.length, 2);
  assert.equal(out.subQuestions.complete, true, 'the draft did answer both parts');
});

test('a good repair is still accepted, and the gate records it as repaired', async () => {
  const repaired = `${DRAFT} برای تصمیم، خواندن جریان ورودی صندوق‌ها و سطح نقدینگی لازم است.`;
  const fleet = fleetWith({ draft: DRAFT, repaired });
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.critique.used, true);
  assert.equal(out.critique.reason, 'REPAIRED');
  assert.equal(out.answer, repaired);
});
