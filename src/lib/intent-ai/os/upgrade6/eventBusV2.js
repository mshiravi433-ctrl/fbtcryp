/**
 * FBT AI / Intent OS — UPGRADE 6
 * Global Event Bus — Spec §43
 * Events: USER_MESSAGE, AI_RESPONSE, INTENT_CREATED, INTENT_UPDATED, QUESTION_ASKED, ANSWER_RECEIVED, SLOT_FILLED, NAVIGATION_STARTED, NAVIGATION_COMPLETED, AGENT_STARTED, AGENT_COMPLETED, TOOL_STARTED, TOOL_COMPLETED, WALLET_CONNECTED, WALLET_CHANGED, EXECUTION_STARTED, EXECUTION_COMPLETED, ERROR, RECOVERY
 */

const MAX_HISTORY = 500;
const listeners = new Map();
const history = [];

function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function now() { return Date.now(); }

export const EVENTS_V6 = Object.freeze({
  USER_MESSAGE: 'USER_MESSAGE',
  AI_RESPONSE: 'AI_RESPONSE',
  INTENT_CREATED: 'INTENT_CREATED',
  INTENT_UPDATED: 'INTENT_UPDATED',
  QUESTION_ASKED: 'QUESTION_ASKED',
  ANSWER_RECEIVED: 'ANSWER_RECEIVED',
  SLOT_FILLED: 'SLOT_FILLED',
  NAVIGATION_STARTED: 'NAVIGATION_STARTED',
  NAVIGATION_COMPLETED: 'NAVIGATION_COMPLETED',
  AGENT_STARTED: 'AGENT_STARTED',
  AGENT_COMPLETED: 'AGENT_COMPLETED',
  TOOL_STARTED: 'TOOL_STARTED',
  TOOL_COMPLETED: 'TOOL_COMPLETED',
  WALLET_CONNECTED: 'WALLET_CONNECTED',
  WALLET_CHANGED: 'WALLET_CHANGED',
  WALLET_DISCONNECTED: 'WALLET_DISCONNECTED',
  EXECUTION_STARTED: 'EXECUTION_STARTED',
  EXECUTION_COMPLETED: 'EXECUTION_COMPLETED',
  ERROR: 'ERROR',
  RECOVERY: 'RECOVERY',
  // Additional
  CONTEXT_PRESERVED: 'CONTEXT_PRESERVED',
  CONTEXT_LOST: 'CONTEXT_LOST',
  NAVIGATION_LOOP_DETECTED: 'NAVIGATION_LOOP_DETECTED',
  INTENT_COMPLETED: 'INTENT_COMPLETED',
  INTENT_FAILED: 'INTENT_FAILED',
  SHORT_ANSWER_RESOLVED: 'SHORT_ANSWER_RESOLVED',
  REFERENCE_RESOLVED: 'REFERENCE_RESOLVED',
  CONFIDENCE_EVALUATED: 'CONFIDENCE_EVALUATED',
  REPETITION_PREVENTED: 'REPETITION_PREVENTED',
  SCROLL_EVENT: 'SCROLL_EVENT'
});

export function emitV6(type, payload = {}, source = 'upgrade6') {
  const event = {
    id: makeId(),
    type: String(type),
    payload,
    source: String(source),
    timestamp: now(),
    iso: new Date().toISOString(),
    version: 6
  };
  history.push(event);
  if (history.length > MAX_HISTORY) history.shift();

  const list = listeners.get(type) || [];
  const wild = listeners.get('*') || [];
  for (const fn of [...list, ...wild]) {
    try { fn(event); } catch (e) { console.warn('[EventBusV6] listener error', e); }
  }

  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fbt:v6-event', { detail: event }));
    }
  } catch {}

  return event;
}

export function onV6(type, handler) {
  const t = String(type || '*');
  if (!listeners.has(t)) listeners.set(t, []);
  listeners.get(t).push(handler);
  return () => {
    const list = listeners.get(t) || [];
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  };
}

export function offV6(type, handler) {
  const list = listeners.get(String(type)) || [];
  const idx = list.indexOf(handler);
  if (idx >= 0) list.splice(idx, 1);
}

export function getHistoryV6({ type = null, limit = 100 } = {}) {
  let list = [...history];
  if (type) list = list.filter((e) => e.type === type);
  return list.slice(-limit).reverse();
}

export function clearHistoryV6() {
  history.length = 0;
}

// Convenience wrappers
export const busV6 = {
  emit: emitV6,
  on: onV6,
  off: offV6,
  history: getHistoryV6,
  clear: clearHistoryV6,
  EVENTS: EVENTS_V6
};
