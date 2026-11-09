/**
 * «هوش ساخت استراتژی سرمایه‌گذاری را باهوش کن» — STRATEGY FRAME + RUBRIC.
 * ---------------------------------------------------------------------------
 * A model asked to build an investment strategy does three things badly when
 * it is left alone: it invents the numbers it was not given, it writes an
 * opinion instead of a plan (no sizing, no entry condition, no invalidation,
 * no cost), and it presents a complete-looking plan whose missing piece is
 * exactly the one that decides the outcome.
 *
 * Two deterministic additions, no extra model call:
 *   · FRAME — the facts a plan may stand on: the user's real capital, current
 *     weights and concentration, the platform fee and its round-trip cost, the
 *     policy caps. Anything unreadable is a named gap, never a guess.
 *   · RUBRIC — the eight sections a strategy answer must contain. The model is
 *     told before writing; the reviewer is told which ones the draft is missing.
 *
 * Completeness only: nothing here claims a strategy is good, and nothing here
 * can execute (FBT never moves funds).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStrategyFrame,
  renderStrategyFrame,
  checkStrategyRubric,
  renderStrategyGaps,
  renderStrategyRubricContract,
  detectStrategyRequest,
  STRATEGY_FRAME_SCHEMA
} from '../../server/aiStrategyFrame.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const CONTEXT = {
  portfolio: { totalValueUsd: 10000, holdings: [{ symbol: 'BTC', valueUsd: 6000 }, { symbol: 'ETH', valueUsd: 2500 }] },
  market: { priceMap: { BTC: 108000, ETH: 2500 }, dataStatus: 'live' }
};

/* -------------------------------------------------------------------------- */
/*  A. FRAME                                                                  */
/* -------------------------------------------------------------------------- */

test('the frame reads capital, weights, concentration and the real fee', () => {
  const frame = buildStrategyFrame({ context: CONTEXT, message: 'استراتژی محافظه‌کارانه برای ۶ ماه' });
  assert.equal(frame.schema, STRATEGY_FRAME_SCHEMA);
  assert.equal(frame.capitalUsd, 10000);
  assert.deepEqual(frame.weights.map((w) => [w.symbol, w.weightPct]), [['BTC', 60], ['ETH', 25]]);
  assert.equal(frame.topWeightPct, 60);
  assert.equal(frame.concentration, 'high');
  assert.equal(frame.riskBand, 'conservative');
  assert.equal(frame.feeBps, 70);
  assert.equal(frame.feeRoundTripPct, 1.4, 'two sides of the platform fee');
  assert.equal(frame.gaps.includes('capital'), false);
});

test('what the frame cannot read is a named gap, never a guess', () => {
  const frame = buildStrategyFrame({ context: {}, message: 'یک استراتژی بده' });
  assert.equal(frame.capitalUsd, null);
  assert.equal(frame.weights.length, 0);
  for (const gap of ['capital', 'weights', 'live_prices', 'risk_band', 'horizon']) {
    assert.ok(frame.gaps.includes(gap), `missing ${gap}`);
  }
  assert.equal(frame.complete, false);
});

test('the prompt block states the facts, the fee and the policy caps — and says what is missing', () => {
  const frame = buildStrategyFrame({ context: {}, message: 'استراتژی بده' });
  const block = renderStrategyFrame(frame);
  assert.match(block, /STRATEGY FRAME/);
  assert.match(block, /platform fee: 70 bps/);
  assert.match(block, /1\.4% round trip/);
  assert.match(block, /leverage ≤ 5×/);
  assert.match(block, /NOT READ/);
  assert.match(block, /FBT never executes/);
  assert.equal(renderStrategyFrame(null), '');
});

/* -------------------------------------------------------------------------- */
/*  B. RUBRIC                                                                 */
/* -------------------------------------------------------------------------- */

const COMPLETE = 'هدف رشد ۲۰٪ در ۶ ماه با بودجهٔ ریسک حداکثر ۱۵٪ افت. ۴۰٪ سرمایه در BTC با شرط ورود زیر '
  + '۱۰۰ هزار دلار، حد ضرر ۹۲ هزار، کارمزد رفت‌وبرگشت ۱.۴٪. سناریوی صعودی، پایه و نزولی.';

test('a complete plan passes the rubric; a plan without cost or invalidation does not', () => {
  const complete = checkStrategyRubric(COMPLETE);
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missing, []);
  assert.equal(complete.score, 100);

  const partial = checkStrategyRubric('به نظرم بیت‌کوین خوب است و در ۶ ماه آینده رشد می‌کند.');
  assert.equal(partial.complete, false);
  assert.ok(partial.missing.includes('invalidation'));
  assert.ok(partial.missing.includes('cost'));
  assert.ok(partial.missing.includes('sizing'));
});

test('the reviewer is told which sections are missing, and nothing when complete', () => {
  const partial = checkStrategyRubric('بیت‌کوین در ۶ ماه خوب است.');
  const gaps = renderStrategyGaps(partial);
  assert.match(gaps, /STRATEGY SECTIONS MISSING/);
  assert.match(gaps, /invalidation \(invalidation level or stop\)/);
  assert.equal(renderStrategyGaps(checkStrategyRubric(COMPLETE)), '');
  assert.equal(renderStrategyGaps(null), '');
});

test('the contract names the mandatory sections before the model writes', () => {
  const contract = renderStrategyRubricContract();
  assert.match(contract, /STRATEGY RUBRIC/);
  for (const id of ['objective', 'horizon', 'risk_budget', 'sizing', 'entry_condition', 'invalidation', 'cost', 'scenarios']) {
    assert.ok(contract.includes(id), `contract must name ${id}`);
  }
  assert.match(contract, /instead of inventing it/);
});

test('strategy requests are detected in Persian and English, without catching a price question', () => {
  assert.equal(detectStrategyRequest('استراتژی سرمایه‌گذاری برای ۶ ماه بده'), true);
  assert.equal(detectStrategyRequest('چطور سرمایه‌ام را بین بیت‌کوین و اتریوم تقسیم کنم؟'), true);
  assert.equal(detectStrategyRequest('how should i split my money between btc and eth?'), true);
  assert.equal(detectStrategyRequest('قیمت BTC چنده؟'), false);
});

/* -------------------------------------------------------------------------- */
/*  C. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

function makeFleet({ finalAnswer = COMPLETE } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: سبد متمرکز است و نقدینگی محدود.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer'))
  };
}

const STRATEGY_MESSAGE = 'استراتژی سرمایه‌گذاری محافظه‌کارانه برای ۶ ماه با این سبد چیست؟';

test('max: the frame and the rubric reach the model, and the reply publishes both', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: STRATEGY_MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(out.level >= 4);
  assert.equal(out.strategy.frame.capitalUsd, 10000);
  assert.equal(out.strategy.frame.riskBand, 'conservative');
  assert.equal(out.strategy.rubric.complete, true);

  const finalPrompt = fleet.finalCalls()[0].system;
  assert.match(finalPrompt, /STRATEGY FRAME/);
  assert.match(finalPrompt, /platform fee: 70 bps/);
  assert.match(finalPrompt, /STRATEGY RUBRIC/);
  /* A complete draft leaves the reviewer without a gaps block. */
  assert.equal(fleet.critiqueCalls()[0].message.includes('STRATEGY SECTIONS MISSING'), false);
});

test('max: an incomplete plan hands the missing sections to the reviewer', async () => {
  const fleet = makeFleet({
    finalAnswer: 'به نظرم بیت‌کوین در ۶ ماه آینده رشد می‌کند و ارزش نگه‌داشتن دارد؛ بازار فعلاً در حالت پایه است و '
      + 'منتظر یک محرک تازه‌ایم که هنوز در داده خوانده‌شده نیست و بدون آن نمی‌شود گفت روند پایدار است یا نه.'
  });
  const out = await runCollaborativeAnalysis({
    message: STRATEGY_MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.strategy.rubric.complete, false);
  const review = fleet.critiqueCalls()[0].message;
  assert.match(review, /STRATEGY SECTIONS MISSING/);
  assert.match(review, /invalidation/);
  assert.match(review, /cost/);
});

test('balanced: no frame, no rubric, no strategy block in any prompt', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: STRATEGY_MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.strategy, null);
  for (const c of fleet.calls) {
    assert.equal(c.system.includes('STRATEGY FRAME'), false);
    assert.equal(c.system.includes('STRATEGY RUBRIC'), false);
  }
});

test('a price question in max is not given a strategy frame', async () => {
  const fleet = makeFleet({ finalAnswer: 'بیت‌کوین در داده زنده ۱۰۸٬۰۰۰ دلار است و سطح بعدی خوانده نشده؛ حدس نمی‌زنم.' });
  const out = await runCollaborativeAnalysis({
    message: 'قیمت BTC چنده؟',
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.strategy, null);
  for (const c of fleet.calls) assert.equal(c.system.includes('STRATEGY FRAME'), false);
});
