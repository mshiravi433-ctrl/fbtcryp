/**
 * FBT Insurance OS — standard API envelope (§6).
 *
 * Every /api/insurance response carries: requestId, timestamp, version, data,
 * warnings, errors, source and freshness so the UI can always show WHERE a
 * number came from and HOW OLD it is. Stale data is never presented as
 * real-time: `freshness.stale` plus an explicit warning travel with it.
 */
import { randomUUID } from 'node:crypto';
import { FRESHNESS_TTL_MS } from './env.js';

export const API_VERSION = 'v1';

export const SOURCES = Object.freeze({
  PROVIDER_API: 'provider-api',
  BLOCKCHAIN: 'blockchain',
  ORACLE: 'oracle',
  DATABASE_CACHE: 'database-cache',
  REGISTRY: 'registry',
  NONE: 'none'
});

function envelope(res, { ok, status, data, warnings, errors, source, fetchedAt, ttlMs, meta }) {
  const at = fetchedAt || Date.now();
  const age = Date.now() - at;
  const ttl = ttlMs ?? FRESHNESS_TTL_MS;
  const stale = Number.isFinite(age) && age > ttl;
  const warningsOut = [...(warnings || [])];
  if (stale && ok) warningsOut.push('STALE_DATA_REFRESH_REQUIRED');
  res.status(status).json({
    ok,
    requestId: `req-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    version: API_VERSION,
    data: data ?? null,
    warnings: warningsOut,
    errors: errors || [],
    source: source || SOURCES.NONE,
    freshness: {
      updatedAt: new Date(at).toISOString(),
      ageMs: age,
      ttlMs: ttl,
      stale,
      label: stale ? 'STALE' : age < 60_000 ? 'LIVE' : 'CACHED'
    },
    ...(meta ? { meta } : {})
  });
}

/** 2xx success wrapper. */
export function respondOk(res, data, opts = {}) {
  return envelope(res, { ok: true, status: opts.status || 200, data, ...opts });
}

/** Typed failure. `code` is a stable machine-readable string. */
export function respondError(res, status, code, detail, opts = {}) {
  return envelope(res, {
    ok: false, status, data: opts.data || null,
    errors: [{ code, detail: detail || '', ...(opts.extra || {}) }],
    ...opts
  });
}

/** Wrap a raw provider fetch result into source/freshness opts for respond*. */
export function fromProviderFetch(fetchResult, source = SOURCES.PROVIDER_API) {
  return {
    source,
    fetchedAt: fetchResult?.at || Date.now(),
    ttlMs: FRESHNESS_TTL_MS
  };
}
