/**
 * TEST: PROTOCOL REST API ENDPOINTS
 */

import assert from 'node:assert/strict';
import express from 'express';
import { Wallet } from 'ethers';
import { createProtocolRouter } from '../../server/protocolRoutes.js';
import { buildEIP712IntentPayload, createCanonicalIntent } from '../../src/lib/protocol/index.js';

console.log('Running Protocol REST API endpoint tests...');

const app = express();
app.use(express.json());
app.use('/api', createProtocolRouter());

const server = app.listen(0);
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

try {
  // 1. GET /api/protocol/version
  const verRes = await fetch(`${baseUrl}/api/protocol/version`);
  assert.equal(verRes.status, 200);
  const verData = await verRes.json();
  assert.equal(verData.protocol, 'FBT Intent Protocol');
  assert.equal(verData.version, '1.0.0');

  // 2. GET /api/protocol/health
  const healthRes = await fetch(`${baseUrl}/api/protocol/health`);
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.status, 'HEALTHY');
  assert.ok(healthData.activeSolversCount >= 3);

  // 3. GET /api/solvers
  const solversRes = await fetch(`${baseUrl}/api/solvers`);
  assert.equal(solversRes.status, 200);
  const solversData = await solversRes.json();
  assert.ok(solversData.count >= 3);

  // 4. POST /api/intents
  const wallet = Wallet.createRandom();
  const rawIntent = createCanonicalIntent({
    user: wallet.address,
    sourceChain: 8453,
    destinationChain: 8453,
    sourceAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    destinationAsset: '0x4200000000000000000000000000000000000006',
    amount: '100000000',
    minAmountOut: '38000000000000000',
    deadline: Math.floor(Date.now() / 1000) + 3600,
    nonce: String(Date.now())
  });

  const { domain, types, message } = buildEIP712IntentPayload(rawIntent, 8453);
  const sig = await wallet.signTypedData(domain, types, message);
  const signedIntent = { ...rawIntent, signature: sig };

  const submitRes = await fetch(`${baseUrl}/api/intents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedIntent)
  });
  assert.equal(submitRes.status, 201);
  const submitData = await submitRes.json();
  assert.ok(submitData.intentId);
  assert.equal(submitData.status, 'COMMITTED');
  assert.ok(submitData.winningQuote);

  const intentId = submitData.intentId;

  // 5. GET /api/intents/:id
  const getRes = await fetch(`${baseUrl}/api/intents/${intentId}`);
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.intentId, intentId);
  assert.equal(getData.status, 'COMMITTED');

  // 6. GET /api/intents/:id/quotes
  const quotesRes = await fetch(`${baseUrl}/api/intents/${intentId}/quotes`);
  assert.equal(quotesRes.status, 200);
  const quotesData = await quotesRes.json();
  assert.ok(quotesData.quotesCount > 0);

  // 7. POST /api/intents/:id/cancel
  const cancelRes = await fetch(`${baseUrl}/api/intents/${intentId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'TEST_CANCEL' })
  });
  assert.equal(cancelRes.status, 200);
  const cancelData = await cancelRes.json();
  assert.equal(cancelData.status, 'CANCELLED');

  // Verify status is updated
  const getCancelled = await (await fetch(`${baseUrl}/api/intents/${intentId}`)).json();
  assert.equal(getCancelled.status, 'CANCELLED');

  // 8. POST /api/quotes and POST /api/quotes/:id/commit
  const newQuote = {
    quoteId: `q_external_${Date.now()}`,
    intentId,
    solverId: 'external-solver-01',
    amountIn: '100000000',
    amountOut: '38100000000000000',
    fee: '150000',
    executionDeadline: Math.floor(Date.now() / 1000) + 300
  };
  const qSubmitRes = await fetch(`${baseUrl}/api/quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newQuote)
  });
  assert.equal(qSubmitRes.status, 201);

  const qCommitRes = await fetch(`${baseUrl}/api/quotes/${newQuote.quoteId}/commit`, {
    method: 'POST'
  });
  assert.equal(qCommitRes.status, 200);
  const qCommitData = await qCommitRes.json();
  assert.ok(qCommitData.commitment.commitmentHash);

  console.log('✓ All Protocol REST API endpoint tests passed!');
} finally {
  server.close();
}
