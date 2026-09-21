/**
 * UNIT TEST: SOLVER REGISTRY, AUCTION COMPETITION & COMMITMENTS
 */

import assert from 'node:assert/strict';
import {
  createCanonicalIntent,
  ProtocolSolverRegistry,
  SolverAuctionEngine,
  DexAggregatorSolver,
  CrossChainSolver,
  RfqSolver,
  buildQuoteCommitment,
  verifyQuoteCommitment,
  AUCTION_POLICIES
} from '../../src/lib/protocol/index.js';

console.log('Running unit tests: Solver Registry, Auction Competition & Commitments...');

// 1. Solver Registry tests
const registry = new ProtocolSolverRegistry();
const s1 = new DexAggregatorSolver({ solverId: 'solver-dex-1', reputation: 95 });
const s2 = new RfqSolver({ solverId: 'solver-rfq-1', reputation: 99 });
const s3 = new CrossChainSolver({ solverId: 'solver-bridge-1', reputation: 90 });

registry.register(s1);
registry.register(s2);
registry.register(s3);

assert.equal(registry.list().length, 3, 'Must list 3 registered solvers');

// Reputation adjustment & bond slashing
registry.adjustReputation('solver-dex-1', 2);
assert.equal(registry.get('solver-dex-1').reputation, 97);

const slashResult = registry.slashBond('solver-dex-1', '1000000', 'TIMEOUT');
assert.equal(slashResult.slashed, '1000000');

// 2. Multi-Solver Competition
const intent = createCanonicalIntent({
  user: '0x1234567890123456789012345678901234567890',
  sourceChain: 8453,
  destinationChain: 8453,
  sourceAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  destinationAsset: '0x4200000000000000000000000000000000000006',
  amount: '100000000', // 100 USDC
  minAmountOut: '99000000', // min out
  deadline: Math.floor(Date.now() / 1000) + 3600,
  nonce: '5'
});

const auctionEngine = new SolverAuctionEngine({ solverRegistry: registry });
const auctionResult = await auctionEngine.runAuction(intent);

assert.ok(auctionResult.quotesCount >= 2, 'Auction must collect multiple competing quotes');
assert.ok(auctionResult.winningQuote, 'Auction must select winning quote');
assert.ok(BigInt(auctionResult.winningQuote.amountOut) >= BigInt(intent.minAmountOut), 'Winning quote must satisfy minAmountOut');

// 3. Verifiable Quote Commitment
const quote = auctionResult.winningQuote;
const commitment = buildQuoteCommitment(quote);
assert.ok(commitment.commitmentHash, 'Commitment must contain cryptographic hash');

// Check reveal matches commitment
const verification = verifyQuoteCommitment(quote, commitment);
assert.equal(verification.ok, true, 'Original quote must verify against commitment');

// Altering amountOut in quote must fail commitment verification
const alteredQuote = { ...quote, amountOut: '90000000' };
const alteredVerification = verifyQuoteCommitment(alteredQuote, commitment);
assert.equal(alteredVerification.ok, false, 'Altered quote must fail commitment verification');

// 4. Policy evaluation test
const scoredMaxOutput = auctionEngine.scoreQuotes([quote], intent, AUCTION_POLICIES.MAX_OUTPUT);
const scoredLowestFee = auctionEngine.scoreQuotes([quote], intent, AUCTION_POLICIES.LOWEST_FEE);
assert.ok(scoredMaxOutput.length > 0 && scoredLowestFee.length > 0);

console.log('✓ All Solver Registry, Auction & Commitment tests passed!');
