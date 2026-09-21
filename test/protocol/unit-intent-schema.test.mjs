/**
 * UNIT TEST: CANONICAL INTENT SCHEMA & VALIDATION
 */

import assert from 'node:assert/strict';
import {
  createCanonicalIntent,
  validateCanonicalIntent,
  computeIntentId,
  INTENT_SCHEMA_VERSION,
  PROTOCOL_VERSION
} from '../../src/lib/protocol/index.js';

console.log('Running unit tests: Canonical Intent Schema & Validation...');

// 1. Valid intent creation
const validParams = {
  user: '0x1234567890123456789012345678901234567890',
  sourceChain: 8453,
  destinationChain: 8453,
  sourceAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  destinationAsset: '0x4200000000000000000000000000000000000006', // WETH on Base
  amount: '100000000', // 100 USDC (6 decimals)
  minAmountOut: '38000000000000000', // 0.038 WETH (18 decimals)
  maxFee: '500000',
  slippageBps: 50,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  nonce: '1'
};

const intent = createCanonicalIntent(validParams);
assert.equal(intent.version, INTENT_SCHEMA_VERSION, 'Version must match protocol canonical version');
assert.ok(intent.intentId.startsWith('0x'), 'Intent ID must be 0x-prefixed keccak256 hash');
assert.equal(intent.intentId.length, 66, 'Intent ID must be 32 bytes (66 hex chars)');
assert.equal(intent.status, 'CREATED', 'Initial status must be CREATED');

const val = validateCanonicalIntent(intent);
assert.equal(val.valid, true, 'Intent must pass validation');
assert.equal(val.errors.length, 0, 'No errors on valid intent');

// 2. Deterministic hashing: same parameters produce identical intentId
const intentCopy = createCanonicalIntent(validParams);
assert.equal(intent.intentId, intentCopy.intentId, 'Identical intent parameters must produce identical intentId');

// 3. Changed parameters produce different intentId
const modifiedParams = { ...validParams, amount: '200000000' };
const modifiedIntent = createCanonicalIntent(modifiedParams);
assert.notEqual(intent.intentId, modifiedIntent.intentId, 'Different amounts must produce different intentIds');

// 4. Validation catches missing or invalid amounts
const invalidAmountIntent = createCanonicalIntent({ ...validParams, amount: '-100' });
const valBadAmount = validateCanonicalIntent(invalidAmountIntent);
assert.equal(valBadAmount.valid, false, 'Negative amount must fail validation');

// 5. Validation catches past deadline
const pastDeadlineIntent = createCanonicalIntent({
  ...validParams,
  deadline: Math.floor(Date.now() / 1000) - 100
});
const valBadDeadline = validateCanonicalIntent(pastDeadlineIntent);
assert.equal(valBadDeadline.valid, false, 'Past deadline must fail validation');

// 6. Validation catches invalid user address
const badUserIntent = createCanonicalIntent({ ...validParams, user: 'short' });
const valBadUser = validateCanonicalIntent(badUserIntent);
assert.equal(valBadUser.valid, false, 'Invalid user address must fail validation');

console.log('✓ All Canonical Intent Schema tests passed!');
