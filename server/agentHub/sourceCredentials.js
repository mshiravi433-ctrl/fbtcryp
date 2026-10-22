/**
 * FBT AGENT HUB — keys for the user's OWN agent (not an OAuth provider).
 * ---------------------------------------------------------------------------
 * The reviewed registry can only offer OAuth for a provider that has been
 * through review. A user-supplied A2A agent is the other case: it may need a
 * key issued by whoever runs it, and FBT has no way to register an OAuth client
 * for an endpoint a stranger typed in.
 *
 * So this module does the one honest thing that actually works:
 *
 *   · the user pastes THEIR OWN key for THEIR OWN agent;
 *   · it is sealed with `AGENT_HUB_SECRET_KEY` (AES-256-GCM) at an owner-scoped
 *     storage key and never leaves the server unsealed;
 *   · only an in-flight task for that same source and owner can read it;
 *   · removing it deletes the sealed blob first and tombstones the row;
 *   · the header name and scheme are an ALLOWLIST, because a free-text header
 *     would be a request-smuggling surface. The key is sent to the host the
 *     user already added — never to a host taken from a request body.
 *
 * This is NOT a replacement for the reviewed OAuth path and it does not make a
 * provider reviewed. A source with a key is still `source: "user"` everywhere.
 */

import { createHash } from 'node:crypto';
import { storeGetFresh, storeSet } from '../store.js';
import { loadSealingKey, seal, unseal } from './seal.js';

export const SOURCE_CREDENTIAL_SCHEMA = 'fbt.agent-hub.source-credential.v1';

const MAX_SOURCES = 8;
const TTL_MS = 180 * 24 * 3600_000;
const SECRET_MIN = 6;
const SECRET_MAX = 2048;

/** Header names the Hub will ever send a user key in. */
export const CREDENTIAL_HEADERS = Object.freeze(['authorization', 'x-api-key', 'api-key', 'x-auth-token']);
/** How the secret is framed inside `Authorization`. */
export const CREDENTIAL_SCHEMES = Object.freeze(['bearer', 'token', 'key', 'raw']);

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const secretKey = (owner, sourceId) => `agenthub:uscred:v1:${sha(owner).slice(0, 24)}:${String(sourceId).slice(0, 60)}`;
const metaKey = (owner) => `agenthub:uscred-index:v1:${sha(owner).slice(0, 24)}`;

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function headersFor({ headerName, scheme, secret }) {
  if (headerName === 'authorization') {
    if (scheme === 'raw') return { authorization: secret };
    const prefix = scheme === 'token' ? 'Token' : scheme === 'key' ? 'Key' : 'Bearer';
    return { authorization: `${prefix} ${secret}` };
  }
  return { [headerName]: secret };
}

export function createSourceCredentials({
  userSources,
  env = process.env,
  now = () => Date.now(),
  log = () => {}
} = {}) {
  const sealingKey = loadSealingKey(env);

  function capability() {
    return {
      supported: true,
      sealingConfigured: Boolean(sealingKey),
      headers: [...CREDENTIAL_HEADERS],
      schemes: [...CREDENTIAL_SCHEMES],
      ttlDays: Math.round(TTL_MS / 86_400_000)
    };
  }

  /** Public metadata for one stored key: never the secret, never the ciphertext. */
  function publicEntry(row) {
    return {
      id: `cred_${row.sourceId}`,
      kind: 'api_key',
      providerId: row.sourceId,
      status: 'ACTIVE',
      headerName: row.headerName,
      scheme: row.scheme,
      scopes: [],
      externalAccountLabel: null,
      credentialStored: true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt || null
    };
  }

  async function readMeta(owner) {
    const rows = await storeGetFresh(metaKey(owner), []);
    return Array.isArray(rows) ? rows : [];
  }

  async function writeMeta(owner, rows) {
    return storeSet(metaKey(owner), rows.slice(0, MAX_SOURCES), TTL_MS);
  }

  async function list({ owner } = {}) {
    const rows = await readMeta(owner);
    return {
      ok: true,
      credentials: rows
        .filter((row) => row && row.sourceId && row.status === 'ACTIVE')
        .filter((row) => !row.expiresAt || row.expiresAt > now())
        .map(publicEntry)
    };
  }

  async function save({ owner, sourceId, headerName = 'authorization', scheme = 'bearer', secret } = {}) {
    if (!sealingKey) return { ok: false, code: 'AGENT_HUB_SECRET_KEY_REQUIRED' };
    const source = await userSources?.providerFor?.({ owner, providerId: sourceId });
    if (!source) return { ok: false, code: 'SOURCE_NOT_FOUND' };

    const header = str(headerName, 40).toLowerCase() || 'authorization';
    const frame = str(scheme, 20).toLowerCase() || 'bearer';
    const value = typeof secret === 'string' ? secret.trim() : '';
    if (!CREDENTIAL_HEADERS.includes(header)) return { ok: false, code: 'CREDENTIAL_HEADER_UNSUPPORTED', field: 'headerName' };
    if (!CREDENTIAL_SCHEMES.includes(frame)) return { ok: false, code: 'CREDENTIAL_SCHEME_UNSUPPORTED', field: 'scheme' };
    if (header === 'authorization' && frame === 'raw' && value.length < SECRET_MIN) return { ok: false, code: 'CREDENTIAL_SECRET_REQUIRED', field: 'secret' };
    if (value.length < SECRET_MIN) return { ok: false, code: 'CREDENTIAL_SECRET_REQUIRED', field: 'secret' };
    if (value.length > SECRET_MAX) return { ok: false, code: 'CREDENTIAL_SECRET_TOO_LONG', field: 'secret' };
    /* A secret with a newline is a header-injection attempt, not a key. */
    if (/[\r\n\u0000]/.test(value)) return { ok: false, code: 'CREDENTIAL_SECRET_INVALID', field: 'secret' };
    /* A recognizable "Bearer eyJ…" pasted into the field is normalised rather
       than double-prefixed — that would send "Bearer Bearer …". */
    const normalized = frame === 'raw' && /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '') : value;

    const sealed = seal(sealingKey, { headerName: header, scheme: frame, secret: normalized, at: now() });
    await storeSet(secretKey(owner, sourceId), sealed, TTL_MS);

    const rows = await readMeta(owner);
    const row = {
      schema: SOURCE_CREDENTIAL_SCHEMA,
      sourceId,
      headerName: header,
      scheme: frame,
      status: 'ACTIVE',
      createdAt: rows.find((r) => r?.sourceId === sourceId)?.createdAt || now(),
      updatedAt: now(),
      expiresAt: now() + TTL_MS,
      lastUsedAt: null
    };
    const next = [row, ...rows.filter((r) => r && r.sourceId !== sourceId)].slice(0, MAX_SOURCES);
    await writeMeta(owner, next);
    return { ok: true, connection: publicEntry(row) };
  }

  async function remove({ owner, sourceId } = {}) {
    const rows = await readMeta(owner);
    const existing = rows.find((r) => r?.sourceId === sourceId && r.status === 'ACTIVE');
    /* Delete the sealed blob FIRST, for the same reason as an OAuth revoke:
       metadata without the secret is a revocation, the reverse is not. */
    try {
      await storeSet(secretKey(owner, sourceId), null, 60_000);
    } catch {
      log('agenthub:source-credential-delete-failed');
    }
    const next = rows.map((r) => (r?.sourceId === sourceId ? { ...r, status: 'REVOKED', revokedAt: now() } : r));
    await writeMeta(owner, next);
    if (!existing) return { ok: false, code: 'CREDENTIAL_NOT_FOUND' };
    return { ok: true, connection: { ...publicEntry(existing), status: 'REVOKED', revokedAt: now() } };
  }

  /**
   * Internal only. Called by the broker while creating or syncing ONE task for
   * a user-supplied source. Returns request headers, never a stored row.
   */
  async function credentialFor({ owner, sourceId } = {}) {
    if (!sealingKey) return { ok: false, code: 'AGENT_HUB_SECRET_KEY_REQUIRED' };
    const rows = await readMeta(owner);
    const row = rows.find((r) => r?.sourceId === sourceId && r.status === 'ACTIVE' && (!r.expiresAt || r.expiresAt > now()));
    if (!row) return { ok: false, code: 'CREDENTIAL_NOT_FOUND' };
    let sealed = null;
    try {
      sealed = await storeGetFresh(secretKey(owner, sourceId), null);
    } catch {
      sealed = null;
    }
    if (typeof sealed !== 'string') return { ok: false, code: 'CREDENTIAL_NOT_FOUND' };
    try {
      const opened = unseal(sealingKey, sealed);
      const headers = headersFor(opened);
      /* Record the use without rewriting the secret. Best-effort: a failed
         timestamp must not fail the task. */
      const touched = rows.map((r) => (r?.sourceId === sourceId ? { ...r, lastUsedAt: now() } : r));
      await writeMeta(owner, touched).catch(() => null);
      return { ok: true, credential: { headers } };
    } catch {
      log('agenthub:source-credential-unseal-failed');
      return { ok: false, code: 'CREDENTIAL_UNREADABLE' };
    }
  }

  return {
    schema: SOURCE_CREDENTIAL_SCHEMA,
    capability,
    list,
    save,
    remove,
    credentialFor,
    _sealingConfigured: Boolean(sealingKey)
  };
}
