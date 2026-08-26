import { operateDependencyAttestation } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('sbom missing', operateDependencyAttestation({}).code === 'SBOM_ATTESTATION_MISSING');
  check('supplier incomplete', operateDependencyAttestation({ sbom: { attested: true, digest: 'aa' }, suppliers: [{ attested: false }] }).code === 'SUPPLIER_ATTESTATION_INCOMPLETE');
  check('not verified live', operateDependencyAttestation({ sbom: { attested: true, digest: 'aa' }, suppliers: [{ attested: true }] }).verified === false);
  console.log(JSON.stringify({ probe: 'phase37-dependency-attestation', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase37-dependency-attestation', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
