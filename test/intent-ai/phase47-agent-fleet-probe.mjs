import { operateAgentFleet } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('fleet', operateAgentFleet({}).code === 'FLEET_UNATTESTED');
  check('sandbox', operateAgentFleet({ fleet: { attested: true } }).code === 'FLEET_SANDBOX_REQUIRED');
  check('no seeds', operateAgentFleet({ fleet: { attested: true, holdsSeeds: true }, sandbox: { isolated: true } }).code === 'EXTERNAL_AGENT_MUST_NOT_HOLD_SEEDS');
  console.log(JSON.stringify({ probe: 'phase47-agent-fleet', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
