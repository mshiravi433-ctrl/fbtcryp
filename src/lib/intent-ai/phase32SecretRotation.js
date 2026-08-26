/** Phase 32 — secret manager / key rotation. Env names are not rotation proof. */
import { containsRawSecret, fail, finite, safeId, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE32_SCHEMA = 'fbt.secret-rotation.v1';

export function operateSecretRotation({ manager = null, rotation = null, now = Date.now() } = {}) {
  if (containsRawSecret(manager) || containsRawSecret(rotation)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  if (!manager || manager.attested !== true || manager.durable !== true || !safeId(manager.providerId)) {
    return unavailable('SECRET_MANAGER_NOT_VERIFIED', null, { schema: PHASE32_SCHEMA });
  }
  if (!rotation || rotation.completed !== true || !finite(rotation.rotatedAt) || rotation.rotatedAt > now) {
    return unavailable('KEY_ROTATION_NOT_PROVEN');
  }
  if (rotation.dualControl !== true) return unavailable('ROTATION_DUAL_CONTROL_REQUIRED');
  return { ok: true, schema: PHASE32_SCHEMA, providerId: safeId(manager.providerId), operational: false, secretsExposed: false };
}

export function evaluateSecretRotationPlane(input = {}) {
  const row = operateSecretRotation(input);
  return opsPlane(32, PHASE32_SCHEMA, [row.code || 'SECRET_ROTATION_NOT_OPERATIONAL'], { rotation: row });
}
