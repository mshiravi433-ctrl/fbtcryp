/**
 * The fit surface, end to end over the real HTTP path.
 *
 * `server/fios/opportunityFit.js` scores an opportunity against the
 * OWNER's risk profile, capital, liquidity need and goal, and answers
 * FITTED / CONDITIONAL / NOT_FITTED with a reason for every dimension.
 * It existed, complete, while «کدام گزینه مناسب من است؟» was
 * UNSUPPORTED — a working engine answering nothing.
 *
 * These probes assert the bridge, the module, the intent, the plan
 * template and the finding — including the case where the provider is NOT
 * wired, which must report a named reason and never a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, INTENT_TYPES } from '../../src/lib/central/intent.js';
import { setFitProvider, hasFitProvider, readFit } from '../../server/ci/fitBridge.js';
import { setCiSource, resetCiSources } from '../../server/ci/sources.js';

/* ── 1. the bridge ────────────────────────────────────────────────────── */

test('an unwired bridge says PROVIDER_NOT_WIRED instead of throwing', async () => {
  const out = await readFit('owner-x');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'PROVIDER_NOT_WIRED');
  assert.ok(out.detail.length > 0, 'the reason must be readable');
});

test('the bridge hands the provider a per-owner read', async () => {
  const seen = [];
  const dispose = setFitProvider(async (owner, opts) => {
    seen.push({ owner, opts });
    return { ok: true, status: 'OK', result: { ranked: [], count: 0 } };
  });
  try {
    assert.equal(hasFitProvider(), true);
    const out = await readFit('owner-y', { refresh: true });
    assert.equal(out.ok, true);
    assert.equal(seen[0].owner, 'owner-y', 'the owner must travel to the engine — a shared ranking would be a privacy bug');
  } finally {
    dispose();
  }
});

test('a throwing provider is caught and named', async () => {
  const dispose = setFitProvider(async () => { throw new Error('boom'); });
  try {
    const out = await readFit('owner-z');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'FIT_FAILED');
    assert.match(out.detail, /boom/);
  } finally {
    dispose();
  }
});

test('an engine-level failure is passed through with its own code', async () => {
  const dispose = setFitProvider(async () => ({ ok: false, code: 'NO_OPPORTUNITIES', detail: 'nothing to rank' }));
  try {
    const out = await readFit('owner-w');
    assert.equal(out.ok, true, 'the bridge delivered the answer; the engine said no');
    assert.equal(out.fit.ok, false);
    assert.equal(out.fit.code, 'NO_OPPORTUNITIES');
  } finally {
    dispose();
  }
});

/* ── 2. the module ────────────────────────────────────────────────────── */

test('the opportunity-fit module is registered', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const of = mods.find((m) => m.id === 'opportunity-fit');
  assert.ok(of, 'the opportunity-fit module must be registered');
  assert.deepEqual(of.state, ['opportunityFit'], 'it must own a state section, or nothing ever reads it');
});

test('the module reports PROVIDER_NOT_WIRED honestly when the OS is absent', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const of = mods.find((m) => m.id === 'opportunity-fit');
  const out = await of.read({}, { owner: 'nobody' });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(out.reason, 'PROVIDER_NOT_WIRED');
});

test('the module carries the ranking and the profile it was scored against', async () => {
  const dispose = setFitProvider(async () => ({
    ok: true, status: 'OK', at: 123,
    result: {
      ranked: [{ opportunityId: 'o1', verdict: 'FITTED', score: 88, asset: 'USDC', apyPct: 24.5, reason: '5 of 5 criteria fit the profile' }],
      count: 1,
      capitalUsd: 5000,
      riskTolerance: 'MODERATE',
      coverage: { crypto: 3, traditional: 1 }
    }
  }));
  try {
    const { createModules } = await import('../../server/ci/modules.js');
    const mods = createModules({});
    const of = mods.find((m) => m.id === 'opportunity-fit');
    const out = await of.read({}, { owner: 'owner-a' });
    assert.equal(out.status, 'OK');
    assert.equal(out.data.count, 1);
    assert.equal(out.data.ranked[0].verdict, 'FITTED');
    assert.equal(out.data.riskTolerance, 'MODERATE', 'the answer must say WHOSE fit this is');
    assert.equal(out.data.capitalUsd, 5000);
    assert.equal(out.data.coverage.crypto, 3);
  } finally {
    dispose();
  }
});

test('the module reports an engine failure with the engine\'s own code', async () => {
  const dispose = setFitProvider(async () => ({ ok: false, code: 'NO_OPPORTUNITIES', detail: 'nothing readable' }));
  try {
    const { createModules } = await import('../../server/ci/modules.js');
    const mods = createModules({});
    const of = mods.find((m) => m.id === 'opportunity-fit');
    const out = await of.read({}, { owner: 'owner-a' });
    assert.equal(out.status, 'UNAVAILABLE');
    assert.equal(out.reason, 'NO_OPPORTUNITIES');
  } finally {
    dispose();
  }
});

/* ── 3. the intent ────────────────────────────────────────────────────── */

test('a fit question reaches the fit intent', () => {
  const caps = { wallet: 'AVAILABLE', portfolio: 'AVAILABLE', markets: 'AVAILABLE', risk: 'AVAILABLE', signals: 'AVAILABLE', news: 'AVAILABLE' };
  const ctx = { capabilities: caps, stateHas: { markets: true, signals: true, news: true, portfolio: true } };
  for (const q of [
    'کدام گزینه مناسب من است؟',
    'کدام گزینه به پروفایل ریسک من می‌خوره؟',
    'چی با شرایط من جور است؟',
    'what fits my profile?',
    'کدوم با پروفایل من سازگاره؟'
  ]) {
    const c = classify(q, { context: ctx, state: {} });
    assert.equal(c.type, 'OPPORTUNITY_FIT', `«${q}» → ${c.type} (${JSON.stringify(c.evidence)})`);
  }
});

test('the yield question still belongs to the yield intent', () => {
  const caps = { wallet: 'AVAILABLE', portfolio: 'AVAILABLE', markets: 'AVAILABLE', risk: 'AVAILABLE', signals: 'AVAILABLE', news: 'AVAILABLE' };
  const ctx = { capabilities: caps, stateHas: { markets: true, signals: true, news: true, portfolio: true } };
  for (const q of ['بهترین ییلد کجاست؟', 'کدام استخر سود بیشتری می‌دهد؟', 'best apy on ETH']) {
    const c = classify(q, { context: ctx, state: {} });
    assert.equal(c.type, 'YIELD_OPPORTUNITY', `«${q}» → ${c.type} — the fit question is about the OWNER, and this one never mentions them`);
  }
});

test('the intent names the fit module', () => {
  assert.ok(INTENT_TYPES.OPPORTUNITY_FIT, 'OPPORTUNITY_FIT must be a real intent');
  assert.ok(INTENT_TYPES.OPPORTUNITY_FIT.modules.includes('opportunity-fit'));
});

test('every new intent has a PLAN TEMPLATE, or nothing is ever read', async () => {
  const { templateFor } = await import('../../src/lib/central/planner.js');
  for (const name of ['YIELD_OPPORTUNITY', 'STAKING_REWARD', 'LIQUIDITY_RISK', 'SMART_MONEY_READ', 'OPPORTUNITY_FIT']) {
    const steps = templateFor(name);
    assert.ok(Array.isArray(steps) && steps.length > 0, `${name} has no plan template — its plan would be EMPTY and no module would ever be asked`);
  }
});

/* ── 4. the live HTTP path ────────────────────────────────────────────── */

test('the brain reads the fit section over the real HTTP path', async () => {
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
      body: JSON.stringify({ message: 'کدام گزینه مناسب من است؟', locale: 'fa' })
    });
    const body = await res.json();
    assert.equal(body.intent.intentType, 'OPPORTUNITY_FIT');
    assert.ok(body.intent.requiredModules.includes('opportunity-fit'));
    assert.ok((body.plan?.length || body.intent?.plan?.length || 0) > 0, 'the plan must not be empty');
    /* Whatever the sandbox can read, the answer must be honest about it:
       either a ranking, or a NAMED reason for having none. */
    const text = String(body.response?.text || '');
    assert.ok(text.length > 0, 'the turn must say something');
    assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/, 'the answer must not leak a broken value');
  } finally {
    resetCiSources();
    if (srv) srv.close();
  }
});
