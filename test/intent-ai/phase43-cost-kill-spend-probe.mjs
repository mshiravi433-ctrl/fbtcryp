import { operateCostKillSpend } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('cap missing', operateCostKillSpend({}).code === 'SPEND_CAP_UNDEFINED');
  check('breach', operateCostKillSpend({ budget: { capUsd: 10 }, spent: { usd: 11 } }).code === 'SPEND_CAP_BREACHED_WITHOUT_KILL');
  check('no bypass', operateCostKillSpend({ budget: { capUsd: 10 }, kill: { bypassable: true } }).code === 'KILL_SPEND_MUST_NOT_BYPASS');
  console.log(JSON.stringify({ probe: 'phase43-cost-kill-spend', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
