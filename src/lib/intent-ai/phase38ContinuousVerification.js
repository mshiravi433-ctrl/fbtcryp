/** Phase 38 — continuous verification. A last-green CI job is not continuous proof. */
import { finite, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE38_SCHEMA = 'fbt.continuous-verification.v1';

export function operateContinuousVerification({ probe = null, now = Date.now() } = {}) {
  if (!probe || probe.attested !== true || finite(probe.lastOkAt) === null) {
    return unavailable('CONTINUOUS_PROBE_MISSING', null, { schema: PHASE38_SCHEMA });
  }
  const maxAge = finite(probe.maxAgeMs) ?? 300_000;
  if (now - probe.lastOkAt > maxAge) return unavailable('CONTINUOUS_PROBE_STALE');
  if (probe.claimsLive === true) return unavailable('PROBE_MUST_NOT_CLAIM_LIVE');
  return { ok: true, schema: PHASE38_SCHEMA, current: true, operational: false, live: false };
}

export function evaluateContinuousVerificationPlane(input = {}) {
  const row = operateContinuousVerification(input);
  return opsPlane(38, PHASE38_SCHEMA, [row.code || 'CONTINUOUS_VERIFICATION_NOT_OPERATIONAL'], { probe: row });
}
