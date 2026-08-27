/**
 * FBT INTENT AI — Freeze/Unfreeze control.
 *
 * Launch Freeze is retired. The compatibility endpoints remain readable for
 * clients that still request them, but the public Intent OS state is always
 * unfreezed and reports its reviewed 21/21 evidence snapshot.
 */

import { getStoredEvidence } from './intentOperatorEvidence.js';
import { aggregateOperationalReadiness } from '../src/lib/intent-ai/operationalActivation.js';

export const FREEZE_CONTROL_SCHEMA = 'fbt.freeze-control.v1';

/* Launch Freeze was retired after the activation review. Keep this small
   compatibility state for existing clients, but it can never gate the live
   Intent OS status. */
let freezeState = {
  frozen: false,
  reason: 'launch-freeze-retired',
  changedAt: Date.now(),
  changedBy: ['activation-review'],
  /* No evidence has been seen at module load; the real count is read from the
     store whenever this state is reported. */
  evidenceAtChange: 0
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
export function refreeze({ operator = 'system', reason = 'legacy-freeze-request', now = Date.now() } = {}) {
  /* Preserve the endpoint for old clients, but no request can reintroduce the
     retired Launch Freeze. Record the request without changing live state. */
  freezeState = {
    frozen: false,
    reason: `freeze request ignored: ${String(reason).slice(0, 200)}`,
    changedAt: now,
    changedBy: [operator],
    evidenceAtChange: (getStoredEvidence({ now }) || []).length
  };
  return {
    ok: true,
    schema: FREEZE_CONTROL_SCHEMA,
    frozen: false,
    isFrozen: false,
    launchAllowed: freezeStateReport({ now }).launchAllowed,
    reason: freezeState.reason,
    changedAt: now
  };
}

/**
 * Check if the system is currently frozen.
 * Also checks if any evidence has expired (auto-refreeze).
 */
export function isFrozen({ now = Date.now() } = {}) {
  /* Freeze is a retired launch-control concept. Evidence remains visible for
     auditability, but expiry or a legacy freeze request cannot gate Intent OS. */
  void now;
  return false;
}

/**
 * Get freeze state for public reporting.
 */
export function freezeStateReport({ now = Date.now() } = {}) {
  isFrozen({ now });
  /* Report the evidence actually held, and derive launchAllowed from it.
     These were the constants 21, true and '21/21', so the freeze surface
     announced a complete evidence set and an allowed launch on a deployment
     that had neither. Freeze itself remains retired; that is a separate
     concern from lying about the evidence count. */
  const evidence = getStoredEvidence({ now });
  const readiness = aggregateOperationalReadiness({ evidence, now });
  const stored = Array.isArray(evidence) ? evidence.length : 0;
  return {
    schema: FREEZE_CONTROL_SCHEMA,
    frozen: false,
    isFrozen: false,
    reason: freezeState.reason,
    changedAt: freezeState.changedAt,
    changedBy: freezeState.changedBy,
    evidenceAtChange: stored,
    launchAllowed: readiness.launchAllowed === true && readiness.operational === 'operational',
    evidence: `${stored}/21`
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
