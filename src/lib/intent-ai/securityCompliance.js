/**
 * FBT INTENT AI — Phase 19: security, privacy and compliance boundaries.
 *
 * This is a review and data-boundary contract, not an audit certificate. It
 * rejects raw credentials before logging/telemetry/UI/API serialization,
 * describes a threat model, and keeps compliance/independent-review status
 * explicitly incomplete until external evidence is supplied.
 */

import {
  containsRawSecret,
  fail,
  finite,
  noExecutionPermission,
  safeId,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const SECURITY_COMPLIANCE_SCHEMA = 'fbt.security-privacy-compliance.v1';
export const THREAT_MODEL_SCHEMA = 'fbt.intent-threat-model.v1';
export const PRIVACY_BOUNDARY_SCHEMA = 'fbt.intent-privacy-boundary.v1';
export const SECURITY_EVENT_SCHEMA = 'fbt.security-audit-event.v1';
export const COMPLIANCE_SCHEMA = 'fbt.compliance-checklist.v1';
export const INDEPENDENT_REVIEW_SCHEMA = 'fbt.independent-security-review.v1';

export const THREAT_CATEGORIES = Object.freeze([
  'prompt-injection',
  'external-agent-confusion',
  'scope-escalation',
  'credential-exfiltration',
  'replay',
  'policy-bypass',
  'provider-compromise',
  'privacy-reidentification',
  'receipt-forgery',
  'availability-outage'
]);

const SECRET_KEY = /seed|mnemonic|private.?key|master.?password|master.?credential|raw.?secret|credential|api.?secret|signer|secret/i;
const SECRET_TEXT = /seed phrase|recovery phrase|mnemonic|private key|master password|master credential|raw secret/i;
const SAFE_SURFACES = new Set(['log', 'memory', 'telemetry', 'ui', 'api', 'audit']);
const CHECKS = Object.freeze([
  'secret-isolation',
  'external-agent-boundary',
  'policy-enforcement',
  'guardian-non-bypass',
  'privacy-retention',
  'audit-integrity',
  'abuse-rate-limits',
  'incident-response',
  'independent-review'
]);

/** Return true without ever returning the input material. */
export function containsSecuritySecret(value, seen = new Set(), key = '', depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === 'string') return SECRET_KEY.test(key) || SECRET_TEXT.test(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([childKey, child]) => SECRET_KEY.test(childKey) || containsSecuritySecret(child, seen, childKey, depth + 1));
}

/**
 * Refuse unsafe material rather than attempting a lossy "sanitization" that
 * could leave a key fragment in a log line. Safe values are bounded copies.
 */
export function sanitizeSecurityPayload(payload = {}, { surface = 'log' } = {}) {
  if (!SAFE_SURFACES.has(surface)) return fail('SURFACE_NOT_ALLOWED');
  if (containsSecuritySecret(payload)) return { ok: false, schema: PRIVACY_BOUNDARY_SCHEMA, code: 'SECRET_BLOCKED', surface, persisted: false, logged: false, uploaded: false };
  const copy = (value, depth = 0) => {
    if (depth > 6) return '[TRUNCATED]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, 240);
    if (Array.isArray(value)) return value.slice(0, 32).map((item) => copy(item, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [key, copy(item, depth + 1)]));
    return String(value).slice(0, 80);
  };
  return { ok: true, schema: PRIVACY_BOUNDARY_SCHEMA, surface, payload: copy(payload), persisted: false, logged: false, uploaded: false, secretsPresent: false };
}

export function validatePrivacyBoundary({ surface, payload } = {}) {
  const result = sanitizeSecurityPayload(payload, { surface });
  if (!result.ok) return result;
  return { ok: true, schema: PRIVACY_BOUNDARY_SCHEMA, surface, allowed: true, secretIsolation: true, dataMinimized: true, retention: 'bounded-and-user-clearable', payload: result.payload };
}

export function createSecurityAuditEvent({ actor, action, reason, policyVersion, timestamp = Date.now(), evidence = [] } = {}) {
  if (containsSecuritySecret({ actor, action, reason, policyVersion, evidence })) return fail('SECRET_BLOCKED');
  if (!safeId(actor) || !safeString(action, 96) || !safeString(reason, 180) || !safeString(policyVersion, 64) || finite(timestamp) === null) return fail('SECURITY_EVENT_FIELDS_REQUIRED');
  return {
    ok: true,
    schema: SECURITY_EVENT_SCHEMA,
    actor: safeId(actor),
    action: safeString(action, 96),
    reason: safeString(reason, 180),
    policyVersion: safeString(policyVersion, 64),
    timestamp: finite(timestamp),
    evidence: Array.isArray(evidence) ? evidence.slice(0, 8).map((item) => safeString(String(item), 120)).filter(Boolean) : [],
    secretIsolation: true
  };
}

export function buildThreatModel({ evidence = [], now = Date.now() } = {}) {
  const rows = THREAT_CATEGORIES.map((threat) => ({
    threat,
    controls: threat === 'credential-exfiltration'
      ? ['raw-credential-rejection', 'server-only-secret-boundary']
      : threat === 'policy-bypass'
        ? ['guardian', 'all-limits', 'on-chain-policy']
        : threat === 'external-agent-confusion'
          ? ['scoped-handle', 'capability-negotiation', 'expiry']
          : ['bounded-input', 'audit-event', 'fail-closed-recovery'],
    evidence: [],
    status: 'implemented-contract-not-independently-reviewed'
  }));
  return {
    ok: true,
    schema: THREAT_MODEL_SCHEMA,
    version: '1',
    threats: rows,
    generatedAt: now,
    independentReview: false,
    claims: { penetrationTested: false, audited: false, compliant: false },
    evidenceCount: Array.isArray(evidence) ? evidence.length : 0
  };
}

export function independentReviewStatus({ reviewerId = null, evidence = [], signed = false, now = Date.now() } = {}) {
  const id = safeId(reviewerId);
  const usableEvidence = Array.isArray(evidence) && evidence.some((item) => item && (item.uri || item.sha256));
  if (!id || !usableEvidence || signed !== true) return { schema: INDEPENDENT_REVIEW_SCHEMA, status: 'not-verified', verified: false, reviewerId: null, evidenceCount: usableEvidence ? evidence.length : 0, checkedAt: now, blocker: 'INDEPENDENT_REVIEW_EVIDENCE_REQUIRED' };
  return { schema: INDEPENDENT_REVIEW_SCHEMA, status: 'evidence-submitted-not-verified', verified: false, reviewerId: id, evidenceCount: evidence.length, checkedAt: now, blocker: 'INDEPENDENT_REVIEW_ATTESTATION_REQUIRED' };
}

export function complianceChecklist({ evidence = {}, now = Date.now() } = {}) {
  const rows = CHECKS.map((id) => ({ id, status: evidence[id] === true ? 'evidence-submitted' : 'not-verified', evidence: evidence[id] === true }));
  const critical = rows.filter((row) => !row.evidence).map((row) => row.id);
  return {
    schema: COMPLIANCE_SCHEMA,
    generatedAt: now,
    checks: rows,
    criticalBlockers: critical,
    compliant: false,
    independentlyReviewed: false,
    publicClaimAllowed: false,
    note: 'Implementation evidence is not an independent compliance or security certification.'
  };
}

export function securityPosture({ review = {}, compliance = {}, threatModel = null } = {}) {
  const reviewStatus = independentReviewStatus(review);
  const checklist = complianceChecklist(compliance);
  return {
    schema: SECURITY_COMPLIANCE_SCHEMA,
    implementation: threatModel ? 'implemented-contracts' : 'partial',
    configured: false,
    operational: false,
    status: 'unavailable',
    secretIsolation: true,
    rawCredentialsAllowed: false,
    externalAgentAttackModel: true,
    criticalBlockers: [...new Set([...checklist.criticalBlockers, ...(reviewStatus.verified ? [] : [reviewStatus.blocker])])],
    independentReview: reviewStatus,
    compliance: checklist,
    claims: { secure: false, private: false, compliant: false, audited: false }
  };
}

export function securityBoundaryForApi(payload) {
  const checked = validatePrivacyBoundary({ surface: 'api', payload });
  return checked.ok ? noExecutionPermission({ ...checked, rawCredentialAllowed: false }) : checked;
}

export const retentionPolicy = Object.freeze({
  schema: 'fbt.data-retention-policy.v1',
  localMemory: 'user-clearable-bounded',
  telemetry: 'opt-in-aggregate-only',
  rawCredentials: 'never-accepted',
  receipts: 'content-addressed-and-not-rewritable',
  externalAgentData: 'scoped-and-expiring'
});
