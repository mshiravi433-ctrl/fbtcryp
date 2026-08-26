import { operateSecretRotation } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
try {
  check('unverified manager', operateSecretRotation({}).code === 'SECRET_MANAGER_NOT_VERIFIED');
  check('raw secret forbidden', operateSecretRotation({ manager: { attested: true, durable: true, providerId: 'kms', privateKey: 'x' } }).code === 'RAW_CREDENTIAL_FORBIDDEN');
  check('dual control', operateSecretRotation({ manager: { attested: true, durable: true, providerId: 'kms-32' }, rotation: { completed: true, rotatedAt: now - 1, dualControl: false }, now }).code === 'ROTATION_DUAL_CONTROL_REQUIRED');
  console.log(JSON.stringify({ probe: 'phase32-secret-rotation', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase32-secret-rotation', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
