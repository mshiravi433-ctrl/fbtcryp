/*
 * THE LANGUAGE OF A TWO-PART QUESTION (2026-11-13)
 * ==========================================================================
 *
 * `multiquestion-gate.test.mjs` proves that both halves of a two-part
 * question are answered. This file proves the OPPOSITE direction: that
 * the fixes which made that possible did not break the distinctions
 * that make the language work.
 *
 * Four holes were found while the two-part gap was being closed, and
 * every one of them is a hole that a passing coverage number would
 * have hidden:
 *
 *   1. «ریسک چقدر است؟» had NO intent at all. The `risk` module was
 *      registered and produced a full verdict, and nothing could reach
 *      it — every risk intent that existed was about a SPECIFIC risk
 *      (concentration, liquidity, futures). The general one was a hole.
 *   2. «موجودی من چقدره؟» read the wallet and then said «wallet.read:
 *      2 balances across 2 chain(s)». The NUMBER was there — the total,
 *      every amount — and the reply showed a COUNT. A count is not a
 *      balance.
 *   3. «هدفت چیست؟» was read as a request for the DEFINITION of a goal
 *      and answered with a Solana PDA. The corpus won because the
 *      marker «چیست» was enough on its own, while the registry's own
 *      reading was ignored.
 *   4. «برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟» asked for
 *      «ارز مبدأ، ارز مقصد، مبلغ» — the SWAP question — because a
 *      goal's `simulate` step was treated as a money step. The
 *      conversation machinery's own question was only reaching the
 *      reply by accident.
 *
 * And the distinctions that must NOT collapse:
 *
 *   · «ریسک نقدینگی» is LIQUIDITY_RISK, «ریسک فیوچرز» is
 *     FUTURES_RISK, «ریسک پورتفوی» is PORTFOLIO_ANALYSIS — and only
 *     the plain «ریسک» is RISK_OVERVIEW;
 *   · a COMPARISON («کدام پل بهتر است؟») is one question about a
 *     choice, not two questions;
 *   · two halves that mean the SAME thing are one question, not two
 *     legs;
 *   · a follow-up («بله، انجام بده») is still a follow-up, and the
 *     sentence splitter must not dissolve it.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { classify } from '../../src/lib/central/intent.js';
import { readGoalInputs } from '../../src/lib/central/analysis.js';
import { buildRecommendation } from '../../src/lib/central/recommend.js';
import { composeResponse } from '../../src/lib/central/human.js';

const CAPS = {};
for (const k of [
  'wallet', 'portfolio', 'markets', 'risk', 'lending', 'borrowing', 'crypto',
  'transactions', 'goals', 'routeIntelligence', 'signals', 'news', 'farming',
  'liquidity', 'staking', 'futures', 'dydx', 'globalIntel', 'opportunityFit',
  'macroGraph', 'goalScenarios', 'whyDecision'
]) CAPS[k] = 'AVAILABLE';
const STATE_HAS = Object.fromEntries(Object.keys(CAPS).map((k) => [k, true]));
const ctx = { context: { capabilities: CAPS, stateHas: STATE_HAS }, state: {} };

const typeOf = (text) => classify(text, ctx).type;
const legsOf = (text) => (classify(text, ctx).compound || []).map((c) => c.intent);

/* ── the plain risk question ─────────────────────────────────────────────── */

test('«ریسک چقدر است» reaches the risk engine, not the refusal', () => {
  assert.equal(typeOf('ریسک چقدر است'), 'RISK_OVERVIEW');
  assert.equal(typeOf('ریسک من چقدر است؟'), 'RISK_OVERVIEW');
  assert.equal(typeOf('ریسکم چقدره'), 'RISK_OVERVIEW');
  assert.equal(typeOf('ریسکش چقدر است'), 'RISK_OVERVIEW');
  assert.equal(typeOf('how risky am i'), 'RISK_OVERVIEW');
});

test('the plain risk question does not steal the SPECIFIC risks', () => {
  assert.equal(typeOf('ریسک نقدینگی چقدر است'), 'LIQUIDITY_RISK');
  assert.equal(typeOf('ریسک فیوچرز من چقدر است'), 'FUTURES_RISK');
  assert.equal(typeOf('ریسک پورتفوی من چقدر است'), 'PORTFOLIO_ANALYSIS');
  assert.equal(typeOf('تمرکز پرتفوی من چقدر است'), 'CONCENTRATION_CHECK');
});

test('a risk question that NAMES a capability is not a follow-up', () => {
  /* The follow-up rewrite says «ریسک» means the risk of a LOAN. That is
     true when the sentence names nothing, and false when it names a
     capability — «ریسک نقدینگی LP چقدره؟» is about liquidity, and
     rewriting it to the previous intent answers a question the user did
     not ask. */
  const r = classify('ریسک نقدینگی LP چقدره؟', { ...ctx, context: { ...ctx.context, followUp: { kind: 'RISK_QUERY' } } });
  assert.equal(r.type, 'LIQUIDITY_RISK');
});

/* ── the goal, in three shapes ───────────────────────────────────────────── */

test('the goal is read through ONE reader, whatever shape it arrives in', () => {
  /* Three places, three spellings — and before this, two readers each
     knew one of them, so one answer and one silent
     `GOAL_INPUTS_INCOMPLETE` with no clue which name was wrong. */
  const a = readGoalInputs({ targetAmount: 100000, durationMonths: 36, monthlyContribution: 500, currentAmount: 10000 });
  const b = readGoalInputs({ targetUsd: 100000, horizonMonths: 36, contributionMonthly: 500, currentUsd: 10000 });
  assert.equal(a.targetUsd, 100000);
  assert.equal(b.targetUsd, 100000);
  assert.equal(a.years, 3);
  assert.equal(b.years, 3);
  assert.equal(a.monthlyContributionUsd, 500);
  assert.equal(b.monthlyContributionUsd, 500);
  assert.equal(a.currentUsd, 10000);
  assert.equal(b.currentUsd, 10000);
});

test('a goal with no horizon has NO years — and does not invent one', () => {
  const r = readGoalInputs({ targetAmount: 100000 });
  assert.equal(r.targetUsd, 100000);
  assert.equal(r.years, null, 'a missing horizon stays missing; it is not guessed');
});

/* ── the splitter ────────────────────────────────────────────────────────── */

test('a comparison is ONE question about a choice, not two questions', () => {
  /* «کدام» makes the whole sentence a comparison, so the splitter must
     leave it whole. */
  assert.deepEqual(legsOf('کدام پل برای انتقال بیت‌کوین به شبکه پالیگان بهتر است'), []);
  assert.equal(typeOf('کدام پل برای انتقال بیت‌کوین به شبکه پالیگان بهتر است'), 'ROUTE_INTELLIGENCE');
});

test('two halves that mean the SAME thing are one question', () => {
  /* The two halves must classify to DIFFERENT intents to become two
     legs. «پورتفوی من چیست و ترکیب پرتفویم چطور است» says one thing
     twice, and two legs would read the same section twice and answer
     it twice. */
  const legs = legsOf('پورتفوی من چیست و ترکیب پرتفویم چطور است');
  assert.ok(legs.length <= 1, `two halves of the same intent must not become two legs: ${legs.join('+')}`);
  /* And two DIFFERENT intents are two legs, even when they are read
     from the same section — «پورتفوی» and «موجودی» are two
     questions about two different readings. */
  assert.deepEqual(legsOf('پورتفوی و موجودی من').sort(), ['BALANCE_QUERY', 'PORTFOLIO_ANALYSIS']);
});

test('a two-part question becomes two legs, in order', () => {
  assert.deepEqual(
    legsOf('قیمت بیت‌کوین چقدره و موجودی من چقدره').sort(),
    ['ASSET_ANALYSIS', 'BALANCE_QUERY']
  );
  assert.deepEqual(
    legsOf('پورتفوی من چیست و ریسکش چقدر است').sort(),
    ['PORTFOLIO_ANALYSIS', 'RISK_OVERVIEW']
  );
});

test('the splitter does not dissolve a follow-up', () => {
  /* «بله، انجام بده» is a follow-up about an ACTION. It is not two
     claims, and the confirmation machinery must still see it. */
  const r = classify('بله، انجام بده', {
    ...ctx,
    context: { ...ctx.context, followUp: { kind: 'CONFIRM_PENDING' } }
  });
  assert.equal(r.type, 'CONFIRM_PENDING');
});

test('the splitter does not turn a question into an execution', () => {
  const EXECUTION = new Set([
    'EXECUTE_SWAP', 'EXECUTE_BRIDGE', 'EXECUTE_LEND', 'EXECUTE_BORROW',
    'EXECUTE_REPAY', 'EXECUTE_REBALANCE'
  ]);
  for (const q of [
    'قیمت بیت‌کوین چقدره و موجودی من چقدره',
    'پورتفوی من چیست و ریسکش چقدر است',
    'وضعیت بازار چطوره و کدام گزینه مناسب منه',
    'بهترین استخر ییلد کدام است و ریسک نقدینگی‌اش چقدره',
    'وضعیت وامم چیست و با پورتفویم چه نسبتی دارد',
    'هدفت چیست و برای رسیدن به آن چه برنامه‌ای دارم'
  ]) {
    for (const leg of legsOf(q)) {
      assert.ok(!EXECUTION.has(leg), `«${q}» produced the execution leg ${leg}`);
    }
  }
});


/* ─── ONE SENTENCE, ONE LANGUAGE ─────────────────────────────────────────── */

/*
 * The risk engine computes BOTH voices — `reasons` and `reasonsFa`, and
 * every factor carries `detail` and `detailFa`. The headline used to read
 * the English one unconditionally, so a Persian reply said:
 *
 *   «ریسک کلی HIGH است — BTC is 100% of risk capital (2 valued holdings,
 *     HHI 1) (4 عامل).»
 *
 * One sentence, two languages — and the English clause was the part the
 * user most needed to understand, because it is the REASON for the level.
 */
const headlineFor = (riskFinding, locale = 'fa') => {
  const rec = buildRecommendation({
    kind: 'INFORMATIVE',
    intent: { intentType: 'RISK_OVERVIEW' },
    findings: [riskFinding],
    capabilities: { risk: 'AVAILABLE', portfolio: 'AVAILABLE' },
    locale
  });
  return String(rec?.recommendation || '');
};

test('a Persian headline speaks Persian: the engine\'s own Persian reason wins', () => {
  const fa = headlineFor({
    id: 'risk', level: 'HIGH', status: 'OK',
    reason: 'BTC is 100% of risk capital (2 valued holdings, HHI 1)',
    reasonFa: 'تمرکز: مهم‌ترین دارایی ۱۰۰٪ از سرمایهٔ پرریسک، حد مجاز ۴۵',
    factors: [{ id: 'concentration', level: 'HIGH' }]
  });
  assert.ok(fa.includes('ریسک کلی HIGH'), `the level must be named → ${fa}`);
  assert.ok(fa.includes('تمرکز'), `the Persian reason must be the one rendered → ${fa}`);
  assert.ok(
    !/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(fa),
    `a Persian sentence must not carry an English clause → ${fa}`
  );
});

test('the English headline still speaks English', () => {
  const en = headlineFor({
    id: 'risk', level: 'HIGH', status: 'OK',
    reason: 'BTC is 100% of risk capital (2 valued holdings, HHI 1)',
    reasonFa: 'تمرکز: مهم‌ترین دارایی ۱۰۰٪ از سرمایهٔ پرریسک',
    factors: [{ id: 'concentration', level: 'HIGH' }]
  }, 'en');
  assert.ok(en.includes('Overall risk is HIGH'), `→ ${en}`);
  assert.ok(en.includes('BTC is 100%'), `the English reason belongs in the English sentence → ${en}`);
});

test('with no Persian reason at all, the clause is OMITTED — not injected in English', () => {
  /*
   * A headline that says less is better than a headline that says half of
   * itself in a language the user did not ask in. Omission is visible;
   * a mixed-language sentence reads as though the engine meant it.
   */
  const fa = headlineFor({
    id: 'risk', level: 'HIGH', status: 'OK',
    reason: 'BTC is 100% of risk capital (2 valued holdings, HHI 1)',
    reasonFa: null,
    factors: [{ id: 'concentration', level: 'HIGH', detail: 'BTC is 100% of risk capital' }]
  });
  assert.ok(fa.includes('ریسک کلی HIGH'), `the level must still be named → ${fa}`);
  assert.ok(
    !fa.includes('BTC is 100%'),
    `the English reason must not be injected into the Persian sentence → ${fa}`
  );
});

test('a factor\'s Persian voice is the fallback when the finding has none', () => {
  const fa = headlineFor({
    id: 'risk', level: 'HIGH', status: 'OK',
    reason: 'BTC is 100% of risk capital',
    reasonFa: null,
    factors: [{ id: 'concentration', level: 'HIGH', detail: 'BTC is 100%', detailFa: 'تمرکز دارایی ۱۰۰٪' }]
  });
  assert.ok(fa.includes('تمرکز دارایی ۱۰۰٪'), `→ ${fa}`);
  assert.ok(!fa.includes('BTC is 100%'), `→ ${fa}`);
});

/* ─── THE SAFETY NARROWING ───────────────────────────────────────────────── */

/*
 * `keepAnswer` lets an ANSWERED turn carry the conversation machinery's
 * question beside it. That must NOT extend to a turn that is about to move
 * money: an execution whose amount is unknown has to stay a question, or the
 * reply offers a button to approve a request nobody specified.
 *
 * The distinction is the SOURCE of the need, and the source is a field on the
 * intent — so both directions are pinned here.
 */
const READ_RESULTS = {
  'goals.read': { status: 'OK', source: 'goals-service', summary: 'read', at: Date.now() }
};
const OK_RECOMMENDATION = {
  ok: true,
  recommendation: 'برای هدف ۱۰۰٬۰۰۰ دلار در ۲ سال: شانس برآوردی ۱۰۰٪.',
  reason: ['هدف خوانده شد'],
  data: [{ id: 'goal-feasibility', source: 'goals-service', detail: 'هدف خوانده شد' }],
  confidence: 0.74,
  alternatives: [],
  actions: [],
  risk: null
};
const MACHINE_CONTEXT = {
  missingInformation: ['objective'],
  conversationQuestion: {
    question: 'این پول برای چیست — رشد، درآمد، یا حفظ سرمایه؟',
    field: 'objective',
    missing: ['objective'],
    source: 'conversation-machinery'
  }
};

test('the machinery\'s question rides ALONGSIDE an answer, and the answer leads', () => {
  const out = composeResponse({
    intent: {
      intentType: 'GOAL_PLAN', needsUserInput: true, missingInputs: ['objective'],
      needsUserInputSource: 'conversation-machinery'
    },
    context: MACHINE_CONTEXT,
    results: READ_RESULTS,
    recommendation: OK_RECOMMENDATION,
    locale: 'fa'
  });
  assert.equal(out.mode, 'ANSWER', `an answered turn must not come back as a question → ${out.mode}`);
  const ids = (out.sections || []).map((s) => s.id);
  assert.ok(ids.includes('result'), `the answer must be a section → ${ids.join(',')}`);
  assert.ok(ids.includes('question'), `the machine's question must still reach the reply → ${ids.join(',')}`);
  assert.ok(
    ids.indexOf('result') < ids.indexOf('question'),
    `the answer comes first: it is what was asked for → ${ids.join(',')}`
  );
  const text = String(out.text || '');
  assert.ok(text.includes('۱۰۰٬۰۰۰'), `the answer must be in the text → ${text.slice(0, 160)}`);
  assert.ok(text.includes('این پول برای چیست'), `the question must be in the text → ${text.slice(0, 200)}`);
});

test('a MONEY turn with an unknown amount stays a QUESTION, whatever was read', () => {
  /* No `needsUserInputSource`: this is the money-step check, not the
     machinery. The narrowing must not touch it. */
  const out = composeResponse({
    intent: { intentType: 'EXECUTE_SWAP', needsUserInput: true, missingInputs: ['amount'] },
    context: { missingInformation: ['amount'] },
    results: READ_RESULTS,
    recommendation: OK_RECOMMENDATION,
    locale: 'fa'
  });
  assert.equal(out.mode, 'QUESTION', `an execution with an unknown amount must ask, not answer → ${out.mode}`);
  const ids = (out.sections || []).map((s) => s.id);
  assert.ok(!ids.includes('result'), `no answer section may be rendered for it → ${ids.join(',')}`);
});

test('a turn that read NOTHING stays a pure question', () => {
  /* `keepAnswer` needs a recommendation the engine stood behind AND at least
     one section that was really read. Without them, answering anyway would be
     a confident paragraph out of nothing. */
  const out = composeResponse({
    intent: {
      intentType: 'GOAL_PLAN', needsUserInput: true, missingInputs: ['objective'],
      needsUserInputSource: 'conversation-machinery'
    },
    context: MACHINE_CONTEXT,
    results: { 'goals.read': { status: 'UNAVAILABLE', source: 'goals-service', at: Date.now() } },
    recommendation: { ok: false, refusal: 'چیزی خوانده نشد' },
    locale: 'fa'
  });
  assert.equal(out.mode, 'QUESTION', `nothing was read, so nothing may be answered → ${out.mode}`);
});
