import { randomBytes } from 'node:crypto';
import {
  generateSolverKeyPair,
  signSolverCommitment
} from '../server/intentSignatures.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);
const previousRegistry = process.env.INTENT_SOLVER_KEYS;
const keys = generateSolverKeyPair();
const solver = { id: 'api-probe-solver', name: 'API Probe Solver', publicKey: keys.publicKey };
process.env.INTENT_SOLVER_KEYS = JSON.stringify([solver]);

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
      && capabilities.body.transparency?.externallyAnchored === false);

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

  process.env.INTENT_SOLVER_KEYS = '';
  const unavailable = await post(commitment);
  t('commitment submission fails closed when no solver registry is configured',
    unavailable.response.status === 503 && unavailable.body.error === 'NO_REGISTERED_SOLVERS');
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (previousRegistry === undefined) delete process.env.INTENT_SOLVER_KEYS;
  else process.env.INTENT_SOLVER_KEYS = previousRegistry;
}

export default rows;
