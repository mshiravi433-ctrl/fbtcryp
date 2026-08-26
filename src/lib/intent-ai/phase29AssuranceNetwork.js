/**
 * FBT INTENT AI — Phase 29: independent assurance network.
 * An internal checklist is never an independent certification.
 */
import { safeId, unavailable } from './phaseBoundary.js';

export const PHASE29_SCHEMA = 'fbt.assurance-network.v1';
export const THREATS = Object.freeze([
  'prompt-injection', 'external-agent-abuse', 'capability-escalation', 'credential-exfiltration',
  'replay', 'guardian-policy-bypass', 'provider-compromise', 'receipt-forgery',
  'privacy-reidentification', 'outage-recovery'
]);

export function operateAssurance({ review = null, privacy = null, compliance = null } = {}) {
  if (!review || review.independent !== true || review.signed !== true || !safeId(review.reviewerId)) {
    return unavailable('SECURITY_REVIEW_NOT_INDEPENDENT', null, { schema: PHASE29_SCHEMA, verified: false, claims: { secure: false, private: false, compliant: false, audited: false } });
  }
  const covered = Array.isArray(review.threats) ? review.threats : [];
  const missing = THREATS.filter((item) => !covered.includes(item));
  if (missing.length) return unavailable('THREAT_MODEL_INCOMPLETE', missing.join(','));
  if (privacy?.reviewed !== true) return unavailable('PRIVACY_REVIEW_REQUIRED');
  if (compliance?.internalChecklist === true && compliance?.independent !== true) {
    return unavailable('INTERNAL_CHECKLIST_IS_NOT_CERTIFICATION');
  }
  return {
    ok: true,
    schema: PHASE29_SCHEMA,
    reviewerId: safeId(review.reviewerId),
    verified: false,
    operational: false,
    claims: { secure: false, private: false, compliant: false, audited: false }
  };
}
