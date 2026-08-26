/** Phase 49 — regulatory reporting. An internal memo is not a filing. */
import { unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE49_SCHEMA = 'fbt.regulatory-reporting.v1';

export function operateRegulatoryReporting({ filing = null, counsel = null } = {}) {
  if (!filing || filing.submitted !== true || filing.attested !== true) {
    return unavailable('REGULATORY_FILING_MISSING', null, { schema: PHASE49_SCHEMA });
  }
  if (!counsel || counsel.independent !== true) return unavailable('INDEPENDENT_COUNSEL_REQUIRED');
  if (filing.containsSecrets === true) return unavailable('FILING_MUST_NOT_CONTAIN_SECRETS');
  return { ok: true, schema: PHASE49_SCHEMA, operational: false, compliantClaim: false };
}

export function evaluateRegulatoryReportingPlane(input = {}) {
  const row = operateRegulatoryReporting(input);
  return opsPlane(49, PHASE49_SCHEMA, [row.code || 'REGULATORY_REPORTING_NOT_OPERATIONAL'], { reporting: row });
}
