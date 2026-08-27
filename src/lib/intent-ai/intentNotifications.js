/**
 * FBT INTENT AI — PHASE 67: NOTIFICATION AND HANDING CONTROL BACK
 * ---------------------------------------------------------------------------
 * A silent execution is not a consented one. If a program finishes, fails, or
 * needs the user to look at something again, the user has to be TOLD — and if
 * they cannot be told, the program does not quietly continue.
 *
 *   · notifications are typed events with i18n keys, never assembled prose
 *   · an authorisation request has a deadline, and the deadline expiring is a
 *     HALT, not a default yes. `resolveAuthorizationTimeout()` has no branch
 *     that continues.
 *   · a notification that could not be delivered on any channel is itself a
 *     reason to halt a long-running program: unreachable is not consent
 *   · nothing here can execute; the "reauthorize" event carries a prompt, not
 *     an approval
 */

import { classifyFailure } from './failureModes.js';

export const NOTIFY_SCHEMA = 'fbt.intent-notification.v1';
export const CHANNELS = Object.freeze(['web-push', 'telegram', 'in-app']);
export const EVENTS = Object.freeze({
  COMPLETED: 'intentAI.notify.completed',
  FAILED: 'intentAI.notify.failed',
  REAUTHORIZE: 'intentAI.notify.reauthorize',
  HALTED: 'intentAI.notify.halted',
  AUTHORIZATION_EXPIRED: 'intentAI.notify.authorizationExpired'
});
export const DEFAULT_AUTHORIZATION_WINDOW_MS = 15 * 60 * 1000;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Build one notification. Keys and params only. */
export function buildNotification({ event = null, intentId = null, params = {}, now = Date.now() } = {}) {
  const key = EVENTS[String(event || '').toUpperCase()];
  if (!key) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'UNKNOWN_EVENT' }) };
  return {
    ok: true,
    schema: NOTIFY_SCHEMA,
    event: String(event).toUpperCase(),
    intentId: typeof intentId === 'string' ? intentId.slice(0, 64) : null,
    i18nKey: key,
    i18nParams: params && typeof params === 'object' ? params : {},
    // A notification tells; it never approves.
    executionAuthorized: false,
    requiresUserAction: String(event).toUpperCase() === 'REAUTHORIZE',
    createdAt: now
  };
}

/**
 * Try every channel. The result is honest about what actually went out.
 * @param {object} senders { 'web-push': async fn, telegram: async fn, ... }
 */
export async function deliverNotification(notification, { senders = {}, now = Date.now() } = {}) {
  if (!notification || notification.schema !== NOTIFY_SCHEMA) {
    return { ok: false, delivered: [], error: classifyFailure('MISSING_DATA', { detail: 'NO_NOTIFICATION' }) };
  }
  const delivered = [];
  const failures = [];
  for (const channel of CHANNELS) {
    const send = senders?.[channel];
    if (typeof send !== 'function') { failures.push({ channel, reason: 'NO_CHANNEL' }); continue; }
    try {
      const res = await send(notification);
      if (res === false || res?.ok === false) failures.push({ channel, reason: 'SEND_REJECTED' });
      else delivered.push(channel);
    } catch {
      failures.push({ channel, reason: 'SEND_FAILED' });
    }
  }
  return {
    ok: delivered.length > 0,
    schema: NOTIFY_SCHEMA,
    delivered,
    failures,
    // The fact that matters downstream: could we reach the user at all?
    reachedUser: delivered.length > 0,
    notification,
    attemptedAt: now,
    error: delivered.length ? null : classifyFailure('PROVIDER_ERROR', { detail: 'ALL_CHANNELS_FAILED' })
  };
}

/** Ask for re-authorisation, with a deadline attached from the start. */
export function requestReauthorization({ intentId = null, reason = null, windowMs = DEFAULT_AUTHORIZATION_WINDOW_MS, now = Date.now() } = {}) {
  const notification = buildNotification({
    event: 'REAUTHORIZE', intentId,
    params: { reason: typeof reason === 'string' ? reason.slice(0, 60) : null }, now
  });
  if (notification.ok !== true) return notification;
  return {
    ok: true,
    schema: NOTIFY_SCHEMA,
    request: {
      intentId: notification.intentId,
      reason: notification.i18nParams.reason,
      // No deadline would mean "wait forever", which is how silent execution
      // happens. There is always a deadline.
      expiresAt: now + Math.max(60_000, num(windowMs) ?? DEFAULT_AUTHORIZATION_WINDOW_MS),
      answered: false,
      approved: false
    },
    notification,
    executionAuthorized: false,
    requestedAt: now
  };
}

/**
 * The deadline passed. There is exactly one outcome, and it is HALT.
 */
export function resolveAuthorizationTimeout(request, { now = Date.now() } = {}) {
  const req = request?.request || request;
  if (!req || num(req.expiresAt) === null) {
    return { ok: false, halted: true, reason: 'NO_REQUEST', executionAuthorized: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_REQUEST' }) };
  }
  if (req.answered === true && req.approved === true) {
    return { ok: true, halted: false, answered: true, approved: true, executionAuthorized: false, requiresConfirmationGate: true };
  }
  if (req.answered === true && req.approved !== true) {
    return { ok: true, halted: true, answered: true, approved: false, reason: 'USER_DECLINED', executionAuthorized: false, i18nKey: EVENTS.HALTED };
  }
  if (now <= req.expiresAt) {
    return { ok: true, halted: false, answered: false, waiting: true, executionAuthorized: false, expiresAt: req.expiresAt };
  }
  // Silence is not consent.
  return {
    ok: true,
    halted: true,
    answered: false,
    approved: false,
    reason: 'AUTHORIZATION_TIMEOUT',
    executionAuthorized: false,
    i18nKey: EVENTS.AUTHORIZATION_EXPIRED,
    haltedAt: now,
    error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'AUTHORIZATION_TIMEOUT' })
  };
}

/**
 * Should this long-running program keep going? Not if the user could not be
 * reached, and not if an authorisation window lapsed.
 */
export function programMayContinue({ delivery = null, authorization = null, now = Date.now() } = {}) {
  const reasons = [];
  if (delivery && delivery.reachedUser !== true) reasons.push('USER_UNREACHABLE');
  if (authorization) {
    const outcome = resolveAuthorizationTimeout(authorization, { now });
    if (outcome.halted === true) reasons.push(outcome.reason || 'AUTHORIZATION_HALTED');
  }
  return reasons.length
    ? { ok: false, mayContinue: false, reasons, i18nKey: EVENTS.HALTED, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: reasons.join(',') }) }
    : { ok: true, mayContinue: true, reasons: [] };
}
