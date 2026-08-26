import { operateSimulator, operateMonitor, operateScheduler } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
try {
  check('simulator timeout', operateSimulator({ result: { timeout: true } }).code === 'SIMULATOR_TIMEOUT');
  check('monitor stale', operateMonitor({ heartbeatAt: now - 120000, maxAgeMs: 30000, now }).code === 'MONITOR_STALE');
  check('scheduler unauthorized', operateScheduler({}).transactionCreated === false);
  check('scheduler no sign', operateScheduler({ userAuthorization: true, guardianApproved: true, policyRechecked: true, signs: true }).code === 'SCHEDULER_MUST_NOT_SIGN');
  console.log(JSON.stringify({ probe: 'phase24-sim-monitor-ops', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase24-sim-monitor-ops', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
