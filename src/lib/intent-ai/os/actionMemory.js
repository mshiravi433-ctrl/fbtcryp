/**
 * FBT INTENT OS — Action Memory
 * ---------------------------------------------------------------------------
 * Spec §13: Every real action stored
 * intent, tools, inputs, result, status, duration, timestamp
 */

export const ACTION_MEMORY_SCHEMA = 'fbt.ai-action-memory.v1';

const KEY = 'fbt.memory.actions.v1';
const MAX = 100;

function safeRead() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
    return true;
  } catch {
    return false;
  }
}

export function createActionMemory({
  intent = null,
  tools = [],
  inputs = {},
  result = null,
  status = 'pending',
  duration = null,
  route = null,
  provider = null
} = {}) {
  const now = Date.now();
  return {
    id: `act_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    schema: ACTION_MEMORY_SCHEMA,
    intent: typeof intent === 'string' ? intent : (intent?.type || intent?.id || 'unknown'),
    intentDetail: intent,
    tools: Array.isArray(tools) ? tools : [tools],
    inputs: sanitizeInputs(inputs),
    result: sanitizeResult(result),
    status,
    duration,
    timestamp: now,
    iso: new Date(now).toISOString(),
    route,
    provider
  };
}

// Never store private keys
function sanitizeInputs(inputs) {
  if (!inputs || typeof inputs !== 'object') return inputs;
  const forbidden = ['privateKey', 'seedPhrase', 'mnemonic', 'secret', 'password', 'private_key'];
  const out = { ...inputs };
  for (const key of forbidden) {
    if (key in out) delete out[key];
    // Check nested
    for (const k of Object.keys(out)) {
      if (typeof out[k] === 'object' && out[k] && key in out[k]) {
        delete out[k][key];
      }
    }
  }
  return out;
}

function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  // Keep only safe fields
  const safe = {};
  const allowed = ['ok', 'status', 'txHash', 'hash', 'signature', 'amount', 'symbol', 'route', 'provider', 'success', 'error', 'code', 'message'];
  for (const key of allowed) {
    if (key in result) safe[key] = result[key];
  }
  // Truncate message
  if (safe.message) safe.message = String(safe.message).slice(0, 200);
  return safe;
}

export function saveActionMemory(entry) {
  const list = safeRead();
  list.push(entry);
  safeWrite(list);
  return entry;
}

export function getActionMemories({ intent = null, status = null, limit = 20 } = {}) {
  let list = safeRead();
  if (intent) {
    const t = String(intent).toLowerCase();
    list = list.filter(m => String(m.intent).toLowerCase().includes(t));
  }
  if (status) {
    list = list.filter(m => m.status === status);
  }
  return list.slice(-limit).reverse();
}

export function getLastActionForIntent(intentType) {
  const list = safeRead();
  const t = String(intentType || '').toLowerCase();
  for (let i = list.length - 1; i >= 0; i--) {
    if (String(list[i].intent).toLowerCase().includes(t)) {
      return list[i];
    }
  }
  return null;
}

export function clearActionMemories() {
  safeWrite([]);
}
