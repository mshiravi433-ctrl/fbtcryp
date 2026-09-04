/**
 * FBT AI / Intent OS — UPGRADE 6
 * Memory V2 — Three levels: L1 Message Memory, L2 Task Memory, L3 User Preference Memory
 * Spec §12
 * Sensitive financial info should NOT be stored without permission/policy
 */

const KEYS = {
  L1: 'fbt.memory.v6.l1.messages',
  L2: 'fbt.memory.v6.l2.tasks',
  L3: 'fbt.memory.v6.l3.preferences',
  META: 'fbt.memory.v6.meta'
};

const LIMITS = { L1: 100, L2: 50, L3: 100 };

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
  return false;
}

/**
 * L1 — Message Memory: messages of current conversation
 */
export function getL1Messages() {
  return safeRead(KEYS.L1, []);
}

export function addL1Message(msg) {
  if (!msg) return getL1Messages();
  if (isSensitive(msg)) {
    console.warn('[MemoryV2] Refusing to store sensitive message');
    return getL1Messages();
  }
  const list = getL1Messages();
  const entry = {
    id: msg.id || makeId('l1'),
    role: msg.role || 'user',
    content: String(msg.content || msg.text || '').slice(0, 2000),
    kind: msg.kind || null,
    intentType: msg.intentType || null,
    timestamp: msg.timestamp || now(),
    at: now()
  };
  list.push(entry);
  const trimmed = list.slice(-LIMITS.L1);
  safeWrite(KEYS.L1, trimmed);
  return trimmed;
}

export function clearL1() {
  safeWrite(KEYS.L1, []);
}

/**
 * L2 — Task Memory: info about current task
 */
export function getL2Tasks() {
  return safeRead(KEYS.L2, []);
}

export function addL2Task(task) {
  if (!task) return getL2Tasks();
  if (isSensitive(task)) {
    console.warn('[MemoryV2] Refusing to store sensitive task');
    return getL2Tasks();
  }
  const list = getL2Tasks();
  const entry = {
    id: task.id || makeId('l2'),
    type: task.type || task.intent || 'GENERAL',
    goal: String(task.goal || '').slice(0, 500),
    status: task.status || 'pending',
    slots: task.slots || task.collectedSlots || {},
    result: task.result ? String(task.result).slice(0, 1000) : null,
    createdAt: task.createdAt || now(),
    updatedAt: now()
  };
  // Update if exists
  const idx = list.findIndex((t) => t.id === entry.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
  const trimmed = list.slice(-LIMITS.L2);
  safeWrite(KEYS.L2, trimmed);
  return trimmed;
}

export function updateL2Task(id, updates) {
  const list = getL2Tasks();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...updates, updatedAt: now() };
  safeWrite(KEYS.L2, list);
  return list[idx];
}

export function getActiveL2Task() {
  const tasks = getL2Tasks();
  return tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').slice(-1)[0] || null;
}

export function clearL2() {
  safeWrite(KEYS.L2, []);
}

/**
 * L3 — User Preference Memory: persistent user preferences
 */
export function getL3Preferences() {
  return safeRead(KEYS.L3, []);
}

export function addL3Preference(pref) {
  if (!pref) return getL3Preferences();
  if (isSensitive(pref)) {
    console.warn('[MemoryV2] Refusing to store sensitive preference');
    return getL3Preferences();
  }
  const list = getL3Preferences();
  const entry = {
    id: pref.id || makeId('l3'),
    key: pref.key || pref.type || 'general',
    value: pref.value || pref.content || '',
    content: String(pref.content || pref.value || '').slice(0, 500),
    importance: pref.importance || 0.5,
    confidence: pref.confidence || 0.8,
    createdAt: pref.createdAt || now(),
    updatedAt: now(),
    source: pref.source || 'user'
  };

  // Conflict resolution: newer/higher confidence wins
  const existingIdx = list.findIndex((p) => p.key === entry.key);
  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    if (entry.confidence >= existing.confidence || entry.updatedAt > existing.updatedAt) {
      list[existingIdx] = entry;
    }
  } else {
    list.push(entry);
  }

  // Sort by importance
  list.sort((a, b) => (b.importance + b.confidence) - (a.importance + a.confidence));
  const trimmed = list.slice(0, LIMITS.L3);
  safeWrite(KEYS.L3, trimmed);
  return trimmed;
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
  safeWrite(KEYS.L3, []);
}

export function getAllMemoryV2() {
  return {
    l1: getL1Messages(),
    l2: getL2Tasks(),
    l3: getL3Preferences(),
    meta: { version: 6, updatedAt: now() }
  };
}

export function clearAllMemoryV2() {
  clearL1();
  clearL2();
  clearL3();
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEYS.META);
  } catch {}
}
