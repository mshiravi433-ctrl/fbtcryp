import { operateIncidentCommand } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('undeclared', operateIncidentCommand({}).code === 'INCIDENT_UNDECLARED');
  check('assumed not verified', operateIncidentCommand({ incident: { id: 'inc-31', assumedResolved: true }, commander: { independent: true, id: 'cmd-31' } }).code === 'INCIDENT_ASSUMED_NOT_VERIFIED');
  check('not operational', operateIncidentCommand({ incident: { id: 'inc-31' }, commander: { independent: true, id: 'cmd-31' } }).operational === false);
  console.log(JSON.stringify({ probe: 'phase31-incident-command', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase31-incident-command', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
