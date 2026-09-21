/**
 * FBT INTENT PROTOCOL — CANONICAL HASHING & DOMAIN SEPARATION
 * ---------------------------------------------------------------------------
 * Spec §3: Every intent must have a deterministic cryptographic identity
 * across frontend, backend, solver, smart contracts, and verification services.
 */

import { keccak256, toUtf8Bytes, AbiCoder } from 'ethers';
import {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  INTENT_SCHEMA_VERSION,
  PROTOCOL_VERSION
} from './types.js';

const abiCoder = AbiCoder.defaultAbiCoder();

/**
 * Deterministic JSON stringifier (recursive key-sorted).
 */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = [];
    for (const k of keys) {
      if (k === 'signature' || value[k] === undefined || typeof value[k] === 'function') continue;
      pairs.push(JSON.stringify(k) + ':' + canonicalJson(value[k]));
    }
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(String(value));
}

/**
 * Calculate deterministic constraint hash.
 */
export function computeConstraintsHash(constraints = []) {
  const sorted = Array.isArray(constraints)
    ? [...constraints].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : [];
  return keccak256(toUtf8Bytes(canonicalJson(sorted)));
}

/**
 * Compute protocol domain separator for cross-chain & cross-contract replay defense.
 */
export function computeDomainSeparator(chainId, verifyingContract = '0x0000000000000000000000000000000000000000') {
  const typeHash = keccak256(
    toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
  );
  return keccak256(
    abiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        typeHash,
        keccak256(toUtf8Bytes(EIP712_DOMAIN_NAME)),
        keccak256(toUtf8Bytes(EIP712_DOMAIN_VERSION)),
        BigInt(chainId || 1),
        verifyingContract
      ]
    )
  );
}

/**
 * Compute on-chain EIP-712 struct hash for EVM contracts.
 * Matches `contracts/FBTIntentVerifier.sol`.
 */
export function computeEIP712IntentStructHash(intent) {
  const INTENT_TYPEHASH = keccak256(
    toUtf8Bytes(
      'FBTIntent(string version,address user,uint256 sourceChainId,uint256 destinationChainId,address sourceAsset,address destinationAsset,uint256 amount,uint256 minAmountOut,uint256 maxFee,uint256 deadline,uint256 nonce,bytes32 constraintsHash)'
    )
  );

  const cleanAddr = (a) => (typeof a === 'string' && a.startsWith('0x') && a.length === 42 ? a : '0x0000000000000000000000000000000000000000');
  const cleanBig = (n) => BigInt(n || '0');

  const constraintsHash = intent.constraintsHash || computeConstraintsHash(intent.constraints);

  return keccak256(
    abiCoder.encode(
      [
        'bytes32',
        'bytes32',
        'address',
        'uint256',
        'uint256',
        'address',
        'address',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'bytes32'
      ],
      [
        INTENT_TYPEHASH,
        keccak256(toUtf8Bytes(intent.version || INTENT_SCHEMA_VERSION)),
        cleanAddr(intent.user),
        cleanBig(intent.sourceChain),
        cleanBig(intent.destinationChain || intent.sourceChain),
        cleanAddr(intent.sourceAsset),
        cleanAddr(intent.destinationAsset),
        cleanBig(intent.amount),
        cleanBig(intent.minAmountOut),
        cleanBig(intent.maxFee),
        cleanBig(intent.deadline),
        cleanBig(intent.nonce),
        constraintsHash
      ]
    )
  );
}

/**
 * Universal canonical cryptographic identity (intentId).
 * Deterministic across frontends, node backends, solvers, and contracts.
 */
export function computeIntentId(intent) {
  const canonicalFields = {
    schema: intent.version || INTENT_SCHEMA_VERSION,
    protocol: PROTOCOL_VERSION,
    user: String(intent.user || '').toLowerCase(),
    sourceChain: String(intent.sourceChain),
    destinationChain: String(intent.destinationChain || intent.sourceChain),
    sourceAsset: String(intent.sourceAsset || '').toLowerCase(),
    destinationAsset: String(intent.destinationAsset || '').toLowerCase(),
    amount: String(intent.amount),
    minAmountOut: String(intent.minAmountOut),
    maxAmountIn: intent.maxAmountIn ? String(intent.maxAmountIn) : undefined,
    maxFee: intent.maxFee ? String(intent.maxFee) : '0',
    slippageBps: Number(intent.slippageBps || 50),
    deadline: Number(intent.deadline),
    nonce: String(intent.nonce),
    recipient: String(intent.recipient || intent.user || '').toLowerCase(),
    constraints: intent.constraints || [],
    partialFillAllowed: Boolean(intent.partialFill?.enabled)
  };

  const payload = canonicalJson(canonicalFields);
  return keccak256(toUtf8Bytes(payload));
}

/**
 * Compute Solver Quote Hash & Commitment.
 */
export function computeQuoteHash(quote) {
  const canonicalQuote = {
    schema: quote.version || 'fbt.solver-quote.v2',
    intentId: quote.intentId,
    solverId: String(quote.solverId),
    amountIn: String(quote.amountIn),
    amountOut: String(quote.amountOut),
    fee: String(quote.fee || '0'),
    gasEstimate: String(quote.gasEstimate || '0'),
    executionDeadline: Number(quote.executionDeadline),
    nonce: String(quote.nonce || '0'),
    routeHash: quote.routeHash || (quote.route ? keccak256(toUtf8Bytes(canonicalJson(quote.route))) : '0x' + '0'.repeat(64))
  };

  return keccak256(toUtf8Bytes(canonicalJson(canonicalQuote)));
}
