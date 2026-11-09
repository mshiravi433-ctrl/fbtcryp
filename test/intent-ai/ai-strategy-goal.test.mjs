/**
 * «خیلی خیلی باهوش» — GOAL MATH + PLAN-LEVEL RISK.
 * ---------------------------------------------------------------------------
 * A professor turns the goal into an obligation before discussing any asset:
 * «۲۰٪ سود در ۶ ماه» is 3.09% a month compounded, ~44% annualised, and after
 * the round-trip fee the gross target is higher still. That arithmetic is
 * exact, so it is computed, not left to intuition.
 *
 * The second half is portfolio-level risk: 40% with an 8% stop plus 30% with a
 * 10% stop loses 6.2% of the capital if both stops are hit — a different number
 * from 3.2% and 3% seen separately, and the one that must fit the drawdown the
 * user agreed to. Reward/risk is arithmetic too: risking 5,000 to make 2,000 is
 * a losing plan even when every level is "correct".
 *
 * All deterministic, all tested negatively as well as positively.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStrategyFrame, renderStrategyFrame } from '../../server/aiStrategyFrame.js';
import { checkPlanArithmetic } from '../../server/aiStrategyPlanCheck.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const FRAME = { capitalUsd: 10000, policy: { maxLeverage: 5 } };

/* -------------------------------------------------------------------------- */
/*  A. GOAL MATH                                                              */
/* -------------------------------------------------------------------------- */

test('a goal becomes required monthly and annual returns, fee-adjusted', () => {
  const frame = buildStrategyFrame({ message: 'استراتژی ۲۰٪ سود در ۶ ماه', context: {} });
  assert.equal(frame.goal.targetPct, 20);
  assert.equal(frame.goal.months, 6);
  assert.equal(frame.goal.requiredMonthlyPct, 3.09);
  assert.equal(frame.goal.requiredAnnualPct, 44);
  assert.equal(frame.goal.grossTargetPct, 21.4, 'net target + round-trip fee');
  assert.equal(frame.gaps.includes('goal'), false);
});

test('Persian and English horizons, digits and number words all resolve', () => {
  assert.equal(buildStrategyFrame({ message: 'هدف رشد ۱۵ درصد در شش ماه', context: {} }).goal.months, 6);
  assert.equal(buildStrategyFrame({ message: 'هدف رشد ۲۰٪ در یک سال', context: {} }).goal.months, 12);
  assert.equal(buildStrategyFrame({ message: 'هدف رشد ۲۰٪ در دوازده ماه', context: {} }).goal.months, 12);
  assert.equal(buildStrategyFrame({ message: '20% return in 3 months', context: {} }).goal.months, 3);
});

test('no goal is a named gap, not an invented target', () => {
  const frame = buildStrategyFrame({ message: 'یک استراتژی بده', context: {} });
  assert.equal(frame.goal, null);
  assert.ok(frame.gaps.includes('goal'));
  assert.equal(renderStrategyFrame(frame).includes('GOAL MATH'), false);
});

test('the frame renders the goal arithmetic in full', () => {
  const frame = buildStrategyFrame({ message: 'استراتژی ۲۰٪ سود در ۶ ماه', context: {} });
  const block = renderStrategyFrame(frame);
  assert.match(block, /GOAL MATH/);
  assert.match(block, /\+20% over 6 months/);
  assert.match(block, /3\.09%\/month/);
  assert.match(block, /44% annualised/);
  assert.match(block, /21\.4% gross/);
  assert.match(block, /do not round the obligation away/);
});

/* -------------------------------------------------------------------------- */
/*  B. PLAN-LEVEL RISK                                                        */
/* -------------------------------------------------------------------------- */

test('all stops hit at once is compared with the drawdown the user agreed to', () => {
  const twoLegs = '۴۰٪ سرمایه در BTC با حد ضرر ۸٪ و ۳۰٪ در ETH با حد ضرر ۱۰٪؛ حداکثر افت ۵٪.';
  const bad = checkPlanArithmetic(twoLegs, FRAME);
  assert.deepEqual(bad.violations.map((v) => v.id), ['portfolio_risk_exceeds_budget']);
  assert.match(bad.violations[0].detail, /6\.2%/);

  const ok = checkPlanArithmetic('۴۰٪ سرمایه در BTC با حد ضرر ۸٪ و ۳۰٪ در ETH با حد ضرر ۱۰٪؛ حداکثر افت ۸٪.', FRAME);
  assert.equal(ok.clean, true, '6.2% fits inside an 8% drawdown');
});

test('one leg is not treated as a portfolio', () => {
  const single = checkPlanArithmetic('۴۰٪ سرمایه در BTC با حد ضرر ۸٪؛ حداکثر افت ۵٪.', FRAME);
  assert.equal(single.clean, true);
});

test('risking more than the target can make is caught', () => {
  const bad = checkPlanArithmetic('خرید BTC در ۱۰۰٬۰۰۰، حد ضرر ۹۵٬۰۰۰، هدف ۱۰۲٬۰۰۰.', FRAME);
  assert.deepEqual(bad.violations.map((v) => v.id), ['risk_reward_below_1']);
  assert.match(bad.violations[0].detail, /reward\/risk of 0\.4/);

  const good = checkPlanArithmetic('خرید BTC در ۱۰۰٬۰۰۰، حد ضرر ۹۵٬۰۰۰، هدف ۱۱۰٬۰۰۰.', FRAME);
  assert.equal(good.clean, true, 'a 2:1 plan is not flagged');
});

test('a stop without a target is not judged on reward/risk', () => {
  assert.equal(checkPlanArithmetic('خرید BTC در ۱۰۰٬۰۰۰ با حد ضرر ۹۵٬۰۰۰.', FRAME).clean, true);
});

/* -------------------------------------------------------------------------- */
/*  C. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const CONTEXT = {
  portfolio: { totalValueUsd: 10000, holdings: [{ symbol: 'BTC', valueUsd: 6000 }] },
  market: { priceMap: { BTC: 108000 }, dataStatus: 'live' }
};

const ANSWER = 'هدف ۲۰٪ در ۶ ماه یعنی ۳٫۰۹٪ در ماه؛ بودجهٔ ریسک حداکثر افت ۱۵٪. ۳۰٪ سرمایه در BTC با '
  + 'شرط ورود زیر ۱۰۰٬۰۰۰ دلار و حد ضرر ۹۲٬۰۰۰ دلار؛ کارمزد رفت‌وبرگشت ۱.۴٪ از بازده کم می‌شود. '
  + 'سناریوی صعودی، پایه و نزولی با همین سطوح، بازبینی ماهانه.';

function makeFleet({ finalAnswer = ANSWER } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: سبد متمرکز است.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI'))
  };
}

test('max: goal arithmetic reaches the model and is published with the reply', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'استراتژی سرمایه‌گذاری ۲۰٪ سود در ۶ ماه با این سبد چیست؟',
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  const prompt = fleet.finalCalls()[0].system;
  assert.match(prompt, /GOAL MATH/);
  assert.match(prompt, /3\.09%\/month/);
  assert.equal(out.strategy.frame.goal.requiredAnnualPct, 44);
  assert.equal(out.strategy.arithmetic.clean, true);
});

test('balanced: no goal math anywhere', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'استراتژی سرمایه‌گذاری ۲۰٪ سود در ۶ ماه با این سبد چیست؟',
    locale: 'fa',
    context: CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.strategy, null);
  for (const c of fleet.calls) assert.equal(c.system.includes('GOAL MATH'), false);
});
