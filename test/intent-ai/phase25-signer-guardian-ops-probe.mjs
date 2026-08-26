import { operateSmartWallet, operateProductionSigner, authorizationFeesPresent } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('no guardian', operateSmartWallet({ wallet: { available: true, providerId: 'sw' } }).code === 'SMART_WALLET_WITHOUT_GUARDIAN');
  check('guardian != user', operateSmartWallet({ wallet: { available: true, providerId: 'sw' }, guardian: { independent: true, approved: true }, userConfirmed: false }).code === 'GUARDIAN_CANNOT_REPLACE_USER');
  check('signer policy', operateProductionSigner({ signer: { policyBound: false } }).code === 'SIGNER_WITHOUT_POLICY');
  const env = { recipient: '0x1', calldata: '0x', chain: 1, amount: '1', fee: '1', slippage: '1' };
  check('mutated envelope', operateProductionSigner({ signer: { policyBound: true, kmsBound: true }, envelope: { ...env, amount: '2' }, authorized: env }).code === 'SIGNER_REJECTS_MUTATED_ENVELOPE');
  check('fees', authorizationFeesPresent({ network: 1, protocol: 1, bridge: 0, 'external-agent': 0, performance: 0, execution: 1, slippage: 1, other: 0 }).ok);
  check('guardian cannot be the user', operateSmartWallet({ wallet: { available: true, providerId: 'sw' }, guardian: { independent: true, identity: 'user-1' }, userId: 'user-1' }).code === 'GUARDIAN_MUST_NOT_BE_USER');
  check('mock signer forbidden', operateProductionSigner({ signer: { policyBound: true, kmsBound: true, mock: true }, envelope: { recipient: '0x1', calldata: '0x', chain: 1, amount: '1', fee: '1', slippage: '1' }, authorized: { recipient: '0x1', calldata: '0x', chain: 1, amount: '1', fee: '1', slippage: '1' } }).code === 'RAW_CREDENTIAL_FORBIDDEN');
  console.log(JSON.stringify({ probe: 'phase25-signer-guardian-ops', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase25-signer-guardian-ops', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
