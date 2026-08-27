/**
 * PHASE 73 — LIVE VENUE FEDERATION
 * A list is not a route. Health is probed and timestamped, a dead or stale
 * venue is REMOVED from routing rather than ranked last, and "nothing is
 * routable" is an honest answer.
 */
import { readFileSync } from 'node:fs';
import {
  probeVenues, isRoutable, routeOrder, assertNoDeadVenue,
  ROUTING_SCHEMA, VENUE_STATES, HEALTH_MAX_AGE_MS, MAX_LATENCY_MS, MIN_VENUE_SUCCESS_RATE
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const venue = (id, res) => ({ id, probe: async () => res });

try {
  /* ---------- probing ---------- */
  const probed = await probeVenues({
    venues: [
      venue('alpha', { ok: true, latencyMs: 120, successRate: 0.99, observedAt: NOW }),
      venue('beta', { ok: true, latencyMs: MAX_LATENCY_MS + 500, successRate: 0.99, observedAt: NOW }),
      venue('gamma', { ok: true, latencyMs: 100, successRate: 0.4, observedAt: NOW }),
      venue('delta', { ok: false }),
      { id: 'epsilon', probe: async () => { throw new Error('down'); } },
      { id: 'zeta' },
      { id: 'eta', probe: () => new Promise((r) => { setTimeout(() => r({ ok: true, latencyMs: 1, successRate: 1 }), 500); }) }
    ],
    timeoutMs: 20,
    now: NOW
  });
  const by = Object.fromEntries(probed.health.map((h) => [h.id, h]));
  check('the probe returns health for every venue', probed.ok === true && probed.health.length === 7);
  check('a healthy venue is live', by.alpha.state === 'live');
  check('a slow venue is degraded, not live', by.beta.state === 'degraded');
  check('a venue failing most requests is dead', by.gamma.state === 'dead' && by.gamma.reason === 'SUCCESS_RATE_TOO_LOW');
  check('a venue that says not-ok is dead', by.delta.state === 'dead');
  check('a venue that throws is dead', by.epsilon.state === 'dead' && by.epsilon.reason === 'PROBE_ERROR');
  check('a venue with no probe is unknown, not assumed live', by.zeta.state === 'unknown');
  check('a venue that times out is dead', by.eta.state === 'dead' && by.eta.reason === 'PROBE_TIMEOUT');
  check('every health entry is timestamped', probed.health.every((h) => typeof h.observedAt === 'number'));
  check('every state is a known state', probed.health.every((h) => VENUE_STATES.includes(h.state)));
  check('only the live one is listed live', probed.live.length === 1 && probed.live[0] === 'alpha');
  check('a venue with unreadable health is not live',
    (await probeVenues({ venues: [venue('x', { ok: true })], now: NOW })).health[0].state === 'unknown');
  check('the success threshold is a real threshold', MIN_VENUE_SUCCESS_RATE > 0.5 && MIN_VENUE_SUCCESS_RATE <= 1);

  /* ---------- staleness ---------- */
  check('fresh live health is routable', isRoutable(by.alpha, { now: NOW }).routable === true);
  check('stale health is NOT routable', isRoutable(by.alpha, { now: NOW + HEALTH_MAX_AGE_MS + 1 }).routable === false);
  check('the staleness is named', isRoutable(by.alpha, { now: NOW + HEALTH_MAX_AGE_MS + 1 }).reason === 'HEALTH_STALE');
  check('degraded is not routable', isRoutable(by.beta, { now: NOW }).routable === false);
  check('dead is not routable', isRoutable(by.delta, { now: NOW }).routable === false);
  check('unknown is not routable', isRoutable(by.zeta, { now: NOW }).routable === false);
  check('health with no timestamp is not routable', isRoutable({ state: 'live' }, { now: NOW }).routable === false);
  check('nothing at all is not routable', isRoutable(null, { now: NOW }).routable === false);

  /* ---------- routing ---------- */
  const health = [
    { id: 'alpha', state: 'live', observedAt: NOW },
    { id: 'beta', state: 'live', observedAt: NOW },
    { id: 'gamma', state: 'dead', observedAt: NOW }
  ];
  const quotes = [
    { venueId: 'alpha', price: 100.5, maxSizeUsd: 5000, observedAt: NOW },
    { venueId: 'beta', price: 100.1, maxSizeUsd: 5000, observedAt: NOW },
    { venueId: 'gamma', price: 90, maxSizeUsd: 999999, observedAt: NOW }
  ];
  const route = routeOrder({ health, quotes, order: { side: 'buy', sizeUsd: 1000 }, now: NOW });
  check('an order routes to a live venue', route.routed === true && route.schema === ROUTING_SCHEMA);
  check('the cheapest live venue wins a buy', route.venue === 'beta');
  check('the best price on a sell is the highest',
    routeOrder({ health, quotes, order: { side: 'sell', sizeUsd: 1000 }, now: NOW }).venue === 'alpha');
  check('a dead venue is never a candidate even with the best price', route.candidates.includes('gamma') === false);
  check('the removal is reported with a reason', route.removed.some((r) => r.id === 'gamma'));
  check('routing does not authorize execution', route.executionAuthorized === false);
  check('routing still requires the confirmation gate', route.requiresConfirmationGate === true);
  check('the selection is a translatable notice', route.i18nKey === 'intentAI.routing.selected');
  const allDead = routeOrder({ health: health.map((h) => ({ ...h, state: 'dead' })), quotes, order: { sizeUsd: 100 }, now: NOW });
  check('with every venue dead nothing is routed', allDead.routed === false && allDead.venue === null);
  check('the honest reason is given', allDead.i18nKey === 'intentAI.routing.noVenue');
  check('no fallback to a remembered venue', allDead.candidates.length === 0);
  const stale = routeOrder({ health, quotes, order: { sizeUsd: 1000 }, now: NOW + HEALTH_MAX_AGE_MS + 1 });
  check('stale health routes nothing', stale.routed === false);
  const tooBig = routeOrder({ health, quotes, order: { side: 'buy', sizeUsd: 50_000 }, now: NOW });
  check('a size no live venue can fill is refused', tooBig.routed === false);
  check('the unfillable size has its own reason', tooBig.i18nKey === 'intentAI.routing.noFillableQuote');
  const staleQuote = routeOrder({
    health, order: { side: 'buy', sizeUsd: 100 },
    quotes: [{ venueId: 'alpha', price: 100, maxSizeUsd: 5000, observedAt: NOW - HEALTH_MAX_AGE_MS - 1 }], now: NOW
  });
  check('a stale quote from a live venue is not fillable', staleQuote.routed === false);
  const priceless = routeOrder({ health, order: { sizeUsd: 100 }, quotes: [{ venueId: 'alpha', maxSizeUsd: 5000, observedAt: NOW }], now: NOW });
  check('a quote with no price is not a quote', priceless.routed === false);
  check('with no quotes at all nothing routes', routeOrder({ health, quotes: [], order: { sizeUsd: 10 }, now: NOW }).routed === false);

  /* ---------- the guard ---------- */
  check('the guard accepts an honest route', assertNoDeadVenue(route, health, { now: NOW }).ok === true);
  check('the guard catches a dead venue in a route',
    assertNoDeadVenue({ routed: true, venue: 'gamma', candidates: ['gamma'] }, health, { now: NOW }).ok === false);
  check('the guard catches a stale route', assertNoDeadVenue(route, health, { now: NOW + HEALTH_MAX_AGE_MS + 1 }).ok === false);
  check('the guard catches a route to an unknown venue',
    assertNoDeadVenue({ routed: true, venue: 'omega', candidates: [] }, health, { now: NOW }).ok === false);
  check('the guard catches a route with no venue',
    assertNoDeadVenue({ routed: true, venue: null, candidates: [] }, health, { now: NOW }).reasons.includes('ROUTED_WITHOUT_VENUE'));
  check('the guard catches a route claiming authority',
    assertNoDeadVenue({ ...route, executionAuthorized: true }, health, { now: NOW }).reasons.includes('ROUTE_CLAIMS_AUTHORITY'));

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the routing copy is translated in en, fa and ar',
    locales.every((loc) => ['selected', 'noVenue', 'noFillableQuote', 'venueRemoved']
      .every((k) => typeof loc?.intentAI?.routing?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase73-live-venue-routing', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
