/** Phase 46 — model / prompt supply chain. A model name is not an attestation. */
import { unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE46_SCHEMA = 'fbt.model-supply-chain.v1';

export function operateModelSupplyChain({ model = null, prompt = null } = {}) {
  if (!model || model.attested !== true || !model.digest) {
    return unavailable('MODEL_ATTESTATION_MISSING', null, { schema: PHASE46_SCHEMA });
  }
  if (!prompt || prompt.pinned !== true) return unavailable('PROMPT_NOT_PINNED');
  if (model.mayAuthorizeExecution === true) return unavailable('MODEL_MUST_NOT_AUTHORIZE_EXECUTION');
  return { ok: true, schema: PHASE46_SCHEMA, operational: false, executionAuthorized: false };
}

export function evaluateModelSupplyChainPlane(input = {}) {
  const row = operateModelSupplyChain(input);
  return opsPlane(46, PHASE46_SCHEMA, [row.code || 'MODEL_SUPPLY_NOT_OPERATIONAL'], { model: row });
}
