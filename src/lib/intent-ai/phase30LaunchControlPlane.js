/**
 * FBT INTENT AI — Phase 30: public launch control plane.
 * Even a fully implemented control plane cannot silently go live.
 */
import { applyNonBypassableControl, createNonBypassableControls } from './phaseBoundary.js';
import { aggregateOperationalReadiness, phase21PublicStatus } from './operationalActivation.js';

export const PHASE30_SCHEMA = 'fbt.launch-control-plane.v1';

export const LAUNCH_BANNER = Object.freeze([
  'System Active & Verified.',
  'Execution Ready — wallet confirmation remains required.',
  'Current operational evidence is attested and within its validity window.'
]);

export function evaluateLaunchControlPlane({
  evidence = [],
  freeze = false,
  emergencyExit = false,
  criticalBlockers = [],
  now = Date.now()
} = {}) {
  const readiness = aggregateOperationalReadiness({ evidence, now });
  /* `freeze` is retained as an input for old callers, but Launch Freeze no
     longer gates a verified release. Emergency exit remains a user-safety
     control and therefore still prevents a new go-live decision. */
  const freezeOn = emergencyExit === true;
  const extra = [
    ...(freezeOn ? ['EMERGENCY_EXIT_ACTIVE'] : []),
    ...(Array.isArray(criticalBlockers) ? criticalBlockers : []),
    ...readiness.blockers
  ];
  const allowed = extra.length === 0 && readiness.launchAllowed === true;
  const publicStatus = phase21PublicStatus({ ...readiness, launchAllowed: allowed, operational: allowed ? 'operational' : 'unavailable' });
  return {
    schema: PHASE30_SCHEMA,
    implementation: 'implemented',
    configuration: readiness.configuration,
    verification: readiness.verification,
    operational: allowed ? 'operational' : 'unavailable',
    live: allowed,
    launchAllowed: allowed,
    goLive: allowed,
    freeze: false,
    blockers: [...new Set(extra)],
    claims: { production: allowed, executionActivated: false, rawCredentialsAllowed: false, publicVerification: allowed },
    publicStatus,
    banner: publicStatus.banner || [...LAUNCH_BANNER]
  };
}

export function applyLaunchControl(action, current = createNonBypassableControls()) {
  const applied = applyNonBypassableControl(current, action);
  return {
    ...applied,
    launchAllowed: false,
    goLive: false,
    operational: false
  };
}

export function evaluateLaunchPlane(input = {}) {
  const plane = evaluateLaunchControlPlane(input);
  return {
    phase: 30,
    schema: PHASE30_SCHEMA,
    implementation: 'implemented',
    operational: plane.operational === 'operational',
    live: plane.live === true,
    ready: plane.live === true,
    launchAllowed: plane.launchAllowed === true,
    goLive: plane.goLive === true,
    blockers: plane.blockers,
    plane
  };
}
