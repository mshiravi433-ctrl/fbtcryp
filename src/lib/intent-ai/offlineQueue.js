/**
 * FBT INTENT AI — PHASE 94: OFFLINE-FIRST
 * ---------------------------------------------------------------------------
 * A dropped connection is not a dead app. Public pages should still render
 * from cache, and an intent the user already confirmed should wait in a queue
 * for the network to come back.
 *
 * The line that must never be crossed: queuing is not executing.
 *
 *   · only an intent with an explicit, fresh user confirmation may be queued
 *   · a queued item has status QUEUED — never COMPLETED, never a receipt
 *   · when the network returns, terms are re-checked and anything stale or
 *     materially changed goes back to the user instead of being sent
 *   · nothing in this module can produce a transaction hash
 */

import { classifyFailure } from './failureModes.js';
import { diffTerms } from './termsDiff.js';

export const QUEUE_SCHEMA = 'fbt.offline-queue.v1';
export const QUEUE_STATES = Object.freeze(['queued', 'sending', 'sent', 'expired', 'rejected']);
export const QUEUE_TTL_MS = 15 * 60 * 1000;
export const MAX_QUEUE_LENGTH = 20;
export const CACHEABLE_ROUTES = Object.freeze(['/', '/about', '/faq', '/terms', '/privacy', '/landing']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Public, non-personal pages may be served from cache while offline. */
export function cachePolicyFor(route) {
  const path = String(route || '');
  const cacheable = CACHEABLE_ROUTES.includes(path) || path.startsWith('/landing');
  return {
    schema: QUEUE_SCHEMA,
    route: path,
    cacheable,
    // Never cache anything that reflects a balance, a price or a session.
    reason: cacheable ? 'PUBLIC_STATIC' : 'PERSONAL_OR_LIVE',
    servesStalePrices: false,
    i18nKey: cacheable ? 'intentAI.offline.cachedPage' : 'intentAI.offline.pageUnavailable'
  };
}

/** Put a confirmed intent in the queue. Confirmation is mandatory. */
export function enqueueIntent({ queue = [], intent = null, confirmation = null, now = Date.now() } = {}) {
  const items = Array.isArray(queue) ? queue : [];
  const reasons = [];
  if (!intent || typeof intent !== 'object') reasons.push('NO_INTENT');
  if (confirmation?.userConfirmed !== true) reasons.push('NOT_CONFIRMED');
  if (confirmation?.decision && confirmation.decision !== 'CONFIRM') reasons.push('NOT_CONFIRMED');
  if (num(confirmation?.at) === null) reasons.push('CONFIRMATION_NOT_TIMESTAMPED');
  if (items.length >= MAX_QUEUE_LENGTH) reasons.push('QUEUE_FULL');
  if (reasons.length) {
    return {
      ok: false, queue: items, queued: false, reasons,
      i18nKey: 'intentAI.offline.notQueued',
      error: classifyFailure(reasons[0] === 'NOT_CONFIRMED' ? 'USER_AUTHORIZATION_REQUIRED' : 'MISSING_DATA', { detail: reasons[0] })
    };
  }
  const item = Object.freeze({
    id: `q_${now.toString(36)}_${items.length}`,
    intent,
    terms: intent.terms ?? intent,
    confirmedAt: num(confirmation.at),
    // Queued is a waiting room, not an outbox that has already delivered.
    status: 'queued',
    txHash: null,
    receipt: null,
    executionAuthorized: false,
    queuedAt: now,
    expiresAt: now + QUEUE_TTL_MS
  });
  return {
    ok: true,
    schema: QUEUE_SCHEMA,
    queue: [...items, item],
    queued: true,
    item,
    i18nKey: 'intentAI.offline.queued',
    i18nParams: { count: items.length + 1 }
  };
}

/**
 * The network is back. Every item is re-checked before anything is sent, and
 * an item whose terms moved goes back to the user.
 */
export async function flushQueue({ queue = [], send = null, currentTerms = {}, now = Date.now() } = {}) {
  const items = Array.isArray(queue) ? queue : [];
  const sent = [];
  const returned = [];
  const expired = [];
  const remaining = [];
  for (const item of items) {
    if (now > num(item.expiresAt)) {
      expired.push({ id: item.id, reason: 'QUEUE_ITEM_EXPIRED' });
      continue;
    }
    const nowTerms = currentTerms?.[item.id] ?? item.terms;
    const diff = diffTerms({ approved: item.terms, current: nowTerms });
    if (diff.hasMaterialChange) {
      // The world moved while we were offline: the user decides again.
      returned.push({ id: item.id, reason: 'TERMS_CHANGED', diff: diff.materialChanges, requiresReconfirmation: true });
      continue;
    }
    if (typeof send !== 'function') {
      remaining.push(item);
      continue;
    }
    try {
      const res = await send({ intent: item.intent, terms: nowTerms });
      if (res?.ok === true && typeof res.txHash === 'string') sent.push({ id: item.id, txHash: res.txHash });
      else remaining.push({ ...item, lastError: 'SEND_REJECTED' });
    } catch {
      remaining.push({ ...item, lastError: 'SEND_FAILED' });
    }
  }
  return {
    ok: true,
    schema: QUEUE_SCHEMA,
    sent,
    returnedToUser: returned,
    expired,
    queue: remaining,
    i18nKey: returned.length ? 'intentAI.offline.needsReconfirmation' : (sent.length ? 'intentAI.offline.sent' : 'intentAI.offline.stillQueued'),
    i18nParams: { sent: sent.length, returned: returned.length, expired: expired.length },
    at: now
  };
}

/** What the user sees while offline. Never a fake success. */
export function offlineStatus({ online = false, queue = [], now = Date.now() } = {}) {
  const items = Array.isArray(queue) ? queue : [];
  const live = items.filter((i) => now <= num(i.expiresAt));
  return {
    schema: QUEUE_SCHEMA,
    online: Boolean(online),
    queued: live.length,
    expired: items.length - live.length,
    // Offline means nothing has been executed. Say it plainly.
    executed: 0,
    i18nKey: online
      ? (live.length ? 'intentAI.offline.sending' : 'intentAI.offline.online')
      : (live.length ? 'intentAI.offline.waiting' : 'intentAI.offline.offline'),
    i18nParams: { count: live.length }
  };
}

/** Nothing offline may look like something that happened. */
export function assertNoOfflineExecution({ queue = [], status = null, cache = [] } = {}) {
  const reasons = [];
  for (const item of Array.isArray(queue) ? queue : []) {
    if (!QUEUE_STATES.includes(item?.status)) reasons.push('UNKNOWN_QUEUE_STATE');
    if (item?.status === 'queued' && item?.txHash) reasons.push('QUEUED_ITEM_HAS_TX_HASH');
    if (item?.receipt) reasons.push('QUEUED_ITEM_HAS_RECEIPT');
    if (item?.executionAuthorized === true) reasons.push('QUEUED_ITEM_CLAIMS_AUTHORITY');
    if (num(item?.confirmedAt) === null) reasons.push('QUEUED_WITHOUT_CONFIRMATION');
    if (num(item?.expiresAt) === null) reasons.push('QUEUED_ITEM_NEVER_EXPIRES');
  }
  if (status && status.online === false && (status.executed ?? 0) > 0) reasons.push('EXECUTED_WHILE_OFFLINE');
  for (const entry of Array.isArray(cache) ? cache : []) {
    if (entry?.cacheable === true && entry?.servesStalePrices === true) reasons.push('CACHED_STALE_PRICES');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true };
}
