/**
 * The global surface, end to end over the real HTTP path.
 *
 * `server/fios/` (50 files, 980 KB) holds the global intelligence engines —
 * smart money, whales, on-chain activity, the macro graph, the briefing.
 * The central brain could not reach any of it, so «پول هوشمند کجاست؟» was
 * UNSUPPORTED while a working engine sat in that directory.
 *
 * These probes assert the bridge, the module, the intent and the finding —
 * including the case where the provider is NOT wired, which must report a
 * named reason and never a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, INTENT_TYPES } from '../../src/lib/central/intent.js';
import { setGlobalIntelProvider, hasGlobalIntelProvider, readGlobalIntel } from '../../server/ci/globalIntelBridge.js';
import { setCiSource, resetCiSources } from '../../server/ci/sources.js';

/* ── 1. the bridge ────────────────────────────────────────────────────── */

test('an unwired bridge says PROVIDER_NOT_WIRED instead of throwing', async () => {
  const out = await readGlobalIntel('owner-x');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'PROVIDER_NOT_WIRED');
  assert.ok(out.detail.length > 0, 'the reason must be readable');
});

test('the bridge hands the provider a per-owner read', async () => {
  const seen = [];
  const dispose = setGlobalIntelProvider(async (owner, opts) => {
    seen.push({ owner, opts });
    return { status: 'OK', at: 1, domains: { smart_money: { status: 'OK', data: { netFlowUsd: 1 } } } };
  });
  try {
    assert.equal(hasGlobalIntelProvider(), true);
    const out = await readGlobalIntel('owner-y', { refresh: true });
    assert.equal(out.ok, true);
    assert.equal(seen[0].owner, 'owner-y', 'the owner must travel to the engine — a shared snapshot would be a privacy bug');
    assert.equal(seen[0].opts.refresh, true);
  } finally {
    dispose();
  }
});

test('a throwing provider is caught and named', async () => {
  const dispose = setGlobalIntelProvider(async () => { throw new Error('boom'); });
  try {
    const out = await readGlobalIntel('owner-z');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'GLOBAL_INTEL_FAILED');
    assert.match(out.detail, /boom/);
  } finally {
    dispose();
  }
});

/* ── 2. the module ────────────────────────────────────────────────────── */

test('the global-intel module is registered', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const gi = mods.find((m) => m.id === 'global-intel');
  assert.ok(gi, 'the global-intel module must be registered');
  assert.deepEqual(gi.state, ['globalIntel'], 'it must own a state section, or nothing ever reads it');
});

test('the module reports PROVIDER_NOT_WIRED honestly when the OS is absent', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const gi = mods.find((m) => m.id === 'global-intel');
  const out = await gi.read({}, { owner: 'nobody' });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(out.reason, 'PROVIDER_NOT_WIRED');
});

test('the module carries only the domains that answered', async () => {
  const dispose = setGlobalIntelProvider(async () => ({
    status: 'PARTIAL',
    at: 123,
    domains: {
      smart_money: { status: 'OK', source: 'smartMoney:overview', confidence: 0.4, data: { netFlowUsd: 500, window: '24h' } },
      whales: { status: 'UNAVAILABLE', reason: 'NO_WHALE_EVENTS' },
      onchain: { status: 'OK', data: { events: 3 } }
    },
    coverage: { readable: 2 }
  }));
  try {
    const { createModules } = await import('../../server/ci/modules.js');
    const mods = createModules({});
    const gi = mods.find((m) => m.id === 'global-intel');
    const out = await gi.read({}, { owner: 'owner-a' });
    assert.equal(out.status, 'OK');
    assert.deepEqual(Object.keys(out.data.domains).sort(), ['onchain', 'smart_money']);
    assert.equal(out.data.failed.whales, 'NO_WHALE_EVENTS', 'a domain that failed must be NAMED, not dropped');
  } finally {
    dispose();
  }
});

/* ── 3. the intent ────────────────────────────────────────────────────── */

test('a smart-money question reaches the smart-money intent', () => {
  const caps = { wallet: 'AVAILABLE', portfolio: 'AVAILABLE', markets: 'AVAILABLE', risk: 'AVAILABLE', signals: 'AVAILABLE', news: 'AVAILABLE' };
  const ctx = { capabilities: caps, stateHas: { markets: true, signals: true, news: true, portfolio: true } };
  for (const q of ['پول هوشمند کجاست؟', 'اسمارت مانی چطوره؟', 'نهنگ‌ها چه می‌کنند؟', 'جریان خالص پول چقدره؟']) {
    const c = classify(q, { context: ctx, state: {} });
    assert.equal(c.type, 'SMART_MONEY_READ', `«${q}» → ${c.type} (${JSON.stringify(c.evidence)})`);
  }
});

test('the market-overview intent still owns the market questions', () => {
  const caps = { wallet: 'AVAILABLE', portfolio: 'AVAILABLE', markets: 'AVAILABLE', risk: 'AVAILABLE', signals: 'AVAILABLE', news: 'AVAILABLE' };
  const ctx = { capabilities: caps, stateHas: { markets: true, signals: true, news: true, portfolio: true } };
  for (const q of ['وضعیت بازار چطوره؟', 'بازار چه خبری داره؟', 'تورم چطوره؟', 'سیاست پولی فدرال چیه؟']) {
    const c = classify(q, { context: ctx, state: {} });
    assert.equal(c.type, 'MARKET_OVERVIEW', `«${q}» → ${c.type}`);
  }
});

test('the intent names the global module', () => {
  assert.ok(INTENT_TYPES.SMART_MONEY_READ, 'SMART_MONEY_READ must be a real intent');
  assert.ok(INTENT_TYPES.SMART_MONEY_READ.modules.includes('global-intel'));
});

test('every new intent has a PLAN TEMPLATE, or nothing is ever read', async () => {
  const { templateFor } = await import('../../src/lib/central/planner.js');
  for (const name of ['YIELD_OPPORTUNITY', 'STAKING_REWARD', 'LIQUIDITY_RISK', 'SMART_MONEY_READ']) {
    const steps = templateFor(name);
    assert.ok(Array.isArray(steps) && steps.length > 0, `${name} has no plan template — its plan would be EMPTY and no module would ever be asked`);
  }
});

/* ── 4. the live HTTP path ────────────────────────────────────────────── */

test('the brain reads the global section over the real HTTP path', async () => {
  setCiSource('yields', async () => ({ ok: true, pools: [], considered: 0, source: 'yields-engine', at: Date.now() }));
  let srv = null;
  try {
    const app = (await import('../../server/app.js')).default;
    srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = srv.address().port;
    /* Mount the Financial Intelligence OS, which is what wires the bridge. */
    await fetch(`http://127.0.0.1:${port}/api/ai/health`);

    const res = await fetch(`http://127.0.0.1:${port}/api/brain/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'پول هوشمند کجاست؟', locale: 'fa' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.intent.intentType, 'SMART_MONEY_READ');
    assert.ok(
      body.meta.sectionsRead.includes('globalIntel'),
      `the global section must be read — sectionsRead was ${JSON.stringify(body.meta.sectionsRead)}`
    );
  } finally {
    if (srv) srv.close();
    resetCiSources();
  }
});
