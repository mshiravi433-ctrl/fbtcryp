/** Phase 36 — data residency and legal hold. A policy PDF is not enforcement. */
import { fail, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE36_SCHEMA = 'fbt.residency-legal-hold.v1';

export function operateResidencyHold({ residency = null, hold = null } = {}) {
  if (!residency || residency.enforced !== true || residency.attested !== true) {
    return unavailable('RESIDENCY_NOT_ENFORCED', null, { schema: PHASE36_SCHEMA });
  }
  if (hold?.active === true && hold?.exportBlocked !== true) {
    return fail('LEGAL_HOLD_EXPORT_NOT_BLOCKED');
  }
  if (residency.allowsRawSecrets === true) return fail('RAW_CREDENTIAL_FORBIDDEN');
  return { ok: true, schema: PHASE36_SCHEMA, operational: false, exportAllowed: false };
}

export function evaluateResidencyHoldPlane(input = {}) {
  const row = operateResidencyHold(input);
  return opsPlane(36, PHASE36_SCHEMA, [row.code || 'RESIDENCY_NOT_OPERATIONAL'], { residency: row });
}
