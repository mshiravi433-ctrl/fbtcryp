#!/usr/bin/env node
/**
 * Operational-drill probe.
 *
 * Proves the four stage-2 kinds are earned by REAL work — a snapshot that is
 * written and read back, a release that is rolled back, an isolated sandbox
 * that cannot see production credentials, and a committed bytecode hash —
 * and that stage-3 kinds which require a third party are NOT self-issued.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.LEARNING_EVENT_RATE_LIMIT = process.env.LEARNING_EVENT_RATE_LIMIT || '100';
process.env.INTENT_SETTLEMENT_RATE_LIMIT = process.env.INTENT_SETTLEMENT_RATE_LIMIT || '100';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '0000000000:test-only-token';
process.env.ECOSYSTEM_WRITE_RATE_LIMIT = process.env.ECOSYSTEM_WRITE_RATE_LIMIT || '25';

import http from 'node:http';
import { createHash } from 'node:crypto';
import {
  verifyBackupRestore,
  verifyRollbackDrill,
  verifySandboxOperator,
  normalizeEvidence,
  EVIDENCE_KINDS
} from '../../src/lib/intent-ai/operationalActivation.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const {
  runBackupRestoreDrill,
  runRollbackDrill,
  runSandboxOperatorDrill,
  runPolicyContractDrill,
  runAllOperationalDrills,
  OPS_DRILL_KINDS,
  BACKUP_KEY
} = await import('../../server/intentOperationalDrills.js');

const { storeGet, storeSet } = await import('../../server/store.js');
const { backupRestoreDrill, rollbackDrill } = await import('../../server/intentDrill.js');
const { runOpsProbe, OPS_DRILL_KINDS: probeKinds, resetOpsProbeCache } = await import('../../server/intentOpsProbe.js');
const {
  runStage3Digest,
  reviewPackageDigest,
  productionSignerStatus,
  STAGE3_KINDS
} = await import('../../server/intentStage3Probe.js');

check('four ops-drill kinds are declared', OPS_DRILL_KINDS.length === 4);
check('ops-drill kinds are valid evidence kinds', OPS_DRILL_KINDS.every((k) => EVIDENCE_KINDS.includes(k)));
check('ops-probe kinds match the drill list', probeKinds.length === 4 && probeKinds.every((k) => OPS_DRILL_KINDS.includes(k)));

/* ── backup/restore actually writes, restores, and matches ─────────────── */
const backup = await runBackupRestoreDrill();
check('backup/restore drill passes', backup.ok === true);
check('backup/restore issues a 64-hex digest', /^[0-9a-f]{64}$/.test(backup.evidence?.digest || ''));
check('backup/restore reports hashMatch', backup.hashMatch === true && backup.restored === true);
check('backup/restore measures RPO/RTO', Number.isFinite(backup.rpoMs) && Number.isFinite(backup.rtoMs));
const storedBackup = await storeGet(BACKUP_KEY);
check('backup snapshot is actually in the store', typeof storedBackup === 'string' && storedBackup.includes('fbt.backup-snapshot.v1'));
check('stored snapshot hashes to the evidence digest', createHash('sha256').update(storedBackup).digest('hex') === backup.backupHash);

const wrapperBackup = await backupRestoreDrill();
check('intentDrill wrapper still reports ok', wrapperBackup.ok === true && wrapperBackup.kind === 'backup-restore-drill');

check('verifyBackupRestore still refuses a failed restore', verifyBackupRestore({ restored: false, hashMatch: false }).ok === false);

await storeSet(BACKUP_KEY, '{"tampered":true}');
const tampered = await runBackupRestoreDrill();
/* The drill writes a FRESH snapshot then reads it back, so a previously
   tampered key is overwritten and the new drill still passes. Prove the
   verifier itself still rejects a mismatch. */
check('fresh drill overwrites a tampered key and re-verifies', tampered.ok === true);
check('hash mismatch is still a closed failure', verifyBackupRestore({ restored: true, hashMatch: false }).code === 'BACKUP_RESTORE_FAILURE');

/* ── rollback actually restores the previous release ───────────────────── */
const rollback = await runRollbackDrill();
check('rollback drill passes', rollback.ok === true);
check('rollback restored the good release', rollback.restoredVersion === 'good' && rollback.drilled === true && rollback.healthAfter === true);
check('rollback issues a 64-hex digest', /^[0-9a-f]{64}$/.test(rollback.evidence?.digest || ''));
check('rollback without a drill is still blocked', verifyRollbackDrill({ drilled: false }).code === 'ROLLBACK_DRILL_MISSING');
const wrapperRollback = await rollbackDrill();
check('intentDrill rollback wrapper still reports ok', wrapperRollback.ok === true && wrapperRollback.drilled === true);

/* ── sandbox is isolated and cannot see production credentials ─────────── */
const sandbox = await runSandboxOperatorDrill();
check('sandbox operator drill passes', sandbox.ok === true);
check('sandbox runtime is child-process or node-vm', sandbox.runtime === 'child-process' || sandbox.runtime === 'node-vm');
check('sandbox has no mainnet / signer / custody access', sandbox.mainnetAccess === false && sandbox.productionSigner === false && sandbox.realCustody === false);
check('sandbox evidence normalizes to verified', normalizeEvidence(sandbox.evidence).ok === true);
check('sandbox with production access is refused', verifySandboxOperator({
  available: true,
  attested: true,
  mainnetAccess: true,
  providerId: 'gvisor-sandbox',
  digest: 'b'.repeat(64),
  checkedAt: Date.now(),
  expiresAt: Date.now() + 86400_000
}).code === 'SANDBOX_MUST_NOT_TOUCH_PRODUCTION');
check('unavailable sandbox is refused', verifySandboxOperator({ available: false }).ok === false);

/* ── policy-contract hashes the committed bytecode ─────────────────────── */
const policy = await runPolicyContractDrill();
check('policy-contract drill passes', policy.ok === true);
check('policy-contract digest is the bytecode hash', /^[0-9a-f]{64}$/.test(policy.expectedCodeHash || '') && policy.evidence.digest === policy.expectedCodeHash);
check('policy-contract evidence normalizes to verified', normalizeEvidence(policy.evidence).ok === true);

/* ── ops-probe earns exactly the four drill kinds ──────────────────────── */
resetOpsProbeCache();
const ops = await runOpsProbe({ store: true });
check('ops-probe earns all four drill kinds', ops.earnedCount === 4 && ops.missing.length === 0);
check('ops-probe never emits a kind it did not earn', ops.earned.every((e) => OPS_DRILL_KINDS.includes(e.kind) && /^[0-9a-f]{64}$/.test(e.digest)));

const aggregate = await runAllOperationalDrills();
check('aggregate reports one entry per kind', Object.keys(aggregate.byKind).length === 4);
for (const record of aggregate.earned) {
  check(`ops-probe ${record.kind} normalizes to verified`, normalizeEvidence(record).ok === true);
}

/* ── stage 3: digests exist, third-party kinds are NOT self-issued ─────── */
const stage3 = await runStage3Digest();
check('stage-3 covers six kinds', STAGE3_KINDS.length === 6 && stage3.totalKinds === 6);
check('independent-security-review is never self-issued', !stage3.earned.some((e) => e.kind === 'independent-security-review'));
check('production-signer is not earned without KMS', !stage3.earned.some((e) => e.kind === 'production-signer'));
check('smart-wallet is not earned without an independent guardian', !stage3.earned.some((e) => e.kind === 'smart-wallet'));
check('independent-guardian is not earned internally', !stage3.earned.some((e) => e.kind === 'independent-guardian'));
check('broker-provider is not earned without a handle', !stage3.earned.some((e) => e.kind === 'broker-provider'));
check('review package digest is 64 hex', /^[0-9a-f]{64}$/.test(reviewPackageDigest()));
check('stage-3 report carries the review package digest', stage3.digests.reviewPackage === reviewPackageDigest());
check('KMS adapter digest is present even when unsigned', /^[0-9a-f]{64}$/.test(productionSignerStatus().adapterDigest));
check('independent review is reported as not independent', stage3.missing.some((m) => m.kind === 'independent-security-review' && m.code === 'SECURITY_REVIEW_NOT_INDEPENDENT'));
check('production-signer names SIGNER_WITHOUT_POLICY', stage3.missing.some((m) => m.kind === 'production-signer' && m.code === 'SIGNER_WITHOUT_POLICY'));
/* bridge-provider may or may not be earned depending on network egress.
   Either outcome is honest: earned only with a real quote. */
const bridgeRow = stage3.byKind['bridge-provider'];
check('bridge-provider is either a real quote or a closed failure',
  (bridgeRow.ok === true && /^[0-9a-f]{64}$/.test(bridgeRow.evidence?.digest || ''))
  || (bridgeRow.ok === false && typeof bridgeRow.code === 'string'));
check('stage-3 never invents evidence for a failed kind',
  stage3.earned.every((e) => stage3.byKind[e.kind].ok === true));

/* ── HTTP surfaces ─────────────────────────────────────────────────────── */
const app = (await import('../../server/app.js')).default;
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  const drillStatus = await fetch(`${base}/api/intents/v1/drill-status`).then((r) => r.json());
  check('drill-status reports a passing backup', drillStatus.backupRestore?.ok === true);
  check('drill-status reports a passing rollback', drillStatus.rollbackDrill?.ok === true);

  const opsStatus = await fetch(`${base}/api/intents/v1/ops-probe?dry=1`).then((r) => r.json());
  check('ops-probe route returns the ops schema', opsStatus.schema === 'fbt.ops-probe.v1');
  check('ops-probe dry run does not claim a durable write', opsStatus.stored === false);
  check('ops-probe dry run still executes the drills', opsStatus.earnedCount >= 1);

  const digestStatus = await fetch(`${base}/api/intents/v1/stage3-digest`).then((r) => r.json());
  check('stage3-digest route returns the digest schema', digestStatus.schema === 'fbt.stage3-digest.v1');
  check('stage3-digest lists independent-security-review as missing',
    (digestStatus.missing || []).some((m) => m.kind === 'independent-security-review'));
} finally {
  server.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'ops-drill', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
export default results;
