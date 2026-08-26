import { operateBreakGlass } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('ticket', operateBreakGlass({}).code === 'SUPPORT_TICKET_REQUIRED');
  check('no bypass', operateBreakGlass({ ticket: { id: 't-42' }, actor: { attested: true, bypassesGuardian: true } }).code === 'SUPPORT_MUST_NOT_BYPASS_GUARDIAN');
  check('guardian required', operateBreakGlass({ ticket: { id: 't-42' }, actor: { attested: true } }).code === 'GUARDIAN_REQUIRED_FOR_BREAK_GLASS');
  console.log(JSON.stringify({ probe: 'phase42-break-glass', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
