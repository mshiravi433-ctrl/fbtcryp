import { operateModelSupplyChain } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('model', operateModelSupplyChain({}).code === 'MODEL_ATTESTATION_MISSING');
  check('prompt', operateModelSupplyChain({ model: { attested: true, digest: 'aa' } }).code === 'PROMPT_NOT_PINNED');
  check('model cannot authorize', operateModelSupplyChain({ model: { attested: true, digest: 'aa', mayAuthorizeExecution: true }, prompt: { pinned: true } }).code === 'MODEL_MUST_NOT_AUTHORIZE_EXECUTION');
  console.log(JSON.stringify({ probe: 'phase46-model-supply', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
