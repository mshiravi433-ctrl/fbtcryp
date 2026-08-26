/** Phase 45 — telemetry integrity. Client-submitted outcomes cannot train as truth. */
import { fail, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE45_SCHEMA = 'fbt.telemetry-integrity.v1';

export function operateTelemetryIntegrity({ stream = null, consent = null } = {}) {
  if (!stream || stream.attested !== true) return unavailable('TELEMETRY_STREAM_UNATTESTED', null, { schema: PHASE45_SCHEMA });
  if (consent?.optIn !== true) return unavailable('TELEMETRY_OPT_IN_REQUIRED');
  if (stream.acceptsClientResolvedOutcomes === true) return fail('CLIENT_OUTCOMES_CANNOT_TRAIN');
  if (stream.containsSecrets === true) return fail('RAW_CREDENTIAL_FORBIDDEN');
  return { ok: true, schema: PHASE45_SCHEMA, operational: false, trusted: false };
}

export function evaluateTelemetryIntegrityPlane(input = {}) {
  const row = operateTelemetryIntegrity(input);
  return opsPlane(45, PHASE45_SCHEMA, [row.code || 'TELEMETRY_NOT_OPERATIONAL'], { telemetry: row });
}
