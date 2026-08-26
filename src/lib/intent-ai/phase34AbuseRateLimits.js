/** Phase 34 — abuse / rate-limit ops. A config number is not enforcement. */
import { fail, finite, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE34_SCHEMA = 'fbt.abuse-rate-limits.v1';

export function operateAbuseLimits({ limiter = null, enforcement = null } = {}) {
  if (!limiter || finite(limiter.perMinute) === null || limiter.perMinute <= 0) {
    return unavailable('RATE_LIMIT_UNDEFINED', null, { schema: PHASE34_SCHEMA });
  }
  if (!enforcement || enforcement.attested !== true || enforcement.active !== true) {
    return unavailable('RATE_LIMIT_NOT_ENFORCED');
  }
  if (enforcement.bypassable === true) return fail('RATE_LIMIT_MUST_NOT_BYPASS');
  return { ok: true, schema: PHASE34_SCHEMA, enforced: false, operational: false };
}

export function evaluateAbuseRateLimitPlane(input = {}) {
  const row = operateAbuseLimits(input);
  return opsPlane(34, PHASE34_SCHEMA, [row.code || 'ABUSE_LIMITS_NOT_OPERATIONAL'], { limits: row });
}
