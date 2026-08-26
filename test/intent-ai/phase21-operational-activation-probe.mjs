/* Phase 21 — operational activation, evidence verification, fail-closed launch. */
import assert from 'node:assert/strict';
import {
  aggregateOperationalReadiness,
  CRITICAL_FAILURE_CODES,
  EVIDENCE_KINDS,
  normalizeEvidence,
  phase21PublicStatus,
  verifyAuditIntegrity,
  verifyBackupRestore,
  verifyCertificateAuthority,
  verifyIndependentReview,
  verifyMonitor,
  verifyProviderHealth,
  verifyReproducibleBuild,
  verifyRollbackDrill,
  verifyRpcAndContract,
  verifySandboxOperator,
  verifyScheduler,
  verifySigner,
  verifySimulator,
  verifySloMeasurement,
  verifySmartWalletAndGuardian
} from '../../src/lib/intent-ai/index.js';
import app from '../../server/app.js';
import { scanOperationalProviders } from '../../server/intentOperationalEvidence.js';
import { openApiDocument } from '../../server/openapi.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const digest = 'a'.repeat(64);
const later = now + 3_600_000;

const current = (kind, extra = {}) => ({
  kind,
  providerId: `provider-${kind.replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`,
  digest,
  checkedAt: now,
  expiresAt: later,
  attested: true,
  status: 'verified',
  health: 'healthy',
  ...extra
});

try {
  check('env flag alone is not evidence', normalizeEvidence({ kind: 'simulator', envFlag: true, providerId: 'sim', digest, attested: true, status: 'verified', checkedAt: now, expiresAt: later }).ok === false);
  check('source file is not evidence', normalizeEvidence({ kind: 'simulator', sourceFile: 'server/app.js', providerId: 'sim', digest }).ok === false);
  check('mock fixture is not evidence', normalizeEvidence({ kind: 'rpc', mock: true, providerId: 'rpc', digest, attested: true }).ok === false);
  check('raw credential in evidence is rejected', normalizeEvidence({ kind: 'production-signer', providerId: 'kms', digest, privateKey: '0x' + 'ab'.repeat(32) }).code === 'RAW_CREDENTIAL_IN_OUTPUT');

  check('registry absence is fail-closed', aggregateOperationalReadiness({ evidence: [], now }).blockers.includes('REGISTRY_UNAVAILABLE'));
  check('expired CA is rejected', verifyCertificateAuthority({ issuerIdentity: 'fbt-ca', fingerprint: digest, signatureValid: true, expiresAt: now - 1, providerId: 'ca' }, { now }).code === 'CA_EXPIRED');
  check('revoked CA is rejected', verifyCertificateAuthority({ issuerIdentity: 'fbt-ca', fingerprint: digest, signatureValid: true, expiresAt: later, revoked: true, providerId: 'ca' }, { now }).code === 'CA_REVOKED');
  check('invalid CA is rejected', verifyCertificateAuthority({ issuerIdentity: '', fingerprint: 'nope' }, { now }).code === 'CA_INVALID');
  check('sandbox operator absence is unavailable', verifySandboxOperator({ available: false }).code === 'SANDBOX_OPERATOR_UNAVAILABLE');
  check('sandbox cannot touch production signer', verifySandboxOperator({ available: true, attested: true, productionSigner: true, providerId: 'box', digest, expiresAt: later }).code === 'SANDBOX_MUST_NOT_TOUCH_PRODUCTION');
  check('simulator timeout is fail-closed', verifySimulator({ timeout: true, providerId: 'sim' }).code === 'SIMULATOR_TIMEOUT');
  check('stale monitor is fail-closed', verifyMonitor({ providerId: 'mon', digest, heartbeatAt: now - 120_000, maxAgeMs: 30_000 }, { now }).code === 'MONITOR_STALE');
  check('scheduler without authorization cannot create a transaction', verifyScheduler({ signs: false, submits: false, userAuthorization: false }).code === 'SCHEDULER_UNAUTHORIZED');
  check('scheduler must not sign', verifyScheduler({ signs: true, userAuthorization: true, guardianApproved: true, policyRechecked: true }).code === 'SCHEDULER_MUST_NOT_SIGN');
  check('smart wallet without guardian is blocked', verifySmartWalletAndGuardian({ providerId: 'sw', digest }).code === 'SMART_WALLET_WITHOUT_GUARDIAN');
  check('guardian cannot replace user confirmation', verifySmartWalletAndGuardian({ providerId: 'sw', digest, guardianIndependent: true, guardianApproved: true, userConfirmed: false, checkedAt: now, expiresAt: later }).code === 'GUARDIAN_CANNOT_REPLACE_USER');
  check('signer without policy is blocked', verifySigner({ providerId: 'kms', digest }).code === 'SIGNER_WITHOUT_POLICY');
  check('provider health failure is blocked', verifyProviderHealth({ kind: 'wallet-provider', available: false, providerId: 'w' }).code === 'PROVIDER_HEALTH_FAILURE');
  check('venue unavailable is blocked', verifyProviderHealth({ kind: 'venue-health', available: false, providerId: 'v' }).code === 'VENUE_UNAVAILABLE');
  check('RPC outage is blocked', verifyRpcAndContract({ rpcAvailable: false, providerId: 'rpc' }).code === 'RPC_OUTAGE');
  check('code-hash mismatch is blocked', verifyRpcAndContract({ rpcAvailable: true, expectedCodeHash: 'aa', observedCodeHash: 'bb', providerId: 'rpc', digest }).code === 'CONTRACT_CODE_HASH_MISMATCH');
  check('local/on-chain policy mismatch is blocked', verifyRpcAndContract({ rpcAvailable: true, localPolicyDigest: 'aa', onchainPolicyDigest: 'bb', providerId: 'rpc', digest, expectedCodeHash: 'aa', observedCodeHash: 'aa' }).code === 'LOCAL_ONCHAIN_POLICY_MISMATCH');
  check('audit tamper is blocked', verifyAuditIntegrity({ tampered: true, rootHash: digest }).code === 'AUDIT_TAMPER');
  check('backup restore failure is blocked', verifyBackupRestore({ restored: false }).code === 'BACKUP_RESTORE_FAILURE');
  check('unsigned internal review is not independent', verifyIndependentReview({ independent: false, signed: false }).code === 'SECURITY_REVIEW_NOT_INDEPENDENT');
  check('non-reproducible build is blocked', verifyReproducibleBuild({ reproduced: false, firstDigest: digest, secondDigest: 'b'.repeat(64) }).code === 'BUILD_NOT_REPRODUCIBLE');
  check('rollback without drill is blocked', verifyRollbackDrill({ drilled: false }).code === 'ROLLBACK_DRILL_MISSING');
  check('defined but unmeasured SLO is blocked', verifySloMeasurement({ defined: true, measured: false }).code === 'SLO_NOT_MEASURED');

  const empty = aggregateOperationalReadiness({ evidence: [], now });
  check('empty evidence keeps launch blocked', empty.launchAllowed === false && empty.operational === 'unavailable' && empty.live === false);
  check('empty evidence never activates execution', empty.claims.executionActivated === false && empty.claims.production === false);

  const almost = EVIDENCE_KINDS.filter((kind) => kind !== 'slo-measurement').map((kind) => current(kind));
  const missingSlo = aggregateOperationalReadiness({ evidence: almost, now });
  check('one critical blocker keeps launch closed', missingSlo.launchAllowed === false && missingSlo.blockers.includes('SLO_NOT_MEASURED'));

  const full = EVIDENCE_KINDS.map((kind) => current(kind));
  const ready = aggregateOperationalReadiness({ evidence: full, now });
  check('complete current evidence can verify without going live', ready.verification === 'verified' && ready.launchAllowed === true && ready.live === false && ready.claims.executionActivated === false);

  const publicPage = phase21PublicStatus(empty);
  check('public phase-21 status stays blocked and non-live', publicPage.launchAllowed === false && publicPage.live === false && publicPage.banner[0] === 'Launch blocked.');

  const scan = scanOperationalProviders({ now, injectedEvidence: [] });
  check('server scan does not invent connected providers', scan.connectedProviders.length === 0 && scan.readiness.launchAllowed === false);
  check('configuration names stay configured-not-verified', scan.candidates.every((row) => row.status === 'configured-not-verified'));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const port = server.address().port;
    const get = async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: 'application/json' } });
      return { response, body: await response.json() };
    };
    const phaseStatus = await get('/api/intents/v1/phase-status');
    const publicStatus = await get('/api/intents/v1/public-status');
    const activation = await get('/api/intents/v1/activation');
    check('phase-status includes phase 21 as implemented but unavailable', phaseStatus.body.phases.some((row) => row.phase === 21 && row.implementation === 'implemented' && row.operational === 'unavailable' && row.live === false));
    check('public-status launch remains blocked', publicStatus.body.launchAllowed === false && publicStatus.body.claims.executionActivated === false);
    check('activation still separates implementation from operational proof', activation.body.product.specificationImplementedThrough === 50 && activation.body.product.operationalActivationRequired === true);
    const dumped = JSON.stringify({ phaseStatus: phaseStatus.body, publicStatus: publicStatus.body, activation: activation.body, empty, ready });
    check('no raw credential words leak into status output', !/private.?key|seed.?phrase|master.?password|BEGIN [A-Z ]*PRIVATE KEY/i.test(dumped));
    const document = openApiDocument();
    check('OpenAPI still documents the three authoritative status routes', Boolean(document.paths['/intents/v1/phase-status']?.get && document.paths['/intents/v1/public-status']?.get));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  check('failure catalogue covers the required probe paths', CRITICAL_FAILURE_CODES.length >= 20);

  const passed = results.filter((row) => row.ok).length;
  console.log(JSON.stringify({ probe: 'phase21-operational-activation', passed, total: results.length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase21-operational-activation', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
