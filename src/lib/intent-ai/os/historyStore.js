/**
 * FBT INTENT OS — PERSISTENT HISTORY (conversation + operations).
 * ---------------------------------------------------------------------------
 * One local store, keyed `fbt.intent-os.history.v1`, records every turn and
 * every real operation so the [History] button can show:
 *
 *   · Conversations — the actual user/AI turns (not a summary guess)
 *   · Operations — monitor creates, conditional orders, swap/bridge hand-offs,
 *     goal creations, opportunity scans, executions — each with a real state
 *   · Active monitoring — read live from the server monitor registry by the UI
 *
 * Storage is injectable so the probe can test with a memory store; the app
 * passes localStorage. Never stores a secret — callers must strip before
 * appending (the UI only appends public outcomes, and this module re-strips
 * the obvious credential field names defensively).
 */

export const HISTORY_KEY = 'fbt.intent-os.history.v1';
export const HISTORY_SCHEMA = 'fbt.intent-os-history.v1';
export const HISTORY_MAX_CONVERSATIONS = 300;
export const HISTORY_MAX_OPERATIONS = 200;

const FORBIDDEN = /privatekey|mnemonic|seedphrase|seed|signature|signedpayload|apikey|password|secret/i;

function stripSecretsDeep(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripSecretsDeep(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN.test(k)) continue;
    out[k] = stripSecretsDeep(v, depth + 1);
  }
  return out;
}

export function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* SSR / private mode */ }
  return null;
}

function read(store) {
  try {
    const raw = store?.getItem(HISTORY_KEY) || '';
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return { schema: HISTORY_SCHEMA, conversations: [], operations: [] };
    return {
      schema: HISTORY_SCHEMA,
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      operations: Array.isArray(parsed.operations) ? parsed.operations : []
    };
  } catch {
    return { schema: HISTORY_SCHEMA, conversations: [], operations: [] };
  }
}

function write(store, data) {
  try {
    store?.setItem(HISTORY_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function appendConversation(entry, { store = defaultStorage(), now = Date.now() } = {}) {
  const data = read(store);
  const clean = stripSecretsDeep({
    id: makeId('conv'),
    schema: HISTORY_SCHEMA,
    role: entry?.role === 'user' ? 'user' : 'ai',
    content: String(entry?.content || '').slice(0, 2000),
    kind: String(entry?.kind || '').slice(0, 24),
    intentType: String(entry?.intentType || '').slice(0, 40),
    conversationId: String(entry?.conversationId || '').slice(0, 64),
    operationId: String(entry?.operationId || '').slice(0, 64) || null,
    at: now
  });
  data.conversations = [clean, ...(data.conversations || [])].slice(0, HISTORY_MAX_CONVERSATIONS);
  write(store, data);
  return clean;
}

export function appendOperation(entry, { store = defaultStorage(), now = Date.now() } = {}) {
  const data = read(store);
  const clean = stripSecretsDeep({
    id: makeId('op'),
    schema: HISTORY_SCHEMA,
    kind: String(entry?.kind || 'OPERATION').slice(0, 40),
    status: String(entry?.status || 'COMPLETED').slice(0, 24),
    title: String(entry?.title || '').slice(0, 140),
    detail: String(entry?.detail || '').slice(0, 500),
    ref: String(entry?.ref || '').slice(0, 64) || null,
    refKind: String(entry?.refKind || '').slice(0, 24) || null,
    conversationId: String(entry?.conversationId || '').slice(0, 64),
    messageOriginal: String(entry?.messageOriginal || '').slice(0, 400),
    txHash: String(entry?.txHash || '').slice(0, 128) || null,
    at: now
  });
  data.operations = [clean, ...(data.operations || [])].slice(0, HISTORY_MAX_OPERATIONS);
  write(store, data);
  return clean;
}

export function readHistory({ store = defaultStorage() } = {}) {
  return read(store);
}

export function clearHistory({ store = defaultStorage() } = {}) {
  write(store, { schema: HISTORY_SCHEMA, conversations: [], operations: [] });
  return { ok: true };
}

/** Group operations by kind for the History tabs. */
export function operationsByKind(rows = []) {
  const out = {};
  for (const r of rows) {
    const k = r?.kind || 'OPERATION';
    if (!out[k]) out[k] = [];
    out[k].push(r);
  }
  return out;
}
