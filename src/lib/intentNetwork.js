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
export const getAuctionCoordinator = () => get('/intents/v1/coordinator');
export const getAnchorNetworks = () => get('/intents/v1/anchor-networks');

function checkedIntentHash(intentHash) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(intentHash || ''))) throw new Error('BAD_INTENT_HASH');
  return String(intentHash).toLowerCase();
}

export function getTransparencyLog(intentHash) {
  try { return get(`/intents/v1/log/${checkedIntentHash(intentHash)}`); }
  catch (error) { return Promise.reject(error); }
}

export function getAuctionState(intentHash) {
  try { return get(`/intents/v1/auctions/${checkedIntentHash(intentHash)}`); }
  catch (error) { return Promise.reject(error); }
}
