/** Phase 44 — workforce / SSO access. A named account is not least privilege. */
import { fail, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE44_SCHEMA = 'fbt.workforce-access.v1';

export function operateWorkforceAccess({ sso = null, role = null } = {}) {
  if (!sso || sso.attested !== true || sso.mfa !== true) return unavailable('WORKFORCE_SSO_UNATTESTED', null, { schema: PHASE44_SCHEMA });
  if (!role || role.leastPrivilege !== true) return unavailable('LEAST_PRIVILEGE_NOT_PROVEN');
  if (role.unrestrictedSigner === true) return fail('WORKFORCE_MUST_NOT_HOLD_UNRESTRICTED_SIGNER');
  return { ok: true, schema: PHASE44_SCHEMA, operational: false, rawCredentialsAllowed: false };
}

export function evaluateWorkforceAccessPlane(input = {}) {
  const row = operateWorkforceAccess(input);
  return opsPlane(44, PHASE44_SCHEMA, [row.code || 'WORKFORCE_ACCESS_NOT_OPERATIONAL'], { access: row });
}
