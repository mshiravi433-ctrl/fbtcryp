/**
 * SECURITY SUITE: PROTOCOL INVARIANT & ADVERSARIAL ATTACK TESTS
 * ---------------------------------------------------------------------------
 * Spec §24 & §25: Comprehensive security tests for:
 *   - Replay attacks
 *   - Signature replay across chains
 *   - Nonce reuse
 *   - Expired intents
 *   - Altered intent parameters
 *   - Altered quote commitments (Bait-and-Switch)
 *   - Wrong signer impersonation
 *   - Malicious solver modifying minAmountOut or fee
 *   - Receipt deficit detection
 */

import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  createCanonicalIntent,
  buildEIP712IntentPayload,
  verifyIntentSignature,
  computeIntentId,
  computeDomainSeparator,
  assertConstraintsUnmodified,
  buildQuoteCommitment,
  verifyQuoteCommitment,
  verifyExecutionReceipt,
  createExecutionReceipt,
  ProtocolNonceManager,
  IntentLifecycleRecord,
  PROTOCOL_ERROR_CODES
} from '../../src/lib/protocol/index.js';

console.log('Running Security Invariant & Adversarial Attack tests...');

const honestUser = Wallet.createRandom();
const attacker = Wallet.createRandom();
const now = Math.floor(Date.now() / 1000);

const baseIntentParams = {
  user: honestUser.address,
  sourceChain: 8453,
  destinationChain: 8453,
  sourceAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  destinationAsset: '0x4200000000000000000000000000000000000006',
  amount: '100000000', // 100 USDC
  minAmountOut: '38000000000000000', // 0.038 WETH
  maxFee: '500000',
  deadline: now + 3600,
  nonce: '101'
};

const intent = createCanonicalIntent(baseIntentParams);
const { domain, types, message } = buildEIP712IntentPayload(intent, 8453);
const validSignature = await honestUser.signTypedData(domain, types, message);
const signedIntent = { ...intent, signature: validSignature };

// Attack 1: Replay attack (using same nonce again)
const nonceManager = new ProtocolNonceManager();
nonceManager.consumeNonce(8453, honestUser.address, '101', intent.intentId);
assert.throws(
  () => nonceManager.consumeNonce(8453, honestUser.address, '101', 'intent_replay_tx'),
  /NONCE_ALREADY_USED/,
  'Security Stop: Replay of used nonce must be prevented'
);

// Attack 2: Cross-chain replay attack (submitting Arbitrum signed intent on Base)
// When verifying on Arbitrum (42161) with Base signature, domain separator mismatch rejects it
const crossChainResult = verifyIntentSignature(signedIntent, validSignature, { chainId: 42161 });
assert.equal(crossChainResult.valid, false, 'Security Stop: Cross-chain signature replay must fail');

// Attack 3: Altered intent (Attacker tries to increase spend or change destination asset)
const alteredIntent = {
  ...signedIntent,
  amount: '500000000' // Attacker alters spend to 500 USDC
};
const alteredSigCheck = verifyIntentSignature(alteredIntent, validSignature, { chainId: 8453 });
assert.equal(alteredSigCheck.valid, false, 'Security Stop: Altering intent parameters invalidates user signature');

// Attack 4: Wrong signer impersonation
const fakeSig = await attacker.signTypedData(domain, types, message);
const impersonationCheck = verifyIntentSignature(signedIntent, fakeSig, { chainId: 8453 });
assert.equal(impersonationCheck.valid, false, 'Security Stop: Signature from unauthorized account must fail');

// Attack 5: Expired intent execution
const expiredIntent = createCanonicalIntent({
  ...baseIntentParams,
  deadline: now - 60
});
const lifecycle = new IntentLifecycleRecord(expiredIntent);
assert.throws(
  () => lifecycle.transition('SIGNED'),
  /INTENT_EXPIRED/,
  'Security Stop: Expired intent execution must be blocked'
);

// Attack 6: Malicious solver lowers guaranteed minAmountOut
const maliciousQuote = {
  quoteId: 'q_malicious',
  intentId: intent.intentId,
  solverId: 'evil-solver',
  amountIn: intent.amount,
  amountOut: '35000000000000000', // 0.035 < 0.038 minAmountOut
  fee: '100000',
  executionDeadline: now + 300
};
assert.throws(
  () => assertConstraintsUnmodified(intent, maliciousQuote),
  /MIN_AMOUNT_OUT_BREACH/,
  'Security Stop: Solver reducing minAmountOut must be blocked'
);

// Attack 7: Malicious solver adds hidden exorbitant fee
const highFeeQuote = {
  quoteId: 'q_high_fee',
  intentId: intent.intentId,
  solverId: 'greedy-solver',
  amountIn: intent.amount,
  amountOut: intent.minAmountOut,
  fee: '9000000', // fee exceeds maxFee 500000
  executionDeadline: now + 300
};
assert.throws(
  () => assertConstraintsUnmodified(intent, highFeeQuote),
  /QUOTE_FEE_TOO_HIGH/,
  'Security Stop: Solver fee exceeding user cap must be blocked'
);

// Attack 8: Quote Commitment Bait-and-Switch (revealing different amounts than committed)
const honestQuote = {
  quoteId: 'q_honest',
  intentId: intent.intentId,
  solverId: 'solver-1',
  amountIn: intent.amount,
  amountOut: '38500000000000000',
  fee: '100000',
  executionDeadline: now + 300
};
const commitment = buildQuoteCommitment(honestQuote);

const baitAndSwitchQuote = {
  ...honestQuote,
  amountOut: '38000000000000000' // stealthily reduced
};
const baitCheck = verifyQuoteCommitment(baitAndSwitchQuote, commitment);
assert.equal(baitCheck.ok, false, 'Security Stop: Bait-and-switch quote must fail commitment verification');
assert.equal(baitCheck.reason, 'AMOUNT_OUT_ALTERED');

// Attack 9: Deficit receipt detection (delivering less output on-chain)
const deficitReceipt = createExecutionReceipt({
  intentId: intent.intentId,
  solverId: 'solver-1',
  quoteId: honestQuote.quoteId,
  sourceChainId: 8453,
  destinationChainId: 8453,
  transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  blockNumber: 12345,
  amountIn: intent.amount,
  amountOut: '37000000000000000' // deficit below minAmountOut
});
const deficitCheck = verifyExecutionReceipt(deficitReceipt, intent, honestQuote);
assert.equal(deficitCheck.verified, false, 'Security Stop: Output deficit must fail receipt verification');

console.log('✓ All 9 Security Invariant & Adversarial Attack tests passed!');
