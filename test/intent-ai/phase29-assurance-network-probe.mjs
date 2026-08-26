import { operateAssurance, THREATS } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('not independent', operateAssurance({ review: { independent: false } }).code === 'SECURITY_REVIEW_NOT_INDEPENDENT');
  check('internal checklist', operateAssurance({ review: { independent: true, signed: true, reviewerId: 'rev-29', threats: [...THREATS] }, privacy: { reviewed: true }, compliance: { internalChecklist: true, independent: false } }).code === 'INTERNAL_CHECKLIST_IS_NOT_CERTIFICATION');
  const ok = operateAssurance({ review: { independent: true, signed: true, reviewerId: 'rev-29', threats: [...THREATS] }, privacy: { reviewed: true }, compliance: { independent: true } });
  check('no secure claim', ok.claims.secure === false && ok.verified === false);
  check('reviewer cannot be operator', operateAssurance({ review: { independent: true, signed: true, reviewerId: 'op-1', threats: [...THREATS] }, privacy: { reviewed: true }, compliance: { independent: true }, operatorId: 'op-1' }).code === 'REVIEWER_MUST_NOT_BE_OPERATOR');
  console.log(JSON.stringify({ probe: 'phase29-assurance-network', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase29-assurance-network', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
