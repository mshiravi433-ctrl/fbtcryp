/**
 * DEVELOPER CONSOLE CLIENT — the authenticated half of /api/ecosystem and
 * /api/developer.
 *
 * Separate from src/lib/ecosystemCatalog.js on purpose. That module is the
 * public, read-only catalog reader and must stay incapable of writing; this
 * one writes, and every call it makes is one a signed-in owner (or an
 * allowlisted reviewer) could make by hand with curl. Keeping them apart means
 * the public page cannot accidentally import a mutation.
 *
 * THREE THINGS THIS FILE REFUSES TO DO
 * ---------------------------------------------------------------------------
 *   · Decide anything. Ownership, scopes, the certifier allowlist and the
 *     publish gate are all enforced server-side; this module only renders what
 *     the server allows and reports the code it refused with.
 *   · Hide a failure. Every helper resolves to `{ ok, code }` rather than
 *     throwing, so a caller cannot accidentally treat a 403 as an empty list.
 *   · Retry a write blindly. Each mutation sends a fresh `idempotency-key`, so
 *     a user double-tapping "submit" replays instead of creating a duplicate.
 */

import { telegramAuthHeaders, telegramAuthBodyFields } from './telegramSession.js';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';
const TIMEOUT_MS = 9000;

const idempotencyKey = () => {
  const random = globalThis.crypto?.randomUUID?.();
  return (random || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128);
};

async function call(path, { method = 'GET', body = null } = {}) {
  const headers = telegramAuthHeaders(method === 'GET' ? {} : { 'content-type': 'application/json', 'idempotency-key': idempotencyKey() });
  /* No session means no request: a 401 round-trip teaches the user nothing
     that "open this inside Telegram" does not say better. */
  if (!headers) return { ok: false, code: 'AUTH_REQUIRED', status: 401 };

  /* POSTs carry the initData in the JSON body as well as the header: the
     body is byte-exact, the header can be mangled by proxies. The server
     verifies the body copy first and can compare both — see
     /api/telegram/diagnose. Existing routes ignore the extra key. */
  const bodyFields = method === 'GET' ? null : telegramAuthBodyFields();
  const requestBody = bodyFields ? { ...bodyFields, ...(body || {}) } : body;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      signal: controller.signal,
      ...(requestBody ? { body: JSON.stringify(requestBody) } : {})
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, code: payload?.error?.code || `HTTP_${res.status}`, retryable: Boolean(payload?.error?.retryable) };
    return { ok: true, status: res.status, data: payload?.data ?? null, meta: payload?.meta ?? null };
  } catch (err) {
    return { ok: false, code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The optional auth middleware intentionally collapses an invalid Mini App
 * session into AUTH_REQUIRED for protected routes. Ask the metadata-only
 * diagnostic route for the precise reason before showing a human message.
 * This request is allowed without a session so NO_INIT_DATA_SENT is diagnosed
 * too; the endpoint never returns initData values or the bot token.
 *
 * Sent as POST with the initData in BOTH the JSON body and the header: the
 * server verifies the byte-exact body copy and reports whether the two
 * transports arrived identical (transportMatch) — which separates "the header
 * was corrupted on the way in" from "the server holds the wrong token",
 * the two causes of BAD_SIGNATURE that need opposite fixes.
 */
export async function diagnoseTelegramAuth() {
  const headers = telegramAuthHeaders();
  const bodyFields = telegramAuthBodyFields();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/telegram/diagnose`, {
      method: 'POST',
      headers: headers || { accept: 'application/json' },
      body: JSON.stringify(bodyFields || {}),
      signal: controller.signal
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, code: `HTTP_${res.status}` };
    return { ok: true, status: res.status, data: payload?.data ?? null, meta: payload?.meta ?? null };
  } catch (err) {
    return { ok: false, code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the server which bot its TELEGRAM_BOT_TOKEN actually belongs to.
 * Anonymous callers receive the bot's public getMe identity. Full token
 * diagnostics are included only when the request has either a verified Mini
 * App session or the cron secret.
 */
export async function whoamiBot() {
  const headers = telegramAuthHeaders();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/telegram/whoami-bot`, { headers: headers || { accept: 'application/json' }, signal: controller.signal });
    const payload = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, code: payload?.error || `HTTP_${res.status}` };
    return { ok: true, status: res.status, data: payload?.data ?? null };
  } catch (err) {
    return { ok: false, code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------- projects & keys ---------------------------- */

export const listProjects = () => call('/developer/projects');
export const createProject = (name, scopes) => call('/developer/projects', { method: 'POST', body: { name, environment: 'sandbox', scopes } });
/* The secret comes back exactly once — the caller must show it immediately and
   never store it; the server keeps only a hash and cannot re-issue it. */
export const createProjectKey = (projectId, scopes) => call(`/developer/projects/${encodeURIComponent(projectId)}/keys`, { method: 'POST', body: { scopes } });
export const revokeProjectKey = (projectId, keyId) => call(`/developer/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(keyId)}/revoke`, { method: 'POST', body: {} });

/* -------------------------------- listings -------------------------------- */

const PATHS = { agent: 'agents', strategy: 'strategies' };

export const listMyListings = (type) => call(`/ecosystem/mine/${PATHS[type]}`);
export const createListing = (type, payload) => call(`/ecosystem/${PATHS[type]}`, { method: 'POST', body: payload });
export const updateListing = (type, id, payload) => call(`/ecosystem/${PATHS[type]}/${encodeURIComponent(id)}`, { method: 'POST', body: payload });
/** submit | publish | revoke | delete — the server owns the state machine. */
export const moveListing = (type, id, action) => call(`/ecosystem/${PATHS[type]}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} });

/* ------------------------------- reviewing -------------------------------- */

export const certifierStatus = () => call('/ecosystem/certifier');
export const reviewQueue = () => call('/ecosystem/review/queue');
export const issueCertification = (payload) => call('/ecosystem/certifications', { method: 'POST', body: payload });
export const revokeCertification = (id) => call(`/ecosystem/certifications/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {} });

/* --------------------------------- shaping -------------------------------- */

/**
 * Turn the compact console form into the schema the server validates.
 *
 * It deliberately does NOT set permissions, execution authority or status:
 * those are the server's to decide, and a client that sends them just gets
 * them overwritten. Chain ids are parsed here only so a typo shows up as an
 * empty list in the form rather than a 400 from the API.
 */
export function buildListingPayload(type, form) {
  const chains = String(form.chains || '')
    .split(/[,\s]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .slice(0, 16);
  const base = {
    id: String(form.id || '').trim().toLowerCase(),
    name: { en: String(form.name || '').trim() },
    description: String(form.description || '').trim() ? { en: String(form.description).trim() } : undefined
  };
  if (type === 'agent') {
    return { ...base, supportedChains: chains, executionMode: form.executionMode === 'manual' ? 'manual' : 'simulation-only', permissions: {} };
  }
  return {
    ...base,
    trigger: form.trigger ? { type: form.trigger, expression: 'client-evaluated' } : null,
    policy: {
      maxAmountUsd: Number(form.maxAmountUsd),
      maxSlippageBps: Number(form.maxSlippageBps),
      allowedChains: chains
    },
    action: { type: 'create_intent' }
  };
}

/** Evidence must be checkable: an https link or a sha256 digest, nothing else. */
export function buildEvidence(form) {
  const value = String(form.evidence || '').trim();
  if (!value) return [];
  if (/^[a-f0-9]{64}$/i.test(value)) return [{ type: form.evidenceType || 'code_review', sha256: value.toLowerCase() }];
  return [{ type: form.evidenceType || 'sandbox_test_run', uri: value }];
}
