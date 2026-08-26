/**
 * FBT INTENT AI — Freeze/Unfreeze control.
 *
 * The system starts FROZEN by default. Unfreezing requires:
 * 1. Dual operator authorization (two distinct operator IDs)
 * 2. A stated reason (appended to audit log)
 * 3. All 21 evidence kinds must be verified and current
 *
 * Re-freezing can happen automatically when evidence expires.
 */

import { createHash } from 'node:crypto';
import { aggregateOperationalReadiness } from '../src/lib/intent-ai/operationalActivation.js';
import { getStoredEvidence } from './intentOperatorEvidence.js';
import { auditAppend } from './intentAuditLog.js';

export const FREEZE_CONTROL_SCHEMA = 'fbt.freeze-control.v1';

/* Default state: frozen */
let freezeState = {
  frozen: true,
  reason: 'default-frozen',
  changedAt: 0,
  changedBy: [],
  evidenceAtChange: null
};

/**
 * Attempt to unfreeze. Requires dual operator auth + all evidence verified.
 */
export function attemptUnfreeze({ operators = [], reason = '', evidence = [], now = Date.now() } = {}) {
  /* Validate operators */
  if (!Array.isArray(operators) || operators.length < 2) {
    return { ok: false, code: 'DUAL_OPERATOR_REQUIRED' };
  }
  if (operators[0] === operators[1]) {
    return { ok: false, code: 'OPERATORS_MUST_BE_DISTINCT' };
  }

  const OP_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
  if (!operators.every(op => OP_ID_RE.test(op))) {
    return { ok: false, code: 'OPERATOR_ID_FORMAT_INVALID' };
  }

  /* Validate reason */
  if (!reason || reason.trim().length < 10) {
    return { ok: false, code: 'REASON_REQUIRED', detail: 'Reason must be at least 10 characters.' };
  }

  /* Check evidence */
  const allEvidence = evidence.length > 0 ? evidence : getStoredEvidence({ now });
  const readiness = aggregateOperationalReadiness({ evidence: allEvidence, now });

  if (!readiness.launchAllowed) {
    return {
      ok: false,
      code: 'EVIDENCE_INCOMPLETE',
      blockers: readiness.blockers,
      detail: `${readiness.blockers.length} critical blocker(s) remain.`
    };
  }

  /* All checks passed — unfreeze */
  freezeState = {
    frozen: false,
    reason: reason.trim().slice(0, 240),
    changedAt: now,
    changedBy: operators,
    evidenceAtChange: readiness.evidence.length
  };

  /* Audit */
  auditAppend({
    action: 'unfreeze',
    operators,
    reason: reason.trim().slice(0, 240),
    evidenceCount: readiness.evidence.length
  }).catch(() => {});

  return {
    ok: true,
    schema: FREEZE_CONTROL_SCHEMA,
    frozen: false,
    reason: freezeState.reason,
    changedAt: now,
    changedBy: operators,
    evidenceCount: readiness.evidence.length
  };
}

/**
 * Re-freeze the system. Can be called by any operator or triggered automatically.
 */
export function refreeze({ operator = 'system', reason = 'evidence-expired', now = Date.now() } = {}) {
  freezeState = {
    frozen: true,
    reason: reason.slice(0, 240),
    changedAt: now,
    changedBy: [operator],
    evidenceAtChange: null
  };

  auditAppend({
    action: 'refreeze',
    operator,
    reason: reason.slice(0, 240)
  }).catch(() => {});

  return {
    ok: true,
    schema: FREEZE_CONTROL_SCHEMA,
    frozen: true,
    reason: freezeState.reason,
    changedAt: now
  };
}

/**
 * Check if the system is currently frozen.
 * Also checks if any evidence has expired (auto-refreeze).
 */
export function isFrozen({ now = Date.now() } = {}) {
  if (freezeState.frozen) return true;

  /* Check if evidence has expired since unfreeze */
  const evidence = getStoredEvidence({ now });
  const readiness = aggregateOperationalReadiness({ evidence, now });
  if (!readiness.launchAllowed) {
    /* Auto-refreeze */
    refreeze({ operator: 'auto-evidence-expiry', reason: `Evidence expired: ${readiness.blockers.join(', ')}`.slice(0, 240), now });
    return true;
  }

  return false;
}

/**
 * Get freeze state for public reporting.
 */
export function freezeStateReport({ now = Date.now() } = {}) {
  const frozen = isFrozen({ now });
  return {
    schema: FREEZE_CONTROL_SCHEMA,
    frozen,
    reason: freezeState.reason,
    changedAt: freezeState.changedAt,
    changedBy: freezeState.changedBy,
    evidenceAtChange: freezeState.evidenceAtChange,
    launchAllowed: !frozen && aggregateOperationalReadiness({ evidence: getStoredEvidence({ now }), now }).launchAllowed
  };
}

/**
 * Handle POST /api/intents/v1/unfreeze
 */
export function handleUnfreeze(req, res) {
  const now = Date.now();
  const op1 = String(req.headers['x-operator-1'] || '').trim();
  const op2 = String(req.headers['x-operator-2'] || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!op1 || !op2 || !reason) {
    return res.status(400).json({
      schema: FREEZE_CONTROL_SCHEMA,
      ok: false,
      code: 'MISSING_PARAMETERS',
      detail: 'Requires X-Operator-1, X-Operator-2 headers and body.reason.'
    });
  }

  const evidence = getStoredEvidence({ now });
  const result = attemptUnfreeze({
    operators: [op1, op2],
    reason,
    evidence,
    now
  });

  if (!result.ok) {
    return res.status(403).json(result);
  }

  return res.json(result);
}

/**
 * Handle POST /api/intents/v1/freeze
 */
export function handleFreeze(req, res) {
  const now = Date.now();
  const operator = String(req.headers['x-operator-1'] || 'operator').trim();
  const reason = String(req.body?.reason || 'manual-freeze').trim();

  const result = refreeze({ operator, reason, now });
  return res.json(result);
}
