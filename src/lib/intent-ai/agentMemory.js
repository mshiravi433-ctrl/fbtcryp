/**
 * FBT INTENT AI — structured memory and local-first learning boundary.
 *
 * This module stores redacted, typed events only. It deliberately does not
 * persist credentials, raw secrets or unrestricted chat by default.
 */

export const MEMORY_SCHEMA = 'fbt.intent-memory.v1';
export const EVENT_TYPES = Object.freeze([
  'intent.created',
  'capability.scanned',
  'strategy.proposed',
  'strategy.challenged',
  'target.assessed',
  'authorization.requested',
  'authorization.decided',
  'execution.reviewed',
  'execution.blocked',
  'execution.completed',
  'control.changed',
  'agent.disconnected',
  'learning.feedback'
]);
const SECRET_FIELD = /(seed|mnemonic|private.?key|master.?password|raw.?secret|secret.?key|credential|token|cookie)/i;
const clean = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : value;

function redact(value, depth = 0, seen = new WeakSet()) {
  if (depth > 4) return '[redacted-depth]';
  if (typeof value === 'string') {
    return /(-----BEGIN[^-]*PRIVATE KEY-----|\b(?:0x)?[a-f0-9]{64}\b|mnemonic|seed phrase|private.?key|master.?password|raw.?secret)/i.test(value)
      ? '[redacted-secret-value]'
      : clean(value);
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[redacted-circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => redact(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
    key,
    SECRET_FIELD.test(key) ? '[redacted-secret-field]' : redact(item, depth + 1, seen)
  ]));
}

export function createMemoryStore({ maxEvents = 500 } = {}) {
  const events = [];
  const limit = Math.max(1, Math.min(5000, Number(maxEvents) || 500));
  return {
    append(type, payload = {}, metadata = {}) {
      if (!EVENT_TYPES.includes(type)) return { ok: false, code: 'UNKNOWN_EVENT_TYPE' };
      const event = {
        schema: MEMORY_SCHEMA,
        id: `mem-${Date.now()}-${events.length + 1}`,
        type,
        createdAt: new Date().toISOString(),
        payload: redact(payload),
        metadata: redact(metadata)
      };
      events.push(event);
      while (events.length > limit) events.shift();
      return { ok: true, event: structuredCloneSafe(event) };
    },
    list({ type = null, limit: requestedLimit = 100 } = {}) {
      const filtered = type && EVENT_TYPES.includes(type) ? events.filter((item) => item.type === type) : events;
      return structuredCloneSafe(filtered.slice(-Math.max(1, Math.min(500, Number(requestedLimit) || 100))));
    },
    clear() {
      events.length = 0;
      return { ok: true };
    },
    size() { return events.length; }
  };
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

export function buildLearningBatch(events = []) {
  const safeEvents = Array.isArray(events) ? events.filter((event) => event && EVENT_TYPES.includes(event.type)).map((event) => redact(event)) : [];
  return {
    schema: `${MEMORY_SCHEMA}.learning-batch`,
    createdAt: new Date().toISOString(),
    eventCount: safeEvents.length,
    events: safeEvents,
    localFirst: true,
    upload: 'disabled-by-default',
    containsSecrets: false
  };
}

export function feedbackFromDecision({ accepted, reason = '', dimension = null } = {}) {
  return {
    type: 'learning.feedback',
    payload: {
      accepted: accepted === true,
      reason: clean(reason, 240),
      dimension: clean(dimension, 80)
    },
    permission: 'learning-only',
    changesExecutionPermission: false
  };
}
