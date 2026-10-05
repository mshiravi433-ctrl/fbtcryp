/**
 * WORLD CONSOLE MODEL — honesty unit tests (node:test, no DOM).
 * ---------------------------------------------------------------------------
 * The FBT جهانی upgrade draws seven new sub-tabs from worldModel.js. These
 * tests pin down the contract the screen is built on:
 *
 *   · an input that was not read produces status 'unread' — never a number;
 *   · scenario weights always sum to 100 and stay within their clamps;
 *   · the challenger only marks a risk "observed" when the reading exists;
 *   · the globe never attaches a reading the pass did not produce;
 *   · the flow map lights a node only from a real value.
 *
 * Run: npm run test:world-state
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorldState, buildWeather, buildRadar, buildCountrySnapshot,
  buildFlowMap, buildFutureTree, buildChallenger, buildDna, buildCausalLocal,
  COUNTRIES, FUTURE_ASSETS
} from '../src/components/ai/worldState/worldModel.js';

const NOW = Date.now();

/* A fully-loaded pass — the same shape the cross-asset engine emits. */
const FULL = {
  intelligence: {
    available: 9, missing: [],
    domains: {
      smart_money: { status: 'OK', data: { accumulationUsd: 2_000_000, distributionUsd: 500_000, topTokens: [{ symbol: 'BTC' }] } },
      whales: { status: 'OK', data: { count: 6, events: [{ symbol: 'ETH', valueUsd: 9_000_000 }] } },
      onchain: { status: 'OK', data: { healthySources: 2, downSources: 0, sources: [{}, {}] } },
      news: { status: 'OK', data: { count: 12 } },
      macro: { status: 'OK', data: { byTopic: { FED: 2, GEOPOLITICS: 2 } } },
      rwa: { status: 'OK', data: { instruments: [{ symbol: 'XAU', change24hPct: 0.9 }] } }
    }
  },
  briefing: { items: [{ id: 'a', priority: 'critical', kind: 'macro', title: 't', source: 's' }] },
  cross: {
    status: 'OK',
    classes: {
      crypto: { avgChangePct: 1.8, top: [{ symbol: 'BTC', changePct: 2.4 }], bottom: [] },
      stocks: { avgChangePct: -0.4 }
    },
    regime: { regime: 'MIXED' },
    divergences: [{ classes: ['crypto', 'stocks'], gapPct: 2.2 }],
    macro: {
      indicators: [
        { symbol: 'DXY', priceUsd: 108.2, change1dPct: 0.8, source: 'stooq:DX.F' },
        { symbol: 'GOLD', priceUsd: 2450, change1dPct: 0.5, source: 'stooq:GC.F' },
        { symbol: 'WTI', priceUsd: 78.4, change1dPct: -0.6, source: 'stooq:CL.F' },
        { symbol: 'BRENT', priceUsd: 81.2, change1dPct: -0.3, source: 'stooq:BRN.F' },
        { symbol: 'COPPER', priceUsd: 4.5, change1dPct: 0.2, source: 'stooq:HG.F' },
        { symbol: 'SPX', priceUsd: 5480, change1dPct: 0.4, source: 'stooq:ES.F' },
        { symbol: 'US10Y', priceUsd: 4.21, change1dPct: 0.4, source: 'fred:DGS10' }
      ],
      curve: { symbol: 'US2S10S', spreadPct: -0.21, source: 'fred:T10Y2Y' }
    },
    outlook: { label: 'RECESSION_WATCH', score: -0.21 }
  },
  flows: {
    tokenFlows: { status: 'OK', topInflow: { symbol: 'BTC', mcapChangeUsd: 1_900_000_000, mcapChangePct: 1.4 } },
    chainFlows: { status: 'OK', net24hUsd: 84_000_000, topInflowChain: { chain: 'ethereum', net24hUsd: 92_000_000 } }
  },
  toman: { status: 'fresh', value: 500_000, source: 'wallex' },
  goldEtfs: { available: true }
};

test('world state: a fully-read pass lights every gauge with evidence', () => {
  const { metrics, okCount, total } = buildWorldState(FULL);
  assert.equal(total, 9, 'nine gauges');
  assert.equal(okCount, 9, 'every gauge answered');
  for (const m of metrics) {
    assert.equal(m.status, 'ok', `${m.id} is ok`);
    assert.ok(m.evidence.length >= 1, `${m.id} names the reading behind it`);
  }
  const dollar = metrics.find((m) => m.id === 'dollar');
  assert.equal(dollar.dir, 'up', 'DXY +0.8% ⇒ dollar strength rising');
  const risk = metrics.find((m) => m.id === 'risk');
  assert.equal(risk.level, 'high', 'RECESSION_WATCH ⇒ high risk');
});

test('world state: an empty pass yields nine honest unreads, never numbers', () => {
  const { metrics, okCount } = buildWorldState({});
  assert.equal(okCount, 0);
  for (const m of metrics) {
    assert.equal(m.status, 'unread', `${m.id} stays unread`);
    assert.equal(m.evidence.length, 0, `${m.id} has no fabricated evidence`);
    assert.equal(m.meter, 0, `${m.id} meter is empty`);
  }
});

test('weather: tones follow the readings and NA when unread', () => {
  const rows = buildWeather(FULL);
  assert.ok(rows.length >= 6);
  const liq = rows.find((r) => r.id === 'liquidity');
  assert.equal(liq.tone, 'sun', 'positive stablecoin net ⇒ sunny');
  const empty = buildWeather({}).find((r) => r.id === 'liquidity');
  assert.equal(empty.tone, 'na');
});

test('radar: blips come from briefing priorities and measured movers', () => {
  const { blips, counts } = buildRadar(FULL);
  assert.ok(blips.length >= 2);
  assert.ok(counts.critical >= 1, 'critical briefing item ⇒ critical blip');
  assert.ok(counts.opportunity >= 1, 'the BTC inflow is an opportunity blip');
  for (const b of blips) {
    assert.ok(b.r > 0 && b.r <= 1, 'blip placed on a real ring');
    assert.ok(Number.isFinite(Math.cos(b.angle)), 'blip has a real angle');
  }
});

test('globe: country snapshots only carry instruments this pass read', () => {
  const us = buildCountrySnapshot(COUNTRIES.find((c) => c.id === 'us'), FULL, {});
  assert.equal(us.status, 'read');
  const syms = us.rows.map((r) => r.sym);
  assert.ok(syms.includes('DXY') && syms.includes('US10Y'), 'US links to read instruments');
  assert.ok(typeof us.net === 'number', 'net is computed from real changes');

  const ir = buildCountrySnapshot(COUNTRIES.find((c) => c.id === 'ir'), FULL, {});
  assert.ok(ir.rows.some((r) => r.sym === 'USDT/TMN'), 'Iran links the fresh TMN reference');

  const emptyUs = buildCountrySnapshot(COUNTRIES.find((c) => c.id === 'us'), {}, {});
  assert.equal(emptyUs.status, 'unread', 'no data ⇒ unread country');
  assert.equal(emptyUs.rows.length, 0);

  const noToman = buildCountrySnapshot(COUNTRIES.find((c) => c.id === 'ir'), { ...FULL, toman: { status: 'stale' } }, {});
  assert.ok(!noToman.rows.some((r) => r.sym === 'USDT/TMN'), 'a stale rial reference is dropped, not shown');
});

test('flow map: nodes light only from real values', () => {
  const { nodes, edges } = buildFlowMap(FULL);
  assert.equal(nodes.length, 6);
  const usd = nodes.find((n) => n.id === 'usd');
  assert.equal(usd.status, 'ok');
  assert.equal(usd.dir, 'up');
  const empty = buildFlowMap({});
  assert.ok(empty.nodes.every((n) => n.status === 'unread'));
  assert.ok(empty.edges.every((e) => e.active === false));
});

test('future tree: weights always sum to 100 and stay clamped', () => {
  for (const asset of FUTURE_ASSETS) {
    for (const data of [FULL, {}, { cross: { regime: { regime: 'RISK_OFF' }, outlook: { label: 'RECESSION_WATCH' } } }]) {
      const { weights } = buildFutureTree(data, asset);
      assert.equal(weights.bull + weights.base + weights.stress, 100, `${asset} weights sum to 100`);
      for (const w of Object.values(weights)) assert.ok(w >= 5 && w <= 80, 'weights stay within clamps');
    }
  }
});

test('future tree: recessions and inverted curves push stress, not bull', () => {
  const calm = buildFutureTree({}, 'btc');
  const stressed = buildFutureTree(FULL, 'btc');
  assert.ok(stressed.weights.stress >= calm.weights.stress, 'observed macro stress raises the stress case');
});

test('challenger: risks are observed only when the reading exists', () => {
  const full = buildChallenger(FULL);
  assert.ok(full.opportunity, 'a positive inflow becomes the thesis');
  const byId = Object.fromEntries(full.arguments.map((a) => [a.id, a]));
  assert.equal(byId.macro.observed, true, 'inverted curve ⇒ macro risk observed');
  assert.equal(byId.liquidity.observed, false, 'positive stablecoin net ⇒ liquidity risk NOT observed');
  assert.equal(byId.dollar.observed, true, 'DXY up ⇒ dollar headwind observed');
  assert.equal(byId.model.observed, false, 'model risk is always a standing risk');
  assert.ok(full.arguments.every((a) => !a.observed || a.evidence), 'every observed risk carries its evidence');

  const none = buildChallenger({});
  assert.equal(none.opportunity, null, 'no positive signal ⇒ no thesis to attack');
});

test('dna: priors are fixed, observations come from the pass', () => {
  const btc = buildDna(FULL, 'BTC');
  assert.equal(btc.priors.liquidity, 0.9, 'the prior is the documented model value');
  assert.equal(btc.observed.change, 2.4, 'BTC carries its measured class-top move');
  assert.equal(btc.observed.whaleTouched, true, 'BTC appears in the labelled smart-money flows');
  assert.equal(btc.observed.volatility, 'high', 'a 2.4% move reads as high volatility');
});

test('dna: usd alignment is computed, not guessed', () => {
  const btc = buildDna(FULL, 'BTC');
  /* BTC +2.4% while DXY +0.8% ⇒ they moved together this pass. */
  assert.equal(btc.observed.usdAlignment, 'same');
  const empty = buildDna({}, 'BTC');
  assert.equal(empty.observed.change, null);
  assert.equal(empty.observed.usdAlignment, null, 'no DXY read ⇒ no alignment claim');
});

test('causal local chain: lit edges need both endpoints read', () => {
  const full = buildCausalLocal(FULL);
  const oil = full.nodes.find((n) => n.id === 'oil');
  const em = full.nodes.find((n) => n.id === 'em');
  assert.equal(oil.state, 'read');
  assert.equal(em.state, 'model', 'EM pressure is model-labelled, never faked');
  const empty = buildCausalLocal({});
  assert.ok(empty.nodes.every((n) => n.state === 'unread'));
  assert.ok(empty.edges.every((e) => e.lit === false));
});
