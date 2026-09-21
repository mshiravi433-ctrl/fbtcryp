/**
 * UNIT TEST: NONCE REPLAY DEFENSE & LIFECYCLE STATE MACHINE
 */

import assert from 'node:assert/strict';
import {
  ProtocolNonceManager,
  IntentLifecycleRecord,
  createCanonicalIntent
} from '../../src/lib/protocol/index.js';

console.log('Running unit tests: Nonce Replay Defense & Lifecycle State Machine...');

// 1. Nonce sequential management
const nonceManager = new ProtocolNonceManager();
const user = '0x1234567890123456789012345678901234567890';
const chainId = 8453;

const n1 = nonceManager.getNextNonce(chainId, user);
assert.equal(n1, '1', 'Initial sequential nonce must be 1');

// Consume n1
nonceManager.consumeNonce(chainId, user, n1, 'intent_1');
const n2 = nonceManager.getNextNonce(chainId, user);
assert.equal(n2, '2', 'Next sequential nonce must be 2');

// Replay attack prevention: consuming n1 again must throw NONCE_ALREADY_USED
assert.throws(
  () => nonceManager.consumeNonce(chainId, user, n1, 'intent_replay'),
  /NONCE_ALREADY_USED/,
  'Consuming spent nonce must fail'
);

// 2. Cancellation invalidation
const n3 = '3';
nonceManager.cancelNonce(chainId, user, n3, 'USER_CANCELLED');
assert.throws(
  () => nonceManager.consumeNonce(chainId, user, n3, 'intent_3'),
  /INTENT_ALREADY_CANCELLED/,
  'Consuming cancelled nonce must fail'
);

// 3. Lifecycle Happy Path
const intent = createCanonicalIntent({
  user,
  sourceChain: chainId,
  sourceAsset: 'USDC',
  destinationAsset: 'ETH',
  amount: '100000000',
  minAmountOut: '38000000000000000',
  deadline: Math.floor(Date.now() / 1000) + 3600,
  nonce: '10'
});

const lifecycle = new IntentLifecycleRecord(intent);
assert.equal(lifecycle.status, 'CREATED');

lifecycle.transition('SIGNED');
assert.equal(lifecycle.status, 'SIGNED');

lifecycle.transition('VALIDATED');
assert.equal(lifecycle.status, 'VALIDATED');

lifecycle.transition('SUBMITTED');
assert.equal(lifecycle.status, 'SUBMITTED');

lifecycle.transition('OPEN');
assert.equal(lifecycle.status, 'OPEN');

lifecycle.transition('QUOTING');
assert.equal(lifecycle.status, 'QUOTING');

lifecycle.transition('COMMITTED');
assert.equal(lifecycle.status, 'COMMITTED');

lifecycle.transition('EXECUTING');
assert.equal(lifecycle.status, 'EXECUTING');

lifecycle.transition('SETTLING');
assert.equal(lifecycle.status, 'SETTLING');

lifecycle.transition('VERIFIED');
assert.equal(lifecycle.status, 'VERIFIED');

lifecycle.transition('COMPLETED');
assert.equal(lifecycle.status, 'COMPLETED');
assert.equal(lifecycle.isTerminal(), true, 'COMPLETED is terminal');

// 4. Terminal status cannot transition
assert.throws(
  () => lifecycle.transition('EXECUTING'),
  /terminal status/,
  'Terminal status must have no outgoing transitions'
);

// 5. Illegal transition jump
const badLifecycle = new IntentLifecycleRecord(intent);
assert.throws(
  () => badLifecycle.transition('COMPLETED'),
  /Illegal transition/,
  'Illegal jump from CREATED directly to COMPLETED must be rejected'
);

// 6. Expiration triggers automatically when deadline passed
const expiredIntent = createCanonicalIntent({
  ...intent,
  deadline: Math.floor(Date.now() / 1000) - 10
});
const expLifecycle = new IntentLifecycleRecord(expiredIntent);
assert.throws(
  () => expLifecycle.transition('SIGNED'),
  /INTENT_EXPIRED/,
  'Transitioning past deadline must trigger auto-expiration'
);
assert.equal(expLifecycle.status, 'EXPIRED', 'Status must transition to EXPIRED');

console.log('✓ All Nonce & Lifecycle State Machine tests passed!');
