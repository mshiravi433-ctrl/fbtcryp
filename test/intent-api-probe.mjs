import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateSolverKeyPair,
  signSolverCommitment
} from '../server/intentSignatures.js';
import {
  issueAdmissionReceipt,
  verifyAdmissionReceipt
} from '../server/intentAdmissions.js';
import { buildCompletenessReport } from '../server/intentWatcher.js';
import {
  buildExecutionClaim,
  verifyExecutionClaim
} from '../server/intentExecution.js';
import { buildDispute, verifyDispute } from '../server/intentDisputes.js';
import { verifyAdjudication } from '../server/intentAdjudication.js';
import { buildSettlementReport } from '../server/intentSettlement.js';
import { signOutcomeBid } from '../server/outcomeBids.js';
import { buildIntentCommitment } from '../server/intentCommitment.js';
import {
  buildCrossChainReceipt,
  verifyCrossChainReceipt
} from '../server/intentCrossChain.js';
import { buildAccountBinding } from '../server/intentCrossChainVerification.js';
import { buildOperatorAttestation } from '../server/intentOperators.js';
import { Wallet, hexlify } from 'ethers';
import {
  createCoordinatorRotationDraft,
  signCoordinatorRotation
} from '../server/intentAuctions.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);
const previousRegistry = process.env.INTENT_SOLVER_KEYS;
const previousCoordinatorId = process.env.INTENT_COORDINATOR_ID;
const previousCoordinatorKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
const previousCloseToken = process.env.INTENT_AUCTION_CLOSE_TOKEN;
const previousWatcherRegistry = process.env.INTENT_WATCHER_KEYS;
const previousVerifierRegistry = process.env.INTENT_VERIFIER_KEYS;
const previousBonds = process.env.INTENT_SOLVER_BONDS;
const previousGrace = process.env.INTENT_EXECUTION_GRACE_SECONDS;
const previousSettlementRate = process.env.INTENT_SETTLEMENT_RATE_LIMIT;
const previousOperatorAttestations = process.env.INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS;
const previousCoordinatorRotations = process.env.INTENT_COORDINATOR_ROTATIONS;
const previousMerkleAnchorNetworks = process.env.INTENT_MERKLE_ANCHOR_NETWORKS;
const keys = generateSolverKeyPair();
const coordinatorKeys = generateSolverKeyPair();
const watcherKeys = generateSolverKeyPair();
const verifierKeys = generateSolverKeyPair();
const solver = { id: 'api-probe-solver', name: 'API Probe Solver', publicKey: keys.publicKey };
const watcher = { id: 'api-probe-watcher', name: 'API Probe Watcher', publicKey: watcherKeys.publicKey };
const verifier = { id: 'api-probe-verifier', name: 'API Probe Verifier', publicKey: verifierKeys.publicKey };
const setupNow = Math.floor(Date.now() / 1000);
const watcherAttestation = buildOperatorAttestation({
  operatorId: 'api-probe-watch-operator',
  operatorName: 'API Probe Watch Operator',
  operatorUrl: 'https://watcher.example',
  role: 'watcher',
  registryId: watcher.id,
  expiresAt: setupNow + 86400
}, watcherKeys.privateKey, { now: setupNow * 1000 }).attestation;
const verifierAttestation = buildOperatorAttestation({
  operatorId: 'api-probe-verify-operator',
  operatorName: 'API Probe Verify Operator',
  operatorUrl: 'https://verifier.example',
  role: 'verifier',
  registryId: verifier.id,
  expiresAt: setupNow + 86400
}, verifierKeys.privateKey, { now: setupNow * 1000 }).attestation;
process.env.INTENT_SOLVER_KEYS = JSON.stringify([solver]);
process.env.INTENT_COORDINATOR_ID = 'api-probe-coordinator';
process.env.INTENT_COORDINATOR_PRIVATE_KEY = coordinatorKeys.privateKey;
process.env.INTENT_AUCTION_CLOSE_TOKEN = 'unit-close-token-that-is-not-a-production-secret';
process.env.INTENT_WATCHER_KEYS = JSON.stringify([watcher]);
process.env.INTENT_VERIFIER_KEYS = JSON.stringify([verifier]);
process.env.INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS = JSON.stringify([
  watcherAttestation, verifierAttestation
]);
process.env.INTENT_COORDINATOR_ROTATIONS = '';
process.env.INTENT_MERKLE_ANCHOR_NETWORKS = '';
process.env.INTENT_SOLVER_BONDS = JSON.stringify([
  { solverId: solver.id, bondUsd: '50000', asset: 'USDC', terms: 'API probe bond' }
]);
process.env.INTENT_EXECUTION_GRACE_SECONDS = '0';
/* The probe walks the full claim/dispute/adjudication/report lifecycle for
   several auctions, which legitimately exceeds the production per-caller
   budget of 20/min — raise it for the probe rather than weakening the
   production default. */
process.env.INTENT_SETTLEMENT_RATE_LIMIT = '100';

/* Dynamic import is deliberate: the public registry must be installed before
   the shared Express app (and its protocol modules) are evaluated. */
const { default: app } = await import('../server/app.js');
const server = await new Promise((resolve, reject) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  listening.once('error', reject);
});

try {
  const base = `http://127.0.0.1:${server.address().port}/api/intents/v1`;
  const request = async (path, options) => {
    const response = await fetch(`${base}${path}`, options);
    return { response, body: await response.json() };
  };
  const post = (body) => request('/commitments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  const capabilities = await request('/capabilities');
  t('capabilities report the configured solver and ephemeral persistence honestly',
    capabilities.response.status === 200
      && capabilities.body.transparency?.registeredSolvers === 1
      && capabilities.body.transparency?.signingAlgorithm === 'Ed25519'
      && capabilities.body.transparency?.persistenceMode === 'process-memory-ephemeral'
      && capabilities.body.transparency?.externallyAnchored === false
      && capabilities.body.auctions?.closeConfigured === true
      && capabilities.body.auctions?.auctionCompletenessProof === false);
  t('Phase 4b/6 capabilities are explicit about non-atomic settlement and independence limits',
    capabilities.body.crossChain?.available === true
      && capabilities.body.crossChain?.atomic === false
      && capabilities.body.crossChain?.custody === false
      && capabilities.body.crossChain?.envelopeBlockCode === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE'
      && capabilities.body.independentVerification?.configured === true
      && capabilities.body.independentVerification?.allObserverKeysAttested === true
      && capabilities.body.independentVerification?.organizationalIndependenceProven === false
      && capabilities.body.merkleRootAnchors?.supported === true
      && capabilities.body.merkleRootAnchors?.configured === false
      && capabilities.body.merkleRootAnchors?.externallyAnchoredByDefault === false);

  const operators = await request('/operators');
  t('operator discovery publishes only signed public bindings, never a claim of proven independence',
    operators.response.status === 200
      && operators.body.attestations?.length === 2
      && operators.body.signedOperatorBindings === 2
      && operators.body.organizationalIndependenceProven === false);

  const discovered = await request('/solvers');
  t('public solver discovery exposes only the registered public identity',
    discovered.response.status === 200
      && discovered.body.solvers?.length === 1
      && discovered.body.solvers[0].id === solver.id
      && discovered.body.solvers[0].publicKey === keys.publicKey);

  const retiredCoordinatorKeys = generateSolverKeyPair();
  let rotation = createCoordinatorRotationDraft({
    coordinatorId: 'api-probe-coordinator',
    oldPublicKey: retiredCoordinatorKeys.publicKey,
    newPublicKey: coordinatorKeys.publicKey,
    activatedAt: Date.now()
  });
  rotation = signCoordinatorRotation(rotation.rotation, retiredCoordinatorKeys.privateKey, 'old');
  rotation = signCoordinatorRotation(rotation.rotation, coordinatorKeys.privateKey, 'new');
  process.env.INTENT_COORDINATOR_ROTATIONS = JSON.stringify([rotation.rotation]);
  const coordinatorDiscovery = await request('/coordinator');
  t('coordinator discovery publishes a dual-signed keyring with retired keys verification-only',
    coordinatorDiscovery.response.status === 200
      && coordinatorDiscovery.body.publicKey === coordinatorKeys.publicKey
      && coordinatorDiscovery.body.signsNewDocuments === true
      && coordinatorDiscovery.body.keyring?.rotationConfigured === true
      && coordinatorDiscovery.body.keyring?.retired?.some((row) =>
        row.publicKey === retiredCoordinatorKeys.publicKey && row.signsNewDocuments === false));
  const historicalReceipt = issueAdmissionReceipt({
    intentHash: `0x${'91'.repeat(32)}`,
    entryHash: `0x${'92'.repeat(32)}`,
    acceptedAt: Date.now(),
    solverId: solver.id
  }, {
    coordinator: {
      id: 'api-probe-coordinator',
      publicKey: retiredCoordinatorKeys.publicKey,
      privateKey: retiredCoordinatorKeys.privateKey
    }
  });
  t('a historical receipt remains independently valid after the active key rotates',
    verifyAdmissionReceipt(historicalReceipt)
      && historicalReceipt.coordinator.publicKey === retiredCoordinatorKeys.publicKey);

  const now = Math.floor(Date.now() / 1000);
  const intentHash = `0x${randomBytes(32).toString('hex')}`;
  const commitment = signSolverCommitment({
    schema: 'fbt.solver-quote.v1',
    intentHash,
    solverId: solver.id,
    chainId: 42161,
    amountOut: '400000000000000000',
    maxGas: '250000',
    feeBps: 70,
    slippageBps: 50,
    executable: true,
    issuedAt: now,
    validUntil: now + 90,
    nonce: `0x${randomBytes(16).toString('hex')}`,
    routeCommitment: `0x${randomBytes(32).toString('hex')}`
  }, keys.privateKey);

  const accepted = await post(commitment);
  t('the commitment endpoint accepts a registered valid signature',
    accepted.response.status === 201
      && accepted.body.accepted
      && accepted.body.durable === false
      && /^0x[a-f0-9]{64}$/.test(accepted.body.root));

  const rootLog = await request(`/log/${intentHash}`);
  t('a live log exposes an exact optional root manifest but stays unanchored without a verified event',
    rootLog.response.status === 200
      && rootLog.body.rootManifest?.schema === 'fbt.merkle-root-manifest.v1'
      && rootLog.body.rootManifest?.merkleRoot === rootLog.body.root
      && rootLog.body.externallyAnchored === false
      && rootLog.body.rootAnchorStatus === 'not-anchored');
  const noRootNetwork = await request(`/log/${intentHash}/root-anchor-calldata/8453`);
  t('root anchor calldata fails configured:false instead of inventing a network',
    noRootNetwork.response.status === 400
      && noRootNetwork.body.error === 'MERKLE_ANCHOR_NETWORK_NOT_CONFIGURED');

  const replay = await post(commitment);
  t('the commitment endpoint reports a duplicate nonce as conflict',
    replay.response.status === 409 && replay.body.error === 'NONCE_REPLAY');

  const tampered = await post({
    ...commitment,
    amountOut: '400000000000000001',
    nonce: `0x${randomBytes(16).toString('hex')}`
  });
  t('the commitment endpoint rejects a tampered signature',
    tampered.response.status === 403 && tampered.body.error === 'SIGNATURE_MISMATCH');

  const log = await request(`/log/${intentHash}`);
  t('the public log returns the accepted statement and its inclusion evidence',
    log.response.status === 200
      && log.body.size === 1
      && log.body.root === accepted.body.root
      && log.body.entries?.[0]?.commitment?.signature === commitment.signature
      && Array.isArray(log.body.entries?.[0]?.inclusionProof));

  const closeRequest = {
    schema: 'fbt.auction-close-request.v1',
    intentHash,
    policy: {
      id: 'MAX_OUTPUT_WITHIN_SIGNED_LIMITS_V1',
      chainId: 42161,
      maxFeeBps: 70,
      maxSlippageBps: 50
    }
  };
  const unauthorizedClose = await request(`/auctions/${intentHash}/close`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
    body: JSON.stringify(closeRequest)
  });
  t('auction close requires the configured operator bearer secret', unauthorizedClose.response.status === 401);

  const closed = await request(`/auctions/${intentHash}/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer unit-close-token-that-is-not-a-production-secret'
    },
    body: JSON.stringify(closeRequest)
  });
  t('the close endpoint returns a signed deterministic selection receipt',
    closed.response.status === 201
      && closed.body.close?.decision?.selectedEntryHash === accepted.body.entryHash
      && closed.body.close?.claims?.auctionCompletenessProven === false
      && closed.body.close?.signature);

  const afterClose = await post({
    ...commitment,
    nonce: `0x${randomBytes(16).toString('hex')}`,
    routeCommitment: `0x${randomBytes(32).toString('hex')}`
  });
  t('a sealed auction refuses later quote admission',
    afterClose.response.status === 409 && afterClose.body.error === 'AUCTION_CLOSED');

  const auctionState = await request(`/auctions/${intentHash}`);
  t('public auction discovery returns the immutable close without inventing an anchor',
    auctionState.response.status === 200
      && auctionState.body.status === 'closed'
      && auctionState.body.close?.closeId === closed.body.close?.closeId
      && auctionState.body.externallyAnchored === false);

  /* -------- Phase 2c: transactional admission + completeness watcher ----- */
  t('a 201 admission carries the coordinator-signed transactional receipt',
    verifyAdmissionReceipt(accepted.body.admissionReceipt, { intentHash })
      && accepted.body.admissionReceipt.entryHash === accepted.body.entryHash
      && accepted.body.admissionReceipt.coordinator?.publicKey === coordinatorKeys.publicKey
      && accepted.body.admissionReceipt.claims?.closeInclusionGuaranteed === false
      && accepted.body.admissionReceiptAvailable === true);

  const reclaimed = await request(`/admissions/${intentHash}/${accepted.body.entryHash}`);
  t('the admissions endpoint rederives byte-identical receipt bytes from the immutable row',
    reclaimed.response.status === 200
      && JSON.stringify(reclaimed.body) === JSON.stringify(accepted.body.admissionReceipt));
  const noAdmission = await request(`/admissions/${intentHash}/0x${'00'.repeat(32)}`);
  t('an entry that was never admitted has no receipt to reclaim',
    noAdmission.response.status === 404 && noAdmission.body.error === 'ADMISSION_NOT_FOUND');

  const goodReport = buildCompletenessReport({
    close: closed.body.close,
    receipts: [accepted.body.admissionReceipt],
    watcher
  });
  const signedReport = buildCompletenessReport({
    close: closed.body.close,
    receipts: [accepted.body.admissionReceipt],
    watcher,
    privateKey: watcherKeys.privateKey
  });
  t('the watcher report builder produces the complete verdict for an intact set',
    signedReport.ok && signedReport.report.verdict === 'complete' && signedReport.report.signature);

  const unsignedStored = await request(`/auctions/${intentHash}/watcher-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(goodReport.report)
  });
  t('an unsigned report cannot be submitted even by a registered watcher',
    unsignedStored.response.status === 403 && unsignedStored.body.error === 'WATCHER_SIGNATURE_MISMATCH');

  const storedReport = await request(`/auctions/${intentHash}/watcher-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signedReport.report)
  });
  t('a registered watcher report stores after server-side deterministic recompute',
    storedReport.response.status === 201
      && storedReport.body.ok === true
      && storedReport.body.reportId === signedReport.report.reportId
      && storedReport.body.verdict === 'complete');

  const replayedReport = await request(`/auctions/${intentHash}/watcher-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signedReport.report)
  });
  t('re-submitting the same reportId replays idempotently without overwrite',
    replayedReport.response.status === 200 && replayedReport.body.alreadyReported === true);

  const tamperedReport = await request(`/auctions/${intentHash}/watcher-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...signedReport.report, verdict: 'inconclusive' })
  });
  t('a signed report whose verdict does not recompute is rejected',
    tamperedReport.response.status === 400 && tamperedReport.body.error === 'REPORT_RECOMPUTE_MISMATCH');

  const rogueKeys = generateSolverKeyPair();
  const rogueReport = buildCompletenessReport({
    close: closed.body.close,
    receipts: [accepted.body.admissionReceipt],
    watcher: { id: 'rogue-watcher', name: 'Rogue', publicKey: rogueKeys.publicKey },
    privateKey: rogueKeys.privateKey
  });
  const rogueStored = await request(`/auctions/${intentHash}/watcher-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rogueReport.report)
  });
  t('a correctly signed report from an unregistered watcher is refused',
    rogueStored.response.status === 403 && rogueStored.body.error === 'UNREGISTERED_WATCHER');

  const reportsPage = await request(`/auctions/${intentHash}/watcher-reports`);
  t('the public watcher-reports feed re-verifies and derives the completeness status',
    reportsPage.response.status === 200
      && reportsPage.body.completeness?.status === 'watcher-verified'
      && reportsPage.body.reports?.some((record) => record.report?.reportId === signedReport.report.reportId));

  const evidenceState = await request(`/auctions/${intentHash}`);
  t('auction state now exposes evidence-based per-auction completeness',
    evidenceState.response.status === 200
      && evidenceState.body.completeness?.status === 'watcher-verified'
      && evidenceState.body.watcherReports?.length === 1
      && evidenceState.body.close?.claims?.auctionCompletenessProven === false);

  /* A receipt the coordinator signed pre-seal for a bid that never reached
     the sealed set is cryptographic censorship evidence: the watcher's
     verdict must surface as misconduct on the public auction state. */
  const ghostIntentHash = `0x${randomBytes(32).toString('hex')}`;
  const ghostNow = Math.floor(Date.now() / 1000);
  const ghostCommitment = signSolverCommitment({
    ...commitment,
    intentHash: ghostIntentHash,
    amountOut: '700',
    issuedAt: ghostNow,
    validUntil: ghostNow + 90,
    nonce: `0x${randomBytes(16).toString('hex')}`,
    routeCommitment: `0x${randomBytes(32).toString('hex')}`
  }, keys.privateKey);
  const ghostAdmission = await post(ghostCommitment);
  const ghostClosed = await request(`/auctions/${ghostIntentHash}/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer unit-close-token-that-is-not-a-production-secret'
    },
    body: JSON.stringify({ ...closeRequest, intentHash: ghostIntentHash })
  });
  const droppedReceipt = issueAdmissionReceipt({
    intentHash: ghostIntentHash,
    entryHash: `0x${randomBytes(32).toString('hex')}`,
    acceptedAt: ghostClosed.body.close.sealedAt - 10000,
    solverId: solver.id
  });
  const misconductReport = buildCompletenessReport({
    close: ghostClosed.body.close,
    receipts: [droppedReceipt],
    watcher,
    privateKey: watcherKeys.privateKey
  });
  const misconductStored = await request(`/auctions/${ghostIntentHash}/watcher-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(misconductReport.report)
  });
  const misconductState = await request(`/auctions/${ghostIntentHash}`);
  t('a pre-seal receipted bid outside the sealed set proves coordinator misconduct',
    ghostAdmission.response.status === 201
      && misconductReport.ok
      && misconductReport.report.verdict === 'misconduct-evident'
      && misconductStored.response.status === 201
      && misconductState.body.completeness?.status === 'misconduct-reported');

  const phase2cCaps = await request('/capabilities');
  t('capabilities advertise receipts and the watcher protocol without claiming blanket completeness',
    phase2cCaps.body.admissions?.configured === true
      && phase2cCaps.body.admissions?.deterministicReclaim === true
      && phase2cCaps.body.watchers?.registeredWatchers === 1
      && phase2cCaps.body.watchers?.offlineVerifier === 'scripts/intent-watchtower.mjs'
      && phase2cCaps.body.auctions?.signedAdmissionReceipts === true
      && phase2cCaps.body.auctions?.auctionCompletenessProof === false);

  /* ------- Phase 3a: bonds, execution claims, disputes, adjudication ----- */
  const bondBoard = await request('/bonds');
  t('the public bond board lists the declared bond with honest status and enforcement',
    bondBoard.response.status === 200
      && bondBoard.body.configured === true
      && bondBoard.body.bondedSolvers === 1
      && bondBoard.body.bonds?.length === 1
      && bondBoard.body.bonds[0].solverId === solver.id
      && bondBoard.body.bonds[0].bonded === true
      && bondBoard.body.enforcement === 'out-of-protocol-declared'
      && bondBoard.body.onChainEscrow === false);

  const caps3a = await request('/capabilities');
  t('capabilities advertise bonds and the execution protocol without custody claims',
    caps3a.body.bonds?.configured === true
      && caps3a.body.bonds?.penaltyTableBps?.unexecuted === 10000
      && caps3a.body.execution?.registeredVerifiers === 1
      && caps3a.body.execution?.graceSeconds === 0
      && caps3a.body.execution?.deterministicGrading === true
      && caps3a.body.execution?.onChainTxVerification === false
      && caps3a.body.execution?.penaltyEnforcement === 'out-of-protocol');

  const executedAt = Math.floor(Date.now() / 1000);
  const filledClaim = buildExecutionClaim({
    close: closed.body.close,
    commitment,
    outcome: 'filled',
    txHash: `0x${randomBytes(32).toString('hex')}`,
    amountReceived: '400500000000000000',
    feeBpsCharged: 70,
    gasUsedWei: '250000',
    executedAt
  }, solver, keys.privateKey);
  t('the winning solver builds a verifiable filled claim for the sealed close',
    filledClaim.ok && verifyExecutionClaim(filledClaim.claim, { close: closed.body.close, commitment }).ok);

  const claimStored = await request(`/auctions/${intentHash}/execution-claims`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(filledClaim.claim)
  });
  t('the execution claim endpoint stores the signed outcome evidence',
    claimStored.response.status === 201
      && claimStored.body.claimId === filledClaim.claim.claimId
      && claimStored.body.claims?.onChainVerified === false
      && claimStored.body.claims?.custody === false);

  const tamperedClaim = { ...filledClaim.claim, amountReceived: '400500000000000001' };
  const tamperedStored = await request(`/auctions/${intentHash}/execution-claims`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tamperedClaim)
  });
  t('a tampered execution claim is rejected',
    tamperedStored.response.status === 400 && tamperedStored.body.error === 'BAD_CLAIM_ID');

  const rogueSolverKeys = generateSolverKeyPair();
  const rogueClaim = buildExecutionClaim({
    close: closed.body.close,
    commitment,
    outcome: 'filled',
    txHash: `0x${randomBytes(32).toString('hex')}`,
    amountReceived: '400500000000000000',
    feeBpsCharged: 70,
    executedAt
  }, { id: 'rogue-solver', publicKey: rogueSolverKeys.publicKey }, rogueSolverKeys.privateKey);
  const rogueClaimStored = await request(`/auctions/${intentHash}/execution-claims`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rogueClaim.claim)
  });
  t('a claim signed by a solver outside the registry is refused',
    rogueClaimStored.response.status === 403 && rogueClaimStored.body.error === 'UNREGISTERED_SOLVER');

  const replayedClaim = await request(`/auctions/${intentHash}/execution-claims`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(filledClaim.claim)
  });
  t('re-submitting the identical claim replays idempotently',
    replayedClaim.response.status === 200 && replayedClaim.body.alreadyStored === true);

  const conflictingClaim = buildExecutionClaim({
    close: closed.body.close,
    commitment,
    outcome: 'filled',
    txHash: `0x${randomBytes(32).toString('hex')}`,
    amountReceived: '400600000000000000',
    feeBpsCharged: 70,
    executedAt
  }, solver, keys.privateKey);
  const conflictStored = await request(`/auctions/${intentHash}/execution-claims`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(conflictingClaim.claim)
  });
  t('a second, different claim for the same close conflicts instead of overwriting',
    conflictStored.response.status === 409 && conflictStored.body.error === 'EXECUTION_CLAIM_CONFLICT');

  const claimRead = await request(`/auctions/${intentHash}/execution-claim`);
  t('the public execution-claim endpoint returns the stored signed claim',
    claimRead.response.status === 200 && claimRead.body.claimId === filledClaim.claim.claimId);

  const dispute = buildDispute({
    close: closed.body.close,
    kind: 'no-execution',
    observedAt: Math.floor(Date.now() / 1000),
    detail: 'no transaction observed by the probe'
  }, verifier, verifierKeys.privateKey);
  const disputeStored = await request(`/auctions/${intentHash}/disputes`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dispute.dispute)
  });
  t('a registered verifier can file a signed dispute',
    disputeStored.response.status === 201 && disputeStored.body.kind === 'no-execution');

  const tamperedDispute = await request(`/auctions/${intentHash}/disputes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...dispute.dispute, kind: 'false-claim' })
  });
  t('a tampered dispute is rejected',
    tamperedDispute.response.status === 400 && tamperedDispute.body.error === 'BAD_DISPUTE_ID');

  const rogueDispute = buildDispute({
    close: closed.body.close,
    kind: 'no-execution',
    observedAt: Math.floor(Date.now() / 1000)
  }, { id: 'rogue-verifier', publicKey: rogueSolverKeys.publicKey }, rogueSolverKeys.privateKey);
  const rogueDisputeStored = await request(`/auctions/${intentHash}/disputes`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rogueDispute.dispute)
  });
  t('a dispute from an unregistered verifier is refused',
    rogueDisputeStored.response.status === 403 && rogueDisputeStored.body.error === 'UNREGISTERED_VERIFIER');

  const replayedDispute = await request(`/auctions/${intentHash}/disputes`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dispute.dispute)
  });
  t('re-filing the identical dispute replays idempotently',
    replayedDispute.response.status === 200 && replayedDispute.body.alreadyStored === true);

  const disputesRead = await request(`/auctions/${intentHash}/disputes`);
  t('the public disputes feed lists the verified challenge',
    disputesRead.response.status === 200 && disputesRead.body.disputes?.length === 1);

  const unauthorizedAdjudicate = await request(`/auctions/${intentHash}/adjudicate`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
    body: JSON.stringify({})
  });
  t('adjudication requires the operator bearer secret', unauthorizedAdjudicate.response.status === 401);

  const adjudicated = await request(`/auctions/${intentHash}/adjudicate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer unit-close-token-that-is-not-a-production-secret'
    },
    body: JSON.stringify({})
  });
  t('the coordinator adjudicates deterministically from the stored evidence',
    adjudicated.response.status === 201
      && adjudicated.body.verdict === 'fulfilled'
      && adjudicated.body.penaltyBps === 0
      && adjudicated.body.penaltyUsd === '0'
      && adjudicated.body.bond?.bonded === true
      && adjudicated.body.claims?.custody === false
      && adjudicated.body.claims?.enforcement === 'out-of-protocol');

  const readjudicated = await request(`/auctions/${intentHash}/adjudicate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer unit-close-token-that-is-not-a-production-secret'
    },
    body: JSON.stringify({})
  });
  t('re-adjudicating replays the stored record idempotently',
    readjudicated.response.status === 200 && readjudicated.body.alreadyAdjudicated === true);

  const adjudicationRead = await request(`/auctions/${intentHash}/adjudication`);
  t('the public adjudication endpoint returns a record any third party can recompute',
    adjudicationRead.response.status === 200
      && verifyAdjudication(adjudicationRead.body, { close: closed.body.close }).ok
      && adjudicationRead.body.verdict === 'fulfilled');

  const settledState = await request(`/auctions/${intentHash}`);
  t('auction state now exposes the verified execution claim, dispute and adjudication',
    settledState.response.status === 200
      && settledState.body.execution?.claim?.claimId === filledClaim.claim.claimId
      && settledState.body.execution?.claimVerified === true
      && settledState.body.disputes?.length === 1
      && settledState.body.adjudicationVerified === true);

  /* A sealed close whose winner never claims: once the signed quote window
     has passed, the deterministic grade is 'unexecuted' at the full bond. */
  const unexIntent = `0x${randomBytes(32).toString('hex')}`;
  const unexNow = Math.floor(Date.now() / 1000);
  const unexCommitment = signSolverCommitment({
    ...commitment,
    intentHash: unexIntent,
    amountOut: '100',
    issuedAt: unexNow,
    validUntil: unexNow + 2,
    nonce: `0x${randomBytes(16).toString('hex')}`,
    routeCommitment: `0x${randomBytes(32).toString('hex')}`
  }, keys.privateKey);
  const unexAdmission = await post(unexCommitment);
  const unexClosed = await request(`/auctions/${unexIntent}/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer unit-close-token-that-is-not-a-production-secret'
    },
    body: JSON.stringify({ ...closeRequest, intentHash: unexIntent })
  });
  const earlyAdjudicate = await request(`/auctions/${unexIntent}/adjudicate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer unit-close-token-that-is-not-a-production-secret'
    },
    body: JSON.stringify({})
  });
  t('adjudication is refused while the execution window is still open',
    earlyAdjudicate.response.status === 409 && earlyAdjudicate.body.error === 'EXECUTION_WINDOW_OPEN');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const unexAdjudicated = await request(`/auctions/${unexIntent}/adjudicate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer unit-close-token-that-is-not-a-production-secret'
    },
    body: JSON.stringify({})
  });
  t('a winner that never claimed grades unexecuted at the full declared bond',
    unexAdmission.response.status === 201
      && unexClosed.response.status === 201
      && unexAdjudicated.response.status === 201
      && unexAdjudicated.body.verdict === 'unexecuted'
      && unexAdjudicated.body.penaltyBps === 10000
      && unexAdjudicated.body.penaltyUsd === '50000');

  /* Honesty when the bond registry is absent: everything flips to not
     configured, never to a fabricated default. */
  process.env.INTENT_SOLVER_BONDS = '';
  const noBondCaps = await request('/capabilities');
  const noBondBoard = await request('/bonds');
  t('capabilities honestly report no bonds when the registry is empty',
    noBondCaps.body.bonds?.configured === false
      && noBondCaps.body.bonds?.bondedSolvers === 0
      && noBondBoard.body.configured === false);
  process.env.INTENT_SOLVER_BONDS = JSON.stringify([
    { solverId: solver.id, bondUsd: '50000', asset: 'USDC' }
  ]);

  const savedVerifiers = process.env.INTENT_VERIFIER_KEYS;
  process.env.INTENT_VERIFIER_KEYS = '';
  const noVerifierDispute = await request(`/auctions/${intentHash}/disputes`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dispute.dispute)
  });
  t('dispute submission fails closed without a verifier registry',
    noVerifierDispute.response.status === 503 && noVerifierDispute.body.error === 'NO_REGISTERED_VERIFIERS');
  process.env.INTENT_VERIFIER_KEYS = savedVerifiers;

  /* ------- Phase 3b: outcome settlement reports -------------------------- */
  const settlementCaps = await request('/capabilities');
  t('capabilities advertise the settlement report protocol honestly',
    settlementCaps.body.settlement?.reportSchema === 'fbt.settlement-report.v1'
      && settlementCaps.body.settlement?.registeredVerifiers === 1
      && settlementCaps.body.settlement?.serverRecomputesBeforeStorage === true
      && settlementCaps.body.settlement?.adjudicationCrossCheck === true
      && settlementCaps.body.settlement?.offlineVerifier === 'scripts/intent-settler.mjs'
      && settlementCaps.body.settlement?.onChainTxVerification === false
      && settlementCaps.body.settlement?.custody === false);

  const fulfilledSettlement = buildSettlementReport({
    close: closed.body.close,
    commitment,
    claim: filledClaim.claim,
    disputes: [dispute.dispute],
    adjudication: adjudicationRead.body,
    verifier,
    privateKey: verifierKeys.privateKey,
    graceSeconds: 0
  });
  t('a verifier builds a settlement report that cross-checks the stored adjudication',
    fulfilledSettlement.ok
      && fulfilledSettlement.report.verdict === 'fulfilled'
      && fulfilledSettlement.report.adjudicationConsistent === true);

  const settlementStored = await request(`/auctions/${intentHash}/settlement-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fulfilledSettlement.report)
  });
  t('a registered verifier settlement report stores after server-side recompute',
    settlementStored.response.status === 201
      && settlementStored.body.verdict === 'fulfilled'
      && settlementStored.body.adjudicationConsistent === true
      && settlementStored.body.promisedOut === '400000000000000000'
      && settlementStored.body.deliveredOut === '400500000000000000'
      && settlementStored.body.shortfallBps === 0);

  const settlementReplay = await request(`/auctions/${intentHash}/settlement-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fulfilledSettlement.report)
  });
  t('re-submitting the same settlement reportId replays idempotently',
    settlementReplay.response.status === 200 && settlementReplay.body.alreadyReported === true);

  const tamperedSettlement = await request(`/auctions/${intentHash}/settlement-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...fulfilledSettlement.report, verdict: 'unexecuted' })
  });
  t('a signed settlement report whose verdict does not recompute is rejected',
    tamperedSettlement.response.status === 400 && tamperedSettlement.body.error === 'REPORT_RECOMPUTE_MISMATCH');

  const rogueSettlement = buildSettlementReport({
    close: closed.body.close,
    commitment,
    claim: filledClaim.claim,
    disputes: [dispute.dispute],
    adjudication: adjudicationRead.body,
    verifier: { id: 'rogue-verifier-2', publicKey: rogueSolverKeys.publicKey },
    privateKey: rogueSolverKeys.privateKey,
    graceSeconds: 0
  });
  const rogueSettlementStored = await request(`/auctions/${intentHash}/settlement-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rogueSettlement.report)
  });
  t('a settlement report from an unregistered verifier is refused',
    rogueSettlementStored.response.status === 403 && rogueSettlementStored.body.error === 'UNREGISTERED_VERIFIER');

  const settlementFeed = await request(`/auctions/${intentHash}/settlement-reports`);
  t('the public settlement feed derives the live per-auction settlement status',
    settlementFeed.response.status === 200
      && settlementFeed.body.settlement?.status === 'fulfilled'
      && settlementFeed.body.reports?.length === 1);

  /* The verifier observed a short fill while the coordinator's stored
     adjudication (graded over the solver's filled claim) says fulfilled:
     the report's deterministic cross-check surfaces an adjudication
     mismatch as hard evidence, and it dominates the settlement status. */
  const shortSettlement = buildSettlementReport({
    close: closed.body.close,
    commitment,
    claim: buildExecutionClaim({
      close: closed.body.close,
      commitment,
      outcome: 'filled',
      txHash: `0x${randomBytes(32).toString('hex')}`,
      amountReceived: '390000000000000000',
      feeBpsCharged: 70,
      executedAt
    }, solver, keys.privateKey).claim,
    disputes: [],
    adjudication: adjudicationRead.body,
    verifier,
    privateKey: verifierKeys.privateKey,
    graceSeconds: 0
  });
  const shortSettlementStored = await request(`/auctions/${intentHash}/settlement-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(shortSettlement.report)
  });
  t('a verifier-observed short fill that contradicts the stored adjudication is mismatch evidence',
    shortSettlement.ok
      && shortSettlement.report.verdict === 'adjudication-mismatch'
      && shortSettlement.report.shortfallUnits === '10000000000000000'
      && shortSettlement.report.shortfallBps === 250
      && shortSettlementStored.response.status === 201);
  const mismatchFeed = await request(`/auctions/${intentHash}/settlement-reports`);
  t('an adjudication mismatch dominates the settlement status',
    mismatchFeed.body.settlement?.status === 'adjudication-mismatch');

  const settledState3b = await request(`/auctions/${intentHash}`);
  t('auction state exposes the settlement block with evidence scope honesty',
    settledState3b.body.settlement?.status === 'adjudication-mismatch'
      && settledState3b.body.settlement?.scope === 'observed-evidence-only'
      && settledState3b.body.settlementReports?.length === 2);

  /* The unexecuted auction from Phase 3a gets its own consistent report:
     the verifier's grade agrees with the stored adjudication. */
  const unexAdjRead = await request(`/auctions/${unexIntent}/adjudication`);
  const unexSettlement = buildSettlementReport({
    close: unexClosed.body.close,
    commitment: unexCommitment,
    claim: null,
    disputes: [],
    adjudication: unexAdjRead.body,
    verifier,
    privateKey: verifierKeys.privateKey,
    graceSeconds: 0
  });
  const unexSettlementStored = await request(`/auctions/${unexIntent}/settlement-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(unexSettlement.report)
  });
  const unexState = await request(`/auctions/${unexIntent}`);
  t('an unexecuted outcome settles as adverse with a consistent adjudication cross-check',
    unexSettlement.ok
      && unexSettlement.report.verdict === 'unexecuted'
      && unexSettlement.report.adjudicationConsistent === true
      && unexSettlementStored.response.status === 201
      && unexState.body.settlement?.status === 'adverse');

  const raceIntentHash = `0x${randomBytes(32).toString('hex')}`;
  const raceBase = signSolverCommitment({
    ...commitment,
    intentHash: raceIntentHash,
    amountOut: '100',
    issuedAt: Math.floor(Date.now() / 1000),
    validUntil: Math.floor(Date.now() / 1000) + 90,
    nonce: `0x${randomBytes(16).toString('hex')}`,
    routeCommitment: `0x${randomBytes(32).toString('hex')}`
  }, keys.privateKey);
  await post(raceBase);
  const raceChallenger = signSolverCommitment({
    ...raceBase,
    amountOut: '101',
    nonce: `0x${randomBytes(16).toString('hex')}`,
    routeCommitment: `0x${randomBytes(32).toString('hex')}`
  }, keys.privateKey);
  const raceCloseRequest = { ...closeRequest, intentHash: raceIntentHash };
  const [raceAdmission, raceClose] = await Promise.all([
    post(raceChallenger),
    request(`/auctions/${raceIntentHash}/close`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer unit-close-token-that-is-not-a-production-secret'
      },
      body: JSON.stringify(raceCloseRequest)
    })
  ]);
  const raceWasIncluded = raceAdmission.response.status === 201;
  t('process-local close serialization never acknowledges a quote omitted from the sealed set',
    raceClose.response.status === 201
      && (raceWasIncluded
        ? raceClose.body.close?.logSize === 2
          && raceClose.body.close?.decision?.selectedEntryHash === raceAdmission.body.entryHash
        : raceAdmission.response.status === 409 && raceClose.body.close?.logSize === 1));

  /* ------- Phase 4a: workflow capabilities + validate + CLI claim/dispute ----- */
  const caps4a = await request('/capabilities');
  t('capabilities advertise single-chain workflows without claiming cross-chain atomicity',
    caps4a.body.workflows?.schema === 'fbt.workflow.v1'
      && caps4a.body.workflows?.singleChainAtomic === true
      && caps4a.body.workflows?.crossChainAtomic === false
      && caps4a.body.workflows?.maxNodes === 8
      && caps4a.body.workflows?.liveRouterCalldata === false
      && caps4a.body.workflows?.verifiesCallOutputs === false
      && caps4a.body.workflows?.custody === false
      && caps4a.body.workflows?.contract?.configured === false
      && caps4a.body.workflows?.contract?.holdsTokens === false
      && caps4a.body.unavailable?.atomicCrossChainWorkflows === true
      && caps4a.body.unavailable?.atomicComposableWorkflows === undefined
      && caps4a.body.endpoints?.bids === null);

  const wfDeadline = Date.now() + 3600_000;
  const sameChainValidate = await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schema: 'fbt.intent.v1',
      kind: 'workflow',
      chainId: 42161,
      fromSymbol: 'USDC',
      toSymbol: 'ETH',
      amountIn: '100',
      deadlineAt: wfDeadline,
      constraints: {
        maxSlippagePct: 0.3,
        privacy: 'standard',
        requireUserSignature: true,
        custodyAllowed: false
      },
      steps: [
        { id: 'swap', action: 'swap', chainId: 42161, asset: 'ETH', revertPolicy: 'abort-all' },
        { id: 'deposit', action: 'deposit', chainId: 42161, asset: 'ETH', revertPolicy: 'abort-all' }
      ]
    })
  });
  t('POST /validate accepts a same-chain workflow as reviewable, never executable',
    sameChainValidate.response.status === 200
      && sameChainValidate.body.ok === true
      && sameChainValidate.body.executable === false
      && sameChainValidate.body.status === 'ready-for-review'
      && sameChainValidate.body.singleChainAtomic === true
      && sameChainValidate.body.code === 'VALID');

  const crossChainValidate = await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schema: 'fbt.intent.v1',
      kind: 'workflow',
      chainId: 42161,
      fromSymbol: 'USDC',
      toSymbol: 'ETH',
      amountIn: '100',
      deadlineAt: wfDeadline,
      constraints: {
        maxSlippagePct: 0.3,
        privacy: 'standard',
        requireUserSignature: true,
        custodyAllowed: false
      },
      steps: [
        { id: 'swap', action: 'swap', chainId: 42161, asset: 'ETH', revertPolicy: 'abort-all' },
        { id: 'bridge', action: 'bridge', chainId: 1, asset: 'ETH', revertPolicy: 'abort-all' }
      ]
    })
  });
  t('POST /validate keeps a bridged workflow draft-only',
    crossChainValidate.response.status === 200
      && crossChainValidate.body.ok === true
      && crossChainValidate.body.executable === false
      && crossChainValidate.body.status === 'draft-only'
      && crossChainValidate.body.code === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE'
      && crossChainValidate.body.singleChainAtomic === false);

  /* Phase 4b state API: separate party signatures, never atomic execution. */
  const initiatorKeys = generateSolverKeyPair();
  const counterpartyKeys = generateSolverKeyPair();
  const crossNow = Math.floor(Date.now() / 1000);
  const crossPlan = {
    schema: 'fbt.cross-chain-state.v1',
    createdAt: crossNow,
    source: {
      chainId: 42161,
      token: { symbol: 'USDC', address: `0x${'81'.repeat(20)}`, native: false, decimals: 6 },
      amount: '100000000'
    },
    destination: {
      chainId: 1,
      token: { symbol: 'USDT', address: `0x${'82'.repeat(20)}`, native: false, decimals: 6 },
      amount: '99500000'
    },
    parties: {
      initiator: { id: 'api-cross-initiator', publicKey: initiatorKeys.publicKey },
      counterparty: { id: 'api-cross-counterparty', publicKey: counterpartyKeys.publicKey }
    },
    timeout: {
      sourceSignatureBy: crossNow + 60,
      destinationSignatureBy: crossNow + 120,
      refundSignatureBy: crossNow + 180
    },
    refund: {
      chainId: 42161,
      token: { symbol: 'USDC', address: `0x${'81'.repeat(20)}`, native: false, decimals: 6 },
      amount: '100000000',
      fromPartyId: 'api-cross-counterparty',
      toPartyId: 'api-cross-initiator',
      mode: 'user-signed-transfer',
      automatic: false,
      enforceableByFbt: false
    }
  };
  const createdCross = await request('/cross-chain/states', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(crossPlan)
  });
  t('POST /cross-chain/states stores an immutable non-atomic plan',
    createdCross.response.status === 201
      && createdCross.body.state?.schema === 'fbt.cross-chain-state.v1'
      && createdCross.body.status === 'awaiting-source-signature'
      && createdCross.body.atomic === false
      && createdCross.body.custody === false);
  const sourceReceipt = buildCrossChainReceipt({
    state: createdCross.body.state,
    leg: 'source-transfer',
    txHash: `0x${'83'.repeat(32)}`,
    signedAt: crossNow
  }, initiatorKeys.privateKey).receipt;
  const badSource = await request(`/cross-chain/states/${createdCross.body.state.stateId}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...sourceReceipt,
      signature: `${sourceReceipt.signature.slice(0, -1)}${sourceReceipt.signature.endsWith('A') ? 'B' : 'A'}`
    })
  });
  t('the state API refuses a forged party receipt',
    badSource.response.status === 403 && badSource.body.error === 'CROSS_CHAIN_SIGNATURE_MISMATCH');
  const storedSource = await request(`/cross-chain/states/${createdCross.body.state.stateId}/receipts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sourceReceipt)
  });
  t('the first valid signature advances only to awaiting destination signature',
    storedSource.response.status === 201
      && storedSource.body.status === 'awaiting-destination-signature'
      && storedSource.body.receipts?.length === 1);
  const destinationReceipt = buildCrossChainReceipt({
    state: createdCross.body.state,
    previousReceipts: [sourceReceipt],
    leg: 'destination-transfer',
    txHash: `0x${'84'.repeat(32)}`,
    signedAt: crossNow + 1
  }, counterpartyKeys.privateKey).receipt;
  const storedDestination = await request(`/cross-chain/states/${createdCross.body.state.stateId}/receipts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(destinationReceipt)
  });
  t('the second valid signature yields sequential evidence, never an atomic/on-chain claim',
    storedDestination.response.status === 201
      && storedDestination.body.status === 'settled-sequential'
      && storedDestination.body.complete === true
      && storedDestination.body.atomic === false
      && storedDestination.body.onChainVerified === false
      && verifyCrossChainReceipt(destinationReceipt, {
        state: createdCross.body.state, previousReceipts: [sourceReceipt]
      }).ok);

  /* ------- Phase 4c: signed account bindings + derived verification view ------- */
  const crossStateId = createdCross.body.state.stateId;
  const bindingAddress = `0x${'a1'.repeat(20)}`;
  const goodBinding = buildAccountBinding({
    state: createdCross.body.state,
    partyId: 'api-cross-initiator',
    chainId: 42161,
    address: bindingAddress,
    expiresAt: crossNow + 86400
  }, initiatorKeys.privateKey).binding;
  const unsignedBindingAttempt = await request(`/cross-chain/states/${crossStateId}/account-bindings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...goodBinding,
      signature: `${goodBinding.signature.slice(0, -1)}${goodBinding.signature.endsWith('A') ? 'B' : 'A'}`
    })
  });
  t('an account binding with a forged signature is refused — an address in a request body proves nothing',
    unsignedBindingAttempt.response.status === 403
      && unsignedBindingAttempt.body.error === 'ACCOUNT_BINDING_SIGNATURE_MISMATCH');
  const storedBinding = await request(`/cross-chain/states/${crossStateId}/account-bindings`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(goodBinding)
  });
  t('a party-key-signed account binding stores with honest self-attested claims',
    storedBinding.response.status === 201
      && storedBinding.body.binding?.claims?.addressControlSelfAttested === true
      && storedBinding.body.binding?.claims?.walletSignatureVerified === false
      && storedBinding.body.binding?.claims?.fundsAuthorityGranted === false
      && storedBinding.body.binding?.claims?.custody === false);
  const replayedBinding = await request(`/cross-chain/states/${crossStateId}/account-bindings`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(goodBinding)
  });
  t('replaying the same binding is idempotent, not a second record',
    replayedBinding.response.status === 200 && replayedBinding.body.alreadyStored === true);
  const conflictingBinding = buildAccountBinding({
    state: createdCross.body.state,
    partyId: 'api-cross-initiator',
    chainId: 42161,
    address: `0x${'a2'.repeat(20)}`,
    expiresAt: crossNow + 86400
  }, initiatorKeys.privateKey).binding;
  const bindingConflict = await request(`/cross-chain/states/${crossStateId}/account-bindings`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(conflictingBinding)
  });
  t('a different binding for the same party+chain is a conflict, never an overwrite',
    bindingConflict.response.status === 409 && bindingConflict.body.error === 'ACCOUNT_BINDING_CONFLICT');
  const bindingList = await request(`/cross-chain/states/${crossStateId}/account-bindings`);
  t('stored bindings read back exactly once',
    bindingList.response.status === 200
      && bindingList.body.bindings?.length === 1
      && bindingList.body.bindings[0].bindingId === goodBinding.bindingId);

  /* ------- Phase 4c wallet proof: public challenge + EIP-191 signature ------- */
  const walletOwner = new Wallet(hexlify(randomBytes(32)));
  const challenge = await request(`/cross-chain/states/${crossStateId}/account-binding-challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      partyId: 'api-cross-counterparty',
      chainId: 42161,
      address: walletOwner.address,
      expiresAt: crossNow + 86400,
      nonce: 'probe-nonce'
    })
  });
  t('POST /account-binding-challenge returns only the public deterministic EIP-191 message',
    challenge.response.status === 200
      && challenge.body.challenge?.domain === 'fbt.cross-chain-account-binding.v1/wallet-challenge'
      && challenge.body.challenge?.message?.includes(crossStateId)
      && challenge.body.challenge?.partyPublicKey === counterpartyKeys.publicKey
      && !JSON.stringify(challenge.body).toLowerCase().includes('private'));
  const walletSignature = await walletOwner.signMessage(challenge.body.challenge.message);
  /*
   * Use the challenge's OWN issuedAt/expiresAt, not the probe's earlier clock
   * read. The message the wallet signed is derived from the values the server
   * put in the challenge, and the request above deliberately omits issuedAt so
   * the server stamps it — meaning `crossNow` and the challenge disagree
   * whenever a second ticks between them. That is a real client requirement
   * (echo the challenge back verbatim), and using it here also removes the
   * intermittent failure this probe hit when the machine was loaded.
   */
  const provenBuild = buildAccountBinding({
    state: createdCross.body.state,
    partyId: 'api-cross-counterparty',
    chainId: 42161,
    address: walletOwner.address,
    issuedAt: challenge.body.challenge.issuedAt,
    expiresAt: challenge.body.challenge.expiresAt,
    walletProof: { scheme: 'EIP-191', nonce: 'probe-nonce', signature: walletSignature }
  }, counterpartyKeys.privateKey);
  t('a wallet signature over the served challenge builds a verified binding',
    provenBuild.ok === true && Boolean(provenBuild.binding));
  const provenBinding = provenBuild.binding;
  const storedProven = await request(`/cross-chain/states/${crossStateId}/account-bindings`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(provenBinding)
  });
  t('an EIP-191-verified binding stores with honest verified wallet-control claims',
    storedProven.response.status === 201
      && storedProven.body.binding?.claims?.walletSignatureScheme === 'EIP-191'
      && storedProven.body.binding?.claims?.walletSignatureVerified === true
      && storedProven.body.binding?.claims?.fundsAuthorityGranted === false
      && storedProven.body.binding?.claims?.custody === false);
  const forgedProof = {
    ...provenBinding,
    walletProof: {
      ...provenBinding.walletProof,
      signature: `${provenBinding.walletProof.signature.slice(0, -1)}${provenBinding.walletProof.signature.endsWith('A') ? 'B' : 'A'}`
    }
  };
  const forgedProofAttempt = await request(`/cross-chain/states/${crossStateId}/account-bindings`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(forgedProof)
  });
  t('a binding with a tampered wallet signature is refused as an invalid wallet proof',
    forgedProofAttempt.response.status === 403
      && forgedProofAttempt.body.error === 'WALLET_PROOF_INVALID');
  const eip1271Attempt = await request(`/cross-chain/states/${crossStateId}/account-bindings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...provenBinding,
      walletProof: { ...provenBinding.walletProof, scheme: 'EIP-1271' }
    })
  });
  t('EIP-1271 smart-contract wallet proofs are explicitly unsupported',
    eip1271Attempt.response.status === 403
      && eip1271Attempt.body.error === 'WALLET_PROOF_SCHEME_UNSUPPORTED');

  const fakeReport = {
    schema: 'fbt.cross-chain-tx-verification.v1',
    stateId: crossStateId,
    receiptId: sourceReceipt.receiptId,
    leg: 'source-transfer'
  };
  const unconfiguredVerification = await request(`/cross-chain/states/${crossStateId}/verification-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fakeReport)
  });
  t('a verification report cannot be stored without bindings and configured RPC quorum',
    [400, 404, 503].includes(unconfiguredVerification.response.status)
      && unconfiguredVerification.body.error !== undefined);
  const verificationList = await request(`/cross-chain/states/${crossStateId}/verification-reports`);
  t('the verification report log stays empty rather than inventing success',
    verificationList.response.status === 200 && verificationList.body.reports?.length === 0);
  const receiptScopedReports = await request(`/cross-chain/states/${crossStateId}/receipts/${sourceReceipt.receiptId}/verification-reports`);
  t('GET receipt-scoped verification reports filters by the receipt',
    receiptScopedReports.response.status === 200
      && receiptScopedReports.body.receiptId === sourceReceipt.receiptId
      && Array.isArray(receiptScopedReports.body.reports)
      && receiptScopedReports.body.reports.length === 0);
  const mismatchedScoped = await request(`/cross-chain/states/${crossStateId}/receipts/${destinationReceipt.receiptId}/verification-reports`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fakeReport)
  });
  t('a receipt-scoped report whose body receiptId does not match the path is refused',
    mismatchedScoped.response.status === 400
      && mismatchedScoped.body.error === 'VERIFICATION_RECEIPT_MISMATCH');
  const verifiedState = await request(`/cross-chain/states/${crossStateId}`);
  t('the public state derives per-leg verification without touching stored receipts',
    verifiedState.response.status === 200
      && verifiedState.body.legVerification?.['source-transfer']?.status === 'signed-only'
      && verifiedState.body.legVerification?.['destination-transfer']?.status === 'signed-only'
      && verifiedState.body.allSubmittedLegsOnChainVerified === false
      && verifiedState.body.receipts.every((row) => row.claims.onChainVerified === false)
      && verifiedState.body.atomic === false
      && verifiedState.body.custody === false
      && verifiedState.body.refundEnforcedByFbt === false);
  const caps4c = await request('/capabilities');
  t('capabilities publish Phase 4c honestly: quorum config, no RPC URLs, no independence claim',
    caps4c.response.status === 200
      && caps4c.body.crossChain?.txVerification?.multiRpcConfigured === false
      && caps4c.body.crossChain?.txVerification?.quorumRequired === 2
      && caps4c.body.crossChain?.txVerification?.rpcUrlsPublished === false
      && caps4c.body.crossChain?.txVerification?.providerIndependenceProven === false
      && caps4c.body.crossChain?.atomic === false
      && caps4c.body.crossChain?.onChainTxVerification === false);
  t('capabilities publish the crossChainVerification block honestly without env',
    caps4c.response.status === 200
      && caps4c.body.crossChainVerification?.available === true
      && caps4c.body.crossChainVerification?.configured === false
      && caps4c.body.crossChainVerification?.configuredChains === 0
      && caps4c.body.crossChainVerification?.bindingSchema === 'fbt.cross-chain-account-binding.v1'
      && caps4c.body.crossChainVerification?.verificationSchema === 'fbt.cross-chain-tx-verification.v1'
      && caps4c.body.crossChainVerification?.walletProof === 'EIP-191'
      && caps4c.body.crossChainVerification?.eip1271Supported === false
      && caps4c.body.crossChainVerification?.multiRpcRequired === true
      && caps4c.body.crossChainVerification?.minimumQuorum === 2
      && caps4c.body.crossChainVerification?.providerIndependenceProven === false
      && caps4c.body.crossChainVerification?.serverRecomputesBeforeStorage === true
      && caps4c.body.crossChainVerification?.onChainTxVerification === false
      && caps4c.body.crossChainVerification?.atomic === false
      && caps4c.body.crossChainVerification?.custody === false
      && caps4c.body.protocolSecurity?.crossChainWalletSignatureVerification === true
      && caps4c.body.protocolSecurity?.crossChainAtomicity === false);

  const tmp4a = mkdtempSync(join(tmpdir(), 'fbt-probe-4a-'));
  try {
    const closePath = join(tmp4a, 'close.json');
    const commitmentPath = join(tmp4a, 'commitment.json');
    writeFileSync(closePath, JSON.stringify(closed.body.close));
    writeFileSync(commitmentPath, JSON.stringify(commitment));
    const executedAtCli = Math.floor(Date.now() / 1000);
    const claimOut = execFileSync(process.execPath, [
      'scripts/intent-settler.mjs', 'claim', closePath, commitmentPath,
      '--outcome', 'filled',
      '--tx', `0x${randomBytes(32).toString('hex')}`,
      '--received', '400500000000000000',
      '--fee', '70',
      '--executed-at', String(executedAtCli)
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        INTENT_SOLVER_PRIVATE_KEY: keys.privateKey,
        INTENT_SOLVER_ID: solver.id,
        INTENT_SOLVER_NAME: solver.name
      }
    });
    const cliClaim = JSON.parse(claimOut);
    t('CLI claim against the sealed probe close verifies offline and never prints the key',
      verifyExecutionClaim(cliClaim, { close: closed.body.close, commitment }).ok
        && !claimOut.includes(keys.privateKey));

    const disputeOut = execFileSync(process.execPath, [
      'scripts/intent-settler.mjs', 'dispute', closePath,
      '--kind', 'false-claim',
      '--detail', 'probe observed a different fill',
      '--observed-at', String(executedAtCli)
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        INTENT_VERIFIER_PRIVATE_KEY: verifierKeys.privateKey,
        INTENT_VERIFIER_ID: verifier.id,
        INTENT_VERIFIER_NAME: verifier.name
      }
    });
    const cliDispute = JSON.parse(disputeOut);
    t('CLI dispute against the sealed probe close verifies offline and never prints the key',
      verifyDispute(cliDispute, { close: closed.body.close }).ok
        && !disputeOut.includes(verifierKeys.privateKey));
  } finally {
    rmSync(tmp4a, { recursive: true, force: true });
  }

  /* ------- Phase 5: Outcome Marketplace endpoints ------- */
  const outcomeHash = `0x${randomBytes(32).toString('hex')}`;
  const outcomeNow = Math.floor(Date.now() / 1000);
  const signedOutcomeBid = signOutcomeBid({
    schema: 'fbt.outcome-bid.v1',
    intentHash: outcomeHash,
    solverId: solver.id,
    chainId: 42161,
    settlementChainId: 42161,
    guaranteedMinimum: '10000000000000000000',
    totalMaxCost: '20000000000000000000000',
    feeBps: 70,
    slippageBps: 50,
    partialFillPolicy: 'full-only',
    expiry: outcomeNow + 86400,
    executable: true,
    issuedAt: outcomeNow,
    validUntil: outcomeNow + 90,
    nonce: `0x${randomBytes(16).toString('hex')}`,
    routeCommitment: `0x${randomBytes(32).toString('hex')}`
  }, keys.privateKey);

  const outcomeBid = await request('/outcome/bids', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedOutcomeBid)
  });
  t('the outcome endpoint accepts a signed bid from a registered bonded solver',
    outcomeBid.response.status === 201 && outcomeBid.body.accepted
      && outcomeBid.body.admissionReceiptAvailable === true);

  const singleChainOutcome = await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schema: 'fbt.intent.v1', kind: 'outcome', chainId: 42161,
      fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: '1000', deadlineAt: Date.now() + 3600000,
      constraints: { custodyAllowed: false, requireUserSignature: true, privacy: 'standard', maxSlippagePct: 0.5 },
      outcome: {
        guaranteedMinimum: '10000000000000000000', totalMaxCost: '20000000000000000000000',
        expiry: outcomeNow + 86400, settlementChainId: 42161, partialFillPolicy: 'full-only'
      }
    })
  });
  t('a single-chain outcome validates as reviewable, never executable',
    singleChainOutcome.body.ok && singleChainOutcome.body.status === 'ready-for-review'
      && singleChainOutcome.body.executable === false);

  const crossChainOutcome = await request('/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schema: 'fbt.intent.v1', kind: 'outcome', chainId: 42161,
      fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: '1000', deadlineAt: Date.now() + 3600000,
      constraints: { custodyAllowed: false, requireUserSignature: true, privacy: 'standard', maxSlippagePct: 0.5 },
      outcome: {
        guaranteedMinimum: '10000000000000000000', totalMaxCost: '20000000000000000000000',
        expiry: outcomeNow + 86400, settlementChainId: 1, partialFillPolicy: 'full-only'
      }
    })
  });
  t('a cross-chain outcome stays draft-only with OUTCOME_CROSS_CHAIN_UNAVAILABLE',
    crossChainOutcome.body.code === 'OUTCOME_CROSS_CHAIN_UNAVAILABLE'
      && crossChainOutcome.body.status === 'draft-only');

  const outcomeCapabilities = await request('/capabilities');
  t('outcome capabilities pin no custody, no auto-settlement and a closed public bid path',
    outcomeCapabilities.body.outcome?.automaticSettlement === false
      && outcomeCapabilities.body.outcome?.custody === false
      && outcomeCapabilities.body.outcome?.publicBidEndpoint === 'closed'
      && outcomeCapabilities.body.outcome?.deterministicPenaltyFromPhase3Table === true);

  /* ------- Confidential mode: honest capabilities + fail-closed routes ---- */
  const revealHash = buildIntentCommitment({
    intentHash: outcomeHash,
    auctionId: outcomeHash,
    preimage: { to: '0xabc', amount: '1' },
    solverId: solver.id
  }, keys.privateKey);
  t('commitment construction separates the public hash from the private preimage',
    revealHash.ok && revealHash.commitment.preimageHolder === 'fbt-secure-private-store'
      && revealHash.commitment.commitRevealMetadataPrivacy === false
      && !Object.hasOwn(revealHash.commitment, 'preimage')
      && revealHash.privateRecord.preimage.amount === '1');

  const confidential = await request('/confidential/operators');
  t('threshold keys are registry-only: confidential, threshold, TEE and attestation stay unavailable',
    confidential.response.status === 200
      && confidential.body.available === false
      && confidential.body.thresholdEncryption?.configured === false
      && confidential.body.thresholdEncryption?.operational === false
      && confidential.body.thresholdEncryption?.tee === false
      && confidential.body.thresholdEncryption?.attestation === false
      && confidential.body.thresholdEncryption?.registeredOperators === 0
      && confidential.body.hiddenFromFbt === false
      && confidential.body.metadataPrivacy === false);
  t('capabilities expose every missing confidential prerequisite honestly',
    capabilities.body.commitReveal?.available === false
      && capabilities.body.commitReveal?.frontendIntegrated === false
      && capabilities.body.commitReveal?.durablePrivateStorage === false
      && capabilities.body.commitReveal?.requesterAuthentication === false
      && capabilities.body.commitReveal?.earlyRevealProtection === false
      && capabilities.body.commitReveal?.hiddenFromFbt === false
      && capabilities.body.commitReveal?.metadataPrivacy === false
      && capabilities.body.commitReveal?.tee === false
      && capabilities.body.commitReveal?.attestation === false);

  const confidentialCommit = await request('/confidential/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ solverId: solver.id, preimage: { secret: 'must-not-be-read' } })
  });
  const confidentialReveal = await request('/confidential/reveal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preimage: { substituted: true }, auctionClosed: true })
  });
  t('commit and reveal reject deterministically without trusting identity, close, or client preimage fields',
    confidentialCommit.response.status === 503
      && confidentialCommit.body.error === 'CONFIDENTIAL_MODE_UNAVAILABLE'
      && confidentialReveal.response.status === 503
      && confidentialReveal.body.error === 'CONFIDENTIAL_MODE_UNAVAILABLE');
  const oversizedConfidential = await request('/confidential/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preimage: 'x'.repeat(300 * 1024) })
  });
  t('confidential rejection runs before the global JSON body-size parser',
    oversizedConfidential.response.status === 503
      && oversizedConfidential.body.error === 'CONFIDENTIAL_MODE_UNAVAILABLE');
  const historicalCommitment = await request(`/confidential/commitments/${outcomeHash}`);
  t('historical public-blob commitment reads fail closed',
    historicalCommitment.response.status === 503
      && historicalCommitment.body.error === 'CONFIDENTIAL_MODE_UNAVAILABLE');

  process.env.INTENT_SOLVER_KEYS = '';
  const unavailable = await post(commitment);
  t('commitment submission fails closed when no solver registry is configured',
    unavailable.response.status === 503 && unavailable.body.error === 'NO_REGISTERED_SOLVERS');
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (previousRegistry === undefined) delete process.env.INTENT_SOLVER_KEYS;
  else process.env.INTENT_SOLVER_KEYS = previousRegistry;
  if (previousCoordinatorId === undefined) delete process.env.INTENT_COORDINATOR_ID;
  else process.env.INTENT_COORDINATOR_ID = previousCoordinatorId;
  if (previousCoordinatorKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
  else process.env.INTENT_COORDINATOR_PRIVATE_KEY = previousCoordinatorKey;
  if (previousCloseToken === undefined) delete process.env.INTENT_AUCTION_CLOSE_TOKEN;
  else process.env.INTENT_AUCTION_CLOSE_TOKEN = previousCloseToken;
  if (previousWatcherRegistry === undefined) delete process.env.INTENT_WATCHER_KEYS;
  else process.env.INTENT_WATCHER_KEYS = previousWatcherRegistry;
  if (previousVerifierRegistry === undefined) delete process.env.INTENT_VERIFIER_KEYS;
  else process.env.INTENT_VERIFIER_KEYS = previousVerifierRegistry;
  if (previousBonds === undefined) delete process.env.INTENT_SOLVER_BONDS;
  else process.env.INTENT_SOLVER_BONDS = previousBonds;
  if (previousGrace === undefined) delete process.env.INTENT_EXECUTION_GRACE_SECONDS;
  else process.env.INTENT_EXECUTION_GRACE_SECONDS = previousGrace;
  if (previousSettlementRate === undefined) delete process.env.INTENT_SETTLEMENT_RATE_LIMIT;
  else process.env.INTENT_SETTLEMENT_RATE_LIMIT = previousSettlementRate;
  if (previousOperatorAttestations === undefined) delete process.env.INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS;
  else process.env.INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS = previousOperatorAttestations;
  if (previousCoordinatorRotations === undefined) delete process.env.INTENT_COORDINATOR_ROTATIONS;
  else process.env.INTENT_COORDINATOR_ROTATIONS = previousCoordinatorRotations;
  if (previousMerkleAnchorNetworks === undefined) delete process.env.INTENT_MERKLE_ANCHOR_NETWORKS;
  else process.env.INTENT_MERKLE_ANCHOR_NETWORKS = previousMerkleAnchorNetworks;
}

export default rows;
