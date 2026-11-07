/**
 * FBT NEUROMORPHIC 2050 — PHASE 2: EPISODIC ENGRAMS & SOVEREIGN PERSISTENCE
 * ===========================================================================
 * Stores compressed synaptic snapshots and episodic liquid-state engrams on
 * the user's device (IndexedDB primary, localStorage fallback) with:
 *   · Integrity verification (FNV-1a 32-bit digest)
 *   · Strict credential rejection (`containsSensitiveKeyOrPhrase`)
 *   · Hard memory cap (max 64 episodic engrams, <256 KB total)
 *   · Cosine-similarity associative recall ("What happened the last time my
 *     liquid cortex fired in this exact pattern?")
 *   · True one-click sovereign wipe (`wipeLocalCortex`)
 *
 * PHASE 6/7 addition: the same checksummed envelope also carries the cortex
 * snapshot (`cortex.v3`) and, when present, the Universal Scientific Memory
 * state (`fbt.neuromorphic.science.v1`). The science block is OPTIONAL: an old
 * bundle without it still loads, and a bundle whose science block would push
 * the record past the local budget simply drops that block instead of silently
 * exceeding the 256 KB cap.
 */

/** Hard local budget for one cortex bundle (engrams + snapshot + science). */
export const MAX_BUNDLE_CHARS = 240_000;
/** Science records are capped separately so they can never starve the engrams. */
export const MAX_SCIENCE_CHARS = 120_000;

import { LIQUID_SIZE } from './cortexCore.js';
import { containsSensitiveKeyOrPhrase } from '../intent-ai/orchestrator/redact.js';

export const ENGRAM_STORAGE_SCHEMA = 'fbt.neuromorphic.engram.v1';
export const STORAGE_KEY = 'fbt.neuromorphic.cortex.v1';
const IDB_NAME = 'fbt_neuromorphic_2050';
const IDB_STORE = 'engrams';
const MAX_EPISODES = 64;

/** Deterministic 32-bit FNV-1a checksum so corrupted local records are discarded. */
export function fnv1aHex(text) {
  const str = String(text || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function cosineSim(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na * nb);
  return denom > 1e-8 ? dot / denom : 0;
}

/**
 * Episodic Engram Bank: associative memory over 24-D Liquid ODE states.
 */
export function createEngramMemory(initialEpisodes = []) {
  let episodes = [];

  if (Array.isArray(initialEpisodes)) {
    episodes = initialEpisodes
      .filter((e) => e && Array.isArray(e.vector) && e.vector.length === LIQUID_SIZE && Number.isFinite(Number(e.realizedReturn)))
      .slice(-MAX_EPISODES)
      .map((e) => ({
        vector: e.vector.map((v) => Number(Number(v).toFixed(4))),
        realizedReturn: Number(Number(e.realizedReturn).toFixed(6)),
        regime: String(e.regime || 'meanRevert').slice(0, 24),
        symbol: e.symbol ? String(e.symbol).slice(0, 16) : null,
        at: Number(e.at) || 0
      }));
  }

  /** Record a resolved market episode (only when real realizedReturn is known!). */
  function imprint({ liquidState, realizedReturn, regime = 'meanRevert', symbol = null, at = Date.now() } = {}) {
    if (!liquidState || liquidState.length !== LIQUID_SIZE) return { ok: false, code: 'INVALID_VECTOR' };
    const ret = Number(realizedReturn);
    if (!Number.isFinite(ret)) return { ok: false, code: 'MISSING_REALIZED_OUTCOME' };
    if (symbol && containsSensitiveKeyOrPhrase(symbol)) return { ok: false, code: 'SECRET_INPUT_REJECTED' };

    const vec = Array.from(liquidState, (v) => Number(Number(v).toFixed(4)));

    // Deduplicate near-identical consecutive engrams (cosine > 0.985) by blending outcome
    for (let i = episodes.length - 1; i >= Math.max(0, episodes.length - 8); i -= 1) {
      if (cosineSim(episodes[i].vector, vec) > 0.985) {
        episodes[i].realizedReturn = Number((episodes[i].realizedReturn * 0.65 + ret * 0.35).toFixed(6));
        episodes[i].at = Number(at) || Date.now();
        return { ok: true, merged: true, count: episodes.length };
      }
    }

    episodes.push({
      vector: vec,
      realizedReturn: Number(ret.toFixed(6)),
      regime: String(regime || 'meanRevert').slice(0, 24),
      symbol: symbol ? String(symbol).toUpperCase().slice(0, 16) : null,
      at: Number(at) || Date.now()
    });
    if (episodes.length > MAX_EPISODES) {
      episodes = episodes.slice(-MAX_EPISODES);
    }
    return { ok: true, merged: false, count: episodes.length };
  }

  /** Associative recall of top-K past liquid episodes most similar to current state. */
  function recall(liquidState, { topK = 3, minSimilarity = 0.68 } = {}) {
    if (!liquidState || liquidState.length !== LIQUID_SIZE || episodes.length === 0) {
      return { matches: [], expectedReturn: null, totalEngrams: episodes.length };
    }
    const scored = [];
    for (const ep of episodes) {
      const sim = cosineSim(liquidState, ep.vector);
      if (sim >= minSimilarity) {
        scored.push({ ...ep, similarity: Number(sim.toFixed(4)) });
      }
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    const matches = scored.slice(0, Math.max(1, topK));
    if (!matches.length) {
      return { matches: [], expectedReturn: null, totalEngrams: episodes.length };
    }
    let wSum = 0;
    let rSum = 0;
    for (const m of matches) {
      wSum += m.similarity;
      rSum += m.similarity * m.realizedReturn;
    }
    return {
      matches,
      expectedReturn: wSum > 0 ? Number((rSum / wSum).toFixed(6)) : null,
      totalEngrams: episodes.length
    };
  }

  function exportEpisodes() {
    return episodes.slice();
  }

  function clear() {
    episodes = [];
  }

  return { imprint, recall, exportEpisodes, clear, size: () => episodes.length };
}

/* ── IndexedDB + localStorage Sovereign Persistence ───────────────────────── */

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('NO_INDEXEDDB'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB_OPEN_FAILED'));
  });
}

export async function saveLocalCortexBundle({
  cortexSnapshot,
  episodes = [],
  science = null,
  savedAt = Date.now()
} = {}) {
  if (!cortexSnapshot || typeof cortexSnapshot !== 'object') {
    return { ok: false, code: 'EMPTY_SNAPSHOT' };
  }
  const payloadObj = {
    schema: ENGRAM_STORAGE_SCHEMA,
    savedAt: Number(savedAt) || Date.now(),
    cortex: cortexSnapshot,
    episodes: Array.isArray(episodes) ? episodes.slice(-MAX_EPISODES) : []
  };
  let scienceDropped = false;
  if (science && typeof science === 'object') {
    const scienceJson = JSON.stringify(science);
    if (scienceJson.length <= MAX_SCIENCE_CHARS) {
      payloadObj.science = science;
    } else {
      scienceDropped = true;
    }
  }
  let bodyJson = JSON.stringify(payloadObj);
  if (bodyJson.length > MAX_BUNDLE_CHARS && payloadObj.science) {
    delete payloadObj.science;
    scienceDropped = true;
    bodyJson = JSON.stringify(payloadObj);
  }
  if (containsSensitiveKeyOrPhrase(bodyJson)) {
    return { ok: false, code: 'SECRET_INPUT_REJECTED' };
  }
  if (bodyJson.length > MAX_BUNDLE_CHARS) {
    return { ok: false, code: 'BUNDLE_TOO_LARGE', bytes: bodyJson.length };
  }
  const checksum = fnv1aHex(bodyJson);
  const envelope = JSON.stringify({ checksum, payload: payloadObj });

  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(envelope, STORAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { ok: true, backend: 'indexeddb', bytes: envelope.length, checksum, scienceDropped };
  } catch {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, envelope);
        return { ok: true, backend: 'localstorage', bytes: envelope.length, checksum, scienceDropped };
      }
    } catch { /* quota or SSR */ }
  }
  return { ok: false, code: 'STORAGE_UNAVAILABLE' };
}

export async function loadLocalCortexBundle() {
  let raw = null;
  let backend = 'none';
  try {
    const db = await openIdb();
    raw = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
    db.close();
    if (raw) backend = 'indexeddb';
  } catch {
    /* fall through to localStorage */
  }

  if (!raw) {
    try {
      if (typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(STORAGE_KEY);
        if (raw) backend = 'localstorage';
      }
    } catch { /* ignore */ }
  }

  if (!raw || typeof raw !== 'string') {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  try {
    const parsed = JSON.parse(raw);
    const bodyJson = JSON.stringify(parsed?.payload);
    if (!parsed?.checksum || fnv1aHex(bodyJson) !== parsed.checksum) {
      return { ok: false, reason: 'CHECKSUM_MISMATCH' };
    }
    if (parsed.payload?.schema !== ENGRAM_STORAGE_SCHEMA) {
      return { ok: false, reason: 'SCHEMA_MISMATCH' };
    }
    return { ok: true, backend, bundle: parsed.payload, checksum: parsed.checksum };
  } catch {
    return { ok: false, reason: 'CORRUPT_JSON' };
  }
}

export async function wipeLocalCortexBundle() {
  let wiped = false;
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(STORAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    wiped = true;
  } catch { /* ignore */ }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      wiped = true;
    }
  } catch { /* ignore */ }
  return { ok: true, wiped };
}
