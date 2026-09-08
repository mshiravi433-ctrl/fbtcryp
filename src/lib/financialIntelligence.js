/**
 * FBT FINANCIAL INTELLIGENCE OS — the browser half of `/api/ai` (batch 7).
 * ---------------------------------------------------------------------------
 * Same discipline as `src/lib/central/client.js`, one deliberate reuse:
 *
 *   THE SAME DEVICE ID. The Financial Intelligence server derives its owner
 *   the same way the central brain does (tgUser → x-fbt-device → wallet → ip)
 *   and reads the SAME state store the brain writes. If this client used a
 *   different device id, FI would see a fresh owner with an empty state and
 *   answer "unread" to a user whose portfolio the chat just read. So the
 *   device key is imported from central/client.js's storage key, not copied —
 *   one install, one identity, on both surfaces.
 *
 * Fail-closed: a non-2xx, an abort or a network error comes back as data
 * (`{ ok:false, code }`) and renders as a gap. The panel never invents a
 * number to fill one, and it never retries a mutating call on its own —
 * the STOP button in particular is a deliberate, confirmed action, not a
 * fire-and-forget.
 */
import { apiBase } from './apiBase.js';

const TIMEOUTS = { read: 8000, decide: 20000, act: 12000 };
/* The brain's device key (central/client.js): FI must see the owner the
   brain already has state for. */
const DEVICE_KEY = 'fbt.central.device.v1';

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

async function call(path, { method = 'GET', body = null, timeout = TIMEOUTS.read, idempotencyKey = null } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  const device = deviceScope();
  try {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (device) headers['x-fbt-device'] = device;
    if (idempotencyKey) headers['x-fbt-request-id'] = idempotencyKey;
    const res = await fetch(`${base()}/ai${path}`, {
      method,
      ...(ctrl ? { signal: ctrl.signal } : {}),
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : { ok: res.status < 400 }; } catch { data = { raw: text.slice(0, 300) }; }
    if (!res.ok) {
      return {
        ok: false,
        code: data?.code || `HTTP_${res.status}`,
        detail: data?.detail || data?.message || null,
        status: res.status,
        data
      };
    }
    return data && typeof data === 'object' ? data : { ok: true, data };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, code: aborted ? 'FI_TIMEOUT' : 'FI_NETWORK_ERROR', detail: aborted ? `no answer from the server within ${Math.round(timeout / 1000)}s` : String(err?.message || err).slice(0, 160) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ── the surface the panel uses ────────────────────────────────────────── */

export const fi = {
  health: () => call('/health'),
  financialState: () => call('/financial-state'),
  worldState: () => call('/world-state'),

  /** The decision pipeline. `message` is the goal in the user's words; the
   *  server does the rest and returns the decision WITH its council, its
   *  alternatives and its reason — the panel renders all of it. */
  decide: (body = {}) => call('/decision', { method: 'POST', body, timeout: TIMEOUTS.decide, idempotencyKey: `fi_dec_${Date.now().toString(36)}` }),

  /** WHY? — the decision's reason + confidence dimensions. */
  why: (decisionId) => (decisionId ? call(`/decision/${decisionId}`) : null),

  /** SHOW EVIDENCE — the decision's linked evidence bundle. */
  evidence: (decisionId) => (decisionId ? call(`/decision/${decisionId}/evidence`) : null),

  /** ALTERNATIVES — carried on the decision itself (alternatives[]). */
  strategies: () => call('/strategies'),
  whatIf: (text, goal = null) => call('/what-if', { method: 'POST', body: { text, goal } }),

  policies: () => call('/policies'),
  policy: (id) => call(`/policies/${id}`),
  createPolicy: (policy, idempotencyKey) => call('/policies', { method: 'POST', body: { policy }, timeout: TIMEOUTS.act, idempotencyKey: idempotencyKey || `fi_pol_${Date.now().toString(36)}` }),

  /** STOP — one policy. Confirmed by the panel before the call is made. */
  stopPolicy: (id, reason) => call(`/policies/${id}/stop`, { method: 'POST', body: { reason }, timeout: TIMEOUTS.act }),
  /** STOP — every active policy at once. */
  stopAll: (reason) => call('/policies/stop', { method: 'POST', body: { reason }, timeout: TIMEOUTS.act }),
  resumePolicy: (id) => call(`/policies/${id}/resume`, { method: 'POST', body: {}, timeout: TIMEOUTS.act }),

  guardianStatus: () => call('/guardian/status'),
  replan: (body) => call('/replan', { method: 'POST', body, timeout: TIMEOUTS.act }),

  council: () => call('/council'),
  councilOne: (id) => call(`/council/${id}`),

  agents: () => call('/external-agents'),
  registerAgent: (agent) => call('/external-agents', { method: 'POST', body: agent, timeout: TIMEOUTS.act }),

  learning: () => call('/learning'),
  calibration: () => call('/learning/calibration'),

  preferences: () => call('/preferences'),
  remember: (text) => call('/preferences/statement', { method: 'POST', body: { text }, timeout: TIMEOUTS.act }),

  autonomy: () => call('/autonomy'),
  run: (body) => call('/autonomy/run', { method: 'POST', body, timeout: TIMEOUTS.act, idempotencyKey: `fi_run_${Date.now().toString(36)}` })
};

export default fi;
