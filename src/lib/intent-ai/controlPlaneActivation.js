/**
 * FBT INTENT AI — Phases 21–40 unified control plane.
 * Activating the plane means wiring evaluators, not going live.
 */
import { aggregateOperationalReadiness, phase21PublicStatus } from './operationalActivation.js';
import { evaluateRegistryCaPlane } from './phase22RegistryCaOps.js';
import { evaluateSandboxMeshPlane } from './phase23SandboxMesh.js';
import { evaluateSimMonitorPlane } from './phase24SimMonitorOps.js';
import { evaluateSignerGuardianPlane } from './phase25SignerGuardianOps.js';
import { evaluateVenueFederationPlane } from './phase26VenueFederation.js';
import { evaluateRpcPolicyPlane } from './phase27RpcPolicyOps.js';
import { evaluateAuditDrPlane } from './phase28AuditDrOps.js';
import { evaluateAssurancePlane } from './phase29AssuranceNetwork.js';
import { evaluateLaunchControlPlane, LAUNCH_BANNER } from './phase30LaunchControlPlane.js';
import { evaluateIncidentCommandPlane } from './phase31IncidentCommand.js';
import { evaluateSecretRotationPlane } from './phase32SecretRotation.js';
import { evaluateFailoverCapacityPlane } from './phase33FailoverCapacity.js';
import { evaluateAbuseRateLimitPlane } from './phase34AbuseRateLimits.js';
import { evaluatePublicDisclosurePlane } from './phase35PublicDisclosure.js';
import { evaluateResidencyHoldPlane } from './phase36ResidencyLegalHold.js';
import { evaluateDependencyAttestationPlane } from './phase37DependencyAttestation.js';
import { evaluateContinuousVerificationPlane } from './phase38ContinuousVerification.js';
import { evaluateGameDayPlane } from './phase39GameDayRehearsal.js';
import { evaluateSustainmentPlane } from './phase40SustainmentGovernance.js';

export const CONTROL_PLANE_SCHEMA = 'fbt.control-plane-activation.v2';

export function activateControlPlane({
  evidence = [],
  registry = {},
  certificate = null,
  sandbox = {},
  sim = {},
  signer = {},
  venues = {},
  rpc = {},
  audit = {},
  assurance = {},
  incident = {},
  secrets = {},
  failover = {},
  abuse = {},
  disclosure = {},
  residency = {},
  deps = {},
  continuous = {},
  gameday = {},
  sustainment = {},
  freeze = true,
  now = Date.now()
} = {}) {
  const readiness = aggregateOperationalReadiness({ evidence, now });
  const planes = [
    {
      phase: 21,
      schema: readiness.schema,
      implementation: 'implemented',
      operational: false,
      live: false,
      ready: false,
      blockers: readiness.blockers
    },
    evaluateRegistryCaPlane({ registry, certificate, now }),
    evaluateSandboxMeshPlane({ ...sandbox, now }),
    evaluateSimMonitorPlane({ ...sim, now }),
    evaluateSignerGuardianPlane(signer),
    evaluateVenueFederationPlane({ ...venues, now }),
    evaluateRpcPolicyPlane(rpc),
    evaluateAuditDrPlane(audit),
    evaluateAssurancePlane(assurance),
    {
      ...evaluateLaunchControlPlane({ evidence, freeze, now }),
      phase: 30,
      operational: false,
      live: false,
      ready: false
    },
    evaluateIncidentCommandPlane(incident),
    evaluateSecretRotationPlane({ ...secrets, now }),
    evaluateFailoverCapacityPlane(failover),
    evaluateAbuseRateLimitPlane(abuse),
    evaluatePublicDisclosurePlane(disclosure),
    evaluateResidencyHoldPlane(residency),
    evaluateDependencyAttestationPlane(deps),
    evaluateContinuousVerificationPlane({ ...continuous, now }),
    evaluateGameDayPlane(gameday),
    evaluateSustainmentPlane({ ...sustainment, evidence, now })
  ];
  const blockers = [...new Set(planes.flatMap((row) => row.blockers || []))];
  return {
    schema: CONTROL_PLANE_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    activated: true,
    operational: false,
    live: false,
    launchAllowed: false,
    executionActivated: false,
    rawCredentialsAllowed: false,
    planes,
    blockers,
    publicStatus: phase21PublicStatus(readiness),
    banner: [...LAUNCH_BANNER]
  };
}

export function controlPlaneRow(phase, snapshot) {
  const plane = (snapshot?.planes || []).find((row) => row.phase === Number(phase));
  return {
    configuration: 'not-configured',
    operational: 'unavailable',
    ready: false,
    live: false,
    dataStatus: 'unavailable',
    blockers: plane?.blockers?.length ? plane.blockers : [`PHASE_${phase}_EVIDENCE_REQUIRED`],
    claims: {
      verified: false,
      production: false,
      executionActivated: false,
      rawCredentialsAllowed: false
    }
  };
}
