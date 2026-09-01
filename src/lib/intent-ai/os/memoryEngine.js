/**
 * FBT INTENT OS — Memory System
 * ---------------------------------------------------------------------------
 * Spec §10 + §11 + §12 + §30 + §31
 * Three types: Working, Session, Long-Term
 * Retrieval-based, not full history in prompt
 * Intent-driven memory, conflict resolution
 */

export const MEMORY_SCHEMA = 'fbt.ai-memory.v1';

const MEMORY_KEY_WORKING = 'fbt.memory.working.v1';
const MEMORY_KEY_SESSION = 'fbt.memory.session.v1';
const MEMORY_KEY_LONG = 'fbt.memory.long.v1';
const MEMORY_KEY_ACTION = 'fbt.memory.actions.v1';

const MAX_WORKING = 20;
const MAX_SESSION = 50;
const MAX_LONG = 200;
const MAX_ACTIONS = 100;

/**
 * Memory types (Spec §11)
 */
export const MEMORY_TYPES = Object.freeze([
  'preference',
  'goal',
  'decision',
  'action',
  'conversation',
  'behavior'
]);

/**
 * Create memory entry
 */
export function createMemory({
  userId = 'anon',
  type = 'conversation',
  content = '',
  importance = 0.5,
  confidence = 0.8,
  expiresAt = null,
  metadata = {}
} = {}) {
  if (!MEMORY_TYPES.includes(type)) type = 'conversation';
  
  const now = new Date();
  return {
    id: `mem_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    userId: String(userId),
    type,
    content: String(content).slice(0, 500),
    importance: Math.max(0, Math.min(1, Number(importance) || 0.5)),
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.8)),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    metadata,
    schema: MEMORY_SCHEMA
  };
}

function safeRead(key, fallback = []) {
  try {
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
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Working Memory: current conversation (Spec §10)
export function getWorkingMemory() {
  return safeRead(MEMORY_KEY_WORKING, []);
}

export function addWorkingMemory(entry) {
  const list = getWorkingMemory();
  list.push(entry);
  // Keep last N
  const trimmed = list.slice(-MAX_WORKING);
  safeWrite(MEMORY_KEY_WORKING, trimmed);
  return trimmed;
}

export function clearWorkingMemory() {
  safeWrite(MEMORY_KEY_WORKING, []);
}

// Session Memory: tasks in this session
export function getSessionMemory() {
  return safeRead(MEMORY_KEY_SESSION, []);
}

export function addSessionMemory(entry) {
  const list = getSessionMemory();
  list.push(entry);
  const trimmed = list.slice(-MAX_SESSION);
  safeWrite(MEMORY_KEY_SESSION, trimmed);
  return trimmed;
}

// Long-Term Memory: preferences, goals, decisions, behaviors
export function getLongTermMemory() {
  return safeRead(MEMORY_KEY_LONG, []);
}

export function addLongTermMemory(entry) {
  const list = getLongTermMemory();
  
  // Conflict resolution (Spec §12): newer/higher confidence wins
  const existingIdx = list.findIndex(m => 
    m.type === entry.type && 
    m.content.toLowerCase() === entry.content.toLowerCase()
  );
  
  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    const existingTime = new Date(existing.updatedAt).getTime();
    const newTime = new Date(entry.updatedAt).getTime();
    
    // Newer or higher confidence wins
    if (newTime > existingTime || entry.confidence > existing.confidence) {
      list[existingIdx] = entry;
    } else {
      // Keep existing but update timestamp
      return list;
    }
  } else {
    list.push(entry);
  }
  
  // Sort by importance + recency
  list.sort((a, b) => {
    const scoreA = a.importance * 0.7 + a.confidence * 0.3;
    const scoreB = b.importance * 0.7 + b.confidence * 0.3;
    return scoreB - scoreA;
  });
  
  const trimmed = list.slice(0, MAX_LONG);
  safeWrite(MEMORY_KEY_LONG, trimmed);
  return trimmed;
}

export function removeLongTermMemory(id) {
  const list = getLongTermMemory();
  const filtered = list.filter(m => m.id !== id);
  safeWrite(MEMORY_KEY_LONG, filtered);
  return filtered;
}

/**
 * Memory Retrieval — intent-driven, topK (Spec §30)
 * Only relevant memory enters context
 */
export function searchMemory({ userId = null, query = '', topK = 8, type = null } = {}) {
  const all = [
    ...getWorkingMemory(),
    ...getSessionMemory(),
    ...getLongTermMemory()
  ];
  
  if (!query) {
    // Return most important recent
    return all
      .sort((a, b) => (b.importance + b.confidence) - (a.importance + a.confidence))
      .slice(0, topK);
  }
  
  const q = String(query).toLowerCase();
  const scored = all.map(mem => {
    let score = 0;
    const content = String(mem.content).toLowerCase();
    
    // Exact match
    if (content.includes(q)) score += 3;
    
    // Type filter
    if (type && mem.type === type) score += 1;
    
    // Word overlap
    const qWords = q.split(/\s+/).filter(w => w.length > 2);
    const cWords = content.split(/\s+/);
    const overlap = qWords.filter(w => cWords.some(cw => cw.includes(w) || w.includes(cw))).length;
    score += overlap * 0.5;
    
    // Importance boost
    score += mem.importance * 0.5;
    score += mem.confidence * 0.3;
    
    // Recency boost (last 7 days)
    const ageDays = (Date.now() - new Date(mem.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) score += (7 - ageDays) * 0.1;
    
    return { mem, score };
  });
  
  return scored
    .filter(s => s.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.mem);
}

/**
 * Preference extraction from conversation
 */
export function extractPreferenceFromMessage(message) {
  const text = String(message || '').toLowerCase();
  
  if (/ریسک.*متوسط|medium.*risk/i.test(text)) {
    return createMemory({
      type: 'preference',
      content: 'ریسک متوسط را ترجیح می‌دهم',
      importance: 0.8,
      confidence: 0.9,
      metadata: { key: 'riskTolerance', value: 'medium' }
    });
  }
  if (/ریسک.*کم|low.*risk|محافظه/i.test(text)) {
    return createMemory({
      type: 'preference',
      content: 'ریسک کم را ترجیح می‌دهم',
      importance: 0.8,
      confidence: 0.9,
      metadata: { key: 'riskTolerance', value: 'low' }
    });
  }
  if (/ریسک.*زیاد|high.*risk/i.test(text)) {
    return createMemory({
      type: 'preference',
      content: 'ریسک زیاد را می‌پذیرم',
      importance: 0.8,
      confidence: 0.9,
      metadata: { key: 'riskTolerance', value: 'high' }
    });
  }
  
  return null;
}

// Learning (Spec §31): Interaction → Outcome → Evaluation → Memory → Preference
export function learnFromInteraction({ interaction, outcome, evaluation }) {
  if (!interaction || !outcome) return null;
  
  const success = outcome.success === true || outcome.status === 'CONFIRMED';
  const importance = success ? 0.7 : 0.5;
  
  const mem = createMemory({
    type: outcome.type === 'preference' ? 'preference' : 'behavior',
    content: `${interaction} → ${outcome.result || outcome.status}`,
    importance,
    confidence: evaluation?.confidence || 0.7,
    metadata: {
      interaction,
      outcome: outcome.status,
      success,
      learnedAt: new Date().toISOString()
    }
  });
  
  if (mem.type === 'preference' || mem.type === 'goal') {
    return addLongTermMemory(mem);
  } else {
    return addSessionMemory(mem);
  }
}

// Cleanup expired
export function cleanupExpired() {
  const now = Date.now();
  const filterExpired = (list) => list.filter(m => {
    if (!m.expiresAt) return true;
    return new Date(m.expiresAt).getTime() > now;
  });
  
  safeWrite(MEMORY_KEY_WORKING, filterExpired(getWorkingMemory()));
  safeWrite(MEMORY_KEY_SESSION, filterExpired(getSessionMemory()));
  safeWrite(MEMORY_KEY_LONG, filterExpired(getLongTermMemory()));
}

export function getAllMemory() {
  return {
    working: getWorkingMemory(),
    session: getSessionMemory(),
    longTerm: getLongTermMemory(),
    actions: safeRead(MEMORY_KEY_ACTION, [])
  };
}
