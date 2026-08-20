/**
 * RECOVERY ENGINE PROBE
 * ---------------------------------------------------------------------------
 * A recovery engine is only safe if it can be proven NOT to do two things:
 * change money-relevant terms without a new signature, and re-broadcast a
 * transaction the user already paid gas for. Both are asserted for EVERY code
 * in the table, not just the interesting ones.
 */

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const rec = await import('../src/lib/intentRecovery.js');
  const lc = await import('../src/lib/intentLifecycle.js');

  t('schema is fbt.intent-recovery.v1', rec.INTENT_RECOVERY_SCHEMA === 'fbt.intent-recovery.v1');
  t('all 18 failure codes are declared', rec.RECOVERY_FAILURE_CODES.length === 18);
  for (const code of [
    'QUOTE_EXPIRED', 'ROUTE_CHANGED', 'RPC_UNAVAILABLE', 'RPC_DISAGREEMENT', 'APPROVAL_REQUIRED',
    'APPROVAL_REJECTED', 'ALLOWANCE_CHANGED', 'INSUFFICIENT_BALANCE', 'GAS_ESTIMATE_CHANGED',
    'CHAIN_CHANGED', 'ACCOUNT_CHANGED', 'SIMULATION_REVERTED', 'TRANSACTION_REJECTED',
    'TRANSACTION_DROPPED', 'TRANSACTION_REPLACED', 'RECEIPT_FAILED', 'CONFIRMATION_TIMEOUT',
    'MIN_OUTPUT_AT_RISK'
  ]) {
    t(`failure code ${code} is declared`, rec.RECOVERY_FAILURE_CODES.includes(code));
  }

  /* ------------------- the two invariants, for every code ------------------ */
  let neverResubmits = true;
  let knownActions = true;
  let knownStatuses = true;
  for (const code of rec.RECOVERY_FAILURE_CODES) {
    const plan = rec.planRecovery(code);
    if (plan.resubmits !== false) neverResubmits = false;
    if (!plan.actions.every((a) => rec.RECOVERY_ACTIONS.includes(a))) knownActions = false;
    if (!lc.LIFECYCLE_STATUSES.includes(plan.nextStatus)) knownStatuses = false;
  }
  t('NO recovery plan ever re-broadcasts a transaction', neverResubmits);
  t('every planned action is a declared action', knownActions);
  t('every planned next status is a real lifecycle status', knownStatuses);

  /* ------------------------------- requote --------------------------------- */
  const requote = rec.planRecovery('QUOTE_EXPIRED');
  t('an expired quote requotes', requote.actions.includes('REQUOTE'));
  t('a requote does not send anything automatically', requote.automatic === false && requote.resubmits === false);
  t('a requote needs a fresh signature', requote.requiresNewSignature === true);
  t('a requote needs a fresh review', requote.requiresUserReview === true);
  t('a requote moves the lifecycle back to QUOTING', requote.nextStatus === 'QUOTING');

  /* ---------------------------- route changed ------------------------------ */
  const routeChanged = rec.planRecovery('ROUTE_CHANGED');
  t('a changed route demands a new signature', routeChanged.requiresNewSignature === true);
  t('a changed route demands a new review', routeChanged.requiresUserReview === true);
  t('a changed route re-enters OPTIMIZING, not AWAITING_SIGNATURE',
    routeChanged.nextStatus === 'OPTIMIZING');

  /* ------------------------------ rpc retry -------------------------------- */
  const rpc = rec.planRecovery('RPC_UNAVAILABLE');
  t('an RPC failure switches provider and retries the preflight',
    rpc.actions.includes('SWITCH_READ_RPC') && rpc.actions.includes('RETRY_PREFLIGHT'));
  t('an RPC retry never re-submits the transaction', rpc.resubmits === false);
  t('an RPC retry needs no new signature', rpc.requiresNewSignature === false);
  t('an RPC retry may run automatically', rec.isAutomaticRecovery(rpc) === true);
  t('a requote may NOT run automatically', rec.isAutomaticRecovery(requote) === false);

  /* ------------------------------- approvals -------------------------------- */
  const approval = rec.planRecovery('APPROVAL_REQUIRED');
  t('a missing allowance requests an approval', approval.actions.includes('REQUEST_APPROVAL'));
  t('the approval flow waits at AWAITING_APPROVAL', approval.nextStatus === 'AWAITING_APPROVAL');
  t('an approval is signed by the user', approval.requiresNewSignature === true);
  const approvalRejected = rec.planRecovery('APPROVAL_REJECTED');
  t('a rejected approval is recoverable, not fatal', approvalRejected.nextStatus === 'RECOVERABLE');

  /* --------------------------- dropped / replaced --------------------------- */
  const dropped = rec.planRecovery('TRANSACTION_DROPPED');
  t('a dropped transaction is tracked, not resent',
    dropped.actions.includes('TRACK_REPLACEMENT') && dropped.resubmits === false);
  const replaced = rec.planRecovery('TRANSACTION_REPLACED');
  t('a replacement is followed to confirmation', replaced.nextStatus === 'CONFIRMING');
  t('a replacement needs no new signature', replaced.requiresNewSignature === false);

  /* ------------------------------- terminal --------------------------------- */
  const receiptFailed = rec.planRecovery('RECEIPT_FAILED');
  t('a failed receipt is terminal', receiptFailed.nextStatus === 'FAILED' && receiptFailed.retryable === false);
  const balance = rec.planRecovery('INSUFFICIENT_BALANCE');
  t('an insufficient balance is not retryable by itself', balance.retryable === false);
  const unknown = rec.planRecovery('SOMETHING_WEIRD');
  t('an unknown failure fails closed', unknown.nextStatus === 'FAILED' && unknown.retryable === false);
  t('an unknown failure never re-sends', unknown.resubmits === false);

  /* --------------------------- confirmation timeout ------------------------- */
  const timeout = rec.planRecovery('CONFIRMATION_TIMEOUT');
  t('a confirmation timeout becomes RECOVERABLE, not FAILED', timeout.nextStatus === 'RECOVERABLE');
  t('a confirmation timeout does not re-broadcast', timeout.resubmits === false);
  t('a confirmation timeout keeps the user informed rather than signing again',
    timeout.requiresNewSignature === false && timeout.requiresUserReview === true);

  /* ------------------------------- attempts --------------------------------- */
  t('attempts are counted', rec.planRecovery('RPC_UNAVAILABLE', { attempt: 2 }).attempt === 2);
  const exhausted = rec.planRecovery('RPC_UNAVAILABLE', { attempt: 9 });
  t('a retry budget exists and ends in FAILED', exhausted.exhausted === true && exhausted.nextStatus === 'FAILED');
  t('an exhausted plan still never re-sends', exhausted.resubmits === false);

  /* ------------------------------ classification ---------------------------- */
  const cases = [
    [{ code: 'ACTION_REJECTED', message: 'user rejected action' }, 'TRANSACTION_REJECTED'],
    [{ message: 'timeout of 5000ms exceeded' }, 'RPC_UNAVAILABLE'],
    [{ code: 'CALL_EXCEPTION', message: 'execution reverted' }, 'SIMULATION_REVERTED'],
    [{ message: 'insufficient funds for intrinsic transaction cost' }, 'INSUFFICIENT_BALANCE'],
    [{ code: 'TRANSACTION_REPLACED', message: 'transaction was replaced' }, 'TRANSACTION_REPLACED'],
    [{ message: 'nonce too low' }, 'TRANSACTION_DROPPED'],
    [{ message: 'INSUFFICIENT_OUTPUT_AMOUNT' }, 'MIN_OUTPUT_AT_RISK'],
    [{ message: 'QUOTE_EXPIRED' }, 'QUOTE_EXPIRED']
  ];
  for (const [error, expected] of cases) {
    t(`classifyFailure(${expected})`, rec.classifyFailure(error) === expected);
  }
  t('a known code passes through classifyFailure', rec.classifyFailure('CHAIN_CHANGED') === 'CHAIN_CHANGED');

  /* --------------------- simulation status → failure code ------------------- */
  const simulationMap = [
    ['approval-required', 'APPROVAL_REQUIRED'],
    ['insufficient-balance', 'INSUFFICIENT_BALANCE'],
    ['reverted', 'SIMULATION_REVERTED'],
    ['rpc-unavailable', 'RPC_UNAVAILABLE'],
    ['quote-expired', 'QUOTE_EXPIRED'],
    ['chain-mismatch', 'CHAIN_CHANGED'],
    ['account-mismatch', 'ACCOUNT_CHANGED']
  ];
  for (const [status, code] of simulationMap) {
    t(`simulation ${status} maps to ${code}`, rec.failureCodeForSimulation(status) === code);
  }
  t('a passed simulation needs no recovery', rec.failureCodeForSimulation('passed') === null);

  /* ------------------ plans compose with the state machine ------------------ */
  const now = 1_780_000_000_000;
  let record = lc.createLifecycle({ intentId: 'in_rec', deadlineAt: now + 600_000, now });
  for (const status of ['VALIDATING', 'VALIDATED', 'QUOTING', 'OPTIMIZING', 'SIMULATING']) {
    record = lc.transition(record, status, { now }).record;
  }
  const plan = rec.planRecovery('APPROVAL_REQUIRED');
  const moved = lc.transition(record, plan.nextStatus, { reasonCode: plan.code, now });
  t('an approval plan is a legal lifecycle transition', moved.ok && moved.record.status === 'AWAITING_APPROVAL');
  t('the recovery reason is recorded on the event',
    moved.record.events[moved.record.events.length - 1].reasonCode === 'APPROVAL_REQUIRED');

  return rows;
}
