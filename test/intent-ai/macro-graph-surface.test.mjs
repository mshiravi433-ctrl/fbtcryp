/**
 * The macro-graph surface — the REGIME, next to the market overview.
 *
 * `server/fios/macroGraph.js` reads the global snapshot, the world model
 * and the portfolio TOGETHER and builds the transmission graph between
 * them. A market overview that quotes breadth and the top movers answers
 * "what is moving"; the graph answers "what kind of market is this".
 *
 * The engine existed and was unreachable. These probes assert the bridge,
 * the module, the intent wiring and the finding — including the case
 * where the provider is NOT wired, which must report a named reason and
 * never a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, INTENT_TYPES } from '../../src/lib/central/intent.js';
import { setMacroGraphProvider, hasMacroGraphProvider, readMacroGraph } from '../../server/ci/fitBridge.js';
import { setCiSource, resetCiSources } from '../../server/ci/sources.js';

/* ── 1. the bridge ────────────────────────────────────────────────────── */

test('an unwired macro-graph bridge says PROVIDER_NOT_WIRED', async () => {
  const out = await readMacroGraph('owner-x');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'PROVIDER_NOT_WIRED');
  assert.ok(out.detail.length > 0, 'the reason must be readable');
});

test('the macro-graph bridge hands the provider a per-owner read', async () => {
  const seen = [];
  const dispose = setMacroGraphProvider(async (owner, opts) => {
    seen.push({ owner, opts });
    return { ok: true, graph: { nodes: [], edges: [] } };
  });
  try {
    assert.equal(hasMacroGraphProvider(), true);
    const out = await readMacroGraph('owner-y', { refresh: true });
    assert.equal(out.ok, true);
    assert.equal(seen[0].owner, 'owner-y', 'the owner must travel to the engine — the graph carries that owner\'s portfolio impulse');
  } finally {
    dispose();
  }
});

test('a throwing macro-graph provider is caught and named', async () => {
  const dispose = setMacroGraphProvider(async () => { throw new Error('boom'); });
  try {
    const out = await readMacroGraph('owner-z');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'MACRO_GRAPH_FAILED');
    assert.match(out.detail, /boom/);
  } finally {
    dispose();
  }
});

/* ── 2. the module ────────────────────────────────────────────────────── */

test('the macro-graph module is registered', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const mg = mods.find((m) => m.id === 'macro-graph');
  assert.ok(mg, 'the macro-graph module must be registered');
  assert.deepEqual(mg.state, ['macroGraph'], 'it must own a state section, or nothing ever reads it');
});

test('the module reports PROVIDER_NOT_WIRED honestly when the OS is absent', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const mg = mods.find((m) => m.id === 'macro-graph');
  const out = await mg.read({}, { owner: 'nobody' });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(out.reason, 'PROVIDER_NOT_WIRED');
});

test('the module carries the graph and says it is an estimate', async () => {
  const dispose = setMacroGraphProvider(async () => ({
    ok: true,
    graph: {
      at: 123,
      nodes: [{ id: 'btc', kind: 'instrument' }],
      edges: [{ from: 'macro:rates', to: 'btc' }],
      coverage: { domainsRead: ['smart_money', 'macro'], nodes: 2, edges: 1 },
      portfolioRiskImpulse: 0.12,
      impulse: { btc: 0.1 },
      pressure: { btc: -0.02 },
      estimate: true
    }
  }));
  try {
    const { createModules } = await import('../../server/ci/modules.js');
    const mods = createModules({});
    const mg = mods.find((m) => m.id === 'macro-graph');
    const out = await mg.read({}, { owner: 'owner-a' });
    assert.equal(out.status, 'OK');
    assert.equal(out.data.coverage.domainsRead.length, 2);
    assert.equal(out.data.portfolioRiskImpulse, 0.12);
    assert.equal(out.data.estimate, true, 'the graph is a first-order model and must say so');
  } finally {
    dispose();
  }
});

/* ── 3. the intent wiring ────────────────────────────────────────────── */

test('the market overview now asks for the global and macro modules', () => {
  const mods = INTENT_TYPES.MARKET_OVERVIEW.modules;
  assert.ok(mods.includes('macro-graph'), 'the overview must reach the regime engine');
  assert.ok(mods.includes('global-intel'), 'the regime reads the global snapshot');
});

test('the market-overview plan reads the regime', async () => {
  const { templateFor } = await import('../../src/lib/central/planner.js');
  const steps = templateFor('MARKET_OVERVIEW');
  assert.ok(Array.isArray(steps) && steps.length > 0, 'the overview must have a plan');
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes('global.read'), 'the plan must read the global section');
});

test('a market-overview question still reaches the market overview', () => {
  const caps = { wallet: 'AVAILABLE', portfolio: 'AVAILABLE', markets: 'AVAILABLE', risk: 'AVAILABLE', signals: 'AVAILABLE', news: 'AVAILABLE' };
  const ctx = { capabilities: caps, stateHas: { markets: true, signals: true, news: true, portfolio: true } };
  for (const q of ['وضعیت بازار چطوره؟', 'بازار چه خبری داره؟', 'market overview']) {
    const c = classify(q, { context: ctx, state: {} });
    assert.equal(c.type, 'MARKET_OVERVIEW', `«${q}» → ${c.type}`);
  }
});

/* ── 4. the live HTTP path ────────────────────────────────────────────── */

test('the brain reads the regime over the real HTTP path', async () => {
  setCiSource('yields', async () => ({ ok: true, pools: [], considered: 0, source: 'yields-engine', at: Date.now() }));
  let srv = null;
  try {
    const app = (await import('../../server/app.js')).default;
    srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = srv.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/brain/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'وضعیت بازار چطوره؟', locale: 'fa' })
    });
    const body = await res.json();
    assert.equal(body.intent.intentType, 'MARKET_OVERVIEW');
    assert.ok(body.intent.requiredModules.includes('macro-graph'), 'the live intent must ask for the regime module');
    const text = String(body.response?.text || '');
    assert.ok(text.length > 0, 'the turn must say something');
    assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/, 'the answer must not leak a broken value');
  } finally {
    resetCiSources();
    if (srv) srv.close();
  }
});
