import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveLoopPlan } from '../src/lib/loopPlan.js';
import { createLoopRuntime, isLoopUserRejection, loopErrorCode } from '../src/lib/loopRuntime.js';
import { createLoopExecutionController, LOOP_RUN_STATE, LOOP_STEP_STATE } from '../src/lib/loopExecution.js';

import { createChain, USDC, USDT, WALLET, UNIT, reserves, prices } from './loop-mock-chain.mjs';

function makePlan(chain, over = {}) {
  return buildLiveLoopPlan({
    assets: [USDT, USDC],
    reserves,
    prices,
    positions: { [USDC.id]: { ok: true, walletWei: chain.state.wallet.USDC.toString(), suppliedWei: '0', debtWei: '0' } },
    account: chain.account(),
    collateralId: USDC.id,
    borrowId: USDT.id,
    amount: '100',
    settings: { rounds: '2', headroomPct: '10', minHealthFactor: '1.35', slippagePct: '0.5' },
    ...over
  });
}

function startRun(chain, plan, { now = () => Date.now() } = {}) {
  const runtime = createLoopRuntime({ deps: chain.deps, chainId: 42161, wallet: WALLET, plan, now });
  const controller = createLoopExecutionController({
    steps: plan.steps,
    simulatePlan: runtime.simulatePlan,
    prepareStep: runtime.prepareStep,
    simulateStep: runtime.simulateStep,
    readRisk: runtime.readRisk,
    getFreshQuote: runtime.getFreshQuote,
    simulateRemaining: runtime.simulateRemaining,
    executeStep: runtime.executeStep,
    minHealthFactor: 1.05,
    quoteMaxAgeMs: 15_000,
    now
  });
  return { runtime, controller };
}

/** Click through every step the way the UI does, confirming each quote. */
async function clickThrough(controller, maxClicks = 30) {
  let last = null;
  for (let i = 0; i < maxClicks; i += 1) {
    const status = controller.snapshot().status;
    if (![LOOP_RUN_STATE.READY, LOOP_RUN_STATE.QUOTE_REVIEW].includes(status)) break;
    last = await controller.advance({ userClicked: true });
  }
  return last;
}

test('a full two-round USDC/USDT loop runs every step with real amounts and lands above the HF floor', async () => {
  const chain = createChain();
  const plan = makePlan(chain);
  assert.equal(plan.ok, true, plan.errors.join(','));
  const { controller, runtime } = startRun(chain, plan);

  const preflight = await controller.simulate();
  assert.equal(preflight.ok, true, JSON.stringify(preflight.state?.error));
  assert.ok(preflight.simulation.checks.includes('swap-route'));
  assert.ok(preflight.simulation.checks.includes('simulated:approve'));
  /* Preflight never signs. */
  assert.equal(chain.state.calls.some((c) => c.startsWith('tx:')), false);

  await clickThrough(controller);
  const final = controller.snapshot();
  assert.equal(final.status, LOOP_RUN_STATE.COMPLETED, JSON.stringify(final.error));
  assert.equal(final.completed.length, plan.steps.length);
  assert.ok(final.steps.every((s) => s.runState === LOOP_STEP_STATE.DONE));
  assert.ok(final.completed.every((s) => /^0x[0-9a-f]{64}$/.test(s.hash)));

  const account = chain.account();
  assert.ok(account.healthFactor >= 1.35 - 1e-6, `HF ${account.healthFactor}`);
  assert.ok(account.totalCollateralUsd > 100);
  assert.ok(account.totalDebtUsd > 0);

  /* Each supply after a swap deposits what the swap really delivered. */
  const resolved = runtime.resolved();
  assert.equal(resolved['supply-1'].amountWei, resolved['swap-1'].receivedWei);
  assert.equal(resolved['swap-1'].amountWei, resolved['borrow-1'].amountWei);
  /* The exact approval, never unlimited. */
  assert.ok(chain.state.calls.includes('tx:approve:USDC:100000000'));
});

test('a swap leg waits for the user to review a fresh quote before the swap is signed', async () => {
  const chain = createChain();
  const { controller } = startRun(chain, makePlan(chain));
  await controller.simulate();
  await controller.advance({ userClicked: true }); // supply-0
  await controller.advance({ userClicked: true }); // borrow-1
  const review = await controller.advance({ userClicked: true }); // swap-1 → review
  assert.equal(review.code, 'QUOTE_REVIEW_REQUIRED');
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.QUOTE_REVIEW);
  assert.equal(chain.state.calls.some((c) => c.startsWith('tx:swap:')), false);
  assert.ok(controller.snapshot().currentQuote.metadata.minOutWei);
  const swapped = await controller.advance({ userClicked: true });
  assert.equal(swapped.ok, true);
  assert.ok(chain.state.calls.some((c) => c.startsWith('tx:swap:')));
});

test('no swap route is discovered BEFORE the first transaction, not after a borrow', async () => {
  const chain = createChain();
  chain.deps.getQuote = async () => ({ error: 'NO_ROUTE', retriable: false });
  const { controller } = startRun(chain, makePlan(chain));
  const result = await controller.simulate();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_SWAP_ROUTE');
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.PAUSED);
  assert.equal(chain.state.calls.some((c) => c.startsWith('tx:')), false);
});

test('an empty gas balance and a wrong signer stop the run before any wallet prompt', async () => {
  const broke = createChain({ native: 0n });
  const a = startRun(broke, makePlan(broke));
  assert.equal((await a.controller.simulate()).code, 'INSUFFICIENT_GAS');

  const moved = createChain();
  const b = startRun(moved, makePlan(moved));
  await b.controller.simulate();
  moved.deps.assertSigner = async () => ({ ok: false, code: 'WRONG_NETWORK' });
  const step = await b.controller.advance({ userClicked: true });
  assert.equal(step.ok, false);
  assert.equal(step.code, 'WRONG_NETWORK');
  assert.equal(moved.state.calls.some((c) => c.startsWith('tx:')), false);
});

test('a rejected signature fails the step; resume re-checks and continues without repeating confirmed steps', async () => {
  const chain = createChain();
  const { controller } = startRun(chain, makePlan(chain));
  await controller.simulate();
  await controller.advance({ userClicked: true }); // supply-0 confirmed
  const realExecute = chain.deps.executeLending;
  chain.deps.executeLending = async () => ({ ok: false, code: 'USER_REJECTED' });
  const rejected = await controller.advance({ userClicked: true }); // borrow-1 rejected
  assert.equal(rejected.code, 'USER_REJECTED');
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.PARTIAL);
  assert.equal(controller.snapshot().steps[1].runState, LOOP_STEP_STATE.FAILED);

  chain.deps.executeLending = realExecute;
  const resumed = await controller.resume();
  assert.equal(resumed.ok, true, JSON.stringify(resumed.state?.error));
  assert.equal(controller.snapshot().stepIndex, 1);
  await clickThrough(controller);
  const final = controller.snapshot();
  assert.equal(final.status, LOOP_RUN_STATE.COMPLETED, JSON.stringify(final.error));
  assert.equal(chain.state.calls.filter((c) => c === 'tx:supply:USDC:100000000').length, 1);
});

test('a swap whose receipt reverts is a failure, and the following supply never runs', async () => {
  const chain = createChain();
  chain.deps.executeSwap = async ({ quote }) => ({ hash: `0x${'ab'.repeat(32)}`, wait: async () => ({ status: 0, amountInWei: quote.amountInWei }) });
  const { controller } = startRun(chain, makePlan(chain));
  await controller.simulate();
  await clickThrough(controller);
  const snap = controller.snapshot();
  assert.equal(snap.status, LOOP_RUN_STATE.PARTIAL);
  assert.equal(snap.error.code, 'TRANSACTION_REVERTED');
  assert.equal(snap.error.detail.hash, `0x${'ab'.repeat(32)}`);
  assert.equal(snap.steps[2].runState, LOOP_STEP_STATE.FAILED);
  assert.equal(chain.state.calls.filter((c) => c.startsWith('tx:supply')).length, 1);
});

test('a quote that does not price the exact borrowed amount is refused', async () => {
  const chain = createChain();
  const realQuote = chain.deps.getQuote;
  const { controller } = startRun(chain, makePlan(chain));
  await controller.simulate();
  await controller.advance({ userClicked: true });
  await controller.advance({ userClicked: true });
  chain.deps.getQuote = async (args) => ({ ...(await realQuote(args)), amountInWei: 1n });
  const refused = await controller.advance({ userClicked: true });
  assert.equal(refused.code, 'QUOTE_AMOUNT_MISMATCH');
  assert.equal(chain.state.calls.some((c) => c.startsWith('tx:swap')), false);
});

test('a swap route losing too much against the oracle is refused before review', async () => {
  const chain = createChain({ swapOutBps: 9000n });
  const { controller } = startRun(chain, makePlan(chain));
  const result = await controller.simulate();
  assert.equal(result.code, 'SWAP_LOSS_TOO_HIGH');
});

test('when capacity runs out mid-run the loop completes early instead of signing dust', async () => {
  const chain = createChain();
  const plan = makePlan(chain);
  const { controller } = startRun(chain, plan);
  await controller.simulate();
  for (let i = 0; i < 4; i += 1) await clickThrough(controller, 1); // supply-0, borrow-1, swap review, swap
  /* Before round 2 borrows, someone else's debt eats the account's room. */
  chain.state.debt += 40n * UNIT;
  await clickThrough(controller);
  const snap = controller.snapshot();
  assert.equal(snap.status, LOOP_RUN_STATE.COMPLETED, JSON.stringify(snap.error));
  assert.equal(snap.endedEarly?.code, 'NO_MORE_CAPACITY');
  assert.ok(snap.steps.some((s) => s.runState === LOOP_STEP_STATE.SKIPPED));
});

test('a same-asset loop needs no swap and no quote', async () => {
  const chain = createChain();
  const plan = makePlan(chain, { borrowId: USDC.id });
  const { controller } = startRun(chain, plan);
  const pre = await controller.simulate();
  assert.equal(pre.ok, true);
  await clickThrough(controller);
  assert.equal(controller.snapshot().status, LOOP_RUN_STATE.COMPLETED);
  assert.equal(chain.state.calls.some((c) => c.startsWith('quote:')), false);
});

test('error helpers classify wallet rejections and keep stable codes', () => {
  assert.equal(isLoopUserRejection({ code: 4001 }), true);
  assert.equal(isLoopUserRejection({ code: 'ACTION_REJECTED' }), true);
  assert.equal(isLoopUserRejection(new Error('User denied transaction signature')), true);
  assert.equal(loopErrorCode(new Error('FEE_NOT_APPLIED')), 'FEE_NOT_APPLIED');
  assert.equal(loopErrorCode(new Error('insufficient funds for gas * price + value')), 'INSUFFICIENT_GAS');
  assert.equal(loopErrorCode(new Error('weird')), 'STEP_FAILED');
});

test('a read node that lags behind the wallet does not break or mis-size the run', async () => {
  const chain = createChain();
  /* After every write, the next two reads answer from the state BEFORE it. */
  let stale = null;
  let staleBudget = 0;
  const snapshot = () => JSON.parse(JSON.stringify(chain.state, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)), (k, v) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
  const view = () => (staleBudget > 0 ? (staleBudget -= 1, stale) : chain.state);
  const real = { ...chain.deps };
  const markWrite = () => { stale = snapshot(); staleBudget = 2; };
  const usd = (wei) => Number(wei) / 1e6;
  chain.deps.readTokenBalance = async ({ asset }) => view().wallet[asset.symbol];
  chain.deps.readPoolAllowance = async ({ asset }) => view().poolAllowance[asset.symbol];
  chain.deps.readAccount = async () => {
    const s = view();
    const coll = usd(s.supplied); const debt = usd(s.debt);
    return { ok: true, totalCollateralUsd: coll, totalDebtUsd: debt, availableBorrowsUsd: Math.max(0, coll * 0.75 - debt), liquidationThresholdPct: 78, ltvPct: 75, healthFactor: debt > 0 ? (coll * 0.78) / debt : null };
  };
  chain.deps.executeLending = async (args) => { markWrite(); return real.executeLending(args); };
  chain.deps.executeSwap = async (args) => {
    const tx = await real.executeSwap(args);
    return { ...tx, wait: async () => { markWrite(); return tx.wait(); } };
  };

  const plan = makePlan(chain);
  let clock = 0;
  const runtime = createLoopRuntime({ deps: chain.deps, chainId: 42161, wallet: WALLET, plan, now: () => clock, sleep: async (ms) => { clock += ms; } });
  const controller = createLoopExecutionController({
    steps: plan.steps,
    simulatePlan: runtime.simulatePlan,
    prepareStep: runtime.prepareStep,
    simulateStep: runtime.simulateStep,
    readRisk: runtime.readRisk,
    getFreshQuote: runtime.getFreshQuote,
    simulateRemaining: runtime.simulateRemaining,
    executeStep: runtime.executeStep,
    quoteMaxAgeMs: 15_000,
    now: () => clock
  });
  assert.equal((await controller.simulate()).ok, true);
  await clickThrough(controller);
  const snap = controller.snapshot();
  assert.equal(snap.status, LOOP_RUN_STATE.COMPLETED, JSON.stringify(snap.error));
  const resolved = runtime.resolved();
  /* Sized from the real outputs, not from a stale zero. */
  assert.equal(resolved['swap-1'].amountWei, resolved['borrow-1'].amountWei);
  assert.equal(resolved['supply-1'].amountWei, resolved['swap-1'].receivedWei);
  assert.equal(resolved['supply-2'].amountWei, resolved['swap-2'].receivedWei);
  /* Round 2 borrowed against the collateral round 1 added (not a stale account). */
  assert.ok(Number(resolved['borrow-2'].amountWei) > 30_000_000, resolved['borrow-2'].amountWei);
  assert.ok(chain.account().healthFactor >= 1.35 - 1e-6);
});
