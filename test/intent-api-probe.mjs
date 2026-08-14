import { randomBytes } from 'node:crypto';
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
import { buildDispute } from '../server/intentDisputes.js';
import { verifyAdjudication } from '../server/intentAdjudication.js';

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
const keys = generateSolverKeyPair();
const coordinatorKeys = generateSolverKeyPair();
const watcherKeys = generateSolverKeyPair();
const verifierKeys = generateSolverKeyPair();
const solver = { id: 'api-probe-solver', name: 'API Probe Solver', publicKey: keys.publicKey };
const watcher = { id: 'api-probe-watcher', name: 'API Probe Watcher', publicKey: watcherKeys.publicKey };
const verifier = { id: 'api-probe-verifier', name: 'API Probe Verifier', publicKey: verifierKeys.publicKey };
process.env.INTENT_SOLVER_KEYS = JSON.stringify([solver]);
process.env.INTENT_COORDINATOR_ID = 'api-probe-coordinator';
process.env.INTENT_COORDINATOR_PRIVATE_KEY = coordinatorKeys.privateKey;
process.env.INTENT_AUCTION_CLOSE_TOKEN = 'unit-close-token-that-is-not-a-production-secret';
process.env.INTENT_WATCHER_KEYS = JSON.stringify([watcher]);
process.env.INTENT_VERIFIER_KEYS = JSON.stringify([verifier]);
process.env.INTENT_SOLVER_BONDS = JSON.stringify([
  { solverId: solver.id, bondUsd: '50000', asset: 'USDC', terms: 'API probe bond' }
]);
process.env.INTENT_EXECUTION_GRACE_SECONDS = '0';

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

  const discovered = await request('/solvers');
  t('public solver discovery exposes only the registered public identity',
    discovered.response.status === 200
      && discovered.body.solvers?.length === 1
      && discovered.body.solvers[0].id === solver.id
      && discovered.body.solvers[0].publicKey === keys.publicKey);

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
}

export default rows;
