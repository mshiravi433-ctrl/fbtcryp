import { createHash } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import { storeGet, storeSet } from './store.js';
const key = (owner, operation, idempotency) => `idempotency:v1:${owner}:${operation}:${createHash('sha256').update(idempotency).digest('hex')}`;
export async function claimIdempotency(owner, operation, idempotency, fingerprint) {
  if (!blobConfigured()) return { ok: false, code: 'PROJECT_STORE_UNAVAILABLE' };
  if (typeof idempotency !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotency)) return { ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' };
  const storageKey = key(owner, operation, idempotency); const existing = await storeGet(storageKey, null);
  if (existing) return existing.fingerprint === fingerprint ? { ok: true, replay: true, result: existing.result } : { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
  return { ok: true, replay: false, storageKey, fingerprint };
}
export async function saveIdempotency(claim, result) { if (!claim?.storageKey) return; await storeSet(claim.storageKey, { fingerprint: claim.fingerprint, result }); }
