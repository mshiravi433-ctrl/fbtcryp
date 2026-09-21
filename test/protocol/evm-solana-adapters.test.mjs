/**
 * TEST: EVM & SOLANA CHAIN ADAPTERS & CROSS-CHAIN ABSTRACTION
 */

import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  createCanonicalIntent,
  EVMChainAdapter,
  SolanaChainAdapter,
  CrossChainExecutionAdapter
} from '../../src/lib/protocol/index.js';

console.log('Running EVM & Solana Chain Adapter tests...');

const evmWallet = Wallet.createRandom();

// 1. EVM Adapter on Multiple Networks
const evmChains = [
  { id: 1, name: 'Ethereum' },
  { id: 8453, name: 'Base' },
  { id: 42161, name: 'Arbitrum' },
  { id: 10, name: 'Optimism' }
];

for (const net of evmChains) {
  const adapter = new EVMChainAdapter({ chainId: net.id });
  assert.equal(adapter.chainType, 'evm');
  assert.equal(adapter.chainId, net.id);

  const intent = createCanonicalIntent({
    user: evmWallet.address,
    sourceChain: net.id,
    destinationChain: net.id,
    sourceAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    destinationAsset: '0x4200000000000000000000000000000000000006',
    amount: '100000000',
    minAmountOut: '38000000000000000',
    deadline: Math.floor(Date.now() / 1000) + 3600,
    nonce: '1'
  });

  const quote = {
    quoteId: 'q_test',
    amountIn: intent.amount,
    amountOut: intent.minAmountOut,
    route: { calldata: '0x1234' }
  };

  // Transaction building & simulation
  const tx = await adapter.prepareTransaction(intent, quote);
  assert.equal(tx.chainId, net.id);

  const sim = await adapter.simulate(tx);
  assert.equal(sim.ok, true, `Simulation on ${net.name} must succeed`);

  // Signing
  const sig = await adapter.sign(intent, evmWallet);
  assert.ok(sig.startsWith('0x'), 'EVM signature must be 0x-prefixed');

  // Submission & confirmation
  const sub = await adapter.submit(tx);
  assert.ok(sub.txHash.startsWith('0x'), 'Submitted tx must have hash');

  const conf = await adapter.waitForConfirmation(sub.txHash);
  assert.equal(conf.confirmed, true, 'Tx must confirm');
}

// 2. Solana Adapter
const solanaKeypair = nacl.sign.keyPair();
const solAddress = bs58.encode(solanaKeypair.publicKey);
const solAdapter = new SolanaChainAdapter();

const solIntent = createCanonicalIntent({
  user: solAddress,
  sourceChain: 501,
  destinationChain: 501,
  sourceAsset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  destinationAsset: 'So11111111111111111111111111111111111111112',
  amount: '100000000',
  minAmountOut: '500000000',
  deadline: Math.floor(Date.now() / 1000) + 3600,
  nonce: '1'
});

const solTx = await solAdapter.prepareTransaction(solIntent, { amountIn: '100000000', amountOut: '500000000' });
assert.equal(solTx.chainId, 501);

const solSim = await solAdapter.simulate(solTx);
assert.equal(solSim.ok, true, 'Solana simulation must succeed');

const solWalletMock = {
  signMessage: async (msg) => bs58.encode(nacl.sign.detached(msg, solanaKeypair.secretKey))
};
const solSig = await solAdapter.sign(solIntent, solWalletMock);
assert.ok(solSig.length > 50, 'Solana signature must be valid Base58 string');

const solSub = await solAdapter.submit(solTx);
assert.ok(solSub.txHash.startsWith('sol_'), 'Solana tx must have valid hash');

// 3. Cross-Chain Universal Adapter
const crossAdapter = new CrossChainExecutionAdapter();
const crossIntent = createCanonicalIntent({
  user: evmWallet.address,
  sourceChain: 42161, // Arbitrum
  destinationChain: 8453, // Base
  sourceAsset: 'USDC',
  destinationAsset: 'ETH',
  amount: '100000000',
  minAmountOut: '38000000000000000',
  deadline: Math.floor(Date.now() / 1000) + 3600,
  nonce: '1'
});

const routeEstimate = await crossAdapter.estimateRoute(crossIntent);
assert.equal(routeEstimate.isCrossChain, true, 'Must identify as cross-chain');
assert.equal(routeEstimate.steps.length, 3, 'Must have 3-step cross-chain path');

const sourceLeg = await crossAdapter.buildSourceLeg(crossIntent, { amountIn: '100000000' });
assert.equal(sourceLeg.chainId, 42161);
assert.equal(sourceLeg.destinationChainId, 8453);

console.log('✓ All EVM & Solana Chain Adapter tests passed!');
