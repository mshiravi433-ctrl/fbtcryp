import { operateRegulatoryReporting } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('filing', operateRegulatoryReporting({}).code === 'REGULATORY_FILING_MISSING');
  check('counsel', operateRegulatoryReporting({ filing: { submitted: true, attested: true } }).code === 'INDEPENDENT_COUNSEL_REQUIRED');
  check('no compliant claim', operateRegulatoryReporting({ filing: { submitted: true, attested: true }, counsel: { independent: true } }).compliantClaim === false);
  console.log(JSON.stringify({ probe: 'phase49-regulatory-reporting', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
