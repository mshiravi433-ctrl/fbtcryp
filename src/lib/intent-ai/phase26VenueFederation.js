/**
 * FBT INTENT AI — Phase 26: wallet, broker, bridge and venue health federation.
 * A quote or module is not live execution.
 */
import { safeId, unavailable } from './phaseBoundary.js';

export const PHASE26_SCHEMA = 'fbt.venue-federation.v1';
export const ADAPTERS = Object.freeze(['wallet', 'broker', 'bridge', 'venue']);

export function federateVenueHealth({ adapters = {}, now = Date.now() } = {}) {
  const rows = ADAPTERS.map((kind) => {
    const row = adapters[kind];
    if (!row || row.available !== true || row.attested !== true) {
      return { kind, status: 'unavailable', operational: false, live: false, code: kind === 'venue' ? 'VENUE_UNAVAILABLE' : 'PROVIDER_HEALTH_FAILURE' };
    }
    if (kind === 'bridge' && row.executable !== true) {
      return { kind, status: 'quote-only', operational: false, live: false, code: 'BRIDGE_NOT_EXECUTABLE' };
    }
    return { kind, status: 'configured-not-live', operational: false, live: false, providerId: safeId(row.providerId), checkedAt: now };
  });
  const blockers = rows.filter((row) => row.status === 'unavailable' || row.code === 'BRIDGE_NOT_EXECUTABLE').map((row) => row.code);
  return {
    ok: blockers.length === 0,
    schema: PHASE26_SCHEMA,
    adapters: rows,
    blockers,
    live: false,
    executable: false,
    operational: false
  };
}
