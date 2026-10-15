import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoopExecutionController, LOOP_RUN_STATE } from '../src/lib/loopExecution.js';

const clean = { ok: true, provenSafe: true, status: 'simulated-clean', steps: [{ status: 'simulated-clean' }] };
const step = { id: 'supply', asset: { symbol: 'USDC' }, amountWei: '100' };

const readyController = (overrides = {}) => createLoopExecutionController({
  steps: [step],
  simulatePlan: async () => clean,
  simulateStep: async () => clean,
  readRisk: async () => ({ ok: true, healthFactor: null, debtUsd: 0 }),
  executeStep: async () => ({ ok: true, hash: '0xstep' }),
  ...overrides
});

test('no signature or transaction function runs at construction or during simulation', async () => {
  let sends = 0;
  const controller = readyController({ executeStep: async () => { sends += 1; return { ok: true }; } });
  assert.equal(sends, 0);
  const result = await controller.simulate();
  assert.equal(result.ok, true);
  assert.equal(sends, 0);
  assert.equal((await controller.advance()).code, 'USER_CLICK_REQUIRED');
  assert.equal(sends, 0);
});

test('failed full-plan simulation blocks all step execution', async () => {
  let sends = 0;
  const controller = readyController({
    simulatePlan: async () => ({ ok: false, provenSafe: false, status: 'revert-detected', revertReason: 'mock revert' }),
    executeStep: async () => { sends += 1; return { ok: true }; }
  });
  const result = await controller.simulate();
  assert.equal(result.ok, false);
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.PAUSED);
  assert.equal((await controller.advance({ userClicked: true })).ok, false);
  assert.equal(sends, 0);
});

test('fresh health factor below the floor stops before the wallet step', async () => {
  let sends = 0;
  const controller = readyController({
    readRisk: async () => ({ ok: true, healthFactor: 1.04, debtUsd: 10 }),
    executeStep: async () => { sends += 1; return { ok: true }; }
  });
  await controller.simulate();
  const result = await controller.advance({ userClicked: true });
  assert.equal(result.code, 'HEALTH_FACTOR_BELOW_FLOOR');
  assert.equal(sends, 0);
});

test('unknown debt and health factor fail closed before any wallet step', async () => {
  let sends = 0;
  const controller = readyController({
    readRisk: async () => ({ ok: true, healthFactor: null, debtUsd: null }),
    executeStep: async () => { sends += 1; return { ok: true }; }
  });
  await controller.simulate();
  const result = await controller.advance({ userClicked: true });
  assert.equal(result.code, 'HEALTH_FACTOR_UNAVAILABLE');
  assert.equal(sends, 0);
});

test('cancellation after a completed step records partial state and suggests unwind', async () => {
  const controller = createLoopExecutionController({
    steps: [step, { id: 'borrow', asset: { symbol: 'USDT' }, amountWei: '50' }],
    simulatePlan: async () => clean,
    simulateStep: async () => clean,
    readRisk: async () => ({ ok: true, healthFactor: null, debtUsd: 0 }),
    executeStep: async () => ({ ok: true, hash: '0xconfirmed' })
  });
  await controller.simulate();
  await controller.advance({ userClicked: true });
  const result = controller.cancel();
  assert.equal(result.status, LOOP_RUN_STATE.PARTIAL);
  assert.equal(result.unwindSuggested, true);
  assert.equal(result.completed[0].hash, '0xconfirmed');
  assert.equal((await controller.advance({ userClicked: true })).code, 'LOOP_STOPPED');
});

test('swap step gets a fresh quote, simulates the remaining sequence, and only executes after review click', async () => {
  const calls = { quote: 0, simulateRemaining: 0, send: 0 };
  const controller = createLoopExecutionController({
    steps: [{ id: 'swap', fromSymbol: 'USDT', toSymbol: 'USDC' }],
    simulatePlan: async () => clean,
    simulateStep: async (current, quote) => ({ ...clean, quote }),
    readRisk: async () => ({ ok: true, healthFactor: 1.5, debtUsd: 100 }),
    getFreshQuote: async () => { calls.quote += 1; return { ok: true, quote: { route: 'fresh', minOut: '99.4' }, quotedAt: Date.now() }; },
    simulateRemaining: async (remaining) => { calls.simulateRemaining += 1; assert.equal(remaining[0].id, 'swap'); return clean; },
    executeStep: async (current, quote) => { calls.send += 1; return { ok: quote?.route === 'fresh', hash: '0xswap' }; }
  });
  await controller.simulate();
  const review = await controller.advance({ userClicked: true });
  assert.equal(review.code, 'QUOTE_REVIEW_REQUIRED');
  assert.equal(calls.quote, 1);
  assert.equal(calls.simulateRemaining, 1);
  assert.equal(calls.send, 0);
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.QUOTE_REVIEW);
  const signed = await controller.advance({ userClicked: true });
  assert.equal(signed.ok, true);
  assert.equal(calls.send, 1);
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.COMPLETED);
});

test('missing remaining-plan simulation blocks a fresh swap quote', async () => {
  let sends = 0;
  const controller = readyController({
    steps: [{ id: 'swap', fromSymbol: 'USDT', toSymbol: 'USDC' }],
    getFreshQuote: async () => ({ ok: true, quote: { route: 'fresh' }, quotedAt: Date.now() }),
    executeStep: async () => { sends += 1; return { ok: true }; }
  });
  await controller.simulate();
  const result = await controller.advance({ userClicked: true });
  assert.equal(result.code, 'REMAINING_PLAN_SIMULATOR_UNAVAILABLE');
  assert.equal(sends, 0);
});

test('a stop request during a wallet step does not automatically advance the plan', async () => {
  let resolveStep;
  const controller = createLoopExecutionController({
    steps: [step, { id: 'borrow', amountWei: '50' }],
    simulatePlan: async () => clean,
    simulateStep: async () => clean,
    readRisk: async () => ({ ok: true, healthFactor: null, debtUsd: 0 }),
    executeStep: () => new Promise((resolve) => { resolveStep = resolve; })
  });
  await controller.simulate();
  const advancing = controller.advance({ userClicked: true });
  while (!resolveStep) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.cancel().status, LOOP_RUN_STATE.RUNNING);
  resolveStep({ ok: true, hash: '0xsettled' });
  const result = await advancing;
  assert.equal(result.state.status, LOOP_RUN_STATE.PARTIAL);
  assert.equal(result.state.unwindSuggested, true);
  assert.equal(result.state.stepIndex, 1);
});

/* ── 2026-10-15: the controller drives real steps ────────────────────────── */

test('a second click while a step is being checked is refused — one step at a time', async () => {
  let sends = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const controller = readyController({
    readRisk: async () => { await gate; return { ok: true, healthFactor: null, debtUsd: 0 }; },
    executeStep: async () => { sends += 1; return { ok: true, hash: '0xstep' }; }
  });
  await controller.simulate();
  const first = controller.advance({ userClicked: true });
  const second = await controller.advance({ userClicked: true });
  assert.equal(second.code, 'STEP_IN_FLIGHT');
  assert.equal(controller.snapshot().busy, true);
  release();
  assert.equal((await first).ok, true);
  assert.equal(sends, 1);
  assert.equal(controller.snapshot().busy, false);
});

test('a stop pressed during the checks prevents the wallet prompt entirely', async () => {
  let sends = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const controller = readyController({
    simulateStep: async () => { await gate; return clean; },
    executeStep: async () => { sends += 1; return { ok: true, hash: '0xstep' }; }
  });
  await controller.simulate();
  const pending = controller.advance({ userClicked: true });
  controller.cancel();
  release();
  const result = await pending;
  assert.equal(result.code, 'LOOP_STOPPED');
  assert.equal(sends, 0);
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.CANCELLED);
});

test('prepareStep resolves the amount; finish:true completes the run early without signing', async () => {
  let sends = 0;
  const steps = [
    { key: 'borrow-1', id: 'borrow', asset: { symbol: 'USDT' } },
    { key: 'supply-1', id: 'supply', asset: { symbol: 'USDC' } }
  ];
  const controller = readyController({
    steps,
    prepareStep: async (s) => (s.key === 'borrow-1' ? { ok: true, finish: true, code: 'NO_MORE_CAPACITY' } : { ok: true, amountWei: '5' }),
    executeStep: async () => { sends += 1; return { ok: true, hash: '0xstep' }; }
  });
  await controller.simulate();
  const result = await controller.advance({ userClicked: true });
  assert.equal(result.ok, true);
  assert.equal(result.endedEarly, 'NO_MORE_CAPACITY');
  const snap = controller.snapshot();
  assert.equal(snap.status, LOOP_RUN_STATE.COMPLETED);
  assert.deepEqual(snap.steps.map((s) => s.runState), ['skipped', 'skipped']);
  assert.equal(sends, 0);
});

test('a prepared amount is recorded on the step and on the completed entry', async () => {
  const controller = readyController({
    steps: [{ key: 'borrow-1', id: 'borrow', asset: { symbol: 'USDT' } }],
    prepareStep: async () => ({ ok: true, amountWei: '777', projectedHealthFactor: 1.6 }),
    readRisk: async () => ({ ok: true, healthFactor: 1.6, debtUsd: 10, minHealthFactor: 1.35 }),
    executeStep: async () => ({ ok: true, hash: '0xabc' })
  });
  await controller.simulate();
  await controller.advance({ userClicked: true });
  const snap = controller.snapshot();
  assert.equal(snap.completed[0].amountWei, '777');
  assert.equal(snap.steps[0].prepared.amountWei, '777');
  assert.equal(snap.steps[0].hash, '0xabc');
  assert.equal(snap.steps[0].runState, 'done');
});

test('a per-step floor from the risk reader overrides the default floor', async () => {
  let sends = 0;
  const controller = readyController({
    readRisk: async () => ({ ok: true, healthFactor: 1.3, debtUsd: 10, minHealthFactor: 1.35 }),
    executeStep: async () => { sends += 1; return { ok: true }; }
  });
  await controller.simulate();
  const result = await controller.advance({ userClicked: true });
  assert.equal(result.code, 'HEALTH_FACTOR_BELOW_FLOOR');
  assert.equal(result.detail.minimum, 1.35);
  assert.equal(sends, 0);
});

test('a supply marked floorExempt is not blocked by an unreadable health factor', async () => {
  let sends = 0;
  const controller = readyController({
    readRisk: async () => ({ ok: true, floorExempt: true, healthFactor: null, debtUsd: null }),
    executeStep: async () => { sends += 1; return { ok: true, hash: '0x1' }; }
  });
  await controller.simulate();
  assert.equal((await controller.advance({ userClicked: true })).ok, true);
  assert.equal(sends, 1);
});

test('resume re-checks the remaining steps after a failure and refuses while completed', async () => {
  let fail = true;
  let preflights = 0;
  const controller = readyController({
    steps: [step, { ...step, key: 'b' }],
    simulatePlan: async (remaining) => { preflights += 1; return { ...clean, remaining: remaining.length }; },
    executeStep: async () => (fail ? { ok: false, code: 'USER_REJECTED' } : { ok: true, hash: '0x2' })
  });
  await controller.simulate();
  assert.equal((await controller.advance({ userClicked: true })).code, 'USER_REJECTED');
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.FAILED);
  fail = false;
  const resumed = await controller.resume();
  assert.equal(resumed.ok, true);
  assert.equal(resumed.simulation.remaining, 2);
  assert.equal(preflights, 2);
  await controller.advance({ userClicked: true });
  await controller.advance({ userClicked: true });
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.COMPLETED);
  assert.equal((await controller.resume()).code, 'LOOP_NOT_RESUMABLE');
});

test('a stop pressed during the preflight is not overwritten when the checks finish', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const controller = readyController({ simulatePlan: async () => { await gate; return clean; } });
  const pending = controller.simulate();
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.SIMULATING);
  controller.cancel();
  release();
  const result = await pending;
  assert.equal(result.code, 'LOOP_STOPPED');
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.CANCELLED);
  assert.equal((await controller.advance({ userClicked: true })).code, 'LOOP_STOPPED');
});
