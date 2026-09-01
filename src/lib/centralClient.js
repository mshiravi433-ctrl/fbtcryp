/**
 * FBT CENTRAL INTELLIGENCE OS — browser half of the single gateway.
 * ---------------------------------------------------------------------------
 * The frontend talks to ONE brain through these calls (§37):
 *
 *   centralIntent()       → POST /api/intent
 *   centralConfirm()      → POST /api/intent/:id/confirm
 *   centralCancel()       → POST /api/intent/:id/cancel
 *   centralState()        → GET  /api/system/state
 *   centralHealth()       → GET  /api/system/health
 *   centralCapabilities() → GET  /api/system/capabilities
 *   centralEvents()       → GET  /api/system/events
 *   centralTool()         → POST /api/tools/<op>
 *   centralTransaction()  → GET  /api/transactions/:id
 *
 * Relative URLs only (the dev server / preview proxy handles the hop); the
 * device header scopes the session so one browser = one brain session.
 */
import { apiBase } from './apiBase.js';

const TIMEOUT_MS = 15000;
const DEVICE_KEY = 'fbt.ai.device.v1'; // SAME device identity as the V1 AI client

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

/**
 * Page awareness payload (§7): what the user is looking at RIGHT NOW.
 * Build it from the router + local selection state before every intent call.
 */
export function buildPageContext({ route, module = null, tab = null, selectedAsset = null, selectedNetwork = null, walletConnected = false } = {}) {
  return { route: route || null, module, tab, selectedAsset, selectedNetwork, walletConnected };
}

export const centralIntent = ({ message, requestId = null, page = null, context = null } = {}) =>
  call('/intent', { method: 'POST', body: { message, requestId, page, context } });

export const centralIntentById = (id) => call(`/intent/${encodeURIComponent(String(id || ''))}`);
export const centralConfirm = (id, body = {}) => call(`/intent/${encodeURIComponent(String(id || ''))}/confirm`, { method: 'POST', body });
export const centralCancel = (id) => call(`/intent/${encodeURIComponent(String(id || ''))}/cancel`, { method: 'POST', body: {} });

export const centralState = (context = null) => call('/system/state', { method: 'GET' });
export const centralHealth = () => call('/system/health');
export const centralCapabilities = () => call('/system/capabilities');
export const centralEvents = ({ type = null, limit = 50 } = {}) => {
  const q = new URLSearchParams();
  if (type) q.set('type', type);
  if (limit) q.set('limit', String(limit));
  const qs = q.toString();
  return call(`/system/events${qs ? `?${qs}` : ''}`);
};
export const centralModules = () => call('/system/modules');
export const centralMemory = () => call('/system/memory');

export const centralTool = (operation, module, input = {}) =>
  call(`/tools/${encodeURIComponent(String(operation || 'read'))}`, { method: 'POST', body: { module, input } });

export const centralTransaction = (id) => call(`/transactions/${encodeURIComponent(String(id || ''))}`);

/**
 * Push the client-owned truth (wallet/portfolio/positions/page) into the
 * brain and get the refreshed unified state back. Fire-and-forget is fine:
 * the brain re-reads on demand anyway.
 */
export const centralIngest = (context = {}) => call('/system/state', { method: 'POST', body: context });
