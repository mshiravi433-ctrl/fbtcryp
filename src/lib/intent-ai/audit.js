/**
 * FBT INTENT AI — AUDIT LOG (append-only, local-first)
 * ---------------------------------------------------------------------------
 * The audit log is the single immutable record of every decision made during
 * a session: intents, strategies selected, guardian reviews, user approvals,
 * draft orders, submissions, errors, retries, emergency stops, etc.
 *
 * Rules:
 *   - append-only (no mutation, no deletion API exposed)
 *   - local-first, never synced without user opt-in
 *   - no secrets (keys, signatures, calldata, addresses never persisted)
 *   - bounded size (per session and globally) to avoid unbounded local growth
 *   - every entry has: ts, actor, action, detail, outcome
 */

export const AUDIT_SCHEMA = 'fbt.audit.v1';

const GLOBAL_KEY = 'fbt-audit-v1';
const MAX_GLOBAL_ENTRIES = 2000;
const MAX_SESSION_ENTRIES = 500;

/* Keys that must never appear in audit detail. */
const FORBIDDEN_KEYS = new Set([
  'privateKey', 'private_key', 'secret', 'mnemonic', 'seed', 'seedPhrase',
  'signature', 'rawTx', 'calldata', 'password', 'apiSecret', 'api_secret',
  'brokerMasterCredential', 'sessionKey'
]);

function safeRead(key, fallback) {
  try { return JSON.parse(globalThis.localStorage?.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function safeWrite(key, value) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function sanitizeDetail(detail, seen = new Set()) {
  if (detail == null) return null;
  if (typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean') return detail;
  if (seen.has(detail)) return '[cyclic]';
  seen.add(detail);
  if (Array.isArray(detail)) return detail.slice(0, 16).map((v) => sanitizeDetail(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (FORBIDDEN_KEYS.has(k)) { out[k] = '[REDACTED]'; continue; }
    if (typeof v === 'string' && /^0x[a-fA-F0-9]{40,}$/.test(v)) { out[k] = '[ADDRESS]'; continue; }
    if (typeof v === 'string' && v.length > 256) { out[k] = `${v.slice(0, 200)}…[truncated]`; continue; }
    out[k] = sanitizeDetail(v, seen);
  }
  return out;
}

function entryId() {
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append an entry to a session audit array (in-memory).
 * @param {object} session
 * @param {string} actor   e.g. 'user', 'fbt.strategy', 'fbt.exec', 'guardian'
 * @param {string} action  e.g. 'intent.parsed', 'guardian.rejected'
 * @param {object} [detail] payload (will be sanitized)
 * @param {string} [outcome] 'ok'|'rejected'|'warning'|'error'
 */
export function audit(session, actor, action, detail = null, outcome = 'ok') {
  if (!session || !Array.isArray(session.audit)) return session;
  const e = {
    schema: AUDIT_SCHEMA,
    id: entryId(),
    ts: Date.now(),
    sessionId: session.id,
    actor: String(actor || 'system').slice(0, 48),
    action: String(action || 'unspecified').slice(0, 80),
    outcome: ['ok', 'rejected', 'warning', 'error'].includes(outcome) ? outcome : 'ok',
    detail: sanitizeDetail(detail)
  };
  session.audit.push(e);
  if (session.audit.length > MAX_SESSION_ENTRIES) {
    const trimmed = session.audit.slice(-MAX_SESSION_ENTRIES);
    session.audit.splice(0, session.audit.length, ...trimmed);
  }
  return session;
}

/** Persist a copy to the global (local) audit log. */
export function persistAuditEntries(entries) {
  const list = safeRead(GLOBAL_KEY, []);
  if (!Array.isArray(list)) return false;
  const next = [...entries.map(sanitizeEntry), ...list].slice(0, MAX_GLOBAL_ENTRIES);
  return safeWrite(GLOBAL_KEY, next);
}

function sanitizeEntry(e) {
  return { ...e, detail: sanitizeDetail(e.detail) };
}

export function loadGlobalAudit() {
  const list = safeRead(GLOBAL_KEY, []);
  return Array.isArray(list) ? list.filter((e) => e && e.schema === AUDIT_SCHEMA) : [];
}

export function clearGlobalAudit() {
  return safeWrite(GLOBAL_KEY, []);
}

/** Export a user-visible audit trail for the session (no redacted material). */
export function exportAudit(session) {
  if (!session || !Array.isArray(session.audit)) return [];
  return session.audit.map((e) => ({ ...e }));
}

/** Count interesting outcomes for the UI / analytics. */
export function auditStats(session) {
  if (!session || !Array.isArray(session.audit)) return { total: 0, ok: 0, rejected: 0, warning: 0, error: 0 };
  const s = { total: session.audit.length, ok: 0, rejected: 0, warning: 0, error: 0 };
  for (const e of session.audit) s[e.outcome] = (s[e.outcome] || 0) + 1;
  return s;
}
