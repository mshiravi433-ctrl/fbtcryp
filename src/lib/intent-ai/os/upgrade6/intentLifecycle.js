/**
 * FBT AI / Intent OS — UPGRADE 6
 * Intent Lifecycle + State Machine + Observability + Quality Metrics
 * Spec §4, §22, §39, §40
 */

function makeId(prefix = 'intent') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function now() { return Date.now(); }

export const INTENT_LIFECYCLE = Object.freeze({
  CREATED: 'CREATED',
  UNDERSTANDING: 'UNDERSTANDING',
  COLLECTING: 'COLLECTING',
  READY: 'READY',
  NAVIGATING: 'NAVIGATING',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
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
 * Intent Lifecycle Manager — Spec §4
 * USER REQUEST → INTENT CREATED → UNDERSTAND → COLLECT REQUIRED INFORMATION → READY → NAVIGATE/EXECUTE → VERIFY → COMPLETED
 * After COMPLETED, intent must not execute again
 */
export class IntentLifecycleManager {
  constructor() {
    this.intents = new Map();
    this.activeIntentId = null;
  }

  createIntent({ userRequest, detectedIntent = null, sessionId = null, source = 'user' } = {}) {
    const intentId = makeId('intent');
    const record = {
      intentId,
      sessionId: sessionId || makeId('sess'),
      userRequest: String(userRequest || '').slice(0, 1000),
      detectedIntent: detectedIntent?.type || detectedIntent || null,
      detectedDetail: detectedIntent || null,
      status: INTENT_LIFECYCLE.CREATED,
      stateMachine: STATE_MACHINE.UNDERSTANDING,
      agentsUsed: [],
      toolsUsed: [],
      questionsAsked: [],
      answersReceived: [],
      navigationEvents: [],
      executionEvents: [],
      errors: [],
      retries: [],
      fallbacks: [],
      completion: null,
      duration: null,
      createdAt: now(),
      updatedAt: now(),
      source,
      version: 6
    };
    this.intents.set(intentId, record);
    this.activeIntentId = intentId;
    return record;
  }

  getIntent(intentId) {
    return this.intents.get(intentId) || null;
  }

  getActiveIntent() {
    if (!this.activeIntentId) return null;
    return this.intents.get(this.activeIntentId) || null;
  }

  updateStatus(intentId, status, extra = {}) {
    const rec = this.intents.get(intentId);
    if (!rec) return null;
    const prev = rec.status;
    rec.status = status;
    rec.stateMachine = extra.stateMachine || this.mapToStateMachine(status);
    rec.updatedAt = now();
    Object.assign(rec, extra);
    rec.duration = rec.updatedAt - rec.createdAt;

    // Track transitions
    if (!rec.transitions) rec.transitions = [];
    rec.transitions.push({ from: prev, to: status, at: now() });

    // If completed, never auto-execute again
    if (status === INTENT_LIFECYCLE.COMPLETED) {
      rec.completion = { at: now(), ...extra };
      rec.completedAt = now();
    }
    if (status === INTENT_LIFECYCLE.FAILED) {
      rec.failedAt = now();
      rec.completion = { at: now(), failed: true, ...extra };
    }

    return rec;
  }

  mapToStateMachine(status) {
    const map = {
      CREATED: STATE_MACHINE.UNDERSTANDING,
      UNDERSTANDING: STATE_MACHINE.UNDERSTANDING,
      COLLECTING: STATE_MACHINE.CLARIFYING,
      READY: STATE_MACHINE.READY,
      NAVIGATING: STATE_MACHINE.NAVIGATING,
      EXECUTING: STATE_MACHINE.EXECUTING,
      VERIFYING: STATE_MACHINE.VERIFYING,
      COMPLETED: STATE_MACHINE.COMPLETED,
      FAILED: STATE_MACHINE.COMPLETED
    };
    return map[status] || STATE_MACHINE.IDLE;
  }

  // Observability per §39
  logAgent(intentId, agentId) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    if (!rec.agentsUsed.includes(agentId)) rec.agentsUsed.push(agentId);
    rec.updatedAt = now();
  }

  logTool(intentId, toolId) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    if (!rec.toolsUsed.includes(toolId)) rec.toolsUsed.push(toolId);
    rec.updatedAt = now();
  }

  logQuestion(intentId, question, questionId = null) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    rec.questionsAsked.push({ question, questionId, at: now() });
    rec.updatedAt = now();
  }

  logAnswer(intentId, answer, questionId = null) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    rec.answersReceived.push({ answer: String(answer).slice(0, 500), questionId, at: now() });
    rec.updatedAt = now();
  }

  logNavigation(intentId, navEvent) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    rec.navigationEvents.push({ ...navEvent, at: now() });
    rec.updatedAt = now();
  }

  logExecution(intentId, execEvent) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    rec.executionEvents.push({ ...execEvent, at: now() });
    rec.updatedAt = now();
  }

  logError(intentId, error) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    rec.errors.push({ error: error?.message || String(error), code: error?.code || null, at: now() });
    rec.updatedAt = now();
  }

  logRetry(intentId, retryInfo) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    rec.retries.push({ ...retryInfo, at: now() });
    rec.updatedAt = now();
  }

  logFallback(intentId, fallbackInfo) {
    const rec = this.intents.get(intentId);
    if (!rec) return;
    rec.fallbacks.push({ ...fallbackInfo, at: now() });
    rec.updatedAt = now();
  }

  /**
   * Check if intent already completed — should never auto-execute again (§11)
   */
  isCompleted(intentId) {
    const rec = this.intents.get(intentId);
    if (!rec) return false;
    return rec.status === INTENT_LIFECYCLE.COMPLETED;
  }

  /**
   * State machine transition validation — no IDLE without reason (§22)
   */
  canTransition(from, to) {
    const allowed = {
      IDLE: ['UNDERSTANDING'],
      UNDERSTANDING: ['CLARIFYING', 'READY', 'COMPLETED', 'FAILED'],
      CLARIFYING: ['READY', 'UNDERSTANDING', 'COMPLETED', 'FAILED'],
      READY: ['WORKING', 'NAVIGATING', 'EXECUTING', 'WAITING', 'COMPLETED'],
      WORKING: ['NAVIGATING', 'EXECUTING', 'VERIFYING', 'WAITING', 'COMPLETED', 'FAILED'],
      NAVIGATING: ['WAITING', 'WORKING', 'EXECUTING', 'COMPLETED', 'FAILED'],
      WAITING: ['UNDERSTANDING', 'READY', 'WORKING', 'EXECUTING', 'COMPLETED', 'FAILED'],
      EXECUTING: ['VERIFYING', 'COMPLETED', 'FAILED', 'WAITING'],
      VERIFYING: ['COMPLETED', 'FAILED', 'EXECUTING'],
      COMPLETED: [] // Terminal — no transitions out
    };
    return (allowed[from] || []).includes(to);
  }

  getAllIntents() {
    return Array.from(this.intents.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  clear() {
    this.intents.clear();
    this.activeIntentId = null;
  }
}

// Singleton
let instance = null;
export function getIntentLifecycleManager() {
  if (!instance) instance = new IntentLifecycleManager();
  return instance;
}

export function resetIntentLifecycleManager() {
  if (instance) instance.clear();
  instance = null;
}
