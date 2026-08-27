import { operateProgramControl, activateControlPlane } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  const done = operateProgramControl({ programComplete: true, freeze: true });
  check('complete is not go-live', done.programComplete === true && done.goLive === false && done.launchAllowed === false);
  check('banner', done.banner[0] === 'Activation pending verification.');
  const plane = activateControlPlane({ freeze: true });
  check('planes 21-50 wired', plane.planes.length === 30 && plane.live === false && plane.activated === true);
  console.log(JSON.stringify({ probe: 'phase50-program-control', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
