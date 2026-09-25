/** Phase 40 — sustainment / decommission governance. Shipping code is not sustainment. */
import { fail, safeId, unavailable } from './phaseBoundary.js';
import { evaluateLaunchControlPlane, LAUNCH_BANNER } from './phase30LaunchControlPlane.js';
import { opsPlane } from './opsPlane.js';

export const PHASE40_SCHEMA = 'fbt.sustainment-governance.v1';

export function operateSustainment({
  owner = null,
  decommission = null,
  reviewCadence = null,
  successor = null,
  budget = null
} = {}) {
  if (!owner || owner.accountable !== true || !safeId(owner.id)) {
    return unavailable('SUSTAINMENT_OWNER_REQUIRED', null, { schema: PHASE40_SCHEMA });
  }
  if (!reviewCadence || reviewCadence.scheduled !== true) return unavailable('SUSTAINMENT_CADENCE_MISSING');
  if (decommission?.requested === true && decommission?.drilled !== true) {
    return unavailable('DECOMMISSION_DRILL_MISSING');
  }
  if (owner.singlePerson === true && !successor) return unavailable('SUCCESSOR_OWNER_REQUIRED');
  if (budget?.unlimited === true) return fail('UNBOUNDED_SUSTAINMENT_BUDGET');
  return { ok: true, schema: PHASE40_SCHEMA, operational: false, live: false, sustained: false, ownerId: safeId(owner.id) };
}

export function evaluateSustainmentPlane(input = {}) {
  const row = operateSustainment(input);
  const launch = evaluateLaunchControlPlane({ evidence: input.evidence || [], freeze: true, now: input.now });
  /* Honest verdict: sustainment is live when the owner+cadence checks pass
     AND the launch evidence allows it. Without evidence the launch blockers
     keep this plane closed, exactly as before. */
  const blockers = [row.code, ...launch.blockers].filter(Boolean);
  const pass = row.ok === true && launch.launchAllowed === true;
  return opsPlane(40, PHASE40_SCHEMA, blockers, {
    pass,
    sustainment: row,
    launch,
    launchAllowed: pass,
    goLive: pass,
    banner: pass ? [...(launch.banner || LAUNCH_BANNER)] : [...LAUNCH_BANNER]
  });
}
