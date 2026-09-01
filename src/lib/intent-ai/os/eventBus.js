/**
 * FBT INTENT OS — Cross-App Event Bus & Action Bus
 * ---------------------------------------------------------------------------
 * Spec §21 + §22
 * Central event bus for app-wide events
 * Action bus for all AI operations
 */

export const EVENT_SCHEMA = 'fbt.ai-event.v1';
export const ACTION_SCHEMA = 'fbt.ai-action.v1';

// In-memory listeners
const eventListeners = new Map();
const actionListeners = new Map();
const eventHistory = [];
const MAX_HISTORY = 200;

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Event Bus — wallet.connected, swap.completed, etc.
 */
export function emitEvent(type, payload = {}, source = 'app') {
  const event = {
    id: makeId(),
    schema: EVENT_SCHEMA,
    type: String(type),
    source: String(source),
    payload,
    timestamp: Date.now(),
    iso: new Date().toISOString()
  };

  // Store history
  eventHistory.push(event);
  if (eventHistory.length > MAX_HISTORY) eventHistory.shift();

  // Notify listeners
  const listeners = eventListeners.get(type) || [];
  const wildcards = eventListeners.get('*') || [];
  
  for (const fn of [...listeners, ...wildcards]) {
    try {
      fn(event);
    } catch (e) {
      console.warn('[EventBus] listener error', e);
    }
  }

  // Also dispatch to window for cross-component
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fbt:ai-event', { detail: event }));
    }
  } catch {}

  return event;
}

export function onEvent(type, handler) {
  const t = String(type || '*');
  if (!eventListeners.has(t)) eventListeners.set(t, []);
  eventListeners.get(t).push(handler);
  
  // Return unsubscribe
  return () => {
    const list = eventListeners.get(t) || [];
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  };
}

export function offEvent(type, handler) {
  const list = eventListeners.get(String(type)) || [];
  const idx = list.indexOf(handler);
  if (idx >= 0) list.splice(idx, 1);
}

export function getEventHistory({ type = null, limit = 50 } = {}) {
  let list = [...eventHistory];
  if (type) {
    list = list.filter(e => e.type === type);
  }
  return list.slice(-limit).reverse();
}

// Predefined events
export const EVENTS = Object.freeze({
  WALLET_CONNECTED: 'wallet.connected',
  WALLET_DISCONNECTED: 'wallet.disconnected',
  WALLET_UPDATED: 'wallet.updated',
  SWAP_COMPLETED: 'swap.completed',
  SWAP_FAILED: 'swap.failed',
  BRIDGE_COMPLETED: 'bridge.completed',
  BRIDGE_FAILED: 'bridge.failed',
  PORTFOLIO_UPDATED: 'portfolio.updated',
  PORTFOLIO_REBALANCED: 'portfolio.rebalanced',
  ORDER_CREATED: 'order.created',
  ORDER_FILLED: 'order.filled',
  FARM_UPDATED: 'farm.updated',
  NEWS_OPENED: 'news.opened',
  MUSIC_PLAYED: 'music.played',
  MUSIC_PAUSED: 'music.paused',
  NAVIGATION: 'navigation.opened',
  INTENT_CREATED: 'intent.created',
  INTENT_COMPLETED: 'intent.completed',
  TASK_STARTED: 'task.started',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed'
});

/**
 * Action Bus — all AI operations go through here
 * Spec §22: await actionBus.dispatch({ action: "wallet.getBalance", input: {...} })
 */
const actionHandlers = new Map();

export function registerActionHandler(actionId, handler) {
  actionHandlers.set(String(actionId), handler);
}

export function unregisterActionHandler(actionId) {
  actionHandlers.delete(String(actionId));
}

export async function dispatchAction({ action, input = {}, context = {}, meta = {} } = {}) {
  const id = String(action || '');
  if (!id) {
    return { ok: false, error: 'MISSING_ACTION', message: 'این قابلیت در حال حاضر در دسترس نیست.' };
  }

  const handler = actionHandlers.get(id);
  
  const actionEvent = {
    id: makeId(),
    schema: ACTION_SCHEMA,
    action: id,
    input: sanitizeInput(input),
    context: { route: context.currentRoute || context.currentPage || '/', timestamp: Date.now() },
    meta,
    timestamp: Date.now()
  };

  // Emit action event
  emitEvent('action.dispatched', actionEvent, 'action-bus');

  if (!handler) {
    // Try to find in tool registry as fallback
    try {
      const { getTool } = await import('./toolRegistry.js');
      const tool = getTool(id);
      if (tool && typeof tool.execute === 'function') {
        const result = await tool.execute(input, context);
        const out = {
          ok: result?.ok !== false,
          action: id,
          result,
          actionId: actionEvent.id,
          timestamp: Date.now()
        };
        emitEvent('action.completed', out, 'action-bus');
        return out;
      }
    } catch {}
    
    return { ok: false, error: 'ACTION_NOT_FOUND', action: id, message: 'این قابلیت در حال حاضر در دسترس نیست.' };
  }

  try {
    const result = await handler(input, context);
    const out = {
      ok: result?.ok !== false,
      action: id,
      result,
      actionId: actionEvent.id,
      timestamp: Date.now()
    };
    emitEvent('action.completed', out, 'action-bus');
    return out;
  } catch (err) {
    const out = {
      ok: false,
      action: id,
      error: err?.message || 'ACTION_FAILED',
      actionId: actionEvent.id,
      timestamp: Date.now()
    };
    emitEvent('action.failed', out, 'action-bus');
    return out;
  }
}

function sanitizeInput(input) {
  if (!input || typeof input !== 'object') return input;
  const forbidden = ['privateKey', 'seedPhrase', 'mnemonic', 'secret'];
  const out = { ...input };
  for (const k of forbidden) delete out[k];
  return out;
}

// Convenience: dispatch via window event for React components
export function setupGlobalBus() {
  if (typeof window === 'undefined') return;
  
  if (window.__FBT_ACTION_BUS_SETUP__) return;
  window.__FBT_ACTION_BUS_SETUP__ = true;

  window.addEventListener('fbt:dispatch-action', async (e) => {
    const detail = e.detail || {};
    const result = await dispatchAction(detail);
    window.dispatchEvent(new CustomEvent('fbt:action-result', { detail: result }));
  });
}

export const actionBus = {
  dispatch: dispatchAction,
  register: registerActionHandler,
  unregister: unregisterActionHandler,
  on: onEvent,
  emit: emitEvent
};
