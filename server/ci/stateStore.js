/**
 * FBT CENTRAL INTELLIGENCE OS — Central State store (spec §4, §16, §17, §35).
 * ---------------------------------------------------------------------------
 * Holds ONE Unified System State per owner, feeds it from real module reads,
 * and mirrors it to durable storage when a store is configured.
 *
 * ─── WHY THE DURABLE MIRROR IS BEST-EFFORT AND SAYS SO ─────────────────────
 * `store.js` persists through Vercel Blob; without `BLOB_READ_WRITE_TOKEN` it is
 * per-instance. The state carried here is a PROJECTION of services that remain
 * the source of truth (the chain, the aggregator, the protocol), so losing it on
 * a cold start costs a refresh, not money. `durable` is therefore reported in
 * every snapshot — an operator and the UI both see whether memory survives,
 * rather than being told a promise the deployment cannot keep.
 *
 * Nothing sensitive is mirrored: addresses are stored as short digests, and
 * `redact()` strips anything key-shaped before a snapshot leaves the process,
 * because §35's "never log a private key" is only real if it is one function
 * that everything must pass through.
 */
import { CI_SCHEMA, STATE_SECTION_IDS } from '../../src/lib/central/schema.js';
import { createSystemState, writeSection, markSectionFailure, freshness, stateSnapshot } from '../../src/lib/central/state.js';
import { storeGet, storeSet, storeDurable } from '../store.js';
import { createHash } from 'node:crypto';

export const STATE_STORE_SCHEMA = 'fbt.central-state-store.v1';
const KEY = (owner) => `ci:state:v1:${owner}`;
const MAX_OWNERS = 500;
const WRITE_THROTTLE_MS = 4_000;

const KEYISH = /(?:private[ _-]?key|secret[ _-]?phrase|mnemonic|seed[ _-]?phrase|passphrase|x[-_]?prv|signature|authorization)/i;

/** Redact before ANY persistence or logging (§35). Idempotent and cheap. */
export function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return KEYISH.test(value) ? '[REDACTED]' : value.slice(0, 4_000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 60).map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 80)) {
      if (KEYISH.test(k)) { out[k] = '[REDACTED]'; continue; }
      if (typeof v === 'string' && /^(0x)?[0-9a-fA-F]{64,}$/.test(v) && !/hash|tx|digest/i.test(k)) { out[k] = `[digest ${createHash('sha256').update(v).digest('hex').slice(0, 10)}]`; continue; }
      out[k] = redact(v);
    }
    return out;
  }
  return String(value).slice(0, 200);
}

export function createCentralStateStore({ log = () => {} } = {}) {
  const owners = new Map();
  const lastWrite = new Map();

  function scope(owner) {
    const key = String(owner || 'anon').slice(0, 80);
    if (!owners.has(key)) {
      if (owners.size >= MAX_OWNERS) {
        /* Bounded on purpose: an unbounded per-owner map in a long-lived process
           is a memory leak dressed as a cache. The oldest idle owner is dropped;
           its state rebuilds from services on the next request. */
        const oldest = [...owners.entries()].sort((a, b) => (a[1].lastTouched || 0) - (b[1].lastTouched || 0))[0];
        if (oldest) owners.delete(oldest[0]);
      }
      owners.set(key, { state: createSystemState({ owner: key, now: Date.now() }), hydrated: false, lastTouched: Date.now() });
    }
    const entry = owners.get(key);
    entry.lastTouched = Date.now();
    return entry;
  }

  async function hydrate(owner) {
    const entry = scope(owner);
    if (entry.hydrated) return entry.state;
    entry.hydrated = true;
    if (!storeDurable()) return entry.state;
    try {
      const stored = await storeGet(KEY(owner), null);
      if (stored?.sections) {
        let state = entry.state;
        for (const key of STATE_SECTION_IDS) {
          const section = stored.sections[key];
          if (!section?.data) continue;
          /* A mirror is a STARTING POINT, not a fresh read: it is applied at its
             own timestamp so the freshness gate in policy still treats it as stale
             until a module re-reads it. Re-stamping it to "now" would be the one
             way to make a cold start look like a live session. */
          state = writeSection(state, key, { data: section.data, source: section.source, status: section.status, now: section.updatedAt || 0 }).state;
        }
        entry.state = state;
      }
    } catch (error) {
      log('hydrate-failed', String(error?.message || error).slice(0, 120));
    }
    return entry.state;
  }

  async function persist(owner, state) {
    if (!storeDurable()) return { persisted: false, reason: 'NO_DURABLE_STORE' };
    const last = lastWrite.get(owner) || 0;
    if (Date.now() - last < WRITE_THROTTLE_MS) return { persisted: false, reason: 'THROTTLED' };
    lastWrite.set(owner, Date.now());
    try {
      await storeSet(KEY(owner), { schema: STATE_STORE_SCHEMA, brain: CI_SCHEMA, owner: null, revision: state.revision, savedAt: Date.now(), sections: compactSections(state) });
      return { persisted: true };
    } catch (error) {
      log('persist-failed', String(error?.message || error).slice(0, 120));
      return { persisted: false, reason: 'STORE_WRITE_FAILED' };
    }
  }

  return {
    schema: STATE_STORE_SCHEMA,
    get: async (owner) => hydrate(owner),
    peek: (owner) => scope(owner).state,
    scope,
    async write(owner, key, patch) {
      const entry = scope(owner);
      const res = writeSection(entry.state, key, patch);
      entry.state = res.state;
      return res;
    },
    async fail(owner, key, reason) {
      const entry = scope(owner);
      entry.state = markSectionFailure(entry.state, key, reason);
      return entry.state;
    },
    async replace(owner, state) {
      const entry = scope(owner);
      entry.state = state;
      return state;
    },
    freshness: (owner, key, now = Date.now()) => freshness(scope(owner).state, key, now),
    snapshot: async (owner, { includeData = true } = {}) => {
      const state = scope(owner).state;
      const snap = stateSnapshot(state, Date.now());
      if (!includeData) return { ...snap, sections: Object.fromEntries(Object.keys(snap.sections).map((k) => [k, { freshness: snap.sections[k].freshness, updatedAt: snap.sections[k].updatedAt, source: snap.sections[k].source }])) };
      return { ...redact(snap), durable: storeDurable(), revision: state.revision, pendingRefreshes: state.dirty || [] };
    },
    persist,
    /** The sections a turn may read WITHOUT a re-fetch, and which must refresh. */
    plan: (owner, needed, now = Date.now()) => {
      const state = scope(owner).state;
      const fresh = [];
      const refresh = [];
      for (const key of needed) {
        const f = freshness(state, key, now);
        (f.status === 'LIVE' || f.status === 'PARTIAL' ? fresh : refresh).push(key);
      }
      return { fresh, refresh, state };
    },
    stats: () => ({ owners: owners.size, durable: storeDurable(), brain: CI_SCHEMA }),
    clear: (owner) => owners.delete(String(owner || 'anon').slice(0, 80))
  };
}

function compactSections(state) {
  const out = {};
  for (const key of STATE_SECTION_IDS) {
    const s = state.sections[key];
    if (!s || s.data == null) continue;
    out[key] = { data: s.data, source: s.source, status: s.status, updatedAt: s.updatedAt, revision: s.revision };
  }
  return out;
}
