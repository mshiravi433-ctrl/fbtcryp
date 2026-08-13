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

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);
const previousRegistry = process.env.INTENT_SOLVER_KEYS;
const previousCoordinatorId = process.env.INTENT_COORDINATOR_ID;
const previousCoordinatorKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
const previousCloseToken = process.env.INTENT_AUCTION_CLOSE_TOKEN;
const previousWatcherRegistry = process.env.INTENT_WATCHER_KEYS;
const keys = generateSolverKeyPair();
const coordinatorKeys = generateSolverKeyPair();
const watcherKeys = generateSolverKeyPair();
const solver = { id: 'api-probe-solver', name: 'API Probe Solver', publicKey: keys.publicKey };
const watcher = { id: 'api-probe-watcher', name: 'API Probe Watcher', publicKey: watcherKeys.publicKey };
process.env.INTENT_SOLVER_KEYS = JSON.stringify([solver]);
process.env.INTENT_COORDINATOR_ID = 'api-probe-coordinator';
process.env.INTENT_COORDINATOR_PRIVATE_KEY = coordinatorKeys.privateKey;
process.env.INTENT_AUCTION_CLOSE_TOKEN = 'unit-close-token-that-is-not-a-production-secret';
process.env.INTENT_WATCHER_KEYS = JSON.stringify([watcher]);

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
}

export default rows;
