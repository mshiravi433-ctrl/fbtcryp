import {
  EXECUTION_STATUS,
  MONITORING_STATUS,
  createExecutionRecord,
  createMonitoringEvent,
  nowMs
} from './contracts.js';
import { assessToolAvailability } from './toolRouter.js';

export function createExecutionLock(state, intentId, timestamp = nowMs()) {
  const active = state?.executionState?.activeLock;
  if (active && timestamp - Number(active.createdAt || 0) < 45_000) {
    return {
      allowed: false,
      reason: 'execution-lock-active',
      lock: active
    };
  }

  const lock = {
    lockId: `lock_${intentId || 'unknown'}_${timestamp}`,
    createdAt: timestamp,
    intentId: intentId || null
  };

  return { allowed: true, lock };
}

export function buildConfirmationDetails({ intent, goal, selectedOption, action, walletContext, simulation, state }) {
  return {
    title: intent?.type === 'TRADE_EXECUTION' ? 'Confirm requested action' : 'Confirm recommended action',
    goal: goal?.title || null,
    riskProfile: state?.collectedSlots?.riskProfile || goal?.riskProfile || null,
    horizonMonths: state?.collectedSlots?.timeframe || goal?.horizonMonths || null,
    selectedOption: selectedOption || null,
    action: action || null,
    wallet: walletContext
      ? {
          address: walletContext.address || null,
          chainId: walletContext.chainId || walletContext.chain || null,
          connected: Boolean(walletContext.address || walletContext.connected)
        }
      : null,
    simulation: simulation || null
  };
}

export function simulateExecutionPlan({ intent, action, toolId = 'simulation', walletContext, state, timestamp = nowMs() }) {
  const toolAssessment = assessToolAvailability(toolId, {
    walletContext,
    chain: walletContext?.chainType || walletContext?.chain || 'evm',
    freshAt: walletContext?.lastUpdated || timestamp,
    timestamp
  });

  const warnings = [];
  if (!walletContext?.address && !walletContext?.connected) warnings.push('wallet-not-connected');
  if (toolAssessment.stale) warnings.push('context-stale');
  if (!toolAssessment.supported) warnings.push('tool-unsupported');
  if (!state?.collectedSlots?.riskProfile) warnings.push('risk-profile-missing');

  return {
    ok: warnings.length === 0,
    warnings,
    estimatedGasUsd: action?.estimatedGasUsd ?? null,
    impactSummary: action?.impactSummary || null,
    toolAssessment,
    generatedAt: timestamp,
    safeToProceed: warnings.length === 0
  };
}

export function canExecute({ state, permissions = [], walletContext, intent, action, timestamp = nowMs() }) {
  const permissionSet = new Set(permissions || []);
  const lockCheck = createExecutionLock(state, intent?.intentId, timestamp);
  if (!lockCheck.allowed) {
    return { ok: false, reason: lockCheck.reason, lock: lockCheck.lock };
  }
  if (!permissionSet.has('EXECUTE')) {
    return { ok: false, reason: 'permission-denied', lock: lockCheck.lock };
  }
  if (!walletContext?.address && !walletContext?.connected) {
    return { ok: false, reason: 'wallet-not-connected', lock: lockCheck.lock };
  }
  if (!action) {
    return { ok: false, reason: 'missing-action', lock: lockCheck.lock };
  }
  return { ok: true, reason: 'ok', lock: lockCheck.lock };
}

export function createExecutionFromPlan({ state, intent, task, action, simulation, confirmation, timestamp = nowMs() }) {
  return createExecutionRecord({
    intentId: intent?.intentId || null,
    taskId: task?.taskId || null,
    status: simulation?.safeToProceed ? EXECUTION_STATUS.CONFIRMING : EXECUTION_STATUS.BLOCKED,
    action,
    simulation,
    confirmation,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function createVerificationUpdate(execution, txHash, ok = true, timestamp = nowMs()) {
  return {
    ...execution,
    txHash: txHash || execution?.txHash || null,
    verification: {
      txHash: txHash || execution?.txHash || null,
      status: ok ? 'confirmed' : 'failed',
      checkedAt: timestamp
    },
    status: ok ? EXECUTION_STATUS.CONFIRMED : EXECUTION_STATUS.FAILED,
    updatedAt: timestamp
  };
}

export function buildMonitoringState({ goal, execution, recommendations = [], timestamp = nowMs() }) {
  const event = createMonitoringEvent({
    goalId: goal?.goalId || null,
    intentId: execution?.intentId || null,
    executionId: execution?.executionId || null,
    level: 'INFO',
    type: 'EXECUTION_WATCH',
    message: 'Execution entered monitoring.',
    payload: {
      recommendations,
      txHash: execution?.txHash || null
    },
    createdAt: timestamp
  });

  return {
    status: MONITORING_STATUS.ACTIVE,
    monitors: [
      {
        monitorId: `watch_${goal?.goalId || 'goal'}_${timestamp}`,
        type: 'portfolio-followup',
        createdAt: timestamp,
        recommendations
      }
    ],
    events: [event]
  };
}
