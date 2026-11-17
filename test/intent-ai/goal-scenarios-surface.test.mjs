/**
 * The goal-scenario surface — the three profiles for a target.
 *
 * `server/fios/goalScenarios.js` builds a CONSERVATIVE / BALANCED /
 * AGGRESSIVE profile for a target, each with its allocation, expected
 * value, max drawdown, probability of loss and probability of halving,
 * plus the percentiles of a modelled distribution. The brain's own
 * `goals.simulate` computes a feasibility figure — can the target be
 * reached? — and the scenario engine is the other half: what the road
 * LOOKS like, and how likely each version of it is to arrive.
 *
 * The engine existed and was unreachable. These probes assert the
 * bridge, the module, the intent wiring and the finding — including the
 * refusal case, which is the most valuable thing the engine does: with
 * no real capital it models nothing and says so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, INTENT_TYPES } from '../../src/lib/central/intent.js';
import { setScenarioProvider, hasScenarioProvider, readScenarios } from '../../server/ci/fitBridge.js';
import { setCiSource, resetCiSources } from '../../server/ci/sources.js';

/* ── 1. the bridge ────────────────────────────────────────────────────── */

test('an unwired scenario bridge says PROVIDER_NOT_WIRED', async () => {
  const out = await readScenarios('owner-x');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'PROVIDER_NOT_WIRED');
  assert.ok(out.detail.length > 0, 'the reason must be readable');
});

test('the scenario bridge hands the provider a per-owner read', async () => {
  const seen = [];
  const dispose = setScenarioProvider(async (owner, opts) => {
    seen.push({ owner, opts });
    return { ok: true, scenarios: [] };
  });
  try {
    assert.equal(hasScenarioProvider(), true);
    const out = await readScenarios('owner-y', { goal: { targetUsd: 1000 } });
    assert.equal(out.ok, true);
    assert.equal(seen[0].owner, 'owner-y', 'the owner must travel to the engine');
    assert.deepEqual(seen[0].opts.goal, { targetUsd: 1000 }, 'the goal must travel with it');
  } finally {
    dispose();
  }
});

test('a throwing scenario provider is caught and named', async () => {
  const dispose = setScenarioProvider(async () => { throw new Error('boom'); });
  try {
    const out = await readScenarios('owner-z');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'SCENARIOS_FAILED');
    assert.match(out.detail, /boom/);
  } finally {
    dispose();
  }
});

test("the engine's own refusal travels with its code", async () => {
  const dispose = setScenarioProvider(async () => ({ ok: false, code: 'NO_STARTING_CAPITAL', detail: 'a scenario needs real capital; nothing was modelled and nothing was guessed' }));
  try {
    const out = await readScenarios('owner-w');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'NO_STARTING_CAPITAL');
    assert.match(out.detail, /real capital/);
  } finally {
    dispose();
  }
});

/* ── 2. the module ────────────────────────────────────────────────────── */

test('the goal-scenarios module is registered', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const gs = mods.find((m) => m.id === 'goal-scenarios');
  assert.ok(gs, 'the goal-scenarios module must be registered');
  assert.deepEqual(gs.state, ['goalScenarios'], 'it must own a state section, or nothing ever reads it');
});

test('the module reports PROVIDER_NOT_WIRED honestly when the OS is absent', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const gs = mods.find((m) => m.id === 'goal-scenarios');
  const out = await gs.read({}, { owner: 'nobody' });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(out.reason, 'PROVIDER_NOT_WIRED');
});

test('the module carries each profile with its drawdown and its probability of loss', async () => {
  const dispose = setScenarioProvider(async () => ({
    ok: true, at: 123, startUsd: 5000, months: 24, targetUsd: 100000,
    estimate: true,
    recommended: { profile: 'BALANCED' },
    scenarios: [
      { profile: 'CONSERVATIVE', expectedReturnPct: 6, expectedValueUsd: 5692, maxDrawdownPct: -24.12, probabilityOfLossPct: 37.9, probabilityOfHalvingPct: 0.6, allocation: { stablePct: 65 }, percentiles: { p10: 3794, p50: 5485, p90: 7865 } },
      { profile: 'BALANCED', expectedReturnPct: 14, expectedValueUsd: 7063, maxDrawdownPct: -41.3, probabilityOfLossPct: 48.2, probabilityOfHalvingPct: 3.1, allocation: { stablePct: 35 }, percentiles: { p10: 2977, p50: 7063, p90: 15870 } }
    ]
  }));
  try {
    const { createModules } = await import('../../server/ci/modules.js');
    const mods = createModules({});
    const gs = mods.find((m) => m.id === 'goal-scenarios');
    const out = await gs.read({}, { owner: 'owner-a' });
    assert.equal(out.status, 'OK');
    assert.equal(out.data.scenarios.length, 2);
    assert.equal(out.data.scenarios[0].maxDrawdownPct, -24.12);
    assert.equal(out.data.scenarios[1].probabilityOfLossPct, 48.2);
    assert.equal(out.data.estimate, true, 'a modelled distribution must say it is one');
  } finally {
    dispose();
  }
});

test('the module reports the refusal when there is no capital', async () => {
  const dispose = setScenarioProvider(async () => ({ ok: false, code: 'NO_STARTING_CAPITAL', detail: 'a scenario needs real capital' }));
  try {
    const { createModules } = await import('../../server/ci/modules.js');
    const mods = createModules({});
    const gs = mods.find((m) => m.id === 'goal-scenarios');
    const out = await gs.read({}, { owner: 'owner-a' });
    assert.equal(out.status, 'UNAVAILABLE');
    assert.equal(out.reason, 'NO_STARTING_CAPITAL');
  } finally {
    dispose();
  }
});

/* ── 3. the intent wiring ────────────────────────────────────────────── */

test('the goal plan now asks for the scenario module', () => {
  assert.ok(INTENT_TYPES.GOAL_PLAN.modules.includes('goal-scenarios'), 'the goal plan must reach the scenario engine');
});

test('the goal-plan plan reads the scenarios', async () => {
  const { templateFor } = await import('../../src/lib/central/planner.js');
  const steps = templateFor('GOAL_PLAN');
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes('scenarios.read'), 'the plan must read the scenarios');
});

test('a goal question still reaches the goal plan', () => {
  const caps = { wallet: 'AVAILABLE', portfolio: 'AVAILABLE', markets: 'AVAILABLE', risk: 'AVAILABLE', signals: 'AVAILABLE', news: 'AVAILABLE' };
  const ctx = { capabilities: caps, stateHas: { markets: true, signals: true, news: true, portfolio: true, goals: true } };
  for (const q of ['برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟', 'در ۶ ماه چطوری میشه به هدف رسید؟']) {
    const c = classify(q, { context: ctx, state: {} });
    assert.equal(c.type, 'GOAL_PLAN', `«${q}» → ${c.type}`);
  }
});

/* ── 4. the live HTTP path ────────────────────────────────────────────── */

test('the brain reads the scenarios over the real HTTP path', async () => {
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
      body: JSON.stringify({ message: 'برای رسیدن به هدفم چه برنامه‌ای داشته باشم؟', locale: 'fa' })
    });
    const body = await res.json();
    assert.equal(body.intent.intentType, 'GOAL_PLAN');
    assert.ok(body.intent.requiredModules.includes('goal-scenarios'));
    const text = String(body.response?.text || '');
    assert.ok(text.length > 0, 'the turn must say something');
    assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/, 'the answer must not leak a broken value');
  } finally {
    resetCiSources();
    if (srv) srv.close();
  }
});
