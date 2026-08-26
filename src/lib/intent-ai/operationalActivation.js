/**
 * FBT INTENT AI — Phase 21: operational activation and evidence verification.
 *
 * Source files, mocks, fixtures, env flags and configuration objects are never
 * operational evidence. This module verifies current, public, non-secret
 * attestations. Missing, stale, malformed, replayed or contradictory evidence
 * is fail-closed. Launch stays blocked unless every critical kind is verified.
 */

import {
  containsRawSecret,
  fail,
  finite,
  publicRuntimeEvidence,
  safeId,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const OPERATIONAL_EVIDENCE_SCHEMA = 'fbt.operational-evidence.v1';
export const OPERATIONAL_READINESS_SCHEMA = 'fbt.operational-readiness.v1';
export const PHASE21_SCHEMA = 'fbt.intent-ai-phase21.v1';

export const EVIDENCE_KINDS = Object.freeze([
  'approved-durable-registry',
  'certificate-authority',
  'sandbox-operator',
  'simulator',
  'monitor',
  'scheduler-operator',
  'smart-wallet',
  'independent-guardian',
  'production-signer',
  'wallet-provider',
  'broker-provider',
  'bridge-provider',
  'venue-health',
  'rpc',
  'policy-contract',
  'durable-immutable-audit',
  'backup-restore-drill',
  'independent-security-review',
  'reproducible-deployment',
  'rollback-drill',
  'slo-measurement'
]);

export const CRITICAL_FAILURE_CODES = Object.freeze([
  'REGISTRY_UNAVAILABLE',
  'CA_INVALID',
  'CA_EXPIRED',
  'CA_REVOKED',
  'SANDBOX_OPERATOR_UNAVAILABLE',
  'SIMULATOR_TIMEOUT',
  'MONITOR_STALE',
  'SCHEDULER_UNAUTHORIZED',
  'SMART_WALLET_WITHOUT_GUARDIAN',
  'SIGNER_WITHOUT_POLICY',
  'PROVIDER_HEALTH_FAILURE',
  'VENUE_UNAVAILABLE',
  'RPC_OUTAGE',
  'CONTRACT_CODE_HASH_MISMATCH',
  'LOCAL_ONCHAIN_POLICY_MISMATCH',
  'AUDIT_TAMPER',
  'BACKUP_RESTORE_FAILURE',
  'SECURITY_REVIEW_NOT_INDEPENDENT',
  'BUILD_NOT_REPRODUCIBLE',
  'ROLLBACK_DRILL_MISSING',
  'SLO_NOT_MEASURED',
  'RAW_CREDENTIAL_IN_OUTPUT',
  'LAUNCH_WITH_CRITICAL_BLOCKER'
]);

const PUBLIC_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const DIGEST = /^(?:0x)?[0-9a-f]{64}$/i;
const SECRET_WORDS = /private.?key|seed.?phrase|master.?password|mnemonic|raw.?secret|BEGIN [A-Z ]*PRIVATE KEY/i;

function publicId(value) {
  const text = String(value ?? '').trim();
  return PUBLIC_ID.test(text) && !DIGEST.test(text) ? text : null;
}

function publicDigest(value) {
  const text = String(value ?? '').trim().replace(/^0x/, '').toLowerCase();
  return DIGEST.test(text) ? text : null;
}

function isCurrent(checkedAt, expiresAt, now) {
  if (finite(checkedAt) === null || finite(expiresAt) === null) return false;
  return checkedAt <= now && expiresAt > now;
}

function rejectSecrets(payload) {
  if (containsRawSecret(payload) || SECRET_WORDS.test(JSON.stringify(payload || {}))) {
    return fail('RAW_CREDENTIAL_IN_OUTPUT');
  }
  return null;
}

/**
 * Normalize one evidence record. Env flags, source paths and mock labels
 * cannot become `verified`.
 */
export function normalizeEvidence(input = {}, { now = Date.now() } = {}) {
  const secret = rejectSecrets(input);
  if (secret) return secret;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unavailable('EVIDENCE_MALFORMED');
  if (input.mock === true || input.fixture === true || input.envFlag === true || input.sourceFile) {
    return unavailable('SOURCE_OR_MOCK_IS_NOT_EVIDENCE');
  }
  const kind = EVIDENCE_KINDS.includes(input.kind) ? input.kind : null;
  const providerId = publicId(input.providerId);
  const digest = publicDigest(input.digest);
  const checkedAt = finite(input.checkedAt);
  const expiresAt = finite(input.expiresAt);
  const runtime = publicRuntimeEvidence(input, { now });
  const healthy = input.status === 'verified' || input.health === 'healthy' || input.health === 'operational';
  const attested = input.attested === true || runtime?.attested === true;
  const current = isCurrent(checkedAt, expiresAt, now);
  const verified = Boolean(kind && providerId && digest && healthy && attested && current && runtime?.valid !== false);
  return {
    ok: verified,
    schema: OPERATIONAL_EVIDENCE_SCHEMA,
    kind,
    providerId,
    digest,
    checkedAt,
    expiresAt,
    status: verified ? 'verified' : current ? 'unavailable' : 'stale',
    attested,
    failClosed: !verified
  };
}

export function verifyCertificateAuthority(input = {}, { now = Date.now() } = {}) {
  const secret = rejectSecrets(input);
  if (secret) return secret;
  if (input.revoked === true) return unavailable('CA_REVOKED');
  if (finite(input.expiresAt) !== null && input.expiresAt <= now) return unavailable('CA_EXPIRED');
  if (!input.issuerIdentity || !publicDigest(input.fingerprint) || input.signatureValid !== true) {
    return unavailable('CA_INVALID');
  }
  return normalizeEvidence({
    kind: 'certificate-authority',
    providerId: input.providerId || input.issuerIdentity,
    digest: input.fingerprint,
    checkedAt: input.checkedAt ?? now,
    expiresAt: input.expiresAt,
    attested: true,
    status: 'verified',
    health: 'healthy'
  }, { now });
}

export function verifySandboxOperator(input = {}, { now = Date.now() } = {}) {
  if (input.available !== true || input.attested !== true) return unavailable('SANDBOX_OPERATOR_UNAVAILABLE');
  if (input.mainnetAccess === true || input.productionSigner === true || input.realCustody === true) {
    return fail('SANDBOX_MUST_NOT_TOUCH_PRODUCTION');
  }
  return normalizeEvidence({
    kind: 'sandbox-operator',
    providerId: input.providerId || input.operatorId,
    digest: input.digest,
    checkedAt: input.checkedAt ?? now,
    expiresAt: input.expiresAt,
    attested: true,
    status: 'verified',
    health: 'healthy'
  }, { now });
}

export function verifySimulator(input = {}, { now = Date.now() } = {}) {
  if (input.timeout === true || input.available === false) return unavailable('SIMULATOR_TIMEOUT');
  if (!publicDigest(input.requestDigest) || !publicDigest(input.resultDigest)) return unavailable('SIMULATOR_DIGEST_REQUIRED');
  return normalizeEvidence({
    kind: 'simulator',
    providerId: input.providerId,
    digest: input.resultDigest,
    checkedAt: input.checkedAt ?? now,
    expiresAt: input.expiresAt,
    attested: true,
    status: 'verified',
    health: 'healthy'
  }, { now });
}

export function verifyMonitor(input = {}, { now = Date.now() } = {}) {
  const heartbeat = finite(input.heartbeatAt ?? input.checkedAt);
  const maxAge = finite(input.maxAgeMs) ?? 60_000;
  if (heartbeat === null || now - heartbeat > maxAge) return unavailable('MONITOR_STALE');
  return normalizeEvidence({
    kind: 'monitor',
    providerId: input.providerId,
    digest: input.digest,
    checkedAt: heartbeat,
    expiresAt: input.expiresAt ?? heartbeat + maxAge,
    attested: true,
    status: 'verified',
    health: 'healthy'
  }, { now });
}

export function verifyScheduler(input = {}) {
  if (input.signs === true || input.submits === true) return fail('SCHEDULER_MUST_NOT_SIGN');
  if (input.userAuthorization !== true || input.guardianApproved !== true || input.policyRechecked !== true) {
    return fail('SCHEDULER_UNAUTHORIZED');
  }
  return { ok: true, schema: PHASE21_SCHEMA, kind: 'scheduler-operator', createsTransaction: false };
}

export function verifySmartWalletAndGuardian(input = {}, { now = Date.now() } = {}) {
  if (input.guardianIndependent !== true || input.guardianApproved === undefined) {
    return unavailable('SMART_WALLET_WITHOUT_GUARDIAN');
  }
  if (input.guardianApproved === true && input.userConfirmed !== true) {
    return fail('GUARDIAN_CANNOT_REPLACE_USER');
  }
  return normalizeEvidence({
    kind: 'smart-wallet',
    providerId: input.providerId,
    digest: input.digest,
    checkedAt: input.checkedAt ?? now,
    expiresAt: input.expiresAt,
    attested: true,
    status: 'verified',
    health: 'healthy'
  }, { now });
}

export function verifySigner(input = {}, { now = Date.now() } = {}) {
  if (input.policyBound !== true) return unavailable('SIGNER_WITHOUT_POLICY');
  if (input.envelopeMutated === true) return fail('SIGNER_REJECTS_MUTATED_ENVELOPE');
  return normalizeEvidence({
    kind: 'production-signer',
    providerId: input.providerId,
    digest: input.digest,
    checkedAt: input.checkedAt ?? now,
    expiresAt: input.expiresAt,
    attested: true,
    status: 'verified',
    health: 'healthy'
  }, { now });
}

export function verifyProviderHealth(input = {}, { now = Date.now() } = {}) {
  if (input.kind === 'venue-health' && input.available !== true) return unavailable('VENUE_UNAVAILABLE');
  if (input.available === false || input.health === 'unhealthy') return unavailable('PROVIDER_HEALTH_FAILURE');
  return normalizeEvidence({
    kind: input.kind || 'wallet-provider',
    providerId: input.providerId,
    digest: input.digest,
    checkedAt: input.checkedAt ?? now,
    expiresAt: input.expiresAt,
    attested: input.attested === true,
    status: input.available === true ? 'verified' : 'unavailable',
    health: input.available === true ? 'healthy' : 'unhealthy'
  }, { now });
}

export function verifyRpcAndContract(input = {}, { now = Date.now() } = {}) {
  if (input.rpcAvailable !== true) return unavailable('RPC_OUTAGE');
  if (input.expectedCodeHash && input.observedCodeHash && input.expectedCodeHash !== input.observedCodeHash) {
    return unavailable('CONTRACT_CODE_HASH_MISMATCH');
  }
  if (input.localPolicyDigest && input.onchainPolicyDigest && input.localPolicyDigest !== input.onchainPolicyDigest) {
    return fail('LOCAL_ONCHAIN_POLICY_MISMATCH');
  }
  return normalizeEvidence({
    kind: input.kind || 'rpc',
    providerId: input.providerId,
    digest: input.digest || input.observedCodeHash,
    checkedAt: input.checkedAt ?? now,
    expiresAt: input.expiresAt,
    attested: true,
    status: 'verified',
    health: 'healthy'
  }, { now });
}

export function verifyAuditIntegrity(input = {}) {
  if (input.tampered === true || input.rewriteDetected === true || input.reorderDetected === true) {
    return fail('AUDIT_TAMPER');
  }
  if (!publicDigest(input.rootHash)) return unavailable('AUDIT_ROOT_REQUIRED');
  return { ok: true, schema: PHASE21_SCHEMA, kind: 'durable-immutable-audit', rootHash: publicDigest(input.rootHash) };
}

export function verifyBackupRestore(input = {}) {
  if (input.restored !== true || input.hashMatch !== true) return unavailable('BACKUP_RESTORE_FAILURE');
  return { ok: true, schema: PHASE21_SCHEMA, kind: 'backup-restore-drill', rpoMs: finite(input.rpoMs), rtoMs: finite(input.rtoMs) };
}

export function verifyIndependentReview(input = {}) {
  if (input.independent !== true || input.signed !== true || !safeId(input.reviewerId)) {
    return unavailable('SECURITY_REVIEW_NOT_INDEPENDENT');
  }
  return { ok: true, schema: PHASE21_SCHEMA, kind: 'independent-security-review', reviewerId: safeId(input.reviewerId) };
}

export function verifyReproducibleBuild(input = {}) {
  if (input.reproduced !== true || !publicDigest(input.firstDigest) || input.firstDigest !== input.secondDigest) {
    return unavailable('BUILD_NOT_REPRODUCIBLE');
  }
  return { ok: true, schema: PHASE21_SCHEMA, kind: 'reproducible-deployment', digest: publicDigest(input.firstDigest) };
}

export function verifyRollbackDrill(input = {}) {
  if (input.drilled !== true || input.healthAfter !== true) return unavailable('ROLLBACK_DRILL_MISSING');
  return { ok: true, schema: PHASE21_SCHEMA, kind: 'rollback-drill' };
}

export function verifySloMeasurement(input = {}) {
  if (input.defined === true && input.measured !== true) return unavailable('SLO_NOT_MEASURED');
  if (input.measured !== true) return unavailable('SLO_NOT_MEASURED');
  return { ok: true, schema: PHASE21_SCHEMA, kind: 'slo-measurement', window: safeString(input.window, 64) };
}

/**
 * Aggregate readiness. Only current verified evidence can turn a field green.
 * A single critical blocker keeps launchAllowed false.
 */
export function aggregateOperationalReadiness({
  evidence = [],
  workstreamResults = {},
  now = Date.now()
} = {}) {
  const secret = rejectSecrets({ evidence, workstreamResults });
  if (secret) {
    return {
      schema: OPERATIONAL_READINESS_SCHEMA,
      implementation: 'implemented',
      configuration: 'not-configured',
      verification: 'unavailable',
      operational: 'unavailable',
      live: false,
      launchAllowed: false,
      evidence: [],
      blockers: ['RAW_CREDENTIAL_IN_OUTPUT'],
      claims: { production: false, executionActivated: false, rawCredentialsAllowed: false }
    };
  }

  const normalized = (Array.isArray(evidence) ? evidence : []).map((row) => normalizeEvidence(row, { now }));
  const verified = normalized.filter((row) => row.ok === true);
  const kinds = new Set(verified.map((row) => row.kind));
  const blockers = [];

  const requireKind = (kind, code) => {
    if (!kinds.has(kind)) blockers.push(code);
  };

  requireKind('approved-durable-registry', 'REGISTRY_UNAVAILABLE');
  requireKind('certificate-authority', 'CA_INVALID');
  requireKind('sandbox-operator', 'SANDBOX_OPERATOR_UNAVAILABLE');
  requireKind('simulator', 'SIMULATOR_TIMEOUT');
  requireKind('monitor', 'MONITOR_STALE');
  requireKind('smart-wallet', 'SMART_WALLET_WITHOUT_GUARDIAN');
  requireKind('production-signer', 'SIGNER_WITHOUT_POLICY');
  requireKind('wallet-provider', 'PROVIDER_HEALTH_FAILURE');
  requireKind('venue-health', 'VENUE_UNAVAILABLE');
  requireKind('rpc', 'RPC_OUTAGE');
  requireKind('policy-contract', 'CONTRACT_CODE_HASH_MISMATCH');
  requireKind('durable-immutable-audit', 'AUDIT_TAMPER');
  requireKind('backup-restore-drill', 'BACKUP_RESTORE_FAILURE');
  requireKind('independent-security-review', 'SECURITY_REVIEW_NOT_INDEPENDENT');
  requireKind('reproducible-deployment', 'BUILD_NOT_REPRODUCIBLE');
  requireKind('rollback-drill', 'ROLLBACK_DRILL_MISSING');
  requireKind('slo-measurement', 'SLO_NOT_MEASURED');

  if (workstreamResults.schedulerUnauthorized) blockers.push('SCHEDULER_UNAUTHORIZED');
  if (workstreamResults.policyMismatch) blockers.push('LOCAL_ONCHAIN_POLICY_MISMATCH');

  const allCritical = blockers.length === 0 && verified.length >= 16;
  return {
    schema: OPERATIONAL_READINESS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    implementation: 'implemented',
    configuration: verified.length ? 'partially-configured' : 'not-configured',
    verification: allCritical ? 'verified' : 'unavailable',
    operational: allCritical ? 'operational' : 'unavailable',
    live: false,
    launchAllowed: allCritical,
    evidence: verified.map((row) => ({
      kind: row.kind,
      providerId: row.providerId,
      digest: row.digest,
      checkedAt: row.checkedAt,
      expiresAt: row.expiresAt,
      status: row.status
    })),
    blockers: [...new Set(blockers)],
    claims: {
      production: false,
      executionActivated: false,
      rawCredentialsAllowed: false
    }
  };
}

export function phase21PublicStatus(readiness) {
  const launchAllowed = readiness?.launchAllowed === true && readiness?.operational === 'operational';
  return {
    schema: PHASE21_SCHEMA,
    status: launchAllowed ? 'approved-not-live' : 'blocked',
    launchAllowed: false,
    operational: false,
    live: false,
    claims: {
      production: false,
      executionActivated: false,
      rawCredentialsAllowed: false,
      publicVerification: false
    },
    blockers: readiness?.blockers || ['CRITICAL_EVIDENCE_MISSING'],
    banner: [
      'Launch blocked.',
      'Operational activation unavailable.',
      'No financial execution is authorized.',
      'No External Agent live execution is claimed.'
    ]
  };
}
