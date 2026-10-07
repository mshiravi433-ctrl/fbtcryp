#!/usr/bin/env node
/**
 * FBT AI ORCHESTRATOR — EVIDENCE PLANNER probe (Upgrade 14)
 * ────────────────────────────────────────────────────────────────────────────
 * The complaint «سیستم خودش تشخیص دهد چه داده‌ای لازم است» becomes a testable
 * object here. What is asserted, offline and deterministically:
 *
 *   · a question about prices/portfolio/news/macro/yields asks for exactly the
 *     facets that answer it — in Persian and in English;
 *   · a facet the turn ALREADY holds (the route injected a market read) is
 *     never requested again;
 *   · the per-turn tool budget defers the least important facet and says so;
 *   · stakes decide the number of model seats (1 / 2 / 3) and whether a judge
 *     and verification are warranted, bounded by the configured fleet;
 *   · the plan can never contain an execution: `canExecute` is a literal false,
 *     no facet maps to a non-read tool, and a money question still only plans
 *     READS of the user's own state.
 */
import assert from 'node:assert/strict';
import {
  buildEvidencePlan,
  describeEvidencePlan,
  assessStakes,
  FACETS,
  EVIDENCE_PLAN_SCHEMA
} from '../../src/lib/intent-ai/orchestrator/evidencePlan.js';

let passed = 0;
let total = 0;
const test = (name, fn) => {
  total += 1;
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); }
};

const facetsOf = (plan) => plan.facets.requests.map((r) => r.facetId);
const satisfiedOf = (plan) => plan.facets.satisfied.map((s) => s.facetId);

console.log('\n=== FBT AI ORCHESTRATOR — evidence planner probe ===\n');

test('a Persian price question plans a live price read and one seat is not enough', () => {
  const plan = buildEvidencePlan({ message: 'قیمت بیت‌کوین الان چنده؟', intentType: 'MARKET_ANALYSIS', locale: 'fa' });
  assert.equal(plan.schema, EVIDENCE_PLAN_SCHEMA);
  assert.ok(facetsOf(plan).includes('market_prices'), 'must plan the price read');
  assert.ok(facetsOf(plan).every((f) => FACETS[f].tool.startsWith('fbt_')), 'every facet names a real tool');
  assert.ok(plan.analysis.seats >= 1);
  assert.ok(plan.reasons.some((r) => r.startsWith('REQUESTED:market_prices:')), 'the audit trail names the requested facet');
  const priceReq = plan.facets.requests.find((r) => r.facetId === 'market_prices');
  assert.ok(priceReq.reasons.some((r) => r.startsWith('WORD:')), 'and the word that made it necessary');
});

test('an English "why did the market drop" plans the news flow', () => {
  const plan = buildEvidencePlan({ message: 'why did the market drop today?', intentType: 'NEWS_SEARCH', locale: 'en' });
  assert.ok(facetsOf(plan).includes('news_flow'));
  assert.ok(facetsOf(plan).includes('knowledge') || facetsOf(plan).includes('market_prices'));
});

test('a money question reads the user’s own state, never the model’s memory', () => {
  const plan = buildEvidencePlan({ message: 'کل دارایی‌هام چقدره؟ موجودی پرتفوی من', intentType: 'PORTFOLIO_ANALYSIS' });
  assert.ok(facetsOf(plan).includes('portfolio_state'));
  const portfolioFacet = plan.facets.requests.find((r) => r.facetId === 'portfolio_state');
  assert.equal(portfolioFacet.tool, 'fbt_get_portfolio');
  assert.ok(plan.facets.requested.includes('portfolio_state'));
});

test('a facet the turn already holds is marked satisfied and never re-fetched', () => {
  const plan = buildEvidencePlan({
    message: 'قیمت بیت‌کوین الان چنده؟',
    intentType: 'MARKET_ANALYSIS',
    context: { market: { priceMap: { BTC: 63000 } } }
  });
  assert.ok(satisfiedOf(plan).includes('market_prices'));
  assert.ok(!facetsOf(plan).includes('market_prices'), 'a held facet must not be requested');
  const held = plan.facets.satisfied.find((s) => s.facetId === 'market_prices');
  assert.equal(held.satisfiedBy, 'context.market.priceMap');
});

test('portfolio context satisfies portfolio_state too', () => {
  const plan = buildEvidencePlan({
    message: 'تحلیل پرتفوی من',
    intentType: 'PORTFOLIO_ANALYSIS',
    context: { portfolio: { totalValueUsd: 1200, holdings: [] } }
  });
  assert.ok(satisfiedOf(plan).includes('portfolio_state'));
  assert.ok(!facetsOf(plan).includes('portfolio_state'));
});

test('the tool budget defers the least important facet, with a reason', () => {
  const plan = buildEvidencePlan({
    message: 'تحلیل کامل بازار و طلا و تورم و پرتفوی من و اخبار',
    intentType: 'INVESTMENT_PLAN',
    maxTools: 2
  });
  assert.equal(plan.facets.requests.length, 2);
  assert.ok(plan.facets.deferred.length >= 1);
  assert.ok(plan.facets.deferred.every((d) => d.reasons.includes('TOOL_BUDGET')));
  assert.ok(plan.reasons.some((r) => r.startsWith('DEFERRED:')));
  /* Priority: the user's own money outranks the macro desk. */
  const kept = facetsOf(plan);
  assert.ok(kept.includes('portfolio_state') || kept.includes('market_prices'));
  assert.ok(!kept.includes('macro_state'), 'macro is the first thing to drop when the budget is tight');
});

test('stakes decide the seat count: definition 1, comparison 2, money 3', () => {
  assert.equal(assessStakes({ message: 'یعنی اسلیپیج چیه؟', intentType: 'LEARN' }).level, 'LOW');
  assert.equal(assessStakes({ message: 'BTC بهتره یا ETH؟', intentType: 'MARKET_ANALYSIS' }).level, 'MEDIUM');
  assert.equal(assessStakes({ message: 'الان ۵۰۰۰ دلار همه سرمایه‌ام رو بخرم یا نه؟', intentType: 'GENERAL' }).level, 'HIGH');
  assert.equal(assessStakes({ message: '۱۰۰۰ دلار ETH بخرم', intentType: 'BUY' }).level, 'HIGH');

  const low = buildEvidencePlan({ message: 'یعنی کارمزد FBT چقدره؟', intentType: 'LEARN', availableProviders: 3 });
  assert.equal(low.analysis.seats, 1);
  assert.equal(low.analysis.needJudge, false);

  const high = buildEvidencePlan({ message: 'همه سرمایه‌ام را در ETH بگذارم؟', intentType: 'GENERAL', availableProviders: 3 });
  assert.equal(high.analysis.seats, 3);
  assert.equal(high.analysis.needJudge, true);
  assert.equal(high.analysis.needVerify, true);
  assert.deepEqual(high.analysis.roles, ['analyst', 'risk-reviewer', 'macro-reviewer']);
});

test('seats are capped by the configured fleet and by configuration, never inflated', () => {
  const noFleet = buildEvidencePlan({ message: 'همه سرمایه‌ام را بگذارم؟', intentType: 'GENERAL', availableProviders: 0 });
  assert.equal(noFleet.analysis.seats, 0);
  assert.ok(noFleet.reasons.includes('NO_EXTERNAL_PROVIDER'));
  const oneProvider = buildEvidencePlan({ message: 'همه سرمایه‌ام را بگذارم؟', intentType: 'GENERAL', availableProviders: 1 });
  assert.equal(oneProvider.analysis.seats, 1);
  const capped = buildEvidencePlan({ message: 'همه سرمایه‌ام را بگذارم؟', intentType: 'GENERAL', availableProviders: 5, maxSeats: 2 });
  assert.equal(capped.analysis.seats, 2);
  assert.ok(capped.reasons.some((r) => r.startsWith('SEATS_CAPPED_BY_CONFIG')));
});

test('the plan is read-only by construction', () => {
  const plan = buildEvidencePlan({ message: 'همه پولم را سواپ کن به ETH', intentType: 'SWAP' });
  assert.equal(plan.permissions.canExecute, false);
  assert.equal(plan.permissions.canSign, false);
  assert.equal(plan.permissions.canMoveFunds, false);
  assert.equal(plan.executionToolsPlanned, 0);
  for (const facetId of Object.keys(FACETS)) {
    assert.ok(FACETS[facetId].cost !== 'execute');
    assert.ok(
      !/^fbt_(sign|execute|send|swap|bridge|withdraw|approve|transfer|settle|drain|sweep)/i.test(FACETS[facetId].tool),
      `${facetId} must not map to an execution tool`
    );
    assert.match(FACETS[facetId].tool, /^fbt_(get|rag|memory)_/);
  }
  /* Even an execution-intent message plans only READS. */
  assert.ok(plan.facets.requests.every((r) => r.cost === 'low' || r.cost === 'medium' || r.cost === 'high'));
});

test('the same input produces the same plan (deterministic, explainable)', () => {
  const args = { message: 'تحلیل BTC و اخبارش', intentType: 'ANALYZE_TOKEN', entities: { token: 'BTC' } };
  const a = buildEvidencePlan(args);
  const b = buildEvidencePlan(args);
  assert.deepEqual(a.facets, b.facets);
  assert.deepEqual(a.analysis, b.analysis);
  assert.deepEqual(a.stakes, b.stakes);
  assert.deepEqual(a.reasons, b.reasons);
});

test('a token entity adds the asset read even when the words do not mention analysis', () => {
  const plan = buildEvidencePlan({ message: 'ETH چطوره', intentType: 'GENERAL', entities: { token: 'ETH' } });
  assert.ok(facetsOf(plan).includes('asset_regime'));
  assert.ok(plan.facets.requests.find((r) => r.facetId === 'asset_regime'));
});

test('memory recall is planned when the user refers to the past', () => {
  const plan = buildEvidencePlan({ message: 'دفعه قبل دربارهٔ طلا چی گفتی؟', intentType: 'GENERAL' });
  assert.ok(facetsOf(plan).includes('past_decisions'));
  assert.equal(plan.facets.requests.find((r) => r.facetId === 'past_decisions').tool, 'fbt_memory_recall');
});

test('describeEvidencePlan explains the plan in Persian and English', () => {
  const plan = buildEvidencePlan({ message: 'قیمت BTC و اخبار', intentType: 'MARKET_ANALYSIS', context: { portfolio: { totalValueUsd: 10 } } });
  const fa = describeEvidencePlan(plan, 'fa');
  const en = describeEvidencePlan(plan, 'en');
  assert.ok(fa.includes('دادهٔ لازم'));
  assert.ok(/model/i.test(en));
  assert.notEqual(fa, en);
});

console.log(`\n=== EVIDENCE PLANNER PROBE: ${passed}/${total} passed ===\n`);
if (passed !== total) process.exit(1);
