/**
 * FBT INTENT AI — Phase 23: sandbox operator mesh.
 * Unavailable sandbox never becomes a successful handshake or verified Agent.
 */
import { fail, finite, safeId, unavailable } from './phaseBoundary.js';

export const PHASE23_SCHEMA = 'fbt.sandbox-mesh.v1';
export const SANDBOX_STAGES = Object.freeze(['discovery', 'isolation', 'capability-check', 'timeout-drill', 'cleanup']);

export function runSandboxMesh({ operator = null, stages = [], now = Date.now() } = {}) {
  if (!operator || operator.available !== true || operator.attested !== true) {
    return unavailable('SANDBOX_OPERATOR_UNAVAILABLE', null, { schema: PHASE23_SCHEMA, handshake: false, verifiedAgent: false });
  }
  if (operator.mainnetAccess === true || operator.productionSigner === true || operator.realCustody === true) {
    return fail('SANDBOX_MUST_NOT_TOUCH_PRODUCTION');
  }
  const seen = Array.isArray(stages) ? stages.map((stage) => stage?.id).filter(Boolean) : [];
  const missing = SANDBOX_STAGES.filter((id) => !seen.includes(id));
  if (missing.length) return unavailable('SANDBOX_STAGES_INCOMPLETE', missing.join(','), { schema: PHASE23_SCHEMA, handshake: false });
  if (stages.some((stage) => stage?.isolated !== true)) return fail('SANDBOX_ISOLATION_FAILED');
  if (finite(operator.expiresAt) !== null && operator.expiresAt <= now) return unavailable('SANDBOX_OPERATOR_EXPIRED');
  return {
    ok: true,
    schema: PHASE23_SCHEMA,
    operatorId: safeId(operator.operatorId),
    runtimeVersion: String(operator.runtimeVersion || '').slice(0, 32) || null,
    stages: [...SANDBOX_STAGES],
    handshake: false,
    verifiedAgent: false,
    operational: false
  };
}
