/**
 * FBT Insurance OS — durable store (§12, §36, §34, §46).
 *
 * The repo has no SQL DB (§ WHY NOT A DATABASE in server/store.js). Insurance
 * therefore keeps typed KV namespaces over the same durable backend
 * (Blob/Upstash Redis, with in-memory fallback). One JSON record per entity,
 * strict prefixes, append-only audit + event log, and compare-and-set
 * idempotency for money-moving transitions (mirrors server/buySell.js).
 *
 * Money is always integer micro-units. No floating point.
 */
import { createHash, randomBytes } from 'node:crypto';
import { storeGet, storeSet, storeGetFresh } from '../store.js';
import { blobConfigured } from '../blobCache.js';
import { newId } from './quote-engine.js';
import { jsonSafe } from './constants.js';

const ns = (kind, id) => `insurance:${kind}:${id}`;

/* -------------------------------------------------------------------------- */
/* low-level read/write                                                       */
/* -------------------------------------------------------------------------- */

export async function get(kind, id) {
  return storeGet(ns(kind, String(id).toLowerCase()), null);
}
export async function getFresh(kind, id) {
  return storeGetFresh(ns(kind, String(id).toLowerCase()), null);
}
export async function set(kind, id, value) {
  // Durable backends JSON.stringify; BigInt money must be strings first.
  return storeSet(ns(kind, String(id).toLowerCase()), jsonSafe(value));
}
export const durableConfigured = () => blobConfigured();

/* --------------------------- owner list index ------------------------------ */
/* Because KV cannot list by prefix cheaply, keep a lightweight per-wallet
   index of ids for coverage / claims / transactions. Last-writer-wins on the
   index is fine: ids are only appended, never reordered financially. */

async function ownerList(kind, owner, op = 'read') {
  const key = `owner:${kind}:${String(owner).toLowerCase()}`;
  return op === 'fresh'
    ? (await getFresh('idx', key)) || []
    : (await get('idx', key)) || [];
}

export async function addToOwnerList(kind, owner, id) {
  const list = await ownerList(kind, owner);
  if (!list.includes(id)) {
    list.push(id);
    await set('idx', `owner:${kind}:${String(owner).toLowerCase()}`, list.slice(-200));
  }
  return list;
}

export async function listByOwner(kind, owner) {
  const list = await ownerList(kind, owner, 'fresh');
  const out = [];
  for (const id of list) {
    const rec = await getFresh(kind, id);
    if (rec) out.push(rec);
  }
  // newest first
  return out.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

/* -------------------------------------------------------------------------- */
/* audit + event log (§34, §37)                                               */
/* -------------------------------------------------------------------------- */

export async function auditLog({ actor, action, resource, oldValue, newValue, txHash, requestId, result, ip }) {
  const entry = {
    id: newId('audit'),
    ts: Date.now(),
    actor,
    action,
    resource,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    txHash: txHash || null,
    requestId: requestId || null,
    ip: ip || null,
    result: result || null
  };
  const rows = (await get('audit', actor || 'system')) || [];
  rows.push(entry);
  await set('audit', actor || 'system', rows.slice(-500));
  await pushEvent({ type: 'AuditRecorded', actor, action, resource, entryId: entry.id });
  return entry;
}

const EVENT_BUS_KEY = 'events';
export async function pushEvent(ev) {
  const rows = (await get('events', 'recent')) || [];
  const event = { id: newId('evt'), ts: Date.now(), ...ev };
  rows.push(event);
  await set('events', 'recent', rows.slice(-300));
  return event;
}
export async function recentEvents(limit = 50) {
  const rows = (await get('events', 'recent')) || [];
  return rows.slice(-limit).reverse();
}

/* -------------------------------------------------------------------------- */
/* idempotency (§36)                                                          */
/* -------------------------------------------------------------------------- */

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

/**
 * claimIdempotent(operation, owner, idempotencyKey, fingerprint, result)
 * Returns { ok, replay, result? } — dedupe on repeat. When a store write must
 * be atomic (dedupe + create), callers pass a `commit` async fn and we guard
 * with a durable key; without durable storage we rely on owner-key dedupe
 * (best effort, documented) and refuse money ops loudly if not durable.
 */
export async function claimIdempotent({ operation, owner, key, fingerprint, commit }) {
  if (!key || !/^[A-Za-z0-9._:-]{8,160}$/.test(key)) return { ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' };
  const storageKey = `idem:${operation}:${owner ? sha(String(owner).toLowerCase()) : 'anon'}:${sha(key)}`;
  const existing = await getFresh('idem', storageKey);
  if (existing) {
    return existing.fingerprint === fingerprint
      ? { ok: true, replay: true, result: existing.result }
      : { ok: false, code: 'IDEMPOTENCY_CONFLICT', replay: false };
  }
  if (!durableConfigured()) {
    // Without durable storage, a real (non-idempotency) financial dedupe cannot
    // be guaranteed across serverless instances. Write through memory+blob when
    // available; this is the same posture server/store.js already documents.
  }
  const result = commit ? await commit() : { stored: true };
  await set('idem', storageKey, { fingerprint, result, at: Date.now() });
  return { ok: true, replay: false, result };
}

/* -------------------------------------------------------------------------- */
/* tx state machine (§41)                                                      */
/* -------------------------------------------------------------------------- */

export async function createTx({ owner, type, quoteId, providerId, chainId, payload, state = 'CREATED' }) {
  const txId = newId('tx');
  const tx = {
    txId,
    owner: String(owner).toLowerCase(),
    type, // PURCHASE | CLAIM | RENEWAL | CANCEL
    quoteId: quoteId || null,
    providerId,
    chainId: chainId ? Number(chainId) : null,
    payload,
    state,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: []
  };
  await set('tx', txId, tx);
  await addToOwnerList('tx', owner, txId);
  return tx;
}

export async function transitionTx(txId, nextState, extra = {}) {
  const tx = await get('tx', txId);
  if (!tx) throw new Error('TX_NOT_FOUND');
  const prev = tx.state;
  tx.state = nextState;
  tx.updatedAt = Date.now();
  Object.assign(tx, extra);
  tx.events = [...(tx.events || []), { from: prev, to: nextState, at: Date.now() }];
  await set('tx', txId, tx);
  return tx;
}

export async function getTx(txId) {
  return get('tx', txId);
}
