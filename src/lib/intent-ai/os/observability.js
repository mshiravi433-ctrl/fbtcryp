/**
 * FBT INTENT OS — Observability
 * Spec §34: taskId, intent, tools, latency, status, errors, retries, provider, result
 * Never store private keys
 */

export const OBS_SCHEMA = 'fbt.observability.v1';

const KEY = 'fbt.observability.v1';
const MAX = 100;

function safeRead() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function safeWrite(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {}
}

export function logTask({ taskId, intent, tools = [], latency = null, status = 'pending', errors = [], retries = 0, provider = null, result = null, context = null } = {}) {
  const entry = {
    schema: OBS_SCHEMA,
    taskId,
    intent: typeof intent === 'string' ? intent : (intent?.type || 'unknown'),
    intentDetail: intent?.type ? { type: intent.type, confidence: intent.confidence } : null,
    tools: tools.map(t => typeof t === 'string' ? t : (t.id || t.toolId)),
    latency,
    status,
    errors: errors.map(e => typeof e === 'string' ? e : (e.message || String(e))).slice(0, 5),
    retries,
    provider,
    result: result ? { ok: result.ok, status: result.status, hasTx: Boolean(result.txHash || result.signature) } : null,
    route: context?.currentPage || context?.currentRoute || null,
    timestamp: Date.now(),
    iso: new Date().toISOString()
  };
  
  const list = safeRead();
  list.push(entry);
  safeWrite(list);
  
  // Console for dev
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[IntentOS][${status}] ${taskId} ${entry.intent} ${latency ? `${latency}ms` : ''}`, entry);
  }
  
  return entry;
}

export function getLogs({ intent = null, status = null, limit = 50 } = {}) {
  let list = safeRead();
  if (intent) list = list.filter(l => String(l.intent).toLowerCase().includes(String(intent).toLowerCase()));
  if (status) list = list.filter(l => l.status === status);
  return list.slice(-limit).reverse();
}

export function getStats() {
  const list = safeRead();
  const total = list.length;
  const byStatus = {};
  const byIntent = {};
  let totalLatency = 0;
  let latencyCount = 0;
  
  for (const entry of list) {
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    byIntent[entry.intent] = (byIntent[entry.intent] || 0) + 1;
    if (entry.latency) {
      totalLatency += entry.latency;
      latencyCount += 1;
    }
  }
  
  return {
    total,
    byStatus,
    byIntent,
    avgLatency: latencyCount ? Math.round(totalLatency / latencyCount) : null,
    last24h: list.filter(l => Date.now() - l.timestamp < 24 * 60 * 60 * 1000).length
  };
}

export function clearLogs() {
  safeWrite([]);
}
