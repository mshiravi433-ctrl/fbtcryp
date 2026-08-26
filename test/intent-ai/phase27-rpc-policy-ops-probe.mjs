import { operateRpcQuorum, enforceOnchainPolicy } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('rpc outage', operateRpcQuorum({}).code === 'RPC_OUTAGE');
  check('code hash', operateRpcQuorum({ rpc: { available: true, attested: true }, deployment: { providerId: 'rpc', address: '0xabc', codeHash: 'aa', expectedCodeHash: 'bb', chainId: 1 } }).code === 'CONTRACT_CODE_HASH_MISMATCH');
  check('policy mismatch', enforceOnchainPolicy({ localDigest: 'aa', onchainDigest: 'bb' }).code === 'LOCAL_ONCHAIN_POLICY_MISMATCH');
  check('match is not live', enforceOnchainPolicy({ localDigest: 'aa', onchainDigest: 'aa' }).operational === false);
  check('quorum needs two healthy endpoints', operateRpcQuorum({ rpc: { available: true, attested: true }, endpoints: [{ healthy: true, attested: true }], deployment: { providerId: 'rpc', address: '0xabc', codeHash: 'aa', expectedCodeHash: 'aa', chainId: 1 } }).code === 'RPC_QUORUM_UNAVAILABLE');
  console.log(JSON.stringify({ probe: 'phase27-rpc-policy-ops', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase27-rpc-policy-ops', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
