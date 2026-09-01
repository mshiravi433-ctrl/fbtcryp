/**
 * FBT CENTRAL INTELLIGENCE OS — Module Registry (§10, §11, §38, §40).
 * ---------------------------------------------------------------------------
 * The Central AI knows ONLY the FBTModule adapter interface:
 *
 *   getState / healthCheck / capabilities / read / quote / prepare /
 *   simulate / execute / verify / recover
 *
 * Business logic stays inside the modules/adapters (§38) — the brain
 * orchestrates, it does not hoard. Every module self-declares what it
 * supports, and the registry enforces §40: a feature that misses one of the
 * FEATURE_REQUIREMENTS is reported INCOMPLETE, never silently accepted.
 */
import { ADAPTER_METHODS, CAPABILITY_STATUSES, FEATURE_REQUIREMENTS, MODULES } from './constants.js';
import { publish } from './eventBus.js';

const registry = new Map();

const UNSETTLED = Object.freeze({
  ok: false,
  status: 'UNSUPPORTED',
  error: 'OPERATION_NOT_SUPPORTED',
  detail: 'This module does not implement the requested operation.'
});

/**
 * Build an adapter with safe defaults. A module provides only what it really
 * has; unsupported operations answer UNSUPPORTED instead of throwing — the
 * router turns that into an honest capability report.
 */
export function defineModule(spec) {
  const id = String(spec.id || '').toLowerCase();
  if (!id) throw new Error('MODULE_ID_REQUIRED');
  const ops = spec.operations || {};
  const adapter = {
    id,
    label: spec.label || id,
    permissionLevel: spec.permissionLevel || 'READ',
    dependsOn: Array.isArray(spec.dependsOn) ? spec.dependsOn.slice() : [],
    /** Which FEATURE_REQUIREMENTS this module genuinely provides. */
    declares: new Set(spec.declares || ['capability', 'tool', 'state', 'health', 'read']),
    getState: ops.getState || (async () => ({ dataStatus: 'unavailable' })),
    healthCheck: ops.healthCheck || (async () => ({ ok: false, status: 'UNAVAILABLE', reason: 'NO_HEALTH_PROBE' })),
    capabilities: ops.capabilities || (() => ({ status: 'UNAVAILABLE', operations: Object.keys(ops) })),
    read: ops.read || (async () => UNSETTLED),
    quote: ops.quote || (async () => UNSETTLED),
    prepare: ops.prepare || (async () => UNSETTLED),
    simulate: ops.simulate || (async (input, ctx) => {
      // Sensible default: simulate == dry-run the quote so callers always get
      // a structured answer when the module can quote but has no simulator.
      if (ops.quote) return ops.quote(input, ctx);
      return UNSETTLED;
    }),
    execute: ops.execute || (async () => UNSETTLED),
    verify: ops.verify || (async (input) => ({ ok: false, verified: false, status: 'UNSUPPORTED', detail: 'no verifier registered', input: input ? undefined : undefined })),
    recover: ops.recover || (async (error) => ({ recovered: false, strategy: 'NONE', error: String(error?.message || error || '').slice(0, 160) })),
    meta: spec.meta || {}
  };
  return adapter;
}

export function registerModule(spec) {
  const adapter = spec && typeof spec.getState === 'function' ? spec : defineModule(spec);
  for (const m of ADAPTER_METHODS) {
    if (typeof adapter[m] !== 'function') throw new Error(`ADAPTER_METHOD_MISSING:${adapter.id}:${m}`);
  }
  const existing = registry.has(adapter.id);
  registry.set(adapter.id, adapter);
  publish(existing ? 'CAPABILITY_CHANGED' : 'MODULE_REGISTERED', { module: adapter.id }, { source: 'registry' });
  return adapter;
}

export const getModule = (id) => registry.get(String(id || '').toLowerCase()) || null;
export const hasModule = (id) => registry.has(String(id || '').toLowerCase());
export const registeredModuleIds = () => [...registry.keys()];

/** §10 completeness: which of the required 30 modules are registered. */
export function moduleCoverage() {
  const missing = MODULES.filter((m) => !registry.has(m));
  return { required: MODULES.length, registered: registry.size, missing, complete: missing.length === 0 };
}

/**
 * §40 — Feature completeness audit. A module must declare every requirement;
 * anything missing flips the feature to INCOMPLETE with an explicit list so
 * nobody ships a half-wired feature.
 */
export function featureCompleteness(id) {
  const adapter = getModule(id);
  if (!adapter) return { module: id, status: 'NOT_REGISTERED', missing: FEATURE_REQUIREMENTS.slice() };
  const missing = FEATURE_REQUIREMENTS.filter((req) => !adapter.declares.has(req));
  return {
    module: adapter.id,
    status: missing.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
    missing,
    permissionLevel: adapter.permissionLevel,
    dependsOn: adapter.dependsOn
  };
}

export function listModules() {
  return [...registry.values()].map((a) => ({
    id: a.id,
    label: a.label,
    permissionLevel: a.permissionLevel,
    dependsOn: a.dependsOn,
    completeness: featureCompleteness(a.id)
  }));
}

/** Test hook. */
export function clearRegistry() { registry.clear(); }

export const _internal = { registry };
