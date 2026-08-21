import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import { storeGet, storeSet } from './store.js';
const key = (owner, projectId) => `developer-keys:v1:${owner}:${projectId}`;
const scopes = new Set(['read_network', 'create_intent', 'request_quote', 'request_simulation']);
const hash = (v) => createHash('sha256').update(v).digest('hex');
export async function createApiKey(owner, project, input = {}) {
  if (!blobConfigured()) return { ok: false, code: 'PROJECT_STORE_UNAVAILABLE' };
  const requested = Array.isArray(input.scopes) ? [...new Set(input.scopes.filter((s) => scopes.has(s)))] : [];
  if (!requested.length || requested.some((s) => !project.scopes.includes(s))) return { ok: false, code: 'SCOPE_NOT_ALLOWED' };
  const rows = await storeGet(key(owner, project.id), []);
  if (rows.filter((x) => !x.revokedAt).length >= 10) return { ok: false, code: 'KEY_LIMIT_REACHED' };
  const secret = `fbt_sandbox_${randomBytes(24).toString('base64url')}`;
  const record = { id: `key_${randomUUID()}`, projectId: project.id, prefix: `${secret.slice(0, 16)}…`, hash: hash(secret), scopes: requested, environment: 'sandbox', createdAt: Date.now(), lastUsedAt: null, revokedAt: null };
  await storeSet(key(owner, project.id), [record, ...rows]);
  return { ok: true, record, secret };
}
export async function revokeApiKey(owner, project, id) {
  if (!blobConfigured()) return { ok: false, code: 'PROJECT_STORE_UNAVAILABLE' };
  const rows = await storeGet(key(owner, project.id), []); const found = rows.find((x) => x.id === id);
  if (!found) return { ok: false, code: 'KEY_NOT_FOUND' };
  const next = rows.map((x) => x.id === id ? { ...x, revokedAt: x.revokedAt || Date.now() } : x); await storeSet(key(owner, project.id), next); return { ok: true, revoked: true };
}
