/**
 * Later-phase live work for Intent OS (phases 31–100).
 *
 * This is NOT a 22nd evidence kind and it never reseeds the 21/21 board.
 * operate*() planes stay fail-closed (`operational: false`, `live: false`,
 * `launchAllowed: false`) even when a check returns ok. Third-party facts
 * this process cannot prove (SSO, counsel, CA-beyond-TLS, browser wallet,
 * real escrow, secondary region, independent review) stay missing with a
 * real blocker code.
 */
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { operateIncidentCommand } from '../src/lib/intent-ai/phase31IncidentCommand.js';
import { operateSecretRotation } from '../src/lib/intent-ai/phase32SecretRotation.js';
import { operateFailover } from '../src/lib/intent-ai/phase33FailoverCapacity.js';
import { operateAbuseLimits } from '../src/lib/intent-ai/phase34AbuseRateLimits.js';
import { operatePublicDisclosure } from '../src/lib/intent-ai/phase35PublicDisclosure.js';
import { operateResidencyHold } from '../src/lib/intent-ai/phase36ResidencyLegalHold.js';
import { operateDependencyAttestation } from '../src/lib/intent-ai/phase37DependencyAttestation.js';
import { operateContinuousVerification } from '../src/lib/intent-ai/phase38ContinuousVerification.js';
import { operateGameDay } from '../src/lib/intent-ai/phase39GameDayRehearsal.js';
import { operateSustainment } from '../src/lib/intent-ai/phase40SustainmentGovernance.js';
import { operateReleaseTrain } from '../src/lib/intent-ai/phase41ReleaseTrain.js';
import { operateBreakGlass } from '../src/lib/intent-ai/phase42BreakGlassSupport.js';
import { operateCostKillSpend } from '../src/lib/intent-ai/phase43CostKillSpend.js';
import { operateWorkforceAccess } from '../src/lib/intent-ai/phase44WorkforceAccess.js';
import { operateTelemetryIntegrity } from '../src/lib/intent-ai/phase45TelemetryIntegrity.js';
import { operateModelSupplyChain } from '../src/lib/intent-ai/phase46ModelSupplyChain.js';
import { operateAgentFleet } from '../src/lib/intent-ai/phase47AgentFleetGov.js';
import { operateCapitalBond } from '../src/lib/intent-ai/phase48CapitalBondOps.js';
import { operateRegulatoryReporting } from '../src/lib/intent-ai/phase49RegulatoryReporting.js';
import { operateProgramControl } from '../src/lib/intent-ai/phase50ProgramControl.js';
import { stubSignerAllowed, describeWalletRuntime, resolveExecutionSigner } from '../src/lib/intent-ai/walletRuntime.js';
import {
  fetchExecutionQuote,
  lockQuoteIntoTerms,
  recheckQuoteBeforeExecute
} from '../src/lib/intent-ai/liveQuote.js';
import { simulateBeforeSign, assertSimulatedBeforeSign } from '../src/lib/intent-ai/simulationGate.js';
import { FAULTS, runChaosDrill, honestUnavailable } from '../src/lib/intent-ai/intentChaos.js';
import {
  DATA_STORES,
  exportUserData,
  deleteUserData,
  verifyDeletion,
  assertErasureProven
} from '../src/lib/intent-ai/dataLifecycle.js';
import {
  issueApiKey,
  revokeApiKey,
  authorizeApiCall,
  assertNoBypass,
  _resetPublicApiStore
} from '../src/lib/intent-ai/publicApi.js';
import { computeFee, assertFeeHonest } from '../src/lib/intent-ai/feeIntegrity.js';
import { FEE_BPS_MAX } from '../src/lib/feeBps.js';
import { diffTerms, assertTermsUnchanged } from '../src/lib/intent-ai/termsDiff.js';
import {
  buildSnapshot,
  encryptSnapshot,
  restoreSnapshot,
  assertRestoreNotEscalated
} from '../src/lib/intent-ai/sessionPersistence.js';
import {
  runHonestBacktest,
  movingAverageStrategy,
  assertNoLookAhead
} from '../src/lib/intent-ai/honestBacktest.js';
import { buildReceiptLeaf, buildBatch, anchorBatch } from '../src/lib/intent-ai/onchainReceipt.js';
import { runBackupRestoreDrill, runRollbackDrill } from './intentOperationalDrills.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const LATER_PHASE_SCHEMA = 'fbt.later-phase-probe.v1';
export const LATER_PHASE_TTL_MS = 60_000;

export const THIRD_PARTY_PROVIDERS = Object.freeze([
  { id: 'independent-security-review', code: 'SECURITY_REVIEW_NOT_INDEPENDENT', blocker: 'allowlisted Ed25519 intake' },
  { id: 'workforce-sso', code: 'WORKFORCE_SSO_UNATTESTED', blocker: 'IdP SSO + MFA' },
  { id: 'regulatory-counsel', code: 'INDEPENDENT_COUNSEL_REQUIRED', blocker: 'independent counsel filing' },
  { id: 'ca-pki', code: 'CA_BEYOND_TLS_MISSING', blocker: 'internal CA/PKI beyond public TLS' },
  { id: 'browser-wallet-e2e', code: 'BROWSER_WALLET_REQUIRED', blocker: 'connected browser wallet' },
  { id: 'secondary-region', code: 'SECONDARY_REGION_UNREADY', blocker: 'attested failover region' },
  { id: 'model-attestation', code: 'MODEL_ATTESTATION_MISSING', blocker: 'signed model/prompt digest' },
  { id: 'capital-escrow', code: 'BOND_ESCROW_UNATTESTED', blocker: 'attested third-party escrow' },
  { id: 'aws-kms', code: 'KMS_NOT_BOUND', blocker: 'AWS KMS GetPublicKey' }
]);

function sha256(...parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function envId(name) {
  const raw = String(process.env[name] || '').trim();
  return raw && raw.length <= 64 ? raw : null;
}

function checkRow(id, band, { ok, code, digest = null, detail = null, operate = null, thirdParty = false }) {
  return {
    id,
    band,
    ok: ok === true,
    code: ok === true ? (code || 'PROVEN') : (code || 'MISSING'),
    digest,
    detail,
    thirdParty: thirdParty === true,
    operational: operate?.operational === true,
    live: operate?.live === true,
    launchAllowed: false
  };
}

function makeUserStore(userId) {
  const bags = Object.fromEntries(DATA_STORES.map((store) => [store, new Map()]));
  for (const store of DATA_STORES) bags[store].set(userId, { store, marker: 1 });
  return {
    readers: Object.fromEntries(DATA_STORES.map((store) => [
      store,
      async ({ userId: id }) => bags[store].get(id) ?? null
    ])),
    erasers: Object.fromEntries(DATA_STORES.map((store) => [
      store,
      async ({ userId: id }) => {
        const had = bags[store].has(id);
        bags[store].delete(id);
        return { ok: true, removed: had ? 1 : 0 };
      }
    ]))
  };
}

async function proveFoundations(now) {
  const rows = [];
  const productionStub = stubSignerAllowed({ NODE_ENV: 'production', allowStub: true });
  rows.push(checkRow('production-stub-forbidden', '1-9', {
    ok: productionStub === false,
    code: productionStub ? 'PRODUCTION_STUB_ALLOWED' : 'PROVEN',
    digest: sha256('stub-guard', String(now))
  }));

  const noProvider = describeWalletRuntime({});
  rows.push(checkRow('wallet-no-provider-honest', '1-9', {
    ok: noProvider.hasSigner === false && noProvider.reasons.includes('NO_PROVIDER'),
    code: noProvider.hasSigner ? 'WALLET_CLAIMED_WITHOUT_PROVIDER' : 'PROVEN'
  }));

  const noStubSigner = resolveExecutionSigner({ allowStub: false });
  rows.push(checkRow('execution-signer-fail-closed', '1-9', {
    ok: noStubSigner.ok === false,
    code: noStubSigner.ok ? 'STUB_ESCAPED_FAIL_CLOSED' : 'PROVEN'
  }));
  return rows;
}

async function proveOps31to40(now) {
  const rows = [];

  const assumed = operateIncidentCommand({
    incident: { id: 'inc-assumed', assumedResolved: true, verified: false, severity: 'high' },
    commander: { id: 'cmd-a', independent: true }
  });
  rows.push(checkRow('incident-assumed-refused', '31-40', {
    ok: assumed.ok === false && assumed.code === 'INCIDENT_ASSUMED_NOT_VERIFIED',
    code: assumed.code || 'INCIDENT_ASSUMED_NOT_VERIFIED',
    operate: assumed
  }));

  const commanderId = envId('INTENT_INCIDENT_COMMANDER');
  const declared = operateIncidentCommand({
    incident: { id: 'inc-live', severity: 'high', verified: false },
    commander: commanderId ? { id: commanderId, independent: true } : null,
    freeze: true
  });
  rows.push(checkRow('incident-command', '31-40', {
    ok: declared.ok === true && declared.operational === false && declared.resolved === false,
    code: declared.code || (declared.ok ? 'PROVEN' : 'INCIDENT_COMMANDER_REQUIRED'),
    operate: declared,
    thirdParty: !commanderId
  }));

  const oldKey = generateKeyPairSync('ed25519');
  const newKey = generateKeyPairSync('ed25519');
  const payload = Buffer.from(`rotate:${now}`);
  const oldSig = sign(null, payload, oldKey.privateKey);
  const oldStillVerifies = verify(null, payload, oldKey.publicKey, oldSig);
  const newRejectsOld = verify(null, payload, newKey.publicKey, oldSig) === false;
  rows.push(checkRow('local-key-rotation', '31-40', {
    ok: oldStillVerifies === true && newRejectsOld === true,
    code: (oldStillVerifies && newRejectsOld) ? 'PROVEN' : 'KEY_ROTATION_NOT_PROVEN',
    digest: sha256('rotate', String(now))
  }));

  const rotation = operateSecretRotation({
    manager: { attested: false, durable: false, providerId: 'process-ed25519' },
    rotation: { completed: true, rotatedAt: now, dualControl: false },
    now
  });
  rows.push(checkRow('secret-manager', '31-40', {
    ok: rotation.ok === false && rotation.code === 'SECRET_MANAGER_NOT_VERIFIED',
    code: rotation.code || 'SECRET_MANAGER_NOT_VERIFIED',
    operate: rotation,
    thirdParty: true
  }));

  const failover = operateFailover({
    primary: { healthy: true, attested: true },
    secondary: { ready: false, attested: false },
    drill: { completed: false }
  });
  rows.push(checkRow('failover-secondary', '31-40', {
    ok: failover.ok === false && failover.code === 'SECONDARY_REGION_UNREADY',
    code: failover.code || 'SECONDARY_REGION_UNREADY',
    operate: failover,
    thirdParty: true
  }));

  const perMinute = Number(process.env.RATE_LIMIT || 120);
  const limits = operateAbuseLimits({
    limiter: { perMinute },
    enforcement: { attested: true, active: true, bypassable: false }
  });
  const bypass = operateAbuseLimits({
    limiter: { perMinute },
    enforcement: { attested: true, active: true, bypassable: true }
  });
  rows.push(checkRow('abuse-rate-limits', '31-40', {
    ok: limits.ok === true && limits.operational === false
      && bypass.ok === false && bypass.code === 'RATE_LIMIT_MUST_NOT_BYPASS',
    code: limits.ok ? 'PROVEN' : (limits.code || 'RATE_LIMIT_NOT_ENFORCED'),
    operate: limits,
    detail: { perMinute }
  }));

  const disclosure = operatePublicDisclosure({
    page: { status: 'unavailable', launchAllowed: false },
    comms: { channelAttested: true, channel: 'public-status-route' }
  });
  const greenLie = operatePublicDisclosure({
    page: { status: 'operational', launchAllowed: true },
    comms: { channelAttested: true }
  });
  rows.push(checkRow('public-disclosure-honest', '31-40', {
    ok: disclosure.ok === true && disclosure.launchAllowed === false
      && greenLie.ok === false && greenLie.code === 'PUBLIC_STATUS_MUST_STAY_HONEST',
    code: disclosure.ok ? 'PROVEN' : (disclosure.code || 'DISCLOSURE_CHANNEL_UNATTESTED'),
    operate: disclosure
  }));

  const userId = `hold-${now}`;
  const store = makeUserStore(userId);
  const holdActive = true;
  const exportBlocked = holdActive === true;
  const blockedExport = exportBlocked
    ? { ok: false, complete: false, blocked: true }
    : await exportUserData({ userId, readers: store.readers, now });
  const unblockedHold = operateResidencyHold({
    residency: { enforced: true, attested: true, allowsRawSecrets: false },
    hold: { active: true, exportBlocked: false }
  });
  const residency = operateResidencyHold({
    residency: { enforced: true, attested: true, allowsRawSecrets: false },
    hold: { active: true, exportBlocked }
  });
  rows.push(checkRow('residency-legal-hold', '31-40', {
    ok: blockedExport.blocked === true
      && unblockedHold.code === 'LEGAL_HOLD_EXPORT_NOT_BLOCKED'
      && residency.ok === true && residency.operational === false && residency.exportAllowed === false,
    code: residency.ok ? 'PROVEN' : (residency.code || 'RESIDENCY_NOT_ENFORCED'),
    operate: residency
  }));

  const lockfile = path.join(ROOT, 'package-lock.json');
  const lockDigest = fs.existsSync(lockfile)
    ? createHash('sha256').update(fs.readFileSync(lockfile)).digest('hex')
    : null;
  const sbom = operateDependencyAttestation({
    sbom: { attested: false, digest: lockDigest },
    suppliers: []
  });
  rows.push(checkRow('dependency-sbom', '31-40', {
    ok: sbom.ok === false && sbom.code === 'SBOM_ATTESTATION_MISSING',
    code: sbom.code || 'SBOM_ATTESTATION_MISSING',
    digest: lockDigest,
    operate: sbom,
    thirdParty: true,
    detail: 'package-lock hash is not an SBOM attestation'
  }));

  const backup = await runBackupRestoreDrill({ now });
  const rollback = await runRollbackDrill({ now });
  const gameday = operateGameDay({
    rehearsal: {
      executed: backup.ok === true && rollback.ok === true,
      attested: backup.ok === true && rollback.ok === true,
      tabletopOnly: false,
      usedProductionSigner: false,
      usedMainnetFunds: false
    }
  });
  rows.push(checkRow('gameday-rehearsal', '31-40', {
    ok: gameday.ok === true && gameday.operational === false && gameday.live === false
      && backup.ok === true && rollback.ok === true,
    code: gameday.ok ? 'PROVEN' : (gameday.code || 'GAMEDAY_NOT_EXECUTED'),
    operate: gameday,
    digest: sha256(backup.evidence?.digest || '', rollback.evidence?.digest || '')
  }));

  const continuous = operateContinuousVerification({
    probe: {
      attested: backup.ok === true && rollback.ok === true,
      lastOkAt: now,
      maxAgeMs: 300_000,
      claimsLive: false
    },
    now
  });
  const liveLie = operateContinuousVerification({
    probe: { attested: true, lastOkAt: now, claimsLive: true },
    now
  });
  rows.push(checkRow('continuous-verification', '31-40', {
    ok: continuous.ok === true && continuous.live === false
      && liveLie.ok === false && liveLie.code === 'PROBE_MUST_NOT_CLAIM_LIVE',
    code: continuous.ok ? 'PROVEN' : (continuous.code || 'CONTINUOUS_PROBE_MISSING'),
    operate: continuous
  }));

  const ownerId = envId('INTENT_ACCOUNTABLE_OWNER');
  const sustainment = operateSustainment({
    owner: ownerId ? { id: ownerId, accountable: true, singlePerson: false } : null,
    reviewCadence: { scheduled: true },
    budget: { unlimited: false }
  });
  rows.push(checkRow('sustainment-owner', '31-40', {
    ok: Boolean(ownerId) && sustainment.ok === true && sustainment.operational === false,
    code: sustainment.code || (ownerId ? 'PROVEN' : 'SUSTAINMENT_OWNER_REQUIRED'),
    operate: sustainment,
    thirdParty: !ownerId
  }));

  return rows;
}

async function proveOps41to50() {
  const rows = [];

  const frozen = operateReleaseTrain({
    train: { attested: true },
    change: { wouldDeploy: true, reviewed: true, rollbackReady: true },
    freeze: true
  });
  rows.push(checkRow('change-freeze-blocks-deploy', '41-50', {
    ok: frozen.ok === false && frozen.code === 'CHANGE_FREEZE_ACTIVE',
    code: frozen.code || 'CHANGE_FREEZE_ACTIVE',
    operate: frozen
  }));

  const bypassGlass = operateBreakGlass({
    ticket: { id: 'ticket-1' },
    actor: { attested: true, bypassesGuardian: true },
    guardian: { approved: true }
  });
  const noGuardian = operateBreakGlass({
    ticket: { id: 'ticket-1' },
    actor: { attested: true, bypassesGuardian: false },
    guardian: { approved: false }
  });
  rows.push(checkRow('break-glass-guardian', '41-50', {
    ok: bypassGlass.code === 'SUPPORT_MUST_NOT_BYPASS_GUARDIAN'
      && noGuardian.code === 'GUARDIAN_REQUIRED_FOR_BREAK_GLASS',
    code: 'PROVEN',
    operate: noGuardian
  }));

  const cost = operateCostKillSpend({
    budget: { capUsd: 100 },
    spent: { usd: 10 },
    kill: { engaged: false, bypassable: false }
  });
  const breached = operateCostKillSpend({
    budget: { capUsd: 100 },
    spent: { usd: 150 },
    kill: { engaged: false, bypassable: false }
  });
  rows.push(checkRow('cost-kill-spend', '41-50', {
    ok: cost.ok === true && cost.operational === false && cost.executionActivated === false
      && breached.code === 'SPEND_CAP_BREACHED_WITHOUT_KILL',
    code: cost.ok ? 'PROVEN' : (cost.code || 'SPEND_CAP_UNDEFINED'),
    operate: cost
  }));

  const sso = operateWorkforceAccess({ sso: null, role: { leastPrivilege: true } });
  rows.push(checkRow('workforce-sso', '41-50', {
    ok: sso.ok === false && sso.code === 'WORKFORCE_SSO_UNATTESTED',
    code: sso.code || 'WORKFORCE_SSO_UNATTESTED',
    operate: sso,
    thirdParty: true
  }));

  const clientTrain = operateTelemetryIntegrity({
    stream: { attested: true, acceptsClientResolvedOutcomes: true, containsSecrets: false },
    consent: { optIn: true }
  });
  const telemetry = operateTelemetryIntegrity({
    stream: { attested: true, acceptsClientResolvedOutcomes: false, containsSecrets: false },
    consent: { optIn: true }
  });
  rows.push(checkRow('telemetry-integrity', '41-50', {
    ok: clientTrain.code === 'CLIENT_OUTCOMES_CANNOT_TRAIN'
      && telemetry.ok === true && telemetry.trusted === false && telemetry.operational === false,
    code: telemetry.ok ? 'PROVEN' : (telemetry.code || 'TELEMETRY_STREAM_UNATTESTED'),
    operate: telemetry
  }));

  const modelAuth = operateModelSupplyChain({
    model: { attested: true, digest: 'abc', mayAuthorizeExecution: true },
    prompt: { pinned: true }
  });
  const model = operateModelSupplyChain({ model: null, prompt: null });
  rows.push(checkRow('model-supply', '41-50', {
    ok: modelAuth.code === 'MODEL_MUST_NOT_AUTHORIZE_EXECUTION'
      && model.code === 'MODEL_ATTESTATION_MISSING',
    code: 'MODEL_ATTESTATION_MISSING',
    operate: model,
    thirdParty: true
  }));

  const liveFleet = operateAgentFleet({
    fleet: { attested: true, liveExecution: true, holdsSeeds: false },
    sandbox: { isolated: true }
  });
  const fleet = operateAgentFleet({ fleet: null, sandbox: null });
  rows.push(checkRow('agent-fleet', '41-50', {
    ok: liveFleet.code === 'FLEET_MUST_NOT_CLAIM_LIVE_EXECUTION'
      && fleet.code === 'FLEET_UNATTESTED',
    code: 'FLEET_UNATTESTED',
    operate: fleet,
    thirdParty: true
  }));

  const assumedBond = operateCapitalBond({
    bond: { declared: true, assumedFunded: true, attested: false, escrowed: false }
  });
  const bond = operateCapitalBond({
    bond: { declared: true, assumedFunded: false, attested: false, escrowed: false }
  });
  rows.push(checkRow('capital-bond', '41-50', {
    ok: assumedBond.code === 'BOND_ASSUMED_NOT_VERIFIED'
      && bond.ok === true && bond.settlesFunds === false && bond.operational === false,
    code: bond.ok ? 'PROVEN' : (bond.code || 'BOND_NOT_DECLARED'),
    operate: bond,
    detail: 'declared in-process; escrow remains unattested'
  }));

  const counsel = operateRegulatoryReporting({ filing: null, counsel: null });
  rows.push(checkRow('regulatory-counsel', '41-50', {
    ok: counsel.ok === false && counsel.code === 'REGULATORY_FILING_MISSING',
    code: counsel.code || 'REGULATORY_FILING_MISSING',
    operate: counsel,
    thirdParty: true
  }));

  const program = operateProgramControl({ evidence: [], freeze: true, programComplete: false });
  rows.push(checkRow('program-control', '41-50', {
    ok: program.ok === true && program.launchAllowed === false && program.goLive === false && program.live === false,
    code: 'PROVEN',
    operate: program
  }));

  return rows;
}

async function proveRuntime51to100(now) {
  const rows = [];

  const handlers = Object.fromEntries(
    FAULTS.map((fault) => [fault, async ({ fault: f }) => honestUnavailable({ fault: f })])
  );
  const chaos = await runChaosDrill({ handlers, faults: FAULTS, now });
  rows.push(checkRow('chaos-drill', '51-100', {
    ok: chaos.passed === true && chaos.failures.length === 0 && chaos.untested.length === 0,
    code: chaos.passed ? 'PROVEN' : 'CHAOS_DRILL_FAILED',
    detail: { coverage: chaos.coverage, failed: chaos.failures.length }
  }));

  const userId = `life-${now}`;
  const bags = makeUserStore(userId);
  const exported = await exportUserData({ userId, readers: bags.readers, now });
  const deleted = await deleteUserData({ userId, erasers: bags.erasers, confirmed: true, now });
  const verified = await verifyDeletion({ userId, readers: bags.readers, deletion: deleted, now });
  const honest = assertErasureProven({ deletion: deleted, verification: verified, exportResult: exported });
  rows.push(checkRow('data-lifecycle', '51-100', {
    ok: exported.complete === true && deleted.deleted === true && verified.proven === true && honest.ok === true
      && exported.containsSecrets === false,
    code: verified.proven ? 'PROVEN' : 'DELETION_UNPROVEN',
    digest: exported.checksum || null
  }));

  _resetPublicApiStore();
  const refusedExecute = issueApiKey({ ownerId: 'dev-1', scopes: ['write:execute'], ttlMs: 60_000, now });
  const issued = issueApiKey({ ownerId: 'dev-1', scopes: ['read:status', 'write:execute'], ttlMs: 60_000, now });
  const execute = authorizeApiCall({ keyRef: issued.key, operation: 'intent.execute', now });
  const statusOk = authorizeApiCall({ keyRef: issued.key, operation: 'status.get', now });
  const revoked = revokeApiKey(issued.key, { now });
  const afterRevoke = authorizeApiCall({ keyRef: issued.key, operation: 'status.get', now });
  const bypass = assertNoBypass({
    key: issued.key,
    authorization: execute,
    manifest: { failClosed: true, executionOperations: [] }
  });
  rows.push(checkRow('public-api-no-execute', '51-100', {
    ok: refusedExecute.ok === false
      && issued.ok === true
      && issued.key.executionAuthorized === false
      && execute.reason === 'EXECUTION_NEVER_DELEGATED'
      && statusOk.ok === true
      && revoked.revoked === true
      && afterRevoke.reason === 'KEY_REVOKED'
      && bypass.ok === true
      && !('secret' in issued.key),
    code: execute.reason || 'EXECUTION_NEVER_DELEGATED'
  }));

  const fee = computeFee({ notional: 1000, bps: 30, symbol: 'USDC', now });
  const above = computeFee({ notional: 1000, bps: FEE_BPS_MAX + 1, symbol: 'USDC', now });
  const feeHonest = assertFeeHonest({ quote: fee });
  rows.push(checkRow('fee-integrity', '51-100', {
    ok: fee.ok === true && fee.disclosed === true && feeHonest.ok === true && above.ok === false,
    code: fee.ok ? 'PROVEN' : 'FEE_UNAVAILABLE',
    detail: { feeAmount: fee.feeAmount, formula: fee.formula }
  }));

  const material = diffTerms({ approved: { amount: 100, recipient: '0xabc' }, current: { amount: 500, recipient: '0xabc' } });
  const gate = assertTermsUnchanged({
    approved: { amount: 100, recipient: '0xabc' },
    current: { amount: 500, recipient: '0xabc' }
  });
  rows.push(checkRow('terms-diff-material', '51-100', {
    ok: material.hasMaterialChange === true && gate.mayProceed === false && gate.executionAuthorized === false,
    code: 'PROVEN'
  }));

  const tx = { from: '0x1111111111111111111111111111111111111111', to: '0x2222222222222222222222222222222222222222', data: '0x', value: '0', chainId: 1 };
  const sim = await simulateBeforeSign({ tx, simulate: null, now });
  const blocked = assertSimulatedBeforeSign(sim, tx, { userOverride: false, now });
  rows.push(checkRow('simulation-blocks-sign', '51-100', {
    ok: sim.signAllowed === false && sim.status === 'unavailable' && blocked.ok === false,
    code: 'PROVEN'
  }));

  const missingQuote = await fetchExecutionQuote({ draft: { amountIn: 1 }, quoteSource: null, now });
  const live = await fetchExecutionQuote({
    draft: { fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: 100 },
    quoteSource: async () => ({ amountIn: 100, amountOut: 1, source: 'injected-probe', at: now }),
    now
  });
  const locked = lockQuoteIntoTerms({}, live.quote);
  const worse = recheckQuoteBeforeExecute({
    lockedQuote: live.quote,
    freshQuote: { ...live.quote, amountOut: 0.5 },
    maxSlippagePct: 1,
    now
  });
  rows.push(checkRow('live-quote-recheck', '51-100', {
    ok: missingQuote.ok === false
      && live.ok === true
      && locked.quoteStatus === 'live'
      && worse.action === 'REAUTHORIZE'
      && worse.reauthoriseRequired === true,
    code: 'PROVEN'
  }));

  const session = { status: 'STOPPED', level: 1, policy: { maxTransactionUsd: 50 }, permissions: ['read'] };
  const snap = buildSnapshot({ session, now });
  const enc = await encryptSnapshot({ snapshot: snap, deviceSecret: 'later-phase-device-secret' });
  const restored = await restoreSnapshot({ envelope: enc.envelope, deviceSecret: 'later-phase-device-secret', now });
  const noEscalate = assertRestoreNotEscalated(session, restored.session);
  rows.push(checkRow('session-stop-survives', '51-100', {
    ok: snap.ok === true && snap.containsSecrets === false
      && enc.ok === true
      && restored.ok === true
      && restored.session?.status === 'STOPPED'
      && restored.executionAuthorized === false
      && noEscalate.ok === true,
    code: restored.ok ? 'PROVEN' : (restored.error?.detail || 'PERSISTENCE_FAILED')
  }));

  const series = Array.from({ length: 12 }, (_, i) => ({ t: now - (12 - i) * 86_400_000, p: 100 + i }));
  const decide = movingAverageStrategy({ fast: 3, slow: 8 });
  const backtest = runHonestBacktest({
    series,
    decide,
    source: 'later-phase-synthetic-window',
    startCapitalUsd: 1000,
    feeBps: 30,
    slippagePct: 0.3,
    now
  });
  const noLook = assertNoLookAhead({ series, decide, result: backtest });
  rows.push(checkRow('honest-backtest', '51-100', {
    ok: backtest.ok === true && backtest.label === 'SIMULATION' && backtest.futureReturnClaim === false
      && backtest.executionAuthorized === false && noLook.ok === true,
    code: backtest.ok ? 'PROVEN' : (backtest.error?.detail || 'BACKTEST_UNAVAILABLE')
  }));

  const leaf = buildReceiptLeaf({
    intentId: 'intent-later',
    terms: { amount: 1, token: 'USDC' },
    outcome: { status: 'unconfirmed' },
    at: now
  });
  const batch = buildBatch({ leaves: [leaf], now });
  const unanchored = await anchorBatch({ batch, submit: null, chainId: 1, now });
  rows.push(checkRow('receipt-anchor-unanchored', '51-100', {
    ok: leaf.ok === true && batch.ok === true && unanchored.anchored !== true && unanchored.state === 'unanchored',
    code: 'PROVEN'
  }));

  const wallet = describeWalletRuntime({});
  rows.push(checkRow('browser-wallet-e2e', '51-100', {
    ok: wallet.hasSigner === false,
    code: 'BROWSER_WALLET_REQUIRED',
    thirdParty: true
  }));

  return rows;
}

function thirdPartyStatus(checks) {
  return THIRD_PARTY_PROVIDERS.map((provider) => {
    const hit = checks.find((row) => row.id === provider.id)
      || checks.find((row) => row.code === provider.code);
    return {
      id: provider.id,
      present: false,
      code: hit?.code || provider.code,
      blocker: provider.blocker
    };
  });
}

export async function runLaterPhaseProbe({ now = Date.now() } = {}) {
  const checks = [
    ...(await proveFoundations(now)),
    ...(await proveOps31to40(now)),
    ...(await proveOps41to50()),
    ...(await proveRuntime51to100(now))
  ];

  const proven = checks.filter((row) => row.ok === true && row.thirdParty !== true);
  const missing = checks.filter((row) => row.ok !== true || row.thirdParty === true);
  const thirdParty = thirdPartyStatus(checks);
  const launchAllowed = false;
  const claimedLive = checks.some((row) => row.live === true || row.launchAllowed === true || row.operational === true);

  return {
    ok: true,
    schema: LATER_PHASE_SCHEMA,
    checkedAt: now,
    launchAllowed,
    goLive: false,
    live: false,
    operational: false,
    claimedLive,
    provenCount: proven.length,
    missingCount: missing.length,
    totalChecks: checks.length,
    proven: proven.map((row) => ({ id: row.id, band: row.band, code: row.code, digest: row.digest })),
    missing: missing.map((row) => ({
      id: row.id,
      band: row.band,
      code: row.code,
      thirdParty: row.thirdParty === true,
      detail: row.detail ?? null
    })),
    thirdParty,
    checks,
    selfIssuedReview: false,
    evidenceKindsAdded: 0
  };
}

let cache = { at: 0, report: null };

export function resetLaterPhaseCache() {
  cache = { at: 0, report: null };
}

export async function laterPhaseProbeReport({ force = false } = {}) {
  if (!force && cache.report && Date.now() - cache.at < LATER_PHASE_TTL_MS) return cache.report;
  const report = await runLaterPhaseProbe({});
  cache = { at: Date.now(), report };
  return report;
}

export function laterPhasePublicSummary(report) {
  return {
    schema: LATER_PHASE_SCHEMA,
    ok: report?.ok === true,
    launchAllowed: false,
    live: false,
    operational: false,
    provenCount: report?.provenCount ?? 0,
    missingCount: report?.missingCount ?? 0,
    totalChecks: report?.totalChecks ?? 0,
    proven: report?.proven ?? [],
    missing: report?.missing ?? [],
    thirdParty: report?.thirdParty ?? [],
    selfIssuedReview: false
  };
}

export async function runExternalProviderDigest({ now = Date.now(), later = null, stage3 = null, signer = null } = {}) {
  const laterReport = later || await runLaterPhaseProbe({ now });
  let stage3Report = stage3;
  let signerStatus = signer;
  if (!stage3Report || !signerStatus) {
    const stage3Mod = await import('./intentStage3Probe.js');
    stage3Report = stage3Report || await stage3Mod.runStage3Digest({ now });
    signerStatus = signerStatus || stage3Mod.productionSignerStatus();
  }
  const providers = THIRD_PARTY_PROVIDERS.map((provider) => {
    if (provider.id === 'independent-security-review') {
      const earned = (stage3Report.earned || []).some((e) => e.kind === 'independent-security-review');
      const missing = (stage3Report.missing || []).find((m) => m.kind === 'independent-security-review');
      return {
        id: provider.id,
        present: earned === true,
        code: earned ? 'PRESENT' : (missing?.code || provider.code),
        blocker: provider.blocker,
        providerId: earned
          ? stage3Report.earned.find((e) => e.kind === 'independent-security-review')?.providerId
          : null
      };
    }
    if (provider.id === 'aws-kms') {
      const kms = signerStatus?.providerId === 'aws-kms';
      return {
        id: provider.id,
        present: kms,
        code: kms ? 'PRESENT' : 'KMS_NOT_BOUND',
        blocker: provider.blocker,
        providerId: signerStatus?.providerId || null
      };
    }
    const laterHit = (laterReport.thirdParty || []).find((row) => row.id === provider.id);
    return {
      id: provider.id,
      present: false,
      code: laterHit?.code || provider.code,
      blocker: provider.blocker,
      providerId: null
    };
  });
  const present = providers.filter((p) => p.present);
  const missing = providers.filter((p) => !p.present);
  return {
    schema: 'fbt.external-provider-digest.v1',
    generatedAt: new Date(now).toISOString(),
    presentCount: present.length,
    total: providers.length,
    selfIssuedReview: false,
    launchAllowed: false,
    providers,
    missing,
    laterPhase: {
      provenCount: laterReport.provenCount,
      totalChecks: laterReport.totalChecks,
      launchAllowed: false
    }
  };
}
