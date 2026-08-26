import { operateFailover } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('primary missing', operateFailover({}).code === 'PRIMARY_REGION_UNAVAILABLE');
  check('drill missing', operateFailover({ primary: { healthy: true, attested: true }, secondary: { ready: true, attested: true } }).code === 'FAILOVER_DRILL_MISSING');
  check('not live', operateFailover({ primary: { healthy: true, attested: true }, secondary: { ready: true, attested: true }, drill: { completed: true, rtoMet: true } }).live === false);
  console.log(JSON.stringify({ probe: 'phase33-failover-capacity', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase33-failover-capacity', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
