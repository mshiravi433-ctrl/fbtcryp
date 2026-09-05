import { CONVERSATION_STATUS, INTENT_STATUS, createIntentOSState, nowMs } from './contracts.js';
import { loadLocalIntentOSState, mergeRemoteIntentOSState, saveLocalIntentOSState } from './clientState.js';
import { getIntentOSState, saveIntentOSState } from './client.js';
import { runAgents, selectAgents } from './agentOrchestrator.js';
import { createExecutionFromPlan, buildConfirmationDetails, buildMonitoringState, simulateExecutionPlan } from './executionSafety.js';
import { createIntentAndGoal, mergeGoalFromAnswer } from './goalEngine.js';
import { bindAnswerToState, createFollowupQuestion, rememberPresentedOptions } from './questionEngine.js';
import { createTaskForIntent, resumeTask } from './taskEngine.js';
import { normalizeRequestedTools } from './toolRouter.js';

export async function bootstrapIntentOSSession({ ownerKey = 'default', hydrateRemote = true } = {}) {
  const local = loadLocalIntentOSState(ownerKey);
  if (!hydrateRemote) return local;
  try {
    const remote = await getIntentOSState();
    const merged = mergeRemoteIntentOSState(local, remote);
    saveLocalIntentOSState(merged, ownerKey);
    return merged;
  } catch {
    return local;
  }
}

export async function persistIntentOSSession(state, { ownerKey = 'default', remote = true } = {}) {
  const saved = saveLocalIntentOSState(createIntentOSState(state || {}), ownerKey);
  if (!remote) return saved;
  try {
    const remoteSaved = await saveIntentOSState(saved);
    saveLocalIntentOSState(remoteSaved, ownerKey);
    return remoteSaved;
  } catch {
    return saved;
  }
}

export function ingestUserTurn({ state, text, currentRoute = '/intent' }) {
  const timestamp = nowMs();
  let nextState = createIntentOSState(state || {});
  nextState = {
    ...nextState,
    currentRoute,
    conversation: {
      ...(nextState.conversation || {}),
      status: CONVERSATION_STATUS.ACTIVE,
      currentRoute,
      updatedAt: timestamp
    },
    lastUpdated: timestamp
  };

  if (nextState.pendingQuestion) {
    const binding = bindAnswerToState({ state: nextState, text, timestamp });
    if (binding.bound) {
      const goals = binding.state.goals.map((goal) => (
        goal.goalId === binding.state.activeGoal
          ? mergeGoalFromAnswer(goal, binding.bound.slot, binding.bound.value, timestamp)
          : goal
      ));
      return {
        state: {
          ...binding.state,
          goals,
          conversation: {
            ...(binding.state.conversation || {}),
            status: CONVERSATION_STATUS.ACTIVE,
            updatedAt: timestamp
          }
        },
        binding: binding.bound,
        created: null
      };
    }
  }

  const created = createIntentAndGoal({ state: nextState, message: text, route: currentRoute, timestamp });
  let intents = [...nextState.intents, created.intent];
  let goals = [...nextState.goals, created.goal];
  const task = createTaskForIntent({ intent: created.intent, goal: created.goal, state: nextState, timestamp });
  let tasks = [...nextState.tasks, task];

  nextState = {
    ...nextState,
    activeIntent: created.intent.intentId,
    activeGoal: created.goal.goalId,
    activeTask: task.taskId,
    currentStep: task.currentStep,
    intents,
    goals,
    tasks,
    collectedSlots: {
      ...(nextState.collectedSlots || {}),
      ...(created.intent.filledSlots || {})
    },
    missingSlots: created.intent.requiredSlots || [],
    toolState: {
      ...(nextState.toolState || {}),
      requested: normalizeRequestedTools(created.intent.type, nextState.toolState?.requested || [])
    },
    conversation: {
      ...(nextState.conversation || {}),
      status: created.intent.requiredSlots?.length ? CONVERSATION_STATUS.WAITING : CONVERSATION_STATUS.ACTIVE,
      lastIntentId: created.intent.intentId,
      activeTaskId: task.taskId,
      activeGoalId: created.goal.goalId,
      updatedAt: timestamp
    },
    lastUpdated: timestamp
  };

  if (created.intent.requiredSlots?.includes('riskProfile')) {
    nextState = createFollowupQuestion({
      state: nextState,
      intentId: created.intent.intentId,
      taskId: task.taskId,
      slot: 'riskProfile',
      prompt: 'ریسک‌پذیری مدنظرت چقدره؟ کم، متوسط یا زیاد؟',
      expectedType: 'riskProfile',
      options: [
        { id: 'risk-low', label: 'کم', value: 'low' },
        { id: 'risk-medium', label: 'متوسط', value: 'medium' },
        { id: 'risk-high', label: 'زیاد', value: 'high' }
      ]
    });
  } else if (created.intent.requiredSlots?.includes('timeframe')) {
    nextState = createFollowupQuestion({
      state: nextState,
      intentId: created.intent.intentId,
      taskId: task.taskId,
      slot: 'timeframe',
      prompt: 'بازه زمانی مدنظر چند ماهه است؟',
      expectedType: 'durationMonths'
    });
  }

  return { state: nextState, binding: null, created: { ...created, task } };
}

export async function orchestrateIntent({ state, message, walletContext, portfolioContext, pendingExecution = null, analysis = null }) {
  const currentIntent = state.intents.find((item) => item.intentId === state.activeIntent) || null;
  const currentTask = state.tasks.find((item) => item.taskId === state.activeTask) || null;
  const currentGoal = state.goals.find((item) => item.goalId === state.activeGoal) || null;
  const selectedAgents = selectAgents({
    intentType: currentIntent?.type,
    hasPortfolio: Boolean(portfolioContext?.positions?.length),
    executionRequested: Boolean(pendingExecution)
  });
  const orchestration = await runAgents({
    agents: selectedAgents,
    context: {
      message,
      currentRoute: state.currentRoute,
      intentType: currentIntent?.type,
      intentId: currentIntent?.intentId,
      taskId: currentTask?.taskId,
      goal: currentGoal,
      state,
      walletContext,
      portfolioContext,
      pendingExecution,
      analysis
    }
  });

  let nextState = {
    ...state,
    agentState: {
      ...(state.agentState || {}),
      selectedAgents: orchestration.selectedAgents,
      runs: [...(state.agentState?.runs || []), ...orchestration.runs].slice(-40),
      consensus: orchestration.consensus,
      lastPresentedOptions: (orchestration.consensus.options || []).map((option) => ({
        id: option.id,
        label: option.label,
        value: option.id,
        meta: option,
        selected: option.id === orchestration.consensus.preferredOption?.id
      }))
    },
    lastUpdated: nowMs()
  };

  const preferredIndex = (orchestration.consensus.options || []).findIndex((option) => option.id === orchestration.consensus.preferredOption?.id);
  nextState = rememberPresentedOptions(nextState, { options: orchestration.consensus.options }, preferredIndex >= 0 ? preferredIndex : null);
  return { state: nextState, orchestration };
}

export function prepareExecution({ state, action, walletContext }) {
  const timestamp = nowMs();
  const intent = state.intents.find((item) => item.intentId === state.activeIntent) || null;
  const goal = state.goals.find((item) => item.goalId === state.activeGoal) || null;
  const task = state.tasks.find((item) => item.taskId === state.activeTask) || null;
  const selectedOption = state.agentState?.lastPresentedOptions?.find?.((item) => item.selected) || null;

  const simulation = simulateExecutionPlan({
    intent,
    action,
    walletContext,
    state,
    timestamp
  });
  const confirmation = buildConfirmationDetails({
    intent,
    goal,
    selectedOption,
    action,
    walletContext,
    simulation,
    state
  });
  const execution = createExecutionFromPlan({
    state,
    intent,
    task,
    action,
    simulation,
    confirmation,
    timestamp
  });
  return {
    state: {
      ...state,
      executionState: {
        ...(state.executionState || {}),
        status: execution.status,
        executionId: execution.executionId,
        idempotencyKey: execution.idempotencyKey,
        lastSimulation: simulation,
        lastConfirmation: confirmation,
        pendingExecution: action,
        history: [...(state.executionState?.history || []), execution].slice(-20)
      },
      conversation: {
        ...(state.conversation || {}),
        status: execution.status === 'BLOCKED' ? CONVERSATION_STATUS.WAITING : CONVERSATION_STATUS.EXECUTING,
        updatedAt: timestamp
      },
      lastUpdated: timestamp
    },
    execution,
    simulation,
    confirmation
  };
}

export function activateMonitoring({ state, execution, recommendations = [] }) {
  const goal = state.goals.find((item) => item.goalId === state.activeGoal) || null;
  const monitoringState = buildMonitoringState({ goal, execution, recommendations, timestamp: nowMs() });
  return {
    ...state,
    monitoringState,
    conversation: {
      ...(state.conversation || {}),
      status: CONVERSATION_STATUS.RESUMABLE,
      updatedAt: nowMs()
    },
    intents: (state.intents || []).map((intent) => (
      intent.intentId === state.activeIntent
        ? { ...intent, status: INTENT_STATUS.MONITORING, updatedAt: nowMs() }
        : intent
    )),
    lastUpdated: nowMs()
  };
}

export function resumeConversationState(state, route = '/intent') {
  const timestamp = nowMs();
  const tasks = (state.tasks || []).map((task) => (
    task.taskId === state.activeTask ? resumeTask(task, route, timestamp) : task
  ));
  return {
    ...createIntentOSState(state || {}),
    tasks,
    currentRoute: route,
    conversation: {
      ...(state.conversation || {}),
      status: state.pendingQuestion ? CONVERSATION_STATUS.WAITING : CONVERSATION_STATUS.RESUMABLE,
      currentRoute: route,
      updatedAt: timestamp
    },
    lastUpdated: timestamp
  };
}
