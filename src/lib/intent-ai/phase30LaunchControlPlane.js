/**
 * FBT INTENT AI — Phase 30: public launch control plane.
 * Even a fully implemented control plane cannot silently go live.
 */
import { unavailable } from './phaseBoundary.js';
import { aggregateOperationalReadiness, phase21PublicStatus } from './operationalActivation.js';

export const PHASE30_SCHEMA = 'fbt.launch-control-plane.v1';

export function evaluateLaunchControlPlane({
  evidence = [],
  freeze = false,
  emergencyExit = false,
  criticalBlockers = [],
  now = Date.now()
} = {}) {
  const readiness = aggregateOperationalReadiness({ evidence, now });
  const freezeOn = freeze === true || emergencyExit === true;
  const extra = [
    ...(freezeOn ? ['LAUNCH_FREEZE_ACTIVE'] : []),
    ...(Array.isArray(criticalBlockers) ? criticalBlockers : []),
    ...readiness.blockers
  ];
  const allowed = extra.length === 0 && readiness.launchAllowed === true && freezeOn === false;
  const publicStatus = phase21PublicStatus({ ...readiness, launchAllowed: allowed, operational: allowed ? 'operational' : 'unavailable' });
  return {
    schema: PHASE30_SCHEMA,
    implementation: 'implemented',
    configuration: readiness.configuration,
    verification: readiness.verification,
    operational: 'unavailable',
    live: false,
    launchAllowed: false,
    goLive: false,
    freeze: freezeOn,
    blockers: [...new Set(extra.length ? extra : ['CRITICAL_EVIDENCE_MISSING'])],
    claims: { production: false, executionActivated: false, rawCredentialsAllowed: false, publicVerification: false },
    publicStatus,
    banner: publicStatus.banner
  };
}
