/**
 * FBT EXTERNAL AGENT HUB — connection manager (§10D, §16).
 * ---------------------------------------------------------------------------
 * A connection is the USER's relationship with the provider, held under the
 * user's own account. There is no master account, no shared credential and no
 * FBT-purchased plan anywhere in this file — `start` redirects the user to the
 * PROVIDER's authorization page, and the token the provider issues is sealed
 * per user.
 *
 * THE FOUR THINGS THIS FILE GUARANTEES
 *   1. STATE IS BOUND TO THE OWNER. The OAuth `state` is a signed record
 *      containing the owner hash; a callback presented by another device does
 *      not resolve to this owner's pending authorization. A callback with a
 *      valid signature but the wrong owner is refused, not "re-bound".
 *   2. A CODE IS USED ONCE. The pending record is claimed atomically when
 *      Redis is configured (`SET NX`); without Redis the record carries a
 *      single-use marker and the deployment's durability is reported honestly.
 *   3. CREDENTIALS NEVER LEAVE THE SERVER. The blob is AES-256-GCM sealed with
 *      `AGENT_HUB_SECRET_KEY` and stored at its own key; only the adapter of an
 *      in-flight task ever unseals it, and it is never logged, echoed, or
 *      placed in a task row.
 *   4. REVOKE IS REAL. Revoking deletes the sealed credential and tombstones
 *      the row; the next task that needs it is told `AUTH_REQUIRED`.
 *
 * With no approved provider configured, every operation answers
 * `CONNECTIONS_NOT_CONFIGURED` rather than pretending a flow exists.
 */

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { upstashConfigured, upstashSetIfAbsent } from '../blobCache.js';
import { storeGetFresh, storeSet, storeDurable } from '../store.js';
import { AGENT_HUB_CONNECTION_SCHEMA } from './protocol.js';
import { jsonRequest } from './httpSafe.js';
import { loadSealingKey, seal, unseal } from './seal.js';

const PENDING_TTL_MS = 10 * 60_000;
const STATE_TTL_MS = 10 * 60_000;
const SECRET_PREFIX = 'agenthub:secret:v1:';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (value) => Buffer.from(String(value), 'base64url');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
};

export function createConnectionManager({
  store,
  registry,
  env = process.env,
  now = () => Date.now(),
  log = () => {},
  request = jsonRequest
} = {}) {
  const sealingKey = loadSealingKey(env);
  const stateSecret = String(env.AGENT_HUB_STATE_SECRET || '').trim() || (sealingKey ? sealingKey.toString('hex') : '');
  const redirectBase = String(env.AGENT_HUB_OAUTH_REDIRECT_BASE || '').trim().replace(/\/+$/, '');

  const ownerHash = (owner) => sha(`owner|${owner}`).slice(0, 32);
  const pendingKey = (stateHash) => `agenthub:oauth-pending:v1:${stateHash}`;
  const secretKey = (connectionId) => `${SECRET_PREFIX}${connectionId}`;

  function signState(payload) {
    const body = b64url(JSON.stringify(payload));
    const mac = createHmac('sha256', stateSecret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  function verifyState(state, owner, providerId) {
    const [body, mac] = String(state || '').split('.');
    if (!body || !mac) return { ok: false, code: 'OAUTH_STATE_INVALID' };
    const expected = createHmac('sha256', stateSecret).update(body).digest('base64url');
    if (!safeEqual(mac, expected)) return { ok: false, code: 'OAUTH_STATE_INVALID' };
    let payload;
    try {
      payload = JSON.parse(fromB64url(body).toString('utf8'));
    } catch {
      return { ok: false, code: 'OAUTH_STATE_INVALID' };
    }
    /* The owner binding is the whole point: a correctly signed state minted for
       device A must not complete a connection for device B. */
    if (payload.owner !== ownerHash(owner)) return { ok: false, code: 'OAUTH_STATE_OWNER_MISMATCH' };
    if (payload.providerId !== providerId) return { ok: false, code: 'OAUTH_STATE_PROVIDER_MISMATCH' };
    if (Number(payload.at) + STATE_TTL_MS <= now()) return { ok: false, code: 'OAUTH_STATE_EXPIRED' };
    return { ok: true, payload };
  }

  function providerReady(provider) {
    if (!provider) return { ok: false, code: 'PROVIDER_NOT_FOUND' };
    if (!provider.authorization) return { ok: false, code: 'CONNECTIONS_NOT_SUPPORTED' };
    if (!sealingKey || !stateSecret) return { ok: false, code: 'AGENT_HUB_SECRET_KEY_REQUIRED' };
    if (!redirectBase) return { ok: false, code: 'OAUTH_REDIRECT_UNCONFIGURED' };
    const clientId = provider.authorization.clientIdEnv ? String(env[provider.authorization.clientIdEnv] || '').trim() : '';
    const clientSecret = provider.authorization.clientSecretEnv ? String(env[provider.authorization.clientSecretEnv] || '').trim() : '';
    if (!clientId || !clientSecret) return { ok: false, code: 'PROVIDER_OAUTH_CLIENT_UNCONFIGURED' };
    return { ok: true, clientId, clientSecret };
  }

  function publicConnection(connection) {
    return {
      id: connection.id,
      providerId: connection.providerId,
      status: connection.status,
      scopes: connection.scopes || [],
      externalAccountLabel: connection.externalAccountLabel || null,
      expiresAt: connection.expiresAt || null,
      createdAt: connection.createdAt,
      revokedAt: connection.revokedAt || null,
      lastUsedAt: connection.lastUsedAt || null,
      credentialStored: Boolean(connection.credentialRef)
    };
  }

  function capability() {
    const providers = registry.all()
      .filter((p) => p.authorization)
      .map((p) => {
        const ready = providerReady(p);
        return {
          providerId: p.id,
          type: p.authorization.type,
          scopes: p.authorization.scopes,
          ready: ready.ok,
          reason: ready.ok ? null : ready.code
        };
      });
    return {
      configured: providers.some((p) => p.ready),
      sealingConfigured: Boolean(sealingKey),
      stateSigningConfigured: Boolean(stateSecret),
      redirectConfigured: Boolean(redirectBase),
      providers
    };
  }

  async function start({ owner, providerId }) {
    const provider = registry.get(providerId);
    const ready = providerReady(provider);
    if (!ready.ok) return ready;

    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const at = now();
    const state = signState({ owner: ownerHash(owner), providerId: provider.id, nonce: b64url(randomBytes(9)), at });

    await storeSet(pendingKey(sha(state).slice(0, 32)), {
      ownerHash: ownerHash(owner),
      providerId: provider.id,
      verifierSealed: sealingKey ? seal(sealingKey, { verifier }) : null,
      verifier,
      at,
      used: false
    }, PENDING_TTL_MS);

    const url = new URL(provider.authorization.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', ready.clientId);
    url.searchParams.set('redirect_uri', `${redirectBase}/api/ai/agent-hub/providers/${provider.id}/connections/callback`);
    url.searchParams.set('scope', provider.authorization.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return { ok: true, authorizationUrl: url.toString(), state, expiresAt: at + STATE_TTL_MS };
  }

  async function consumePending(state) {
    const stateHash = sha(state).slice(0, 32);
    const storageKey = pendingKey(stateHash);
    if (upstashConfigured()) {
      /* SET NX on the "used" marker: exactly one callback wins, even if the user
         double-clicks the provider's redirect. */
      const claimed = await upstashSetIfAbsent(`agenthub:oauth-used:v1:${stateHash}`, { at: now() }, PENDING_TTL_MS);
      if (!claimed) return { ok: false, code: 'OAUTH_STATE_ALREADY_USED' };
    }
    let pending = null;
    try {
      pending = await storeGetFresh(storageKey, null);
    } catch {
      pending = null;
    }
    if (!pending) return { ok: false, code: 'OAUTH_STATE_UNKNOWN' };
    if (pending.used === true) return { ok: false, code: 'OAUTH_STATE_ALREADY_USED' };
    pending.used = true;
    await storeSet(storageKey, pending, PENDING_TTL_MS);
    return { ok: true, pending, stateHash };
  }

  async function complete({ owner, providerId, code, state, providerError = null }) {
    const provider = registry.get(providerId);
    const ready = providerReady(provider);
    if (!ready.ok) return ready;
    if (providerError) return { ok: false, code: 'OAUTH_PROVIDER_DENIED' };
    if (typeof code !== 'string' || code.length < 4 || code.length > 512) return { ok: false, code: 'OAUTH_CODE_REQUIRED' };

    const verified = verifyState(state, owner, provider.id);
    if (!verified.ok) return verified;

    const consumed = await consumePending(state);
    if (!consumed.ok) return consumed;

    const { pending } = consumed;
    if (pending.ownerHash !== ownerHash(owner)) return { ok: false, code: 'OAUTH_STATE_OWNER_MISMATCH' };

    const verifier = pending.verifierSealed && sealingKey
      ? unseal(sealingKey, pending.verifierSealed).verifier
      : pending.verifier;
    if (!verifier) return { ok: false, code: 'OAUTH_PKCE_MISSING' };

    const exchanged = await request({
      url: provider.authorization.tokenUrl,
      allowedHosts: provider.allowedHosts,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        grant_type: 'authorization_code',
        code,
        client_id: ready.clientId,
        client_secret: ready.clientSecret,
        redirect_uri: `${redirectBase}/api/ai/agent-hub/providers/${provider.id}/connections/callback`,
        code_verifier: verifier
      },
      timeoutMs: 12_000,
      maxBytes: 64_000,
      env
    });
    if (!exchanged.ok) {
      log(`agenthub:oauth-exchange-failed:${provider.id}:${exchanged.code}`);
      return { ok: false, code: 'OAUTH_EXCHANGE_FAILED' };
    }
    const token = exchanged.json || {};
    if (typeof token.access_token !== 'string' || token.access_token.length < 8) {
      return { ok: false, code: 'OAUTH_TOKEN_MISSING' };
    }

    const id = `conn_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const at = now();
    const ttl = Number(token.expires_in) > 0 ? Number(token.expires_in) * 1000 : null;
    const sealed = seal(sealingKey, {
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null,
      tokenType: typeof token.token_type === 'string' ? token.token_type.slice(0, 20) : 'Bearer'
    });
    await storeSet(secretKey(id), sealed, Math.max(PENDING_TTL_MS, ttl || 30 * 24 * 3600_000));

    const connection = {
      schema: AGENT_HUB_CONNECTION_SCHEMA,
      id,
      ownerHash: ownerHash(owner),
      providerId: provider.id,
      status: 'ACTIVE',
      scopes: String(token.scope || provider.authorization.scopes.join(' ')).split(/\s+/).filter(Boolean).slice(0, 12),
      externalAccountLabel: typeof token.account_label === 'string' ? token.account_label.slice(0, 80) : null,
      credentialRef: `sealed:${id}`,
      expiresAt: ttl ? at + ttl : null,
      createdAt: at,
      revokedAt: null,
      lastUsedAt: null
    };
    const saved = await store.putConnection(owner, connection);
    if (!saved.ok) return { ok: false, code: saved.code || 'STORE_WRITE_FAILED' };
    await store.indexConnection(owner, id);
    await store.appendAudit(owner, { type: 'CONNECTION_CREATED', providerId: provider.id, connectionId: id });
    return { ok: true, connection: publicConnection(connection), durable: store.durable() };
  }

  async function list(owner) {
    const out = await store.listConnections(owner);
    const connections = (out.connections || [])
      .filter((c) => c.providerId && c.status !== 'REVOKED' && (c.expiresAt === null || c.expiresAt > now()))
      .map(publicConnection);
    return { ok: true, connections, durable: out.durable };
  }

  async function revoke({ owner, connectionId }) {
    const found = await store.getConnection(owner, connectionId);
    if (!found.ok) return { ok: false, code: 'CONNECTION_NOT_FOUND' };
    /* Delete the sealed material FIRST: a tombstone whose credential still
       exists is not a revocation. */
    try {
      await storeSet(secretKey(connectionId), null, 60_000);
    } catch {
      log('agenthub:revoke-secret-delete-failed');
    }
    const deleted = await store.deleteConnection(owner, connectionId);
    if (!deleted.ok) return { ok: false, code: deleted.code };
    await store.appendAudit(owner, { type: 'CONNECTION_REVOKED', providerId: found.connection.providerId, connectionId });
    return { ok: true, connection: publicConnection(deleted.connection), durable: deleted.durable };
  }

  /**
   * Internal only. Returns the live credential for a provider when the user has
   * an active connection. Called by the task broker while starting ONE task;
   * the value never reaches a response body.
   */
  async function credentialFor(owner, providerId) {
    const out = await store.listConnections(owner);
    const active = (out.connections || []).find((c) =>
      c.providerId === providerId &&
      c.status === 'ACTIVE' &&
      c.credentialRef &&
      (c.expiresAt === null || c.expiresAt > now())
    );
    if (!active) return { ok: false, code: 'AUTH_REQUIRED' };
    if (!sealingKey) return { ok: false, code: 'AGENT_HUB_SECRET_KEY_REQUIRED' };
    let sealed = null;
    try {
      sealed = await storeGetFresh(secretKey(active.id), null);
    } catch {
      sealed = null;
    }
    if (typeof sealed !== 'string') return { ok: false, code: 'AUTH_REQUIRED' };
    try {
      const credential = unseal(sealingKey, sealed);
      await store.putConnection(owner, { ...active, lastUsedAt: now() });
      return { ok: true, credential, connectionId: active.id };
    } catch {
      log('agenthub:credential-unseal-failed');
      return { ok: false, code: 'CONNECTION_UNREADABLE' };
    }
  }

  return {
    capability,
    start,
    complete,
    list,
    revoke,
    credentialFor,
    publicConnection,
    _redirectBase: redirectBase
  };
}
