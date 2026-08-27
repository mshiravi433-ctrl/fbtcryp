/* Phases 22–30 — post-activation control planes, fail-closed. */
import {
  operateDurableRegistry,
  operateCertificateAuthority,
  runSandboxMesh,
  SANDBOX_STAGES,
  operateSimulator,
  operateMonitor,
  operateScheduler,
  operateSmartWallet,
  operateProductionSigner,
  authorizationFeesPresent,
  federateVenueHealth,
  operateRpcQuorum,
  enforceOnchainPolicy,
  operateImmutableAudit,
  operateBackupRestore,
  operateAssurance,
  evaluateLaunchControlPlane
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const digest = 'a'.repeat(64);

try {
  check('22 registry unavailable without durable store', operateDurableRegistry({}).code === 'REGISTRY_UNAVAILABLE');
  const mem = new Map();
  const store = {
    durable: true,
    restartRecoverable: true,
    health: () => true,
    write: (row) => mem.set(row.id, row),
    read: (id) => mem.get(id)
  };
  check('22 read-after-write is required', operateDurableRegistry({ store, action: 'write', record: { id: 'agent-22' }, now }).persisted === true);
  check('22 expired CA is rejected', operateCertificateAuthority({ certificate: { issuer: 'fbt-ca', fingerprint: digest, signatureValid: true, expiresAt: now - 1 }, now }).code === 'CA_EXPIRED');
  check('22 uncertified listing is not executable', operateCertificateAuthority({ certificate: { issuer: 'fbt-ca', fingerprint: digest, signatureValid: true, expiresAt: now + 1000, listingCertified: false }, now }).listingExecutable === false);

  check('23 missing sandbox operator cannot handshake', runSandboxMesh({}).code === 'SANDBOX_OPERATOR_UNAVAILABLE' && runSandboxMesh({}).handshake === false);
  check('23 sandbox cannot touch production', runSandboxMesh({ operator: { available: true, attested: true, productionSigner: true, operatorId: 'box' } }).code === 'SANDBOX_MUST_NOT_TOUCH_PRODUCTION');
  const stages = SANDBOX_STAGES.map((id) => ({ id, isolated: true }));
  check('23 complete isolated stages still not a verified agent', runSandboxMesh({ operator: { available: true, attested: true, operatorId: 'box-23', runtimeVersion: '1.0.0', expiresAt: now + 1000 }, stages, now }).verifiedAgent === false);

  check('24 simulator timeout is not a quote', operateSimulator({ result: { timeout: true } }).code === 'SIMULATOR_TIMEOUT');
  check('24 stale monitor is fail-closed', operateMonitor({ heartbeatAt: now - 120000, maxAgeMs: 30000, now }).code === 'MONITOR_STALE');
  check('24 scheduler without auth creates no transaction', operateScheduler({}).code === 'SCHEDULER_UNAUTHORIZED' && operateScheduler({}).transactionCreated === false);
  check('24 authorized scheduler still does not sign', operateScheduler({ userAuthorization: true, guardianApproved: true, policyRechecked: true, signs: true }).code === 'SCHEDULER_MUST_NOT_SIGN');

  check('25 wallet without guardian blocked', operateSmartWallet({ wallet: { available: true, providerId: 'sw' } }).code === 'SMART_WALLET_WITHOUT_GUARDIAN');
  check('25 guardian cannot replace user', operateSmartWallet({ wallet: { available: true, providerId: 'sw' }, guardian: { independent: true, approved: true }, userConfirmed: false }).code === 'GUARDIAN_CANNOT_REPLACE_USER');
  check('25 signer without policy blocked', operateProductionSigner({ signer: { policyBound: false } }).code === 'SIGNER_WITHOUT_POLICY');
  const env = { recipient: '0x1', calldata: '0x', chain: 1, amount: '1', fee: '1', slippage: '1' };
  check('25 mutated envelope is rejected', operateProductionSigner({ signer: { policyBound: true, kmsBound: true }, envelope: { ...env, amount: '2' }, authorized: env }).code === 'SIGNER_REJECTS_MUTATED_ENVELOPE');
  check('25 all fee categories required', authorizationFeesPresent({ network: 1, protocol: 1, bridge: 0, 'external-agent': 0, performance: 0, execution: 1, slippage: 1, other: 0 }).ok);

  const venues = federateVenueHealth({ adapters: { wallet: { available: false } }, now });
  check('26 missing wallet provider is unavailable', venues.blockers.includes('PROVIDER_HEALTH_FAILURE') && venues.live === false);
  const bridge = federateVenueHealth({ adapters: { wallet: { available: true, attested: true, providerId: 'w' }, broker: { available: true, attested: true, providerId: 'b' }, bridge: { available: true, attested: true, providerId: 'br', executable: false }, venue: { available: true, attested: true, providerId: 'v' } }, now });
  check('26 bridge quote is not executable', bridge.executable === false && bridge.blockers.includes('BRIDGE_NOT_EXECUTABLE'));

  check('27 RPC outage is not success', operateRpcQuorum({}).code === 'RPC_OUTAGE' && operateRpcQuorum({}).success === false);
  check('27 code-hash mismatch blocked', operateRpcQuorum({ rpc: { available: true, attested: true }, deployment: { providerId: 'rpc', address: '0xabc', codeHash: 'aa', expectedCodeHash: 'bb', chainId: 1 } }).code === 'CONTRACT_CODE_HASH_MISMATCH');
  check('27 local/on-chain mismatch fail-closed', enforceOnchainPolicy({ localDigest: 'aa', onchainDigest: 'bb' }).code === 'LOCAL_ONCHAIN_POLICY_MISMATCH');

  check('28 audit tamper rejected', operateImmutableAudit({ tamper: { rewrite: true } }).code === 'AUDIT_TAMPER');
  check('28 restore hash mismatch blocked', operateBackupRestore({ restored: true, hashBefore: digest, hashAfter: 'b'.repeat(64) }).code === 'BACKUP_RESTORE_FAILURE');

  check('29 unsigned review is not independent', operateAssurance({ review: { independent: false } }).code === 'SECURITY_REVIEW_NOT_INDEPENDENT');
  check('29 internal checklist is not certification', operateAssurance({ review: { independent: true, signed: true, reviewerId: 'rev-29', threats: ['prompt-injection', 'external-agent-abuse', 'capability-escalation', 'credential-exfiltration', 'replay', 'guardian-policy-bypass', 'provider-compromise', 'receipt-forgery', 'privacy-reidentification', 'outage-recovery'] }, privacy: { reviewed: true }, compliance: { internalChecklist: true, independent: false } }).code === 'INTERNAL_CHECKLIST_IS_NOT_CERTIFICATION');
  const assurance = operateAssurance({ review: { independent: true, signed: true, reviewerId: 'rev-29', threats: ['prompt-injection', 'external-agent-abuse', 'capability-escalation', 'credential-exfiltration', 'replay', 'guardian-policy-bypass', 'provider-compromise', 'receipt-forgery', 'privacy-reidentification', 'outage-recovery'] }, privacy: { reviewed: true }, compliance: { independent: true } });
  check('29 even complete review does not publish secure/audited claims', assurance.claims.secure === false && assurance.verified === false);

  const plane = evaluateLaunchControlPlane({ evidence: [], freeze: true, now });
  check('30 legacy freeze flag cannot alter the evidence decision', plane.launchAllowed === false && plane.goLive === false && plane.freeze === false);
  check('30 empty evidence is fail-closed', plane.banner[0] === 'Activation pending verification.');
  check('no raw credentials in control-plane output', !/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ store, venues, plane, assurance })));

  console.log(JSON.stringify({ probe: 'phase22-30-control-plane', passed: results.filter((row) => row.ok).length, total: results.length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase22-30-control-plane', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
