import { operateWorkforceAccess } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('sso', operateWorkforceAccess({}).code === 'WORKFORCE_SSO_UNATTESTED');
  check('least privilege', operateWorkforceAccess({ sso: { attested: true, mfa: true } }).code === 'LEAST_PRIVILEGE_NOT_PROVEN');
  check('no unrestricted signer', operateWorkforceAccess({ sso: { attested: true, mfa: true }, role: { leastPrivilege: true, unrestrictedSigner: true } }).code === 'WORKFORCE_MUST_NOT_HOLD_UNRESTRICTED_SIGNER');
  console.log(JSON.stringify({ probe: 'phase44-workforce-access', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
