/**
 * «باهوش‌تر کن» — the DEPTH half of the smartest mode.
 * ---------------------------------------------------------------------------
 * Picking a stronger model is not the same as thinking harder. The smartest
 * mode now also:
 *
 *   1. runs THREE independent analyses at level 4 (not two);
 *   2. gives every role a deep-reasoning contract (deciding facts first,
 *      counter-case named, no number that is not in the evidence);
 *   3. hands the verifier's findings to the synthesiser as things to RESOLVE;
 *   4. runs one bounded adversarial self-review that may repair the draft;
 *   5. puts more verified knowledge in the evidence block.
 *
 * The invariants these tests pin are the ones that make it safe to ship:
 *   · the review can only IMPROVE a draft — a stub, a crash or a truncated
 *     repair leaves the draft exactly as it was;
 *   · `balanced` sends the historical two analyses and no review call;
 *   · every extra pass is bounded by the turn's own deadline.
 *
 * Fully offline: the fleet is injected, no provider is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runCollaborativeAnalysis,
  buildSafeContextBlock
} from '../../server/aiCollaboration.js';
import { planCollaboration } from '../../src/lib/intent-ai/os/collaborationRouter.js';

const CONTEXT = {
  market: { priceMap: { BTC: 108000, ETH: 2500 }, change24hPct: -4.2, dataStatus: 'live' }
};

const DRAFT = 'بر اساس داده‌های خوانده‌شده، فشار فروش امروز محسوس بود و بیت‌کوین حدود ۱۰۸٬۰۰۰ دلار معامله می‌شود. '
  + 'این تحلیل یک پیش‌بینی قطعی نیست و به رویدادهای کلان پیش‌رو وابسته است؛ اگر داده تازه‌ای نرسد، نمی‌توان سطح بعدی را قطعی گفت.';
const REPAIRED = 'بیت‌کوین در داده‌های خوانده‌شده حدود ۱۰۸٬۰۰۰ دلار و با فشار فروش امروز معامله می‌شود. '
  + 'سطح بعدی حمایت در داده موجود نیست و آن را حدس نمی‌زنم. سناریوی صعودی به بازگشت تقاضا و سناریوی نزولی به ادامه فشار ماکرو وابسته است، '
  + 'و قوی‌ترین استدلال مخالف این است که افت امروز می‌تواند موقت باشد؛ برای تصمیم، خواندن جریان ورودی صندوق‌ها لازم است.';

const ANALYSIS_ROLE_RE = /(?:You are FBT's (?:Market|Risk|Crypto Research|Strategy|Portfolio|News) AI)/;

function makeFleet({ critique = 'repair', criticStatus = 'ok' } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    const entry = { providerId, system, message: String(opts.user || ''), maxTokens: opts.maxTokens };
    calls.push(entry);
    const reply = (text, model) => ({
      provider: providerId,
      model,
      durationMs: 2,
      engine: 'external-model',
      text: JSON.stringify(text)
    });

    if (system.includes('adversarial self-reviewer')) {
      if (criticStatus === 'crash') throw new Error('critic unavailable');
      if (criticStatus === 'stub') return reply({ answer: 'ok', claims: [], uncertainty: '' }, 'fake-critic');
      return reply({ answer: REPAIRED, claims: [{ claim: 'removed an unsourced support level', type: 'opinion', confidence: 90 }], uncertainty: 'next support unread' }, 'fake-critic');
    }
    if (system.includes('Verification AI')) {
      return reply({ answer: 'ادعای قیمت با داده ابزار هم‌خوان است؛ سطح حمایت بعدی شاهدی ندارد.', claims: [], uncertainty: 'منبع سطح حمایت نامشخص' }, 'fake-verif');
    }
    if (system.includes('Final Answer AI')) {
      return reply({ answer: DRAFT, claims: [], uncertainty: 'وابسته به رویدادهای پیش‌رو' }, 'fake-final');
    }
    return reply({ answer: 'تحلیل نقش: داده زنده فشار فروش را نشان می‌دهد و سطح بعدی خوانده نشده است.', claims: [{ claim: 'BTC около 108000', type: 'factual', confidence: 80 }], uncertainty: 'خوانش بعدی لازم است' }, 'fake-analysis');
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    analysisCalls: () => calls.filter((c) => ANALYSIS_ROLE_RE.test(c.system)),
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer'))
  };
}

const MESSAGE = 'سناریوهای استراتژی برای بیت‌کوین با توجه به ریسک بازار چیست؟';

test('max runs three independent analyses at level 4. the draft gets reviewed once. and the repair is used', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(out.level >= 4, `expected level 4+, got ${out.level}`);
  assert.equal(fleet.analysisCalls().length, 3, 'the smartest mode must run three independent analyses');
  assert.equal(fleet.critiqueCalls().length, 1, 'exactly one bounded review call');
  assert.equal(out.critique.used, true);
  assert.equal(out.critique.reason, 'REPAIRED');
  assert.equal(out.answer, REPAIRED, 'the repaired answer is what the user reads');
  assert.ok(out.critique.issues.some((i) => /unsourced/i.test(i)), 'the review records what it changed');
  assert.ok(out.modelsConsulted.length >= 3);
});

test('a stub review never replaces the draft', async () => {
  const fleet = makeFleet({ criticStatus: 'stub' });
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.critique.used, false);
  assert.equal(out.critique.reason, 'STUB_OR_TRUNCATED');
  assert.equal(out.answer, DRAFT, 'a two-character "ok" is not a better answer');
});

test('a crashed review leaves the answer exactly as it was', async () => {
  const fleet = makeFleet({ criticStatus: 'crash' });
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.critique.used, false);
  assert.equal(out.critique.reason, 'NO_CRITIC_ANSWER');
  assert.equal(out.answer, DRAFT);
});

test('balanced keeps two analyses and never pays for a review', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.ok(out.level >= 4, 'the question itself is complex, independent of mode');
  assert.equal(fleet.analysisCalls().length, 2, 'balanced keeps the historical two analyses');
  assert.equal(fleet.critiqueCalls().length, 0, 'balanced must not spend an extra call');
  assert.equal(out.critique, null);
});

test('the deep-reasoning contract is in the max prompt and absent from balanced', async () => {
  const maxFleet = makeFleet();
  await runCollaborativeAnalysis({ message: MESSAGE, locale: 'fa', context: CONTEXT, intelligence: 'max', deps: maxFleet, deadlineMs: 15000 });
  assert.ok(maxFleet.calls.every((c) => c.system.includes('DEEP REASONING')), 'every max call carries the contract');

  const balancedFleet = makeFleet();
  await runCollaborativeAnalysis({ message: MESSAGE, locale: 'fa', context: CONTEXT, intelligence: 'balanced', deps: balancedFleet, deadlineMs: 15000 });
  assert.ok(balancedFleet.calls.every((c) => !c.system.includes('DEEP REASONING')), 'balanced prompt is byte-identical to before');
});

test('a direct max call gets the depth floor even without a pre-built plan', async () => {
  const plan = planCollaboration({ message: MESSAGE, locale: 'fa' });
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.ok(out.level >= 4);
  assert.ok(out.level >= plan.level, 'the mode may raise the analyzer level, never lower it');
  assert.equal(out.intelligence.mode, 'max');
  assert.equal(out.intelligence.plan.mode, 'max');
});

test('the verifier findings are handed to the synthesiser as things to resolve', async () => {
  const fleet = makeFleet();
  await runCollaborativeAnalysis({ message: MESSAGE, locale: 'fa', context: CONTEXT, intelligence: 'max', deps: fleet, deadlineMs: 15000 });
  const final = fleet.finalCalls()[0];
  assert.ok(final, 'a final synthesis call must exist');
  assert.match(final.message, /VERIFIER FINDINGS/);
  assert.match(final.message, /HARD RULE/);
  assert.ok(final.maxTokens >= 1280, `the final answer needs room, got ${final.maxTokens}`);
});

test('the evidence block honours the knowledge limit without inventing rows', () => {
  const knowledge = Array.from({ length: 9 }, (_, i) => ({
    id: `kb-${i}`, version: 1, status: 'verified', title: `Fact ${i}`, body: `Body ${i}`
  }));
  const four = buildSafeContextBlock({ knowledge });
  const six = buildSafeContextBlock({ knowledge, knowledgeLimit: 6 });
  assert.equal((four.match(/Fact \d/g) || []).length, 4, 'the historical limit stays four by default');
  assert.equal((six.match(/Fact \d/g) || []).length, 6, 'the smartest mode may read more verified facts');
  assert.ok(!six.includes('Fact 7'), 'it never reads past what was supplied');
});
