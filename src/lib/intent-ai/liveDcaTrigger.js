/**
 * FBT INTENT AI — PHASE 57: LIVE DCA TRIGGER
 * ---------------------------------------------------------------------------
 * A schedule is not an execution. Phase 13 gave recurring intents an honest
 * lifecycle; this module gives them a real trigger, under three hard rules:
 *
 *   1. Every periodic run needs a PRIOR, EXPLICIT authorization from the user
 *      that names the program and bounds it (run count + per-run amount).
 *      No authorization → the tick prepares nothing.
 *   2. Every run is re-checked against the session policy at trigger time —
 *      not against the policy that existed when the program was created.
 *   3. The FIRST violation halts the WHOLE program (not just that run) and
 *      raises a user notice. There is no "skip and continue".
 *
 * The clock is injected (`now`) and the trigger is a pure function of state,
 * so a probe can run a whole schedule deterministically.
 */

import { classifyFailure } from './failureModes.js';
import { checkSessionPolicy } from './executionErrorTaxonomy.js';
import { createRecurringIntent, prepareRecurringRun } from './liveRecurringIntents.js';

export const LIVE_DCA_SCHEMA = 'fbt.live-dca-program.v1';
export const DCA_HALT_REASONS = Object.freeze([
  'POLICY_VIOLATION',
  'AUTHORIZATION_MISSING',
  'AUTHORIZATION_EXPIRED',
  'RUNS_EXHAUSTED',
  'CONTROL_ACTIVE',
  'USER_STOPPED'
]);

/**
 * A DCA authorization is explicit, bounded and given BEFORE any run.
 * @param {object} authorization { programId, confirmed, maxRuns, maxAmountUsdPerRun, expiresAt, termsHash }
 */
export function assertDcaAuthorization(authorization, { programId, amountUsd, runNumber, now = Date.now() } = {}) {
  if (!authorization || typeof authorization !== 'object' || authorization.confirmed !== true) {
    return { ok: false, halt: 'AUTHORIZATION_MISSING', error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'DCA_AUTHORIZATION_REQUIRED' }) };
  }
  if (programId && authorization.programId && authorization.programId !== programId) {
    return { ok: false, halt: 'AUTHORIZATION_MISSING', error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'DCA_AUTHORIZATION_MISMATCH' }) };
  }
  if (Number.isFinite(Number(authorization.expiresAt)) && now > Number(authorization.expiresAt)) {
    return { ok: false, halt: 'AUTHORIZATION_EXPIRED', error: classifyFailure('SESSION_KEY_EXPIRED', { detail: 'DCA_AUTHORIZATION_EXPIRED' }) };
  }
  if (Number.isFinite(Number(authorization.maxRuns)) && Number(runNumber) > Number(authorization.maxRuns)) {
    return { ok: false, halt: 'RUNS_EXHAUSTED', error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'DCA_RUNS_EXHAUSTED' }) };
  }
  if (Number.isFinite(Number(authorization.maxAmountUsdPerRun))
      && Number.isFinite(Number(amountUsd))
      && Number(amountUsd) > Number(authorization.maxAmountUsdPerRun)) {
    return { ok: false, halt: 'POLICY_VIOLATION', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'DCA_RUN_AMOUNT_ABOVE_AUTHORIZATION' }) };
  }
  return { ok: true };
}

/**
 * Arm a DCA program: a Phase-13 recurring intent plus the prior authorization
 * that every run of it must satisfy.
 */
export function armLiveDcaProgram({
  id,
  intent = {},
  schedule = {},
  authorization = null,
  maxRuns = null,
  expiresAt = null,
  now = Date.now()
} = {}) {
  const recurring = createRecurringIntent({ id, intent, schedule, expiresAt, maxRuns, now });
  if (!recurring.ok) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: recurring.code || 'RECURRING_INVALID' }), detail: recurring };
  const auth = assertDcaAuthorization(authorization, {
    programId: recurring.recurring.id,
    amountUsd: intent.amountUsd,
    runNumber: 1,
    now
  });
  if (!auth.ok) return { ok: false, error: auth.error, halt: auth.halt };
  return {
    ok: true,
    program: {
      schema: LIVE_DCA_SCHEMA,
      id: recurring.recurring.id,
      recurring: recurring.recurring,
      authorization: {
        confirmed: true,
        programId: recurring.recurring.id,
        maxRuns: Number.isFinite(Number(authorization.maxRuns)) ? Number(authorization.maxRuns) : null,
        maxAmountUsdPerRun: Number.isFinite(Number(authorization.maxAmountUsdPerRun)) ? Number(authorization.maxAmountUsdPerRun) : null,
        expiresAt: Number.isFinite(Number(authorization.expiresAt)) ? Number(authorization.expiresAt) : null,
        termsHash: typeof authorization.termsHash === 'string' ? authorization.termsHash.slice(0, 96) : null
      },
      halted: false,
      haltReason: null,
      completedRuns: 0,
      notices: [],
      armedAt: now,
      executionAuthorized: false
    }
  };
}

/**
 * One real trigger tick.
 * @returns {Promise<{ok:boolean, due:boolean, program:object, run?:object,
 *                    halted?:boolean, notice?:object, error?:object}>}
 */
export async function tickLiveDca(program, {
  now = Date.now(),
  policy = null,
  controls = {},
  policyCheck = null
} = {}) {
  if (!program || program.schema !== LIVE_DCA_SCHEMA) {
    return { ok: false, due: false, program, error: classifyFailure('MISSING_DATA', { detail: 'NO_DCA_PROGRAM' }) };
  }
  if (program.halted) {
    return { ok: false, due: false, halted: true, program, error: classifyFailure('EMERGENCY_STOP', { detail: `DCA_HALTED:${program.haltReason}` }) };
  }
  const controlActive = ['stop', 'stopped', 'pause', 'paused', 'revoke', 'revoked', 'disconnect', 'disconnected', 'emergency', 'emergency_exit']
    .some((key) => controls?.[key] === true);
  if (controlActive) return haltProgram(program, 'CONTROL_ACTIVE', now, classifyFailure('EMERGENCY_STOP', { detail: 'DCA_CONTROL_ACTIVE' }));

  const recurring = program.recurring;
  if (!Number.isFinite(Number(recurring?.nextRunAt)) || now < Number(recurring.nextRunAt)) {
    return { ok: true, due: false, program };
  }
  const runNumber = Number(program.completedRuns) + 1;
  const amountUsd = Number(recurring?.template?.intent?.amountUsd ?? recurring?.template?.amountUsd ?? null);

  // Rule 1 — prior explicit authorization, per run.
  const auth = assertDcaAuthorization(program.authorization, {
    programId: program.id,
    amountUsd,
    runNumber,
    now
  });
  if (!auth.ok) return haltProgram(program, auth.halt, now, auth.error);

  // Rule 2 — the session policy is re-checked AT TRIGGER TIME.
  const policyResult = checkSessionPolicy(
    {
      amountUsd,
      chainId: recurring?.template?.intent?.chainId ?? recurring?.template?.chainId ?? null,
      protocol: recurring?.template?.intent?.protocol ?? recurring?.template?.protocol ?? null
    },
    policy,
    { now }
  );
  if (!policyResult.ok) {
    // Rule 3 — the FIRST violation halts the whole program.
    return haltProgram(
      program,
      'POLICY_VIOLATION',
      now,
      classifyFailure('GUARDIAN_REJECTED', { detail: JSON.stringify({ reasons: policyResult.violations.map((v) => v.code) }) }),
      policyResult.violations
    );
  }

  const prepared = await prepareRecurringRun(recurring, {
    now,
    policyCheck,
    userAuthorized: true,
    controls,
    runId: `${program.id}-run-${runNumber}`
  });
  if (!prepared.ok) {
    return haltProgram(program, 'POLICY_VIOLATION', now, classifyFailure('GUARDIAN_REJECTED', { detail: prepared.code || 'RECURRING_RUN_BLOCKED' }));
  }
  return {
    ok: true,
    due: true,
    run: { ...prepared.run, executionAuthorized: false, requiresConfirmationGate: true },
    program: {
      ...program,
      recurring: prepared.nextRecurring,
      completedRuns: runNumber
    }
  };
}

/** Explicit user stop — same halt path, no special case. */
export function stopLiveDca(program, { now = Date.now(), reason = 'USER_STOPPED' } = {}) {
  return haltProgram(program, reason, now, classifyFailure('USER_CANCELLED', { detail: 'DCA_USER_STOPPED' })).program;
}

function haltProgram(program, haltReason, now, error, violations = []) {
  const reason = DCA_HALT_REASONS.includes(haltReason) ? haltReason : 'POLICY_VIOLATION';
  const notice = {
    schema: 'fbt.dca-notice.v1',
    programId: program.id,
    haltReason: reason,
    at: now,
    // The user is told, in their own language, by key — never a raw dump.
    i18nKey: `intentAI.dca.halt.${reason}`,
    violations: violations.map((v) => ({ code: v.code, i18nKey: v.i18nKey, params: v.params }))
  };
  return {
    ok: false,
    due: false,
    halted: true,
    notice,
    error,
    program: {
      ...program,
      halted: true,
      haltReason: reason,
      haltedAt: now,
      recurring: { ...program.recurring, active: false },
      notices: [...(program.notices || []), notice].slice(-20)
    }
  };
}
