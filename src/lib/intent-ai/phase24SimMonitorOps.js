/**
 * FBT INTENT AI — Phase 24: simulator, monitor and scheduler operations.
 * Scheduler prepares only. Absence of a simulator is never a zero-risk quote.
 */
import { fail, finite, safeId, unavailable } from './phaseBoundary.js';

export const PHASE24_SCHEMA = 'fbt.sim-monitor-ops.v1';
const DIGEST = /^(?:0x)?[0-9a-f]{64}$/i;

export function operateSimulator({ result = null, now = Date.now() } = {}) {
  if (!result || result.timeout === true || result.available === false) return unavailable('SIMULATOR_TIMEOUT', null, { schema: PHASE24_SCHEMA, quote: false, zeroRisk: false });
  if (!safeId(result.providerId) || !DIGEST.test(String(result.requestDigest || '')) || !DIGEST.test(String(result.resultDigest || ''))) {
    return unavailable('SIMULATOR_DIGEST_REQUIRED');
  }
  if (finite(result.expiresAt) !== null && result.expiresAt <= now) return unavailable('SIMULATOR_EXPIRED');
  return { ok: true, schema: PHASE24_SCHEMA, quoteSuccess: false, zeroRisk: false, providerId: safeId(result.providerId), operational: false };
}

export function operateMonitor({ heartbeatAt = null, maxAgeMs = 60_000, now = Date.now() } = {}) {
  const beat = finite(heartbeatAt);
  if (beat === null || now - beat > Number(maxAgeMs)) return unavailable('MONITOR_STALE', null, { schema: PHASE24_SCHEMA });
  return { ok: true, schema: PHASE24_SCHEMA, stale: false, operational: false };
}

export function operateScheduler({ signs = false, submits = false, userAuthorization = false, guardianApproved = false, policyRechecked = false } = {}) {
  if (signs === true || submits === true) return fail('SCHEDULER_MUST_NOT_SIGN', null, { schema: PHASE24_SCHEMA, transactionCreated: false });
  if (userAuthorization !== true || guardianApproved !== true || policyRechecked !== true) {
    return fail('SCHEDULER_UNAUTHORIZED', null, { schema: PHASE24_SCHEMA, transactionCreated: false });
  }
  return { ok: true, schema: PHASE24_SCHEMA, preparationOnly: true, transactionCreated: false, operational: false };
}
