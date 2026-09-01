/**
 * FBT INTENT OS — AI Dashboard Internal (Debug View)
 * Spec §35: Intent, Context, Selected Agent, Selected Tools, Execution Graph, Memory Used, API Calls, Latency, Errors, Final Result
 * For Developer/Admin only, not shown to user
 */

export const DEBUG_SCHEMA = 'fbt.debug-dashboard.v1';

const debugStore = {
  lastTask: null,
  history: [],
  maxHistory: 50
};

export function captureDebug({ taskId, intent, context, agents, tools, executionGraph, memoryUsed, apiCalls, latency, errors, result } = {}) {
  const entry = {
    schema: DEBUG_SCHEMA,
    taskId,
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    intent: intent ? { type: intent.type, confidence: intent.confidence, entities: intent.entities } : null,
    context: context ? {
      currentPage: context.currentPage,
      hasWallet: context.hasWallet,
      totalValueUsd: context.totalValueUsd,
      chainCount: context.connectedChains?.length || 0,
      memoryCount: context.memory?.length || 0
    } : null,
    selectedAgents: agents || [],
    selectedTools: (tools || []).map(t => typeof t === 'string' ? t : (t.id || t.toolId)),
    executionGraph: executionGraph || [],
    memoryUsed: (memoryUsed || []).map(m => ({ id: m.id, type: m.type, content: m.content?.slice(0, 100) })),
    apiCalls: apiCalls || [],
    latency,
    errors: errors || [],
    finalResult: result ? { ok: result.ok, status: result.status, hasTx: Boolean(result.txHash || result.signature) } : null
  };
  
  debugStore.lastTask = entry;
  debugStore.history.push(entry);
  if (debugStore.history.length > debugStore.maxHistory) debugStore.history.shift();
  
  if (typeof console !== 'undefined' && (import.meta?.env?.DEV || process.env.NODE_ENV === 'development')) {
    console.group(`[IntentOS Debug] ${taskId} ${intent?.type || 'UNKNOWN'}`);
    console.log('Intent:', entry.intent);
    console.log('Agents:', entry.selectedAgents);
    console.log('Tools:', entry.selectedTools);
    console.log('Execution Graph:', entry.executionGraph);
    console.log('Latency:', latency);
    console.log('Result:', entry.finalResult);
    if (errors?.length) console.warn('Errors:', errors);
    console.groupEnd();
  }
  
  return entry;
}

export function getLastDebug() {
  return debugStore.lastTask;
}

export function getDebugHistory({ limit = 20 } = {}) {
  return debugStore.history.slice(-limit).reverse();
}

export function clearDebugHistory() {
  debugStore.history = [];
  debugStore.lastTask = null;
}

export function getDebugStats() {
  const history = debugStore.history;
  const total = history.length;
  const byIntent = {};
  let totalLatency = 0;
  let errors = 0;
  for (const entry of history) {
    const type = entry.intent?.type || 'UNKNOWN';
    byIntent[type] = (byIntent[type] || 0) + 1;
    if (entry.latency) totalLatency += entry.latency;
    if (entry.errors?.length) errors += entry.errors.length;
  }
  return {
    total,
    byIntent,
    avgLatency: total ? Math.round(totalLatency / total) : null,
    totalErrors: errors,
    lastTaskAt: debugStore.lastTask?.timestamp || null
  };
}

// Compatibility aliases for old code
export const logDebugEntry = captureDebug;
export function createDebugView({ intent, context, selectedAgents, selectedTools, executionGraph, memoryUsed, apiCalls, latency, errors, finalResult } = {}) {
  return captureDebug({ intent, context, agents: selectedAgents, tools: selectedTools, executionGraph, memoryUsed, apiCalls, latency, errors, result: finalResult });
}
