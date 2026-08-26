import { operateSustainment, evaluateSustainmentPlane } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('owner required', operateSustainment({}).code === 'SUSTAINMENT_OWNER_REQUIRED');
  check('cadence required', operateSustainment({ owner: { accountable: true } }).code === 'SUSTAINMENT_CADENCE_MISSING');
  const plane = evaluateSustainmentPlane({ owner: { accountable: true }, reviewCadence: { scheduled: true } });
  check('phase 40 never go-live', plane.goLive === false && plane.launchAllowed === false && plane.live === false && plane.banner[0] === 'Launch blocked.');
  console.log(JSON.stringify({ probe: 'phase40-sustainment-governance', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase40-sustainment-governance', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
