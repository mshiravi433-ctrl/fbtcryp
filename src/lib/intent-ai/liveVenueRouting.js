/**
 * FBT INTENT AI — PHASE 73: LIVE VENUE FEDERATION
 * ---------------------------------------------------------------------------
 * A list is not a route. Phase 26 federated venue health; phase 73 makes that
 * health real and lets it decide where an order can actually go.
 *
 *   · health is PROBED, with a timestamp; a stale probe is not health
 *   · a venue that fails its probe, times out, or has not answered recently is
 *     removed from routing — not shown as "degraded but selectable"
 *   · routing returns the honest reason when nothing is routable, instead of
 *     falling back to the last venue that once worked
 *   · a venue that returns a quote it cannot honour (no size, no freshness)
 *     is unroutable for that order even if the venue itself is up
 */

import { classifyFailure } from './failureModes.js';

export const ROUTING_SCHEMA = 'fbt.live-venue-routing.v1';
export const VENUE_STATES = Object.freeze(['live', 'degraded', 'dead', 'unknown']);
export const PROBE_TIMEOUT_MS = 3000;
export const HEALTH_MAX_AGE_MS = 30_000;
export const MAX_LATENCY_MS = 2500;
export const MIN_SUCCESS_RATE = 0.8;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Ask every venue, in parallel, with a deadline. No answer is a dead venue. */
export async function probeVenues({ venues = [], timeoutMs = PROBE_TIMEOUT_MS, now = Date.now() } = {}) {
  const list = (Array.isArray(venues) ? venues : []).slice(0, 32);
  const health = await Promise.all(list.map(async (v) => {
    const id = typeof v?.id === 'string' ? v.id : null;
    if (!id || typeof v?.probe !== 'function') {
      return { id, state: 'unknown', reason: 'NO_PROBE', observedAt: now, latencyMs: null, successRate: null };
    }
    const started = now;
    let res = null;
    try {
      res = await Promise.race([
        Promise.resolve(v.probe()),
        new Promise((resolve) => {
          const t = setTimeout(() => resolve({ __timedOut: true }), Math.max(1, num(timeoutMs) ?? PROBE_TIMEOUT_MS));
          if (typeof t?.unref === 'function') t.unref();
        })
      ]);
    } catch {
      return { id, state: 'dead', reason: 'PROBE_ERROR', observedAt: now, latencyMs: null, successRate: null };
    }
    if (res?.__timedOut) return { id, state: 'dead', reason: 'PROBE_TIMEOUT', observedAt: now, latencyMs: null, successRate: null };
    const latency = num(res?.latencyMs);
    const rate = num(res?.successRate);
    if (res?.ok !== true) return { id, state: 'dead', reason: 'PROBE_FAILED', observedAt: now, latencyMs: latency, successRate: rate };
    if (latency === null || rate === null) return { id, state: 'unknown', reason: 'INCOMPLETE_HEALTH', observedAt: now, latencyMs: latency, successRate: rate };
    if (rate < MIN_SUCCESS_RATE) return { id, state: 'dead', reason: 'SUCCESS_RATE_TOO_LOW', observedAt: now, latencyMs: latency, successRate: rate };
    if (latency > MAX_LATENCY_MS) return { id, state: 'degraded', reason: 'SLOW', observedAt: now, latencyMs: latency, successRate: rate };
    return { id, state: 'live', reason: null, observedAt: res?.observedAt ?? started, latencyMs: latency, successRate: rate };
  }));
  return {
    ok: true,
    schema: ROUTING_SCHEMA,
    health,
    live: health.filter((h) => h.state === 'live').map((h) => h.id),
    dead: health.filter((h) => h.state === 'dead').map((h) => h.id),
    probedAt: now
  };
}

/** Health that is too old is not health. */
export function isRoutable(entry, { now = Date.now(), maxAgeMs = HEALTH_MAX_AGE_MS } = {}) {
  if (!entry || !VENUE_STATES.includes(entry.state)) return { routable: false, reason: 'NO_HEALTH' };
  const at = num(entry.observedAt);
  if (at === null) return { routable: false, reason: 'NO_OBSERVATION_TIME' };
  if (now - at > (num(maxAgeMs) ?? HEALTH_MAX_AGE_MS)) return { routable: false, reason: 'HEALTH_STALE' };
  if (entry.state !== 'live') return { routable: false, reason: `VENUE_${String(entry.state).toUpperCase()}` };
  return { routable: true, reason: null };
}

/**
 * Choose where the order goes. Dead venues are not ranked last — they are
 * gone. If nothing is routable, say so honestly.
 */
export function routeOrder({ health = [], order = null, quotes = [], now = Date.now() } = {}) {
  const entries = Array.isArray(health) ? health : [];
  const routable = entries.filter((h) => isRoutable(h, { now }).routable);
  const removed = entries
    .filter((h) => !isRoutable(h, { now }).routable)
    .map((h) => ({ id: h.id, reason: isRoutable(h, { now }).reason }));
  if (!routable.length) {
    return {
      ok: false, routed: false, venue: null, candidates: [], removed,
      i18nKey: 'intentAI.routing.noVenue',
      error: classifyFailure('PROVIDER_ERROR', { detail: 'NO_LIVE_VENUE' })
    };
  }
  const size = num(order?.sizeUsd);
  const liveIds = new Set(routable.map((h) => h.id));
  const usable = (Array.isArray(quotes) ? quotes : []).filter((q) => {
    if (!liveIds.has(q?.venueId)) return false;
    if (num(q?.price) === null) return false;
    const at = num(q?.observedAt);
    if (at === null || now - at > HEALTH_MAX_AGE_MS) return false;
    // A quote that cannot carry the order is not a candidate for this order.
    if (size !== null && (num(q?.maxSizeUsd) ?? 0) < size) return false;
    return true;
  });
  if (!usable.length) {
    return {
      ok: false, routed: false, venue: null, candidates: [], removed,
      i18nKey: 'intentAI.routing.noFillableQuote',
      error: classifyFailure('MISSING_DATA', { detail: 'NO_FILLABLE_QUOTE' })
    };
  }
  const best = [...usable].sort((a, b) => (order?.side === 'sell' ? num(b.price) - num(a.price) : num(a.price) - num(b.price)))[0];
  return {
    ok: true,
    routed: true,
    schema: ROUTING_SCHEMA,
    venue: best.venueId,
    price: num(best.price),
    candidates: usable.map((q) => q.venueId),
    removed,
    // Routing picks a road; it does not drive.
    executionAuthorized: false,
    requiresConfirmationGate: true,
    i18nKey: 'intentAI.routing.selected',
    i18nParams: { venue: best.venueId, count: usable.length },
    routedAt: now
  };
}

/** No dead venue may ever appear in a route. */
export function assertNoDeadVenue(route, health = [], { now = Date.now() } = {}) {
  const reasons = [];
  const byId = new Map((Array.isArray(health) ? health : []).map((h) => [h.id, h]));
  const ids = [route?.venue, ...(Array.isArray(route?.candidates) ? route.candidates : [])].filter(Boolean);
  for (const id of ids) {
    const check = isRoutable(byId.get(id), { now });
    if (!check.routable) reasons.push(`${id}:${check.reason}`);
  }
  if (route?.routed === true && !route?.venue) reasons.push('ROUTED_WITHOUT_VENUE');
  if (route?.executionAuthorized === true) reasons.push('ROUTE_CLAIMS_AUTHORITY');
  return reasons.length
    ? { ok: false, reasons, error: classifyFailure('PROVIDER_ERROR', { detail: reasons[0] }) }
    : { ok: true };
}
