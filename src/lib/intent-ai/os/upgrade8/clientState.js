import {
  CONVERSATION_STATUS,
  EXECUTION_STATUS,
  createConversationRecord,
  createIntentOSState,
  nowMs
} from './contracts.js';
import { mergeGoalFromAnswer } from './goalEngine.js';

const STORAGE_KEY = 'fbt.intent-os.upgrade8.state';
const SERVER_SYNC_DEBOUNCE_MS = 400;

function canUseStorage() {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function safeClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function getIntentOSStorageKey(ownerKey = 'default') {
  return `${STORAGE_KEY}:${ownerKey}`;
}

export function loadLocalIntentOSState(ownerKey = 'default') {
  if (!canUseStorage()) return createIntentOSState();
  try {
    const raw = window.localStorage.getItem(getIntentOSStorageKey(ownerKey));
    if (!raw) return createIntentOSState();
    const parsed = JSON.parse(raw);
    return createIntentOSState(parsed);
  } catch {
    return createIntentOSState();
  }
}

export function saveLocalIntentOSState(state, ownerKey = 'default') {
  if (!state || !canUseStorage()) return state;
  try {
    const next = createIntentOSState(state);
    window.localStorage.setItem(getIntentOSStorageKey(ownerKey), JSON.stringify(next));
    return next;
  } catch {
    return state;
  }
}

export function clearLocalIntentOSState(ownerKey = 'default') {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(getIntentOSStorageKey(ownerKey));
  } catch {}
}

function messageToTurn(message, index) {
  const role = message?.type === 'assistant' ? 'assistant' : 'user';
  return {
    id: message?.id || `turn_${index}`,
    role,
    text: String(message?.content || message?.text || message?.message || '').slice(0, 4000),
    timestamp: Number(message?.timestamp || message?.createdAt || nowMs()) || nowMs(),
    meta: safeClone(message?.meta || {}) || {}
  };
}

function summarizeMessages(messages = []) {
  return messages
    .slice(-6)
    .map((item) => `${item.type === 'assistant' ? 'A' : 'U'}: ${String(item.content || '').trim()}`)
    .filter(Boolean)
    .join(' | ')
    .slice(0, 1800);
}

export function deriveIntentOSStateFromLegacy({
  existingState,
  convState,
  messages,
  currentRoute,
  previousRoute,
  walletContext,
  portfolioContext,
  pendingExecution,
  monitoring = null,
  answerBinding = null,
  selectedOptionIndex = null
} = {}) {
  const timestamp = nowMs();
  const base = createIntentOSState(existingState || {});
  const turns = Array.isArray(messages) ? messages.map(messageToTurn).slice(-200) : base.conversation?.turns || [];
  const currentIntent = base.intents.find((item) => item.intentId === base.activeIntent) || null;
  const currentGoal = base.goals.find((item) => item.goalId === base.activeGoal) || null;

  const mergedGoal = answerBinding?.slot && currentGoal
    ? mergeGoalFromAnswer(currentGoal, answerBinding.slot, answerBinding.value, timestamp)
    : currentGoal;

  const goals = base.goals.map((goal) => (goal.goalId === mergedGoal?.goalId ? mergedGoal : goal));

  const conversation = createConversationRecord({
    ...(base.conversation || {}),
    conversationId: base.conversationId,
    sessionId: base.sessionId,
    status: pendingExecution
      ? CONVERSATION_STATUS.EXECUTING
      : base.pendingQuestion
        ? CONVERSATION_STATUS.WAITING
        : turns.length
          ? CONVERSATION_STATUS.ACTIVE
          : CONVERSATION_STATUS.CREATED,
    currentRoute: currentRoute || base.currentRoute || '/intent',
    previousRoute: previousRoute || base.previousRoute || null,
    turns,
    lastIntentId: base.activeIntent || base.conversation?.lastIntentId || null,
    activeQuestionId: base.pendingQuestion || null,
    activeTaskId: base.activeTask || null,
    activeGoalId: base.activeGoal || null,
    summary: summarizeMessages(messages || []),
    updatedAt: timestamp
  });

  const memoryShortTerm = (messages || [])
    .slice(-10)
    .map((item) => ({
      role: item.type === 'assistant' ? 'assistant' : 'user',
      text: String(item.content || '').slice(0, 400),
      timestamp: Number(item.timestamp || timestamp) || timestamp
    }));

  const options = base.agentState?.lastPresentedOptions || [];
  const markedOptions = options.map((item, index) => ({ ...item, selected: selectedOptionIndex === index }));

  return createIntentOSState({
    ...base,
    currentRoute: currentRoute || base.currentRoute || '/intent',
    previousRoute: previousRoute || base.previousRoute || null,
    walletContext: walletContext || base.walletContext || null,
    portfolioContext: portfolioContext || base.portfolioContext || null,
    executionState: {
      ...(base.executionState || {}),
      status: pendingExecution ? EXECUTION_STATUS.CONFIRMING : base.executionState?.status || EXECUTION_STATUS.IDLE,
      pendingExecution: pendingExecution || base.executionState?.pendingExecution || null
    },
    monitoringState: monitoring || base.monitoringState,
    conversation,
    goals,
    memory: {
      ...(base.memory || {}),
      shortTerm: memoryShortTerm,
      summary: conversation.summary,
      taskMemory: [
        ...(base.memory?.taskMemory || []).slice(-8),
        convState?.currentTask
          ? { task: String(convState.currentTask).slice(0, 300), timestamp }
          : null
      ].filter(Boolean)
    },
    agentState: {
      ...(base.agentState || {}),
      lastPresentedOptions: markedOptions
    },
    lastUpdated: timestamp
  });
}

export function hydrateLegacyStateFromIntentOS(state) {
  const source = createIntentOSState(state || {});
  const messages = (source.conversation?.turns || []).map((turn) => ({
    id: turn.id,
    type: turn.role === 'assistant' ? 'assistant' : 'user',
    content: turn.text,
    timestamp: turn.timestamp,
    meta: turn.meta || {}
  }));
  return {
    messages,
    convStatePatch: {
      currentIntent: source.intents.find((item) => item.intentId === source.activeIntent)?.type || null,
      currentIntentId: source.activeIntent || null,
      currentGoalId: source.activeGoal || null,
      currentTaskId: source.activeTask || null,
      currentTask: source.tasks.find((task) => task.taskId === source.activeTask)?.steps?.find((step) => step.stepId === source.currentStep)?.label || null,
      pendingQuestionId: source.pendingQuestion || null,
      status: source.conversation?.status || null,
      collectedInfo: source.collectedSlots || {},
      missingInfo: source.missingSlots || []
    }
  };
}

export function mergeRemoteIntentOSState(localState, remoteState) {
  const local = createIntentOSState(localState || {});
  const remote = createIntentOSState(remoteState || {});
  return remote.lastUpdated >= local.lastUpdated ? remote : local;
}

export function shouldSyncToServer(lastSyncAt) {
  return nowMs() - Number(lastSyncAt || 0) >= SERVER_SYNC_DEBOUNCE_MS;
}
