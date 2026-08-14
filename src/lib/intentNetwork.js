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
/* Read-only discovery only. No confidential POST client is exported while the
   authenticated commit/reveal workflow is unavailable. */
export const getConfidentialIntentStatus = () => get('/intents/v1/confidential/operators', 8000);
export const getRegisteredSolvers = () => get('/intents/v1/solvers');
export const getAuctionCoordinator = () => get('/intents/v1/coordinator');
export const getAnchorNetworks = () => get('/intents/v1/anchor-networks');
export const getMerkleAnchorNetworks = () => get('/intents/v1/merkle-anchor-networks');
export const getIndependentOperators = () => get('/intents/v1/operators');
export const getBondBoard = () => get('/intents/v1/bonds');

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

export function getCrossChainState(stateId) {
  try { return get(`/intents/v1/cross-chain/states/${checkedIntentHash(stateId)}`); }
  catch (error) { return Promise.reject(error); }
}

function checkedEntryHash(entryHash) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(entryHash || ''))) throw new Error('BAD_ENTRY_HASH');
  return String(entryHash).toLowerCase();
}

/* Deterministic coordinator-signed admission receipt for one logged entry. */
export function getAdmissionReceipt(intentHash, entryHash) {
  return get(`/intents/v1/admissions/${checkedIntentHash(intentHash)}/${checkedEntryHash(entryHash)}`);
}

/* Verified watcher reports + the derived per-auction completeness status. */
export function getWatcherReports(intentHash) {
  try { return get(`/intents/v1/auctions/${checkedIntentHash(intentHash)}/watcher-reports`); }
  catch (error) { return Promise.reject(error); }
}

/* Phase 3a: the winning solver's signed execution claim for a sealed close. */
export function getExecutionClaim(intentHash) {
  try { return get(`/intents/v1/auctions/${checkedIntentHash(intentHash)}/execution-claim`); }
  catch (error) { return Promise.reject(error); }
}

/* Phase 3a: the coordinator-signed outcome adjudication (penalty evidence). */
export function getAdjudication(intentHash) {
  try { return get(`/intents/v1/auctions/${checkedIntentHash(intentHash)}/adjudication`); }
  catch (error) { return Promise.reject(error); }
}

/* Phase 3b: independent verifier settlement reports + the derived per-auction
   settlement status (promised vs delivered, adjudication cross-check). */
export function getSettlementReports(intentHash) {
  try { return get(`/intents/v1/auctions/${checkedIntentHash(intentHash)}/settlement-reports`); }
  catch (error) { return Promise.reject(error); }
}
