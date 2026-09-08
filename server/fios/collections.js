/**
 * FBT FINANCIAL INTELLIGENCE OS — persistence (§46).
 * ---------------------------------------------------------------------------
 * WHY THERE IS STILL NO SQL HERE
 * The repository's database architecture is a key-value store
 * (`server/store.js`: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, an
 * in-process Map when it is not) and `server/financialGoals.js` already
 * established the convention of implementing "tables" as key namespaces. The
 * FI collections follow it exactly, under the specified names:
 *
 *   fi:<collection>:v1:<owner>   →  an array of rows
 *
 * Nothing here destroys existing data: writes are additive to a collection
 * this module owns, keys are versioned (`v1`), and rows are capped per
 * collection so a long-lived process cannot grow a key without bound.
 *
 * Every response reports `durable`. Without the blob token the rows live only
 * in this process, and the API says so instead of implying cloud storage.
 */
import { storeGet, storeSet, storeDurable } from '../store.js';

export const COLLECTIONS_SCHEMA = 'fbt.fi.collections.v1';

/** §46 — the requested tables, as key namespaces. */
export const COLLECTIONS = Object.freeze([
  'financial_state', 'world_state_snapshot', 'preferences', 'behavior_signals',
  'intent_genome', 'evidence', 'research', 'strategies', 'strategy_comparisons',
  'simulations', 'decisions', 'policies', 'decision_traces', 'learning_outcomes',
  'agent_trust', 'guardian_events'
]);

/** Per-collection row caps. Small on purpose: these are decision records,
 *  not a ledger of every price tick. */
const CAPS = Object.freeze({
  financial_state: 60, world_state_snapshot: 40, preferences: 1, behavior_signals: 1,
  intent_genome: 1, evidence: 300, research: 60, strategies: 120,
  strategy_comparisons: 60, simulations: 80, decisions: 80, policies: 40,
  decision_traces: 80, learning_outcomes: 120, agent_trust: 60, guardian_events: 200
});

const isCollection = (name) => COLLECTIONS.includes(String(name));
const ownerKey = (owner) => String(owner || 'anon').slice(0, 80);

export function createCollections({ prefix = 'fi', version = 'v1', log = () => {} } = {}) {
  const keyFor = (collection, owner) => `${prefix}:${collection}:${version}:${ownerKey(owner)}`;
  const cache = new Map(); // `${collection}|${owner}` -> {rows, at}
  const CACHE_MS = 5_000;

  async function read(collection, owner) {
    if (!isCollection(collection)) return { ok: false, code: 'UNKNOWN_COLLECTION', rows: [] };
    const k = `${collection}|${ownerKey(owner)}`;
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) return { ok: true, rows: hit.rows, durable: storeDurable() };
    let rows = [];
    try {
      const stored = await storeGet(keyFor(collection, owner), null);
      if (Array.isArray(stored)) rows = stored;
      else if (stored && Array.isArray(stored.rows)) rows = stored.rows;
    } catch (err) {
      log(`collections:read-failed:${collection}:${String(err?.message || err).slice(0, 80)}`);
      return { ok: false, code: 'STORE_READ_FAILED', rows: [], durable: storeDurable() };
    }
    cache.set(k, { rows, at: Date.now() });
    return { ok: true, rows, durable: storeDurable() };
  }

  async function write(collection, owner, rows) {
    if (!isCollection(collection)) return { ok: false, code: 'UNKNOWN_COLLECTION' };
    const cap = CAPS[collection] || 60;
    const capped = (Array.isArray(rows) ? rows : []).slice(0, cap);
    const k = `${collection}|${ownerKey(owner)}`;
    cache.set(k, { rows: capped, at: Date.now() });
    try {
      await storeSet(keyFor(collection, owner), { schema: COLLECTIONS_SCHEMA, collection, savedAt: Date.now(), rows: capped });
      return { ok: true, count: capped.length, durable: storeDurable() };
    } catch (err) {
      log(`collections:write-failed:${collection}:${String(err?.message || err).slice(0, 80)}`);
      /* The in-process copy is kept: the turn still works, and the response
         reports durable:false so nobody believes it was saved. */
      return { ok: false, code: 'STORE_WRITE_FAILED', count: capped.length, durable: false };
    }
  }

  /** Append-or-replace by id. Returns the stored row. */
  async function put(collection, owner, row, { idKey = 'id' } = {}) {
    if (!row || typeof row !== 'object') return { ok: false, code: 'ROW_REQUIRED' };
    const { ok, rows, code } = await read(collection, owner);
    if (!ok) return { ok: false, code };
    const id = row[idKey];
    const next = id
      ? [row, ...rows.filter((r) => r?.[idKey] !== id)]
      : [row, ...rows];
    const res = await write(collection, owner, next);
    return { ...res, row };
  }

  async function get(collection, owner, id, { idKey = 'id' } = {}) {
    const { ok, rows, code } = await read(collection, owner);
    if (!ok) return { ok: false, code, row: null };
    const row = rows.find((r) => String(r?.[idKey] ?? '') === String(id ?? '')) || null;
    return { ok: Boolean(row), row, code: row ? null : 'NOT_FOUND', durable: storeDurable() };
  }

  async function remove(collection, owner, id, { idKey = 'id' } = {}) {
    const { ok, rows, code } = await read(collection, owner);
    if (!ok) return { ok: false, code };
    const next = rows.filter((r) => String(r?.[idKey] ?? '') !== String(id ?? ''));
    const res = await write(collection, owner, next);
    return { ...res, removed: rows.length - next.length };
  }

  return {
    schema: COLLECTIONS_SCHEMA,
    collections: COLLECTIONS,
    caps: CAPS,
    read, write, put, get, remove,
    durable: () => storeDurable(),
    keyFor,
    /** Test/ops hook: drop the warm cache so the next read hits the store. */
    invalidate: (collection = null, owner = null) => {
      if (!collection) { cache.clear(); return; }
      cache.delete(`${collection}|${ownerKey(owner)}`);
    }
  };
}
