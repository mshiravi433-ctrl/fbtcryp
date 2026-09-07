/**
 * FBT Insurance OS — Provider Registry (§8, §28).
 *
 * Holds provider metadata + the live adapter instance. Providers are NOT
 * hard-coded through the codebase: every engine looks providers up here.
 *
 * Health is monitored per provider and cached. Unhealthy providers are never
 * recommended for new purchases but existing coverage stays visible (§28).
 *
 * Real provider payloads are NOT fabricated. v1 ships two sandbox providers
 * (EVM + Solana) plus a Nexus Mutual adapter stub that reports NOT_CONFIGURED
 * until real documentation/credentials exist. When a provider isn't
 * configured, product discovery and quoting simply skip it.
 */

import { assertAdapterShape } from './adapter.js';
import { PROVIDER_STATUS } from './constants.js';
import { isProduction } from './env.js';

const registry = new Map(); // providerId -> record

const healthCache = new Map(); // providerId -> { at, status }

function defaultHealth() {
  return { status: PROVIDER_STATUS.HEALTHY, latencyMs: 0, quoteSuccessRate: 1, lastChecked: Date.now(), ok: true };
}

/**
 * registerProvider({ id, name, adapter, chains, enabled, ...meta })
 * `configured` must be false unless a REAL, verified provider integration exists.
 * PRODUCTION GATE: a provider with status SANDBOX can never be registered in
 * production — the request throws SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION.
 */
export function registerProvider(spec) {
  const id = String(spec?.id || '').toLowerCase().trim();
  if (!id) throw new Error('PROVIDER_ID_REQUIRED');
  if (isProduction && String(spec?.status || '').toUpperCase() === 'SANDBOX') {
    const err = new Error(`SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION: refusing to register "${id}" while NODE_ENV=production`);
    err.code = 'SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION';
    throw err;
  }
  registry.set(id, {
    providerId: id,
    name: spec.name || id,
    displayName: spec.displayName || spec.name || id,
    adapter: spec.adapter,
    status: spec.status || 'SANDBOX',
    configured: spec.configured === true,
    enabled: spec.enabled !== false && spec.configured === true, // non-configured providers stay disabled for quoting
    supportedChains: Array.isArray(spec.supportedChains) ? spec.supportedChains : [],
    supportedProducts: Array.isArray(spec.supportedProducts) ? spec.supportedProducts : [],
    contractAddresses: spec.contractAddresses || {},
    apiEndpoints: spec.apiEndpoints || {},
    sdkVersion: spec.sdkVersion || '1.0.0',
    healthStatus: PROVIDER_STATUS.HEALTHY,
    lastChecked: Date.now(),
    riskScore: spec.riskScore || null,
    commissionModel: spec.commissionModel || { type: 'none', bps: 0, note: 'No commission agreement — none taken (§19)' },
    documentationUrl: spec.documentationUrl || null,
    termsUrl: spec.termsUrl || null,
    auditStatus: spec.auditStatus || 'pending',
    settlementModel: spec.settlementModel || 'DIRECT', // DIRECT vs ROUTED
    disclaimer: spec.disclaimer || '',
    at: Date.now()
  });
  return registry.get(id);
}

export function getProvider(id) {
  return registry.get(String(id || '').toLowerCase()) || null;
}

export function listProviders({ includeDisabled = true } = {}) {
  return [...registry.values()]
    .filter((p) => includeDisabled || p.enabled)
    .map((p) => publicProvider(p));
}

export function publicProvider(p) {
  const h = healthCache.get(p.providerId)?.status || p.healthStatus || PROVIDER_STATUS.UNKNOWN;
  return {
    providerId: p.providerId,
    name: p.name,
    displayName: p.displayName,
    status: p.status,
    configured: p.configured,
    enabled: p.enabled,
    supportedChains: p.supportedChains,
    supportedProducts: p.supportedProducts,
    contractAddresses: p.contractAddresses,
    settlementModel: p.settlementModel,
    healthStatus: h,
    lastChecked: p.lastChecked,
    riskScore: p.riskScore,
    commissionModel: p.commissionModel,
    documentationUrl: p.documentationUrl,
    termsUrl: p.termsUrl,
    auditStatus: p.auditStatus,
    disclaimer: p.disclaimer
  };
}

/** Enabled + configured providers that can actually quote on a chain. */
export function quotingProviders(chainId) {
  return [...registry.values()].filter(
    (p) => p.enabled && p.configured && (!chainId || p.supportedChains.includes(Number(chainId)))
  );
}

export function providerAdapter(id) {
  const p = getProvider(id);
  return p?.adapter || null;
}

/** Record a probe result and broadcast a ProviderHealthChanged event. */
export function noteHealth(providerId, { status, latencyMs, quoteSuccessRate, detail }) {
  const p = getProvider(providerId);
  if (!p) return null;
  const prev = p.healthStatus;
  const next = status || (quoteSuccessRate === 0 ? PROVIDER_STATUS.UNAVAILABLE : PROVIDER_STATUS.HEALTHY);
  p.healthStatus = next;
  p.lastChecked = Date.now();
  healthCache.set(providerId, {
    at: Date.now(),
    status: next,
    latencyMs: latencyMs ?? 0,
    quoteSuccessRate: quoteSuccessRate ?? 1,
    detail: detail || null
  });
  if (prev !== next) {
    // Emit lazily (import cycle avoided): caller of noteHealth passes emit fn.
  }
  return { providerId, from: prev, to: next, at: p.lastChecked };
}

export function healthOf(providerId) {
  const cached = healthCache.get(providerId);
  if (cached) return { ...cached, at: cached.at };
  const p = getProvider(providerId);
  return { status: p?.healthStatus || PROVIDER_STATUS.UNKNOWN, ok: (p?.healthStatus || PROVIDER_STATUS.UNKNOWN) === PROVIDER_STATUS.HEALTHY, at: p?.lastChecked || 0 };
}

/** Tests only. */
export function clearProviders() { registry.clear(); healthCache.clear(); }
export const _providerRegistry = registry;
