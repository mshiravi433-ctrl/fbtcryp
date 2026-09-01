/**
 * LENDING ENGINE — duplicate-transaction protection (§17 of the spec).
 * ---------------------------------------------------------------------------
 * Two layers, both enforced in code:
 *
 *   1. An in-flight guard in the client: while a request with a given key is
 *      running, `tryAcquire` refuses a second one — so double-tapping
 *      "Supply" can never build two transactions. The button also renders its
 *      pending state, but the guard is what actually protects.
 *
 *   2. A deterministic idempotency key: the same action + wallet + asset +
 *      amount + chain produces the SAME key, so a backend (or a retry
 *      pipeline) can recognise a replay without trusting the client's word.
 *
 * `makeIdempotencyKey` is content-derived and browser-safe (no node:crypto).
 * It is a dedup fingerprint, NOT a secret, NOT a signature.
 */

const randomId = (prefix, len = 12) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    id = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  } else {
    for (let i = 0; i < len; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}_${id}`;
};

/** A unique request id for one execution attempt. */
export function makeRequestId() {
  return randomId('lnd');
}

/** FNV-1a over a UTF-8 string → hex. Small, deterministic, dependency-free. */
const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/**
 * Deterministic idempotency key. Same inputs → same key:
 *   lnd_<action>_<chain>_<hash(wallet|asset|amount)>
 */
export function makeIdempotencyKey({ action, wallet, asset, amount, chainId }) {
  const content = [
    String(action || 'supply').toLowerCase(),
    String(wallet || '').toLowerCase(),
    String(asset || '').toLowerCase(),
    String(amount ?? ''),
    String(chainId ?? '')
  ].join('|');
  return `lnd_${String(action || 'supply').toLowerCase()}_${String(chainId ?? '0')}_${fnv1a(content)}`;
}

/**
 * Client-side in-flight guard. `tryAcquire` wins exactly once per key; the
 * winner MUST call `release` in a finally block, or the key stays locked for
 * `ttlMs` (default 5 min) as a stuck-transaction safety net.
 */
export function createInFlightGuard({ ttlMs = 5 * 60 * 1000 } = {}) {
  const busy = new Map(); // key → { at, requestId }

  const sweep = () => {
    const now = Date.now();
    for (const [key, entry] of busy) {
      if (now - entry.at > ttlMs) busy.delete(key);
    }
  };

  return {
    tryAcquire(key, requestId = null) {
      sweep();
      if (!key || busy.has(key)) return { ok: false, code: 'IDEMPOTENCY_CONFLICT', requestId: busy.get(key)?.requestId ?? null };
      const entry = { at: Date.now(), requestId: requestId ?? makeRequestId() };
      busy.set(key, entry);
      return { ok: true, requestId: entry.requestId };
    },
    release(key) {
      if (!key) return;
      busy.delete(key);
    },
    isBusy(key) {
      sweep();
      return key ? busy.has(key) : false;
    },
    busyCount() {
      sweep();
      return busy.size;
    },
    snapshot() {
      sweep();
      return [...busy.entries()].map(([key, entry]) => ({ key, requestId: entry.requestId, at: entry.at }));
    }
  };
}

/**
 * Server-side replay registry (memory-backed): `check` returns
 * { replay:true, stored } when the same key was already completed, and
 * `remember` stores a completed result. A production deployment swaps the
 * Map for a durable store; the contract stays identical.
 */
export function createIdempotencyStore({ ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  const store = new Map();
  const sweep = () => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.at > ttlMs) store.delete(key);
    }
  };
  return {
    check(key) {
      sweep();
      return key && store.has(key) ? { replay: true, stored: store.get(key).result } : { replay: false };
    },
    remember(key, result) {
      sweep();
      if (!key) return;
      store.set(key, { at: Date.now(), result });
    },
    forget(key) { store.delete(key); },
    size() { sweep(); return store.size; }
  };
}
