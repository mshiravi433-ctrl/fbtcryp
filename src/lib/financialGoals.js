/**
 * Financial Goals — browser client for /api/v1/financial-goals.
 * ---------------------------------------------------------------------------
 * Two things this file is careful about:
 *
 *   1. SCOPE, NOT SECRETS. The only header it adds is `x-fbt-device`, a random
 *      per-install label kept in localStorage. It never carries a key, a seed
 *      phrase, a password or a wallet credential — the goal API has no use for
 *      any of them and the backend has no code path that would read one.
 *   2. NO EXECUTION. `approveGoal` means "I have reviewed this proposal". The
 *      response is an intent payload, and src/lib/financialGoalIntent.js is
 *      what turns it into an Intent OS draft the user still has to sign.
 */

import { apiBase } from './apiBase.js';
import { parseGoalFromText } from './financialGoalEngine.js';

const SCOPE_KEY = 'fbt-financial-scope-v1';
const BASE = '/v1/financial-goals';

/**
 * A per-install scope label. Random, opaque and meaningless outside this
 * deployment — it exists so two people on the same deployment do not see each
 * other's goals. The server hashes it before it touches storage.
 */
export function deviceScope() {
  try {
    const existing = localStorage.getItem(SCOPE_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const bytes = new Uint8Array(24);
    (globalThis.crypto || window.crypto).getRandomValues(bytes);
    const made = `dev-${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32)}`;
    localStorage.setItem(SCOPE_KEY, made);
    return made;
  } catch {
    /* Private mode / disabled storage: fall back to a per-tab id so the screen
       still works, and the server reports it as non-durable anyway. */
    return `dev-${Math.random().toString(36).slice(2, 20)}${Date.now().toString(36)}`;
  }
}

async function call(path, { method = 'GET', body = null } = {}) {
  let response = null;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        'x-fbt-device': deviceScope()
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    return { ok: false, code: 'NETWORK_UNREACHABLE', data: null, meta: null };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: `HTTP_${response.status}`, data: null, meta: null };
  }
  if (!response.ok || payload?.ok === false) {
    return { ok: false, code: payload?.error || `HTTP_${response.status}`, data: null, meta: payload?.meta ?? null };
  }
  return { ok: true, code: null, data: payload?.data ?? null, meta: payload?.meta ?? null };
}

export const listGoals = () => call(BASE);
export const getGoal = (id) => call(`${BASE}/${encodeURIComponent(id)}`);

export const createGoal = (input) => call(BASE, { method: 'POST', body: input });

export const buildPlan = (id, body = {}) =>
  call(`${BASE}/${encodeURIComponent(id)}/build-plan`, { method: 'POST', body });

export const approveGoal = (id) =>
  call(`${BASE}/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} });

export const pauseGoal = (id, paused = true) =>
  call(`${BASE}/${encodeURIComponent(id)}/pause`, { method: 'POST', body: { paused } });

export const goalProgress = (id, currentValueUsd = null) =>
  call(`${BASE}/${encodeURIComponent(id)}/progress${currentValueUsd === null || currentValueUsd === '' ? '' : `?currentValueUsd=${encodeURIComponent(currentValueUsd)}`}`);

/**
 * Read a typed sentence into form fields, on the device, with no model in the
 * loop — so nothing the user types into the goal box is ever sent to an AI.
 */
export function readGoalSentence(text) {
  return parseGoalFromText(text);
}
