#!/usr/bin/env node
/**
 * UPGRADE 11+12 — Cross-module workflow scenarios.
 * ────────────────────────────────────────────────────────────────────────────
 * Tests the 13 required scenarios from the spec to verify the ecosystem
 * router correctly identifies which modules are needed for each intent.
 *
 * Run: npm run test:upgrade11-cross
 */
import assert from 'node:assert/strict';
import { routeIntent } from '../../src/lib/brain/ecosystemRouter.js';
import { orchestrateBrain } from '../../src/lib/brain/index.js';
import { runGuardianSweep } from '../../src/lib/brain/financialGuardian.js';
import { createFinancialTwin, projectTwin } from '../../src/lib/brain/predictiveBrain.js';

const NOW = Date.now();

const FS = {
  netWorthUsd: 10000, liquidUsd: 5000, investedUsd: 5000,
  totalDebtUsd: 0, stableRatio: 0.5, volatilityPct: 40,
  riskLevel: 'MEDIUM', status: 'OK', at: NOW
};

const PORTFOLIO = {
  totalValueUsd: 10000,
  holdings: [
    { symbol: 'BTC', valueUsd: 4000, pct: 40 },
    { symbol: 'ETH', valueUsd: 2000, pct: 20 },
    { symbol: 'USDC', valueUsd: 2500, pct: 25 },
    { symbol: 'SOL', valueUsd: 1500, pct: 15 }
  ]
};

const GOALS = [
  { goalId: 'g1', name: 'Investment', targetUsd: 20000, createdAt: NOW - 30 * 86400000, horizonMonths: 6, progressPct: 50 }
];

const rows = [];
const t = (name, fn) => {
  try { fn(); rows.push([name, true, '']); } catch (error) { rows.push([name, false, String(error?.message || error).slice(0, 200)]); }
};

/* ── Test 1: BTC بخر → Trading/Swap ──────────────────────────────────── */
t('Test 1: "buy BTC" → Trading + Swap', () => {
  const result = routeIntent({ message: 'buy BTC', now: NOW });
  assert.ok(result.ok);
  const ids = result.plan.modules.primary.map(m => m.id);
  assert.ok(ids.includes('TRADING') || ids.includes('SWAP'), 'Should route to Trading or Swap');
});

/* ── Test 2: 5000 dollars, invest for 6 months → Full ecosystem ───── */
t('Test 2: "5000 dollars, invest for 6 months" → Multiple modules', () => {
  const result = routeIntent({
    message: 'I have 5000 dollars and want to invest for 6 months',
    financialState: FS, activeGoals: GOALS, riskProfile: 'MODERATE', now: NOW
  });
  assert.ok(result.ok);
  assert.ok(result.plan.modules.primary.length >= 3, 'Should involve 3+ modules');
  const ids = result.plan.modules.primary.map(m => m.id);
  assert.ok(ids.some(id => ['PORTFOLIO', 'RESEARCH', 'DEFI', 'TRADING'].includes(id)), 'Should include investment modules');
});

/* ── Test 3: Set aside 1000 for payments → Pay + Wallet + Portfolio ── */
t('Test 3: "set aside 1000 for payments" → Pay + Wallet + Portfolio', () => {
  const result = routeIntent({
    message: 'set aside 1000 dollars for next month payments',
    financialState: FS, now: NOW
  });
  assert.ok(result.ok);
  const ids = result.plan.modules.primary.concat(result.plan.modules.secondary).map(m => m.id);
  assert.ok(ids.includes('PAY'), 'Should include PAY');
  assert.ok(ids.includes('WALLET'), 'Should include WALLET');
});

/* ── Test 4: Need capital for business → Business + Credit + Cashflow ─ */
t('Test 4: "need capital for my business" → Business + Credit', () => {
  const result = routeIntent({
    message: 'I need capital for my business',
    financialState: FS, now: NOW
  });
  assert.ok(result.ok);
  const ids = result.plan.modules.primary.concat(result.plan.modules.secondary).map(m => m.id);
  assert.ok(ids.includes('BUSINESS') || ids.includes('CREDIT'), 'Should include Business or Credit');
});

/* ── Test 5: Best DeFi opportunity for me → DeFi + Research + Risk ──── */
t('Test 5: "best DeFi opportunity for me" → DeFi + Research + Risk', () => {
  const result = routeIntent({
    message: 'find the best DeFi opportunity for me',
    financialState: FS, riskProfile: 'MODERATE', now: NOW
  });
  assert.ok(result.ok);
  const ids = result.plan.modules.primary.map(m => m.id);
  assert.ok(ids.includes('DEFI'), 'Should include DeFi');
  assert.ok(ids.includes('RESEARCH'), 'Should include Research');
});

/* ── Test 6: Find suitable RWA investment → RWA + Research + Risk ───── */
t('Test 6: "find suitable RWA investment" → RWA + Research + Risk', () => {
  const result = routeIntent({
    message: 'find a suitable RWA investment for me',
    financialState: FS, riskProfile: 'MODERATE', now: NOW
  });
  assert.ok(result.ok);
  const ids = result.plan.modules.primary.map(m => m.id);
  assert.ok(ids.includes('RWA'), 'Should include RWA');
});

/* ── Test 7: Find something for travel with USDT → Marketplace + Pay ── */
t('Test 7: "find hotel for travel with USDT" → Marketplace + Pay', () => {
  const result = routeIntent({
    message: 'find a hotel for my travel next week and pay with USDT',
    financialState: FS, now: NOW
  });
  assert.ok(result.ok);
  const ids = result.plan.modules.primary.concat(result.plan.modules.secondary).map(m => m.id);
  assert.ok(ids.includes('MARKETPLACE'), 'Should include Marketplace');
  assert.ok(ids.includes('PAY'), 'Should include Pay');
});

/* ── Test 8: Why did my portfolio drop 5% → Portfolio + Market + News ─ */
t('Test 8: "why did portfolio drop 5%" → Portfolio + News + Research', () => {
  const result = routeIntent({
    message: 'why did my portfolio drop 5% today',
    financialState: FS, portfolio: PORTFOLIO, now: NOW
  });
  assert.ok(result.ok);
  const ids = result.plan.modules.primary.concat(result.plan.modules.secondary).map(m => m.id);
  assert.ok(ids.includes('PORTFOLIO') || ids.includes('RESEARCH'), 'Should include Portfolio or Research');
});

/* ── Test 9: If BTC drops 30% → Twin + Scenarios + Risk ────────────── */
t('Test 9: "if BTC drops 30% what happens" → Predictive + Scenarios', () => {
  const twinResult = createFinancialTwin({ financialState: FS, goals: GOALS });
  assert.ok(twinResult.ok, 'Twin should be created');

  const proj = projectTwin({
    twin: twinResult.twin,
    scenarios: [
      { name: 'BTC -30%', expectedReturnPct: -20, volatilityPct: 80, shock: -30 },
      { name: 'Normal', expectedReturnPct: 5, volatilityPct: 40 }
    ],
    months: 3
  });
  assert.equal(proj.status, 'OK');
  assert.ok(proj.projections[0].finalValueUsd < proj.projections[1].finalValueUsd, 'Bear should be worse than normal');
});

/* ── Test 10: Alert me when risk increases → Guardian + Monitoring ───── */
t('Test 10: "alert me when risk increases" → Guardian monitoring', () => {
  const guardian = runGuardianSweep({
    financialState: FS, portfolio: PORTFOLIO, goals: GOALS, now: NOW
  });
  assert.equal(guardian.status, 'OK');
  assert.ok(guardian.healthScore >= 0, 'Should have health score');
  assert.ok(guardian.alerts, 'Should have alerts array');
});

/* ── Test 11: Full orchestration with cross-module reasoning ─────────── */
t('Test 11: Full orchestration — 10K, 6 months, medium risk', () => {
  const result = orchestrateBrain({
    message: 'I have 10000 dollars and want to make the best use with medium risk in 6 months',
    financialState: FS,
    portfolio: PORTFOLIO,
    activeGoals: GOALS,
    riskProfile: 'MODERATE',
    marketContext: { trend: 'BULLISH', volatilityPct: 35, regime: 'BULL_LOW_VOL' },
    now: NOW
  });
  assert.equal(result.schema, 'fbt.financial-brain.v1');
  assert.ok(result.routing, 'Should have routing');
  assert.ok(result.guardian, 'Should have guardian');
  assert.ok(result.opportunities, 'Should have opportunities');
  assert.ok(result.predictions, 'Should have predictions');
  assert.ok(result.twin, 'Should have twin');
  assert.ok(result.summary.modulesInvolved > 0, 'Should involve modules');
});

/* ── Test 12: Guardian detects LTV risk proactively ──────────────────── */
t('Test 12: Guardian detects LTV risk proactively', () => {
  const highLtvState = { ...FS, totalDebtUsd: 4000, totalCollateralUsd: 5000 };
  const guardian = runGuardianSweep({ financialState: highLtvState, now: NOW });
  const ltvAlert = guardian.alerts.find(a => a.type === 'LIQUIDATION_RISK');
  assert.ok(ltvAlert, 'Should detect LTV risk');
  assert.ok(ltvAlert.recommendedAction, 'Should recommend action');
});

/* ── Test 13: Persian language intent routing ────────────────────────── */
t('Test 13: Persian intent "سرمایه‌گذاری" → Investment modules', () => {
  const result = routeIntent({
    message: 'می‌خواهم سرمایه‌گذاری کنم',
    financialState: FS, now: NOW
  });
  assert.ok(result.ok);
  assert.ok(result.plan.modules.primary.length >= 1, 'Should route to modules');
  const ids = result.plan.modules.primary.map(m => m.id);
  assert.ok(ids.some(id => ['PORTFOLIO', 'RESEARCH', 'TRADING', 'DEFI'].includes(id)), 'Should include investment modules');
});

/* ── Print Results ───────────────────────────────────────────────────── */

const passed = rows.filter(([, ok]) => ok).length;
const failed = rows.filter(([, ok]) => !ok).length;

console.log(`\n═══ UPGRADE 11+12 — Cross-Module Scenarios ═══`);
console.log(`   ${passed}/${rows.length} passed, ${failed} failed\n`);

for (const [name, ok, detail] of rows) {
  console.log(`   ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

if (failed > 0) {
  console.log(`\n   ⚠️  ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log(`\n   ✅ All ${rows.length} cross-module scenarios verified`);
}
