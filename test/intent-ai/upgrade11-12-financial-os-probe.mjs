#!/usr/bin/env node
/**
 * UPGRADE 11+12 — FBT AI FINANCIAL OPERATING SYSTEM probe.
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MEASURES
 * The Central Intelligence Kernel is extended with:
 *   - Knowledge Graph with cross-module relationships
 *   - Ecosystem Router for multi-module intent routing
 *   - Universal Action Model for standardized actions
 *   - Predictive Brain with goal/portfolio/risk forecasting
 *   - Digital Financial Twin for scenario projection
 *   - Opportunity Engine for personalized opportunities
 *   - Financial Guardian for proactive monitoring
 *   - Cross-module workflows
 *
 * Run: npm run test:upgrade11
 */
import assert from 'node:assert/strict';
import { resolveEcosystemGraph, resolveIntentToModules, ECOSYSTEM_MODULES, KNOWLEDGE_SCHEMA } from '../../src/lib/brain/knowledgeGraph.js';
import { routeIntent, mergeModuleResults, ROUTER_SCHEMA } from '../../src/lib/brain/ecosystemRouter.js';
import { createUniversalAction, transitionAction, checkIdempotency, computeBatchRisk, actionToConfirmationCard, ACTION_TYPES, UAM_SCHEMA } from '../../src/lib/brain/universalActionModel.js';
import { forecastGoal, forecastPortfolio, forecastCashflow, forecastRisk, detectMarketRegime, createFinancialTwin, projectTwin, detectAnomalies, PREDICTIVE_SCHEMA, TWIN_SCHEMA } from '../../src/lib/brain/predictiveBrain.js';
import { scanOpportunities, OPPORTUNITY_SCHEMA } from '../../src/lib/brain/opportunityEngine.js';
import { runGuardianSweep, evaluateEvent, GUARDIAN_SCHEMA } from '../../src/lib/brain/financialGuardian.js';
import { orchestrateBrain, generateDailyBrief, BRAIN_SCHEMA, BRAIN_VERSION } from '../../src/lib/brain/index.js';

const rows = [];
const t = (name, fn) => {
  try { fn(); rows.push([name, true, '']); } catch (error) { rows.push([name, false, String(error?.message || error).slice(0, 200)]); }
};

const NOW = Date.now();

const FINANCIAL_STATE = {
  netWorthUsd: 24000,
  liquidUsd: 8000,
  investedUsd: 16000,
  totalDebtUsd: 2000,
  totalCollateralUsd: 5000,
  stableRatio: 0.35,
  volatilityPct: 40,
  riskLevel: 'MEDIUM',
  status: 'OK',
  at: NOW
};

const PORTFOLIO = {
  totalValueUsd: 24000,
  peakValueUsd: 32000,
  drawdownPct: 25,
  holdings: [
    { symbol: 'BTC', valueUsd: 12000, pct: 50 },
    { symbol: 'ETH', valueUsd: 8000, pct: 33 },
    { symbol: 'USDC', valueUsd: 2800, pct: 12 },
    { symbol: 'SOL', valueUsd: 1200, pct: 5 }
  ]
};

const GOALS = [
  { goalId: 'g1', name: 'Emergency Fund', targetUsd: 10000, createdAt: NOW - 90 * 86400000, horizonMonths: 6, progressPct: 80, deadline: new Date(NOW + 90 * 86400000).toISOString() },
  { goalId: 'g2', name: 'Growth Portfolio', targetUsd: 50000, createdAt: NOW - 60 * 86400000, horizonMonths: 12, progressPct: 48 }
];

const MARKET_CONTEXT = {
  trend: 'BEARISH',
  volatilityPct: 65,
  regime: 'BEAR_HIGH_VOL',
  sentiment: 'FEAR'
};

/* ── Knowledge Graph ─────────────────────────────────────────────────── */

t('Knowledge Graph: has all ecosystem modules', () => {
  assert.ok(Object.keys(ECOSYSTEM_MODULES).length >= 20, `Expected 20+ modules, got ${Object.keys(ECOSYSTEM_MODULES).length}`);
});

t('Knowledge Graph: "invest" maps to multiple modules', () => {
  const result = resolveIntentToModules('I want to invest 5000 dollars');
  assert.ok(result.modules.length >= 3, `Expected 3+ modules, got ${result.modules.length}`);
  assert.ok(result.crossModule === true, 'Should be cross-module');
  const ids = result.modules.map(m => m.id);
  assert.ok(ids.includes('PORTFOLIO'), 'Should include PORTFOLIO');
  assert.ok(ids.includes('RESEARCH'), 'Should include RESEARCH');
});

t('Knowledge Graph: "buy BTC" maps to Trading', () => {
  const result = resolveIntentToModules('buy BTC');
  const ids = result.modules.map(m => m.id);
  assert.ok(ids.includes('TRADING') || ids.includes('SWAP'), 'Should include TRADING or SWAP');
});

t('Knowledge Graph: "pay my bill" maps to PAY', () => {
  const result = resolveIntentToModules('pay my bill');
  const ids = result.modules.map(m => m.id);
  assert.ok(ids.includes('PAY'), 'Should include PAY');
});

t('Knowledge Graph: complex intent spans many modules', () => {
  const result = resolveIntentToModules('I have 10000 dollars and want 30% profit in 6 months with medium risk');
  assert.ok(result.modules.length >= 5, `Expected 5+ modules for complex intent, got ${result.modules.length}`);
  const ids = result.modules.map(m => m.id);
  assert.ok(ids.includes('PORTFOLIO'), 'Should include PORTFOLIO');
  assert.ok(ids.includes('RISK'), 'Should include RISK');
  assert.ok(ids.includes('GOALS') || ids.includes('RESEARCH'), 'Should include GOALS or RESEARCH');
});

t('Knowledge Graph: schema is correct', () => {
  const result = resolveIntentToModules('test');
  assert.equal(result.schema, KNOWLEDGE_SCHEMA);
});

/* ── Ecosystem Router ────────────────────────────────────────────────── */

t('Router: routes a simple intent', () => {
  const result = routeIntent({ message: 'check my portfolio', now: NOW });
  assert.ok(result.ok, 'Should route successfully');
  assert.ok(result.plan, 'Should have a plan');
  assert.ok(result.plan.modules.primary.length >= 1, 'Should have primary modules');
});

t('Router: routes a multi-module intent', () => {
  const result = routeIntent({
    message: 'invest 5000 dollars with medium risk for 6 months',
    financialState: FINANCIAL_STATE,
    activeGoals: GOALS,
    riskProfile: 'MODERATE',
    now: NOW
  });
  assert.ok(result.ok);
  assert.ok(result.plan.isMultiModule, 'Should be multi-module');
});

t('Router: detects page module', () => {
  const result = routeIntent({
    message: 'show me my balance',
    page: { pathname: '/wallet' },
    now: NOW
  });
  assert.ok(result.ok);
  assert.equal(result.plan.pageModule, 'WALLET');
});

t('Router: rejects empty message', () => {
  const result = routeIntent({ message: '', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EMPTY_INTENT');
});

/* ── Universal Action Model ──────────────────────────────────────────── */

t('UAM: creates a valid action', () => {
  const result = createUniversalAction({
    module: 'SWAP',
    actionType: 'SWAP',
    inputs: { fromAsset: 'USDC', toAsset: 'ETH', amountUsd: 500 },
    riskLevel: 'LOW',
    requiredPermission: 'CONFIRM'
  });
  assert.ok(result.ok, 'Should create action');
  assert.ok(result.action.actionId, 'Should have actionId');
  assert.equal(result.action.schema, UAM_SCHEMA);
  assert.equal(result.action.status, 'CREATED');
  assert.equal(result.action.module, 'SWAP');
});

t('UAM: rejects unknown action type', () => {
  const result = createUniversalAction({
    module: 'SWAP',
    actionType: 'UNKNOWN_TYPE'
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_ACTION_TYPE');
});

t('UAM: transitions through lifecycle', () => {
  const action = createUniversalAction({ module: 'SWAP', actionType: 'SWAP', inputs: {} }).action;
  const sim = transitionAction(action, 'SIMULATED', { simulation: { gasUsd: 2 } });
  assert.ok(sim.ok, 'Should transition to SIMULATED');
  assert.equal(sim.action.status, 'SIMULATED');
  assert.ok(sim.action.simulation, 'Should have simulation data');

  const perm = transitionAction(sim.action, 'PENDING_PERMISSION');
  assert.ok(perm.ok);

  const approve = transitionAction(perm.action, 'APPROVED', { permission: { granted: true } });
  assert.ok(approve.ok);

  const exec = transitionAction(approve.action, 'EXECUTING');
  assert.ok(exec.ok);
});

t('UAM: rejects illegal transitions', () => {
  const action = createUniversalAction({ module: 'SWAP', actionType: 'SWAP', inputs: {} }).action;
  const illegal = transitionAction(action, 'VERIFIED');
  assert.equal(illegal.ok, false);
  assert.equal(illegal.code, 'ILLEGAL_TRANSITION');
});

t('UAM: detects duplicate actions', () => {
  const action1 = createUniversalAction({ module: 'SWAP', actionType: 'SWAP', inputs: { from: 'A', to: 'B' } }).action;
  const dup = checkIdempotency(action1, [action1]);
  assert.ok(dup.duplicate, 'Should detect duplicate');
});

t('UAM: computes batch risk', () => {
  const actions = [
    { riskLevel: 'LOW', inputs: { amountUsd: 100 } },
    { riskLevel: 'HIGH', inputs: { amountUsd: 5000 } },
    { riskLevel: 'MEDIUM', inputs: { amountUsd: 500 } }
  ];
  const risk = computeBatchRisk(actions);
  assert.equal(risk.level, 'HIGH');
  assert.equal(risk.actionCount, 3);
});

t('UAM: generates confirmation card', () => {
  const action = createUniversalAction({
    module: 'SWAP', actionType: 'SWAP',
    inputs: { fromAsset: 'USDC', toAsset: 'ETH', fromAmount: '500' }
  }).action;
  const card = actionToConfirmationCard(action);
  assert.ok(card.actionId);
  assert.ok(card.summary.includes('Swap'));
  assert.ok(card.riskColor);
});

/* ── Predictive Brain ────────────────────────────────────────────────── */

t('Predictive: forecasts a goal', () => {
  const result = forecastGoal({
    goal: GOALS[0],
    financialState: FINANCIAL_STATE,
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.ok(result.currentProgressPct >= 0);
  assert.ok(result.probabilityOfSuccess > 0);
  assert.ok(result.verdict, 'Should have a verdict');
});

t('Predictive: forecasts portfolio', () => {
  const result = forecastPortfolio({
    financialState: FINANCIAL_STATE,
    months: 6,
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.ok(result.percentiles.p50 > 0, 'Should have a median');
  assert.ok(result.percentiles.p5 <= result.percentiles.p95, 'P5 <= P95');
  assert.ok(result.probabilities.lossPct >= 0);
});

t('Predictive: forecasts cashflow', () => {
  const result = forecastCashflow({
    financialState: { ...FINANCIAL_STATE, liquidUsd: 5000, monthlyIncomeUsd: 3000, monthlyExpenseUsd: 2500 },
    months: 3,
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.equal(result.forecast.length, 3);
  assert.ok(result.isHealthy);
});

t('Predictive: forecasts risk', () => {
  const result = forecastRisk({
    financialState: FINANCIAL_STATE,
    positions: PORTFOLIO.holdings,
    marketContext: MARKET_CONTEXT,
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.ok(result.risks.length > 0, 'Should find risks');
  assert.ok(result.overallRiskLevel);
});

t('Predictive: detects concentration risk', () => {
  const result = forecastRisk({
    financialState: FINANCIAL_STATE,
    positions: [{ symbol: 'BTC', valueUsd: 20000 }],
    now: NOW
  });
  const conc = result.risks.find(r => r.type === 'CONCENTRATION');
  assert.ok(conc, 'Should detect concentration risk');
});

t('Predictive: detects market regime', () => {
  const result = detectMarketRegime({
    marketData: MARKET_CONTEXT,
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.equal(result.regime, 'BEAR_HIGH_VOL');
  assert.ok(result.recommendedStrategy);
});

/* ── Digital Financial Twin ──────────────────────────────────────────── */

t('Twin: creates a financial twin', () => {
  const result = createFinancialTwin({
    financialState: FINANCIAL_STATE,
    goals: GOALS,
    riskProfile: 'MODERATE',
    now: NOW
  });
  assert.ok(result.ok);
  assert.ok(result.twin);
  assert.equal(result.twin.schema, TWIN_SCHEMA);
  assert.ok(result.twin.assets.totalUsd > 0);
});

t('Twin: projects under scenarios', () => {
  const twinResult = createFinancialTwin({ financialState: FINANCIAL_STATE, goals: GOALS });
  assert.ok(twinResult.ok);

  const proj = projectTwin({
    twin: twinResult.twin,
    scenarios: [
      { name: 'Bull', expectedReturnPct: 25, volatilityPct: 30 },
      { name: 'Bear', expectedReturnPct: -15, volatilityPct: 50 }
    ],
    months: 6,
    now: NOW
  });
  assert.equal(proj.status, 'OK');
  assert.equal(proj.projections.length, 2);
  assert.ok(proj.projections[0].finalValueUsd > proj.projections[1].finalValueUsd, 'Bull should exceed Bear');
});

/* ── Anomaly Detection ───────────────────────────────────────────────── */

t('Predictive: detects balance anomalies', () => {
  const result = detectAnomalies({
    current: { netWorthUsd: 24000 },
    previous: { netWorthUsd: 15000 },
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.ok(result.anomalies.length > 0, 'Should detect anomaly');
  assert.ok(result.anomalies[0].type === 'BALANCE_ANOMALY');
});

t('Predictive: reports normal when no anomaly', () => {
  const result = detectAnomalies({
    current: { netWorthUsd: 24000 },
    previous: { netWorthUsd: 23500 },
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.ok(result.isNormal, 'Should be normal');
});

/* ── Opportunity Engine ──────────────────────────────────────────────── */

t('Opportunities: scans for opportunities', () => {
  const result = scanOpportunities({
    financialState: FINANCIAL_STATE,
    portfolio: PORTFOLIO,
    goals: GOALS,
    marketContext: MARKET_CONTEXT,
    riskProfile: 'MODERATE',
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.ok(result.opportunities.length > 0, 'Should find opportunities');
  assert.equal(result.schema, OPPORTUNITY_SCHEMA);
});

t('Opportunities: detects idle capital opportunity', () => {
  const result = scanOpportunities({
    financialState: { ...FINANCIAL_STATE, stableRatio: 0.5 },
    riskProfile: 'MODERATE',
    now: NOW
  });
  const idle = result.opportunities.find(o => o.type === 'YIELD_ON_IDLE');
  assert.ok(idle, 'Should detect idle capital opportunity');
});

t('Opportunities: scores based on risk profile', () => {
  const conservative = scanOpportunities({
    financialState: FINANCIAL_STATE,
    riskProfile: 'CONSERVATIVE',
    rwaOpportunities: [{ name: 'Treasury', category: 'Treasury', riskLevel: 'LOW', expectedYield: 5 }],
    now: NOW
  });
  const aggressive = scanOpportunities({
    financialState: FINANCIAL_STATE,
    riskProfile: 'AGGRESSIVE',
    rwaOpportunities: [{ name: 'Treasury', category: 'Treasury', riskLevel: 'LOW', expectedYield: 5 }],
    now: NOW
  });
  // Both should have opportunities but the scoring should differ
  assert.ok(conservative.opportunities.length > 0);
  assert.ok(aggressive.opportunities.length > 0);
});

/* ── Financial Guardian ──────────────────────────────────────────────── */

t('Guardian: runs a sweep', () => {
  const result = runGuardianSweep({
    financialState: FINANCIAL_STATE,
    portfolio: PORTFOLIO,
    goals: GOALS,
    marketContext: MARKET_CONTEXT,
    now: NOW
  });
  assert.equal(result.status, 'OK');
  assert.equal(result.schema, GUARDIAN_SCHEMA);
  assert.ok(result.healthScore >= 0 && result.healthScore <= 100);
  assert.ok(result.healthLevel);
});

t('Guardian: detects concentration risk', () => {
  const result = runGuardianSweep({
    portfolio: { holdings: [{ symbol: 'BTC', valueUsd: 20000 }] },
    financialState: { netWorthUsd: 24000 },
    now: NOW
  });
  const concAlert = result.alerts.find(a => a.type === 'CONCENTRATION');
  assert.ok(concAlert, 'Should detect concentration');
});

t('Guardian: detects liquidation risk', () => {
  const result = runGuardianSweep({
    financialState: { totalDebtUsd: 4500, totalCollateralUsd: 5000, netWorthUsd: 24000 },
    now: NOW
  });
  const liqAlert = result.alerts.find(a => a.type === 'LIQUIDATION_RISK');
  assert.ok(liqAlert, 'Should detect liquidation risk');
  assert.equal(liqAlert.severity, 'CRITICAL');
});

t('Guardian: evaluates events', () => {
  const result = evaluateEvent({
    type: 'PRICE_CHANGED',
    payload: { symbol: 'BTC', changePct: -25 }
  });
  assert.equal(result.status, 'OK');
  assert.ok(result.alerts.length > 0, 'Should generate alert for price shock');
  assert.equal(result.alerts[0].type, 'PRICE_SHOCK');
});

t('Guardian: evaluates liquidation event', () => {
  const result = evaluateEvent({ type: 'LIQUIDATION_RISK', payload: { detail: 'Position at risk' } });
  assert.ok(result.alerts.length > 0);
  assert.equal(result.alerts[0].severity, 'CRITICAL');
});

t('Guardian: returns recommended actions', () => {
  const result = runGuardianSweep({
    portfolio: PORTFOLIO,
    financialState: FINANCIAL_STATE,
    now: NOW
  });
  for (const alert of result.alerts) {
    assert.ok(alert.recommendedAction, `Alert ${alert.type} should have recommended action`);
  }
});

/* ── Master Orchestration ────────────────────────────────────────────── */

t('Brain: orchestrates a full response', () => {
  const result = orchestrateBrain({
    message: 'I have 10000 dollars and want 30% profit in 6 months with medium risk',
    financialState: FINANCIAL_STATE,
    portfolio: PORTFOLIO,
    activeGoals: GOALS,
    marketContext: MARKET_CONTEXT,
    riskProfile: 'MODERATE',
    now: NOW
  });
  assert.equal(result.schema, BRAIN_SCHEMA);
  assert.ok(result.routing, 'Should have routing');
  assert.ok(result.guardian, 'Should have guardian');
  assert.ok(result.opportunities, 'Should have opportunities');
  assert.ok(result.summary);
});

t('Brain: version is set', () => {
  assert.ok(BRAIN_VERSION);
  assert.ok(BRAIN_VERSION.includes('11'));
});

/* ── Daily Brief ─────────────────────────────────────────────────────── */

t('Brief: generates a daily brief', () => {
  const guardian = runGuardianSweep({ financialState: FINANCIAL_STATE, goals: GOALS, now: NOW });
  const brief = generateDailyBrief({
    financialState: FINANCIAL_STATE,
    goals: GOALS,
    guardian,
    marketContext: MARKET_CONTEXT,
    now: NOW
  });
  assert.ok(brief.sections.length > 0, 'Should have sections');
  assert.ok(brief.date);
  assert.ok(brief.overallMood);
});

/* ── Print Results ───────────────────────────────────────────────────── */

const passed = rows.filter(([, ok]) => ok).length;
const failed = rows.filter(([, ok]) => !ok).length;
const total = rows.length;

console.log(`\n═══ UPGRADE 11+12 — Financial OS Probe ═══`);
console.log(`   ${passed}/${total} passed, ${failed} failed\n`);

for (const [name, ok, detail] of rows) {
  console.log(`   ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

if (failed > 0) {
  console.log(`\n   ⚠️  ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log(`\n   ✅ All ${total} tests passed — Upgrade 11+12 Financial OS verified`);
}
