/**
 * TEST: @fbt/intent-sdk
 */

import assert from 'node:assert/strict';
import express from 'express';
import { Wallet } from 'ethers';
import { createProtocolRouter } from '../../server/protocolRoutes.js';
import { FBTIntentSDK } from '../../sdk/index.js';

console.log('Running @fbt/intent-sdk client tests...');

const app = express();
app.use(express.json());
app.use('/api', createProtocolRouter());

const server = app.listen(0);
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

try {
  const sdk = new FBTIntentSDK({ baseUrl, chainId: 8453, fetchFn: fetch });

  // 1. Version & Health
  const ver = await sdk.protocol.getVersion();
  assert.equal(ver.protocol, 'FBT Intent Protocol');

  const health = await sdk.protocol.getHealth();
  assert.equal(health.status, 'HEALTHY');

  // 2. Solvers
  const solvers = await sdk.solvers.list();
  assert.ok(solvers.solvers.length >= 3);

  // 3. Create, Sign & Submit Intent
  const wallet = Wallet.createRandom();
  const intent = sdk.intent.create({
    user: wallet.address,
    sourceAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    destinationAsset: '0x4200000000000000000000000000000000000006',
    amount: '100000000',
    minAmountOut: '38000000000000000',
    deadline: Math.floor(Date.now() / 1000) + 3600
  });

  const signedIntent = await sdk.intent.sign(intent, wallet);
  assert.ok(signedIntent.signature);

  const submitted = await sdk.intent.submit(signedIntent);
  assert.ok(submitted.intentId);
  assert.equal(submitted.status, 'COMMITTED');

  // 4. Query Intent status & quotes
  const retrieved = await sdk.intent.get(submitted.intentId);
  assert.equal(retrieved.intentId, submitted.intentId);

  const quotes = await sdk.intent.getQuotes(submitted.intentId);
  assert.ok(quotes.quotes.length > 0);

  // 5. Cancel Intent
  const cancelled = await sdk.intent.cancel(submitted.intentId, { reason: 'SDK_TEST_CANCEL' });
  assert.equal(cancelled.status, 'CANCELLED');

  console.log('✓ All @fbt/intent-sdk tests passed!');
} finally {
  server.close();
}
