/**
 * FBT INTENT AI — PHASE 55: MEV & SLIPPAGE SHIELD
 * ---------------------------------------------------------------------------
 * A submitted transaction is not a protected one. Every transaction that
 * leaves this pipeline must carry, explicitly:
 *
 *   · a deadline (absolute, in the near future)
 *   · a slippage ceiling, and a minAmountOut derived from it
 *   · a declared submission channel (public mempool or private relay)
 *
 * `assertProtected()` is fail-closed: a transaction missing any of these is
 * REFUSED. Exceeding the ceiling is a refusal too — not a hope that it fills.
 */

import { classifyFailure } from './failureModes.js';
import { DEFAULT_MAX_SLIPPAGE_PCT, effectiveSlippageLimit } from './liveQuote.js';

export const MEV_SHIELD_SCHEMA = 'fbt.mev-shield.v1';
export const DEFAULT_DEADLINE_SECS = 180;
export const MAX_DEADLINE_SECS = 1800;
/** Nothing this pipeline signs may ever exceed this slippage, whatever asks. */
export const HARD_MAX_SLIPPAGE_PCT = 5;
export const SUBMISSION_CHANNELS = Object.freeze(['public', 'private']);

/**
 * Build the protection envelope for a transaction.
 * @param {object} draft         the order about to run
 * @param {object} quote         the locked live quote (for minAmountOut)
 * @param {object} policy        the session policy (may tighten slippage)
 * @param {object} privateRelay  { available:boolean, name?:string }
 */
export function applyMevShield({
  draft = {},
  quote = null,
  policy = null,
  now = Date.now(),
  deadlineSecs = DEFAULT_DEADLINE_SECS,
  privateRelay = null
} = {}) {
  const requested = Number(deadlineSecs);
  const secs = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_DEADLINE_SECS)
    : DEFAULT_DEADLINE_SECS;
  const limit = Math.min(
    effectiveSlippageLimit({ draft, policy }) || DEFAULT_MAX_SLIPPAGE_PCT,
    HARD_MAX_SLIPPAGE_PCT
  );
  const quotedOut = Number(quote?.amountOut);
  const minAmountOut = Number.isFinite(quotedOut) && quotedOut > 0
    ? quotedOut * (1 - limit / 100)
    : null;
  const usePrivate = privateRelay?.available === true;
  return {
    ok: true,
    guard: Object.freeze({
      schema: MEV_SHIELD_SCHEMA,
      deadlineAt: now + secs * 1000,
      deadlineSecs: secs,
      maxSlippagePct: limit,
      minAmountOut,
      // Honest: we say which channel this actually goes out on.
      submissionChannel: usePrivate ? 'private' : 'public',
      privateRelay: usePrivate ? String(privateRelay.name || 'private-relay').slice(0, 40) : null,
      mevProtected: usePrivate,
      createdAt: now
    })
  };
}

/** Fail-closed check run immediately before signing/broadcasting. */
export function assertProtected(guard, { now = Date.now(), quotedAmountOut = null } = {}) {
  if (!guard || guard.schema !== MEV_SHIELD_SCHEMA) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_MEV_GUARD' }) };
  }
  if (guard.deadlineAt == null || !Number.isFinite(Number(guard.deadlineAt))) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_DEADLINE' }) };
  }
  if (Number(guard.deadlineAt) <= now) {
    return { ok: false, error: classifyFailure('DEADLINE_PASSED', { detail: 'GUARD_EXPIRED' }) };
  }
  const limit = Number(guard.maxSlippagePct);
  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SLIPPAGE_LIMIT' }) };
  }
  if (limit > HARD_MAX_SLIPPAGE_PCT) {
    return { ok: false, error: classifyFailure('RISK_BLOCKED', { detail: `SLIPPAGE_ABOVE_HARD_CAP:${limit}` }) };
  }
  if (!SUBMISSION_CHANNELS.includes(guard.submissionChannel)) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SUBMISSION_CHANNEL' }) };
  }
  if (quotedAmountOut !== null && Number.isFinite(Number(guard.minAmountOut))) {
    const drop = ((Number(quotedAmountOut) - Number(guard.minAmountOut)) / Number(quotedAmountOut)) * 100;
    if (drop > limit + 1e-9) {
      return { ok: false, error: classifyFailure('RISK_BLOCKED', { detail: 'MIN_OUT_BELOW_LIMIT' }) };
    }
  }
  return { ok: true, guard };
}

/** Merge the guard into a transaction request so it travels with the tx. */
export function shieldTransaction(tx = {}, guard = null) {
  const checked = assertProtected(guard);
  if (!checked.ok) return { ok: false, error: checked.error };
  return {
    ok: true,
    tx: {
      ...tx,
      deadline: Math.floor(Number(guard.deadlineAt) / 1000),
      maxSlippagePct: guard.maxSlippagePct,
      ...(guard.minAmountOut !== null ? { minAmountOut: guard.minAmountOut } : {}),
      submissionChannel: guard.submissionChannel
    }
  };
}
