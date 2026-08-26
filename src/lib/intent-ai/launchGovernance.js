/**
 * FBT INTENT AI — Phase 20: launch and governance.
 *
 * A release manifest, migration plan, or status page is not deployment proof.
 * This module separates source implementation, configuration and runtime
 * activation. Launch is blocked until every critical prerequisite has external
 * evidence; the public status surface is generated from those facts and never
 * from a marketing label.
 */

import {
  containsRawSecret,
  fail,
  finite,
  safeId,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const RELEASE_MANIFEST_SCHEMA = 'fbt.reproducible-release-manifest.v1';
export const MIGRATION_SCHEMA = 'fbt.intent-migration-plan.v1';
export const ROLLBACK_SCHEMA = 'fbt.intent-rollback-plan.v1';
export const SLO_SCHEMA = 'fbt.intent-slo.v1';
export const CHANGE_CONTROL_SCHEMA = 'fbt.change-control.v1';
export const LAUNCH_GATE_SCHEMA = 'fbt.launch-gate.v1';
export const PUBLIC_STATUS_SCHEMA = 'fbt.public-status.v1';
export const GOVERNANCE_SCHEMA = 'fbt.intent-governance.v1';

const VERSION = /^v?[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const COMMIT = /^[0-9a-f]{7,64}$/i;
const REQUIRED_RELEASE_FIELDS = ['version', 'sourceCommit', 'lockfileHash', 'buildHash', 'nodeVersion'];
const CRITICAL_PHASES = Object.freeze([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

export function createReleaseManifest(input = {}, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return fail('RELEASE_MANIFEST_INVALID');
  const version = String(input.version || '');
  const manifest = {
    schema: RELEASE_MANIFEST_SCHEMA,
    version,
    sourceCommit: String(input.sourceCommit || ''),
    lockfileHash: String(input.lockfileHash || '').replace(/^0x/, ''),
    buildHash: String(input.buildHash || '').replace(/^0x/, ''),
    nodeVersion: safeString(input.nodeVersion, 32),
    artifactDigests: Array.isArray(input.artifactDigests) ? input.artifactDigests.slice(0, 100).map((item) => String(item).replace(/^0x/, '').toLowerCase()).filter((item) => HASH.test(item)) : [],
    generatedAt: now,
    reproducible: input.reproducible === true && input.buildReproduced === true,
    buildReproduced: input.buildReproduced === true,
    deploymentVerified: false,
    source: 'build-evidence'
  };
  if (!VERSION.test(version) || !COMMIT.test(manifest.sourceCommit) || !HASH.test(manifest.lockfileHash) || !HASH.test(manifest.buildHash) || !manifest.nodeVersion) return fail('RELEASE_EVIDENCE_INCOMPLETE', REQUIRED_RELEASE_FIELDS.filter((field) => !manifest[field] || (field.includes('Hash') && !HASH.test(manifest[field]))));
  return { ok: true, manifest };
}

export function validateReleaseManifest(manifest) {
  const result = createReleaseManifest(manifest, { now: manifest?.generatedAt || Date.now() });
  if (!result.ok) return result;
  return { ok: true, schema: RELEASE_MANIFEST_SCHEMA, reproducible: result.manifest.reproducible, deploymentVerified: result.manifest.deploymentVerified, manifest: result.manifest };
}

export function createMigrationPlan({ fromVersion, toVersion, steps = [], backupEvidence = null, rollbackVersion = null, now = Date.now() } = {}) {
  if (!VERSION.test(String(fromVersion || '')) || !VERSION.test(String(toVersion || '')) || fromVersion === toVersion) return fail('MIGRATION_VERSION_INVALID');
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 32) return fail('MIGRATION_STEPS_REQUIRED');
  if (containsRawSecret(steps) || containsRawSecret(backupEvidence)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const normalizedSteps = steps.map((step, index) => ({ order: index + 1, id: safeId(step?.id || `step-${index + 1}`), description: safeString(step?.description, 180) || 'bounded migration step', reversible: step?.reversible === true }));
  if (normalizedSteps.some((step) => !step.id)) return fail('MIGRATION_STEP_INVALID');
  return {
    ok: true,
    schema: MIGRATION_SCHEMA,
    fromVersion: String(fromVersion),
    toVersion: String(toVersion),
    steps: normalizedSteps,
    backupVerified: Boolean(backupEvidence?.verified === true),
    rollbackVersion: VERSION.test(String(rollbackVersion || '')) ? String(rollbackVersion) : String(fromVersion),
    canApply: Boolean(backupEvidence?.verified === true),
    generatedAt: now
  };
}

export function createRollbackPlan({ releaseVersion, rollbackVersion, artifactEvidence = null, migration = null, now = Date.now() } = {}) {
  if (!VERSION.test(String(releaseVersion || '')) || !VERSION.test(String(rollbackVersion || '')) || releaseVersion === rollbackVersion) return fail('ROLLBACK_VERSION_INVALID');
  const evidence = artifactEvidence?.verified === true && migration?.backupVerified === true;
  return {
    ok: true,
    schema: ROLLBACK_SCHEMA,
    releaseVersion: String(releaseVersion),
    rollbackVersion: String(rollbackVersion),
    artifactVerified: artifactEvidence?.verified === true,
    backupVerified: migration?.backupVerified === true,
    rollbackTested: false,
    canRollback: evidence,
    status: evidence ? 'configured-not-tested' : 'unavailable',
    generatedAt: now
  };
}

export function defineSLO({ availabilityPct = 99, p95LatencyMs = 2000, incidentResponseMinutes = 30, measurementProvider = null } = {}) {
  const values = [availabilityPct, p95LatencyMs, incidentResponseMinutes].map(finite);
  if (values.some((value) => value === null || value < 0) || values[0] > 100 || values[1] === 0 || values[2] === 0) return fail('SLO_INVALID');
  return { ok: true, schema: SLO_SCHEMA, targets: { availabilityPct: values[0], p95LatencyMs: values[1], incidentResponseMinutes: values[2] }, measurementProvider: safeId(measurementProvider), measured: false, status: 'defined-not-measured' };
}

export function approveChange({ changeId, version, approver = null, testsPassed = false, securityReview = false, migration = null, rollback = null, now = Date.now() } = {}) {
  const id = safeId(changeId);
  if (!id || !VERSION.test(String(version || ''))) return fail('CHANGE_FIELDS_REQUIRED');
  const approved = Boolean(approver && testsPassed === true && securityReview === true && migration?.canApply === true && rollback?.canRollback === true);
  return { ok: approved, schema: CHANGE_CONTROL_SCHEMA, changeId: id, version: String(version), approver: safeId(approver), testsPassed: testsPassed === true, securityReview: securityReview === true, migrationReady: migration?.canApply === true, rollbackReady: rollback?.canRollback === true, status: approved ? 'approved-for-deployment-not-live' : 'blocked', deploymentStarted: false, generatedAt: now };
}

function phaseStatus(row) {
  const status = row?.operationalStatus || row?.status || 'unavailable';
  return ['implemented', 'partial', 'configured', 'ready', 'live', 'verified', 'unavailable', 'blocked'].includes(status) ? status : 'unavailable';
}

/** Launch only after all phase blockers and independent runtime evidence clear. */
export function evaluateLaunchGate({ phases = [], release = null, change = null, runtimeEvidence = null, criticalBlockers = [], now = Date.now() } = {}) {
  const byPhase = new Map((Array.isArray(phases) ? phases : []).map((row) => [Number(row.phase), row]));
  const missingPhases = CRITICAL_PHASES.filter((phase) => !byPhase.has(phase));
  const notOperational = CRITICAL_PHASES.filter((phase) => byPhase.has(phase) && !['live', 'verified'].includes(phaseStatus(byPhase.get(phase))));
  const manifest = release?.manifest?.schema === RELEASE_MANIFEST_SCHEMA ? release.manifest : release;
  const releaseValid = manifest?.schema === RELEASE_MANIFEST_SCHEMA && manifest.reproducible === true;
  const changeApproved = change?.status === 'approved-for-deployment-not-live';
  const runtime = runtimeEvidence?.operational === true && runtimeEvidence?.attested === true && (runtimeEvidence?.deployed === true || runtimeEvidence?.deploymentVerified === true);
  const blockers = [...new Set([...criticalBlockers, ...missingPhases.map((phase) => `PHASE_${phase}_STATUS_MISSING`), ...notOperational.map((phase) => `PHASE_${phase}_NOT_OPERATIONAL`), ...(!releaseValid ? ['REPRODUCIBLE_RELEASE_REQUIRED'] : []), ...(!changeApproved ? ['CHANGE_CONTROL_REQUIRED'] : []), ...(!runtime ? ['RUNTIME_DEPLOYMENT_EVIDENCE_REQUIRED'] : [])])];
  const allowed = blockers.length === 0;
  return {
    ok: allowed,
    schema: LAUNCH_GATE_SCHEMA,
    status: allowed ? 'approved-not-live' : 'blocked',
    launchAllowed: allowed,
    implementation: 'source-and-tests-only-until-deployed',
    configuration: releaseValid && changeApproved ? 'partially-configured' : 'not-configured',
    operational: allowed && runtime,
    blockers,
    evaluatedAt: now
  };
}

/** Public status page: runtime truth only, with no secret/config value echo. */
export function publicStatusPage({ service = 'FBT Intent AI', phases = [], launchGate = null, incidents = [], generatedAt = Date.now() } = {}) {
  const operational = launchGate?.operational === true;
  const launchAllowed = launchGate?.launchAllowed === true;
  return {
    schema: PUBLIC_STATUS_SCHEMA,
    service: safeString(service, 80) || 'FBT Intent AI',
    generatedAt,
    status: operational ? 'operational' : launchGate?.status === 'blocked' ? 'blocked' : launchAllowed ? 'approved-not-live' : 'unavailable',
    launchAllowed,
    phases: (Array.isArray(phases) ? phases : []).map((row) => ({ phase: Number(row.phase), id: safeId(row.id) || null, implementation: row.implementation || 'partial', configuration: row.configuration || 'not-configured', operational: phaseStatus(row) === 'live' || phaseStatus(row) === 'verified', status: phaseStatus(row), blockers: Array.isArray(row.blockers) ? row.blockers.slice(0, 16) : [] })),
    incidents: Array.isArray(incidents) ? incidents.slice(0, 20).map((incident) => ({ id: safeId(incident.id), status: safeString(incident.status, 32) || 'unknown', startedAt: finite(incident.startedAt), resolvedAt: finite(incident.resolvedAt) })) : [],
    claims: { deployed: false, reproducible: false, publicVerification: false }
  };
}

export function governanceStatus({ release = null, launchGate = null, slo = null, changeControl = null, incidentResponse = false } = {}) {
  return {
    schema: GOVERNANCE_SCHEMA,
    versioning: Boolean(release?.schema === RELEASE_MANIFEST_SCHEMA),
    migration: false,
    rollback: false,
    slo: Boolean(slo?.schema === SLO_SCHEMA),
    changeControl: Boolean(changeControl?.schema === CHANGE_CONTROL_SCHEMA),
    incidentResponse: incidentResponse === true,
    publicStatus: true,
    operational: false,
    status: launchGate?.status === 'approved-not-live' ? 'approved-not-live' : 'partial',
    criticalBlockers: launchGate?.blockers || ['RUNTIME_DEPLOYMENT_EVIDENCE_REQUIRED']
  };
}

export const launchChecklist = Object.freeze([
  'reproducible-build-evidence',
  'versioned-migration',
  'tested-rollback',
  'runtime-provider-evidence',
  'independent-security-review',
  'policy-and-guardian-proof',
  'public-status-runtime-reconciliation',
  'incident-drill'
]);
