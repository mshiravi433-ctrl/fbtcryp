import { operateContinuousVerification } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
try {
  check('missing', operateContinuousVerification({}).code === 'CONTINUOUS_PROBE_MISSING');
  check('stale', operateContinuousVerification({ probe: { attested: true, lastOkAt: now - 400000, maxAgeMs: 1000 }, now }).code === 'CONTINUOUS_PROBE_STALE');
  check('must not claim live', operateContinuousVerification({ probe: { attested: true, lastOkAt: now, claimsLive: true }, now }).code === 'PROBE_MUST_NOT_CLAIM_LIVE');
  console.log(JSON.stringify({ probe: 'phase38-continuous-verification', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase38-continuous-verification', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
