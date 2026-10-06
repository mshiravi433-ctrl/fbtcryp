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
  buildWorldState, buildWeather, buildWeatherStations, buildClimate, buildRadar,
  buildCountrySnapshot, buildGlobeModel, buildFlowMap, buildCapitalFlow,
  buildTransmission, buildFutureTree, buildChallenger, buildDna, buildCausalLocal,
  buildOutlookReading, buildDomainsView, buildProvidersView, smartMoneyNet,
  COUNTRIES, FUTURE_ASSETS, DNA_ASSETS, RADAR_SECTORS, CLIMATE_PART_META,
  WEATHER_TONES, DOMAIN_KEYS, TONE_WORD, OUTLOOK_LABEL_FA
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
    outlook: {
      label: 'RECESSION_WATCH', score: -0.21,
      signals: [{ id: 'yield_curve', name: 'yield curve', value: -1, weight: 1.5, direction: 'cautionary', evidence: '2s10s inverted at -0.21pp', source: 'fred:T10Y2Y' }]
    }
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

/* ══════════════════════════════════════════════════════════════════════════
   THE 2026-10 QA PASS — weather board, climate, radar coverage, the globe's
   full economy list, the flow verdict, the future-tree audit, the outlook
   reader (the «دادهٔ کافی نیست» regression) and the domain/provider readers.
   Every case here fails if a number is invented.
   ══════════════════════════════════════════════════════════════════════════ */

test('weather stations: the four asked-for measures lead, and unread stays unread', () => {
  const rows = buildWeatherStations(FULL);
  const ids = rows.map((r) => r.id);
  for (const id of ['institutional', 'dollar', 'inflation', 'risk']) {
    assert.ok(ids.includes(id), `the requested measure «${id}» has a station`);
  }
  assert.ok(ids.includes('liquidity') && ids.includes('volatility'), 'the classic stations stay');

  const inst = rows.find((r) => r.id === 'institutional');
  assert.equal(inst.valueText, '+$1.5M', 'institutional flow = accumulation − distribution');
  assert.ok(inst.evidence.length >= 1, 'the station names what it read');

  for (const r of rows) {
    assert.ok(WEATHER_TONES.includes(r.tone), `${r.id} carries a known tone`);
    if (r.tone === 'na') {
      assert.equal(r.valueText, null, `${r.id} is unread ⇒ no value text`);
      assert.equal(r.severity, null, `${r.id} is unread ⇒ no severity`);
    }
    assert.ok(r.icon, `${r.id} has an icon for the panel to draw`);
  }
  const empty = buildWeatherStations({});
  assert.ok(empty.every((r) => r.tone === 'na' && r.valueText === null), 'an empty pass draws an empty board');
});

test('climate: the index is a coverage-weighted blend of real parts only', () => {
  const c = buildClimate(FULL);
  assert.equal(c.total, 9);
  assert.ok(c.readCount >= 5 && c.readCount <= 9, 'the fixture answers most parts');
  assert.ok(c.index >= 0 && c.index <= 100, 'the index is normalised to 0..100');
  assert.ok(c.coverage >= 0.3, 'the fixture has enough coverage to publish a label');
  assert.ok(c.label && TONE_WORD[c.label], 'the label is one of the weather tones');
  for (const p of c.components) {
    assert.ok(CLIMATE_PART_META[p.id], `${p.id} has a label`);
    assert.ok(p.evidence, `${p.id} carries its evidence sentence`);
    assert.ok(p.weight > 0, `${p.id} carries its declared weight`);
  }

  /* REPORTED: «اقتصاد و دارایی — دادهٔ کافی نیست». A thin pass must NOT be
     dressed up with a confident climate word. */
  const thin = buildClimate({ cross: { macro: { indicators: [{ symbol: 'DXY', change1dPct: 0.8 }] } } });
  assert.ok(thin.coverage < 0.3, 'one reading is thin coverage');
  assert.equal(thin.label, null, 'thin coverage publishes NO label');
  assert.ok(thin.index === null || thin.index >= 0, 'and never a fabricated index');
});

test('radar: every blip has a sector, a bearing and a severity within its ring', () => {
  const { blips, counts, sectors, total } = buildRadar(FULL);
  assert.equal(sectors.length, RADAR_SECTORS.length);
  assert.equal(total, blips.length);
  assert.equal(Object.values(counts).reduce((a, c) => a + c, 0), blips.length, 'the legend counts every blip');
  const sectorIds = new Set(sectors.map((s) => s.id));
  for (const b of blips) {
    assert.ok(sectorIds.has(b.sector), `${b.id} sits in a real sector`);
    assert.ok(b.bearing >= 0 && b.bearing < 360, `${b.id} has a bearing`);
    assert.ok(b.r >= 0 && b.r <= 1, `${b.id} radius is normalised`);
    assert.ok(b.value || b.value === null, `${b.id} value is either real or null`);
  }
  const empty = buildRadar({});
  assert.equal(empty.total, 0, 'an empty pass has an empty scope');
  assert.equal(empty.blips.length, 0, 'no invented blips');
});

test('globe: the economy list is complete, unique and honestly counted', () => {
  assert.ok(COUNTRIES.length >= 40, 'the globe carries a real economy list, not a handful');
  const ids = new Set(COUNTRIES.map((c) => c.id));
  assert.equal(ids.size, COUNTRIES.length, 'no duplicate country');
  for (const c of COUNTRIES) {
    assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon), `${c.id} has real coordinates`);
    assert.ok(Array.isArray(c.links) && c.links.length >= 1, `${c.id} declares what it links to`);
  }

  const model = buildGlobeModel(FULL);
  assert.equal(model.snaps.length, COUNTRIES.length, 'every country gets a snapshot');
  const cov = model.coverage;
  assert.equal(cov.read + cov.partial + cov.unread, cov.total, 'coverage adds up');
  assert.equal(cov.total, COUNTRIES.length);

  /* the row kinds tell the reader what a number IS */
  const us = model.byId.get('us');
  const kinds = new Set(us.rows.map((r) => r.kind));
  assert.ok(kinds.has('direct'), 'the US has directly read instruments');
  const cn = model.byId.get('cn');
  assert.ok(cn.rows.length >= 1, 'China links the readings the fixture supplies');

  /* an unread economy is unread — no zeroes, no dashes-as-numbers */
  const jp = buildCountrySnapshot(COUNTRIES.find((c) => c.id === 'jp'), {}, {});
  assert.equal(jp.status, 'unread');
  assert.equal(jp.rows.length, 0);
  assert.equal(jp.net, null);
});

test('capital flow: the verdict only blends measured sections', () => {
  const flow = buildCapitalFlow(FULL);
  assert.equal(flow.verdict.netUsd, 85_500_000, 'stablecoin net + labelled smart money');
  assert.equal(flow.verdict.dir, 'up');
  assert.equal(flow.verdict.bits.length, 2, 'both contributing reads are named');
  assert.equal(flow.route.nodes.length, 6, 'the six-node map is intact');

  const empty = buildCapitalFlow({});
  assert.equal(empty.verdict, null, 'nothing read ⇒ no verdict at all (not a zero)');
});

test('macro transmission: a node says read / proxy / model / unread — nothing else', () => {
  const t = buildTransmission(FULL);
  const allowed = new Set(['read', 'proxy', 'model', 'unread']);
  for (const n of t.nodes) {
    assert.ok(allowed.has(n.state), `${n.id} state «${n.state}» is one of the four honest states`);
    if (n.state === 'read') assert.ok(n.value, `${n.id} as read must carry its value`);
    if (n.state === 'unread') assert.equal(n.value, null, `${n.id} unread carries no value`);
  }
  const curve = t.nodes;
  assert.ok(curve.some((n) => n.state === 'read'), 'the fixture has read nodes');
  const empty = buildTransmission({});
  assert.ok(empty.nodes.every((n) => n.state === 'unread'));
  assert.ok(empty.edges.every((e) => e.lit === false));
});

test('future tree: the audit explains every nudge and what would flip it', () => {
  const tree = buildFutureTree(FULL, 'btc');
  assert.equal(tree.baseRate.total, 100, 'pre-normalisation totals add up');
  assert.equal(tree.baseRate.bull + tree.baseRate.base + tree.baseRate.stress, 100);
  assert.ok(tree.nudges.length >= 3, 'the fixture moves the weights');
  for (const n of tree.nudges) {
    assert.ok(n.key && typeof n.amount === 'number', 'every nudge names its key and amount');
    assert.ok(n.evidence, 'and the reading it came from');
  }
  assert.ok(tree.flip.length >= 1, 'the tree says what would change it');
  for (const f of tree.flip) assert.ok(f.textFa && f.readingFa, 'each flip condition is stated in both languages');

  /* an unread pass has no nudges — the weights are the published base rate */
  const bare = buildFutureTree({}, 'btc');
  assert.equal(bare.nudges.length, 0, 'no reads ⇒ no nudges');
  assert.equal(bare.weights.bull, bare.baseRate.bull, 'the weights are exactly the base rate');
});

test('dna: every asset answers with six genes and only real overlays', () => {
  for (const sym of DNA_ASSETS) {
    const d = buildDna(FULL, sym);
    assert.equal(d.genes.length, 6, `${sym} has six genes`);
    for (const g of d.genes) {
      assert.ok(g.prior >= 0 && g.prior <= 1, `${sym}.${g.id} prior in 0..1`);
      assert.equal(typeof g.prior, 'number', `${sym}.${g.id} prior is a number`);
    }
  }
  const dx = buildDna(FULL, 'DXY');
  assert.equal(dx.observed.change, 0.8, 'DXY carries the macro-read move, not a class move');
  const empty = buildDna({}, 'BTC');
  assert.ok(empty.genes.every((g) => g.field === null), 'nothing read ⇒ no overlay is invented');
});

test('outlook: the engine label is kept verbatim and the local complement is labelled', () => {
  const o = buildOutlookReading(FULL);
  assert.equal(o.label, 'RECESSION_WATCH', 'the engine answered ⇒ its label stands');
  assert.equal(o.engineLabel, 'RECESSION_WATCH');
  assert.equal(o.score, -0.21, 'the engine score is not recomputed');
  assert.ok(o.signals.some((s) => s.origin === 'engine'), 'engine signals are kept');
  assert.ok(o.signals.some((s) => s.origin === 'local'), 'the local complement is added');
  assert.equal(o.availableSignals, o.signals.filter((s) => s.value !== null).length);
  assert.equal(o.possible, 9, 'nine inputs are possible');
  assert.ok(o.coverage > 0 && o.coverage <= 1);
});

test('outlook: «دادهٔ کافی نیست» is no longer the answer when the pass HAS reads', () => {
  /* This is the reported bug in its exact shape: the engine could not compute
     its composite and emitted UNAVAILABLE, while the client was holding real
     readings. The reader must publish a LABELLED local composite instead of
     repeating the engine's silence. */
  const engineSilent = {
    ...FULL,
    cross: { ...FULL.cross, outlook: { label: 'UNAVAILABLE', score: null, signals: [] } }
  };
  const o = buildOutlookReading(engineSilent);
  assert.notEqual(o.label, 'UNAVAILABLE', 'a pass with real reads is not «not enough data»');
  assert.equal(o.source, 'local', 'and it says the composite is local');
  assert.ok(OUTLOOK_LABEL_FA[o.label], 'the label has a Persian word');
  assert.ok(o.signals.length >= 5, 'the local signals are all listed');
  assert.ok(o.signals.every((s) => s.origin === 'local' && s.evidence), 'each with its evidence');
  assert.ok(o.localScore !== null, 'the blended score is published');

  /* And when the pass really is empty, the honest answer is still «not enough» —
     with every missing input named and a reason for each. */
  const empty = buildOutlookReading({});
  assert.equal(empty.label, 'UNAVAILABLE');
  assert.equal(empty.score, null);
  assert.equal(empty.coverage, 0);
  assert.equal(empty.missing.length, 9, 'all nine possible inputs are named');
  for (const m of empty.missing) assert.ok(m.whyFa && m.whyEn, `${m.id} says WHY it is missing`);
});

test('domains: the smart-money and on-chain rows surface their real fields', () => {
  const domains = FULL.intelligence.domains;
  const rows = buildDomainsView(domains);
  assert.equal(rows.length, DOMAIN_KEYS.length, 'every domain key has a row');

  const sm = rows.find((r) => r.key === 'smart_money');
  assert.equal(sm.status, 'OK');
  assert.equal(sm.listKind, 'tokens');
  assert.ok(sm.list.length >= 1, 'the top tokens are surfaced, not collapsed to one number');
  assert.ok(sm.metrics.some((m) => m.key === 'netFlow'), 'the net flow is a metric');

  const macro = rows.find((r) => r.key === 'macro');
  const topics = macro.metrics.find((m) => m.key === 'topics');
  assert.ok(topics.value.includes('FED') && topics.value.includes('POLITICS'), 'both top topics are shown');

  const unavailable = buildDomainsView({ smart_money: { status: 'UNAVAILABLE', reason: 'X', data: null } })
    .find((r) => r.key === 'smart_money');
  assert.equal(unavailable.list.length, 0, 'an unavailable domain has no rows');
  assert.equal(unavailable.metrics.length, 0, 'and no metrics');
  assert.equal(unavailable.reason, 'X', 'but keeps its reason for the UI to translate');
});

test('providers: a lamp is lit only from the boolean the server sent', () => {
  const providers = {
    smart_money: { implemented: true, configured: true, provider_available: true, runtime_ready: true, live: true },
    whales: { implemented: true, configured: false, provider_available: false, runtime_ready: true, live: false, reason: 'FEED_DOWN' }
  };
  const view = buildProvidersView(providers, FULL.intelligence.domains);
  assert.equal(view.total, 2);
  assert.equal(view.lamps.length, 5, 'the five readiness lamps are declared in order');
  const sm = view.rows.find((r) => r.key === 'smart_money');
  assert.equal(sm.lit, 5);
  assert.equal(view.live, 1, 'only the row with live=true counts as live');
  const whales = view.rows.find((r) => r.key === 'whales');
  assert.equal(whales.lit, 2);
  assert.equal(whales.reason, 'FEED_DOWN');
  for (const r of view.rows) {
    for (const l of r.lamps) assert.equal(typeof l.on, 'boolean', 'a lamp is never undefined');
  }
});

test('every builder survives an empty payload without a single invented number', () => {
  const empty = {};
  const numeric = (v) => typeof v === 'number' && Number.isFinite(v);
  const walk = (node, path, hits) => {
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, hits)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, hits);
      return;
    }
    if (numeric(node) && !/(weight|coverage|total|possible|count|index|score|r|angle|bearing|severity|l|lat|lon|at|x|y)/i.test(path)) {
      hits.push(`${path}=${node}`);
    }
  };
  const hits = [];
  walk(buildWorldState(empty), 'worldState', hits);
  walk(buildWeatherStations(empty), 'weather', hits);
  walk(buildClimate(empty), 'climate', hits);
  walk(buildRadar(empty), 'radar', hits);
  walk(buildGlobeModel(empty), 'globe', hits);
  walk(buildCapitalFlow(empty), 'flow', hits);
  walk(buildFutureTree(empty, 'btc'), 'future', hits);
  walk(buildDna(empty, 'BTC'), 'dna', hits);
  walk(buildOutlookReading(empty), 'outlook', hits);
  walk(buildDomainsView({}), 'domains', hits);
  walk(buildProvidersView({}, {}), 'providers', hits);
  assert.deepEqual(hits, [], `no numeric field may appear from an empty pass: ${hits.join(', ')}`);
});

test('smart money: the net prefers the server\u2019s own field and never guesses', () => {
  const sm = (v) => ({ sm: v });
  assert.equal(smartMoneyNet(sm({ netFlowUsd: -800_000 })), -800_000, 'the scanner\u2019s explicit net is used as-is');
  assert.equal(smartMoneyNet(sm({ netFlowUsd: -800_000, accumulationUsd: 2_000_000, distributionUsd: 500_000 })), -800_000,
    'when both exist the explicit net wins \u2014 no second, disagreeing definition of the same number');
  assert.equal(smartMoneyNet(sm({ accumulationUsd: 2_000_000, distributionUsd: 500_000 })), 1_500_000, 'otherwise it is the difference');
  assert.equal(smartMoneyNet(sm({})), null, 'no fields \u21d2 no number');
  assert.equal(smartMoneyNet(sm({ accumulationUsd: 2_000_000 })), null, 'half a difference is not a net');
  assert.equal(smartMoneyNet({}), null, 'no smart-money domain \u21d2 no number');
});
