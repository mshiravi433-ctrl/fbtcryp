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
