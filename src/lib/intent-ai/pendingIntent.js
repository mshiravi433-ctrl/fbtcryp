/**
 * FBT INTENT OS — pending intent store.
 * ---------------------------------------------------------------------------
 * If the user asked to rebalance (or swap, or show a balance) before a wallet
 * was connected, that intent MUST survive the connect flow. Forcing them to
 * retype is the bug this module exists to close.
 *
 * Status machine:
 *   WAITING_FOR_WALLET → READY → EXECUTING → COMPLETED | FAILED
 *
 * Persistence is local-first (the chat is device-scoped) with an optional
 * durable backend row. Secrets never enter this record.
 */

export const PENDING_INTENT_SCHEMA = 'fbt.ai-pending-intent.v1';
export const PENDING_INTENT_KEY = 'fbt.ai.os.pending-intent.v1';

export const PENDING_STATUSES = Object.freeze([
  'WAITING_FOR_WALLET',
  'READY',
  'EXECUTING',
  'COMPLETED',
  'FAILED'
]);

const MAX_MESSAGE = 1200;

function nowMs() {
  return Date.now();
}

function sid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `pi_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* private mode / SSR */ }
  return null;
}

export function createPendingIntent({
  userId = null,
  originalMessage = '',
  intentType = 'GENERAL',
  status = 'WAITING_FOR_WALLET',
  conversationId = null,
  plan = null,
  locale = null,
  now = nowMs()
} = {}) {
  const message = String(originalMessage || '').slice(0, MAX_MESSAGE).trim();
  if (!message) return { ok: false, code: 'EMPTY_MESSAGE' };
  const st = PENDING_STATUSES.includes(status) ? status : 'WAITING_FOR_WALLET';
  return {
    ok: true,
    intent: Object.freeze({
      schema: PENDING_INTENT_SCHEMA,
      id: sid(),
      userId: userId ? String(userId).slice(0, 64) : null,
      originalMessage: message,
      intentType: String(intentType || 'GENERAL').slice(0, 40),
      status: st,
      conversationId: conversationId ? String(conversationId).slice(0, 64) : null,
      locale: locale ? String(locale).slice(0, 8) : null,
      planId: plan?.id ? String(plan.id).slice(0, 64) : null,
      createdAt: now,
      updatedAt: now
    })
  };
}

export function transitionPendingIntent(intent, nextStatus, { now = nowMs(), reason = null } = {}) {
  if (!intent || intent.schema !== PENDING_INTENT_SCHEMA) {
    return { ok: false, code: 'PENDING_INTENT_INVALID' };
  }
  const next = String(nextStatus || '').toUpperCase();
  if (!PENDING_STATUSES.includes(next)) return { ok: false, code: 'STATUS_INVALID' };
  const allowed = {
    WAITING_FOR_WALLET: ['READY', 'FAILED'],
    READY: ['EXECUTING', 'WAITING_FOR_WALLET', 'FAILED'],
    EXECUTING: ['COMPLETED', 'FAILED'],
    COMPLETED: [],
    FAILED: ['READY', 'WAITING_FOR_WALLET']
  };
  if (!allowed[intent.status]?.includes(next)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', from: intent.status, to: next };
  }
  return {
    ok: true,
    intent: {
      ...intent,
      status: next,
      updatedAt: now,
      reason: reason ? String(reason).slice(0, 80) : intent.reason || null
    }
  };
}

export function savePendingIntent(intent, storage = defaultStorage()) {
  if (!intent || intent.schema !== PENDING_INTENT_SCHEMA) return false;
  if (!storage) return false;
  try {
    storage.setItem(PENDING_INTENT_KEY, JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}

export function loadPendingIntent(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== PENDING_INTENT_SCHEMA) return null;
    if (!PENDING_STATUSES.includes(parsed.status)) return null;
    if (!parsed.originalMessage) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingIntent(storage = defaultStorage()) {
  if (!storage) return;
  try { storage.removeItem(PENDING_INTENT_KEY); } catch { /* quota */ }
}

/**
 * After a wallet connects: promote WAITING_FOR_WALLET → READY and return the
 * original message so the chat can resume without asking the user to retype.
 */
export function resumePendingIntent(storage = defaultStorage(), { now = nowMs() } = {}) {
  const current = loadPendingIntent(storage);
  if (!current) return { ok: false, code: 'NONE' };
  if (current.status === 'COMPLETED' || current.status === 'FAILED') {
    clearPendingIntent(storage);
    return { ok: false, code: 'NONE' };
  }
  if (current.status === 'WAITING_FOR_WALLET') {
    const moved = transitionPendingIntent(current, 'READY', { now });
    if (!moved.ok) return moved;
    savePendingIntent(moved.intent, storage);
    return { ok: true, intent: moved.intent, originalMessage: moved.intent.originalMessage };
  }
  return { ok: true, intent: current, originalMessage: current.originalMessage };
}
