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
export const HISTORY_SCHEMA = 'fbt.intent-os-history.v2';
export const HISTORY_MAX_CONVERSATIONS = 300;
export const HISTORY_MAX_OPERATIONS = 200;
export const HISTORY_MAX_SEASONS = 50;

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
    if (!parsed || typeof parsed !== 'object') {
      return { schema: HISTORY_SCHEMA, conversations: [], operations: [], seasons: [] };
    }
    return {
      schema: HISTORY_SCHEMA,
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      operations: Array.isArray(parsed.operations) ? parsed.operations : [],
      seasons: Array.isArray(parsed.seasons) ? parsed.seasons : []
    };
  } catch {
    return { schema: HISTORY_SCHEMA, conversations: [], operations: [], seasons: [] };
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
  const sourceId = entry?.sourceId ? String(entry.sourceId).slice(0, 80) : null;
  // A restored conversation must not be re-recorded: the same source message
  // (identified by its message id) is appended exactly once, so revisiting a
  // season can never duplicate rows in the archive.
  if (sourceId && (data.conversations || []).some((c) => c.sourceId === sourceId)) {
    return null;
  }
  const clean = stripSecretsDeep({
    id: makeId('conv'),
    schema: HISTORY_SCHEMA,
    role: entry?.role === 'user' ? 'user' : 'ai',
    content: String(entry?.content || '').slice(0, 2000),
    kind: String(entry?.kind || '').slice(0, 24),
    intentType: String(entry?.intentType || '').slice(0, 40),
    conversationId: String(entry?.conversationId || '').slice(0, 64),
    seasonId: entry?.seasonId ? String(entry.seasonId).slice(0, 64) : null,
    sourceId,
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
  write(store, { schema: HISTORY_SCHEMA, conversations: [], operations: [], seasons: [] });
  return { ok: true };
}

/**
 * Record or refresh a SEASON — one continuous chat episode. A season is the
 * unit the History panel shows under «سشن‌ها»: title, first/last timestamp,
 * message count and the last thing said, all kept compact so the archive
 * stays readable even when the raw conversation rows have been capped.
 *
 * This is an upsert keyed on `seasonId`: re-opening the same season updates
 * it in place instead of spawning duplicates.
 */
export function appendSeason(entry, { store = defaultStorage(), now = Date.now() } = {}) {
  const data = read(store);
  const seasonId = entry?.seasonId ? String(entry.seasonId).slice(0, 64) : null;
  if (!seasonId) return null;
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  const idx = seasons.findIndex((s) => s.seasonId === seasonId);
  const prev = idx >= 0 ? seasons[idx] : null;
  const add = Number(entry?.addCount);
  const next = stripSecretsDeep({
    seasonId,
    conversationId: String(entry?.conversationId || prev?.conversationId || '').slice(0, 64),
    title: (prev?.title || String(entry?.title || '').slice(0, 80)) || '',
    firstAt: Math.min(prev?.firstAt ?? Number.MAX_SAFE_INTEGER, Number(entry?.firstAt) || now),
    lastAt: Math.max(prev?.lastAt ?? 0, Number(entry?.lastAt) || now),
    messageCount: (Number(prev?.messageCount) || 0) + (Number.isFinite(add) ? add : 0),
    lastMessage: String(entry?.lastMessage || prev?.lastMessage || '').slice(0, 160),
    updatedAt: now
  });
  if (idx >= 0) seasons[idx] = next;
  else seasons.push(next);
  data.seasons = seasons.slice(-HISTORY_MAX_SEASONS);
  write(store, data);
  return next;
}

/**
 * The seasons currently archived, newest first. When an older (v1) history has
 * no season records yet, seasons are derived from the existing conversation
 * rows — one season per conversationId — so a user's pre-existing messages are
 * not lost when the surface starts grouping by season.
 */
export function seasonsFromHistory({ history = null, store = defaultStorage() } = {}) {
  const data = history || read(store);
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  if (seasons.length) {
    return seasons.slice().sort((a, b) => (Number(b.lastAt) || 0) - (Number(a.lastAt) || 0));
  }
  const byConv = new Map();
  for (const c of (data.conversations || [])) {
    const key = c.seasonId || c.conversationId || 'legacy';
    const at = Number(c.at) || 0;
    const existing = byConv.get(key);
    if (!existing) {
      byConv.set(key, {
        seasonId: key,
        conversationId: c.conversationId || '',
        title: c.role === 'user' ? String(c.content || '').slice(0, 80) : '',
        firstAt: at,
        lastAt: at,
        messageCount: 1,
        lastMessage: String(c.content || '').slice(0, 160),
        updatedAt: at
      });
    } else {
      if (at > 0 && at < (existing.firstAt || at)) existing.firstAt = at;
      if (at > 0 && at > (existing.lastAt || 0)) {
        existing.lastAt = at;
        existing.lastMessage = String(c.content || '').slice(0, 160);
      }
      if (c.role === 'user' && !existing.title) existing.title = String(c.content || '').slice(0, 80);
      existing.messageCount += 1;
      existing.updatedAt = Math.max(existing.updatedAt || 0, at);
    }
  }
  return [...byConv.values()].sort((a, b) => (Number(b.lastAt) || 0) - (Number(a.lastAt) || 0));
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
