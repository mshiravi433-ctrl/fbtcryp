/**
 * EXTERNAL AGENT HUB — browser client.
 * ---------------------------------------------------------------------------
 * Same conventions as `src/lib/aiIntentClient.js`: relative URLs through
 * `apiBase()` (so the APK and the web preview both work), the device identity
 * header the rest of the AI surface already uses, a timeout on every call, and
 * FAIL-CLOSED results — no fallback catalogue, no cached "demo" agent, no
 * invented task. If the server says unavailable, the UI says unavailable.
 *
 * The base path is `/ai/agent-hub` — NOT `/ai/agents`, which belongs to the
 * command-center roster. See server/agentHub/router.js for the full map.
 */
import { apiBase } from '../../apiBase.js';

const TIMEOUT_MS = 15_000;
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
  try {
    return (typeof apiBase === 'function' ? apiBase() : '') || '/api';
  } catch {
    return '/api';
  }
};

async function call(path, { method = 'GET', body = null, timeout = TIMEOUT_MS, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const device = deviceScope();
  try {
    const res = await fetch(`${base()}/ai/agent-hub${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(device ? { 'x-fbt-device': device } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
    if (!res.ok) return { ok: false, status: res.status, ...json };
    return { ok: true, status: res.status, ...json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE',
      detail: String(err?.message || '').slice(0, 160)
    };
  } finally {
    clearTimeout(timer);
  }
}

/** A key that is unique per user intent — regenerated when the form is edited. */
export function newIdempotencyKey(prefix = 'hub') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const getCatalog = () => call('/catalog');
export const getAgent = (agentId) => call(`/agents/${encodeURIComponent(agentId)}`);
export const listTasks = (limit = 30) => call(`/tasks?limit=${Number(limit) || 30}`);
export const getTask = (taskId) => call(`/tasks/${encodeURIComponent(taskId)}`);

export const createTask = ({ agentId, taskText, categories, context, termsVersion = null, privacyVersion = null, idempotencyKey }) =>
  call(`/agents/${encodeURIComponent(agentId)}/tasks`, {
    method: 'POST',
    timeout: 45_000,
    headers: { 'idempotency-key': String(idempotencyKey || newIdempotencyKey()) },
    body: {
      taskText,
      context: context || {},
      consent: { approved: true, categories, termsVersion, privacyVersion }
    }
  });

export const cancelTask = (taskId) => call(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: {} });

export const listConnections = () => call('/connections');
export const startConnection = (providerId) => call(`/providers/${encodeURIComponent(providerId)}/connections/start`, { method: 'POST', body: {} });
export const revokeConnection = (connectionId) => call(`/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
