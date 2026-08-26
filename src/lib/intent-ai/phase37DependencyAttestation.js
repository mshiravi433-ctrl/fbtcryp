/** Phase 37 — third-party dependency attestation. A package lock is not an SBOM proof. */
import { unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE37_SCHEMA = 'fbt.dependency-attestation.v1';

export function operateDependencyAttestation({ sbom = null, suppliers = [] } = {}) {
  if (!sbom || sbom.attested !== true || !sbom.digest) {
    return unavailable('SBOM_ATTESTATION_MISSING', null, { schema: PHASE37_SCHEMA });
  }
  const rows = Array.isArray(suppliers) ? suppliers : [];
  if (!rows.length || rows.some((row) => row.attested !== true)) {
    return unavailable('SUPPLIER_ATTESTATION_INCOMPLETE');
  }
  return { ok: true, schema: PHASE37_SCHEMA, operational: false, verified: false };
}

export function evaluateDependencyAttestationPlane(input = {}) {
  const row = operateDependencyAttestation(input);
  return opsPlane(37, PHASE37_SCHEMA, [row.code || 'DEPENDENCY_NOT_OPERATIONAL'], { deps: row });
}
