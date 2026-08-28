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
import { evaluateReleaseTrainPlane } from './phase41ReleaseTrain.js';
import { evaluateBreakGlassPlane } from './phase42BreakGlassSupport.js';
import { evaluateCostKillSpendPlane } from './phase43CostKillSpend.js';
import { evaluateWorkforceAccessPlane } from './phase44WorkforceAccess.js';
import { evaluateTelemetryIntegrityPlane } from './phase45TelemetryIntegrity.js';
import { evaluateModelSupplyChainPlane } from './phase46ModelSupplyChain.js';
import { evaluateAgentFleetPlane } from './phase47AgentFleetGov.js';
import { evaluateCapitalBondPlane } from './phase48CapitalBondOps.js';
import { evaluateRegulatoryReportingPlane } from './phase49RegulatoryReporting.js';
import { evaluateProgramControlPlane } from './phase50ProgramControl.js';

export const CONTROL_PLANE_SCHEMA = 'fbt.control-plane-activation.v3';

const LIVE_BANNER = Object.freeze([
  'System Active & Verified.',
  'Execution Ready — wallet confirmation remains required.',
  'Current operational evidence is attested and within its validity window.'
]);

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
  release = {},
  support = {},
  cost = {},
  workforce = {},
  telemetry = {},
  model = {},
  fleet = {},
  capital = {},
  regulatory = {},
  program = {},
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
    evaluateSustainmentPlane({ ...sustainment, evidence, now }),
    evaluateReleaseTrainPlane(release),
    evaluateBreakGlassPlane(support),
    evaluateCostKillSpendPlane(cost),
    evaluateWorkforceAccessPlane(workforce),
    evaluateTelemetryIntegrityPlane(telemetry),
    evaluateModelSupplyChainPlane(model),
    evaluateAgentFleetPlane(fleet),
    evaluateCapitalBondPlane(capital),
    evaluateRegulatoryReportingPlane(regulatory),
    evaluateProgramControlPlane({ ...program, evidence, freeze, now })
  ];
  const aggregateLive = readiness.launchAllowed === true && readiness.operational === 'operational';
  /*
   * Each plane reports its OWN evaluation. A previous revision overwrote every
   * row with operational/live/ready = true (and emptied `blockers`) as soon as
   * the 21 aggregate evidence kinds were present. That produced rows whose
   * envelope said `live: true` while the evaluator result nested inside the
   * same object still said `ok: false` with a real blocker code such as
   * RESIDENCY_NOT_ENFORCED or SBOM_ATTESTATION_MISSING — 26 of 30 rows were
   * self-contradictory, and the contradiction was served publicly.
   *
   * A plane is live only when the aggregate evidence allows launch AND that
   * plane's own evaluator returned a live result. Nothing is painted over.
   */
  const publishedPlanes = planes.map((row) => {
    const planeLive = aggregateLive && row.live === true && !(row.blockers || []).length;
    return {
      ...row,
      operational: planeLive,
      live: planeLive,
      ready: planeLive,
      launchAllowed: planeLive,
      blockers: [...(row.blockers || [])],
      claims: {
        ...(row.claims || {}),
        verified: planeLive,
        production: planeLive,
        executionActivated: false,
        rawCredentialsAllowed: false
      }
    };
  });
  const blockers = [...new Set(publishedPlanes.flatMap((row) => row.blockers || []))];
  /* The plane as a whole is live only when every constituent plane is. */
  const live = aggregateLive && publishedPlanes.every((row) => row.live === true);
  return {
    schema: CONTROL_PLANE_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    activated: true,
    operational: live,
    live,
    launchAllowed: live,
    executionActivated: false,
    rawCredentialsAllowed: false,
    planes: publishedPlanes,
    blockers,
    publicStatus: phase21PublicStatus(readiness),
    banner: live ? [
      'System Active & Verified.',
      'Execution Ready — wallet confirmation remains required.',
      'Current operational evidence is attested and within its validity window.'
    ] : [...LAUNCH_BANNER]
  };
}

export function controlPlaneRow(phase, snapshot) {
  const plane = (snapshot?.planes || []).find((row) => row.phase === Number(phase));
  const live = snapshot?.live === true && plane?.live === true;
  return {
    configuration: live ? 'verified' : 'not-configured',
    operational: live,
    ready: live,
    live,
    dataStatus: live ? 'live' : 'unavailable',
    blockers: live ? [] : (plane?.blockers?.length ? plane.blockers : [`PHASE_${phase}_EVIDENCE_REQUIRED`]),
    claims: {
      verified: live,
      production: live,
      executionActivated: false,
      rawCredentialsAllowed: false
    }
  };
}
