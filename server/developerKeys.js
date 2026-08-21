/**
 * DEVELOPER API KEYS — creation, revocation and, now, actual authentication.
 *
 * WHAT CHANGED AND WHY IT MATTERED
 * ---------------------------------------------------------------------------
 * Keys used to be issued and hashed correctly and then never checked by
 * anything: no middleware ever turned a `Authorization: Bearer fbt_sandbox_…`
 * header back into an identity, so a "revoked" key was revoked in a list
 * nobody read. A credential that cannot be verified is not a credential, and
 * worse, it advertises a security control that does not exist.
 *
 * `authenticateApiKey()` closes that gap. Three properties are deliberate:
 *
 *   1. ONLY THE HASH IS STORED. The secret is shown once at creation and is
 *      irrecoverable; verification hashes the presented secret and compares.
 *   2. LOOKUP IS BY HASH, NOT BY SCAN. `developer-key-index:v1:<sha256>` maps
 *      the hash to { owner, projectId, keyId } so authentication is one read
 *      instead of walking every owner's key list (which would be both slow and
 *      a timing oracle).
 *   3. REVOCATION IS AUTHORITATIVE AT BOTH ENDS. Revoking marks the record and
 *      the index entry, and authentication rejects if either says revoked, so
 *      a stale index can only ever fail closed.
 *
 * `lastUsedAt` is throttled: a durable write per authenticated request would
 * turn a read endpoint into a write endpoint. It is refreshed at most once
 * every few minutes, which is enough to answer "is this key still in use".
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import { storeGet, storeSet } from './store.js';

const key = (owner, projectId) => `developer-keys:v1:${owner}:${projectId}`;
const indexKey = (secretHash) => `developer-key-index:v1:${secretHash}`;
/*
 * `manage_listings` is the only scope that can change server state, and all it
 * can change is a self-reported catalog entry. There is deliberately no
 * `sign`, `execute`, `withdraw` or `settle` scope: no API key may ever move
 * funds or act for a user.
 */
const scopes = new Set(['read_network', 'create_intent', 'request_quote', 'request_simulation', 'manage_listings']);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const SECRET = /^fbt_sandbox_[A-Za-z0-9_-]{20,64}$/;
const LAST_USED_THROTTLE_MS = 5 * 60_000;

/*
 * The storage seam. Same shape and same reason as server/ecosystemRegistry.js:
 * tests exercise issue → authenticate → revoke against an in-memory store
 * instead of mocking the module graph, and production passes nothing.
 */
const durableStore = Object.freeze({ durable: blobConfigured, get: storeGet, set: storeSet });
export function memoryKeyStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    durable: () => true,
    get: async (k, fallback = null) => (map.has(k) ? map.get(k) : fallback),
    set: async (k, value) => { map.set(k, value); return value; },
    raw: map
  };
}

export const apiKeyScopes = () => [...scopes];
/** Shape check only. Lets a route reject a junk bearer with 401 even when the
    key store is unreachable, instead of a misleading 503. */
export const looksLikeApiKey = (value) => typeof value === 'string' && SECRET.test(value);

export async function createApiKey(owner, project, input = {}, store = durableStore) {
  if (!store.durable()) return { ok: false, code: 'PROJECT_STORE_UNAVAILABLE' };
  const requested = Array.isArray(input.scopes) ? [...new Set(input.scopes.filter((s) => scopes.has(s)))] : [];
  if (!requested.length || requested.some((s) => !project.scopes.includes(s))) return { ok: false, code: 'SCOPE_NOT_ALLOWED' };
  const rows = await store.get(key(owner, project.id), []);
  if (rows.filter((x) => !x.revokedAt).length >= 10) return { ok: false, code: 'KEY_LIMIT_REACHED' };
  const secret = `fbt_sandbox_${randomBytes(24).toString('base64url')}`;
  const secretHash = hash(secret);
  const record = { id: `key_${randomUUID()}`, projectId: project.id, prefix: `${secret.slice(0, 16)}…`, hash: secretHash, scopes: requested, environment: 'sandbox', createdAt: Date.now(), lastUsedAt: null, revokedAt: null };
  await store.set(key(owner, project.id), [record, ...rows]);
  /* The index is what makes the key verifiable at all; it holds no secret. */
  await store.set(indexKey(secretHash), { owner: String(owner), projectId: project.id, keyId: record.id, revokedAt: null });
  return { ok: true, record, secret };
}

export async function revokeApiKey(owner, project, id, store = durableStore) {
  if (!store.durable()) return { ok: false, code: 'PROJECT_STORE_UNAVAILABLE' };
  const rows = await store.get(key(owner, project.id), []); const found = rows.find((x) => x.id === id);
  if (!found) return { ok: false, code: 'KEY_NOT_FOUND' };
  const revokedAt = found.revokedAt || Date.now();
  const next = rows.map((x) => x.id === id ? { ...x, revokedAt } : x); await store.set(key(owner, project.id), next);
  if (found.hash) await store.set(indexKey(found.hash), { owner: String(owner), projectId: project.id, keyId: id, revokedAt });
  return { ok: true, revoked: true };
}

/** Constant-time compare of two hex digests of equal length. */
const sameHash = (a, b) => {
  const left = Buffer.from(String(a), 'hex');
  const right = Buffer.from(String(b), 'hex');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Turn a presented secret into an identity, or nothing.
 *
 * Returns `{ ok: true, identity: { owner, projectId, keyId, scopes } }` or a
 * failure code. Every failure path is the same shape and the same 401 at the
 * route: an attacker learns whether a key is valid, never why it is not.
 */
export async function authenticateApiKey(secret, { now = Date.now(), store = durableStore } = {}) {
  if (!store.durable()) return { ok: false, code: 'PROJECT_STORE_UNAVAILABLE' };
  if (typeof secret !== 'string' || !SECRET.test(secret)) return { ok: false, code: 'API_KEY_INVALID' };
  const secretHash = hash(secret);
  const pointer = await store.get(indexKey(secretHash), null);
  if (!pointer?.owner || !pointer?.projectId || !pointer?.keyId) return { ok: false, code: 'API_KEY_INVALID' };
  if (pointer.revokedAt) return { ok: false, code: 'API_KEY_REVOKED' };

  const rows = await store.get(key(pointer.owner, pointer.projectId), []);
  const record = (Array.isArray(rows) ? rows : []).find((row) => row?.id === pointer.keyId);
  if (!record || !sameHash(record.hash, secretHash)) return { ok: false, code: 'API_KEY_INVALID' };
  if (record.revokedAt) return { ok: false, code: 'API_KEY_REVOKED' };

  if (!record.lastUsedAt || now - record.lastUsedAt > LAST_USED_THROTTLE_MS) {
    await store.set(key(pointer.owner, pointer.projectId), rows.map((row) => row?.id === record.id ? { ...row, lastUsedAt: now } : row));
  }
  return {
    ok: true,
    identity: {
      owner: String(pointer.owner),
      projectId: pointer.projectId,
      keyId: record.id,
      scopes: Array.isArray(record.scopes) ? [...record.scopes] : [],
      environment: 'sandbox'
    }
  };
}

/** Scope check used by the routes. Unknown scope names can never pass. */
export const hasScope = (identity, scope) => scopes.has(scope) && Array.isArray(identity?.scopes) && identity.scopes.includes(scope);
