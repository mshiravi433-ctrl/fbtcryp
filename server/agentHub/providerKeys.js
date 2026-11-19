/**
 * FBT AGENT HUB — a user's own key for a third-party provider, made usable.
 * ---------------------------------------------------------------------------
 * The gap this closes is exact and it was visible in the UI: every external
 * card in the directory opened the vendor's page and stopped there. Nothing
 * about that is an integration. Here a pasted key becomes a working, sealed
 * connection that OUR assistant can actually call — and the proof is a real
 * authenticated round-trip, not a green badge:
 *
 *   1. the key is sent ONCE to the host declared in `keyBridges.js` (a constant,
 *      never a host from the request) to read the vendor's own model list;
 *   2. only if that answers 2xx is the key sealed with `AGENT_HUB_SECRET_KEY`
 *      (AES-256-GCM, the same primitive as `sourceCredentials.js` — there is no
 *      second crypto path in this codebase) and written at an owner-scoped key;
 *   3. the model name is taken from the vendor's reply, so a connected seat
 *      never depends on a pin that has gone stale;
 *   4. `ask()` runs one completion through a system prompt that is fixed here on
 *      the server and anchored on crypto / DeFi / trading, and returns the
 *      answer with its real attribution (provider, model, latency).
 *
 * What this is NOT: it does not make a provider "reviewed", it does not store
 * anything on the vendor's behalf, and a stored key never leaves the server —
 * `list()` returns a status and a 4-character hint, nothing more.
 */

import { createHash, randomUUID } from 'node:crypto';
import { storeDurable, storeGetFresh, storeSet } from '../store.js';
import { loadSealingKey, seal, unseal } from './seal.js';
import { bridgeById, listBridges, pickModel, protocolFor, publicBridge } from './keyBridges.js';

export const PROVIDER_KEY_SCHEMA = 'fbt.agent-hub.provider-key.v1';

const SECRET_MIN = 8;
const SECRET_MAX = 512;
const TTL_MS = 180 * 24 * 3600_000;
const VERIFY_TIMEOUT_MS = 9000;
const ASK_TIMEOUT_MS = 22_000;
const MAX_ASK_PER_HOUR = 20;
const MAX_QUESTION = 600;
const MAX_ANSWER = 4000;

/** The domain the bridge is allowed to answer in. Server-side on purpose. */
export const BRIDGE_SYSTEM_PROMPT = [
  'You are a domain seat inside FBT (fbtswap.ir), a crypto / DeFi / trading product.',
  'Only discuss crypto markets, on-chain data, DeFi protocols, portfolio risk, execution and market structure.',
  'If the question is outside that scope, say briefly that it is outside FBT’s domain and do not answer it.',
  'Be concrete and numeric when the user supplies numbers. Never invent prices, addresses or fills.',
  'You have no ability to place orders or move funds; never claim otherwise.',
  'Answer in the language of the question (Persian or English), in at most 12 sentences.'
].join(' ');

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const ownerPart = (owner) => sha(owner).slice(0, 24);
const blobKey = (owner, providerId, keyId) =>
  `agenthub:aikey:v1:${ownerPart(owner)}:${String(providerId).slice(0, 40)}:${String(keyId).slice(0, 48)}`;
const metaKey = (owner) => `agenthub:aikey-index:v1:${ownerPart(owner)}`;
const hintOf = (secret) => `••••${String(secret).slice(-4)}`;

/** A short, human-readable value from the vendor's own reply — the proof the
    connection is real. Never includes anything the user did not already own. */
function proofFrom(json) {
  if (!json || typeof json !== 'object') return null;
  const candidate =
    json.gecko_says ||
    json.result ||
    (Array.isArray(json.data) ? `${json.data.length} models` : null) ||
    (Array.isArray(json.models) ? `${json.models.length} models` : null) ||
    null;
  return candidate ? String(candidate).slice(0, 120) : null;
}

/** Never let a key reach a log line, an error message or the UI. */
function scrub(text, secret) {
  let out = String(text || '');
  if (secret && secret.length >= 6) out = out.split(secret).join('[redacted]');
  return out.replace(/\b(sk|pk|key|token)[-_][A-Za-z0-9_-]{8,}/gi, '[redacted]').slice(0, 240);
}

export function createProviderKeys({
  env = process.env,
  now = () => Date.now(),
  log = () => {},
  fetchImpl = globalThis.fetch,
  storage = {}
} = {}) {
  const sealingKey = loadSealingKey(env);
  const durable = typeof storage.durable === 'function' ? storage.durable : storeDurable;
  const getFresh = typeof storage.getFresh === 'function' ? storage.getFresh : storeGetFresh;
  const set = typeof storage.set === 'function' ? storage.set : storeSet;
  const askLog = new Map();

  function capability() {
    return {
      supported: true,
      sealingConfigured: Boolean(sealingKey),
      durable: Boolean(durable()),
      connectable: listBridges().map((b) => b.id),
      aiProviders: listBridges().filter((b) => b.kind === 'ai').map((b) => b.id),
      dataProviders: listBridges().filter((b) => b.kind === 'data').map((b) => b.id),
      providers: listBridges(),
      domain: 'crypto/defi/trading',
      ttlDays: Math.round(TTL_MS / 86_400_000),
      maxAsksPerHour: MAX_ASK_PER_HOUR
    };
  }

  function authHeaders(bridge, secret) {
    const headers = { accept: 'application/json', 'user-agent': 'fbt-agent-hub/1.0' };
    const auth = bridge.auth || {};
    if (auth.query || auth.path) {
      /* Query-key (Gemini, Helius) and path-key (Alchemy) providers take the
         secret in the URL; a header here would be ignored *and* would leak the
         key into a log line that expects headers only. */
      Object.assign(headers, auth.extraHeaders || {});
      return headers;
    }
    const header = String(auth.header || 'authorization').toLowerCase();
    const scheme = String(auth.scheme || 'bearer').toLowerCase();
    if (header === 'authorization') {
      const prefix = scheme === 'token' ? 'Token' : scheme === 'key' ? 'Key' : scheme === 'raw' ? '' : 'Bearer';
      headers.authorization = prefix ? `${prefix} ${secret}` : secret;
    } else {
      headers[header] = secret;
    }
    Object.assign(headers, auth.extraHeaders || {});
    return headers;
  }

  function urlFor(bridge, path, secret) {
    const auth = bridge.auth || {};
    const resolved = auth.path ? String(path).split('{key}').join(encodeURIComponent(secret)) : path;
    const url = new URL(`${bridge.baseUrl}${resolved}`);
    if (auth.query) url.searchParams.set(auth.query, secret);
    return url.toString();
  }

  function publicEntry(row) {
    const bridge = bridgeById(row.providerId);
    const base = publicBridge(bridge) || { id: row.providerId, name: row.providerId };
    return {
      ...base,
      connected: row.status === 'ACTIVE',
      status: row.status,
      connectionKind: 'api_key',
      hint: row.hint || null,
      model: row.model || base.defaultModel || null,
      modelCount: row.modelCount ?? null,
      verifiedAt: row.verifiedAt || null,
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null,
      lastUsedAt: row.lastUsedAt || null,
      lastError: row.lastError || null,
      proof: row.proof || null,
      authLabel: base.authLabel || null,
      domainUse: base.domainUse || null
    };
  }

  async function readMeta(owner) {
    const rows = await getFresh(metaKey(owner), []);
    return Array.isArray(rows) ? rows : [];
  }

  const writeMeta = (owner, rows) => set(metaKey(owner), rows.slice(0, 24), TTL_MS);

  /** Directory shape for the UI: every connectable vendor, connected or not. */
  async function list({ owner } = {}) {
    let rows = [];
    try {
      rows = await readMeta(owner);
    } catch {
      return { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE', providers: listBridges().map((b) => ({ ...b, connected: false, status: 'UNCONNECTED' })) };
    }
    const byId = new Map(rows.filter((r) => r && r.providerId).map((r) => [r.providerId, r]));
    return {
      ok: true,
      durable: Boolean(durable()),
      sealingConfigured: Boolean(sealingKey),
      providers: listBridges().map((bridge) => {
        const row = byId.get(bridge.id);
        if (!row || row.status === 'REVOKED') return { ...bridge, connected: false, status: 'UNCONNECTED' };
        if (row.expiresAt && row.expiresAt <= now()) return { ...bridge, connected: false, status: 'EXPIRED' };
        /* An INVALID seat keeps its row (the user can replace the key) but never
           claims to be connected: `connected` is the executable flag. */
        return { ...bridge, ...publicEntry(row), id: bridge.id, connected: row.status === 'ACTIVE' };
      })
    };
  }

  /** Every (host, auth) pair a bridge may be tried on. Constants only. */
  function variantsFor(bridge) {
    if (Array.isArray(bridge.variants) && bridge.variants.length) return bridge.variants;
    return [{ baseUrl: bridge.baseUrl, auth: bridge.auth || {}, probePath: bridge.probePath || null, check: bridge.check || null }];
  }

  /**
   * One authenticated read at the vendor. No secret is returned.
   * A data bridge proves the key with its own cheap read (`bridge.probePath`)
   * and may reject a 200 that carries an API-level error (`bridge.check`).
   */
  async function verify({ bridge, secret, signal }) {
    const attempts = [];
    const variants = variantsFor(bridge);
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const scoped = { ...bridge, baseUrl: variant.baseUrl || bridge.baseUrl, auth: variant.auth || bridge.auth || {} };
      const proto = protocolFor(scoped);
      const probeSpec = variant.probe || bridge.probe || null;
      const probePath = variant.probePath || bridge.probePath || probeSpec?.path || proto.probePath;
      const probeMethod = probeSpec?.method || 'GET';
      const probeBody = probeSpec?.body ? JSON.stringify(probeSpec.body) : undefined;
      const check = variant.check || bridge.check || null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
      const started = now();
      try {
        const headers = authHeaders(scoped, secret);
        if (probeBody) headers['content-type'] = probeSpec.contentType || 'application/json';
        const res = await fetchImpl(urlFor(scoped, probePath, secret), {
          method: probeMethod,
          headers,
          ...(probeBody ? { body: probeBody } : {}),
          signal: signal || controller.signal,
          redirect: 'error'
        });
        const text = await res.text().catch(() => '');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        const latencyMs = now() - started;
        if (!res.ok) {
          const code =
            res.status === 401 || res.status === 403
              ? 'PROVIDER_REJECTED_KEY'
              : res.status === 429
                ? 'PROVIDER_RATE_LIMITED'
                : res.status === 404 || res.status === 405 || res.status === 410
                  /* Our probe path moved — the key is not to blame, and saying
                     "invalid key" here would be a lie the user cannot debug. */
                  ? 'PROVIDER_ENDPOINT_MISSING'
                  : 'PROVIDER_ERROR';
          attempts.push({ ok: false, code, status: res.status, latencyMs, detail: scrub(json?.error?.message || json?.message || text, secret) });
          /* A key can be valid on a vendor's other host (a CoinGecko demo key is
             rejected by the pro host), so a rejection only ends the search when
             there is no host left to try. */
          if (code === 'PROVIDER_REJECTED_KEY' && index === variants.length - 1) return attempts.at(-1);
          continue;
        }
        if (typeof check === 'function') {
          const verdict = check(json) || { ok: true };
          if (!verdict.ok) {
            attempts.push({ ok: false, code: 'PROVIDER_REJECTED_KEY', status: res.status, latencyMs, detail: scrub(verdict.detail || '', secret) });
            if (index === variants.length - 1) return attempts.at(-1);
            continue;
          }
        }
        const ids = proto.modelsFrom(json) || [];
        const model = (bridge.kind || 'ai') === 'ai' ? pickModel(bridge, ids) : null;
        const proof = proofFrom(json);
        return {
          ok: true,
          status: res.status,
          latencyMs,
          model,
          modelCount: ids.length || null,
          models: ids.slice(0, 40),
          baseUrl: scoped.baseUrl,
          proof
        };
      } catch (error) {
        const aborted = error?.name === 'AbortError';
        attempts.push({
          ok: false,
          code: aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE',
          latencyMs: now() - started,
          detail: scrub(error?.message || 'network error', secret)
        });
        continue;
      } finally {
        clearTimeout(timer);
      }
    }
    /* Report the failure that says the most: a rejection beats a timeout. */
    const rejection = attempts.find((a) => a.code === 'PROVIDER_REJECTED_KEY');
    return rejection || attempts.at(-1) || { ok: false, code: 'PROVIDER_UNREACHABLE' };
  }

  /**
   * Verify, then store. A key that the vendor rejects is never written: a
   * credential row that cannot be used is a lie in the connections list.
   */
  async function connect({ owner, providerId, secret } = {}) {
    const bridge = bridgeById(providerId);
    if (!bridge) return { ok: false, code: 'PROVIDER_NOT_CONNECTABLE' };
    const value = typeof secret === 'string' ? secret.trim() : '';
    if (value.length < SECRET_MIN) return { ok: false, code: 'CREDENTIAL_SECRET_REQUIRED', field: 'secret' };
    if (value.length > SECRET_MAX) return { ok: false, code: 'CREDENTIAL_SECRET_TOO_LONG', field: 'secret' };
    if (/[\r\n\u0000]/.test(value)) return { ok: false, code: 'CREDENTIAL_SECRET_INVALID', field: 'secret' };

    const probe = await verify({ bridge, secret: value });
    if (!probe.ok) return { ok: false, ...probe, provider: publicBridge(bridge) };
    if (!sealingKey) return { ok: false, code: 'AGENT_HUB_SECRET_KEY_REQUIRED', provider: publicBridge(bridge) };
    if (!durable()) return { ok: false, code: 'CREDENTIAL_STORE_REQUIRED', provider: publicBridge(bridge) };

    let rows;
    try {
      rows = await readMeta(owner);
    } catch {
      return { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE' };
    }
    const previous = rows.find((r) => r?.providerId === bridge.id && r.status === 'ACTIVE') || null;
    const keyId = randomUUID().replace(/-/g, '');
    const sealed = seal(sealingKey, { secret: value, providerId: bridge.id, at: now() });
    try {
      await set(blobKey(owner, bridge.id, keyId), sealed, TTL_MS);
      const row = {
        schema: PROVIDER_KEY_SCHEMA,
        providerId: bridge.id,
        keyId,
        status: 'ACTIVE',
        hint: hintOf(value),
        model: probe.model,
        modelCount: probe.modelCount,
        baseUrl: probe.baseUrl || bridge.baseUrl,
        proof: probe.proof || null,
        latencyMs: probe.latencyMs,
        verifiedAt: now(),
        createdAt: previous?.createdAt || now(),
        updatedAt: now(),
        expiresAt: now() + TTL_MS,
        lastUsedAt: null,
        lastError: null
      };
      await writeMeta(owner, [row, ...rows.filter((r) => r && r.providerId !== bridge.id)]);
      if (previous) await set(blobKey(owner, bridge.id, previous.keyId), null, 60_000).catch(() => null);
      return {
        ok: true,
        provider: publicEntry(row),
        verified: { latencyMs: probe.latencyMs, modelCount: probe.modelCount, models: probe.models, proof: probe.proof || null }
      };
    } catch {
      await set(blobKey(owner, bridge.id, keyId), null, 60_000).catch(() => null);
      return { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE' };
    }
  }

  async function remove({ owner, providerId } = {}) {
    const bridge = bridgeById(providerId);
    if (!bridge) return { ok: false, code: 'PROVIDER_NOT_CONNECTABLE' };
    let rows;
    try {
      rows = await readMeta(owner);
    } catch {
      return { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE' };
    }
    const existing = rows.find((r) => r?.providerId === bridge.id && r.status === 'ACTIVE');
    if (!existing) return { ok: false, code: 'CREDENTIAL_NOT_FOUND' };
    try {
      await set(blobKey(owner, bridge.id, existing.keyId), null, 60_000);
    } catch {
      return { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE' };
    }
    try {
      await writeMeta(owner, rows.map((r) => (r?.providerId === bridge.id ? { ...r, status: 'REVOKED', revokedAt: now() } : r)));
    } catch {
      return { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE' };
    }
    return { ok: true, provider: { ...publicBridge(bridge), connected: false, status: 'REVOKED', hint: existing.hint || null } };
  }

  async function secretFor({ owner, providerId } = {}) {
    if (!sealingKey) return { ok: false, code: 'AGENT_HUB_SECRET_KEY_REQUIRED' };
    let rows;
    try {
      rows = await readMeta(owner);
    } catch {
      return { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE' };
    }
    const row = rows.find((r) => r?.providerId === providerId && r.status === 'ACTIVE');
    if (!row) return { ok: false, code: 'CREDENTIAL_NOT_FOUND' };
    if (row.expiresAt && row.expiresAt <= now()) return { ok: false, code: 'CREDENTIAL_EXPIRED' };
    try {
      const sealed = await getFresh(blobKey(owner, row.providerId, row.keyId), null);
      if (!sealed) return { ok: false, code: 'CREDENTIAL_NOT_FOUND' };
      const payload = unseal(sealingKey, sealed);
      if (!payload?.secret) return { ok: false, code: 'CREDENTIAL_UNREADABLE' };
      return { ok: true, secret: payload.secret, row };
    } catch {
      return { ok: false, code: 'CREDENTIAL_UNREADABLE' };
    }
  }

  function rateOk(owner) {
    const stamp = now();
    const cutoff = stamp - 3600_000;
    const hits = (askLog.get(owner) || []).filter((t) => t > cutoff);
    if (hits.length >= MAX_ASK_PER_HOUR) {
      askLog.set(owner, hits);
      return { ok: false, retryAfterMs: hits[0] + 3600_000 - stamp };
    }
    hits.push(stamp);
    askLog.set(owner, hits);
    return { ok: true, remaining: MAX_ASK_PER_HOUR - hits.length };
  }

  /**
   * The two-way half. One question in, one domain answer out, with the vendor
   * named. The prompt is ours; the key is the user's; nothing is stored.
   */
  async function ask({ owner, providerId, question, context = '' } = {}) {
    const bridge = bridgeById(providerId);
    if (!bridge) return { ok: false, code: 'PROVIDER_NOT_CONNECTABLE' };
    const text = typeof question === 'string' ? question.trim().slice(0, MAX_QUESTION) : '';
    if (text.length < 2) return { ok: false, code: 'QUESTION_REQUIRED', field: 'question' };
    const gate = rateOk(owner);
    if (!gate.ok) return { ok: false, code: 'RATE_LIMITED', retryAfterMs: gate.retryAfterMs };

    if ((bridge.kind || 'ai') !== 'ai') return { ok: false, code: 'PROVIDER_ASK_UNSUPPORTED' };
    const found = await secretFor({ owner, providerId: bridge.id });
    if (!found.ok) return { ok: false, code: found.code };

    const proto = protocolFor(bridge);
    const model = found.row.model || bridge.defaultModel;
    if (!model) return { ok: false, code: 'PROVIDER_MODEL_UNKNOWN' };
    const extra = typeof context === 'string' ? context.trim().slice(0, 400) : '';
    const user = extra ? `${text}\n\nFBT context (already verified by FBT):\n${extra}` : text;
    const { path, body } = proto.request({ model, system: BRIDGE_SYSTEM_PROMPT, user, maxTokens: 700 });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
    const started = now();
    try {
      const res = await fetchImpl(urlFor(bridge, path, found.secret), {
        method: 'POST',
        headers: { ...authHeaders(bridge, found.secret), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error'
      });
      const raw = await res.text().catch(() => '');
      let json = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }
      const latencyMs = now() - started;
      if (!res.ok) {
        const code =
          res.status === 401 || res.status === 403
            ? 'PROVIDER_REJECTED_KEY'
            : res.status === 429
              ? 'PROVIDER_RATE_LIMITED'
              : 'PROVIDER_ERROR';
        /* A rejected key is a real state change: remember it so the card stops
           claiming the seat works, without deleting the user's key. */
        if (code === 'PROVIDER_REJECTED_KEY') {
          const rows = await readMeta(owner).catch(() => []);
          await writeMeta(owner, rows.map((r) => (r?.providerId === bridge.id ? { ...r, status: 'INVALID', lastError: code, updatedAt: now() } : r))).catch(() => null);
        }
        return { ok: false, code, status: res.status, latencyMs, detail: scrub(json?.error?.message || raw, found.secret), provider: publicBridge(bridge) };
      }
      const answer = String(proto.answerFrom(json) || '').slice(0, MAX_ANSWER);
      if (!answer) return { ok: false, code: 'PROVIDER_EMPTY_ANSWER', latencyMs, provider: publicBridge(bridge) };
      const rows = await readMeta(owner).catch(() => []);
      await writeMeta(owner, rows.map((r) => (r?.providerId === bridge.id ? { ...r, lastUsedAt: now() } : r))).catch(() => null);
      return {
        ok: true,
        provider: publicBridge(bridge),
        model,
        latencyMs,
        answer,
        attribution: `${bridge.name} · ${model}`,
        domain: 'crypto/defi/trading',
        asksRemaining: gate.remaining
      };
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      return { ok: false, code: aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE', latencyMs: now() - started, detail: scrub(error?.message || '', found.secret) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Internal: the model seat for the gateway, if a connected bridge exists. */
  async function seatFor({ owner, providerId }) {
    const bridge = bridgeById(providerId);
    if (!bridge) return { ok: false, code: 'PROVIDER_NOT_CONNECTABLE' };
    const found = await secretFor({ owner, providerId: bridge.id });
    if (!found.ok) return found;
    return { ok: true, providerId: bridge.id, model: found.row.model || bridge.defaultModel, bridge };
  }

  return { capability, list, connect, remove, ask, seatFor, verify, _scrub: scrub };
}

export default createProviderKeys;
