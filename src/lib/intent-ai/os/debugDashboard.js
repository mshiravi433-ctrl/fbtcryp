/**
 * FBT INTENT OS — AI Dashboard Internal (Debug View)
 * Spec §35: For Developer/Admin, not shown to user
 * Intent, Context, Selected Agent, Selected Tools, Execution Graph, Memory Used, API Calls, Latency, Errors, Final Result
 */

export const DEBUG_SCHEMA = 'fbt.debug-dashboard.v1';

const debugLogs = [];
const MAX_LOGS = 100;

export function logDebug(entry) {
  const log = {
    id: `dbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    schema: DEBUG_SCHEMA,
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    ...entry
  };
  
  debugLogs.push(log);
  if (debugLogs.length > MAX_LOGS) debugLogs.shift();
  
  // Only log in dev
  if (typeof window !== 'undefined' && window.__FBT_DEBUG__) {
    console.log('[IntentOS Debug]', log);
  }
  
  return log;
}

export function createDebugTrace({ intent, context, agents, tools, plan, execution, memory, latency, errors } = {}) {
  return {
    schema: DEBUG_SCHEMA,
    intent: intent?.type || intent,
    intentDetail: intent,
    context: context ? {
      currentPage: context.currentPage,
      hasWallet: context.hasWallet,
      totalValueUsd: context.totalValueUsd,
      chainCount: context.connectedChains?.length || 0
    } : null,
    selectedAgents: agents || [],
    selectedTools: (tools || []).map(t => typeof t === 'string' ? t : (t.id || t.toolId)),
    executionGraph: plan ? {
      planId: plan.planId,
      actionCount: plan.actions?.length || 0,
      requiresConfirmation: plan.requiresConfirmation,
      readOnly: plan.readOnly
    } : null,
    memoryUsed: memory ? {
      count: Array.isArray(memory) ? memory.length : Object.keys(memory).length,
      types: Array.isArray(memory) ? [...new Set(memory.map(m => m.type))] : []
    } : null,
    apiCalls: execution?.apiCalls || [],
    latency,
    errors: errors || [],
    finalResult: execution?.result ? {
      ok: execution.result.ok,
      status: execution.result.status,
      hasTx: Boolean(execution.result.txHash)
    } : null,
    timestamp: Date.now()
  };
}

export function getDebugLogs({ limit = 50 } = {}) {
  return debugLogs.slice(-limit).reverse();
}

export function getDebugHistory(opts = {}) {
  return getDebugLogs(opts);
}

export function clearDebugLogs() {
  debugLogs.length = 0;
}

export function clearDebugHistory() {
  return clearDebugLogs();
}

// Enable debug in window
export function enableDebug() {
  if (typeof window !== 'undefined') {
    window.__FBT_DEBUG__ = true;
    window.__FBT_INTENT_OS_DEBUG__ = {
      getLogs: getDebugLogs,
      clear: clearDebugLogs,
      logs: debugLogs
    };
    console.log('[IntentOS] Debug enabled. Access via window.__FBT_INTENT_OS_DEBUG__');
  }
}

export function disableDebug() {
  if (typeof window !== 'undefined') {
    window.__FBT_DEBUG__ = false;
  }
}
