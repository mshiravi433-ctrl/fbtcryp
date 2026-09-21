/**
 * UNIT TEST: EXECUTION RECEIPTS, MERKLE PROOFS & PARTIAL FILL
 */

import assert from 'node:assert/strict';
import {
  createCanonicalIntent,
  createExecutionReceipt,
  verifyExecutionReceipt,
  ProtocolMerkleTree,
  verifyMerkleProof,
  hashEvidenceLeaf,
  PartialFillTracker,
  EVIDENCE_TIERS
} from '../../src/lib/protocol/index.js';

console.log('Running unit tests: Execution Receipts, Merkle Proofs & Partial Fill...');

const intent = createCanonicalIntent({
  user: '0x1234567890123456789012345678901234567890',
  sourceChain: 8453,
  destinationChain: 8453,
  sourceAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  destinationAsset: '0x4200000000000000000000000000000000000006',
  amount: '100000000', // 100 USDC
  minAmountOut: '38000000000000000', // 0.038 WETH
  deadline: Math.floor(Date.now() / 1000) + 3600,
  nonce: '1'
});

// 1. Valid ExecutionReceipt
const receipt = createExecutionReceipt({
  intentId: intent.intentId,
  solverId: 'solver-dex-1',
  quoteId: 'q_123',
  sourceChainId: 8453,
  destinationChainId: 8453,
  transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  blockNumber: 21980001,
  amountIn: '100000000',
  amountOut: '38500000000000000', // 0.0385 WETH > 0.038 WETH
  fee: '200000',
  evidenceTier: EVIDENCE_TIERS.ON_CHAIN_VERIFIED
});

const verification = verifyExecutionReceipt(receipt, intent, { quoteId: 'q_123' });
assert.equal(verification.verified, true, 'Valid receipt must verify');
assert.equal(verification.constraintSatisfied, true);

// 2. Receipt with deficit must fail verification
const deficitReceipt = createExecutionReceipt({
  ...receipt,
  amountOut: '35000000000000000' // 0.035 WETH < 0.038 WETH guaranteed
});
const deficitVerification = verifyExecutionReceipt(deficitReceipt, intent, { quoteId: 'q_123' });
assert.equal(deficitVerification.verified, false, 'Deficit output must fail verification');
assert.equal(deficitVerification.reason, 'MIN_OUTPUT_NOT_SATISFIED');

// 3. Merkle Tree & Inclusion Proofs
const events = [
  receipt,
  { eventId: 'e2', type: 'SWAP_SETTLED', data: { amount: '500' } },
  { eventId: 'e3', type: 'BRIDGE_CONFIRMED', data: { tx: '0x123' } },
  { eventId: 'e4', type: 'AUCTION_CLOSED', data: { winner: 'solver-dex-1' } }
];

const tree = new ProtocolMerkleTree(events);
const root = tree.getRoot();
assert.ok(root.startsWith('0x'), 'Root must be a 0x-prefixed hash');

// Generate proof for index 0 (receipt)
const proof = tree.getProof(0);
assert.equal(proof.index, 0);
assert.ok(proof.proof.length > 0, 'Proof must contain sibling hashes');

// Independently verify proof
const isIncluded = verifyMerkleProof(proof.leaf, proof.proof, root);
assert.equal(isIncluded, true, 'Merkle proof must verify successfully against root');

// Tampered leaf must fail verification
const fakeLeaf = '0x' + '1'.repeat(64);
const isFakeIncluded = verifyMerkleProof(fakeLeaf, proof.proof, root);
assert.equal(isFakeIncluded, false, 'Tampered leaf must fail Merkle proof verification');

// 4. Partial Fill Tracker
const partialIntent = createCanonicalIntent({
  ...intent,
  amount: '1000',
  minAmountOut: '100',
  partialFill: { enabled: true }
});

const tracker = new PartialFillTracker(partialIntent);
assert.equal(tracker.getProgress().remainingAmount, '1000');

// Fill 1: 400 input -> 42 output (rate: 42/400 >= 100/1000)
const fill1 = tracker.applyFill({
  fillAmount: '400',
  outputAmount: '42',
  solverId: 's1',
  txHash: '0x111'
});
assert.equal(fill1.isFullyFilled, false);
assert.equal(fill1.remainingAmount, '600');
assert.equal(fill1.status, 'PARTIALLY_FILLED');

// Fill 2: 600 input -> 65 output (finishes the intent)
const fill2 = tracker.applyFill({
  fillAmount: '600',
  outputAmount: '65',
  solverId: 's2',
  txHash: '0x222'
});
assert.equal(fill2.isFullyFilled, true);
assert.equal(fill2.remainingAmount, '0');
assert.equal(fill2.status, 'COMPLETED');

console.log('✓ All Execution Receipt, Merkle Proof & Partial Fill tests passed!');
