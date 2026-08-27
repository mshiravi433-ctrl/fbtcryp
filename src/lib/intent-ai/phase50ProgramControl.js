/** Phase 50 — end-state program control. Completing the roadmap never auto-goes live. */
import { evaluateLaunchControlPlane, LAUNCH_BANNER } from './phase30LaunchControlPlane.js';
import { opsPlane } from './opsPlane.js';

export const PHASE50_SCHEMA = 'fbt.program-control.v1';

export function operateProgramControl({
  evidence = [],
  freeze = true,
  programComplete = false,
  now = Date.now()
} = {}) {
  const launch = evaluateLaunchControlPlane({ evidence, freeze, now });
  const live = launch.launchAllowed === true && programComplete === true;
  return {
    ok: true,
    schema: PHASE50_SCHEMA,
    programComplete: programComplete === true,
    launchAllowed: live,
    goLive: live,
    live,
    operational: live,
    blockers: live ? [] : launch.blockers,
    banner: [...launch.banner]
  };
}

export function evaluateProgramControlPlane(input = {}) {
  const row = operateProgramControl(input);
  return opsPlane(50, PHASE50_SCHEMA, row.blockers, {
    program: row,
    operational: row.operational,
    live: row.live,
    ready: row.live,
    launchAllowed: row.launchAllowed,
    goLive: row.goLive,
    blockers: row.live ? [] : row.blockers,
    banner: [...row.banner]
  });
}
