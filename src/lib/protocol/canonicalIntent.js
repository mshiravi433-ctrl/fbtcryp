/**
 * FBT INTENT PROTOCOL — CANONICAL INTENT OBJECT & VALIDATION
 * ---------------------------------------------------------------------------
 * Spec §2: Canonical versioned, deterministic, hashable, signable, serializable,
 * chain-aware, replay-resistant, extensible Intent model.
 */

import { INTENT_SCHEMA_VERSION, LIFECYCLE_STAGES } from './types.js';
import { computeIntentId, computeConstraintsHash } from './intentHashing.js';
import { createIntentError, PROTOCOL_ERROR_CODES } from './intentErrors.js';

/**
 * Validates that string is a non-empty numeric string without negatives/fractions.
 */
function isPositiveIntegerString(val) {
  if (typeof val !== 'string' && typeof val !== 'number') return false;
  const str = String(val).trim();
  return /^[0-9]+$/.test(str) && BigInt(str) > 0n;
}

function isNonNegativeIntegerString(val) {
  if (typeof val !== 'string' && typeof val !== 'number') return false;
  const str = String(val).trim();
  return /^[0-9]+$/.test(str) && BigInt(str) >= 0n;
}

/**
 * Creates a canonical FBTIntent object from inputs.
 */
export function createCanonicalIntent({
  version = INTENT_SCHEMA_VERSION,
  user,
  sourceChain = 1,
  destinationChain,
  sourceAsset,
  destinationAsset,
  amount,
  minAmountOut,
  maxAmountIn,
  maxFee = '0',
  slippageBps = 50,
  deadline,
  nonce,
  recipient,
  constraints = [],
  executionPreferences = {},
  solverPolicy = {},
  partialFill = null,
  traceId = null,
  status = 'CREATED'
}) {
  const now = Math.floor(Date.now() / 1000);
  const finalDeadline = Number(deadline || now + 3600);
  const finalNonce = String(nonce || `${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
  const finalDestinationChain = destinationChain || sourceChain;
  const finalRecipient = recipient || user;
  const finalTraceId = traceId || `tr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const cleanConstraints = Array.isArray(constraints) ? constraints : [];

  const rawIntent = {
    version,
    user: String(user || '').trim(),
    sourceChain,
    destinationChain: finalDestinationChain,
    sourceAsset: String(sourceAsset || '').trim(),
    destinationAsset: String(destinationAsset || '').trim(),
    amount: String(amount || '0').trim(),
    minAmountOut: String(minAmountOut || '0').trim(),
    maxAmountIn: maxAmountIn ? String(maxAmountIn).trim() : undefined,
    maxFee: String(maxFee || '0').trim(),
    slippageBps: Number(slippageBps) || 50,
    deadline: finalDeadline,
    nonce: finalNonce,
    recipient: finalRecipient,
    constraints: cleanConstraints,
    constraintsHash: computeConstraintsHash(cleanConstraints),
    executionPreferences: {
      routingStrategy: executionPreferences.routingStrategy || 'best_price',
      allowPartialFill: Boolean(executionPreferences.allowPartialFill || partialFill?.enabled),
      preferredChains: executionPreferences.preferredChains || [sourceChain, finalDestinationChain],
      ...executionPreferences
    },
    solverPolicy: {
      requiredBondUsd: solverPolicy.requiredBondUsd || '0',
      minReputationScore: solverPolicy.minReputationScore || 0,
      allowedSolvers: solverPolicy.allowedSolvers || [],
      disallowedSolvers: solverPolicy.disallowedSolvers || [],
      auctionTimeoutSeconds: solverPolicy.auctionTimeoutSeconds || 30,
      ...solverPolicy
    },
    partialFill: partialFill ? {
      enabled: Boolean(partialFill.enabled),
      minFillAmount: partialFill.minFillAmount ? String(partialFill.minFillAmount) : '0',
      filledAmount: String(partialFill.filledAmount || '0'),
      remainingAmount: String(partialFill.remainingAmount || amount || '0'),
      accumulatedOutput: String(partialFill.accumulatedOutput || '0')
    } : {
      enabled: false,
      filledAmount: '0',
      remainingAmount: String(amount || '0'),
      accumulatedOutput: '0'
    },
    createdAt: now,
    status: LIFECYCLE_STAGES.includes(status) ? status : 'CREATED',
    traceId: finalTraceId
  };

  const intentId = computeIntentId(rawIntent);

  return Object.freeze({
    intentId,
    ...rawIntent
  });
}

/**
 * Validates a canonical intent object against protocol invariants.
 */
export function validateCanonicalIntent(intent, currentTimeSeconds = Math.floor(Date.now() / 1000)) {
  const errors = [];

  if (!intent || typeof intent !== 'object') {
    return { valid: false, errors: ['Intent must be a non-null object'] };
  }

  // Version
  if (!intent.version || typeof intent.version !== 'string') {
    errors.push('Missing or invalid protocol version');
  }

  // User
  if (!intent.user || typeof intent.user !== 'string' || intent.user.length < 10) {
    errors.push('Missing or invalid user wallet address');
  }

  // Chains
  if (intent.sourceChain === undefined || intent.sourceChain === null) {
    errors.push('Missing sourceChain');
  }
  if (intent.destinationChain === undefined || intent.destinationChain === null) {
    errors.push('Missing destinationChain');
  }

  // Assets
  if (!intent.sourceAsset || typeof intent.sourceAsset !== 'string') {
    errors.push('Missing sourceAsset');
  }
  if (!intent.destinationAsset || typeof intent.destinationAsset !== 'string') {
    errors.push('Missing destinationAsset');
  }

  // Amounts
  if (!isPositiveIntegerString(intent.amount)) {
    errors.push(`Invalid amount: must be positive integer string, got "${intent.amount}"`);
  }
  if (!isPositiveIntegerString(intent.minAmountOut)) {
    errors.push(`Invalid minAmountOut: must be positive integer string, got "${intent.minAmountOut}"`);
  }
  if (intent.maxAmountIn !== undefined && !isPositiveIntegerString(intent.maxAmountIn)) {
    errors.push(`Invalid maxAmountIn: must be positive integer string, got "${intent.maxAmountIn}"`);
  }
  if (!isNonNegativeIntegerString(intent.maxFee)) {
    errors.push(`Invalid maxFee: must be non-negative integer string, got "${intent.maxFee}"`);
  }

  // Slippage
  if (typeof intent.slippageBps !== 'number' || intent.slippageBps < 0 || intent.slippageBps > 5000) {
    errors.push(`Invalid slippageBps: must be 0..5000, got ${intent.slippageBps}`);
  }

  // Deadline
  if (!intent.deadline || typeof intent.deadline !== 'number' || intent.deadline <= currentTimeSeconds) {
    errors.push(`Intent expired or deadline in past: deadline=${intent.deadline}, now=${currentTimeSeconds}`);
  }

  // Nonce
  if (!intent.nonce || typeof intent.nonce !== 'string') {
    errors.push('Missing or invalid nonce');
  }

  // Intent ID match
  if (intent.intentId) {
    const computedId = computeIntentId(intent);
    if (intent.intentId !== computedId) {
      errors.push(`Intent ID mismatch: expected ${computedId}, got ${intent.intentId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Asserts that a solver quote or execution does not violate or modify user constraints.
 * Spec §4, §9: A solver/backend must never silently modify user constraints!
 */
export function assertConstraintsUnmodified(intent, quote) {
  if (!intent || !quote) {
    throw createIntentError(PROTOCOL_ERROR_CODES.INVALID_SCHEMA, {
      technicalDetails: 'Missing intent or quote in constraint verification'
    });
  }

  // Amount In: solver cannot ask for more input than the intent specifies
  if (BigInt(quote.amountIn) > BigInt(intent.amount)) {
    if (!intent.maxAmountIn || BigInt(quote.amountIn) > BigInt(intent.maxAmountIn)) {
      throw createIntentError(PROTOCOL_ERROR_CODES.USER_CONSTRAINTS_MODIFIED, {
        intentId: intent.intentId,
        solverId: quote.solverId,
        technicalDetails: `Solver requested amountIn ${quote.amountIn} exceeding intent maximum ${intent.amount}`
      });
    }
  }

  // Amount Out: must meet minAmountOut
  if (BigInt(quote.amountOut) < BigInt(intent.minAmountOut)) {
    throw createIntentError(PROTOCOL_ERROR_CODES.MIN_AMOUNT_OUT_BREACH, {
      intentId: intent.intentId,
      solverId: quote.solverId,
      technicalDetails: `Solver offered amountOut ${quote.amountOut} below guaranteed minimum ${intent.minAmountOut}`
    });
  }

  // Fee: must not exceed maxFee if specified
  if (intent.maxFee && BigInt(intent.maxFee) > 0n) {
    const quoteFee = BigInt(quote.fee || '0');
    if (quoteFee > BigInt(intent.maxFee)) {
      throw createIntentError(PROTOCOL_ERROR_CODES.QUOTE_FEE_TOO_HIGH, {
        intentId: intent.intentId,
        solverId: quote.solverId,
        technicalDetails: `Solver fee ${quoteFee} exceeds user limit ${intent.maxFee}`
      });
    }
  }

  // Deadline: quote execution deadline must not be after intent deadline
  if (quote.executionDeadline && Number(quote.executionDeadline) > Number(intent.deadline)) {
    throw createIntentError(PROTOCOL_ERROR_CODES.INVALID_DEADLINE, {
      intentId: intent.intentId,
      solverId: quote.solverId,
      technicalDetails: `Solver execution deadline ${quote.executionDeadline} exceeds intent deadline ${intent.deadline}`
    });
  }

  return true;
}

/**
 * Converts a Universal AI Intent into a canonical Protocol FBTIntent.
 * Ensures AI outputs strictly flow through protocol validation and settlement.
 */
export function universalToCanonicalIntent(universalIntent, context = {}) {
  const extracted = universalIntent?.extracted || {};
  const user = context.wallet?.address || context.user || '0x0000000000000000000000000000000000000001';
  const sourceChain = context.chainId || extracted.networks?.[0] || 1;
  const destinationChain = extracted.networks?.[1] || sourceChain;
  const sourceAsset = extracted.assets?.[0] || 'USDC';
  const destinationAsset = extracted.assets?.[1] || 'ETH';
  const rawAmount = extracted.amounts?.[0]?.value || '1000000';
  const amountStr = String(Math.floor(Number(rawAmount) || 1000000));
  const slippageBps = Number(context.slippageBps || 50);

  // Conservative guaranteed minimum output calculation
  const minAmountOut = String(Math.floor((Number(amountStr) * (10000 - slippageBps)) / 10000));

  return createCanonicalIntent({
    user,
    sourceChain,
    destinationChain,
    sourceAsset,
    destinationAsset,
    amount: amountStr,
    minAmountOut,
    slippageBps,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    traceId: universalIntent?.id ? `tr_${universalIntent.id}` : null,
    executionPreferences: {
      routingStrategy: context.strategy || 'best_price'
    }
  });
}

