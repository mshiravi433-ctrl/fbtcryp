/**
 * FBT AI / Intent OS — UPGRADE 6
 * ConversationState — Persistent Context + Intent Lifecycle
 * 
 * Spec §1, §2, §22, §12, §42, §44
 * - Persistent across route changes
 * - No reset on navigation
 * - Wallet context preserved
 * - Intent lifecycle tracking
 */

export const CONVERSATION_STATE_SCHEMA = 'fbt.conversation-state.v6';
const STORAGE_KEY = 'fbt.conversation.state.v6';
const MAX_MESSAGES = 200;

function makeId(prefix = 'id') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() { return Date.now(); }

/**
 * Intent Status per spec §22
 * IDLE → UNDERSTANDING → CLARIFYING → READY → WORKING → NAVIGATING → WAITING → EXECUTING → VERIFYING → COMPLETED
 */
export const INTENT_STATUS = Object.freeze({
  NEW: 'new',
  UNDERSTANDING: 'understanding',
  CLARIFYING: 'clarifying',
  READY: 'ready',
  NAVIGATING: 'navigating',
  EXECUTING: 'executing',
  WAITING_USER: 'waiting_user',
  COMPLETED: 'completed',
  FAILED: 'failed',
  // Legacy compat for spec examples
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
  VERIFYING: 'verifying'
});

export const STATE_MACHINE = Object.freeze({
  IDLE: 'IDLE',
  UNDERSTANDING: 'UNDERSTANDING',
  CLARIFYING: 'CLARIFYING',
  READY: 'READY',
  WORKING: 'WORKING',
  NAVIGATING: 'NAVIGATING',
  WAITING: 'WAITING',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED'
});

/**
 * Create empty conversation state per spec §1
 */
export function createConversationState({ sessionId = null, currentRoute = '/intent' } = {}) {
  return {
    schema: CONVERSATION_STATE_SCHEMA,
    version: 6,
    sessionId: sessionId || makeId('sess'),
    currentIntent: null,
    intentId: null,
    intentStatus: INTENT_STATUS.IDLE || 'idle',
    stateMachine: STATE_MACHINE.IDLE,
    currentTask: null,
    currentRoute,
    previousRoute: null,
    expectedReturnRoute: null,
    collectedSlots: {},
    missingSlots: [],
    lastQuestion: null,
    lastQuestionId: null,
    lastQuestionType: null,
    lastQuestionAt: null,
    lastUserAnswer: null,
    lastUserAnswerAt: null,
    pendingAction: null,
    executionContext: null,
    walletContext: null,
    walletSnapshot: null,
    messages: [],
    navigationHistory: [],
    intentHistory: [],
    questionsAsked: [],
    answersReceived: [],
    observability: {
      intentId: null,
      sessionId: null,
      createdAt: now(),
      events: []
    },
    updatedAt: now(),
    createdAt: now()
  };
}

/**
 * Load from storage — survives page reload where appropriate (Test 12)
 */
export function loadConversationState() {
  try {
    if (typeof localStorage === 'undefined') return createConversationState();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createConversationState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== CONVERSATION_STATE_SCHEMA) return createConversationState();
    // Don't restore if too old (24h)
    if (parsed.updatedAt && now() - parsed.updatedAt > 24 * 60 * 60 * 1000) {
      return createConversationState({ sessionId: parsed.sessionId });
    }
    // Ensure arrays exist
    return {
      ...createConversationState(),
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-MAX_MESSAGES) : [],
      navigationHistory: Array.isArray(parsed.navigationHistory) ? parsed.navigationHistory : [],
      intentHistory: Array.isArray(parsed.intentHistory) ? parsed.intentHistory : [],
      questionsAsked: Array.isArray(parsed.questionsAsked) ? parsed.questionsAsked : [],
      answersReceived: Array.isArray(parsed.answersReceived) ? parsed.answersReceived : []
    };
  } catch {
    return createConversationState();
  }
}

export function saveConversationState(state) {
  try {
    if (typeof localStorage === 'undefined') return state;
    const toSave = {
      ...state,
      updatedAt: now(),
      messages: Array.isArray(state.messages) ? state.messages.slice(-MAX_MESSAGES) : []
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    return toSave;
  } catch {
    return state;
  }
}

export function clearConversationState() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {}
  return createConversationState();
}

/**
 * Update route — MUST preserve context (Spec §2)
 * Navigation != New Conversation
 */
export function updateRoute(state, newRoute, { reason = null, intentId = null } = {}) {
  if (!state) state = createConversationState();
  if (state.currentRoute === newRoute) return state; // No-op
  const next = {
    ...state,
    previousRoute: state.currentRoute,
    currentRoute: newRoute,
    expectedReturnRoute: state.currentRoute === '/intent' ? null : state.expectedReturnRoute,
    navigationHistory: [
      ...(state.navigationHistory || []),
      {
        from: state.currentRoute,
        to: newRoute,
        reason,
        intentId,
        at: now()
      }
    ].slice(-50),
    updatedAt: now()
  };
  // CRITICAL: Do NOT reset intent, slots, question, wallet
  return next;
}

/**
 * Set current intent — creates Intent ID per §4
 */
export function setIntent(state, intent, { status = INTENT_STATUS.NEW } = {}) {
  const intentId = intent?.intentId || intent?.id || makeId('intent');
  const next = {
    ...state,
    currentIntent: intent?.type || intent?.primaryIntent || intent,
    intentId,
    intentStatus: status,
    stateMachine: mapStatusToMachine(status),
    currentTask: state.currentTask ? { ...state.currentTask, intentId } : {
      id: makeId('task'),
      type: intent?.type || 'GENERAL',
      goal: intent?.goal || intent?.type || '',
      status,
      intentId,
      createdAt: now()
    },
    intentHistory: [
      ...(state.intentHistory || []),
      { intentId, type: intent?.type || intent, status, at: now() }
    ].slice(-100),
    observability: {
      ...state.observability,
      intentId,
      lastIntent: intent?.type || intent,
      events: [
        ...(state.observability?.events || []),
        { type: 'INTENT_CREATED', intentId, intentType: intent?.type || intent, at: now() }
      ].slice(-200)
    },
    updatedAt: now()
  };
  return next;
}

export function updateIntentStatus(state, status, extra = {}) {
  const next = {
    ...state,
    intentStatus: status,
    stateMachine: extra.stateMachine || mapStatusToMachine(status),
    currentTask: state.currentTask ? { ...state.currentTask, status, ...extra, updatedAt: now() } : null,
    observability: {
      ...state.observability,
      events: [
        ...(state.observability?.events || []),
        { type: 'INTENT_UPDATED', status, at: now(), ...extra }
      ].slice(-200)
    },
    updatedAt: now()
  };
  if (status === INTENT_STATUS.COMPLETED || status === STATE_MACHINE.COMPLETED) {
    next.intentHistory = [
      ...(next.intentHistory || []),
      { intentId: state.intentId, status: 'completed', at: now() }
    ].slice(-100);
  }
  return next;
}

function mapStatusToMachine(status) {
  const map = {
    new: STATE_MACHINE.UNDERSTANDING,
    understanding: STATE_MACHINE.UNDERSTANDING,
    clarifying: STATE_MACHINE.CLARIFYING,
    ready: STATE_MACHINE.READY,
    navigating: STATE_MACHINE.NAVIGATING,
    executing: STATE_MACHINE.EXECUTING,
    waiting_user: STATE_MACHINE.WAITING,
    waiting: STATE_MACHINE.WAITING,
    working: STATE_MACHINE.WORKING,
    verifying: STATE_MACHINE.VERIFYING,
    completed: STATE_MACHINE.COMPLETED,
    failed: STATE_MACHINE.COMPLETED,
    idle: STATE_MACHINE.IDLE
  };
  return map[status] || STATE_MACHINE.IDLE;
}

/**
 * Question / Answer tracking per §7
 */
export function setLastQuestion(state, question, { questionId = null, expectedType = null } = {}) {
  const qId = questionId || makeId('q');
  return {
    ...state,
    lastQuestion: question,
    lastQuestionId: qId,
    lastQuestionType: expectedType,
    lastQuestionAt: now(),
    questionsAsked: [
      ...(state.questionsAsked || []),
      { questionId: qId, question, expectedType, at: now() }
    ].slice(-100),
    observability: {
      ...state.observability,
      events: [
        ...(state.observability?.events || []),
        { type: 'QUESTION_ASKED', questionId: qId, question, expectedType, at: now() }
      ].slice(-200)
    },
    updatedAt: now()
  };
}

export function setLastAnswer(state, answer, { questionId = null } = {}) {
  const qId = questionId || state.lastQuestionId;
  return {
    ...state,
    lastUserAnswer: answer,
    lastUserAnswerAt: now(),
    answersReceived: [
      ...(state.answersReceived || []),
      { questionId: qId, answer, at: now() }
    ].slice(-100),
    observability: {
      ...state.observability,
      events: [
        ...(state.observability?.events || []),
        { type: 'ANSWER_RECEIVED', questionId: qId, answer: String(answer).slice(0, 500), at: now() }
      ].slice(-200)
    },
    updatedAt: now()
  };
}

/**
 * Slot filling per §8
 */
export function setCollectedSlot(state, key, value, { confidence = 1 } = {}) {
  return {
    ...state,
    collectedSlots: {
      ...state.collectedSlots,
      [key]: { value, confidence, updatedAt: now(), source: 'user' }
    },
    missingSlots: (state.missingSlots || []).filter((k) => k !== key),
    observability: {
      ...state.observability,
      events: [
        ...(state.observability?.events || []),
        { type: 'SLOT_FILLED', key, value, confidence, at: now() }
      ].slice(-200)
    },
    updatedAt: now()
  };
}

export function setMissingSlots(state, missing) {
  return {
    ...state,
    missingSlots: Array.isArray(missing) ? missing : [],
    updatedAt: now()
  };
}

export function setPendingAction(state, action) {
  return {
    ...state,
    pendingAction: action,
    updatedAt: now()
  };
}

export function setExecutionContext(state, ctx) {
  return {
    ...state,
    executionContext: ctx,
    updatedAt: now()
  };
}

export function setWalletContext(state, walletCtx) {
  return {
    ...state,
    walletContext: walletCtx,
    walletSnapshot: walletCtx ? { ...walletCtx, snapshotAt: now() } : null,
    updatedAt: now()
  };
}

export function appendMessage(state, msg) {
  const messages = [...(state.messages || []), { ...msg, at: msg.at || now() }].slice(-MAX_MESSAGES);
  return { ...state, messages, updatedAt: now() };
}

export function setMessages(state, messages) {
  return {
    ...state,
    messages: Array.isArray(messages) ? messages.slice(-MAX_MESSAGES) : [],
    updatedAt: now()
  };
}

/**
 * Check if question already asked (No Repetition Policy §33)
 */
export function hasAskedQuestion(state, questionOrType) {
  const q = String(questionOrType || '').toLowerCase();
  if (!q) return false;
  const asked = state.questionsAsked || [];
  return asked.some((item) => {
    const existing = String(item.question || item.expectedType || '').toLowerCase();
    return existing.includes(q) || q.includes(existing);
  });
}

export function getSlotValue(state, key) {
  const slot = state.collectedSlots?.[key];
  if (!slot) return null;
  if (typeof slot === 'object' && slot.value !== undefined) return slot.value;
  return slot;
}

export function hasSlot(state, key) {
  return state.collectedSlots?.[key] != null;
}

/**
 * Intent completion check per §11
 */
export function isIntentCompleted(state, intentId = null) {
  if (intentId && state.intentId !== intentId) return false;
  return state.intentStatus === INTENT_STATUS.COMPLETED || state.stateMachine === STATE_MACHINE.COMPLETED;
}

/**
 * Should we navigate again?
 *
 * ─── THIS FUNCTION USED TO BE A HARD GATE, AND THAT WAS THE BUG ────────────
 * §3 of the original spec treated repeated navigation as something to be
 * PREVENTED. Two refusals came out of it:
 *
 *   · `intent_completed`          — once an intent finished, the assistant
 *                                   would never open that page again
 *   · `navigation_loop_detected`  — two visits to the same route inside the
 *                                   last five and the route was refused
 *
 * `navigationHistory` is append-only and survives in localStorage, so both
 * refusals were effectively permanent: after the user had been to /signals
 * twice, every later «سیگنال» was silently dropped and the chat stayed where
 * it was. The user experienced it as a dead menu.
 *
 * Opening a page is read-only and reversible — one tap back, and the
 * conversation state is preserved either way. There is nothing here worth
 * protecting against, so both refusals are gone. The two that remain are not
 * limits, they are no-ops: there is no route to go to, or we are already
 * standing on it.
 *
 * `loopCount` is still computed and returned, because "the user has been here
 * three times" is useful telemetry — it just no longer vetoes anything.
 */
export function shouldAllowNavigation(state, targetRoute, { intentId = null, force = false } = {}) {
  if (force) return { allowed: true, reason: 'forced' };
  if (!targetRoute) return { allowed: false, reason: 'no_target' };

  // Already standing on it — nothing to do, not a refusal.
  if (state.currentRoute === targetRoute) {
    return { allowed: false, reason: 'same_route' };
  }

  // If returning to chat, never repeat previous navigation
  if (targetRoute === '/intent' && state.currentRoute !== '/intent') {
    return { allowed: true, reason: 'return_to_chat' };
  }

  const recent = (state.navigationHistory || []).slice(-5);
  const loopCount = recent.filter((n) => n.to === targetRoute).length;

  if (isIntentCompleted(state, intentId)) {
    return { allowed: true, reason: 'intent_completed', loopCount };
  }
  if (loopCount >= 2) {
    return { allowed: true, reason: 'repeat_navigation', loopCount };
  }

  return { allowed: true, reason: 'new_navigation', loopCount };
}

/**
 * Get state digest for observability
 */
export function getStateDigest(state) {
  return {
    sessionId: state.sessionId,
    intentId: state.intentId,
    currentIntent: state.currentIntent,
    intentStatus: state.intentStatus,
    stateMachine: state.stateMachine,
    currentRoute: state.currentRoute,
    previousRoute: state.previousRoute,
    collectedSlots: Object.keys(state.collectedSlots || {}),
    missingSlots: state.missingSlots || [],
    lastQuestionId: state.lastQuestionId,
    messageCount: (state.messages || []).length,
    updatedAt: state.updatedAt
  };
}
