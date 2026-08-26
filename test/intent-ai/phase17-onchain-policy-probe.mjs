/* Phase 17 — on-chain policy evidence, version/migration and provider revoke. */
import {
  verifyPolicyDeployment,
  evaluateOnchainPolicy,
  migrateOnchainPolicy,
  revokeOnchainSession,
  onchainPolicyStatus
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const address = '0x' + 'a'.repeat(40);
const codeHash = 'b'.repeat(64);
const policy = { id: 'policy-17', version: '1', capitalLimitUsd: 1000, transactionLimitUsd: 200, riskLimitPct: 50, protocolAllowlist: ['swap'], chainAllowlist: [42161], timeLimitSeconds: 3600, feeLimitUsd: 10, slippageLimitPct: 1 };
const deployment = { schema: 'fbt.policy-deployment-evidence.v1', chainId: 42161, contractAddress: address, codeHash, deploymentBlock: 100, verifiedAt: now, verified: true };
const provider = {
  id: 'chain-provider-17',
  getCode: async () => '0x123456',
  getPolicy: async () => ({ ok: true, codeHash, providerId: 'chain-provider-17', policy }),
  migratePolicy: async () => ({ ok: true, confirmed: true, receiptRef: 'migration-receipt-17' }),
  revokeSession: async () => ({ ok: true, confirmed: true, receiptRef: 'revoke-receipt-17' })
};
const request = { capitalUsd: 100, amountUsd: 50, riskPct: 10, protocol: 'swap', chainId: 42161, durationSeconds: 60, feeUsd: 1, slippagePct: 0.2 };

try {
  check('no deployment/provider evidence is unavailable', (await verifyPolicyDeployment({ deployment: null, provider, now })).status === 'unavailable' && onchainPolicyStatus().status === 'unavailable');
  check('provider is required to verify deployed code and policy', (await verifyPolicyDeployment({ deployment, now })).code === 'ONCHAIN_PROVIDER_UNAVAILABLE');
  const verified = await verifyPolicyDeployment({ deployment, provider, now });
  check('deployed contract and policy are verified by provider evidence', verified.ok && verified.status === 'verified' && verified.deployment.verified && verified.policy.version === '1');
  check('unverified deployment cannot enforce a policy', evaluateOnchainPolicy({ deploymentEvidence: { ...deployment, verified: false }, onchainPolicy: policy, request, now }).status === 'unavailable');
  check('local and on-chain policy mismatch fails closed', evaluateOnchainPolicy({ deploymentEvidence: verified.deployment, onchainPolicy: policy, localPolicy: { ...policy, version: '2' }, request, now }).code === 'LOCAL_ONCHAIN_POLICY_MISMATCH');
  const allowed = evaluateOnchainPolicy({ deploymentEvidence: verified.deployment, onchainPolicy: policy, localPolicy: policy, request, now });
  check('on-chain evaluation checks all limits and still requires user/Guardian/adapter', allowed.ok && allowed.decision === 'ALLOW_REVIEW_ONLY' && Object.values(allowed.checked).every(Boolean) && allowed.executionStillRequiresUserGuardianAdapter);
  check('on-chain chain/protocol/fee violations are blocked', evaluateOnchainPolicy({ deploymentEvidence: verified.deployment, onchainPolicy: policy, request: { ...request, chainId: 1 }, now }).code === 'CHAIN_NOT_ALLOWED' && evaluateOnchainPolicy({ deploymentEvidence: verified.deployment, onchainPolicy: policy, request: { ...request, feeUsd: 11 }, now }).code === 'FEE_LIMIT_EXCEEDED');
  const migrated = await migrateOnchainPolicy({ provider, deploymentEvidence: verified.deployment, fromVersion: '1', toPolicy: { ...policy, version: '2' }, now });
  check('policy migration needs confirmed provider evidence', migrated.ok && migrated.status === 'confirmed' && migrated.localStorageNotAuthoritative);
  check('migration without provider is unavailable', (await migrateOnchainPolicy({ deploymentEvidence: verified.deployment, fromVersion: '1', toPolicy: { ...policy, version: '2' }, now })).status === 'unavailable');
  const revoked = await revokeOnchainSession({ provider, deploymentEvidence: verified.deployment, sessionId: 'session-17', now });
  check('session revoke is provider-confirmed, not a local flag', revoked.ok && revoked.revoked && revoked.confirmed && revoked.receiptRef);
  check('revoke without provider is unavailable', (await revokeOnchainSession({ deploymentEvidence: verified.deployment, sessionId: 'session-17', now })).status === 'unavailable');
  check('on-chain contract address is public data and no secrets are exposed', !/private.?key|seed.?phrase|master.?password/i.test(JSON.stringify({ verified, allowed, migrated, revoked })));

  console.log(JSON.stringify({ probe: 'phase17-onchain-policy', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase17-onchain-policy', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
