import { evaluateLaunchControlPlane } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  const frozen = evaluateLaunchControlPlane({ evidence: [], freeze: true });
  check('freeze blocks launch', frozen.launchAllowed === false && frozen.goLive === false);
  const empty = evaluateLaunchControlPlane({ evidence: [] });
  check('empty evidence blocked', empty.banner[0] === 'Launch blocked.' && empty.live === false);
  check('no execution claim', empty.claims.executionActivated === false && empty.claims.production === false);
  console.log(JSON.stringify({ probe: 'phase30-launch-control-plane', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase30-launch-control-plane', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
