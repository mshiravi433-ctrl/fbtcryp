/**
 * INTEGRATION TEST: AI -> INTENT -> SOLVER -> QUOTE -> EXECUTION -> VERIFICATION
 */

import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  universalToCanonicalIntent,
  validateCanonicalIntent,
  buildEIP712IntentPayload,
  verifyIntentSignature,
  globalSolverRegistry,
  SolverAuctionEngine,
  DexAggregatorSolver,
  RfqSolver,
  CrossChainSolver,
  buildQuoteCommitment,
  verifyQuoteCommitment,
  createExecutionReceipt,
  verifyExecutionReceipt,
  IntentLifecycleRecord,
  globalNonceManager
} from '../../src/lib/protocol/index.js';

console.log('Running integration tests: AI -> Intent -> Solver -> Quote -> Execution -> Verification...');

if (globalSolverRegistry.list().length === 0) {
  globalSolverRegistry.register(new DexAggregatorSolver());
  globalSolverRegistry.register(new CrossChainSolver());
  globalSolverRegistry.register(new RfqSolver());
}

const userWallet = Wallet.createRandom();

// 1. AI produces structured request (Universal Intent)
const universalAIIntent = {
  id: 'ci_intent_991823',
  type: 'EXECUTE_SWAP',
  rawText: 'Swap 100 USDC to ETH on Base',
  extracted: {
    networks: [8453, 8453],
    assets: ['USDC', 'ETH'],
    amounts: [{ value: '100000000', raw: '100' }]
  }
};

// 2. Conversion to Canonical Protocol Intent
const protocolIntent = universalToCanonicalIntent(universalAIIntent, {
  user: userWallet.address,
  chainId: 8453,
  slippageBps: 50
});

assert.ok(protocolIntent.intentId, 'Protocol intent must have deterministic intentId');
const val = validateCanonicalIntent(protocolIntent);
assert.equal(val.valid, true, 'Converted canonical intent must be valid');

// 3. Lifecycle initialized & User Wallet Signs
const lifecycle = new IntentLifecycleRecord(protocolIntent);
assert.equal(lifecycle.status, 'CREATED');

const { domain, types, message } = buildEIP712IntentPayload(protocolIntent, 8453);
const userSignature = await userWallet.signTypedData(domain, types, message);

const signedIntent = {
  ...protocolIntent,
  signature: userSignature
};

const sigCheck = verifyIntentSignature(signedIntent, userSignature, { chainId: 8453 });
assert.equal(sigCheck.valid, true, 'User signature must be valid');
lifecycle.transition('SIGNED');

// 4. Verification & Intent Pool Entry
lifecycle.transition('VALIDATED');
lifecycle.transition('SUBMITTED');
lifecycle.transition('OPEN');

// 5. Solver Competition
lifecycle.transition('QUOTING');
const auctionEngine = new SolverAuctionEngine({ solverRegistry: globalSolverRegistry });
const auctionResult = await auctionEngine.runAuction(signedIntent);

assert.ok(auctionResult.winningQuote, 'Auction must pick winning solver quote');
const winningQuote = auctionResult.winningQuote;
assert.ok(BigInt(winningQuote.amountOut) >= BigInt(protocolIntent.minAmountOut), 'Quote must honor min output');

// 6. Quote Commitment
const commitment = buildQuoteCommitment(winningQuote);
const commitmentCheck = verifyQuoteCommitment(winningQuote, commitment);
assert.equal(commitmentCheck.ok, true, 'Commitment must verify');
lifecycle.transition('COMMITTED');

// 7. Execution by Winning Solver
lifecycle.transition('EXECUTING');
const solverInstance = globalSolverRegistry.get(winningQuote.solverId);
const executionResult = await solverInstance.execute(signedIntent, winningQuote);

assert.equal(executionResult.success, true, 'Execution must succeed');
assert.ok(executionResult.txHash, 'Must return transaction hash');

// 8. Settlement & Nonce Invalidation
lifecycle.transition('SETTLING');
globalNonceManager.consumeNonce(signedIntent.sourceChain, signedIntent.user, signedIntent.nonce, signedIntent.intentId);

// Verify replay is now impossible
assert.equal(
  globalNonceManager.isNonceValid(signedIntent.sourceChain, signedIntent.user, signedIntent.nonce).valid,
  false,
  'Nonce must be consumed and replay blocked'
);

// 9. Proof-of-Execution Verification
const receipt = createExecutionReceipt({
  intentId: signedIntent.intentId,
  solverId: winningQuote.solverId,
  quoteId: winningQuote.quoteId,
  sourceChainId: 8453,
  destinationChainId: 8453,
  transactionHash: executionResult.txHash,
  blockNumber: executionResult.blockNumber,
  amountIn: executionResult.amountIn,
  amountOut: executionResult.amountOut,
  fee: executionResult.fee
});

const receiptCheck = verifyExecutionReceipt(receipt, signedIntent, winningQuote);
assert.equal(receiptCheck.verified, true, 'Receipt must verify against signed intent');
assert.equal(receiptCheck.constraintSatisfied, true, 'All user constraints must be verified satisfied');

lifecycle.transition('VERIFIED');
lifecycle.transition('COMPLETED');
assert.equal(lifecycle.status, 'COMPLETED');

console.log('✓ Full AI -> Intent -> Solver -> Quote -> Execution -> Settlement Integration test passed!');
