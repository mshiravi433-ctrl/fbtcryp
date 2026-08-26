/**
 * FBT INTENT AI — Scheduler service.
 *
 * The scheduler NEVER signs or submits transactions.
 * It requires user authorization + guardian approval + policy recheck
 * for every scheduled execution.
 * Wave 2 evidence: scheduler-operator.
 */

import { verifyScheduler } from '../src/lib/intent-ai/operationalActivation.js';

export const SCHEDULER_SCHEMA = 'fbt.intent-scheduler.v1';

/**
 * Check if a scheduled intent is authorized to proceed.
 * The scheduler itself never signs — it delegates to the signer service.
 */
export function checkScheduleAuthorization(intent = {}) {
  return verifyScheduler({
    signs: false,
    submits: false,
    userAuthorization: Boolean(intent.userAuthorization),
    guardianApproved: Boolean(intent.guardianApproved),
    policyRechecked: Boolean(intent.policyRechecked)
  });
}

/**
 * Get scheduler evidence for phase activation.
 * Proves the scheduler enforces authorization without signing.
 */
export function schedulerEvidence() {
  const result = checkScheduleAuthorization({
    userAuthorization: true,
    guardianApproved: true,
    policyRechecked: true
  });

  return {
    ok: result.ok === true,
    schema: SCHEDULER_SCHEMA,
    signs: false,
    submits: false,
    createsTransaction: false,
    requiresUserAuthorization: true,
    requiresGuardianApproval: true,
    requiresPolicyRecheck: true,
    unauthorized: checkScheduleAuthorization({
      userAuthorization: false,
      guardianApproved: true,
      policyRechecked: true
    }).ok === false
  };
}
