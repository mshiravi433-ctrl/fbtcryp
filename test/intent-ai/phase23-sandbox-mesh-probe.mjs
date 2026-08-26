import { runSandboxMesh, SANDBOX_STAGES } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
try {
  check('operator missing', runSandboxMesh({}).code === 'SANDBOX_OPERATOR_UNAVAILABLE');
  check('no production signer', runSandboxMesh({ operator: { available: true, attested: true, productionSigner: true, operatorId: 'box' } }).code === 'SANDBOX_MUST_NOT_TOUCH_PRODUCTION');
  const stages = SANDBOX_STAGES.map((id) => ({ id, isolated: true }));
  const ok = runSandboxMesh({ operator: { available: true, attested: true, operatorId: 'box-23', runtimeVersion: '1.0.0', expiresAt: now + 1000 }, stages, now });
  check('not a verified agent', ok.ok && ok.verifiedAgent === false && ok.handshake === false);
  console.log(JSON.stringify({ probe: 'phase23-sandbox-mesh', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase23-sandbox-mesh', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
