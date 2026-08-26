/** Phase 47 — external agent fleet. A directory listing is not a fleet grant. */
import { fail, unavailable } from './phaseBoundary.js';
import { opsPlane } from './opsPlane.js';

export const PHASE47_SCHEMA = 'fbt.agent-fleet-gov.v1';

export function operateAgentFleet({ fleet = null, sandbox = null } = {}) {
  if (!fleet || fleet.attested !== true) return unavailable('FLEET_UNATTESTED', null, { schema: PHASE47_SCHEMA });
  if (!sandbox || sandbox.isolated !== true) return unavailable('FLEET_SANDBOX_REQUIRED');
  if (fleet.liveExecution === true) return fail('FLEET_MUST_NOT_CLAIM_LIVE_EXECUTION');
  if (fleet.holdsSeeds === true) return fail('EXTERNAL_AGENT_MUST_NOT_HOLD_SEEDS');
  return { ok: true, schema: PHASE47_SCHEMA, operational: false, live: false, verifiedAgent: false };
}

export function evaluateAgentFleetPlane(input = {}) {
  const row = operateAgentFleet(input);
  return opsPlane(47, PHASE47_SCHEMA, [row.code || 'FLEET_NOT_OPERATIONAL'], { fleet: row });
}
