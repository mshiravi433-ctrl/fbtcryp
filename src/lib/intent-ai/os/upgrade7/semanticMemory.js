/**
 * FBT INTENT OS — UPGRADE 7 · Semantic Memory
 * ---------------------------------------------------------------------------
 * Spec §18 (goal memory), §22 (context compression), §23 (facts/decisions/
 * preferences/goals/tasks instead of raw transcript), §24 (contradiction
 * detection), §25 (correction learning without resetting the conversation).
 *
 * `memoryEngine` (working/session/long-term) and `upgrade6/memoryV2` (L1/L2/L3)
 * both stay. This adds the layer neither has: meaning extracted from the text,
 * so a 200-message conversation can enter a prompt as a paragraph.
 */

export const SEMANTIC_MEMORY_SCHEMA = 'fbt.semantic-memory.v7';
const STORE_KEY = 'fbt.upgrade7.semantic.v1';

export const FACT_KIND = Object.freeze({
  FACT: 'fact', DECISION: 'decision', PREFERENCE: 'preference',
  GOAL: 'goal', COMPLETED_TASK: 'completed_task', OPEN_TASK: 'open_task', ANSWER: 'answer'
});

const MAX_PER_KIND = 40;

let mem = null;

function blank() {
  return { schema: SEMANTIC_MEMORY_SCHEMA, entries: [], goals: {}, updatedAt: Date.now() };
}

function load() {
  if (mem) return mem;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) { mem = parsed; return mem; }
      }
    }
  } catch { /* private mode */ }
  mem = blank();
  return mem;
}

function persist() {
  if (!mem) return;
  mem.updatedAt = Date.now();
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(mem));
  } catch { /* memory copy is still authoritative for this session */ }
}

function eid() { return `sem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }

/* -------------------------------------------------------------------------- */
/*  WRITE                                                                       */
/* -------------------------------------------------------------------------- */

export function remember({ kind, key = null, value, text = null, confidence = 0.8, source = null, conversationId = 'default' } = {}) {
  const store = load();
  const entry = {
    id: eid(), kind, key, value, text: text ? String(text).slice(0, 400) : null,
    confidence, source, conversationId, createdAt: Date.now(), updatedAt: Date.now(), supersedes: null
  };

  // Same key + same kind = an UPDATE, not a duplicate (§24: new value wins).
  if (key) {
    const prev = store.entries.find((e) => e.kind === kind && e.key === key && e.conversationId === conversationId);
    if (prev) {
      entry.supersedes = prev.id;
      entry.previousValue = prev.value;
      store.entries = store.entries.filter((e) => e.id !== prev.id);
    }
  }

  store.entries.push(entry);

  // Trim per-kind so one noisy category cannot evict everything else.
  const ofKind = store.entries.filter((e) => e.kind === kind);
  if (ofKind.length > MAX_PER_KIND) {
    const drop = new Set(ofKind.slice(0, ofKind.length - MAX_PER_KIND).map((e) => e.id));
    store.entries = store.entries.filter((e) => !drop.has(e.id));
  }
  persist();
  return entry;
}

export function recall({ kind = null, key = null, conversationId = null, limit = 50 } = {}) {
  const store = load();
  return store.entries
    .filter((e) => (!kind || e.kind === kind) && (!key || e.key === key) && (!conversationId || e.conversationId === conversationId))
    .slice(-limit)
    .reverse();
}

export function forgetAll() { mem = blank(); persist(); }

/* -------------------------------------------------------------------------- */
/*  §18 GOAL MEMORY                                                             */
/* -------------------------------------------------------------------------- */

export function setGoalMemory(conversationId, patch = {}) {
  const store = load();
  const prev = store.goals[conversationId] || {};
  const next = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) continue;
    if (k === 'risk' && v && v.explicit === false) continue; // don't overwrite with a non-answer
    next[k] = v;
  }
  next.updatedAt = Date.now();
  store.goals[conversationId] = next;
  persist();
  return next;
}

export function getGoalMemory(conversationId) {
  return load().goals[conversationId] || {};
}

export function clearGoalMemory(conversationId) {
  const store = load();
  delete store.goals[conversationId];
  persist();
}

/* -------------------------------------------------------------------------- */
/*  §24 CONTRADICTION DETECTION                                                 */
/* -------------------------------------------------------------------------- */

const CONTRADICTION_WEIGHT = { risk: 'high', goal: 'high', timeframe: 'medium', capitalSource: 'medium', targetReturn: 'low' };

function sameValue(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (a.level && b.level) return a.level === b.level;
    if (a.value != null && b.value != null) return a.value === b.value && a.unit === b.unit;
  }
  return false;
}

function describe(slot, value, fa) {
  if (value == null) return fa ? 'نامشخص' : 'unset';
  if (typeof value === 'object') {
    if (value.level) return String(value.level);
    if (value.value != null) return `${value.value} ${value.unit || ''}`.trim();
    if (value.pct != null) return `${value.pct}%`;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

/**
 * The user said "low risk" earlier and "high risk" now. That is an UPDATE — the
 * newest statement wins. But when the slot matters enough that acting on the
 * wrong one costs money, we confirm in one short sentence instead of guessing.
 */
export function detectContradiction({ conversationId = 'default', slot, newValue, locale = 'fa' } = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const prevMem = getGoalMemory(conversationId);
  const prevValue = prevMem?.[slot];
  if (prevValue == null || newValue == null) return { contradiction: false, isUpdate: Boolean(newValue != null), previousValue: prevValue ?? null };
  if (sameValue(prevValue, newValue)) return { contradiction: false, isUpdate: false, previousValue: prevValue };

  const severity = CONTRADICTION_WEIGHT[slot] || 'low';
  const prevText = describe(slot, prevValue, fa);
  const nextText = describe(slot, newValue, fa);

  return {
    contradiction: true,
    isUpdate: true,
    slot,
    severity,
    previousValue: prevValue,
    newValue,
    // Only a high-severity change earns a question; everything else is applied.
    needsConfirmation: severity === 'high',
    question: severity === 'high'
      ? (fa
        ? `${slotLabelFa(slot)} قبلی شما «${prevText}» بود؛ برای این درخواست «${nextText}» در نظر بگیرم؟`
        : `Your previous ${slot} was "${prevText}" — should I use "${nextText}" for this request?`)
      : null,
    autoApplied: severity !== 'high'
  };
}

function slotLabelFa(slot) {
  return ({ risk: 'ریسک', goal: 'هدف', timeframe: 'بازه زمانی', capitalSource: 'منبع سرمایه', targetReturn: 'هدف سود' })[slot] || slot;
}

/* -------------------------------------------------------------------------- */
/*  §25 USER CORRECTION LEARNING                                                */
/* -------------------------------------------------------------------------- */

const CORRECTION_RE = /(نه\s*،?\s*منظورم|منظورم\s*این\s*نبود|اشتباه\s*(فهمیدی|شد)|نه\s*اینو\s*نگفتم|not\s*what\s*i\s*meant|i\s*meant|no,?\s*i\s*said|that.?s\s*wrong|غلط\s*فهمیدی)/i;

/**
 * A correction re-interprets the CURRENT intent. It never resets the
 * conversation — that was the whole complaint the spec is written against.
 */
export function applyCorrection({ message, conversationId = 'default', currentIntent = null, currentDeepIntent = null, locale = 'fa' } = {}) {
  const text = String(message || '');
  if (!CORRECTION_RE.test(text)) return { isCorrection: false };

  const previousInterpretation = {
    intent: currentIntent?.type || currentIntent?.primaryIntent || null,
    goal: currentDeepIntent?.goal || null,
    assets: currentDeepIntent?.assets || [],
    action: currentDeepIntent?.action || null
  };

  // What the user is correcting TO — read from the same sentence when present.
  const after = text.replace(CORRECTION_RE, ' ').trim();

  remember({
    kind: FACT_KIND.DECISION,
    key: `correction:${Date.now()}`,
    value: { from: previousInterpretation, correctedWith: after.slice(0, 200) },
    text: text.slice(0, 200),
    conversationId,
    confidence: 0.95,
    source: 'user_correction'
  });

  return {
    isCorrection: true,
    conversationReset: false,
    previousInterpretation,
    correctionText: after,
    // The caller re-runs understanding on `correctionText` and PATCHES the
    // active intent; it does not start a new one.
    action: 'reinterpret_current_intent',
    acknowledgement: String(locale).startsWith('fa')
      ? 'باشه، برداشتم را اصلاح کردم.'
      : 'Got it — I have corrected my interpretation.'
  };
}

/* -------------------------------------------------------------------------- */
/*  §23 SEMANTIC EXTRACTION                                                     */
/* -------------------------------------------------------------------------- */

const PREFERENCE_RE = [
  [/(ترجیح\s*می\s*دم|دوست\s*دارم|prefer|i\s*like)\s*(.{3,60})/i, 'stated_preference'],
  [/(همیشه|always)\s*(.{3,60})/i, 'standing_rule'],
  [/(هیچ\s*وقت|هرگز|never)\s*(.{3,60})/i, 'prohibition']
];

export function extractSemantics({ message = '', aiResponse = null, deepIntent = null, execution = null, conversationId = 'default' } = {}) {
  const out = [];
  const text = String(message || '');

  if (deepIntent?.goal) {
    out.push(remember({ kind: FACT_KIND.GOAL, key: 'goal', value: deepIntent.goal, text, conversationId, source: 'deep-intent' }));
  }
  if (deepIntent?.timeframe) {
    out.push(remember({ kind: FACT_KIND.FACT, key: 'timeframe', value: deepIntent.timeframe, text, conversationId, source: 'deep-intent' }));
  }
  if (deepIntent?.risk?.explicit) {
    out.push(remember({ kind: FACT_KIND.PREFERENCE, key: 'risk', value: deepIntent.risk, text, conversationId, source: 'deep-intent' }));
  }
  for (const [re, kind] of PREFERENCE_RE) {
    const m = text.match(re);
    if (m) out.push(remember({ kind: FACT_KIND.PREFERENCE, key: `${kind}:${m[2].slice(0, 24)}`, value: m[2].trim(), text, conversationId, source: 'nlp' }));
  }
  if (execution?.ok && execution?.route) {
    out.push(remember({ kind: FACT_KIND.COMPLETED_TASK, value: { route: execution.route, intent: deepIntent?.what || null }, conversationId, source: 'execution' }));
  }
  if (execution?.planReady || execution?.requiresConfirmation) {
    out.push(remember({ kind: FACT_KIND.OPEN_TASK, value: { intent: deepIntent?.what || null, awaiting: 'confirmation' }, conversationId, source: 'execution' }));
  }
  return out;
}

/** §21 — an answer is bound to the question that asked for it. */
export function bindAnswer({ questionId, intentId, slot, expectedType, value, conversationId = 'default' } = {}) {
  return remember({
    kind: FACT_KIND.ANSWER,
    key: `answer:${slot}`,
    value: { questionId, intentId, slot, expectedType, value, timestamp: Date.now() },
    conversationId,
    confidence: 1,
    source: 'answer-binding'
  });
}

export function getBoundAnswer(slot, conversationId = 'default') {
  return recall({ kind: FACT_KIND.ANSWER, key: `answer:${slot}`, conversationId, limit: 1 })[0] || null;
}

/* -------------------------------------------------------------------------- */
/*  §22 CONTEXT COMPRESSION                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Turn a long conversation into: recent messages + active intent + task summary
 * + important decisions + user answers. Everything else stays out of the prompt.
 */
export function compressContext({
  messages = [], conversationId = 'default', activeIntent = null, activePlan = null,
  recentCount = 6, maxChars = 2400
} = {}) {
  const recent = messages.slice(-recentCount).map((m) => ({
    role: m.role === 'assistant' ? 'ai' : m.role,
    content: String(m.content || '').slice(0, 320)
  }));

  const decisions = recall({ kind: FACT_KIND.DECISION, conversationId, limit: 5 }).map((e) => e.value);
  const answers = recall({ kind: FACT_KIND.ANSWER, conversationId, limit: 8 }).map((e) => ({ slot: e.value?.slot, value: e.value?.value }));
  const preferences = recall({ kind: FACT_KIND.PREFERENCE, conversationId, limit: 6 }).map((e) => ({ key: e.key, value: e.value }));
  const goals = getGoalMemory(conversationId);
  const openTasks = recall({ kind: FACT_KIND.OPEN_TASK, conversationId, limit: 3 }).map((e) => e.value);

  const taskSummary = activePlan
    ? {
      planId: activePlan.planId,
      goal: activePlan.goal,
      status: activePlan.status,
      done: (activePlan.graph?.nodes || []).filter((n) => n.status === 'completed').map((n) => n.id),
      pending: (activePlan.graph?.nodes || []).filter((n) => n.status === 'pending' || n.status === 'blocked').map((n) => n.id)
    }
    : null;

  const compressed = {
    schema: 'fbt.compressed-context.v7',
    recentMessages: recent,
    activeIntent: activeIntent ? { type: activeIntent.type || activeIntent.primaryIntent, entities: activeIntent.entities || {} } : null,
    taskSummary,
    decisions,
    answers,
    preferences,
    goals,
    openTasks,
    droppedMessages: Math.max(0, messages.length - recent.length)
  };

  let size = 0;
  try { size = JSON.stringify(compressed).length; } catch { size = 0; }
  if (size > maxChars) {
    compressed.recentMessages = compressed.recentMessages.slice(-3).map((m) => ({ ...m, content: m.content.slice(0, 160) }));
    compressed.decisions = compressed.decisions.slice(0, 2);
    compressed.preferences = compressed.preferences.slice(0, 3);
    compressed.truncated = true;
  }
  compressed.approxChars = size;
  return compressed;
}
