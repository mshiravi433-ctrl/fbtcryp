/**
 * FBT INTENT AI — Phase 8 Secret Manager boundary.
 *
 * This module is deliberately a boundary, not a fake KMS. The application
 * never treats an environment flag or an opaque in-memory map as proof that a
 * production Secret Manager exists. A deployment must inject a provider that
 * can prove durable storage, current health and its own attestation.
 *
 * The boundary keeps only non-sensitive handle metadata. A secret can be used
 * by an internal server adapter through `withSecretHandle`, but it is never
 * returned by the public status/list methods and is never written to this
 * module's metadata map.
 */

export const SECRET_MANAGER_SCHEMA = 'fbt.intent-secret-manager.v1';
export const SECRET_MANAGER_PROVIDERS = Object.freeze([
  'aws-kms',
  'gcp-kms',
  'azure-key-vault',
  'hashicorp-vault',
  'custom-attested-provider'
]);

const HANDLE_RE = /^fbt_secret_[A-Za-z0-9_-]{16,128}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FORBIDDEN_KEY_RE = /(private.?key|secret(?:value|data|material|credential)|seed|mnemonic|password|api.?key|api.?secret|master.?credential|raw.?credential|raw.?secret|plaintext|signature)/i;
const PEM_RE = /-----BEGIN [^-]+-----/i;
const HEX_SECRET_RE = /^(?:0x)?[a-f0-9]{64}$/i;
const MAX_HANDLES = 10000;
const PUBLIC_CODE_RE = /^[A-Z][A-Z0-9_:-]{0,95}$/;
const PUBLIC_NAME_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const SAFE_META_KEYS = new Set([
  'policyId',
  'agentId',
  'capabilities',
  'allowedChains',
  'allowedProtocols',
  'expiresAt',
  'purpose',
  'providerRef'
]);

const unavailable = (code, detail = null) => ({
  ok: false,
  code,
  ...(detail ? { detail } : {})
});

function safeString(value, max = 128) {
  return typeof value === 'string'
    && value.length <= max
    && !FORBIDDEN_KEY_RE.test(value)
    && !PEM_RE.test(value)
    && !HEX_SECRET_RE.test(value)
    ? value
    : null;
}

function safePublicCode(value, fallback = null) {
  const code = String(value ?? '').trim();
  return PUBLIC_CODE_RE.test(code) && !HEX_SECRET_RE.test(code) ? code : fallback;
}

function safePublicName(value) {
  const name = String(value ?? '').trim();
  return PUBLIC_NAME_RE.test(name) && !HEX_SECRET_RE.test(name) ? name : null;
}

/**
 * A recursive check for values that must never enter handle metadata. This is
 * intentionally conservative: a false positive blocks registration, while a
 * false negative could persist a credential in a supposedly safe record.
 */
export function containsSecretMaterial(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return false;
  if (typeof value === 'string') {
    return PEM_RE.test(value) || HEX_SECRET_RE.test(value);
  }
  if (Array.isArray(value)) return value.some(containsSecretMaterial);
  if (typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY_RE.test(key) || containsSecretMaterial(child));
  }
  return true;
}

function validHandle(handle) {
  return typeof handle === 'string' && HANDLE_RE.test(handle);
}

function normalizeProviderHealth(provider) {
  if (!provider || typeof provider.health !== 'function') {
    return { ok: false, durable: false, attested: false, reason: 'PROVIDER_HEALTHCHECK_MISSING' };
  }
  try {
    const health = provider.health();
    /* Async health checks cannot be silently treated as healthy. A provider
       integration must expose a synchronous cached health snapshot here. */
    if (!health || typeof health.then === 'function') {
      return { ok: false, durable: false, attested: false, reason: 'PROVIDER_HEALTHCHECK_ASYNC_OR_EMPTY' };
    }
    return {
      ok: health.ok === true,
      durable: health.durable === true,
      attested: health.attested === true,
      reason: safePublicCode(health.reason)
    };
  } catch {
    return { ok: false, durable: false, attested: false, reason: 'PROVIDER_HEALTHCHECK_FAILED' };
  }
}

/** A deployment adapter must prove health and resolve by opaque handle. */
export function isSecretManagerProvider(provider) {
  return Boolean(
    provider
    && typeof provider.name === 'string'
    && provider.name.length <= 64
    && typeof provider.health === 'function'
    && typeof provider.resolve === 'function'
  );
}

function publicProviderName(provider) {
  const name = safeString(provider?.name, 64);
  return name && safePublicName(name) ? name : null;
}

function validateMeta(input = {}, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unavailable('BAD_HANDLE_METADATA');
  if (containsSecretMaterial(input)) return unavailable('SECRET_MATERIAL_IN_METADATA');
  if (Object.keys(input).some((key) => !SAFE_META_KEYS.has(key) || FORBIDDEN_KEY_RE.test(key))) {
    return unavailable('UNSAFE_HANDLE_METADATA');
  }

  const policyId = safeString(input.policyId, 128);
  const agentId = safeString(input.agentId, 128);
  const purpose = safeString(input.purpose, 160);
  const providerRef = safeString(input.providerRef, 256);
  const capabilities = Array.isArray(input.capabilities)
    ? [...new Set(input.capabilities.filter((value) => typeof value === 'string' && SAFE_ID_RE.test(value)))].slice(0, 32)
    : [];
  const allowedChains = Array.isArray(input.allowedChains)
    ? [...new Set(input.allowedChains.filter((value) => Number.isInteger(value) && value > 0 && value <= 10_000_000))].slice(0, 32)
    : [];
  const allowedProtocols = Array.isArray(input.allowedProtocols)
    ? [...new Set(input.allowedProtocols.filter((value) => typeof value === 'string' && SAFE_ID_RE.test(value)))].slice(0, 32)
    : [];
  const expiresAt = Number(input.expiresAt);

  if (!policyId || !agentId || !purpose || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return unavailable('BAD_HANDLE_METADATA');
  }
  if (expiresAt > now + 30 * 24 * 60 * 60 * 1000) return unavailable('HANDLE_TTL_TOO_LONG');
  if (!capabilities.length) return unavailable('CAPABILITIES_REQUIRED');

  return {
    ok: true,
    value: Object.freeze({
      policyId,
      agentId,
      capabilities,
      allowedChains,
      allowedProtocols,
      expiresAt,
      purpose,
      ...(providerRef ? { providerRef } : {})
    })
  };
}

/**
 * Build a manager around an injected provider. With no provider, every
 * operation fails closed and the public status says exactly why.
 */
export function createSecretManager({ provider = null, now = () => Date.now(), maxHandles = MAX_HANDLES } = {}) {
  const metadata = new Map();
  const capacity = Number.isInteger(maxHandles) && maxHandles > 0 ? Math.min(maxHandles, MAX_HANDLES) : MAX_HANDLES;

  const status = () => {
    const health = normalizeProviderHealth(provider);
    const providerName = publicProviderName(provider);
    const providerValid = isSecretManagerProvider(provider) && Boolean(providerName);
    const operational = providerValid && health.ok && health.durable && health.attested;
    return Object.freeze({
      schema: SECRET_MANAGER_SCHEMA,
      provider: providerValid ? providerName : null,
      configured: providerValid,
      operational,
      durable: health.durable,
      attested: health.attested,
      secretsExposed: false,
      rawSecretsPersisted: false,
      handleCount: metadata.size,
      status: operational ? 'operational' : providerValid ? 'configured-not-verified' : 'unavailable',
      blocker: operational ? null : providerValid
        ? (safePublicCode(health.reason, 'PROVIDER_HEALTH_NOT_VERIFIED'))
        : 'REAL_SECRET_MANAGER_REQUIRED'
    });
  };

  const assertOperational = () => {
    const current = status();
    return current.operational ? { ok: true } : unavailable(current.blocker, current.status);
  };

  const bind = ({ handle, ...input } = {}) => {
    if (!validHandle(handle)) return unavailable('BAD_SECRET_HANDLE');
    const ready = assertOperational();
    if (!ready.ok) return ready;
    if (metadata.size >= capacity && !metadata.has(handle)) return unavailable('HANDLE_CAPACITY_REACHED');
    const checked = validateMeta(input, now());
    if (!checked.ok) return checked;
    const record = Object.freeze({
      schema: SECRET_MANAGER_SCHEMA,
      handle,
      ...checked.value,
      boundAt: now()
    });
    metadata.set(handle, record);
    return { ok: true, record: { ...record } };
  };

  const revoke = async (handle) => {
    if (!validHandle(handle)) return unavailable('BAD_SECRET_HANDLE');
    const record = metadata.get(handle);
    if (!record) return unavailable('SECRET_HANDLE_NOT_FOUND');
    try {
      if (typeof provider.revoke === 'function') await provider.revoke(handle);
    } catch {
      return unavailable('PROVIDER_REVOKE_FAILED');
    }
    metadata.delete(handle);
    return { ok: true, revoked: true, handle };
  };

  /**
   * Use a secret only inside an internal callback. The raw value is never part
   * of the returned envelope, logs, metadata map or public status response.
   */
  const withSecretHandle = async (handle, context = {}, consumer) => {
    if (!validHandle(handle)) return unavailable('BAD_SECRET_HANDLE');
    if (typeof consumer !== 'function') return unavailable('SECRET_CONSUMER_REQUIRED');
    const ready = assertOperational();
    if (!ready.ok) return ready;
    const record = metadata.get(handle);
    if (!record) return unavailable('SECRET_HANDLE_NOT_FOUND');
    const current = now();
    if (record.expiresAt <= current) {
      metadata.delete(handle);
      return unavailable('SECRET_HANDLE_EXPIRED');
    }
    if (context?.policyId && context.policyId !== record.policyId) return unavailable('POLICY_SCOPE_MISMATCH');
    if (context?.agentId && context.agentId !== record.agentId) return unavailable('AGENT_SCOPE_MISMATCH');
    if (context?.capability && !record.capabilities.includes(context.capability)) return unavailable('CAPABILITY_SCOPE_MISMATCH');

    let resolved;
    try {
      resolved = await provider.resolve(handle, {
        policyId: record.policyId,
        agentId: record.agentId,
        capability: context.capability || null,
        purpose: record.purpose
      });
    } catch {
      return unavailable('PROVIDER_RESOLVE_FAILED');
    }
    if (!resolved || resolved.ok !== true || resolved.value == null) return unavailable('PROVIDER_RESOLVE_REFUSED');

    try {
      const result = await consumer(resolved.value);
      return { ok: true, result };
    } catch {
      return unavailable('SECRET_CONSUMER_FAILED');
    } finally {
      /* JavaScript cannot guarantee zeroisation of a provider-owned value. The
         provider contract remains responsible for its own memory handling;
         this boundary guarantees it is not persisted or returned here. */
      resolved = null;
    }
  };

  const listHandles = () => [...metadata.values()].map((record) => ({ ...record }));

  return Object.freeze({
    status,
    bind,
    revoke,
    withSecretHandle,
    listHandles
  });
}

export function unavailableSecretManager() {
  return createSecretManager();
}
