/**
 * FBT INTENT PROTOCOL — CANONICAL LIFECYCLE STATE MACHINE
 * ---------------------------------------------------------------------------
 * Spec §6: Replace scattered intent state logic with a canonical state machine.
 *
 *   CREATED -> SIGNED -> VALIDATED -> SUBMITTED -> OPEN -> QUOTING
 *           -> COMMITTED -> EXECUTING -> SETTLING -> VERIFIED -> COMPLETED
 *
 * Failure paths:
 *   INVALID, EXPIRED, CANCELLED, REJECTED, FAILED, TIMEOUT, PARTIALLY_FILLED, DISPUTED
 */

import { LIFECYCLE_STAGES, TERMINAL_STATUSES } from './types.js';
import { createIntentError, PROTOCOL_ERROR_CODES } from './intentErrors.js';

export const LEGAL_TRANSITIONS = Object.freeze({
  CREATED: ['SIGNED', 'VALIDATED', 'INVALID', 'CANCELLED', 'EXPIRED'],
  SIGNED: ['VALIDATED', 'SUBMITTED', 'INVALID', 'CANCELLED', 'EXPIRED'],
  VALIDATED: ['SUBMITTED', 'OPEN', 'QUOTING', 'INVALID', 'CANCELLED', 'EXPIRED', 'REJECTED'],
  SUBMITTED: ['OPEN', 'QUOTING', 'COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'],
  OPEN: ['QUOTING', 'COMMITTED', 'CANCELLED', 'EXPIRED', 'TIMEOUT', 'REJECTED'],
  QUOTING: ['COMMITTED', 'OPEN', 'CANCELLED', 'EXPIRED', 'TIMEOUT', 'FAILED', 'REJECTED'],
  COMMITTED: ['EXECUTING', 'SETTLING', 'CANCELLED', 'EXPIRED', 'FAILED', 'DISPUTED'],
  EXECUTING: ['SETTLING', 'VERIFIED', 'COMPLETED', 'PARTIALLY_FILLED', 'FAILED', 'TIMEOUT', 'DISPUTED'],
  SETTLING: ['VERIFIED', 'COMPLETED', 'PARTIALLY_FILLED', 'FAILED', 'DISPUTED'],
  VERIFIED: ['COMPLETED', 'PARTIALLY_FILLED', 'DISPUTED'],
  PARTIALLY_FILLED: ['OPEN', 'QUOTING', 'COMMITTED', 'EXECUTING', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
  DISPUTED: ['COMPLETED', 'FAILED', 'SETTLING', 'REJECTED'],

  // Terminal states have NO legal transitions
  COMPLETED: [],
  INVALID: [],
  EXPIRED: [],
  CANCELLED: [],
  REJECTED: [],
  FAILED: [],
  TIMEOUT: []
});

export class IntentLifecycleRecord {
  constructor(intent) {
    this.intentId = intent.intentId;
    this.status = intent.status || 'CREATED';
    this.deadline = intent.deadline;
    this.sequence = 0;
    this.history = [
      {
        sequence: 0,
        from: null,
        to: this.status,
        timestamp: Math.floor(Date.now() / 1000),
        reason: 'INTENT_INITIALIZED',
        actor: 'PROTOCOL'
      }
    ];
  }

  isTerminal() {
    return TERMINAL_STATUSES.includes(this.status);
  }

  canTransitionTo(nextStatus) {
    if (this.status === nextStatus) return true; // Idempotent
    if (this.isTerminal()) return false;
    const allowed = LEGAL_TRANSITIONS[this.status] || [];
    return allowed.includes(nextStatus);
  }

  transition(nextStatus, { reason = 'STATE_PROGRESSION', actor = 'PROTOCOL', metadata = {} } = {}) {
    const now = Math.floor(Date.now() / 1000);

    // Auto-check deadline expiration
    if (this.deadline && now > this.deadline && !this.isTerminal() && nextStatus !== 'EXPIRED') {
      this._applyTransition('EXPIRED', {
        reason: 'DEADLINE_PASSED',
        actor: 'CLOCK',
        metadata: { deadline: this.deadline, now }
      });
      throw createIntentError(PROTOCOL_ERROR_CODES.INTENT_EXPIRED, {
        intentId: this.intentId,
        technicalDetails: `Intent ${this.intentId} expired at ${this.deadline}, current time ${now}`
      });
    }

    if (this.status === nextStatus) {
      // Idempotent no-op
      return this;
    }

    if (this.isTerminal()) {
      throw createIntentError(PROTOCOL_ERROR_CODES.INVALID_SCHEMA, {
        intentId: this.intentId,
        technicalDetails: `Illegal transition: intent ${this.intentId} is in terminal status ${this.status}`
      });
    }

    const allowed = LEGAL_TRANSITIONS[this.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw createIntentError(PROTOCOL_ERROR_CODES.INVALID_SCHEMA, {
        intentId: this.intentId,
        technicalDetails: `Illegal transition from ${this.status} to ${nextStatus}. Allowed: ${allowed.join(', ')}`
      });
    }

    this._applyTransition(nextStatus, { reason, actor, metadata });
    return this;
  }

  _applyTransition(nextStatus, { reason, actor, metadata }) {
    const from = this.status;
    this.status = nextStatus;
    this.sequence += 1;
    this.history.push({
      sequence: this.sequence,
      from,
      to: nextStatus,
      timestamp: Math.floor(Date.now() / 1000),
      reason,
      actor,
      metadata
    });
  }

  toJSON() {
    return {
      intentId: this.intentId,
      status: this.status,
      sequence: this.sequence,
      deadline: this.deadline,
      isTerminal: this.isTerminal(),
      history: this.history
    };
  }
}
