/**
 * UNIT TEST: INTENT HASHING & SIGNATURE AUTHORIZATION
 */

import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  createCanonicalIntent,
  computeIntentId,
  computeEIP712IntentStructHash,
  computeDomainSeparator,
  buildEIP712IntentPayload,
  verifyIntentSignature,
  verifyEVMSignature,
  verifySolanaSignature,
  buildSolanaSignMessage
} from '../../src/lib/protocol/index.js';

console.log('Running unit tests: Hashing & Signature Authorization...');

// 1. EVM EIP-712 Signing and Verification
const evmWallet = Wallet.createRandom();
const now = Math.floor(Date.now() / 1000);

const evmIntent = createCanonicalIntent({
  user: evmWallet.address,
  sourceChain: 8453,
  destinationChain: 8453,
  sourceAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  destinationAsset: '0x4200000000000000000000000000000000000006',
  amount: '100000000',
  minAmountOut: '38000000000000000',
  maxFee: '500000',
  deadline: now + 3600,
  nonce: '1'
});

const { domain, types, message } = buildEIP712IntentPayload(evmIntent, 8453);
const evmSignature = await evmWallet.signTypedData(domain, types, message);

const signedEVMIntent = {
  ...evmIntent,
  signature: evmSignature
};

const evmSigResult = verifyIntentSignature(signedEVMIntent, evmSignature, { chainId: 8453 });
assert.equal(evmSigResult.valid, true, 'Valid EVM signature must verify successfully');
assert.equal(evmSigResult.chainType, 'evm', 'Chain type must be evm');

// 2. Reject EVM signature from wrong signer
const wrongWallet = Wallet.createRandom();
const wrongSig = await wrongWallet.signTypedData(domain, types, message);
const wrongSigResult = verifyIntentSignature(signedEVMIntent, wrongSig, { chainId: 8453 });
assert.equal(wrongSigResult.valid, false, 'Signature from wrong wallet must fail');

// 3. Reject tampered intent parameters with original signature
const tamperedIntent = {
  ...signedEVMIntent,
  amount: '999999999' // attacker attempts to drain more funds
};
const tamperedResult = verifyIntentSignature(tamperedIntent, evmSignature, { chainId: 8453 });
assert.equal(tamperedResult.valid, false, 'Tampered intent fields must fail signature verification');

// 4. Solana Ed25519 Signing and Verification
const solanaKeypair = nacl.sign.keyPair();
const solanaAddress = bs58.encode(solanaKeypair.publicKey);

const solanaIntent = createCanonicalIntent({
  user: solanaAddress,
  sourceChain: 501,
  destinationChain: 501,
  sourceAsset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  destinationAsset: 'So11111111111111111111111111111111111111112', // SOL
  amount: '100000000',
  minAmountOut: '500000000',
  deadline: now + 3600,
  nonce: '100'
});

const solanaMessage = buildSolanaSignMessage(solanaIntent);
const solanaSigBytes = nacl.sign.detached(solanaMessage, solanaKeypair.secretKey);
const solanaSigBase58 = bs58.encode(solanaSigBytes);

const signedSolanaIntent = {
  ...solanaIntent,
  signature: solanaSigBase58
};

const solanaSigResult = verifyIntentSignature(signedSolanaIntent, solanaSigBase58);
assert.equal(solanaSigResult.valid, true, 'Valid Solana signature must verify successfully');
assert.equal(solanaSigResult.chainType, 'solana', 'Chain type must be solana');

// 5. Domain separation test
const domainSep1 = computeDomainSeparator(1, '0x1111111111111111111111111111111111111111');
const domainSep2 = computeDomainSeparator(8453, '0x1111111111111111111111111111111111111111');
assert.notEqual(domainSep1, domainSep2, 'Different chainIds must produce different domain separators');

console.log('✓ All Hashing & Signature tests passed!');
