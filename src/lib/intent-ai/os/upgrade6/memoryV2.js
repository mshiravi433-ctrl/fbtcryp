/**
 * FBT AI / Intent OS — UPGRADE 6
 * Memory V2 — Unified Memory (L1+L2+L3 merged, always-on, AI auto-selects layer)
 * Spec §12 + User correction: L1/L2/L3 یکی، هر سشن هر سه روشن، AI خودش انتخاب می‌کنه، نه کاربر
 *
 * Backward compat: getL1Messages / getL2Tasks / getL3Preferences still work,
 * but they read from single unified store.
 *
 * Caps preserved for probe: L1 100, L2 50, L3 100, UNIFIED 250
 */

const KEYS = {
  L1: 'fbt.memory.v6.l1.messages',
  L2: 'fbt.memory.v6.l2.tasks',
  L3: 'fbt.memory.v6.l3.preferences',
  UNIFIED: 'fbt.memory.v6.unified',
  META: 'fbt.memory.v6.meta'
};

const LIMITS = { L1: 100, L2: 50, L3: 100, UNIFIED: 250 };

function safeRead(key, fallback = []) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function now() { return Date.now(); }
function makeId(prefix = 'mem') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// Sensitive keys that should NOT be stored without permission
const SENSITIVE_KEYS = ['privateKey', 'seedPhrase', 'mnemonic', 'password', 'secret', 'apiKey', 'private_key', 'seed'];

function isSensitive(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const k of Object.keys(obj)) {
    if (SENSITIVE_KEYS.some((sk) => k.toLowerCase().includes(sk.toLowerCase()))) return true;
  }
  // Also check values for seed phrase pattern
  const str = JSON.stringify(obj).toLowerCase();
  if (/abandon.*ability|seed phrase|mnemonic/.test(str) && str.split(' ').length > 8) return true;
  return false;
}

/* ───────────────────── UNIFIED STORE ───────────────────── */

function getUnifiedRaw() {
  return safeRead(KEYS.UNIFIED, []);
}

function saveUnified(list) {
  // Enforce total UNIFIED cap 250 after per-layer caps already applied
  let trimmed = list;
  if (trimmed.length > LIMITS.UNIFIED) {
    // Keep most recent by at/updatedAt, but prefer higher importance for L3
    trimmed = [...trimmed].sort((a, b) => {
      const impDiff = (b.importance || 0) - (a.importance || 0);
      if (Math.abs(impDiff) > 0.3) return impDiff;
      return (b.at || b.updatedAt || 0) - (a.at || a.updatedAt || 0);
    }).slice(0, LIMITS.UNIFIED);
  }
  safeWrite(KEYS.UNIFIED, trimmed);
  return trimmed;
}

function migrateLegacyIfNeeded() {
  const unified = getUnifiedRaw();
  if (unified.length > 0) return unified;

  const l1 = safeRead(KEYS.L1, []);
  const l2 = safeRead(KEYS.L2, []);
  const l3 = safeRead(KEYS.L3, []);

  if (!l1.length && !l2.length && !l3.length) return [];

  const merged = [];
  for (const m of l1) {
    merged.push({
      id: m.id || makeId('l1'),
      layer: 'L1',
      type: 'message',
      role: m.role || 'user',
      content: String(m.content || m.text || '').slice(0, 2000),
      kind: m.kind || null,
      intentType: m.intentType || null,
      timestamp: m.timestamp || m.at || now(),
      at: m.at || m.timestamp || now(),
      importance: 0.5,
      confidence: 0.8,
      source: 'migrated_l1'
    });
  }
  for (const t of l2) {
    merged.push({
      id: t.id || makeId('l2'),
      layer: 'L2',
      type: t.type || t.intent || 'task',
      goal: String(t.goal || '').slice(0, 500),
      status: t.status || 'pending',
      slots: t.slots || t.collectedSlots || {},
      result: t.result ? String(t.result).slice(0, 1000) : null,
      createdAt: t.createdAt || now(),
      updatedAt: t.updatedAt || now(),
      at: t.updatedAt || t.createdAt || now(),
      importance: 0.7,
      confidence: 0.8,
      source: 'migrated_l2'
    });
  }
  for (const p of l3) {
    merged.push({
      id: p.id || makeId('l3'),
      layer: 'L3',
      key: p.key || p.type || 'general',
      value: p.value || p.content || '',
      content: String(p.content || p.value || '').slice(0, 500),
      importance: p.importance || 0.5,
      confidence: p.confidence || 0.8,
      createdAt: p.createdAt || now(),
      updatedAt: p.updatedAt || now(),
      at: p.updatedAt || p.createdAt || now(),
      source: p.source || 'migrated_l3'
    });
  }

  saveUnified(merged);
  return merged;
}

function trimByLayer(unified) {
  const l1 = unified.filter((x) => x.layer === 'L1').sort((a, b) => (a.at || 0) - (b.at || 0));
  const l2 = unified.filter((x) => x.layer === 'L2').sort((a, b) => (a.at || a.updatedAt || 0) - (b.at || b.updatedAt || 0));
  const l3 = unified.filter((x) => x.layer === 'L3');

  // L1 cap 100 most recent
  const l1Trimmed = l1.slice(-LIMITS.L1);
  // L2 cap 50 most recent
  const l2Trimmed = l2.slice(-LIMITS.L2);
  // L3 cap 100 by importance+confidence
  const l3Sorted = [...l3].sort((a, b) => (b.importance + b.confidence) - (a.importance + a.confidence));
  const l3Trimmed = l3Sorted.slice(0, LIMITS.L3);

  return [...l1Trimmed, ...l2Trimmed, ...l3Trimmed].sort((a, b) => (a.at || 0) - (b.at || 0));
}

function addToUnified(entry) {
  if (!entry) return getUnifiedRaw();
  if (isSensitive(entry)) {
    console.warn('[MemoryV2] Refusing to store sensitive entry');
    return getUnifiedRaw();
  }
  const unified = migrateLegacyIfNeeded();
  // Conflict resolution for L3 by key
  if (entry.layer === 'L3' && entry.key) {
    const idx = unified.findIndex((x) => x.layer === 'L3' && x.key === entry.key);
    if (idx >= 0) {
      const existing = unified[idx];
      if ((entry.confidence || 0) >= (existing.confidence || 0) || (entry.updatedAt || entry.at || 0) > (existing.updatedAt || existing.at || 0)) {
        unified[idx] = entry;
      }
      const trimmed = trimByLayer(unified);
      return saveUnified(trimmed);
    }
  }
  // Update if same id exists (for L2 tasks)
  if (entry.id) {
    const idx = unified.findIndex((x) => x.id === entry.id);
    if (idx >= 0) {
      unified[idx] = { ...unified[idx], ...entry, updatedAt: now(), at: now() };
      const trimmed = trimByLayer(unified);
      return saveUnified(trimmed);
    }
  }
  unified.push(entry);
  const trimmed = trimByLayer(unified);
  return saveUnified(trimmed);
}

/* ───────────────────── PUBLIC API — ALWAYS-ON UNIFIED ───────────────────── */

export const MEMORY_ENABLED = true;
export const MEMORY_CONFIG = Object.freeze({
  enabled: true,
  alwaysOn: true,
  autoSelect: true,
  noToggle: true,
  unified: true,
  layers: ['L1', 'L2', 'L3'],
  caps: { ...LIMITS },
  version: 6
});

export function isMemoryEnabled() {
  // Always-on, no user toggle — per user correction
  return true;
}

export function getMemoryConfig() {
  return { ...MEMORY_CONFIG, updatedAt: now() };
}

export function getUnifiedMemory() {
  return migrateLegacyIfNeeded();
}

export function getMemory() {
  return getUnifiedMemory();
}

export function getMemoryStats() {
  const all = getUnifiedMemory();
  return {
    total: all.length,
    l1: all.filter((x) => x.layer === 'L1').length,
    l2: all.filter((x) => x.layer === 'L2').length,
    l3: all.filter((x) => x.layer === 'L3').length,
    caps: { ...LIMITS },
    alwaysOn: true,
    autoSelect: true
  };
}

/**
 * AI auto-selects layer based on query/content.
 * User correction: هر سشن هر سه روشن باشد تا به اختیار هوش مصنوعی ببینه کدام را میخواد
 */
export function autoSelectLayerForQuery(query, context = {}) {
  const text = String(query || context.lastMessage || '').toLowerCase();
  const layers = new Set();

  // L3: preferences, risk, language
  if (/ریسک|risk|زبان|language|ترجیح|prefer|محافظه|تهاجمی/.test(text)) layers.add('L3');
  // L2: tasks, goals, plans
  if (/هدف|goal|برنامه|plan|وظیفه|task|سود|profit|سرمایه|investment/.test(text)) layers.add('L2');
  // L1: messages, conversation
  if (/پیام|message|گفتگو|conversation|قبلی|previous|همون/.test(text)) layers.add('L1');

  // If no hint, use all — AI decides
  if (layers.size === 0) {
    layers.add('L1');
    layers.add('L2');
    layers.add('L3');
  }

  return [...layers];
}

export function autoSelectLayer(entry) {
  if (!entry || typeof entry !== 'object') return 'L1';
  if (entry.layer && ['L1', 'L2', 'L3'].includes(entry.layer)) return entry.layer;
  // Auto-detect
  if (entry.key || entry.type === 'preference' || entry.type === 'goal' || entry.riskTolerance || entry.language) {
    if (entry.slots || entry.status || entry.type === 'task') return 'L2';
    // preference detection
    if (entry.key || entry.type === 'preference' || /riskTolerance|language/.test(JSON.stringify(entry))) return 'L3';
  }
  if (entry.type === 'task' || entry.goal || entry.status || entry.slots) return 'L2';
  if (entry.key || entry.type === 'preference') return 'L3';
  return 'L1';
}

export function addMemory(entry) {
  if (!entry) return getUnifiedMemory();
  const layer = autoSelectLayer(entry);
  const base = {
    id: entry.id || makeId(layer.toLowerCase()),
    layer,
    at: now(),
    updatedAt: now(),
    importance: entry.importance || 0.5,
    confidence: entry.confidence || 0.8,
    source: entry.source || 'ai_auto'
  };

  if (layer === 'L1') {
    return addToUnified({
      ...base,
      type: 'message',
      role: entry.role || 'user',
      content: String(entry.content || entry.text || '').slice(0, 2000),
      kind: entry.kind || null,
      intentType: entry.intentType || null,
      timestamp: entry.timestamp || now()
    });
  }
  if (layer === 'L2') {
    return addToUnified({
      ...base,
      type: entry.type || entry.intent || 'task',
      goal: String(entry.goal || entry.content || '').slice(0, 500),
      status: entry.status || 'pending',
      slots: entry.slots || entry.collectedSlots || {},
      result: entry.result ? String(entry.result).slice(0, 1000) : null,
      createdAt: entry.createdAt || now()
    });
  }
  // L3
  return addToUnified({
    ...base,
    key: entry.key || entry.type || 'general',
    value: entry.value || entry.content || '',
    content: String(entry.content || entry.value || '').slice(0, 500),
    createdAt: entry.createdAt || now()
  });
}

export function searchMemory({ query = '', topK = 8, type = null, layer = null } = {}) {
  const all = getUnifiedMemory();
  let filtered = all;

  if (layer) {
    const layers = Array.isArray(layer) ? layer : [layer];
    filtered = filtered.filter((m) => layers.includes(m.layer));
  } else {
    // AI auto-selects layers based on query
    const autoLayers = autoSelectLayerForQuery(query);
    // If query is empty, search all
    if (query) {
      filtered = filtered.filter((m) => autoLayers.includes(m.layer));
    }
  }

  if (!query) {
    return filtered
      .sort((a, b) => (b.importance + b.confidence) - (a.importance + a.confidence))
      .slice(0, topK);
  }

  const q = String(query).toLowerCase();
  const scored = filtered.map((mem) => {
    let score = 0;
    const content = String(mem.content || mem.value || mem.goal || '').toLowerCase();

    if (content.includes(q)) score += 3;
    if (type && mem.type === type) score += 1;

    const qWords = q.split(/\s+/).filter((w) => w.length > 2);
    const cWords = content.split(/\s+/);
    const overlap = qWords.filter((w) => cWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
    score += overlap * 0.5;

    score += (mem.importance || 0) * 0.5;
    score += (mem.confidence || 0) * 0.3;

    const ageDays = (Date.now() - (mem.at || mem.updatedAt || Date.now())) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) score += (7 - ageDays) * 0.1;

    return { mem, score };
  });

  return scored
    .filter((s) => s.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.mem);
}

/* ───────────────────── L1 — Message Memory (unified backed) ───────────────────── */

export function getL1Messages() {
  const all = migrateLegacyIfNeeded();
  return all.filter((x) => x.layer === 'L1').sort((a, b) => (a.at || 0) - (b.at || 0));
}

export function addL1Message(msg) {
  if (!msg) return getL1Messages();
  if (isSensitive(msg)) {
    console.warn('[MemoryV2] Refusing to store sensitive message');
    return getL1Messages();
  }
  const entry = {
    id: msg.id || makeId('l1'),
    layer: 'L1',
    type: 'message',
    role: msg.role || 'user',
    content: String(msg.content || msg.text || '').slice(0, 2000),
    kind: msg.kind || null,
    intentType: msg.intentType || null,
    timestamp: msg.timestamp || now(),
    at: msg.timestamp || msg.at || now(),
    importance: 0.5,
    confidence: 0.8,
    source: 'user'
  };
  addToUnified(entry);
  // Keep legacy key in sync for probe that reads directly
  const legacy = safeRead(KEYS.L1, []);
  legacy.push({ id: entry.id, role: entry.role, content: entry.content, kind: entry.kind, intentType: entry.intentType, timestamp: entry.timestamp, at: entry.at });
  safeWrite(KEYS.L1, legacy.slice(-LIMITS.L1));
  return getL1Messages();
}

export function clearL1() {
  const all = getUnifiedRaw().filter((x) => x.layer !== 'L1');
  saveUnified(all);
  safeWrite(KEYS.L1, []);
}

/* ───────────────────── L2 — Task Memory ───────────────────── */

export function getL2Tasks() {
  const all = migrateLegacyIfNeeded();
  return all.filter((x) => x.layer === 'L2').sort((a, b) => (a.at || a.updatedAt || 0) - (b.at || b.updatedAt || 0));
}

export function addL2Task(task) {
  if (!task) return getL2Tasks();
  if (isSensitive(task)) {
    console.warn('[MemoryV2] Refusing to store sensitive task');
    return getL2Tasks();
  }
  const entry = {
    id: task.id || makeId('l2'),
    layer: 'L2',
    type: task.type || task.intent || 'GENERAL',
    goal: String(task.goal || '').slice(0, 500),
    status: task.status || 'pending',
    slots: task.slots || task.collectedSlots || {},
    result: task.result ? String(task.result).slice(0, 1000) : null,
    createdAt: task.createdAt || now(),
    updatedAt: now(),
    at: now(),
    importance: 0.7,
    confidence: 0.8,
    source: 'task'
  };
  addToUnified(entry);
  const legacy = safeRead(KEYS.L2, []);
  const idx = legacy.findIndex((t) => t.id === entry.id);
  if (idx >= 0) legacy[idx] = { ...legacy[idx], ...entry };
  else legacy.push(entry);
  safeWrite(KEYS.L2, legacy.slice(-LIMITS.L2));
  return getL2Tasks();
}

export function updateL2Task(id, updates) {
  const all = getUnifiedRaw();
  const idx = all.findIndex((t) => t.id === id && t.layer === 'L2');
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...updates, updatedAt: now(), at: now() };
    saveUnified(all);
    // legacy sync
    const legacy = safeRead(KEYS.L2, []);
    const lIdx = legacy.findIndex((t) => t.id === id);
    if (lIdx >= 0) {
      legacy[lIdx] = { ...legacy[lIdx], ...updates, updatedAt: now() };
      safeWrite(KEYS.L2, legacy);
    }
    return all[idx];
  }
  // fallback to legacy only
  const legacy = safeRead(KEYS.L2, []);
  const lIdx = legacy.findIndex((t) => t.id === id);
  if (lIdx < 0) return null;
  legacy[lIdx] = { ...legacy[lIdx], ...updates, updatedAt: now() };
  safeWrite(KEYS.L2, legacy);
  return legacy[lIdx];
}

export function getActiveL2Task() {
  const tasks = getL2Tasks();
  return tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').slice(-1)[0] || null;
}

export function clearL2() {
  const all = getUnifiedRaw().filter((x) => x.layer !== 'L2');
  saveUnified(all);
  safeWrite(KEYS.L2, []);
}

/* ───────────────────── L3 — Preference Memory ───────────────────── */

export function getL3Preferences() {
  const all = migrateLegacyIfNeeded();
  return all.filter((x) => x.layer === 'L3').sort((a, b) => (b.importance + b.confidence) - (a.importance + a.confidence));
}

export function addL3Preference(pref) {
  if (!pref) return getL3Preferences();
  if (isSensitive(pref)) {
    console.warn('[MemoryV2] Refusing to store sensitive preference');
    return getL3Preferences();
  }
  const entry = {
    id: pref.id || makeId('l3'),
    layer: 'L3',
    key: pref.key || pref.type || 'general',
    value: pref.value || pref.content || '',
    content: String(pref.content || pref.value || '').slice(0, 500),
    importance: pref.importance || 0.5,
    confidence: pref.confidence || 0.8,
    createdAt: pref.createdAt || now(),
    updatedAt: now(),
    at: now(),
    source: pref.source || 'user'
  };
  addToUnified(entry);
  const legacy = safeRead(KEYS.L3, []);
  const existingIdx = legacy.findIndex((p) => p.key === entry.key);
  if (existingIdx >= 0) {
    const existing = legacy[existingIdx];
    if (entry.confidence >= existing.confidence || entry.updatedAt > existing.updatedAt) {
      legacy[existingIdx] = entry;
    }
  } else {
    legacy.push(entry);
  }
  legacy.sort((a, b) => (b.importance + b.confidence) - (a.importance + a.confidence));
  safeWrite(KEYS.L3, legacy.slice(0, LIMITS.L3));
  return getL3Preferences();
}

export function extractL3FromMessage(message) {
  const text = String(message || '').toLowerCase();
  const prefs = [];

  if (/ریسک.*متوسط|medium.*risk/i.test(text)) {
    prefs.push({ key: 'riskTolerance', value: 'medium', content: 'ریسک متوسط', importance: 0.8, confidence: 0.9 });
  }
  if (/ریسک.*کم|low.*risk|محافظه/i.test(text)) {
    prefs.push({ key: 'riskTolerance', value: 'low', content: 'ریسک کم', importance: 0.8, confidence: 0.9 });
  }
  if (/ریسک.*زیاد|high.*risk|تهاجمی/i.test(text)) {
    prefs.push({ key: 'riskTolerance', value: 'high', content: 'ریسک زیاد', importance: 0.8, confidence: 0.9 });
  }
  if (/زبان.*فارسی|persian|farsi/i.test(text)) {
    prefs.push({ key: 'language', value: 'fa', content: 'زبان فارسی', importance: 0.7, confidence: 0.9 });
  }
  if (/language.*english|english/i.test(text)) {
    prefs.push({ key: 'language', value: 'en', content: 'English language', importance: 0.7, confidence: 0.9 });
  }

  return prefs;
}

export function clearL3() {
  const all = getUnifiedRaw().filter((x) => x.layer !== 'L3');
  saveUnified(all);
  safeWrite(KEYS.L3, []);
}

export function getAllMemoryV2() {
  const all = migrateLegacyIfNeeded();
  return {
    l1: all.filter((x) => x.layer === 'L1'),
    l2: all.filter((x) => x.layer === 'L2'),
    l3: all.filter((x) => x.layer === 'L3'),
    unified: all,
    all: all,
    meta: { version: 6, updatedAt: now(), unified: true, alwaysOn: true, autoSelect: true, noToggle: true },
    config: { ...MEMORY_CONFIG },
    stats: getMemoryStats()
  };
}

export function clearAllMemoryV2() {
  saveUnified([]);
  safeWrite(KEYS.L1, []);
  safeWrite(KEYS.L2, []);
  safeWrite(KEYS.L3, []);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(KEYS.META);
      localStorage.removeItem(KEYS.UNIFIED);
    }
  } catch {}
}
