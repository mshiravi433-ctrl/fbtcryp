/**
 * FBT INTENT AI — Venue health probe adapter.
 *
 * Read-only: probes provider health endpoints and records results.
 * Wave 1 evidence: venue-health.
 * Never submits transactions or signs anything.
 */

import { createHash } from 'node:crypto';
import { verifyProviderHealth } from '../src/lib/intent-ai/operationalActivation.js';

export const VENUE_HEALTH_SCHEMA = 'fbt.venue-health.v1';

/* Known venue health endpoints (public, read-only) */
const VENUE_ENDPOINTS = {
  binance: { url: 'https://api.binance.com/api/v3/ping', timeout: 5000 },
  coinbase: { url: 'https://api.coinbase.com/v2/ping', timeout: 5000 },
  kraken: { url: 'https://api.kraken.com/0/public/SystemStatus', timeout: 5000 }
};

/* In-memory health records */
const healthRecords = new Map();

/**
 * Probe a single venue's health.
 */
export async function probeVenue(venueId, { now = Date.now() } = {}) {
  const endpoint = VENUE_ENDPOINTS[venueId];
  if (!endpoint) {
    return { ok: false, code: 'UNKNOWN_VENUE', venueId };
  }

  const startTime = now;
  let available = false;
  let latencyMs = 0;
  let error = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), endpoint.timeout);

    const response = await fetch(endpoint.url, { signal: controller.signal });
    clearTimeout(timeout);

    latencyMs = Date.now() - startTime;
    available = response.ok || response.status === 200;
  } catch (e) {
    latencyMs = Date.now() - startTime;
    error = e.message;
    available = false;
  }

  const digest = createHash('sha256')
    .update(`${venueId}:${available}:${latencyMs}:${now}`)
    .digest('hex');

  const record = {
    venueId,
    available,
    latencyMs,
    digest,
    checkedAt: now,
    expiresAt: now + 300_000,
    error
  };

  healthRecords.set(venueId, record);
  return record;
}

/**
 * Probe all known venues.
 */
export async function probeAllVenues({ now = Date.now() } = {}) {
  const results = [];
  for (const venueId of Object.keys(VENUE_ENDPOINTS)) {
    results.push(await probeVenue(venueId, { now }));
  }
  return results;
}

/**
 * Get venue health evidence for phase activation.
 */
export function venueHealthEvidence({ now = Date.now() } = {}) {
  /* Check if we have any healthy venue */
  let bestVenue = null;
  for (const [venueId, record] of healthRecords.entries()) {
    if (record.available && record.expiresAt > now) {
      if (!bestVenue || record.latencyMs < bestVenue.latencyMs) {
        bestVenue = record;
      }
    }
  }

  if (!bestVenue) {
    return { ok: false, code: 'NO_HEALTHY_VENUE' };
  }

  return verifyProviderHealth({
    kind: 'venue-health',
    providerId: bestVenue.venueId,
    digest: bestVenue.digest,
    checkedAt: bestVenue.checkedAt,
    expiresAt: bestVenue.expiresAt,
    available: true,
    attested: true,
    health: 'healthy'
  }, { now });
}

/**
 * Get venue health status for public reporting.
 */
export function venueHealthStatus({ now = Date.now() } = {}) {
  const venues = [];
  for (const [venueId, record] of healthRecords.entries()) {
    venues.push({
      venueId,
      available: record.available,
      latencyMs: record.latencyMs,
      checkedAt: record.checkedAt,
      stale: record.expiresAt <= now
    });
  }
  return {
    schema: VENUE_HEALTH_SCHEMA,
    probed: venues.length,
    healthy: venues.filter(v => v.available && !v.stale).length,
    venues
  };
}
