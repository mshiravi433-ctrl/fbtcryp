/**
 * FBT INTENT AI OS — browser half of the unified `/api/v1/ai` gateway.
 * ---------------------------------------------------------------------------
 * Relative URLs (a single build works in the web preview and the APK through
 * VITE_API_BASE) and fail-closed: no fallback data is invented, every
 * `unavailable`/`error` is surfaced to the chat so the AI never guesses a
 * balance or a price.
 */
import { apiBase } from './apiBase.js';

const TIMEOUT_MS = 12000;
const DEVICE_KEY = 'fbt.ai.device.v1';

function deviceScope() {
  try {
    if (typeof window === 'undefined') return '';
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

const base = () => {
  try { return (typeof apiBase === 'function' ? apiBase() : '') || '/api'; } catch { return '/api'; }
};

async function call(path, { method = 'GET', body = null, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const device = deviceScope();
  try {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (device) headers['x-fbt-device'] = device;
    const res = await fetch(`${base()}${path}`, {
      method,
      signal: ctrl.signal,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text.slice(0, 240) }; } })() : {};
    if (!res.ok) return { ok: false, status: res.status, ...json };
    return { ok: true, status: res.status, ...json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE',
      detail: String(err?.message || '').slice(0, 160)
    };
  } finally {
    clearTimeout(timer);
  }
}

const payload = (extra = {}) => ({
  locale: typeof document !== 'undefined' ? document.documentElement?.lang || null : null,
  ...extra
});

export const aiContext = (context = {}) => call('/v1/ai/context', { method: 'POST', body: payload(context) });
export const aiSuggest = ({ message, conversationId, context, prior } = {}) =>
  call('/v1/ai/suggestions', { method: 'POST', body: payload({ message, conversationId, context, prior }) });
export const aiChat = ({ message, surface, conversationId, aiControl, prior, context, resume, hints } = {}) =>
  call('/v1/ai/chat', { method: 'POST', body: payload({ message, surface, conversationId, aiControl, prior, context, resume, hints }) });
/**
 * Confirm continues an intent BY ID. It never sends the confirmation word
 * back through the parser (spec §26).
 */
export const aiConfirm = ({ intentId, actionPlanId, intentType, context, hints, conversationId } = {}) =>
  call('/v1/ai/confirm', { method: 'POST', body: payload({ intentId, actionPlanId, intentType, context, hints, conversationId }) });
export const aiExecute = ({ action, actions, plan, actionPlan, intentId, hints, message, conversationId, aiControl, dailyVolumeUsd, wallet, context, intentType, rebalance, target } = {}) =>
  call('/v1/ai/execute', { method: 'POST', body: payload({ action, actions, plan, actionPlan, intentId, hints, message, conversationId, aiControl, dailyVolumeUsd, wallet, context, intentType, rebalance, target }) });
export const aiResume = (context = {}) => call('/v1/ai/resume', { method: 'POST', body: payload(context) });
export const aiExecutionResult = (body = {}) => call('/v1/ai/execution-result', { method: 'POST', body: payload(body) });

export const aiAutomations = () => call('/v1/ai/automations');
export const aiCreateAutomation = (automation) => call('/v1/ai/automations', { method: 'POST', body: automation });
export const aiDeleteAutomation = (id) => call(`/v1/ai/automations/${encodeURIComponent(String(id || ''))}`, { method: 'DELETE' });
export const aiPauseAutomation = (id) => call(`/v1/ai/automations/${encodeURIComponent(String(id || ''))}/pause`, { method: 'POST' });
export const aiRunAutomation = (id) => call(`/v1/ai/automations/${encodeURIComponent(String(id || ''))}/run`, { method: 'POST' });
export const aiAutomationResult = (id, result) => call(`/v1/ai/automations/${encodeURIComponent(String(id || ''))}/result`, { method: 'POST', body: result });

export const aiMemory = () => call('/v1/ai/memory');
export const aiAppendMemory = (memory) => call('/v1/ai/memory', { method: 'POST', body: memory });

export const aiCreateGoal = (goal) => call('/v1/ai/goal', { method: 'POST', body: goal });

export function buildClientContext({ wallet, portfolio, balances, orders, positions, intents, automations, activity, memorySummary } = {}) {
  return {
    wallet: wallet || null,
    portfolio: portfolio || null,
    balances: balances || [],
    openOrders: orders || [],
    positions: positions || [],
    activeIntents: intents || [],
    activeAutomations: automations || [],
    recentActivity: activity || [],
    conversationSummary: memorySummary || ''
  };
}

export const aiIntentUnavailable = (r) => !r?.ok;
