import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOP_DEFAULTS,
  LOOP_MAX_ROUNDS,
  healthFactor,
  liquidationDropPct,
  maxBorrowUsd,
  simulateLoop,
  validateLoopInput
} from '../src/lib/loopMath.js';

const validInput = (overrides = {}) => ({ ...LOOP_DEFAULTS, ...overrides });

test('defaults form a valid editable calculator input', () => {
  assert.equal(validateLoopInput(LOOP_DEFAULTS).valid, true);
});

test('invalid or missing collateral amount is named and never throws', () => {
  const result = simulateLoop(validInput({ collateralUsd: 'not-a-number' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.field === 'collateralUsd'));
});

test('LTV above liquidation threshold is rejected', () => {
  const result = validateLoopInput(validInput({ ltvPct: 86, liquidationThresholdPct: 85 }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'LTV_EXCEEDS_LIQUIDATION_THRESHOLD'));
});

test('rates and costs must be finite and non-negative', () => {
  const result = validateLoopInput(validInput({ borrowApyPct: -1, gasUsdPerRound: Infinity }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.field === 'borrowApyPct'));
  assert.ok(result.errors.some((error) => error.field === 'gasUsdPerRound'));
});

test('round count is a bounded integer', () => {
  assert.equal(validateLoopInput(validInput({ rounds: 1.5 })).valid, false);
  assert.equal(validateLoopInput(validInput({ rounds: LOOP_MAX_ROUNDS + 1 })).valid, false);
});

test('health factor is the threshold-adjusted collateral divided by debt', () => {
  assert.equal(healthFactor({ collateralUsd: 1000, debtUsd: 400, liquidationThresholdPct: 80 }), 2);
  assert.equal(healthFactor({ collateralUsd: 1000, debtUsd: 0, liquidationThresholdPct: 80 }), null);
});

test('liquidation price drop reports distance to HF 1.00', () => {
  assert.equal(liquidationDropPct(2), 50);
  assert.equal(liquidationDropPct(1), 0);
  assert.equal(liquidationDropPct(null), null);
});

test('max borrow includes an explicit headroom margin', () => {
  assert.equal(maxBorrowUsd({ collateralUsd: 1000, debtUsd: 100, ltvPct: 80, headroomPct: 10 }), 620);
  assert.equal(maxBorrowUsd({ collateralUsd: 1000, debtUsd: 900, ltvPct: 80, headroomPct: 10 }), 0);
});

test('loop projection returns per-round borrow, collateral, debt, and HF', () => {
  const result = simulateLoop(validInput({ rounds: 2, gasUsdPerRound: 0, swapCostPct: 0 }));
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2);
  for (const row of result.rows) {
    assert.ok(row.borrowUsd > 0);
    assert.ok(row.collateralUsd > 0);
    assert.ok(row.debtUsd > 0);
    assert.ok(row.healthFactor > 1);
  }
});

test('same-asset loop does not invent a swap fee', () => {
  const result = simulateLoop(validInput({ collateralAsset: 'USDC', borrowAsset: 'USDC', swapCostPct: 25, rounds: 1, gasUsdPerRound: 0 }));
  assert.equal(result.rows[0].swapCostUsd, 0);
  assert.equal(result.totalSwapCostUsd, 0);
});

test('negative first-year net carry emits an explicit warning', () => {
  const result = simulateLoop(validInput({ supplyApyPct: 0, borrowApyPct: 20, rounds: 2, gasUsdPerRound: 0 }));
  assert.ok(result.warnings.includes('NEGATIVE_NET_CARRY'));
  assert.ok(result.firstYearNetRatePct < 0);
});

test('near-liquidation scenario emits a warning and has a small price-drop distance', () => {
  const result = simulateLoop(validInput({ ltvPct: 80, liquidationThresholdPct: 81, headroomPct: 0, rounds: 1, swapCostPct: 0, gasUsdPerRound: 0 }));
  assert.ok(result.warnings.includes('LIQUIDATION_NEAR'));
  assert.ok(result.liquidationDropPct < 15);
});

test('a borrow that would breach the 1.05 floor is stopped', () => {
  const result = simulateLoop(validInput({ ltvPct: 80, liquidationThresholdPct: 80, headroomPct: 0, rounds: 3, swapCostPct: 0, gasUsdPerRound: 0 }));
  assert.ok(result.warnings.includes('STOPPED_BY_HEALTH_FACTOR'));
  assert.equal(result.rows.length, 0);
});

test('an over-LTV starting position cannot create another loop', () => {
  const result = simulateLoop(validInput({ startingCollateralUsd: 100, startingDebtUsd: 200, collateralUsd: 1, rounds: 1 }));
  assert.ok(result.warnings.includes('ALREADY_OVER_LTV'));
  assert.ok(result.warnings.includes('NO_LOOP_POSSIBLE'));
  assert.equal(result.rows.length, 0);
});
