/**
 * FBT INTENT AI — Phase 13: live and recurring intents.
 *
 * This is a deterministic lifecycle contract, not a scheduler. A process-local
 * record is useful to the UI and probes, but it is not runtime evidence. A
 * missing monitor, policy re-check, receipt, or provider therefore remains
 * `UNAVAILABLE`/`PENDING`; nothing is promoted to COMPLETED by optimism.
 */

import {
  applyNonBypassableControl,
  containsRawSecret,
  fail,
  finite,
  noExecutionPermission,
  safeId,
  safeList,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const LIVE_INTENT_SCHEMA = 'fbt.live-intent.v1';
export const RECURRING_INTENT_SCHEMA = 'fbt.recurring-intent.v1';
export const INTENT_TIMELINE_SCHEMA = 'fbt.intent-timeline.v1';
export const INTENT_RESULT_SCHEMA = 'fbt.intent-final-result.v1';

export const LIVE_INTENT_STATUSES = Object.freeze([
  'DRAFT',
  'PENDING',
  'PARTIAL',
  'FAILED',
  'EXPIRED',
  'COMPLETED',
  'CANCELLED',
  'PAUSED',
  'REVOKED',
  'UNAVAILABLE'
]);
export const TERMINAL_LIVE_STATUSES = Object.freeze(['FAILED', 'EXPIRED', 'COMPLETED', 'CANCELLED', 'REVOKED']);

export const LIVE_TRANSITIONS = Object.freeze({
  DRAFT: ['PENDING', 'CANCELLED', 'EXPIRED', 'PAUSED', 'REVOKED', 'UNAVAILABLE'],
  PENDING: ['PARTIAL', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'PAUSED', 'REVOKED', 'UNAVAILABLE'],
  PARTIAL: ['PARTIAL', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'PAUSED', 'REVOKED', 'UNAVAILABLE'],
  PAUSED: ['PENDING', 'EXPIRED', 'CANCELLED', 'REVOKED', 'UNAVAILABLE'],
  UNAVAILABLE: ['PENDING', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVOKED'],
  FAILED: [], EXPIRED: [], COMPLETED: [], CANCELLED: [], REVOKED: []
});

const cleanStatus = (status) => String(status || '').toUpperCase();
const finiteOrNull = (value) => {
  const n = finite(value);
  return n === null ? null : n;
};

function timelineEvent(intentId, sequence, from, to, reason, now, detail = null) {
  return {
    schema: INTENT_TIMELINE_SCHEMA,
    intentId,
    sequence,
    from: from || null,
    to,
    reason: safeString(reason || 'UNSPECIFIED', 80) || 'UNSPECIFIED',
    timestamp: now,
    ...(detail && typeof detail === 'object' ? { detail: publicDetail(detail) } : {})
  };
}

function publicDetail(detail) {
  const out = {};
  for (const [key, value] of Object.entries(detail).slice(0, 8)) {
    if (/secret|key|seed|password|credential|calldata|signer/i.test(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, 100);
  }
  return out;
}

function baseRecord({ id, intent, expiresAt, now, recurringId = null } = {}) {
  const safeIntent = intent && typeof intent === 'object' && !containsRawSecret(intent)
    ? {
      id: safeId(intent.id) || null,
      kind: safeString(intent.kind, 32) || null,
      chainId: finiteOrNull(intent.chainId),
      protocol: safeString(intent.protocol, 64) || null,
      amountUsd: finiteOrNull(intent.amountUsd)
    }
    : null;
  const event = timelineEvent(id, 0, null, 'DRAFT', 'INTENT_CREATED', now);
  return {
    schema: LIVE_INTENT_SCHEMA,
    id,
    intent: safeIntent,
    recurringId,
    status: 'DRAFT',
    sequence: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: finiteOrNull(expiresAt),
    controls: {
      stopped: false,
      paused: false,
      revoked: false,
      disconnected: false,
      emergency_exit: false
    },
    timeline: [event],
    runtimeEvidence: null,
    receipt: null,
    result: null,
    executionAuthorized: false
  };
}

export function createLiveIntent({ id, intent = {}, expiresAt = null, now = Date.now() } = {}) {
  if (containsRawSecret(intent)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const intentId = safeId(id || intent.id || `intent-${Math.floor(now / 1000)}`);
  if (!intentId) return fail('INTENT_ID_REQUIRED');
  if (expiresAt !== null && (finite(expiresAt) === null || finite(expiresAt) <= now)) return fail('INTENT_EXPIRY_INVALID');
  return { ok: true, intent: baseRecord({ id: intentId, intent, expiresAt, now }) };
}

/** Create a recurring definition. It never issues permission or a scheduler. */
export function createRecurringIntent({ id, intent = {}, schedule = {}, expiresAt = null, maxRuns = null, now = Date.now() } = {}) {
  if (containsRawSecret(intent) || containsRawSecret(schedule)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const recurringId = safeId(id || `recurring-${Math.floor(now / 1000)}`);
  const intervalMs = finite(schedule.intervalMs);
  const firstRunAt = finite(schedule.firstRunAt ?? now);
  const runs = finite(maxRuns);
  if (!recurringId || intervalMs === null || intervalMs < 60_000 || firstRunAt === null || firstRunAt < now || (runs !== null && (!Number.isInteger(runs) || runs < 1 || runs > 10_000))) {
    return fail('RECURRING_SCHEDULE_INVALID');
  }
  if (expiresAt !== null && (finite(expiresAt) === null || finite(expiresAt) <= firstRunAt)) return fail('RECURRING_EXPIRY_INVALID');
  const first = createLiveIntent({ id: `${recurringId}-run-1`, intent, expiresAt, now });
  if (!first.ok) return first;
  return {
    ok: true,
    recurring: noExecutionPermission({
      schema: RECURRING_INTENT_SCHEMA,
      id: recurringId,
      schedule: { intervalMs, firstRunAt, maxRuns: runs === null ? null : runs },
      nextRunAt: firstRunAt,
      runCount: 0,
      active: true,
      revoked: false,
      expiresAt: finiteOrNull(expiresAt),
      template: first.intent,
      currentRun: first.intent,
      policyRecheckRequired: true,
      userAuthorizationPerRun: true,
      createdAt: now
    })
  };
}

function expires(record, now) {
  return record.expiresAt !== null && finite(record.expiresAt) !== null && now >= Number(record.expiresAt);
}

/** Transition with terminal-state and runtime-proof checks. */
export function transitionLiveIntent(record, to, { reason = 'UNSPECIFIED', now = Date.now(), runtimeEvidence = null, receipt = null } = {}) {
  if (!record || record.schema !== LIVE_INTENT_SCHEMA) return fail('BAD_INTENT_RECORD');
  const target = cleanStatus(to);
  if (!LIVE_INTENT_STATUSES.includes(target)) return fail('UNKNOWN_STATUS', target, { intent: record });
  if (record.status === target) return { ok: true, idempotent: true, intent: record };
  if (TERMINAL_LIVE_STATUSES.includes(record.status)) return fail('TERMINAL_STATE', record.status, { intent: record });
  if (expires(record, now) && !['EXPIRED', 'CANCELLED', 'FAILED'].includes(target)) {
    return transitionLiveIntent(record, 'EXPIRED', { reason: 'EXPIRY_REACHED', now });
  }
  if (!(LIVE_TRANSITIONS[record.status] || []).includes(target)) return fail('INVALID_TRANSITION', `${record.status}->${target}`, { intent: record });
  if (target === 'COMPLETED') {
    const proof = validCompletionProof(runtimeEvidence, receipt, now);
    if (!proof.ok) return unavailable(proof.code, proof.detail, { intent: record });
  }
  const next = {
    ...record,
    status: target,
    sequence: Number(record.sequence || 0) + 1,
    updatedAt: now,
    runtimeEvidence: target === 'COMPLETED' ? publicRuntime(runtimeEvidence) : record.runtimeEvidence,
    receipt: target === 'COMPLETED' ? publicReceipt(receipt) : record.receipt,
    timeline: [...(record.timeline || []), timelineEvent(record.id, Number(record.sequence || 0) + 1, record.status, target, reason, now)]
  };
  return { ok: true, intent: next };
}

function validCompletionProof(evidence, receipt, now) {
  const checkedAt = finite(evidence?.checkedAt);
  const expiresAt = finite(evidence?.expiresAt);
  if (!evidence || !safeId(evidence.providerId) || evidence.status !== 'confirmed' || checkedAt === null || checkedAt > now || (expiresAt !== null && expiresAt <= now)) {
    return { ok: false, code: 'RUNTIME_EVIDENCE_REQUIRED', detail: 'A confirmed, current provider observation is required.' };
  }
  const issuedAt = finite(receipt?.issuedAt);
  if (!receipt || receipt.schema !== INTENT_RESULT_SCHEMA || receipt.verified !== true || receipt.confirmed !== true || !safeString(receipt.receiptId, 160) || receipt.txStatus === 'failed' || (issuedAt !== null && issuedAt > now)) {
    return { ok: false, code: 'VERIFIED_RECEIPT_REQUIRED', detail: 'A verified final receipt is required.' };
  }
  return { ok: true };
}

function publicRuntime(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    providerId: safeId(value.providerId) || null,
    status: safeString(value.status, 32) || null,
    checkedAt: finiteOrNull(value.checkedAt),
    expiresAt: finiteOrNull(value.expiresAt),
    evidenceId: safeId(value.evidenceId) || null
  };
}
function publicReceipt(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    schema: INTENT_RESULT_SCHEMA,
    receiptId: safeString(value.receiptId, 160),
    verified: value.verified === true,
    confirmed: value.confirmed === true,
    txStatus: safeString(value.txStatus, 32) || null,
    actualOutput: finiteOrNull(value.actualOutput),
    issuedAt: finiteOrNull(value.issuedAt)
  };
}

export function finalizeLiveIntent(record, { runtimeEvidence = null, receipt = null, now = Date.now() } = {}) {
  return transitionLiveIntent(record, 'COMPLETED', { runtimeEvidence, receipt, reason: 'VERIFIED_RUNTIME_RECEIPT', now });
}

export function recordLiveFailure(record, { code = 'RUNTIME_FAILURE', now = Date.now(), partial = false } = {}) {
  const target = partial ? 'PARTIAL' : 'FAILED';
  return transitionLiveIntent(record, target, { reason: code, now });
}

export function monitorLiveIntent(record, { monitor = null, now = Date.now() } = {}) {
  if (!record || record.schema !== LIVE_INTENT_SCHEMA) return fail('BAD_INTENT_RECORD');
  if (typeof monitor !== 'function') return unavailable('MONITOR_UNAVAILABLE', 'No live runtime monitor is connected.', { intentId: record.id });
  return Promise.resolve().then(() => monitor(record.id)).then((result) => {
    if (!result || result.ok !== true) return unavailable('MONITOR_RESULT_UNAVAILABLE', null, { intentId: record.id, status: 'UNAVAILABLE' });
    return { ok: true, schema: INTENT_TIMELINE_SCHEMA, intentId: record.id, status: result.status || record.status, checkedAt: now, evidence: publicRuntime(result.evidence) };
  }).catch(() => unavailable('MONITOR_PROVIDER_ERROR', null, { intentId: record.id, status: 'UNAVAILABLE' }));
}

/**
 * Every recurring tick repeats expiry, policy, controls and user authorization
 * checks. The function returns a prepared run, never submits one.
 */
export async function prepareRecurringRun(recurring, {
  now = Date.now(),
  policyCheck = null,
  userAuthorized = false,
  controls = {},
  runId = null
} = {}) {
  if (!recurring || recurring.schema !== RECURRING_INTENT_SCHEMA) return fail('BAD_RECURRING_INTENT');
  if (!recurring.active || recurring.revoked) return fail('RECURRING_REVOKED');
  if (finite(recurring.expiresAt) !== null && now >= recurring.expiresAt) return fail('RECURRING_EXPIRED');
  if (finite(recurring.nextRunAt) === null || now < Number(recurring.nextRunAt)) return unavailable('RECURRING_NOT_DUE', 'The recurring intent cannot be prepared before its scheduled time.');
  if (recurring.schedule.maxRuns !== null && recurring.runCount >= recurring.schedule.maxRuns) return fail('RECURRING_MAX_RUNS');
  const activeControl = ['stop', 'stopped', 'pause', 'paused', 'revoke', 'revoked', 'disconnect', 'disconnected', 'emergency', 'emergency_exit'].some((key) => controls?.[key] === true);
  if (activeControl) return fail('CONTROL_ACTIVE');
  if (userAuthorized !== true) return fail('USER_AUTHORIZATION_REQUIRED');
  if (typeof policyCheck !== 'function') return unavailable('POLICY_RECHECK_UNAVAILABLE', 'Recurring execution requires a fresh policy evaluation.');
  let policy;
  try { policy = await policyCheck({ recurringId: recurring.id, runCount: recurring.runCount, now }); } catch { return unavailable('POLICY_RECHECK_FAILED'); }
  if (!policy || policy.ok !== true || policy.decision !== 'ALLOW_REVIEW_ONLY') return fail('POLICY_RECHECK_BLOCKED');
  const nextRun = Number(recurring.runCount) + 1;
  const id = safeId(runId || `${recurring.id}-run-${nextRun}`);
  if (!id) return fail('RUN_ID_INVALID');
  return {
    ok: true,
    schema: RECURRING_INTENT_SCHEMA,
    run: { id, recurringId: recurring.id, runNumber: nextRun, scheduledAt: recurring.nextRunAt, preparedAt: now, policyVersion: safeString(policy.policyVersion, 64) || null, policyRechecked: true, userAuthorized: true, executionAuthorized: false },
    nextRecurring: { ...recurring, runCount: nextRun, nextRunAt: recurring.nextRunAt + recurring.schedule.intervalMs, currentRun: null }
  };
}

export function applyLiveControl(record, action, { now = Date.now() } = {}) {
  if (!record || !record.controls) return fail('BAD_INTENT_RECORD');
  const changed = applyNonBypassableControl(record.controls, action, now);
  if (!changed.ok) return changed;
  const actionToStatus = { STOP: 'CANCELLED', PAUSE: 'PAUSED', REVOKE: 'REVOKED', DISCONNECT: 'UNAVAILABLE', EMERGENCY_EXIT: 'CANCELLED' };
  const target = actionToStatus[changed.action];
  if (!target || TERMINAL_LIVE_STATUSES.includes(record.status)) return { ok: true, controls: changed.controls, intent: record, immediate: true };
  const transitioned = transitionLiveIntent({ ...record, controls: changed.controls }, target, { reason: changed.action, now });
  return transitioned.ok ? { ...transitioned, controls: changed.controls, immediate: true } : { ok: false, controls: changed.controls, code: transitioned.code };
}

export function finalResult(record) {
  if (!record || record.schema !== LIVE_INTENT_SCHEMA) return fail('BAD_INTENT_RECORD');
  if (record.status !== 'COMPLETED' || record.receipt?.schema !== INTENT_RESULT_SCHEMA || record.receipt?.verified !== true || record.receipt?.confirmed !== true) {
    return { ok: false, schema: INTENT_RESULT_SCHEMA, code: 'RESULT_NOT_FINAL', status: record.status, final: false, executionPermission: false };
  }
  return { ok: true, schema: INTENT_RESULT_SCHEMA, final: true, status: 'COMPLETED', verified: true, receipt: record.receipt, executionPermission: false };
}
