import { operateAbuseLimits } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('undefined', operateAbuseLimits({}).code === 'RATE_LIMIT_UNDEFINED');
  check('not enforced', operateAbuseLimits({ limiter: { perMinute: 10 } }).code === 'RATE_LIMIT_NOT_ENFORCED');
  check('no bypass', operateAbuseLimits({ limiter: { perMinute: 10 }, enforcement: { attested: true, active: true, bypassable: true } }).code === 'RATE_LIMIT_MUST_NOT_BYPASS');
  console.log(JSON.stringify({ probe: 'phase34-abuse-rate-limits', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase34-abuse-rate-limits', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
