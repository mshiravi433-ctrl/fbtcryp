/**
 * THE ROUTE-INTELLIGENCE SURFACE (path 14)
 * ---------------------------------------------------------------------------
 * The route-intelligence engine in `server/fios/routeIntelligence.js` was
 * COMPLETE and DARK: it ranked candidate routes across five honest
 * dimensions — cost, liquidity impact, time in flight, historical success
 * and bridge risk — and it had no customers, because it waits for
 * candidate routes and nothing ever asked it for any.
 *
 * These tests cover the surface that woke it up:
 *
 *   · the INTENT — a route question is a route question, in Persian and
 *     in English, and it is not stolen by the yield or the fit surface;
 *   · the ADAPTER — the provider's own numbers are carried over, and the
 *     numbers the provider did NOT send stay UNKNOWN instead of being
 *     defaulted into something that would read as measured;
 *   · the MODULE — it reports a named failure, and it never ranks an
 *     empty candidate list;
 *   · the REGISTRY — the module is in `MODULE_IDS`, the section exists,
 *     and the event is declared.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, INTENT_TYPES } from '../../src/lib/central/intent.js';
import { MODULE_IDS, EVENT_TYPES, STATE_SECTIONS } from '../../src/lib/central/schema.js';
import {
  setRouteProvider,
  hasRouteProvider,
  readRouteCandidates,
  adaptRoutesForIntelligence,
  routeIntelligenceFor
} from '../../server/ci/routeBridge.js';

/* ─── THE INTENT ───────────────────────────────────────────────────────── */

/* The same context every surface test uses: the modules are AVAILABLE and
   the state they need has been fetched. Without it `classify` cannot
   tell an unreachable intent from an irrelevant one. */
const CAPS = {
  wallet: 'AVAILABLE', portfolio: 'AVAILABLE', markets: 'AVAILABLE',
  risk: 'AVAILABLE', signals: 'AVAILABLE', news: 'AVAILABLE'
};
const CTX = {
  capabilities: CAPS,
  stateHas: { markets: true, signals: true, news: true, portfolio: true, routeIntelligence: true }
};
const ask = (q) => classify(q, { context: CTX, state: {} });

test('a Persian route question is a route question', () => {
  const r = ask('کدام پل برای انتقال بیت‌کوین به شبکهٔ پالیگان بهتر است؟');
  assert.equal(r.type, 'ROUTE_INTELLIGENCE', `→ ${r.type}`);
});

test('an English route question is a route question', () => {
  const r = ask('which bridge is cheapest for this transfer?');
  assert.equal(r.type, 'ROUTE_INTELLIGENCE', `→ ${r.type}`);
});

test('the route intent is declared in the type registry', () => {
  assert.ok(INTENT_TYPES.ROUTE_INTELLIGENCE, 'the intent must be declared');
  assert.ok(INTENT_TYPES.ROUTE_INTELLIGENCE.modules.includes('route-intelligence'));
});

test('the route surface does not steal the fit question', () => {
  const r = ask('کدام گزینه مناسب من است؟');
  assert.equal(r.type, 'OPPORTUNITY_FIT', `→ ${r.type}`);
});

test('the route surface does not steal the yield question', () => {
  const r = ask('کدام استخر سود بیشتری می‌دهد؟');
  assert.equal(r.type, 'YIELD_OPPORTUNITY', `→ ${r.type}`);
});

test('the route surface does not steal the market question', () => {
  const r = ask('وضعیت بازار چگونه است؟');
  assert.equal(r.type, 'MARKET_OVERVIEW', `→ ${r.type}`);
});

/* ─── THE REGISTRY ─────────────────────────────────────────────────────── */

test('the route module is in the registry', () => {
  assert.ok(MODULE_IDS.includes('route-intelligence'), 'the module id must be declared');
});

test('the route state section exists', () => {
  assert.ok(STATE_SECTIONS.routeIntelligence, 'a module with no section is a module nothing asks for');
});

test('the route event is declared', () => {
  assert.ok(Array.isArray(EVENT_TYPES), 'the event types are a list');
  assert.ok(EVENT_TYPES.includes('ROUTE_INTELLIGENCE_READ'), 'the event must be declared');
});

/* ─── THE ADAPTER ──────────────────────────────────────────────────────── */

const providerRoute = {
  routeId: 'route-1',
  tool: 'across',
  toolName: 'Across',
  steps: [{ type: 'cross', tool: 'across' }],
  totalCostUsd: 4.25,
  gasCostUsd: 1.25,
  bridgeFeeUsd: 2,
  protocolFeeUsd: 1,
  estimatedTime: 180,
  slippage: 0.005,
  fromAmountUsd: 1000
};

test('the adapter carries the provider’s own cost', () => {
  const [out] = adaptRoutesForIntelligence([providerRoute], {});
  assert.equal(out.totalCostUsd, 4.25);
});

test('the adapter sums the named fee legs when there is no total', () => {
  const withoutTotal = { ...providerRoute };
  delete withoutTotal.totalCostUsd;
  const [out] = adaptRoutesForIntelligence([withoutTotal], {});
  assert.equal(out.totalCostUsd, 4.25, '1.25 gas + 2 bridge + 1 protocol');
});

test('the adapter carries the provider’s own time in flight', () => {
  const [out] = adaptRoutesForIntelligence([providerRoute], {});
  assert.equal(out.estimatedSeconds, 180);
});

test('the adapter counts the hops the provider named', () => {
  const [out] = adaptRoutesForIntelligence([providerRoute], {});
  assert.equal(out.hops, 1);
});

test('the adapter does NOT invent a liquidity depth', () => {
  const [out] = adaptRoutesForIntelligence([providerRoute], {});
  assert.equal(out.liquidityUsd, undefined, 'the provider sent no depth, so none may be invented');
});

test('the adapter does NOT invent a historical success rate', () => {
  const [out] = adaptRoutesForIntelligence([providerRoute], {});
  assert.equal(out.historicalSuccessPct, undefined, 'LI.FI sends no success rate; one must not be fabricated');
});

test('the adapter leaves an absent cost absent', () => {
  const bare = { routeId: 'r', steps: [{ type: 'cross' }] };
  const [out] = adaptRoutesForIntelligence([bare], {});
  assert.equal(out.totalCostUsd, undefined);
});

/* ─── THE BRIDGE ───────────────────────────────────────────────────────── */

test('an unwired bridge reports a named reason and no routes', async () => {
  const restore = setRouteProvider(null);
  try {
    assert.equal(hasRouteProvider(), false);
    const out = await readRouteCandidates('owner-1');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'ROUTE_PROVIDER_NOT_WIRED');
    assert.deepEqual(out.routes, []);
  } finally {
    restore();
  }
});

test('a wired bridge returns the candidates', async () => {
  const restore = setRouteProvider(async () => ({
    ok: true,
    routes: [providerRoute],
    request: { fromChain: '1', toChain: '137' },
    source: 'lifi'
  }));
  try {
    const out = await readRouteCandidates('owner-1');
    assert.equal(out.ok, true);
    assert.equal(out.routes.length, 1);
    assert.equal(out.source, 'lifi');
  } finally {
    restore();
  }
});

test('a provider failure is named, not thrown', async () => {
  const restore = setRouteProvider(async () => { throw new Error('the provider is down'); });
  try {
    const out = await readRouteCandidates('owner-1');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'ROUTE_SOURCE_FAILED');
    assert.deepEqual(out.routes, []);
  } finally {
    restore();
  }
});

test('a provider that returns nothing says NO_ROUTE', async () => {
  const restore = setRouteProvider(async () => ({ ok: true, routes: [] }));
  try {
    const out = await readRouteCandidates('owner-1');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'NO_ROUTE');
  } finally {
    restore();
  }
});

/* ─── THE RANKING ──────────────────────────────────────────────────────── */

test('the ranking names the best route and the reasons it won', async () => {
  const restore = setRouteProvider(async () => ({
    ok: true,
    routes: [
      providerRoute,
      { ...providerRoute, routeId: 'route-2', tool: 'stargate', toolName: 'Stargate', totalCostUsd: 9.5, estimatedTime: 420 }
    ],
    request: { fromChain: '1', toChain: '137', amountUsd: 1000 },
    source: 'lifi'
  }));
  try {
    const candidates = await readRouteCandidates('owner-1');
    assert.equal(candidates.ok, true);
    const ranked = await routeIntelligenceFor('owner-1', {
      request: candidates.request,
      routes: candidates.routes
    });
    assert.equal(ranked.ok, true);
    const ri = ranked.result;
    assert.equal(ri.routeCount, 2);
    assert.ok(ri.bestRoute, 'there is a best route');
    assert.equal(ri.bestRoute.routeId, 'route-1', 'the cheaper and faster one wins');
    assert.ok(Array.isArray(ri.bestRouteReasons));
    assert.ok(ri.bestRouteReasons.length > 0, 'the reasons travel with the choice');
    assert.equal(ri.executionPermission, false, 'a ranking never grants execution');
    assert.equal(ri.estimate, true);
  } finally {
    restore();
  }
});

test('the ranking refuses an empty candidate list', async () => {
  const out = await routeIntelligenceFor('owner-1', { request: {}, routes: [] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'NO_CANDIDATE_ROUTES');
});

test('the ranking says the unread dimensions out loud', async () => {
  const restore = setRouteProvider(async () => ({
    ok: true,
    routes: [providerRoute],
    request: { fromChain: '1', toChain: '137' },
    source: 'lifi'
  }));
  try {
    const candidates = await readRouteCandidates('owner-1');
    const ranked = await routeIntelligenceFor('owner-1', {
      request: candidates.request,
      routes: candidates.routes
    });
    const best = ranked.result.bestRoute;
    assert.ok(Array.isArray(best.unknownDimensions));
    assert.ok(best.unknownDimensions.includes('liquidity'), 'the depth was never measured');
    assert.ok(best.unknownDimensions.includes('historicalSuccess'), 'the success rate was never measured');
  } finally {
    restore();
  }
});
