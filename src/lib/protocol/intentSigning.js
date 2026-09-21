/**
 * FBT INTENT PROTOCOL — USER SIGNATURE AUTHORIZATION & VERIFICATION
 * ---------------------------------------------------------------------------
 * Spec §4: EVM EIP-712 typed data & Solana Ed25519 authorization.
 * Signed user constraints must remain immutable.
 */

import { verifyTypedData, getAddress, toUtf8Bytes, verifyMessage, keccak256 } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  EIP712_TYPES
} from './types.js';
import { computeConstraintsHash } from './intentHashing.js';
import { createIntentError, PROTOCOL_ERROR_CODES } from './intentErrors.js';

/**
 * Builds standard EIP-712 payload for ethers/wagmi/viem signTypedData.
 */
export function buildEIP712IntentPayload(intent, chainId = null, verifyingContract = '0x0000000000000000000000000000000000000000') {
  const activeChainId = Number(chainId || intent.sourceChain || 1);
  const cleanAddr = (a) => (typeof a === 'string' && a.startsWith('0x') && a.length === 42 ? getAddress(a) : '0x0000000000000000000000000000000000000000');

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: activeChainId,
    verifyingContract: cleanAddr(verifyingContract)
  };

  const types = {
    FBTIntent: EIP712_TYPES.FBTIntent
  };

  const message = {
    version: intent.version || 'fbt.intent.v2',
    user: cleanAddr(intent.user),
    sourceChainId: BigInt(intent.sourceChain || 1),
    destinationChainId: BigInt(intent.destinationChain || intent.sourceChain || 1),
    sourceAsset: cleanAddr(intent.sourceAsset),
    destinationAsset: cleanAddr(intent.destinationAsset),
    amount: BigInt(intent.amount || '0'),
    minAmountOut: BigInt(intent.minAmountOut || '0'),
    maxFee: BigInt(intent.maxFee || '0'),
    deadline: BigInt(intent.deadline || 0),
    nonce: BigInt(intent.nonce && /^[0-9]+$/.test(intent.nonce) ? intent.nonce : (Math.floor(Date.now() / 1000))),
    constraintsHash: intent.constraintsHash || computeConstraintsHash(intent.constraints)
  };

  return { domain, types, message };
}

/**
 * Generates Solana message buffer for wallet signing.
 */
export function buildSolanaSignMessage(intent) {
  const text = `FBT_INTENT:${intent.intentId}:CHAIN:${intent.sourceChain}:USER:${intent.user}:DEADLINE:${intent.deadline}:NONCE:${intent.nonce}`;
  return new TextEncoder().encode(text);
}

/**
 * Verifies EVM EIP-712 typed data signature.
 */
export function verifyEVMSignature(intent, signature, chainId = null, verifyingContract = '0x0000000000000000000000000000000000000000') {
  if (!signature || typeof signature !== 'string') return false;

  try {
    const { domain, types, message } = buildEIP712IntentPayload(intent, chainId, verifyingContract);
    const recovered = verifyTypedData(domain, types, message, signature);
    const expected = getAddress(intent.user);
    if (getAddress(recovered) === expected) return true;
  } catch (err) {
    // Fall back to personal_sign message verification if wallet does not support EIP-712
    try {
      const personalMsg = `FBT INTENT:\nintentId: ${intent.intentId}\nuser: ${intent.user}\namount: ${intent.amount}\nminAmountOut: ${intent.minAmountOut}\nnonce: ${intent.nonce}`;
      const recoveredPersonal = verifyMessage(personalMsg, signature);
      if (getAddress(recoveredPersonal) === getAddress(intent.user)) return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Verifies Solana Ed25519 signature.
 */
export function verifySolanaSignature(intent, signature) {
  if (!signature) return false;
  try {
    const message = buildSolanaSignMessage(intent);
    const sigBytes = typeof signature === 'string'
      ? (signature.startsWith('0x') ? Buffer.from(signature.slice(2), 'hex') : bs58.decode(signature))
      : signature;
    const pubKeyBytes = bs58.decode(intent.user);

    return nacl.sign.detached.verify(message, sigBytes, pubKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Universal verification router for both EVM and Solana.
 */
export function verifyIntentSignature(intent, signature = intent.signature, options = {}) {
  const sig = signature || intent.signature;
  if (!sig) {
    return {
      valid: false,
      reason: 'No signature provided'
    };
  }

  const isSolana = intent.sourceChain === 501 || intent.sourceChain === 'solana' || (typeof intent.user === 'string' && !intent.user.startsWith('0x'));

  if (isSolana) {
    const valid = verifySolanaSignature(intent, sig);
    return {
      valid,
      chainType: 'solana',
      reason: valid ? null : 'Invalid Solana Ed25519 signature'
    };
  } else {
    const valid = verifyEVMSignature(intent, sig, options.chainId, options.verifyingContract);
    return {
      valid,
      chainType: 'evm',
      reason: valid ? null : 'Invalid EVM signature'
    };
  }
}
