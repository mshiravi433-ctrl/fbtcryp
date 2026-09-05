/**
 * FBT Intent OS Upgrade 8 — shared contracts
 * --------------------------------------------------------------------------
 * The UI, the server session layer and the probes all speak the same record
 * shapes. The point is not typing for its own sake: it is to stop the old
 * split-brain of `convState`, pending intent blobs, task continuity rows and
 * ad-hoc question ids from drifting apart.
 */

export const INTENT_OS_STATE_SCHEMA = 'fbt.intent-os.state.v8';
export const INTENT_OS_SERVER_SCHEMA = 'fbt.intent-os.server.v8';

export const CONVERSATION_STATUS = Object.freeze({
  CREATED: 'CREATED',
  ACTIVE: 'ACTIVE',
  WAITING: 'WAITING',
  NAVIGATING: 'NAVIGATING',
  EXECUTING: 'EXECUTING',
  PAUSED: 'PAUSED',
  RESUMABLE: 'RESUMABLE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ARCHIVED: 'ARCHIVED'
});

export const INTENT_STATUS = Object.freeze({
  CREATED: 'created',
  UNDERSTANDING: 'understanding',
  CLARIFYING: 'clarifying',
  READY: 'ready',
  PLANNING: 'planning',
  EXECUTING: 'executing',
  VERIFYING: 'verifying',
  MONITORING: 'monitoring',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
});

export const TASK_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING: 'waiting',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

export const QUESTION_STATUS = Object.freeze({
  ACTIVE: 'active',
  ANSWERED: 'answered',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
});

export const ANSWER_STATUS = Object.freeze({
  BOUND: 'bound',
  AMBIGUOUS: 'ambiguous',
  REJECTED: 'rejected'
});

export const EXECUTION_STATUS = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  SIMULATING: 'simulating',
  CONFIRMING: 'confirming',
  SIGNING: 'signing',
  SUBMITTED: 'submitted',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  BLOCKED: 'blocked'
});

export const MONITORING_STATUS = Object.freeze({
  IDLE: 'idle',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

export const PERMISSIONS = Object.freeze([
  'VIEW',
  'ANALYZE',
  'SIMULATE',
  'RECOMMEND',
  'NOTIFY',
  'EXECUTE',
  'RECURRING_EXECUTE'
]);

export const NOTIFICATION_LEVEL = Object.freeze({
  INFO: 'INFO',
  WARNING: 'WARNING',
  ACTION_REQUIRED: 'ACTION_REQUIRED'
});

export const SCENARIO_IDS = Object.freeze(['bull', 'base', 'bear', 'stress']);

export const AGENT_IDS = Object.freeze([
  'intent',
  'market',
  'wallet',
  'portfolio',
  'risk',
  'news',
  'smartMoney',
  'research',
  'strategy',
  'execution',
  'monitoring'
]);

export const TOOL_IDS = Object.freeze([
  'wallet',
  'portfolio',
  'swap',
  'bridge',
  'lending',
  'farm',
  'futures',
  'market',
  'news',
  'smartMoney',
  'signals',
  'orders',
  'navigation',
  'notifications',
  'simulation'
]);

export function nowMs() {
  return Date.now();
}

export function makeId(prefix = 'id') {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {}
  return `${prefix}_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createTaskStep(input = {}, index = 0) {
  return {
    stepId: input.stepId || input.id || makeId(`step${index + 1}`),
    label: String(input.label || input.title || `step ${index + 1}`).slice(0, 160),
    status: input.status || TASK_STATUS.PENDING,
    toolId: input.toolId || null,
    agentId: input.agentId || null,
    route: input.route || null,
    checkpointId: input.checkpointId || null,
    meta: clone(input.meta || {}) || {}
  };
}

export function createIntentOSState(seed = {}) {
  const sessionId = seed.sessionId || makeId('sess');
  const conversationId = seed.conversationId || makeId('conv');
  return {
    schema: INTENT_OS_STATE_SCHEMA,
    version: 8,
    sessionId,
    conversationId,
    activeIntent: seed.activeIntent || null,
    activeGoal: seed.activeGoal || null,
    activeTask: seed.activeTask || null,
    currentStep: seed.currentStep || null,
    currentRoute: seed.currentRoute || '/intent',
    previousRoute: seed.previousRoute || null,
    pendingQuestion: seed.pendingQuestion || null,
    collectedSlots: clone(seed.collectedSlots || {}) || {},
    missingSlots: Array.isArray(seed.missingSlots) ? seed.missingSlots.slice(0, 24) : [],
    walletContext: seed.walletContext || null,
    portfolioContext: seed.portfolioContext || null,
    agentState: clone(seed.agentState || {}) || {
      selectedAgents: [],
      runs: [],
      lastPresentedOptions: [],
      consensus: null
    },
    toolState: clone(seed.toolState || {}) || {
      requested: [],
      health: {},
      runs: [],
      freshness: {}
    },
    executionState: clone(seed.executionState || {}) || {
      status: EXECUTION_STATUS.IDLE,
      executionId: null,
      idempotencyKey: null,
      lastSimulation: null,
      lastConfirmation: null,
      lastVerification: null,
      pendingExecution: null,
      activeLock: null,
      history: []
    },
    monitoringState: clone(seed.monitoringState || {}) || {
      status: MONITORING_STATUS.IDLE,
      monitors: [],
      events: []
    },
    memory: clone(seed.memory || {}) || {
      shortTerm: [],
      taskMemory: [],
      preferences: [],
      summary: ''
    },
    conversation: seed.conversation || createConversationRecord({ conversationId, sessionId }),
    intents: Array.isArray(seed.intents) ? seed.intents.map(clone) : [],
    goals: Array.isArray(seed.goals) ? seed.goals.map(clone) : [],
    tasks: Array.isArray(seed.tasks) ? seed.tasks.map(clone) : [],
    questions: Array.isArray(seed.questions) ? seed.questions.map(clone) : [],
    answers: Array.isArray(seed.answers) ? seed.answers.map(clone) : [],
    checkpoints: Array.isArray(seed.checkpoints) ? seed.checkpoints.map(clone) : [],
    notifications: Array.isArray(seed.notifications) ? seed.notifications.map(clone) : [],
    trace: Array.isArray(seed.trace) ? seed.trace.map(clone) : [],
    quality: clone(seed.quality || {}) || {
      intentAccuracy: null,
      contextAccuracy: null,
      agentAccuracy: null,
      toolAccuracy: null,
      answerQuality: null,
      completionRate: null,
      correctionRate: null,
      latencyMs: null
    },
    lastUpdated: Number(seed.lastUpdated) || nowMs()
  };
}

export function createConversationRecord(input = {}) {
  return {
    conversationId: input.conversationId || makeId('conv'),
    sessionId: input.sessionId || makeId('sess'),
    status: input.status || CONVERSATION_STATUS.CREATED,
    currentRoute: input.currentRoute || '/intent',
    previousRoute: input.previousRoute || null,
    turns: Array.isArray(input.turns) ? input.turns.map(clone).slice(-200) : [],
    lastIntentId: input.lastIntentId || null,
    activeQuestionId: input.activeQuestionId || null,
    activeTaskId: input.activeTaskId || null,
    activeGoalId: input.activeGoalId || null,
    summary: String(input.summary || '').slice(0, 2000),
    createdAt: Number(input.createdAt) || nowMs(),
    updatedAt: Number(input.updatedAt) || nowMs()
  };
}

export function createIntentRecord(input = {}) {
  return {
    intentId: input.intentId || input.id || makeId('intent'),
    conversationId: input.conversationId || null,
    goalId: input.goalId || null,
    type: input.type || input.intentType || 'GENERAL',
    originalMessage: String(input.originalMessage || input.message || '').slice(0, 1200),
    normalizedMessage: String(input.normalizedMessage || input.originalMessage || input.message || '').slice(0, 1200),
    status: input.status || INTENT_STATUS.CREATED,
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : null,
    entities: clone(input.entities || {}) || {},
    requiredSlots: Array.isArray(input.requiredSlots) ? input.requiredSlots.slice(0, 24) : [],
    filledSlots: clone(input.filledSlots || {}) || {},
    routeContext: input.routeContext || null,
    explanation: input.explanation || null,
    createdAt: Number(input.createdAt) || nowMs(),
    updatedAt: Number(input.updatedAt) || nowMs()
  };
}

export function createGoalRecord(input = {}) {
  return {
    goalId: input.goalId || input.id || makeId('goal'),
    conversationId: input.conversationId || null,
    intentId: input.intentId || null,
    title: String(input.title || input.name || 'Goal').slice(0, 160),
    description: String(input.description || '').slice(0, 1000),
    type: input.type || 'financial-growth',
    status: input.status || 'active',
    targetValue: Number.isFinite(Number(input.targetValue)) ? Number(input.targetValue) : null,
    currentValue: Number.isFinite(Number(input.currentValue)) ? Number(input.currentValue) : null,
    horizonMonths: Number.isFinite(Number(input.horizonMonths)) ? Number(input.horizonMonths) : null,
    riskProfile: input.riskProfile || null,
    progressPct: Number.isFinite(Number(input.progressPct)) ? Number(input.progressPct) : null,
    assumptions: Array.isArray(input.assumptions) ? input.assumptions.slice(0, 12) : [],
    strategies: Array.isArray(input.strategies) ? input.strategies.map(clone).slice(0, 8) : [],
    monitoring: clone(input.monitoring || {}) || null,
    createdAt: Number(input.createdAt) || nowMs(),
    updatedAt: Number(input.updatedAt) || nowMs()
  };
}

export function createTaskRecord(input = {}) {
  const steps = Array.isArray(input.steps) ? input.steps.map(createTaskStep) : [];
  return {
    taskId: input.taskId || input.id || makeId('task'),
    intentId: input.intentId || null,
    goalId: input.goalId || null,
    status: input.status || TASK_STATUS.PENDING,
    currentStep: input.currentStep || steps[0]?.stepId || null,
    progress: Number.isFinite(Number(input.progress)) ? Number(input.progress) : 0,
    steps,
    checkpoints: Array.isArray(input.checkpoints) ? input.checkpoints.map(clone).slice(-32) : [],
    resumeToken: input.resumeToken || null,
    createdAt: Number(input.createdAt) || nowMs(),
    updatedAt: Number(input.updatedAt) || nowMs()
  };
}

export function createQuestionRecord(input = {}) {
  return {
    questionId: input.questionId || input.id || makeId('q'),
    intentId: input.intentId || null,
    taskId: input.taskId || null,
    slot: input.slot || 'text',
    prompt: String(input.prompt || input.question || '').slice(0, 600),
    expectedType: input.expectedType || 'text',
    required: input.required !== false,
    options: Array.isArray(input.options) ? input.options.map(clone).slice(0, 8) : [],
    status: input.status || QUESTION_STATUS.ACTIVE,
    createdAt: Number(input.createdAt) || nowMs(),
    updatedAt: Number(input.updatedAt) || nowMs()
  };
}

export function createAnswerRecord(input = {}) {
  return {
    answerId: input.answerId || input.id || makeId('ans'),
    questionId: input.questionId || null,
    intentId: input.intentId || null,
    slot: input.slot || 'text',
    value: clone(input.value),
    rawText: String(input.rawText || input.text || '').slice(0, 500),
    status: input.status || ANSWER_STATUS.BOUND,
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : null,
    createdAt: Number(input.createdAt) || nowMs(),
    updatedAt: Number(input.updatedAt) || nowMs()
  };
}

export function createCheckpoint(input = {}) {
  return {
    checkpointId: input.checkpointId || input.id || makeId('ckp'),
    intentId: input.intentId || null,
    taskId: input.taskId || null,
    stepId: input.stepId || null,
    label: String(input.label || '').slice(0, 240),
    status: input.status || 'pending',
    data: clone(input.data || {}) || {},
    createdAt: Number(input.createdAt) || nowMs(),
    updatedAt: Number(input.updatedAt) || nowMs()
  };
}

export function createAgentRun(input = {}) {
  return {
    runId: input.runId || input.id || makeId('agent'),
    agentId: input.agentId || 'intent',
    intentId: input.intentId || null,
    taskId: input.taskId || null,
    status: input.status || 'ok',
    result: clone(input.result || null),
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : null,
    sources: Array.isArray(input.sources) ? input.sources.map(clone).slice(0, 12) : [],
    timestamp: Number(input.timestamp) || nowMs(),
    latency: Number.isFinite(Number(input.latency)) ? Number(input.latency) : null,
    error: input.error || null
  };
}

export function createToolRun(input = {}) {
  return {
    runId: input.runId || input.id || makeId('tool'),
    toolId: input.toolId || 'simulation',
    intentId: input.intentId || null,
    taskId: input.taskId || null,
    status: input.status || 'ok',
    result: clone(input.result || null),
    freshAt: Number(input.freshAt) || null,
    supported: input.supported !== false,
    chainSupported: input.chainSupported !== false,
    assetSupported: input.assetSupported !== false,
    timestamp: Number(input.timestamp) || nowMs(),
    latency: Number.isFinite(Number(input.latency)) ? Number(input.latency) : null,
    error: input.error || null
  };
}

export function createExecutionRecord(input = {}) {
  return {
    executionId: input.executionId || input.id || makeId('exec'),
    intentId: input.intentId || null,
    taskId: input.taskId || null,
    idempotencyKey: input.idempotencyKey || makeId('idem'),
    status: input.status || EXECUTION_STATUS.READY,
    action: clone(input.action || null),
    simulation: clone(input.simulation || null),
    confirmation: clone(input.confirmation || null),
    verification: clone(input.verification || null),
    txHash: input.txHash || null,
    chainId: Number.isFinite(Number(input.chainId)) ? Number(input.chainId) : null,
    createdAt: Number(input.createdAt) || nowMs(),
    updatedAt: Number(input.updatedAt) || nowMs()
  };
}

export function createMonitoringEvent(input = {}) {
  return {
    eventId: input.eventId || input.id || makeId('mon'),
    goalId: input.goalId || null,
    intentId: input.intentId || null,
    executionId: input.executionId || null,
    level: input.level || NOTIFICATION_LEVEL.INFO,
    type: input.type || 'INFO',
    message: String(input.message || '').slice(0, 600),
    payload: clone(input.payload || {}) || {},
    createdAt: Number(input.createdAt) || nowMs()
  };
}

export function createNotification(input = {}) {
  return {
    notificationId: input.notificationId || input.id || makeId('notif'),
    level: input.level || NOTIFICATION_LEVEL.INFO,
    title: String(input.title || '').slice(0, 120),
    message: String(input.message || '').slice(0, 500),
    route: input.route || null,
    createdAt: Number(input.createdAt) || nowMs(),
    readAt: Number(input.readAt) || null
  };
}
