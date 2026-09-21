/**
 * FBT INTENT PROTOCOL — NONCE & REPLAY DEFENSE ENGINE
 * ---------------------------------------------------------------------------
 * Spec §5: Per-user sequential nonces, arbitrary bitmap/uuid nonces,
 * cancellation registry, and replay attack prevention across chains.
 */

import { createIntentError, PROTOCOL_ERROR_CODES } from './intentErrors.js';

export class ProtocolNonceManager {
  constructor() {
    // Map of userAddress -> currentSequentialNonce (BigInt)
    this.userCounters = new Map();
    // Map of `${chainId}:${user}:${nonce}` -> { usedAt, intentId, status }
    this.usedNonces = new Map();
    // Map of `${chainId}:${user}:${nonce}` -> { cancelledAt, reason }
    this.cancelledNonces = new Map();
    // Map of intentId -> status
    this.intentStatuses = new Map();
  }

  _key(chainId, user, nonce) {
    const cleanUser = String(user || '').toLowerCase();
    const cleanChain = String(chainId || '1');
    const cleanNonce = String(nonce || '');
    return `${cleanChain}:${cleanUser}:${cleanNonce}`;
  }

  /**
   * Returns next valid sequential nonce for a user on a chain.
   */
  getNextNonce(chainId, user) {
    const key = `${String(chainId)}:${String(user).toLowerCase()}`;
    const current = this.userCounters.get(key) || 0n;
    const next = current + 1n;
    return next.toString();
  }

  /**
   * Checks whether a nonce is available for use.
   */
  isNonceValid(chainId, user, nonce) {
    const key = this._key(chainId, user, nonce);

    if (this.usedNonces.has(key)) {
      return { valid: false, reason: 'NONCE_ALREADY_USED' };
    }
    if (this.cancelledNonces.has(key)) {
      return { valid: false, reason: 'NONCE_CANCELLED' };
    }

    return { valid: true };
  }

  /**
   * Consumes a nonce upon execution. Prevents replay.
   */
  consumeNonce(chainId, user, nonce, intentId, status = 'EXECUTED') {
    const check = this.isNonceValid(chainId, user, nonce);
    if (!check.valid) {
      throw createIntentError(
        check.reason === 'NONCE_CANCELLED'
          ? PROTOCOL_ERROR_CODES.INTENT_ALREADY_CANCELLED
          : PROTOCOL_ERROR_CODES.NONCE_ALREADY_USED,
        {
          intentId,
          chainId,
          technicalDetails: `Nonce ${nonce} for user ${user} on chain ${chainId} is unavailable: ${check.reason}`
        }
      );
    }

    const key = this._key(chainId, user, nonce);
    this.usedNonces.set(key, {
      usedAt: Math.floor(Date.now() / 1000),
      intentId,
      status
    });

    if (/^[0-9]+$/.test(String(nonce))) {
      const counterKey = `${String(chainId)}:${String(user).toLowerCase()}`;
      const current = this.userCounters.get(counterKey) || 0n;
      const val = BigInt(nonce);
      if (val > current) {
        this.userCounters.set(counterKey, val);
      }
    }

    this.intentStatuses.set(intentId, status);
    return true;
  }

  /**
   * Cancels a nonce before execution. Prevents future execution.
   */
  cancelNonce(chainId, user, nonce, reason = 'USER_REQUESTED') {
    const key = this._key(chainId, user, nonce);

    if (this.usedNonces.has(key)) {
      throw createIntentError(PROTOCOL_ERROR_CODES.NONCE_ALREADY_USED, {
        chainId,
        technicalDetails: `Cannot cancel: nonce ${nonce} was already consumed in execution`
      });
    }

    this.cancelledNonces.set(key, {
      cancelledAt: Math.floor(Date.now() / 1000),
      reason
    });

    return true;
  }

  /**
   * Gets record for a given nonce.
   */
  getNonceRecord(chainId, user, nonce) {
    const key = this._key(chainId, user, nonce);
    if (this.usedNonces.has(key)) {
      return { status: 'USED', ...this.usedNonces.get(key) };
    }
    if (this.cancelledNonces.has(key)) {
      return { status: 'CANCELLED', ...this.cancelledNonces.get(key) };
    }
    return { status: 'AVAILABLE' };
  }

  /**
   * Resets in-memory storage (useful for isolated unit tests).
   */
  clear() {
    this.userCounters.clear();
    this.usedNonces.clear();
    this.cancelledNonces.clear();
    this.intentStatuses.clear();
  }
}

export const globalNonceManager = new ProtocolNonceManager();
