/* Phase 20 — reproducible release, migration/rollback, SLO and launch gate. */
import {
  createReleaseManifest,
  validateReleaseManifest,
  createMigrationPlan,
  createRollbackPlan,
  defineSLO,
  approveChange,
  evaluateLaunchGate,
  publicStatusPage,
  governanceStatus,
  launchChecklist
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const hashes = { lockfileHash: 'a'.repeat(64), buildHash: 'b'.repeat(64) };

try {
  check('release evidence is required before launch', createReleaseManifest({ version: '1.0.0', sourceCommit: 'abc1234' }).ok === false);
  const release = createReleaseManifest({ version: '1.0.0', sourceCommit: 'abc1234', ...hashes, nodeVersion: '20.0.0', reproducible: true, buildReproduced: true }, { now });
  check('release manifest is versioned and reproducible only with build evidence', release.ok && release.manifest.reproducible && release.manifest.deploymentVerified === false);
  check('manifest validation does not imply deployment', validateReleaseManifest(release.manifest).ok && validateReleaseManifest(release.manifest).deploymentVerified === false);
  const migration = createMigrationPlan({ fromVersion: '1.0.0', toVersion: '1.1.0', steps: [{ id: 'migrate-1', description: 'bounded migration', reversible: true }], backupEvidence: { verified: true }, now });
  check('migration plan requires a verified backup', migration.ok && migration.canApply && migration.backupVerified);
  const rollback = createRollbackPlan({ releaseVersion: '1.1.0', rollbackVersion: '1.0.0', artifactEvidence: { verified: true }, migration: migration, now });
  check('rollback remains untested even when artifacts exist', rollback.ok && rollback.canRollback && rollback.rollbackTested === false && rollback.status === 'configured-not-tested');
  const slo = defineSLO({ availabilityPct: 99.9, p95LatencyMs: 2000, incidentResponseMinutes: 30, measurementProvider: 'slo-provider' });
  check('SLO is defined separately from measured runtime performance', slo.ok && slo.status === 'defined-not-measured' && slo.measured === false);
  const blockedChange = approveChange({ changeId: 'change-20', version: '1.1.0', approver: 'reviewer-20', testsPassed: false, securityReview: false, migration, rollback, now });
  check('change control blocks unreviewed release', blockedChange.ok === false && blockedChange.status === 'blocked');
  const change = approveChange({ changeId: 'change-20', version: '1.1.0', approver: 'reviewer-20', testsPassed: true, securityReview: true, migration, rollback, now });
  check('approved change is still not live deployment', change.ok && change.status === 'approved-for-deployment-not-live' && change.deploymentStarted === false);
  const phases = Array.from({ length: 10 }, (_, index) => ({ phase: index + 10, operationalStatus: 'unavailable' }));
  const gate = evaluateLaunchGate({ phases, release: release.manifest, change, runtimeEvidence: null, now });
  check('launch is blocked while any Phase 10–19 runtime evidence is unavailable', gate.status === 'blocked' && gate.launchAllowed === false && gate.operational === false && gate.blockers.length > 0);
  const status = publicStatusPage({ phases, launchGate: gate, now });
  check('public status page reports runtime truth, not implementation labels', status.status === 'blocked' && status.launchAllowed === false && status.claims.deployed === false && status.phases.every((phase) => phase.operational === false));
  const launchReady = evaluateLaunchGate({ phases: Array.from({ length: 10 }, (_, index) => ({ phase: index + 10, operationalStatus: 'live' })), release: release.manifest, change, runtimeEvidence: { operational: true, attested: true, deployed: true }, now });
  check('launch can clear only after every critical evidence gate is present', launchReady.ok && launchReady.launchAllowed && launchReady.operational && launchReady.blockers.length === 0);
  const governance = governanceStatus({ release: release.manifest, launchGate: gate, slo, changeControl: change });
  check('governance keeps migration/rollback/incident activation explicit', governance.operational === false && governance.publicStatus && governance.criticalBlockers.length > 0);
  check('release checklist includes independent and operational evidence', launchChecklist.includes('runtime-provider-evidence') && launchChecklist.includes('tested-rollback') && launchChecklist.includes('independent-security-review'));
  check('governance output contains no raw credentials', !/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ release, migration, rollback, gate, status, governance })));

  console.log(JSON.stringify({ probe: 'phase20-launch-governance', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase20-launch-governance', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
