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
  return {
    ok: true,
    schema: PHASE50_SCHEMA,
    programComplete: programComplete === true,
    launchAllowed: false,
    goLive: false,
    live: false,
    operational: false,
    blockers: launch.blockers,
    banner: [...LAUNCH_BANNER]
  };
}

export function evaluateProgramControlPlane(input = {}) {
  const row = operateProgramControl(input);
  return opsPlane(50, PHASE50_SCHEMA, row.blockers, {
    program: row,
    launchAllowed: false,
    goLive: false,
    banner: [...LAUNCH_BANNER]
  });
}
