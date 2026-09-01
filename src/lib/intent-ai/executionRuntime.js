/**
 * FBT INTENT OS — client execution runtime.
 * ---------------------------------------------------------------------------
 * Confirm is not `POST /execute` plus hope. This runtime walks the real
 * pipeline, with every step injected so Node probes stay network-free:
 *
 *   validate → quote → wallet → balance → allowance → simulate
 *   → build → sign → broadcast → wait → verify → result
 *
 * Success is impossible without a receipt the chain produced.
 * The server never signs; this module runs next to the wallet.
 */

import {
  createExecutionPlan,
  advanceAction,
  summarizePlan,
  toExecutionResult,
  isSuccessfulReceipt
} from './executionStateMachine.js';
import { adapterForChain } from './chainAdapters.js';
import { planRebalance } from './rebalanceEngine.js';

export const EXECUTION_RUNTIME_SCHEMA = 'fbt.ai-execution-runtime.v1';

function failResult(code, extra = {}) {
  return {
    schema: EXECUTION_RUNTIME_SCHEMA,
    success: false,
    status: code === 'USER_REJECTED' ? 'USER_REJECTED' : 'FAILED',
    txHash: extra.txHash || null,
    chain: extra.chainId || null,
    error: { code, message: extra.message || code },
    plan: extra.plan || null
  };
}

async function step(action, next, extra = {}) {
  const moved = advanceAction(action, next, extra);
  if (!moved.ok) return { ok: false, action, code: moved.code };
  return { ok: true, action: moved.action };
}

/**
 * Run one swap-like action through an injected chain adapter.
 *
 * `hooks` (all optional, all fail-closed when missing):
 *   getBalance(address)
 *   getQuote(action)
 *   checkAllowance(action)
 *   approve(action)
 *   simulate(tx)
 *   buildTransaction(action)
 *   sendTransaction(tx)
 *   waitForConfirmation(txHash)
 *   onProgress({ action, status })
 */
export async function runAction(actionInput, {
  adapter = null,
  hooks = {},
  wallet = null,
  now = Date.now()
} = {}) {
  const plan = createExecutionPlan({ actions: [actionInput], now });
  let action = plan.actions[0];
  const notify = typeof hooks.onProgress === 'function' ? hooks.onProgress : () => {};

  const bump = async (status, extra = {}) => {
    const moved = await step(action, status, extra);
    if (!moved.ok) return moved;
    action = moved.action;
    notify({ action, status });
    return moved;
  };

  if (!wallet?.connected) {
    const moved = await bump('VALIDATION_FAILED', { error: 'WALLET_REQUIRED' });
    return toExecutionResult({ ...plan, actions: [moved.action || action] });
  }
  if (wallet.canSign === false) {
    const moved = await bump('VALIDATION_FAILED', { error: 'WALLET_SIGNATURE_REQUIRED' });
    return toExecutionResult({ ...plan, actions: [moved.action || action] });
  }

  let moved = await bump('VALIDATING');
  if (!moved.ok) return failResult('VALIDATION_FAILED');

  const amount = Number(action.amountUsd ?? action.amount);
  if (action.type !== 'ANALYZE' && amount != null && amount <= 0) {
    moved = await bump('VALIDATION_FAILED', { error: 'AMOUNT_INVALID' });
    return toExecutionResult({ ...plan, actions: [moved.action || action] });
  }

  moved = await bump('QUOTING');
  if (!moved.ok) return failResult('VALIDATION_FAILED');
  if (typeof hooks.getQuote === 'function') {
    try {
      const quote = await hooks.getQuote(action);
      if (!quote || quote.ok === false) {
        moved = await bump('PROVIDER_FAILED', { error: quote?.code || 'NO_QUOTE' });
        return toExecutionResult({ ...plan, actions: [moved.action || action] });
      }
      action = { ...action, quote };
    } catch (err) {
      moved = await bump('NETWORK_FAILED', { error: String(err?.message || 'NETWORK_FAILED').slice(0, 120) });
      return toExecutionResult({ ...plan, actions: [moved.action || action] });
    }
  }

  if (typeof hooks.getBalance === 'function') {
    try {
      const bal = await hooks.getBalance(wallet.address || wallet.evmAddresses?.[0]);
      const have = Number(bal?.valueUsd ?? bal?.amount);
      if (Number.isFinite(have) && Number.isFinite(amount) && have + 1e-9 < amount) {
        moved = await bump('INSUFFICIENT_FUNDS', { error: 'INSUFFICIENT_FUNDS' });
        return toExecutionResult({ ...plan, actions: [moved.action || action] });
      }
    } catch (err) {
      moved = await bump('NETWORK_FAILED', { error: String(err?.message || 'NETWORK_FAILED').slice(0, 120) });
      return toExecutionResult({ ...plan, actions: [moved.action || action] });
    }
  }

  if (typeof hooks.checkAllowance === 'function') {
    try {
      const need = await hooks.checkAllowance(action);
      if (need === true && typeof hooks.approve === 'function') {
        const approved = await hooks.approve(action);
        if (!approved || approved.ok === false) {
          moved = await bump('ALLOWANCE_REQUIRED', { error: 'ALLOWANCE_REQUIRED' });
          return toExecutionResult({ ...plan, actions: [moved.action || action] });
        }
      }
    } catch (err) {
      const msg = String(err?.message || '');
      if (/user\s*(rejected|denied)|4001/i.test(msg)) {
        moved = await bump('USER_REJECTED', { error: 'USER_REJECTED' });
        return toExecutionResult({ ...plan, actions: [moved.action || action] });
      }
      moved = await bump('PROVIDER_FAILED', { error: msg.slice(0, 120) });
      return toExecutionResult({ ...plan, actions: [moved.action || action] });
    }
  }

  moved = await bump('SIMULATING');
  const simFn = hooks.simulate || adapter?.simulate;
  if (typeof simFn === 'function') {
    try {
      const sim = await simFn(action.quote || action);
      if (sim && sim.ok === false) {
        moved = await bump('SIMULATION_FAILED', { error: sim.code || 'SIMULATION_FAILED' });
        return toExecutionResult({ ...plan, actions: [moved.action || action] });
      }
    } catch (err) {
      moved = await bump('SIMULATION_FAILED', { error: String(err?.message || 'SIMULATION_FAILED').slice(0, 120) });
      return toExecutionResult({ ...plan, actions: [moved.action || action] });
    }
  }

  moved = await bump('AWAITING_SIGNATURE');
  const buildFn = hooks.buildTransaction || adapter?.buildTransaction;
  let built = action;
  if (typeof buildFn === 'function') {
    try {
      const tx = await buildFn(action);
      if (!tx || tx.ok === false) {
        moved = await bump('VALIDATION_FAILED', { error: tx?.code || 'BUILD_FAILED' });
        return toExecutionResult({ ...plan, actions: [moved.action || action] });
      }
      built = { ...action, tx: tx.tx || tx };
    } catch (err) {
      moved = await bump('PROVIDER_FAILED', { error: String(err?.message || 'BUILD_FAILED').slice(0, 120) });
      return toExecutionResult({ ...plan, actions: [moved.action || action] });
    }
  }

  const sendFn = hooks.sendTransaction || adapter?.sendTransaction;
  if (typeof sendFn !== 'function') {
    moved = await bump('BROADCAST_FAILED', { error: 'NO_BROADCASTER' });
    return toExecutionResult({ ...plan, actions: [moved.action || action] });
  }

  let txHash = null;
  try {
    const sent = await sendFn(built.tx || built);
    txHash = typeof sent === 'string' ? sent : (sent?.txHash || sent?.hash || sent?.signature || null);
    if (!txHash) {
      moved = await bump('BROADCAST_FAILED', { error: 'NO_TX_HASH' });
      return toExecutionResult({ ...plan, actions: [moved.action || action] });
    }
  } catch (err) {
    const msg = String(err?.message || '');
    const code = Number(err?.code) === 4001 || /user\s*(rejected|denied)/i.test(msg) ? 'USER_REJECTED' : 'BROADCAST_FAILED';
    moved = await bump(code, { error: code });
    return toExecutionResult({ ...plan, actions: [moved.action || action] });
  }

  moved = await bump('SIGNED', { txHash });
  moved = await bump('SUBMITTED', { txHash });
  moved = await bump('CONFIRMING', { txHash });

  const waitFn = hooks.waitForConfirmation || adapter?.waitForConfirmation;
  if (typeof waitFn !== 'function') {
    moved = await bump('CONFIRMATION_FAILED', { txHash, error: 'NO_RECEIPT_SOURCE' });
    return toExecutionResult({ ...plan, actions: [moved.action || action] });
  }
  let receipt = null;
  try {
    const waited = await waitFn(txHash);
    receipt = waited?.receipt || waited;
    if (waited && waited.ok === false) {
      moved = await bump('CONFIRMATION_FAILED', { txHash, receipt, error: waited.code || 'CONFIRMATION_FAILED' });
      return toExecutionResult({ ...plan, actions: [moved.action || action] });
    }
  } catch (err) {
    moved = await bump('CONFIRMATION_FAILED', { txHash, error: String(err?.message || 'CONFIRMATION_FAILED').slice(0, 120) });
    return toExecutionResult({ ...plan, actions: [moved.action || action] });
  }

  if (!isSuccessfulReceipt(receipt) && receipt?.status !== 'CONFIRMED' && receipt?.confirmed !== true) {
    /* Accept adapter-normalized receipts that already declared CONFIRMED. */
    const normalizedOk = receipt && (receipt.status === 'CONFIRMED' || receipt.confirmed === true)
      && (receipt.txHash || receipt.signature || txHash)
      && receipt.reverted !== true
      && receipt.err == null;
    if (!normalizedOk && !isSuccessfulReceipt(receipt)) {
      moved = await bump('CONFIRMATION_FAILED', { txHash, receipt, error: 'NO_RECEIPT' });
      return toExecutionResult({ ...plan, actions: [moved.action || action] });
    }
  }

  moved = await bump('CONFIRMED', { txHash, receipt: receipt?.receipt || receipt });
  return toExecutionResult({ ...plan, actions: [moved.action || action] });
}

/**
 * Walk a multi-action plan (rebalance). Partial success is reported as
 * partial — never as a blanket failure and never as success.
 */
export async function runExecutionPlan({
  actions = [],
  intentId = null,
  adapter = null,
  adapters = null,
  hooks = {},
  wallet = null,
  now = Date.now()
} = {}) {
  const plan = createExecutionPlan({ intentId, actions, now });
  if (!plan.totalActions) {
    return failResult('VALIDATION_FAILED', { message: 'NO_ACTIONS', plan: summarizePlan(plan) });
  }
  const ran = [];
  for (let i = 0; i < plan.actions.length; i += 1) {
    const action = plan.actions[i];
    const chainAdapter = adapters
      ? adapterForChain(action.chainId, adapters)
      : adapter;
    const usable = chainAdapter && chainAdapter.ok === true ? chainAdapter : adapter;
    const result = await runAction(action, {
      adapter: usable,
      hooks: {
        ...hooks,
        onProgress: (info) => hooks.onProgress?.({ ...info, index: i + 1, total: plan.actions.length })
      },
      wallet,
      now
    });
    const last = result.plan?.actions?.[0] || { ...action, status: result.status };
    ran.push(last);
    if (result.success !== true && result.status === 'USER_REJECTED') break;
  }
  const summary = summarizePlan({ ...plan, actions: ran });
  return toExecutionResult(summary);
}

/**
 * Turn a rebalance plan (weights + trades) into an execution plan and run it.
 */
export async function runRebalance({
  holdings,
  balances,
  target,
  hooks,
  adapter,
  adapters,
  wallet,
  now = Date.now()
} = {}) {
  const planned = planRebalance({ holdings, balances, target, now });
  if (!planned.ok) return failResult(planned.code || 'EMPTY_PORTFOLIO');
  if (!planned.trades.length) {
    return {
      schema: EXECUTION_RUNTIME_SCHEMA,
      success: true,
      status: 'CONFIRMED',
      txHash: null,
      chain: null,
      error: null,
      plan: { totalActions: 0, completedActions: 0, failedActions: 0, actions: [], status: 'CONFIRMED' },
      noop: true
    };
  }
  const result = await runExecutionPlan({
    actions: planned.trades,
    intentId: 'rebalance',
    hooks,
    adapter,
    adapters,
    wallet,
    now
  });
  return { ...result, rebalance: planned };
}

/**
 * Build wallet-backed hooks from the live swap engine. Imported lazily so
 * Node probes that never execute do not pull ethers.
 */
export function hooksFromSwapEngine({
  getQuote,
  getBalance,
  checkAllowance,
  approve,
  executeSwap,
  waitForReceipt
} = {}) {
  return {
    getQuote: typeof getQuote === 'function' ? getQuote : undefined,
    getBalance: typeof getBalance === 'function' ? getBalance : undefined,
    checkAllowance: typeof checkAllowance === 'function' ? checkAllowance : undefined,
    approve: typeof approve === 'function' ? approve : undefined,
    sendTransaction: typeof executeSwap === 'function'
      ? async (tx) => executeSwap(tx)
      : undefined,
    waitForConfirmation: typeof waitForReceipt === 'function' ? waitForReceipt : undefined
  };
}
