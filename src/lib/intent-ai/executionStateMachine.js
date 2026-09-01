/**
 * FBT INTENT OS — execution state machine.
 * ---------------------------------------------------------------------------
 * One action walks:
 *
 *   CREATED → VALIDATING → QUOTING → SIMULATING → AWAITING_SIGNATURE
 *           → SIGNED → SUBMITTED → CONFIRMING → CONFIRMED
 *
 * Failures are named, never collapsed into a generic "Execution failed":
 *
 *   VALIDATION_FAILED | SIMULATION_FAILED | USER_REJECTED
 *   BROADCAST_FAILED  | CONFIRMATION_FAILED | EXPIRED | INSUFFICIENT_FUNDS
 *   SLIPPAGE_EXCEEDED | PROVIDER_FAILED | NETWORK_FAILED
 *
 * CONFIRMED is unreachable without a real receipt. That is the whole point.
 */

export const EXECUTION_ACTION_SCHEMA = 'fbt.ai-execution-action.v1';
export const EXECUTION_PLAN_SCHEMA = 'fbt.ai-execution-plan.v1';
export const EXECUTION_RESULT_SCHEMA = 'fbt.ai-execution-result.v1';

export const EXECUTION_STATES = Object.freeze([
  'CREATED',
  'VALIDATING',
  'QUOTING',
  'SIMULATING',
  'AWAITING_SIGNATURE',
  'SIGNED',
  'SUBMITTED',
  'CONFIRMING',
  'CONFIRMED'
]);

export const EXECUTION_FAILURES = Object.freeze([
  'VALIDATION_FAILED',
  'SIMULATION_FAILED',
  'USER_REJECTED',
  'BROADCAST_FAILED',
  'CONFIRMATION_FAILED',
  'EXPIRED',
  'INSUFFICIENT_FUNDS',
  'INSUFFICIENT_GAS',
  'SLIPPAGE_EXCEEDED',
  'PROVIDER_FAILED',
  'NETWORK_FAILED',
  'WALLET_REQUIRED',
  'ALLOWANCE_REQUIRED'
]);

const FORWARD = Object.freeze({
  CREATED: ['VALIDATING'],
  VALIDATING: ['QUOTING', 'AWAITING_SIGNATURE'],
  QUOTING: ['SIMULATING', 'AWAITING_SIGNATURE'],
  SIMULATING: ['AWAITING_SIGNATURE'],
  AWAITING_SIGNATURE: ['SIGNED'],
  SIGNED: ['SUBMITTED'],
  SUBMITTED: ['CONFIRMING'],
  CONFIRMING: ['CONFIRMED'],
  CONFIRMED: []
});

function nowMs() {
  return Date.now();
}

function aid() {
  return `act_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createExecutionAction(input = {}, { now = nowMs() } = {}) {
  return {
    schema: EXECUTION_ACTION_SCHEMA,
    id: input.id || aid(),
    type: String(input.type || 'SWAP').toUpperCase(),
    from: input.from || input.fromSymbol || null,
    to: input.to || input.toSymbol || null,
    asset: input.asset || input.to || input.from || null,
    amount: input.amount ?? null,
    amountUsd: Number.isFinite(Number(input.amountUsd)) ? Number(input.amountUsd) : null,
    chainId: Number.isFinite(Number(input.chainId)) ? Number(input.chainId) : null,
    status: 'CREATED',
    txHash: null,
    receipt: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
}

export function createExecutionPlan({ intentId = null, actions = [], now = nowMs() } = {}) {
  const rows = (Array.isArray(actions) ? actions : []).map((a) => createExecutionAction(a, { now }));
  return {
    schema: EXECUTION_PLAN_SCHEMA,
    intentId: intentId || null,
    actions: rows,
    totalActions: rows.length,
    completedActions: 0,
    failedActions: 0,
    status: rows.length ? 'CREATED' : 'EMPTY',
    createdAt: now,
    updatedAt: now
  };
}

export function canAdvance(from, to) {
  return Array.isArray(FORWARD[from]) && FORWARD[from].includes(to);
}

/**
 * Advance one action. CONFIRMED requires a receipt whose status is success.
 * Anything else that asks for CONFIRMED is refused — that is the
 * no-receipt-no-success rule, encoded as a state transition.
 */
export function advanceAction(action, nextStatus, { receipt = null, txHash = null, error = null, now = nowMs() } = {}) {
  if (!action || action.schema !== EXECUTION_ACTION_SCHEMA) {
    return { ok: false, code: 'ACTION_INVALID' };
  }
  const next = String(nextStatus || '').toUpperCase();
  if (EXECUTION_FAILURES.includes(next)) {
    return {
      ok: true,
      action: {
        ...action,
        status: next,
        error: error ? String(error).slice(0, 160) : next,
        txHash: txHash || action.txHash || null,
        receipt: receipt || action.receipt || null,
        updatedAt: now
      }
    };
  }
  if (!canAdvance(action.status, next)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', from: action.status, to: next };
  }
  if (next === 'CONFIRMED') {
    const okReceipt = isSuccessfulReceipt(receipt);
    if (!okReceipt) {
      return {
        ok: true,
        action: {
          ...action,
          status: 'CONFIRMATION_FAILED',
          error: 'NO_RECEIPT',
          txHash: txHash || action.txHash || null,
          receipt: receipt || null,
          updatedAt: now
        }
      };
    }
  }
  return {
    ok: true,
    action: {
      ...action,
      status: next,
      txHash: txHash || action.txHash || null,
      receipt: receipt || action.receipt || null,
      error: error ? String(error).slice(0, 160) : action.error,
      updatedAt: now
    }
  };
}

/** EVM: receipt.status === 1. Solana: confirmationStatus in {confirmed, finalized}. */
export function isSuccessfulReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (receipt.status === 1 || receipt.status === '0x1' || receipt.status === true) return true;
  const sol = String(receipt.confirmationStatus || receipt.confirmationsStatus || '').toLowerCase();
  if (sol === 'confirmed' || sol === 'finalized') return true;
  if (receipt.confirmed === true && receipt.reverted !== true && (receipt.txHash || receipt.signature)) {
    /* Only when an explicit confirmed flag is paired with a hash — a lone
       `{ confirmed: true }` is how fake success used to sneak in. */
    return Boolean(receipt.blockNumber || receipt.slot || receipt.confirmations > 0);
  }
  return false;
}

export function summarizePlan(plan) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const completed = actions.filter((a) => a.status === 'CONFIRMED').length;
  const failed = actions.filter((a) => EXECUTION_FAILURES.includes(a.status)).length;
  const pending = actions.length - completed - failed;
  let status = 'CREATED';
  if (actions.length === 0) status = 'EMPTY';
  else if (completed === actions.length) status = 'CONFIRMED';
  else if (failed && completed) status = 'PARTIAL';
  else if (failed && !completed) status = 'FAILED';
  else if (pending) status = 'EXECUTING';
  return {
    schema: EXECUTION_PLAN_SCHEMA,
    intentId: plan?.intentId || null,
    actions,
    totalActions: actions.length,
    completedActions: completed,
    failedActions: failed,
    pendingActions: pending,
    status
  };
}

/**
 * The contract the frontend is allowed to render. `success` is true only
 * when every required action has a real receipt. Partial is never success.
 */
export function toExecutionResult(plan, { error = null } = {}) {
  const summary = summarizePlan(plan);
  const hashes = summary.actions.map((a) => a.txHash).filter(Boolean);
  const failed = summary.actions.find((a) => EXECUTION_FAILURES.includes(a.status));
  let status = 'PENDING';
  if (summary.status === 'CONFIRMED') status = 'CONFIRMED';
  else if (summary.status === 'FAILED') status = failed?.status === 'USER_REJECTED' ? 'USER_REJECTED' : 'FAILED';
  else if (summary.status === 'PARTIAL') status = 'FAILED';
  const success = status === 'CONFIRMED' && summary.completedActions === summary.totalActions && summary.totalActions > 0;
  return {
    schema: EXECUTION_RESULT_SCHEMA,
    success,
    status: success ? 'CONFIRMED' : status,
    txHash: hashes[0] || null,
    txHashes: hashes,
    chain: summary.actions[0]?.chainId ?? null,
    plan: summary,
    error: error || (failed ? { code: failed.status, message: failed.error || failed.status } : null)
  };
}
