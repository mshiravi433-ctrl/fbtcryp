// Pure-math tests for src/lib/loopMath.js — no network, no wallet, no chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLoopInput, healthFactor, liquidationDropPct, maxBorrowUsd, simulateLoop, LOOP_DEFAULTS
} from '../src/lib/loopMath.js';

const base = { collateralUsd: 1000, debtUsd: 0, ltv: 0.8, liquidationThreshold: 0.85, supplyApy: 0.03, borrowApy: 0.05 };

test('validate: rejects bad inputs without throwing', () => {
  assert.equal(validateLoopInput({}).ok, false);
  assert.ok(validateLoopInput({ ...base, collateralUsd: -1 }).errors.includes('COLLATERAL_INVALID'));
  assert.ok(validateLoopInput({ ...base, ltv: 0.9, liquidationThreshold: 0.85 }).errors.includes('LTV_ABOVE_LT'));
  assert.ok(validateLoopInput({ ...base, ltv: 1 }).errors.includes('LTV_INVALID'));
  assert.ok(validateLoopInput({ ...base, supplyApy: NaN }).errors.includes('SUPPLY_APY_INVALID'));
  assert.equal(validateLoopInput(base).ok, true);
});

test('validate: already over LTV is an error', () => {
  const r = validateLoopInput({ ...base, debtUsd: 900 });
  assert.ok(r.errors.includes('ALREADY_OVER_LTV'));
});

test('healthFactor: infinite without debt, C×LT/D otherwise', () => {
  assert.equal(healthFactor({ collateralUsd: 1000, debtUsd: 0, liquidationThreshold: 0.85 }), Infinity);
  assert.equal(healthFactor({ collateralUsd: 1000, debtUsd: 500, liquidationThreshold: 0.85 }), 1.7);
});

test('liquidationDropPct: matches HF = 1 boundary', () => {
  const drop = liquidationDropPct({ collateralUsd: 1000, debtUsd: 500, liquidationThreshold: 0.85 });
  // price fall x such that 1000(1-x)·0.85 = 500  ->  x = 1 − 500/850
  assert.ok(Math.abs(drop - (1 - 500 / 850)) < 1e-12);
  assert.equal(liquidationDropPct({ collateralUsd: 1000, debtUsd: 0, liquidationThreshold: 0.85 }), null);
});

test('maxBorrowUsd: never negative', () => {
  assert.equal(maxBorrowUsd({ collateralUsd: 1000, debtUsd: 0, ltv: 0.8 }), 800);
  assert.equal(maxBorrowUsd({ collateralUsd: 1000, debtUsd: 900, ltv: 0.8 }), 0);
});

test('simulateLoop: loop rounds grow collateral and debt, HF stays above minimum', () => {
  const r = simulateLoop(base);
  assert.equal(r.ok, true);
  assert.ok(r.rounds.length > 0);
  for (let i = 1; i < r.rounds.length; i += 1) {
    assert.ok(r.rounds[i].collateralUsd > r.rounds[i - 1].collateralUsd);
    assert.ok(r.rounds[i].debtUsd > r.rounds[i - 1].debtUsd);
  }
  for (const row of r.rounds) assert.ok(row.healthFactor >= LOOP_DEFAULTS.minHealthFactor);
  assert.ok(r.final.leverage > 1);
});

test('simulateLoop: is pure — input object is not mutated', () => {
  const input = { ...base };
  const snapshot = JSON.stringify(input);
  simulateLoop(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('simulateLoop: with no room, reports NO_LOOP_POSSIBLE and no rounds', () => {
  const r = simulateLoop({ ...base, collateralUsd: 5 });
  assert.equal(r.rounds.length, 0);
  assert.ok(r.warnings.includes('NO_LOOP_POSSIBLE'));
});

test('simulateLoop: negative carry is flagged when borrow costs more than supply', () => {
  const r = simulateLoop({ ...base, supplyApy: 0.02, borrowApy: 0.12 });
  assert.ok(r.final.netApyOnEquity < 0);
  assert.ok(r.warnings.includes('NEGATIVE_NET_CARRY'));
});

test('simulateLoop: gas per round is subtracted from equity', () => {
  const free = simulateLoop(base);
  const paid = simulateLoop({ ...base, gasUsdPerRound: 5 });
  assert.ok(paid.final.equityUsd < free.final.equityUsd);
});

test('simulateLoop: swap cost reduces collateral added per round', () => {
  const cheap = simulateLoop({ ...base, swapCostRate: 0 });
  const dear = simulateLoop({ ...base, swapCostRate: 0.05 });
  assert.ok(dear.final.collateralUsd < cheap.final.collateralUsd);
});

test('simulateLoop: liquidation-near warning appears for aggressive loops', () => {
  const r = simulateLoop({ ...base, maxRounds: 10, headroom: 0 });
  assert.ok(r.final.liquidationDropPct !== null);
  if (r.final.liquidationDropPct * 100 < LOOP_DEFAULTS.liquidationWarnDropPct) {
    assert.ok(r.warnings.includes('LIQUIDATION_NEAR'));
  }
});

test('simulateLoop: invalid input returns errors and empty result', () => {
  const r = simulateLoop({ collateralUsd: 0 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.rounds, []);
});
