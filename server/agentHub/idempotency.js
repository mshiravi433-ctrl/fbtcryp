/**
 * FBT EXTERNAL AGENT HUB — task-creation idempotency (§12, §13, §19).
 * ---------------------------------------------------------------------------
 * WHY THE GENERIC HELPER IS NOT ENOUGH
 * `server/idempotency.js` is check-then-save: two concurrent callers both read
 * "no claim", both proceed, and the second write wins. For a leaderboard that
 * self-heals; for a task that a provider may bill, it is a double charge.
 *
 * This module uses the atomic primitive the repo already built for money
 * (`upstashSetIfAbsent` — Redis `SET NX EX`, used by `server/iranBuy.js`):
 * exactly one caller wins the claim, everyone else is told what the winner is
 * doing. Three outcomes, and no fourth:
 *
 *   { mode:'claimed' }                          → you own this key; create once
 *   { replay:true, taskId }                     → already finished; return it
 *   { mode:'in_progress' } / conflict / error    → do NOT create anything
 *
 * WHEN THERE IS NO ATOMIC BACKEND
 * A process-local single-flight map still collapses double-clicks inside one
 * instance, and the claim row is written to the KV store as a second line of
 * defence. That is honestly weaker than Redis across cold starts, so the result
 * carries `durable:false` and the broker refuses account-required and paid
 * tasks without a durable backend before they reach this module.
 */

import { createHash } from 'node:crypto';
import { upstashConfigured, upstashGetAtomic, upstashSetAtomic, upstashSetIfAbsent } from '../blobCache.js';
import { storeGetFresh, storeSet, storeDurable } from '../store.js';

export const IDEMPOTENCY_SCHEMA = 'fbt.agent-hub.idempotency.v1';
export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const claimKey = (owner, agentId, key) => `agent-hub:idem:v1:${hash(`${owner}|${agentId}|${key}`).slice(0, 40)}`;

/** Stable fingerprint of everything that makes two requests "the same request". */
export function fingerprintOf({ owner, agentId, taskText, categories, contextHash }) {
  return hash(JSON.stringify({
    owner,
    agentId,
    text: String(taskText || ''),
    categories: [...(categories || [])].sort(),
    contextHash: contextHash || null
  })).slice(0, 32);
}

export function createTaskIdempotency({ now = () => Date.now(), log = () => {} } = {}) {
  /* One process, one map: collapses a double-click even without Redis. */
  const inFlight = new Map(); // storageKey -> { fingerprint, taskId, at }

  async function claim({ owner, agentId, key, fingerprint }) {
    if (!KEY_RE.test(String(key || ''))) return { ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' };
    const storageKey = claimKey(owner, agentId, key);
    const at = now();

    const local = inFlight.get(storageKey);
    if (local && at - local.at < IDEMPOTENCY_TTL_MS) {
      if (local.fingerprint !== fingerprint) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
      if (local.taskId) return { ok: true, replay: true, taskId: local.taskId, durable: storeDurable() };
      return { ok: false, code: 'REQUEST_IN_PROGRESS', retryAfterMs: 2_000 };
    }

    if (upstashConfigured()) {
      const record = { fingerprint, state: 'CREATING', at };
      const acquired = await upstashSetIfAbsent(storageKey, record, IDEMPOTENCY_TTL_MS);
      if (!acquired) {
        const prior = await upstashGetAtomic(storageKey);
        if (!prior) return { ok: false, code: 'REQUEST_IN_PROGRESS', retryAfterMs: 2_000 };
        if (prior.fingerprint !== fingerprint) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
        if (prior.state === 'COMPLETE' && prior.taskId) return { ok: true, replay: true, taskId: prior.taskId, durable: true };
        if (prior.state === 'FAILED') return { ok: false, code: 'REQUEST_IN_PROGRESS', priorFailed: prior.code || null, retryAfterMs: 2_000 };
        return { ok: false, code: 'REQUEST_IN_PROGRESS', retryAfterMs: 2_000 };
      }
      inFlight.set(storageKey, { fingerprint, taskId: null, at });
      return { ok: true, replay: false, storageKey, mode: 'redis', durable: true };
    }

    /* No Redis: last-writer-wins KV, so the local map is the real lock and the
       stored row is only so a warm instance can still answer a replay. */
    let stored = null;
    try {
      stored = await storeGetFresh(storageKey, null);
    } catch {
      stored = null;
    }
    if (stored && typeof stored === 'object' && now() - Number(stored.at || 0) < IDEMPOTENCY_TTL_MS) {
      if (stored.fingerprint !== fingerprint) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
      if (stored.taskId) return { ok: true, replay: true, taskId: stored.taskId, durable: storeDurable() };
      return { ok: false, code: 'REQUEST_IN_PROGRESS', retryAfterMs: 2_000 };
    }

    inFlight.set(storageKey, { fingerprint, taskId: null, at });
    try {
      await storeSet(storageKey, { fingerprint, state: 'CREATING', at });
    } catch {
      log('agenthub:idempotency:claim-not-durable');
    }
    return { ok: true, replay: false, storageKey, mode: 'kv', durable: storeDurable() };
  }

  async function settle(claimRef, { taskId = null, state = 'COMPLETE', code = null } = {}) {
    if (!claimRef?.storageKey) return { ok: false, code: 'CLAIM_REQUIRED' };
    const record = { fingerprint: claimRef.fingerprint, state, taskId, code, at: now() };
    const local = inFlight.get(claimRef.storageKey);
    if (local) inFlight.set(claimRef.storageKey, { ...local, taskId, state });

    if (claimRef.mode === 'redis') {
      const saved = await upstashSetAtomic(claimRef.storageKey, record, IDEMPOTENCY_TTL_MS);
      return { ok: saved, durable: saved };
    }
    try {
      await storeSet(claimRef.storageKey, record);
      return { ok: true, durable: storeDurable() };
    } catch {
      return { ok: false, code: 'STORE_WRITE_FAILED', durable: false };
    }
  }

  return {
    schema: IDEMPOTENCY_SCHEMA,
    claim,
    complete: (claimRef, taskId) => settle(claimRef, { taskId, state: 'COMPLETE' }),
    fail: (claimRef, code) => settle(claimRef, { taskId: null, state: 'FAILED', code: code || 'FAILED' }),
    /** Test hook: forget local claims so a probe can simulate a cold instance. */
    _reset: () => inFlight.clear()
  };
}
