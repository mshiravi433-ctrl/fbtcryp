import {
  TASK_STATUS,
  createCheckpoint,
  createTaskRecord,
  nowMs
} from './contracts.js';

export function buildPlanForIntent({ intent, goal, context = {} }) {
  const type = intent?.type || 'GENERAL';

  if (type === 'PORTFOLIO_ANALYSIS') {
    return [
      { label: 'Understand portfolio objective', agentId: 'intent', route: '/intent' },
      { label: 'Load wallet and portfolio context', agentId: 'wallet', toolId: 'portfolio' },
      { label: 'Run market and risk analysis', agentId: 'risk', toolId: 'market' },
      { label: 'Compare scenarios and generate plan', agentId: 'strategy' },
      { label: 'Prepare execution-safe recommendations', agentId: 'execution', toolId: 'simulation' },
      { label: 'Start monitoring follow-up conditions', agentId: 'monitoring', toolId: 'notifications' }
    ];
  }

  if (type === 'TRADE_EXECUTION') {
    return [
      { label: 'Validate requested action', agentId: 'intent' },
      { label: 'Refresh wallet balances and allowances', agentId: 'wallet', toolId: 'wallet' },
      { label: 'Simulate action and estimate risk', agentId: 'execution', toolId: 'simulation' },
      { label: 'Collect confirmation', agentId: 'execution', route: '/intent' },
      { label: 'Execute and verify transaction', agentId: 'execution', toolId: 'swap' },
      { label: 'Monitor post-trade conditions', agentId: 'monitoring', toolId: 'notifications' }
    ];
  }

  if (type === 'MONITORING_REQUEST') {
    return [
      { label: 'Identify watch conditions', agentId: 'intent' },
      { label: 'Attach portfolio context', agentId: 'portfolio', toolId: 'portfolio' },
      { label: 'Start alert monitors', agentId: 'monitoring', toolId: 'notifications' }
    ];
  }

  return [
    { label: 'Understand request', agentId: 'intent' },
    { label: 'Determine next safe step', agentId: 'strategy' }
  ];
}

export function createTaskForIntent({ intent, goal, state, timestamp = nowMs(), context = {} }) {
  const steps = buildPlanForIntent({ intent, goal, context });
  return createTaskRecord({
    intentId: intent?.intentId || null,
    goalId: goal?.goalId || null,
    status: intent?.status === 'ready' ? TASK_STATUS.RUNNING : TASK_STATUS.WAITING,
    progress: 0,
    steps,
    currentStep: steps[0]?.stepId || null,
    checkpoints: [
      createCheckpoint({
        intentId: intent?.intentId || null,
        label: 'Task created',
        status: 'completed',
        data: { type: intent?.type || 'GENERAL' },
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function addCheckpoint(task, input = {}, timestamp = nowMs()) {
  if (!task) return task;
  const checkpoint = createCheckpoint({
    taskId: task.taskId,
    intentId: task.intentId,
    stepId: input.stepId || task.currentStep || null,
    label: input.label || 'Checkpoint',
    status: input.status || 'completed',
    data: input.data || {},
    createdAt: timestamp,
    updatedAt: timestamp
  });
  return {
    ...task,
    checkpoints: [...(task.checkpoints || []), checkpoint].slice(-40),
    updatedAt: timestamp
  };
}

export function advanceTask(task, stepId = null, status = TASK_STATUS.RUNNING, timestamp = nowMs()) {
  if (!task) return task;
  const steps = Array.isArray(task.steps) ? task.steps.slice() : [];
  const currentIndex = stepId
    ? steps.findIndex((step) => step.stepId === stepId)
    : steps.findIndex((step) => step.stepId === task.currentStep);
  const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, steps.length - 1) : 0;

  const updatedSteps = steps.map((step, index) => {
    if (index < nextIndex) return { ...step, status: 'completed' };
    if (index === nextIndex) return { ...step, status: status === TASK_STATUS.COMPLETED ? 'completed' : 'running' };
    return step;
  });

  const progress = updatedSteps.length
    ? Math.round((updatedSteps.filter((step) => step.status === 'completed').length / updatedSteps.length) * 100)
    : 0;

  return {
    ...task,
    steps: updatedSteps,
    currentStep: updatedSteps[nextIndex]?.stepId || null,
    status,
    progress,
    updatedAt: timestamp
  };
}

export function resumeTask(task, route = '/intent', timestamp = nowMs()) {
  if (!task) return task;
  return {
    ...task,
    status: task.status === TASK_STATUS.COMPLETED ? task.status : TASK_STATUS.RUNNING,
    resumeToken: `${task.taskId}:${route}:${timestamp}`,
    updatedAt: timestamp
  };
}

export function summarizeTask(task) {
  if (!task) return '';
  const step = task.steps?.find?.((item) => item.stepId === task.currentStep) || task.steps?.[0] || null;
  return `${task.progress || 0}% • ${step?.label || 'No step selected'}`;
}
