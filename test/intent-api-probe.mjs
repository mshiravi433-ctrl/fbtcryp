import { randomBytes } from 'node:crypto';
import {
  generateSolverKeyPair,
  signSolverCommitment
} from '../server/intentSignatures.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);
const previousRegistry = process.env.INTENT_SOLVER_KEYS;
const previousCoordinatorId = process.env.INTENT_COORDINATOR_ID;
const previousCoordinatorKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
const previousCloseToken = process.env.INTENT_AUCTION_CLOSE_TOKEN;
const keys = generateSolverKeyPair();
const coordinatorKeys = generateSolverKeyPair();
const solver = { id: 'api-probe-solver', name: 'API Probe Solver', publicKey: keys.publicKey };
process.env.INTENT_SOLVER_KEYS = JSON.stringify([solver]);
process.env.INTENT_COORDINATOR_ID = 'api-probe-coordinator';
process.env.INTENT_COORDINATOR_PRIVATE_KEY = coordinatorKeys.privateKey;
process.env.INTENT_AUCTION_CLOSE_TOKEN = 'unit-close-token-that-is-not-a-production-secret';

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
}

export default rows;
