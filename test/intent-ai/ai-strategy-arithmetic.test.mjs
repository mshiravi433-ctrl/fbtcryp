/**
 * «هوش ساخت استراتژی را خیلی باهوش کن» — STRATEGY ARITHMETIC.
 * ---------------------------------------------------------------------------
 * The rubric checks that a plan HAS its eight sections. It cannot see that the
 * numbers inside them contradict each other, and that is exactly how a
 * model-written plan fails:
 *
 *   · allocations that add up to 110% of the capital;
 *   · a "long" whose stop sits ABOVE its entry (a guaranteed loss);
 *   · a per-trade risk budget of 2% next to a 40% position with an 8% stop;
 *   · leverage above the platform cap;
 *   · a position larger than the whole portfolio.
 *
 * All deterministic, all fed to the reviewer as MUST-FIX, all pinned here by a
 * negative test as well as a positive one — a checker that cries wolf is worse
 * than no checker. The reply re-checks the FINAL text after the review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkPlanArithmetic,
  renderStrategyViolations,
  STRATEGY_ARITHMETIC_SCHEMA
} from '../../server/aiStrategyPlanCheck.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const FRAME = {
  capitalUsd: 10000,
  policy: { maxLeverage: 5, maxSlippagePct: 3, maxTransactionUsd: 400000 }
};

const ids = (result) => result.violations.map((v) => v.id);

/* -------------------------------------------------------------------------- */
/*  A. ALLOCATIONS                                                            */
/* -------------------------------------------------------------------------- */

test('allocations that add up to more than the capital are caught', () => {
  const bad = checkPlanArithmetic('۶۰٪ سرمایه در BTC و ۵۰٪ در ETH با بازبینی ماهانه.', FRAME);
  assert.equal(bad.schema, STRATEGY_ARITHMETIC_SCHEMA);
  assert.deepEqual(ids(bad), ['allocations_exceed_100']);
  assert.equal(bad.clean, false);

  const good = checkPlanArithmetic('۴۰٪ سرمایه در BTC و ۳۰٪ در ETH با بازبینی ماهانه.', FRAME);
  assert.equal(good.clean, true, '70% is a valid allocation');
  assert.equal(checkPlanArithmetic('۱۰۰٪ سرمایه در BTC.', FRAME).clean, true, 'exactly 100% is allowed');
});

test('a single percentage is not treated as an allocation sum', () => {
  assert.equal(checkPlanArithmetic('۴۰٪ سرمایه در BTC.', FRAME).clean, true);
  assert.equal(checkPlanArithmetic('هدف رشد ۲۰٪ و افت حداکثر ۱۵٪.', FRAME).clean, true,
    'returns and drawdowns are not allocations');
});

/* -------------------------------------------------------------------------- */
/*  B. STOP SIDE                                                              */
/* -------------------------------------------------------------------------- */

test('a long stop above the entry — and a short stop below it — are contradictions', () => {
  assert.deepEqual(ids(checkPlanArithmetic('خرید BTC در ۱۰۰٬۰۰۰ دلار با حد ضرر ۱۰۵٬۰۰۰ دلار.', FRAME)), ['stop_on_wrong_side']);
  assert.equal(checkPlanArithmetic('خرید BTC در ۱۰۰٬۰۰۰ دلار با حد ضرر ۹۵٬۰۰۰ دلار.', FRAME).clean, true);
  assert.deepEqual(ids(checkPlanArithmetic('شورت BTC در ۱۰۰٬۰۰۰ با حد ضرر ۹۵٬۰۰۰.', FRAME)), ['stop_on_wrong_side']);
  assert.equal(checkPlanArithmetic('شورت BTC در ۱۰۰٬۰۰۰ با حد ضرر ۱۰۵٬۰۰۰.', FRAME).clean, true);
});

test('a sentence without an entry price is not judged', () => {
  assert.equal(checkPlanArithmetic('حد ضرر ۹۵٬۰۰۰ دلار برای پوزیشن فعلی.', FRAME).clean, true);
});

/* -------------------------------------------------------------------------- */
/*  C. RISK BUDGET, LEVERAGE, SIZE                                            */
/* -------------------------------------------------------------------------- */

test('size × stop above the stated per-trade risk is a contradiction', () => {
  const bad = checkPlanArithmetic('۴۰٪ سرمایه در BTC با حد ضرر ۸٪؛ ریسک هر معامله ۲٪.', FRAME);
  assert.deepEqual(ids(bad), ['risk_exceeds_budget']);
  assert.match(bad.violations[0].detail, /3\.2%/);

  const good = checkPlanArithmetic('۴۰٪ سرمایه در BTC با حد ضرر ۵٪؛ ریسک هر معامله ۲٪.', FRAME);
  assert.equal(good.clean, true, '40% × 5% = 2% is inside the budget');
});

test('a risk budget stated as a drawdown, not per trade, is not used for sizing', () => {
  assert.equal(checkPlanArithmetic('۴۰٪ سرمایه در BTC با حد ضرر ۸٪؛ حداکثر افت ۲٪.', FRAME).clean, true);
});

test('leverage above the platform cap is caught; inside the cap is not', () => {
  assert.deepEqual(ids(checkPlanArithmetic('با اهرم ۱۰× وارد شو.', FRAME)), ['leverage_exceeds_policy']);
  assert.equal(checkPlanArithmetic('با اهرم ۲× وارد شو.', FRAME).clean, true);
});

test('a position larger than the capital is caught; a target value is not', () => {
  assert.deepEqual(ids(checkPlanArithmetic('پوزیشن ۵۰٬۰۰۰ دلار در BTC باز کن.', FRAME)), ['amount_exceeds_capital']);
  assert.equal(checkPlanArithmetic('هدف رسیدن به ۲۰٬۰۰۰ دلار در ۶ ماه.', FRAME).clean, true);
});

/* -------------------------------------------------------------------------- */
/*  D. RENDERING                                                              */
/* -------------------------------------------------------------------------- */

test('a clean plan renders nothing; a dirty one names every violation', () => {
  const clean = checkPlanArithmetic('۳۰٪ سرمایه در BTC، حد ضرر ۹۵٬۰۰۰، کارمزد ۱.۴٪، سناریوی صعودی و نزولی.', FRAME);
  assert.equal(renderStrategyViolations(clean), '');

  const dirty = checkPlanArithmetic('۶۰٪ سرمایه در BTC و ۵۰٪ در ETH؛ با اهرم ۱۰×.', FRAME);
  const block = renderStrategyViolations(dirty);
  assert.match(block, /STRATEGY ARITHMETIC/);
  assert.match(block, /allocations_exceed_100/);
  assert.match(block, /leverage_exceeds_policy/);
  assert.equal(renderStrategyViolations(null), '');
});

/* -------------------------------------------------------------------------- */
/*  E. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const CONTEXT = {
  portfolio: { totalValueUsd: 10000, holdings: [{ symbol: 'BTC', valueUsd: 6000 }] },
  market: { priceMap: { BTC: 108000 }, dataStatus: 'live' }
};

const DIRTY = 'هدف رشد ۲۰٪ در ۶ ماه با بودجهٔ ریسک ۱۵٪. ۶۰٪ سرمایه در BTC و ۵۰٪ در ETH؛ خرید BTC در ۱۰۰٬۰۰۰ '
  + 'دلار با حد ضرر ۱۰۵٬۰۰۰ دلار و کارمزد رفت‌وبرگشت ۱.۴٪. سناریوی صعودی، پایه و نزولی با همین سطوح و بازبینی ماهانه.';
const FIXED = 'هدف رشد ۲۰٪ در ۶ ماه با بودجهٔ ریسک ۱۵٪. ۳۰٪ سرمایه در BTC و ۲۰٪ در ETH؛ خرید BTC در ۱۰۰٬۰۰۰ '
  + 'دلار با حد ضرر ۹۵٬۰۰۰ دلار و کارمزد رفت‌وبرگشت ۱.۴٪. سناریوی صعودی، پایه و نزولی با همین سطوح و بازبینی ماهانه.';

function makeFleet({ draft = DIRTY, repaired = DIRTY } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: repaired, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: draft, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: سبد متمرکز است.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer'))
  };
}

const MESSAGE = 'استراتژی سرمایه‌گذاری محافظه‌کارانه برای ۶ ماه با این سبد چیست؟';

test('max: the reviewer receives the arithmetic violations of the draft', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  const review = fleet.critiqueCalls()[0].message;
  assert.match(review, /STRATEGY ARITHMETIC/);
  assert.match(review, /allocations_exceed_100/);
  assert.match(review, /stop_on_wrong_side/);

  /* The repair returned the same contradictory text, so the final check is dirty. */
  assert.equal(out.strategy.arithmetic.clean, false);
  assert.ok(out.strategy.arithmetic.violations.some((v) => v.id === 'allocations_exceed_100'));
});

test('max: a repaired plan is re-checked and comes back clean', async () => {
  const fleet = makeFleet({ draft: DIRTY, repaired: FIXED });
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.critique.used, true);
  assert.equal(out.strategy.arithmetic.clean, true);
  assert.deepEqual(out.strategy.arithmetic.violations, []);
});

test('balanced: no arithmetic check and no block in any prompt', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MESSAGE,
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.strategy, null);
  for (const c of fleet.calls) assert.equal(c.message.includes('STRATEGY ARITHMETIC'), false);
});
