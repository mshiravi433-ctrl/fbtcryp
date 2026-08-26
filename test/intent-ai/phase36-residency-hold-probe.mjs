import { operateResidencyHold } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('not enforced', operateResidencyHold({}).code === 'RESIDENCY_NOT_ENFORCED');
  check('hold blocks export', operateResidencyHold({ residency: { enforced: true, attested: true }, hold: { active: true, exportBlocked: false } }).code === 'LEGAL_HOLD_EXPORT_NOT_BLOCKED');
  check('no secret export', operateResidencyHold({ residency: { enforced: true, attested: true, allowsRawSecrets: true } }).code === 'RAW_CREDENTIAL_FORBIDDEN');
  console.log(JSON.stringify({ probe: 'phase36-residency-hold', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase36-residency-hold', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
