/* Phase 16 — adapter readiness, simulation, no-sign failures and idempotency. */
import {
  checkAdapterReadiness,
  verifyTransactionRequest,
  simulateTransaction,
  executeWithAdapter,
  clearExecutionIdempotency
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const transaction = { chainId: 42161, to: '0x' + 'a'.repeat(40), data: '0x1234', value: 0 };
const provider = { health: () => ({ ok: true, operational: true, attested: true, venueHealthy: true, providerId: 'provider-16' }) };
let signCalls = 0;
const adapter = {
  id: 'wallet-adapter-16', kind: 'wallet',
  simulate: async () => ({ ok: true, status: 'passed', providerId: 'provider-16', evidenceId: 'sim-16' }),
  submit: async ({ idempotencyKey }) => ({ ok: true, receiptRef: `receipt-${idempotencyKey}` })
};
const authorization = {
  schema: 'fbt.financial-execution-authorization.v1', executionAuthorized: true,
  screenShown: true, userConfirmed: true, guardianApproved: true,
  policyDecision: 'ALLOW_REVIEW_ONLY', authorizationScreenId: 'auth-16',
  limits: { capital: 100, transaction: 50, risk: 10, protocol: ['swap'], chain: [42161], time: 60, fee: 1, slippage: 0.2 }
};
const evidence = { providerId: 'provider-16', health: 'healthy', attested: true, checkedAt: now, expiresAt: now + 60000 };

try {
  clearExecutionIdempotency();
  check('missing provider is unavailable', checkAdapterReadiness({ adapter, signer: () => null, now }).status === 'unavailable');
  check('mock adapter cannot be activated in production', checkAdapterReadiness({ adapter: { ...adapter, mock: true }, provider, signer: () => null, now }).code === 'MOCK_ADAPTER_FORBIDDEN');
  const ready = checkAdapterReadiness({ adapter, provider, signer: () => null, now });
  check('provider health, attestation, signer and adapter surfaces are required', ready.ok && ready.status === 'configured' && ready.noSignOnFailure && ready.evidence.providerId === 'provider-16');
  check('missing venue health is unavailable', checkAdapterReadiness({ adapter, provider: { health: () => ({ ok: true, operational: true, attested: true, providerId: 'provider-16' }) }, signer: () => null, now }).code === 'VENUE_HEALTH_UNAVAILABLE');
  check('recipient and calldata are rechecked before signing', verifyTransactionRequest({ transaction, expected: { chainId: 42161, to: transaction.to, data: transaction.data } }).ok && verifyTransactionRequest({ transaction, expected: { to: '0x' + 'b'.repeat(40) } }).code === 'RECIPIENT_MISMATCH' && verifyTransactionRequest({ transaction, expected: { data: '0xbeef' } }).code === 'CALLDATA_MISMATCH');
  const noSim = await simulateTransaction({ adapter: { ...adapter, simulate: undefined }, transaction, provider, now });
  check('missing simulation blocks before signing', noSim.status === 'unavailable' && noSim.noSign === true);
  const badSim = await simulateTransaction({ adapter: { ...adapter, simulate: async () => ({ ok: false, status: 'reverted' }) }, transaction, provider, now });
  check('failed simulation is no-sign', badSim.status === 'unavailable' && badSim.noSign === true);
  const goodSim = await simulateTransaction({ adapter, transaction, expected: { chainId: 42161, to: transaction.to, data: transaction.data }, provider, now });
  check('passing simulation returns evidence but not completion', goodSim.ok && goodSim.status === 'passed' && goodSim.noSign === true);
  const blocked = await executeWithAdapter({ adapter, transaction, provider, authorization: null, runtimeEvidence: evidence, signer: async () => { signCalls += 1; return { ok: true, signedTx: '0xabc' }; }, idempotencyKey: 'attempt-16', now });
  check('execution without the authorization boundary does not call signer', !blocked.ok && blocked.noSign === true && signCalls === 0);
  const submitted = await executeWithAdapter({ adapter, transaction, expected: { chainId: 42161, to: transaction.to, data: transaction.data }, provider, authorization, runtimeEvidence: evidence, signer: async () => { signCalls += 1; return { ok: true, signedTx: '0xabc123' }; }, idempotencyKey: 'attempt-16', now });
  check('activated adapter submits only after all gates pass', submitted.ok && submitted.status === 'submitted' && submitted.completed === false && signCalls === 1);
  const replay = await executeWithAdapter({ adapter, transaction, provider, authorization, runtimeEvidence: evidence, signer: async () => { signCalls += 1; return { ok: true, signedTx: '0xsecond' }; }, idempotencyKey: 'attempt-16', now });
  check('idempotent replay cannot create a second transaction', replay.idempotent && replay.signCalled === false && signCalls === 1);
  const bridge = checkAdapterReadiness({ adapter: { id: 'bridge-16', kind: 'bridge', activated: false, simulate: async () => ({ ok: true, status: 'passed' }), submit: async () => ({ ok: true }) }, provider, signer: () => null, now });
  check('bridge remains unavailable without activation evidence', bridge.status === 'unavailable' && bridge.code === 'BRIDGE_ADAPTER_NOT_ACTIVATED');
  check('adapter outputs do not expose raw credentials', !/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ ready, submitted })));

  console.log(JSON.stringify({ probe: 'phase16-adapter-activation', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase16-adapter-activation', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
