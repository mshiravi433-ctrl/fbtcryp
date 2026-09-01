/**
 * FBT INTENT OS — AI Dashboard Internal (Debug View)
 * Spec §35: For Developer/Admin only
 * Intent, Context, Selected Agent, Selected Tools, Execution Graph, Memory Used, API Calls, Latency, Errors, Final Result
 */

export const DEBUG_SCHEMA = 'fbt.debug-dashboard.v1';

const debugHistory = [];
const MAX_DEBUG = 50;

export function logDebugEntry(entry) {
  const debugEntry = {
    id: `dbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`,
    schema: DEBUG_SCHEMA,
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    ...entry
  };
  
  debugHistory.push(debugEntry);
  if (debugHistory.length > MAX_DEBUG) debugHistory.shift();
  
  // Store in localStorage for persistence across reloads (dev only)
  try {
    if (typeof window !== 'undefined' && window.location.hash.includes('debug')) {
      localStorage.setItem('fbt.debug.v1', JSON.stringify(debugHistory.slice(-20)));
    }
  } catch {}
  
  return debugEntry;
}

export function getDebugHistory({ limit = 20 } = {}) {
  return debugHistory.slice(-limit).reverse();
}

export function getLastDebug() {
  return debugHistory.length ? debugHistory[debugHistory.length - 1] : null;
}

export function clearDebugHistory() {
  debugHistory.length = 0;
  try {
    localStorage.removeItem('fbt.debug.v1');
  } catch {}
}

export function createDebugView({ intent, context, selectedAgents, selectedTools, executionGraph, memoryUsed, apiCalls, latency, errors, finalResult } = {}) {
  return {
    schema: DEBUG_SCHEMA,
    intent: intent ? { type: intent.type, confidence: intent.confidence, entities: intent.entities } : null,
    context: context ? {
      currentPage: context.currentPage,
      hasWallet: context.hasWallet,
      totalValueUsd: context.totalValueUsd,
      connectedChains: context.connectedChains,
      conversationLength: context.conversation?.length || 0
    } : null,
    selectedAgent: selectedAgents?.[0] || null,
    selectedAgents,
    selectedTools: selectedTools?.map(t => typeof t === 'string' ? t : t.id) || [],
    executionGraph: executionGraph || null,
    memoryUsed: memoryUsed?.map(m => ({ id: m.id, type: m.type, content: m.content?.slice(0, 100) })) || [],
    apiCalls: apiCalls || [],
    latency,
    errors,
    finalResult: finalResult ? {
      ok: finalResult.ok,
      status: finalResult.status,
      hasTx: Boolean(finalResult.txHash || finalResult.signature)
    } : null,
    timestamp: Date.now()
  };
}
