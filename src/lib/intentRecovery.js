/**
 * INTENT RECOVERY ENGINE — fbt.intent-recovery.v1
 * ---------------------------------------------------------------------------
 * One deterministic table from failure code → allowed recovery, so that every
 * "Retry" button in the app means exactly one, reviewable thing.
 *
 * ─── THE THREE RULES ────────────────────────────────────────────────────────
 * 1. RECOVERY NEVER CHANGES MONEY-RELEVANT TERMS SILENTLY. Amount, route,
 *    recipient, chain, slippage and calldata can only change through a new
 *    user review and a new signature (`requiresNewSignature`).
 * 2. RECOVERY NEVER RE-BROADCASTS. `resubmits` is false for every action in
 *    this file. A network retry re-reads; it does not re-send. Double-spending
 *    a user's gas because an RPC timed out is the exact bug this prevents.
 * 3. EVERY MESSAGE IS A CODE. No English sentences here — the UI translates
 *    `intent.recovery.<CODE>` so Persian and every other locale get real text.
 *
 * Pure module: no React, no provider, no signer, no network.
 */

export const INTENT_RECOVERY_SCHEMA = 'fbt.intent-recovery.v1';

export const RECOVERY_FAILURE_CODES = Object.freeze([
  'QUOTE_EXPIRED',
  'ROUTE_CHANGED',
  'RPC_UNAVAILABLE',
  'RPC_DISAGREEMENT',
  'APPROVAL_REQUIRED',
  'APPROVAL_REJECTED',
  'ALLOWANCE_CHANGED',
  'INSUFFICIENT_BALANCE',
  'GAS_ESTIMATE_CHANGED',
  'CHAIN_CHANGED',
  'ACCOUNT_CHANGED',
  'SIMULATION_REVERTED',
  'TRANSACTION_REJECTED',
  'TRANSACTION_DROPPED',
  'TRANSACTION_REPLACED',
  'RECEIPT_FAILED',
  'CONFIRMATION_TIMEOUT',
  'MIN_OUTPUT_AT_RISK'
]);

export const RECOVERY_ACTIONS = Object.freeze([
  'REQUOTE',
  'RETRY_PREFLIGHT',
  'SWITCH_READ_RPC',
  'REQUEST_NETWORK_SWITCH',
  'REQUEST_ACCOUNT_RECONNECT',
  'REQUEST_APPROVAL',
  'REQUEST_NEW_SIGNATURE',
  'TRACK_REPLACEMENT',
  'MARK_RECOVERABLE',
  'MARK_FAILED',
  'MARK_EXPIRED'
]);

/*
 * The table. `nextStatus` is a lifecycle status from intentLifecycle.js, so a
 * recovery plan can be handed straight to `transition()`.
 */
const PLANS = Object.freeze({
  QUOTE_EXPIRED: {
    actions: ['REQUOTE'],
    nextStatus: 'QUOTING',
    requiresNewSignature: true,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  ROUTE_CHANGED: {
    actions: ['REQUOTE', 'REQUEST_NEW_SIGNATURE'],
    nextStatus: 'OPTIMIZING',
    requiresNewSignature: true,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  RPC_UNAVAILABLE: {
    actions: ['SWITCH_READ_RPC', 'RETRY_PREFLIGHT'],
    nextStatus: 'SIMULATING',
    requiresNewSignature: false,
    requiresUserReview: false,
    automatic: true,
    retryable: true
  },
  RPC_DISAGREEMENT: {
    actions: ['SWITCH_READ_RPC', 'RETRY_PREFLIGHT', 'MARK_RECOVERABLE'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: false,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  APPROVAL_REQUIRED: {
    actions: ['REQUEST_APPROVAL'],
    nextStatus: 'AWAITING_APPROVAL',
    requiresNewSignature: true,
    requiresUserReview: false,
    automatic: false,
    retryable: true
  },
  APPROVAL_REJECTED: {
    actions: ['MARK_RECOVERABLE', 'REQUEST_APPROVAL'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: true,
    requiresUserReview: false,
    automatic: false,
    retryable: true
  },
  ALLOWANCE_CHANGED: {
    actions: ['RETRY_PREFLIGHT', 'REQUEST_APPROVAL'],
    nextStatus: 'SIMULATING',
    requiresNewSignature: true,
    requiresUserReview: false,
    automatic: false,
    retryable: true
  },
  INSUFFICIENT_BALANCE: {
    actions: ['MARK_RECOVERABLE'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: false,
    requiresUserReview: true,
    automatic: false,
    retryable: false
  },
  GAS_ESTIMATE_CHANGED: {
    actions: ['RETRY_PREFLIGHT', 'REQUEST_NEW_SIGNATURE'],
    nextStatus: 'SIMULATING',
    requiresNewSignature: true,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  CHAIN_CHANGED: {
    actions: ['REQUEST_NETWORK_SWITCH', 'REQUOTE'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: true,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  ACCOUNT_CHANGED: {
    actions: ['REQUEST_ACCOUNT_RECONNECT', 'REQUOTE'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: true,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  SIMULATION_REVERTED: {
    actions: ['REQUOTE', 'MARK_RECOVERABLE'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: true,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  TRANSACTION_REJECTED: {
    actions: ['MARK_RECOVERABLE', 'REQUEST_NEW_SIGNATURE'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: true,
    requiresUserReview: false,
    automatic: false,
    retryable: true
  },
  TRANSACTION_DROPPED: {
    actions: ['TRACK_REPLACEMENT', 'MARK_RECOVERABLE'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: true,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  TRANSACTION_REPLACED: {
    actions: ['TRACK_REPLACEMENT'],
    nextStatus: 'CONFIRMING',
    requiresNewSignature: false,
    requiresUserReview: false,
    automatic: true,
    retryable: true
  },
  RECEIPT_FAILED: {
    actions: ['MARK_FAILED'],
    nextStatus: 'FAILED',
    requiresNewSignature: false,
    requiresUserReview: true,
    automatic: false,
    retryable: false
  },
  CONFIRMATION_TIMEOUT: {
    actions: ['TRACK_REPLACEMENT', 'MARK_RECOVERABLE'],
    nextStatus: 'RECOVERABLE',
    requiresNewSignature: false,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  },
  MIN_OUTPUT_AT_RISK: {
    actions: ['REQUOTE', 'REQUEST_NEW_SIGNATURE'],
    nextStatus: 'OPTIMIZING',
    requiresNewSignature: true,
    requiresUserReview: true,
    automatic: false,
    retryable: true
  }
});

export const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Build a recovery plan. Unknown codes fail closed to a terminal FAILED plan
 * rather than guessing a retry that might re-send money.
 *
 * @returns {{
 *   schema:string, code:string, actions:string[], nextStatus:string,
 *   requiresNewSignature:boolean, requiresUserReview:boolean,
 *   resubmits:false, automatic:boolean, retryable:boolean,
 *   attempt:number, exhausted:boolean, createdAt:number
 * }}
 */
export function planRecovery(code, { attempt = 1, now = Date.now(), maxAttempts = MAX_RECOVERY_ATTEMPTS } = {}) {
  const key = String(code || '').toUpperCase();
  const plan = PLANS[key];
  if (!plan) {
    return {
      schema: INTENT_RECOVERY_SCHEMA,
      code: 'UNKNOWN_FAILURE',
      actions: ['MARK_FAILED'],
      nextStatus: 'FAILED',
      requiresNewSignature: false,
      requiresUserReview: true,
      resubmits: false,
      automatic: false,
      retryable: false,
      attempt: Number(attempt) || 1,
      exhausted: true,
      createdAt: now
    };
  }
  const n = Math.max(1, Math.round(Number(attempt) || 1));
  const exhausted = plan.retryable ? n > maxAttempts : true;
  return {
    schema: INTENT_RECOVERY_SCHEMA,
    code: key,
    actions: exhausted ? ['MARK_FAILED'] : [...plan.actions],
    nextStatus: exhausted ? 'FAILED' : plan.nextStatus,
    requiresNewSignature: exhausted ? false : plan.requiresNewSignature,
    requiresUserReview: exhausted ? true : plan.requiresUserReview,
    /* Invariant asserted by the probe: no recovery ever re-broadcasts. */
    resubmits: false,
    automatic: exhausted ? false : plan.automatic,
    retryable: !exhausted && plan.retryable,
    attempt: n,
    exhausted,
    createdAt: now
  };
}

/**
 * Map a thrown error / simulation status to a recovery failure code.
 * Wallet and RPC libraries do not agree on error shapes, so this reads the
 * structured fields FIRST and only falls back to message matching.
 */
export function classifyFailure(input) {
  if (!input) return 'RPC_UNAVAILABLE';
  if (typeof input === 'string' && RECOVERY_FAILURE_CODES.includes(input)) return input;

  const code = String(input?.code ?? '');
  const message = String(input?.shortMessage || input?.message || input || '');

  if (code === 'ACTION_REJECTED' || /user rejected|user denied|rejected the request/i.test(message)) {
    return 'TRANSACTION_REJECTED';
  }
  if (code === 'TRANSACTION_REPLACED' || /replaced/i.test(message)) return 'TRANSACTION_REPLACED';
  if (/dropped|not found|nonce too low/i.test(message)) return 'TRANSACTION_DROPPED';
  if (code === 'INSUFFICIENT_FUNDS' || /insufficient funds|insufficient balance/i.test(message)) {
    return 'INSUFFICIENT_BALANCE';
  }
  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT' || /timeout|timed out|network|fetch failed|econn/i.test(message)) {
    return 'RPC_UNAVAILABLE';
  }
  if (code === 'CALL_EXCEPTION' || /revert|execution reverted/i.test(message)) return 'SIMULATION_REVERTED';
  if (/allowance|approve/i.test(message)) return 'APPROVAL_REQUIRED';
  if (/chain|network mismatch|unsupported chain/i.test(message)) return 'CHAIN_CHANGED';
  if (/account|address mismatch/i.test(message)) return 'ACCOUNT_CHANGED';
  if (/quote.?expired|stale quote/i.test(message)) return 'QUOTE_EXPIRED';
  if (/INSUFFICIENT_OUTPUT_AMOUNT|slippage/i.test(message)) return 'MIN_OUTPUT_AT_RISK';
  return 'RPC_UNAVAILABLE';
}

/** Simulation status (fbt.intent-simulation.v1) → recovery failure code. */
export function failureCodeForSimulation(status) {
  switch (status) {
    case 'approval-required': return 'APPROVAL_REQUIRED';
    case 'insufficient-balance': return 'INSUFFICIENT_BALANCE';
    case 'reverted': return 'SIMULATION_REVERTED';
    case 'rpc-unavailable': return 'RPC_UNAVAILABLE';
    case 'rpc-disagreement': return 'RPC_DISAGREEMENT';
    case 'quote-expired': return 'QUOTE_EXPIRED';
    case 'chain-mismatch': return 'CHAIN_CHANGED';
    case 'account-mismatch': return 'ACCOUNT_CHANGED';
    default: return null;
  }
}

/** True when the plan may run without any further user interaction. */
export const isAutomaticRecovery = (plan) =>
  Boolean(plan?.automatic) && !plan?.requiresNewSignature && !plan?.requiresUserReview && plan?.resubmits === false;
