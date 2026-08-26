/** Read-only client for the public Intent/Solver protocol surface. */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/*
 * Simple in-memory cache with TTL to avoid redundant discovery calls.
 * The capabilities endpoint is public, changes infrequently, and is called
 * from multiple components. A 60-second TTL means the Intent OS page never
 * re-fetches on mount if the swap page already asked for it, and discovery
 * calls are batched across tab switches.
 */
const cache = new Map();
const CACHE_TTL = 60_000; // 60s — matches the server's s-maxage

function cachedGet(path, timeout = 6000) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return Promise.resolve(cached.value);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(`${API_BASE}${path}`, {
    signal: ctrl.signal,
    headers: { accept: 'application/json' }
  }).then((res) => {
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return res.json().then((value) => {
      cache.set(path, { value, at: Date.now() });
      return value;
    });
  }).catch((err) => {
    clearTimeout(timer);
    throw err;
  });
}

export const getIntentCapabilities = () => cachedGet('/intents/v1/capabilities', 6000);
/* Phase 10: read-only approved external-agent discovery. An unavailable
   registry keeps its explicit unavailable status; it is never converted into
   an empty list that looks like "no agents exist". */
export const getExternalAgents = () => cachedGet('/intents/v1/external-agents', 6000);
/* Phase 8: implementation/configuration/operational readiness is distinct
   from protocol capabilities and is safe to cache with the same short TTL. */
export const getIntentActivation = () => cachedGet('/intents/v1/activation', 6000);
/* Authoritative implementation/configuration/operational separation for the
   official specification Phases 10–20. This is read-only and cannot issue a
   permission or make a provider appear live. */
export const getIntentPhaseStatus = () => cachedGet('/intents/v1/phase-status', 6000);
export const getIntentPublicStatus = () => cachedGet('/intents/v1/public-status', 6000);
export const getRegisteredSolvers = () => cachedGet('/intents/v1/solvers', 6000);
export const getBondBoard = () => cachedGet('/intents/v1/bonds', 6000);
export const getAuctionCoordinator = () => cachedGet('/intents/v1/coordinator', 6000);
export const getAnchorNetworks = () => cachedGet('/intents/v1/anchor-networks', 6000);
export const getMerkleAnchorNetworks = () => cachedGet('/intents/v1/merkle-anchor-networks', 6000);
export const getIndependentOperators = () => cachedGet('/intents/v1/operators', 6000);
export const getConfidentialIntentStatus = () => cachedGet('/intents/v1/confidential/operators', 8000);
/* Read-only discovery only. No confidential POST client is exported while the
   authenticated commit/reveal workflow is unavailable. */

/* Uncached GET for non-cacheable intent data (log, auction, admission state). */
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
