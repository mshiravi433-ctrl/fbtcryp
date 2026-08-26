/** Phase 40 — sustainment / decommission governance. Shipping code is not sustainment. */
import { unavailable } from './phaseBoundary.js';
import { evaluateLaunchControlPlane, LAUNCH_BANNER } from './phase30LaunchControlPlane.js';
import { opsPlane } from './opsPlane.js';

export const PHASE40_SCHEMA = 'fbt.sustainment-governance.v1';

export function operateSustainment({ owner = null, decommission = null, reviewCadence = null } = {}) {
  if (!owner || owner.accountable !== true) return unavailable('SUSTAINMENT_OWNER_REQUIRED', null, { schema: PHASE40_SCHEMA });
  if (!reviewCadence || reviewCadence.scheduled !== true) return unavailable('SUSTAINMENT_CADENCE_MISSING');
  if (decommission?.requested === true && decommission?.drilled !== true) {
    return unavailable('DECOMMISSION_DRILL_MISSING');
  }
  return { ok: true, schema: PHASE40_SCHEMA, operational: false, live: false, sustained: false };
}

export function evaluateSustainmentPlane(input = {}) {
  const row = operateSustainment(input);
  const launch = evaluateLaunchControlPlane({ evidence: input.evidence || [], freeze: true, now: input.now });
  return opsPlane(40, PHASE40_SCHEMA, [row.code || 'SUSTAINMENT_NOT_OPERATIONAL', ...launch.blockers], {
    sustainment: row,
    launchAllowed: false,
    goLive: false,
    banner: [...LAUNCH_BANNER]
  });
}
