/** Read-only client for the public Intent/Solver protocol surface. */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

async function get(path, timeout = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const getIntentCapabilities = () => get('/intents/v1/capabilities');
export const getRegisteredSolvers = () => get('/intents/v1/solvers');

export function getTransparencyLog(intentHash) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(intentHash || ''))) {
    return Promise.reject(new Error('BAD_INTENT_HASH'));
  }
  return get(`/intents/v1/log/${String(intentHash).toLowerCase()}`);
}
