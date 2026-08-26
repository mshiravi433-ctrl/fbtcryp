/**
 * FBT INTENT AI — Phase 15: External Agent runtime boundary.
 *
 * External agents receive only an opaque, scoped handle. They do not receive a
 * wallet address as authority, a signer, a seed, a private key, a password, or
 * a master credential. This module does not manufacture a provider: without a
 * real health-checked provider it reports `unavailable` and does not issue a
 * session.
 */

import {
  containsRawSecret,
  fail,
  finite,
  noExecutionPermission,
  safeId,
  safeList,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const EXTERNAL_RUNTIME_SCHEMA = 'fbt.external-agent-runtime.v1';
export const RUNTIME_SESSION_SCHEMA = 'fbt.external-agent-session.v1';
export const CAPABILITY_NEGOTIATION_SCHEMA = 'fbt.external-capability-negotiation.v1';
export const RUNTIME_REQUEST_SCHEMA = 'fbt.external-runtime-request.v1';
export const RUNTIME_EVENT_SCHEMA = 'fbt.external-runtime-event.v1';

const forbiddenRequestFields = /private.?key|seed|mnemonic|master.?password|raw.?secret|credential|signer|calldata/i;

function opaque(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
function safeCapabilities(value) {
  return safeList(value, (item) => safeString(String(item).toLowerCase(), 64), 32);
}
function publicResponse(value, seen = new Set(), depth = 0) {
  if (depth > 5 || value == null) return value == null ? null : '[TRUNCATED]';
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => publicResponse(item, seen, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 24)
    .filter(([key]) => !forbiddenRequestFields.test(key))
    .map(([key, item]) => [key, publicResponse(item, seen, depth + 1)]));
}
function publicSession(session) {
  return {
    schema: RUNTIME_SESSION_SCHEMA,
    id: session.id,
    agentId: session.agentId,
    handle: session.handle,
    capabilities: [...session.capabilities],
    allowedChains: [...session.allowedChains],
    allowedProtocols: [...session.allowedProtocols],
    maxTransactionUsd: session.maxTransactionUsd,
    expiresAt: session.expiresAt,
    revoked: session.revoked,
    disconnected: session.disconnected,
    externalReceivesHandleOnly: true,
    rawCredentialsAllowed: false,
    executionAuthorized: false
  };
}
function providerHealthy(provider, now) {
  if (!provider || typeof provider.health !== 'function') return { ok: false, code: 'RUNTIME_PROVIDER_UNAVAILABLE' };
  try {
    const health = provider.health();
    if (!health || health.ok !== true || health.operational !== true || health.attested !== true) return { ok: false, code: 'RUNTIME_PROVIDER_NOT_ATTESTED' };
    if (health.expiresAt != null && Number(health.expiresAt) <= now) return { ok: false, code: 'RUNTIME_PROVIDER_EVIDENCE_EXPIRED' };
    return { ok: true, health };
  } catch { return { ok: false, code: 'RUNTIME_PROVIDER_HEALTH_FAILED' }; }
}

export function createExternalAgentRuntime({ provider = null, now: clock = () => Date.now() } = {}) {
  const currentTime = () => Number(clock());
  const handles = new Map();
  const runtime = {
    schema: EXTERNAL_RUNTIME_SCHEMA,
    providerConfigured: Boolean(provider),
    status() {
      const check = providerHealthy(provider, currentTime());
      return {
        schema: EXTERNAL_RUNTIME_SCHEMA,
        status: check.ok ? 'configured' : 'unavailable',
        providerId: check.ok ? safeId(check.health.providerId || check.health.id) : null,
        attested: check.ok,
        sessions: [...handles.values()].filter((row) => !row.revoked && !row.disconnected).length,
        rawCredentialsAllowed: false,
        executionActivated: false,
        blocker: check.ok ? null : check.code
      };
    },
    negotiate({ passport, requestedCapabilities = [], chainId, protocol, userAuthorized = false, guardianApproved = false } = {}) {
      if (!passport || passport.securityStatus !== 'verified' || passport.verification?.independentlyVerified !== true || !safeId(passport.id)) return fail('AGENT_NOT_VERIFIED');
      if (containsRawSecret(passport)) return fail('RAW_CREDENTIAL_FORBIDDEN');
      const capabilities = safeCapabilities(requestedCapabilities);
      const passportCapabilities = safeCapabilities(passport.capabilities);
      const supportedChains = safeList(passport.supportedChains, (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null, 64);
      const supportedProtocols = safeList(passport.supportedProtocols, (value) => safeString(String(value).toLowerCase(), 64), 64);
      const missing = capabilities.filter((capability) => !passportCapabilities.includes(capability));
      const chain = finite(chainId);
      const protocolName = safeString(String(protocol || '').toLowerCase(), 64);
      const compatible = (chain === null || supportedChains.includes(chain))
        && (!protocolName || supportedProtocols.includes(protocolName))
        && missing.length === 0;
      return noExecutionPermission({
        ok: compatible,
        schema: CAPABILITY_NEGOTIATION_SCHEMA,
        agentId: safeId(passport.id),
        requestedCapabilities: capabilities,
        missingCapabilities: missing,
        chainId: chain,
        protocol: protocolName,
        compatible,
        userAuthorized: userAuthorized === true,
        guardianApproved: guardianApproved === true,
        canIssueSession: compatible && userAuthorized === true && guardianApproved === true && providerHealthy(provider, currentTime()).ok,
        rawCredentialsAllowed: false
      });
    },
    issueSession({ passport, capabilities = [], allowedChains = [], allowedProtocols = [], maxTransactionUsd, ttlMs = 15 * 60_000, userAuthorized = false, guardianApproved = false } = {}) {
      const health = providerHealthy(provider, currentTime());
      if (!health.ok) return unavailable(health.code, 'A real attested runtime provider is required before a session can be issued.');
      if (!passport || passport.securityStatus !== 'verified' || passport.verification?.independentlyVerified !== true || !safeId(passport.id)) return fail('AGENT_NOT_VERIFIED');
      if (containsRawSecret(passport)) return fail('RAW_CREDENTIAL_FORBIDDEN');
      if (userAuthorized !== true) return fail('USER_AUTHORIZATION_REQUIRED');
      if (guardianApproved !== true) return fail('GUARDIAN_APPROVAL_REQUIRED');
      const chainScope = safeList(allowedChains, (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null, 16);
      const protocolScope = safeList(allowedProtocols, (value) => safeString(String(value).toLowerCase(), 64), 16);
      const capabilityScope = safeCapabilities(capabilities);
      const max = finite(maxTransactionUsd);
      const passportMax = finite(passport.maxTransactionUsd);
      const ttl = finite(ttlMs);
      if (!chainScope.length || !protocolScope.length || !capabilityScope.length) return fail('RUNTIME_SCOPE_INCOMPLETE');
      if (max === null || max <= 0 || (passportMax !== null && max > passportMax)) return fail('TRANSACTION_LIMIT_INVALID');
      if (ttl === null || ttl <= 0) return fail('EXPIRATION_REQUIRED');
      const supportedChains = safeList(passport.supportedChains, (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null, 64);
      const supportedProtocols = safeList(passport.supportedProtocols, (value) => safeString(String(value).toLowerCase(), 64), 64);
      const passportCapabilities = safeCapabilities(passport.capabilities);
      if (chainScope.some((chain) => !supportedChains.includes(chain)) || protocolScope.some((name) => !supportedProtocols.includes(name)) || capabilityScope.some((name) => !passportCapabilities.includes(name))) return fail('RUNTIME_SCOPE_EXCEEDS_PASSPORT');
      const session = {
        schema: RUNTIME_SESSION_SCHEMA,
        id: opaque('runtime'),
        agentId: safeId(passport.id),
        handle: opaque('handle'),
        capabilities: capabilityScope,
        allowedChains: chainScope,
        allowedProtocols: protocolScope,
        maxTransactionUsd: max,
        issuedAt: currentTime(),
        expiresAt: currentTime() + Math.min(ttl, 24 * 3600_000),
        revoked: false,
        disconnected: false
      };
      handles.set(session.id, session);
      return { ok: true, schema: RUNTIME_SESSION_SCHEMA, session: publicSession(session), handlesOnly: true, executionAuthorized: false, rawCredentialsAllowed: false };
    },
    validateRequest(sessionOrId, request = {}) {
      const session = typeof sessionOrId === 'string' ? handles.get(sessionOrId) : sessionOrId?.id ? handles.get(sessionOrId.id) || sessionOrId : null;
      const now = currentTime();
      if (!session || session.schema !== RUNTIME_SESSION_SCHEMA) return fail('RUNTIME_SESSION_NOT_FOUND');
      if (session.revoked) return fail('SESSION_REVOKED');
      if (session.disconnected) return fail('RUNTIME_DISCONNECTED');
      if (now >= session.expiresAt) return fail('SESSION_EXPIRED');
      if (!request || typeof request !== 'object' || Object.keys(request).some((key) => forbiddenRequestFields.test(key)) || containsRawSecret(request)) return fail('RAW_CREDENTIAL_FORBIDDEN');
      const chainId = finite(request.chainId);
      const protocol = safeString(String(request.protocol || '').toLowerCase(), 64);
      const amountUsd = finite(request.amountUsd);
      const capability = safeString(String(request.capability || '').toLowerCase(), 64);
      if (chainId === null || !session.allowedChains.includes(chainId)) return fail('CHAIN_SCOPE_EXCEEDED');
      if (!protocol || !session.allowedProtocols.includes(protocol)) return fail('PROTOCOL_SCOPE_EXCEEDED');
      if (amountUsd === null || amountUsd <= 0 || amountUsd > session.maxTransactionUsd) return fail('TRANSACTION_SCOPE_EXCEEDED');
      if (!capability || !session.capabilities.includes(capability)) return fail('CAPABILITY_SCOPE_EXCEEDED');
      return { ok: true, schema: RUNTIME_REQUEST_SCHEMA, sessionId: session.id, handle: session.handle, request: { chainId, protocol, amountUsd, capability }, expiresAt: session.expiresAt, checkedAt: now, executionAuthorized: false, externalReceivesHandleOnly: true };
    },
    async invoke(sessionOrId, request = {}) {
      const checked = runtime.validateRequest(sessionOrId, request);
      if (!checked.ok) return checked;
      const session = handles.get(checked.sessionId);
      if (!provider || typeof provider.request !== 'function') return unavailable('RUNTIME_TRANSPORT_UNAVAILABLE');
      try {
        const result = await provider.request({ handle: session.handle, request: checked.request, expiresAt: checked.expiresAt });
        if (!result || result.ok !== true) return unavailable('EXTERNAL_AGENT_RESULT_UNAVAILABLE');
        if (containsRawSecret(result) || forbiddenRequestFields.test(JSON.stringify(result.response ?? {}))) return fail('EXTERNAL_AGENT_RESULT_UNSAFE');
        return { ok: true, schema: RUNTIME_EVENT_SCHEMA, sessionId: session.id, agentId: session.agentId, status: 'observed', response: publicResponse(result.response), evidenceId: safeId(result.evidenceId) || null, executionAuthorized: false, rawCredentialsAllowed: false };
      } catch { return unavailable('RUNTIME_TRANSPORT_FAILED'); }
    },
    revoke(sessionOrId) {
      const session = typeof sessionOrId === 'string' ? handles.get(sessionOrId) : handles.get(sessionOrId?.id);
      if (!session) return fail('RUNTIME_SESSION_NOT_FOUND');
      session.revoked = true;
      return { ok: true, schema: RUNTIME_SESSION_SCHEMA, session: publicSession(session), immediate: true, canExecute: false };
    },
    disconnect(sessionOrId) {
      const session = typeof sessionOrId === 'string' ? handles.get(sessionOrId) : handles.get(sessionOrId?.id);
      if (!session) return fail('RUNTIME_SESSION_NOT_FOUND');
      session.disconnected = true;
      return { ok: true, schema: RUNTIME_SESSION_SCHEMA, session: publicSession(session), immediate: true, canExecute: false };
    }
  };
  return runtime;
}

/** Standalone request check for callers that do not retain the runtime object. */
export function validateExternalRuntimeRequest(session, request, { now = Date.now() } = {}) {
  if (!session || session.schema !== RUNTIME_SESSION_SCHEMA) return fail('RUNTIME_SESSION_NOT_FOUND');
  if (session.revoked) return fail('SESSION_REVOKED');
  if (session.disconnected) return fail('RUNTIME_DISCONNECTED');
  if (now >= Number(session.expiresAt)) return fail('SESSION_EXPIRED');
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => forbiddenRequestFields.test(key)) || containsRawSecret(request)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const chain = finite(request?.chainId);
  const protocol = safeString(String(request?.protocol || '').toLowerCase(), 64);
  const amountUsd = finite(request?.amountUsd);
  const capability = safeString(String(request?.capability || '').toLowerCase(), 64);
  if (!session.allowedChains?.includes(chain)) return fail('CHAIN_SCOPE_EXCEEDED');
  if (!session.allowedProtocols?.includes(protocol)) return fail('PROTOCOL_SCOPE_EXCEEDED');
  if (amountUsd === null || amountUsd <= 0 || amountUsd > Number(session.maxTransactionUsd)) return fail('TRANSACTION_SCOPE_EXCEEDED');
  if (!capability || !session.capabilities?.includes(capability)) return fail('CAPABILITY_SCOPE_EXCEEDED');
  return { ok: true, schema: RUNTIME_REQUEST_SCHEMA, handle: session.handle, request: { chainId: chain, protocol, amountUsd, capability }, expiresAt: session.expiresAt, executionAuthorized: false, rawCredentialsAllowed: false };
}
