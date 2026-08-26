/* Phase 19 — threat model, privacy boundary, secret isolation and compliance. */
import {
  containsSecuritySecret,
  sanitizeSecurityPayload,
  validatePrivacyBoundary,
  createSecurityAuditEvent,
  buildThreatModel,
  independentReviewStatus,
  complianceChecklist,
  securityPosture,
  retentionPolicy
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  const secretPayload = { privateKey: '0x' + 'a'.repeat(64) };
  check('secret isolation detects private keys before serialization', containsSecuritySecret(secretPayload) && sanitizeSecurityPayload(secretPayload, { surface: 'log' }).logged === false);
  check('secret is blocked on every sensitive surface', ['log', 'memory', 'telemetry', 'ui', 'api', 'audit'].every((surface) => sanitizeSecurityPayload(secretPayload, { surface }).ok === false));
  const safe = validatePrivacyBoundary({ surface: 'api', payload: { event: 'policy-review', count: 1 } });
  check('safe minimized payload can cross the boundary without secrets', safe.ok && safe.secretIsolation && safe.dataMinimized && safe.payload.event === 'policy-review');
  const audit = createSecurityAuditEvent({ actor: 'user-19', action: 'review', reason: 'explicit', policyVersion: 'policy-19', timestamp: now, evidence: ['evidence-19'] });
  check('security audit events retain actor/reason/policy/time', audit.ok && audit.schema === 'fbt.security-audit-event.v1' && audit.secretIsolation);
  check('security audit event refuses secret material', createSecurityAuditEvent({ actor: 'user-19', action: 'review', reason: 'private key', policyVersion: 'policy-19', timestamp: now }).ok === false);

  const threat = buildThreatModel({ now });
  check('threat model covers external-agent and policy attacks', threat.ok && threat.threats.length >= 10 && threat.threats.some((row) => row.threat === 'external-agent-confusion') && threat.threats.some((row) => row.threat === 'policy-bypass'));
  const review = independentReviewStatus({ reviewerId: 'reviewer-19', evidence: [{ uri: 'https://evidence.example/review-19' }], signed: true, now });
  check('submitted review evidence is not falsely called verified', review.status === 'evidence-submitted-not-verified' && review.verified === false);
  const compliance = complianceChecklist({ evidence: { 'secret-isolation': true }, now });
  check('compliance checklist keeps critical gaps explicit', compliance.compliant === false && compliance.publicClaimAllowed === false && compliance.criticalBlockers.includes('independent-review'));
  const posture = securityPosture({ threatModel: threat, review: { reviewerId: null }, compliance: { evidence: {} } });
  check('security posture does not publish unsupported audit/privacy claims', posture.operational === false && posture.claims.secure === false && posture.claims.private === false && posture.claims.compliant === false);
  check('retention policy separates local memory, telemetry and expiring scopes', retentionPolicy.rawCredentials === 'never-accepted' && retentionPolicy.telemetry === 'opt-in-aggregate-only' && retentionPolicy.externalAgentData === 'scoped-and-expiring');
  check('security outputs contain no secret values', !/0x[a-f0-9]{64}|private.?key|seed.?phrase/i.test(JSON.stringify({ threat, review, compliance, posture })));

  console.log(JSON.stringify({ probe: 'phase19-security-compliance', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase19-security-compliance', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
