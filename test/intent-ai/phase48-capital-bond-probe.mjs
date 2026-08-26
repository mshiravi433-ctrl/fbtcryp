import { operateCapitalBond } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('undeclared', operateCapitalBond({}).code === 'BOND_NOT_DECLARED');
  check('assumed', operateCapitalBond({ bond: { declared: true, assumedFunded: true } }).code === 'BOND_ASSUMED_NOT_VERIFIED');
  check('no settle', operateCapitalBond({ bond: { declared: true, attested: true } }).settlesFunds === false);
  console.log(JSON.stringify({ probe: 'phase48-capital-bond', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
