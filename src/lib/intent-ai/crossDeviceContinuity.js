/**
 * FBT INTENT AI — PHASE 64: CROSS-DEVICE CONTINUITY
 * ---------------------------------------------------------------------------
 * A device is not a user. Someone who set up a goal on their phone should be
 * able to keep reading it on their laptop — but "the same person" is not the
 * same claim as "already authorised to spend".
 *
 * So continuity is split in two, permanently:
 *
 *   · CONTEXT TRAVELS. Messages, drafts, goals, the policy and the STOPPED
 *     flag move to the second device.
 *   · AUTHORITY DOES NOT. Every financial confirmation is taken again on the
 *     new device: signatures, gate decisions and session keys are stripped in
 *     transit, and `handoffRequiresReconfirmation` is true with no code path
 *     that sets it false.
 *
 * Identity comes from the existing linked login (Telegram). An unlinked or
 * mismatched identity does not get the session at all.
 */

import { classifyFailure } from './failureModes.js';
import { stripSecrets } from './sessionPersistence.js';

export const CONTINUITY_SCHEMA = 'fbt.cross-device-continuity.v1';
export const HANDOFF_TTL_MS = 10 * 60 * 1000;
/** Anything in here is authority, and authority never crosses a device. */
export const NON_TRANSFERABLE = Object.freeze([
  'sessionKeys', 'signatures', 'gateDecisions', 'confirmations', 'walletRuntime', 'signer', 'approvals'
]);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

/** Who is this, according to the linked login? */
export function resolveLinkedIdentity({ telegram = null, now = Date.now() } = {}) {
  const userId = id(telegram?.id ?? telegram?.userId);
  const verifiedAt = num(telegram?.verifiedAt ?? telegram?.authDate);
  if (!userId) return { ok: false, linked: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'NOT_LINKED' }) };
  if (telegram?.verified !== true) return { ok: false, linked: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'LOGIN_UNVERIFIED' }) };
  if (verifiedAt === null) return { ok: false, linked: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_LOGIN_TIME' }) };
  return { ok: true, linked: true, identityId: `tg:${userId}`, verifiedAt, resolvedAt: now };
}

/** Package a session for another device belonging to the same identity. */
export function createHandoff({ session = null, messages = [], identity = null, fromDeviceId = null, now = Date.now() } = {}) {
  const who = identity?.ok === true ? identity : resolveLinkedIdentity({ telegram: identity, now });
  if (who.ok !== true) return { ok: false, error: who.error || classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'NO_IDENTITY' }) };
  if (!session || typeof session !== 'object') return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SESSION' }) };

  // Context is copied; authority is deleted, not copied-and-ignored.
  const context = stripSecrets({ ...session });
  for (const field of NON_TRANSFERABLE) delete context[field];

  return {
    ok: true,
    schema: CONTINUITY_SCHEMA,
    handoffId: `handoff_${who.identityId}_${now}`,
    identityId: who.identityId,
    fromDeviceId: id(fromDeviceId),
    context,
    messages: (Array.isArray(messages) ? messages : []).slice(-120),
    // Everything below is the whole point of the phase.
    carriesAuthority: false,
    executionAuthorized: false,
    handoffRequiresReconfirmation: true,
    strippedFields: NON_TRANSFERABLE.filter((f) => f in (session || {})),
    expiresAt: now + HANDOFF_TTL_MS,
    createdAt: now
  };
}

/** Accept a handoff on the second device. */
export function acceptHandoff(handoff, { identity = null, toDeviceId = null, now = Date.now() } = {}) {
  if (!handoff || handoff.schema !== CONTINUITY_SCHEMA) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_HANDOFF' }) };
  }
  const who = identity?.ok === true ? identity : resolveLinkedIdentity({ telegram: identity, now });
  if (who.ok !== true) return { ok: false, error: who.error };
  if (who.identityId !== handoff.identityId) {
    // A different account is a different person, however the link arrived.
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'IDENTITY_MISMATCH' }) };
  }
  if (num(handoff.expiresAt) === null || now > handoff.expiresAt) {
    return { ok: false, error: classifyFailure('DEADLINE_PASSED', { detail: 'HANDOFF_EXPIRED' }) };
  }

  const session = { ...handoff.context };
  for (const field of NON_TRANSFERABLE) delete session[field];
  // A STOPPED session arrives STOPPED. Continuity never restarts anything.
  if (handoff.context?.status === 'STOPPED') session.status = 'STOPPED';

  return {
    ok: true,
    schema: CONTINUITY_SCHEMA,
    session,
    messages: Array.isArray(handoff.messages) ? handoff.messages : [],
    toDeviceId: id(toDeviceId),
    identityId: who.identityId,
    executionAuthorized: false,
    requiresReconfirmation: true,
    // The list the UI shows: "these need your confirmation again here".
    pendingReconfirmation: ['policy', 'confirmationGate', 'walletSignature'],
    i18nKey: 'intentAI.continuity.resumed',
    acceptedAt: now
  };
}

/**
 * Fail-closed guard: nothing that crossed a device may be treated as already
 * confirmed on this one.
 */
export function assertNoTransferredAuthority(accepted) {
  const reasons = [];
  if (!accepted || accepted.schema !== CONTINUITY_SCHEMA) reasons.push('NOT_A_HANDOFF');
  if (accepted?.executionAuthorized === true) reasons.push('HANDOFF_CLAIMS_EXECUTION');
  if (accepted?.requiresReconfirmation !== true) reasons.push('HANDOFF_SKIPS_RECONFIRMATION');
  for (const field of NON_TRANSFERABLE) {
    if (accepted?.session && field in accepted.session) reasons.push(`AUTHORITY_TRAVELLED:${field}`);
  }
  return reasons.length
    ? { ok: false, reasons, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: reasons.join(',') }) }
    : { ok: true, reasons: [] };
}
