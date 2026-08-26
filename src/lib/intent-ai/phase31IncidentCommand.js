/** Phase 31 — incident command. A ticket is not a resolved incident. */
import { fail, safeId, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE31_SCHEMA = 'fbt.incident-command.v1';

export function operateIncidentCommand({ incident = null, commander = null, freeze = false } = {}) {
  if (!incident || !safeId(incident.id)) return unavailable('INCIDENT_UNDECLARED', null, { schema: PHASE31_SCHEMA });
  if (!commander || commander.independent !== true || !safeId(commander.id)) {
    return unavailable('INCIDENT_COMMANDER_REQUIRED');
  }
  if (incident.assumedResolved === true && incident.verified !== true) {
    return fail('INCIDENT_ASSUMED_NOT_VERIFIED');
  }
  return {
    ok: true,
    schema: PHASE31_SCHEMA,
    incidentId: safeId(incident.id),
    freezeRequired: freeze === true || incident.severity === 'critical',
    resolved: false,
    operational: false,
    live: false
  };
}

export function evaluateIncidentCommandPlane(input = {}) {
  const row = operateIncidentCommand(input);
  return opsPlane(31, PHASE31_SCHEMA, [row.code || 'INCIDENT_NOT_OPERATIONAL'], { incident: row });
}
