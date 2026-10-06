/**
 * WORLD CONSOLE — calibration, resolver and honesty tests (node:test, no DOM).
 * ---------------------------------------------------------------------------
 * The 2026-10 «هوش جهانی» rework fixed what the screen kept getting wrong:
 *
 *   · gold, the dollar and the bonds read «unread» on every tab although the page
 *     held a gold price, a dozen currency pairs and an ETF quote;
 *   · the weather stations used a different invented threshold per station;
 *   · some countries were read incompletely;
 *   · a domain row crashed the page when it was tapped.
 *
 * These tests pin the contract the new screen is built on. The fixture is shaped
 * like the PRODUCTION pass that triggered the report: the macro desk is dark,
 * the class domains carry Ostium rows (some price-only), and the only movers for
 * gold and the bonds are the Ostium row, the PAXG token and the TLT bond ETF.
 *
 *   · every concept is resolved from an ORDERED list of places, and the object
 *     says which one answered (measured · proxy · level · stale);
 *   · a proxy is never printed as the instrument; a level-only price never
 *     supplies a move; nothing readable stays null, never 0;
 *   · every market station is scored against ITS OWN normal day (z = move ÷ σ);
 *   · an unread station is «na» with no badge, no z and no sentence;
 *   · the Persian side of every view is Persian — no raw enum, object or id.
 *
 * Run: npm run test:world-console   (this file runs before the rendered probe)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWorldInputs, buildWeatherStations, buildClimate, buildMacroAnchors,
  buildCountrySnapshot, buildChallenger, buildDomainsView, buildBriefingTiles,
  buildFutureTree, buildCausalLocal, buildTransmission, COUNTRIES, DOMAIN_KEYS,
  describeSource, faNum, pctFa, usdFaCompact, BENCH, summariseStations, QUALITY
} from '../src/components/ai/worldState/worldModel.js';
import { zOf, bandOf, toneFor, severityFor, BAND_WORD, QUALITY_META } from '../src/components/ai/worldState/calibration.js';
import { bondReading, TLT_DURATION } from '../src/components/ai/worldState/resolve.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const row = (symbol, priceUsd, change24hPct = null, change7dPct = null) => ({ symbol, priceUsd, change24hPct, change7dPct });
const approx = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

/* ── the production-shaped pass ──────────────────────────────────────────── */
const PROD = {
  intelligence: {
    available: 9,
    missing: [],
    domains: {
      smart_money: { status: 'OK', data: { accumulationUsd: 20_975_000, distributionUsd: 6_000_000, topTokens: [{ symbol: 'ETH', netUsd: 3_000_000 }] } },
      whales: { status: 'OK', data: { count: null, events: [] } },
      onchain: { status: 'OK', data: { healthySources: 3, downSources: 1, sources: [] } },
      news: { status: 'OK', data: { count: 14, items: [{ title: 'Fed holds rates', topic: 'FED' }] } },
      macro: { status: 'OK', data: { byTopic: { FED: 2 }, quotes: [] } },
      forex: { status: 'OK', data: { instruments: [
        row('EUR/USD', 1.1269, 0.30), row('USD/JPY', 158.09, -0.20), row('GBP/USD', 1.3276, 0.10),
        row('USD/CAD', 1.425, 0.05), row('USD/SEK', 9.9765, -0.10), row('USD/CHF', 0.83051, 0.00)
      ] } },
      commodities: { status: 'OK', data: { instruments: [
        row('XAU/USD', 4172.7, 0.9, 2.4), row('XAG/USD', 51.2), row('WTI/USD', 88.9, -1.1, 3.0), row('XPT/USD', 1720)
      ] } },
      rwa: { status: 'OK', data: { instruments: [row('SPX/USD', 5480, 0.4), row('TLT/USD', 88.2, -0.5)] } },
      stocks: { status: 'OK', partial: true, data: { instruments: [{ symbol: 'AAPL', priceUsd: null, change24hPct: null }] } }
    }
  },
  briefing: { items: [] },
  cross: {
    status: 'OK',
    classes: { crypto: { avgChangePct: 1.2, instruments: 43, withChange: 43, top: [{ symbol: 'BTC', changePct: 2.1 }], bottom: [] } },
    regime: { regime: 'MIXED' },
    divergences: [],
    macro: { indicators: [], curve: null }
  },
  flows: {
    tokenFlows: {
      status: 'OK',
      anchors: {
        BTC: { symbol: 'BTC', priceUsd: 85547, change24hPct: -0.06, change7dPct: 3.19 },
        ETH: { symbol: 'ETH', priceUsd: 2690.8, change24hPct: -0.64 },
        PAXG: { symbol: 'PAXG', priceUsd: 4170, change24hPct: 0.82, change7dPct: 2.1 }
      },
      breadth: { up: 20, down: 22 }
    },
    chainFlows: { status: 'OK', net24hUsd: 864_000_000 },
    profitLeaders: { status: 'UNAVAILABLE' }
  },
  goldEtfs: { available: true, rows: [{ symbol: 'GLD', priceUsd: 379.55, changePct: -0.155 }] }
};

/* the same pass with the ECB reference rates the server now ships */
const WITH_FX = (() => {
  const d = clone(PROD);
  d.intelligence.domains.macro.data.fx = [
    { ccy: 'JPY', perUsd: 158.09, change1dPct: 0.20, change7dPct: -0.5, at: 1759708800000, source: 'ecb' },
    { ccy: 'TRY', perUsd: 49.179, change1dPct: -0.10, change7dPct: -0.6, at: 1759708800000, source: 'ecb' },
    { ccy: 'INR', perUsd: 96.42, change1dPct: -0.05, change7dPct: null, at: 1759708800000, source: 'ecb' },
    { ccy: 'CNY', perUsd: 6.7046, change1dPct: 0.02, change7dPct: 0.1, at: 1759708800000, source: 'ecb' }
  ];
  return d;
})();

const stationOf = (stations, id) => stations.find((s) => s.id === id);

/** every Persian-side string of a view, to prove none of them carries a raw code */
const persianStrings = (value, out = [], key = '') => {
  if (typeof value === 'string') { if (/Fa$|^fa$/.test(key)) out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach((v) => persianStrings(v, out, key)); return out; }
  if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => persianStrings(v, out, k));
  return out;
};
const RAW_PERSIAN = /\[object|undefined|NaN|UNAVAILABLE|PARTIAL|\b[A-Z]{2,}(?:_[A-Z]{2,})+\b|\b(?:brain|ci|whales|smartMoney|macro):/;

/* ═══════════════════════════ 1. THE RESOLVER ═══════════════════════════ */

test('gold: an Ostium row with a 24h move is a direct reading, 7-day move kept', () => {
  const g = extractWorldInputs(PROD).gold;
  assert.equal(g.quality, QUALITY.MEASURED);
  assert.equal(g.priceUsd, 4172.7);
  assert.equal(g.change1dPct, 0.9);
  assert.equal(g.change7dPct, 2.4);
  assert.equal(g.source, 'ostium');
});

test('gold: a price-only Ostium row is LEVEL only — it never invents a move', () => {
  const d = clone(PROD);
  d.intelligence.domains.commodities.data.instruments = [row('XAU/USD', 4172.7)];
  d.flows.tokenFlows.anchors.PAXG = { symbol: 'PAXG', priceUsd: 4170, change24hPct: null };
  d.goldEtfs = { available: false, rows: [] };
  const g = extractWorldInputs(d).gold;
  assert.equal(g.quality, QUALITY.LEVEL);
  assert.equal(g.priceUsd, 4172.7);
  assert.equal(g.change1dPct, null, 'a level-only reading supplies no move');
});

test('gold: the PAXG token stands in for the move, labelled a proxy, keeping the real level', () => {
  const d = clone(PROD);
  d.intelligence.domains.commodities.data.instruments = [row('XAU/USD', 4172.7)];
  const g = extractWorldInputs(d).gold;
  assert.equal(g.quality, QUALITY.PROXY);
  assert.equal(g.change1dPct, 0.82);
  assert.equal(g.priceUsd, 4172.7, 'the level still comes from the real gold price');
  assert.match(g.source, /^coingecko:PAXG$/);
  assert.match(g.basisEn, /PAXG/);
  assert.match(g.basisFa, /PAXG/);
});

test('gold: the GLD ETF is the last stand-in when neither the desk, Ostium nor PAXG has a move', () => {
  const d = clone(PROD);
  d.intelligence.domains.commodities.data.instruments = [row('XAU/USD', 4172.7)];
  delete d.flows.tokenFlows.anchors.PAXG;
  const g = extractWorldInputs(d).gold;
  assert.equal(g.quality, QUALITY.PROXY);
  assert.equal(g.change1dPct, -0.155);
  assert.match(g.source, /GLD/);
  assert.match(g.basisEn, /GLD gold ETF/);
});

test('the dollar: the official ECB basket quote is a direct reading and says how it was computed', () => {
  const d = clone(PROD);
  d.cross.macro.indicators = [{ symbol: 'DXY', priceUsd: 101.8, change1dPct: -0.2, source: 'ecb:DXY-basket' }];
  const dxy = extractWorldInputs(d).dxy;
  assert.equal(dxy.quality, QUALITY.MEASURED);
  assert.equal(dxy.priceUsd, 101.8);
  assert.match(dxy.basisEn, /official dollar-index weights/);
});

test('the dollar: with the desk dark the FX basket is a PROXY, signed from the dollar’s side', () => {
  const dxy = extractWorldInputs(PROD).dxy;
  assert.equal(dxy.quality, QUALITY.PROXY);
  assert.equal(dxy.priceUsd, null, 'a basket has no index level');
  /* EUR/USD +0.30 (dollar −0.30) · USD/JPY −0.20 (dollar −0.20) · GBP/USD +0.10 …
     at the ICE weights → the dollar slipped about 0.21% */
  assert.ok(approx(dxy.change1dPct, -0.21), `expected ≈ −0.21, got ${dxy.change1dPct}`);
  assert.match(dxy.basisEn, /EUR, JPY, GBP, CAD, SEK, CHF/);
});

test('the dollar: fewer than three pairs is not a basket — it stays unread', () => {
  const d = clone(PROD);
  d.intelligence.domains.forex.data.instruments = [row('EUR/USD', 1.1269, 0.3), row('USD/JPY', 158.09, -0.2)];
  assert.equal(extractWorldInputs(d).dxy, null);
});

test('bonds: a measured 10Y yield converts its relative move into basis points', () => {
  const d = clone(PROD);
  d.cross.macro.indicators = [{ symbol: 'US10Y', priceUsd: 4.21, change1dPct: 0.4, source: 'treasury:BC_10YEAR' }];
  const b = extractWorldInputs(d).bond;
  assert.equal(b.kind, 'yield');
  assert.equal(b.quality, QUALITY.MEASURED);
  assert.equal(b.estimate, false);
  assert.equal(b.level, 4.21);
  assert.equal(b.yieldBp, 1.7, '4.21 → 4.1934 is +1.7 bp');
  assert.equal(b.dir, 'up');
});

test('bonds: TLT stands in, inverted — a bond rally is a yield FALL — and is labelled an estimate', () => {
  const down = bondReading({ tlt: { symbol: 'TLT', change1dPct: 0.5, quality: QUALITY.PROXY, source: 'ostium' } });
  assert.equal(down.kind, 'tlt');
  assert.equal(down.estimate, true);
  assert.equal(down.dir, 'down');
  assert.equal(down.yieldBp, Math.round((-0.5 / TLT_DURATION) * 1000) / 10);
  const up = extractWorldInputs(PROD).bond;
  assert.equal(up.dir, 'up', 'TLT −0.5% means yields rose');
  assert.equal(up.yieldBp, 3);
  assert.equal(up.quality, QUALITY.PROXY);
  assert.equal(up.level, null, 'an ETF has no yield level');
});

test('bonds: a level with no move is level-only; nothing readable is null', () => {
  const lvl = bondReading({ us10y: { priceUsd: 5.31, change1dPct: null, quality: QUALITY.LEVEL, source: 'treasury:BC_10YEAR' } });
  assert.equal(lvl.quality, QUALITY.LEVEL);
  assert.equal(lvl.yieldBp, null);
  assert.equal(bondReading({}), null);
  assert.equal(bondReading(null), null);
});

test('an empty pass resolves every concept to null — never a zero', () => {
  const x = extractWorldInputs({});
  for (const k of ['gold', 'silver', 'wti', 'brent', 'copper', 'spx', 'dxy', 'us10y', 'us2y', 'us30y']) {
    assert.equal(x[k], null, `${k} must stay unread`);
  }
  assert.equal(x.bond, null);
});

test('a stale desk quote stays «stale» and keeps its age', () => {
  const d = clone(PROD);
  d.cross.macro.stale = true;
  d.cross.macro.staleAgeMs = 3_600_000;
  d.cross.macro.indicators = [{ symbol: 'GOLD', priceUsd: 4100, change1dPct: 0.3, source: 'stooq:XAUUSD' }];
  const g = extractWorldInputs(d).gold;
  assert.equal(g.quality, QUALITY.STALE);
});

/* ═══════════════════════════ 2. THE CALIBRATION ═══════════════════════════ */

test('z = move ÷ σ, and the four bands cut at 0.5 · 1.5 · 2.5', () => {
  assert.equal(zOf(0.9, 0.9), 1);
  assert.equal(zOf(null, 0.9), null);
  assert.equal(zOf(1, 0), null, 'a missing σ is no score');
  assert.equal(zOf('x', 1), null);
  assert.equal(bandOf(null), null);
  assert.deepEqual([0.49, 0.5, 1.49, 1.5, 2.49, 2.5, -3].map(bandOf), ['calm', 'normal', 'normal', 'strong', 'strong', 'extreme', 'extreme']);
  for (const band of ['calm', 'normal', 'strong', 'extreme']) {
    assert.ok(BAND_WORD[band].fa && BAND_WORD[band].en, `${band} has both words`);
  }
});

test('the σ constants are the ones the legend prints', () => {
  assert.equal(BENCH.dollar.sigma, 0.45);
  assert.equal(BENCH.gold.sigma, 0.9);
  assert.equal(BENCH.oil.sigma, 2.1);
  assert.equal(BENCH.bonds.sigma, 6);
  assert.equal(BENCH.bonds.unit, 'bp');
  assert.equal(BENCH.equity.sigma, 1.0);
  assert.equal(BENCH.crypto.sigma, 2.8);
  assert.equal(BENCH.eth.sigma, 3.5);
  assert.equal(BENCH.rwa.sigma, 0.9);
});

test('the weather word follows which side hurts', () => {
  assert.equal(toneFor('headwind-up', 2), 'rain', 'a dollar spike is a headwind');
  assert.equal(toneFor('headwind-up', -1), 'sun', 'a softer dollar is a tailwind');
  assert.equal(toneFor('tailwind-up', 1), 'sun', 'equities up is sunny');
  assert.equal(toneFor('tailwind-up', -2), 'rain');
  assert.equal(toneFor('tailwind-up', 3), 'sun');
  assert.equal(toneFor('headwind-up', 0.2), 'partly', 'a calm day is partly cloudy either way');
  assert.equal(toneFor('haven', 3), 'rain', 'a violent fear bid in gold is not calm');
  assert.equal(toneFor('anything', null), 'na');
});

test('the dial never reads empty once a move was read, and is empty with none', () => {
  assert.equal(severityFor(null), null);
  assert.equal(severityFor(0), 0.08);
  assert.equal(severityFor(-6), 1);
  assert.ok(Math.abs(severityFor(1.5) - 0.5) < 1e-9);
});

test('quality badges have a name in both languages', () => {
  for (const q of ['measured', 'proxy', 'level', 'stale']) assert.ok(QUALITY_META[q].fa && QUALITY_META[q].en);
});

/* ═══════════════════════════ 3. THE STATIONS ═══════════════════════════ */

test('stations: fourteen, in a fixed order', () => {
  const st = buildWeatherStations(PROD);
  assert.deepEqual(st.map((s) => s.id), [
    'institutional', 'dollar', 'gold', 'bonds', 'inflation', 'risk', 'equity',
    'crypto', 'liquidity', 'volatility', 'whales', 'chains', 'news', 'rwa'
  ]);
});

test('stations: dollar, gold and bonds are READ on a pass whose macro desk is dark', () => {
  const st = buildWeatherStations(PROD);
  for (const id of ['dollar', 'gold', 'bonds']) {
    const s = stationOf(st, id);
    assert.notEqual(s.tone, 'na', `${id} must not be «unread»`);
    assert.ok(s.valueText, `${id} carries a figure`);
    assert.ok(['measured', 'proxy'].includes(s.quality));
    assert.ok(s.readEn && s.readFa, `${id} carries the calibrated sentence`);
  }
});

test('stations: the score is the move divided by that market’s σ — word, dial and sentence agree', () => {
  const st = buildWeatherStations(PROD);
  const gold = stationOf(st, 'gold');
  assert.equal(gold.z, 1);
  assert.equal(gold.sigma, BENCH.gold.sigma);
  assert.equal(gold.band, 'normal');
  assert.equal(gold.readEn, '1.0× a normal day · normal');
  const dollar = stationOf(st, 'dollar');
  assert.ok(approx(dollar.z, -0.47, 0.006));
  assert.equal(dollar.band, 'calm');
  assert.equal(dollar.quality, 'proxy');
  const bonds = stationOf(st, 'bonds');
  assert.equal(bonds.sigma, BENCH.bonds.sigma);
  assert.equal(bonds.z, 0.5, '3 bp ÷ 6 bp');
  assert.match(bonds.readEn, /estimated/, 'a TLT-derived basis-point move says it is an estimate');
});

test('stations: every station that was not read is «na» — no badge, no score, no sentence', () => {
  const st = buildWeatherStations(PROD);
  const unread = st.filter((s) => s.tone === 'na');
  assert.ok(unread.length >= 1);
  for (const s of unread) {
    assert.equal(s.quality ?? null, null, `${s.id}: an unread station has no quality`);
    assert.equal(s.z ?? null, null, `${s.id}: no z`);
    assert.equal(s.readEn ?? null, null, `${s.id}: no sentence`);
    assert.ok(!s.valueText, `${s.id}: no figure`);
  }
});

test('stations: a whale scanner that returned no count is UNREAD — not a calm sea', () => {
  const dark = stationOf(buildWeatherStations(PROD), 'whales');
  assert.equal(dark.tone, 'na');
  const d = clone(PROD);
  d.intelligence.domains.whales.data = { count: 0, events: [] };
  const quiet = stationOf(buildWeatherStations(d), 'whales');
  assert.notEqual(quiet.tone, 'na', 'a scanner that counted zero DID read');
  assert.equal(quiet.valueText, '0');
});

test('stations: the board summary adds up and counts each quality once', () => {
  const st = buildWeatherStations(PROD);
  const sum = summariseStations(st);
  assert.equal(sum.total, 14);
  assert.equal(sum.valid + sum.level + sum.unread, 14);
  assert.equal(sum.measured + sum.proxy + sum.stale, sum.valid);
  assert.ok(sum.proxy >= 2, 'the dollar basket and the TLT bond estimate are proxies');
});

test('stations: an empty pass is fourteen unread stations and zero invented numbers', () => {
  const st = buildWeatherStations({});
  assert.equal(st.length, 14);
  assert.ok(st.every((s) => s.tone === 'na' && !s.valueText));
  assert.equal(summariseStations(st).unread, 14);
});

test('climate: the blended index lists its parts and states its coverage', () => {
  const c = buildClimate(PROD);
  assert.ok(c.score >= 0 && c.score <= 1);
  assert.ok(c.coverage > 0 && c.coverage <= 1);
  assert.equal(c.total, 11);
  assert.ok(c.readCount >= 6 && c.readCount <= 11);
  const empty = buildClimate({});
  assert.equal(empty.readCount, 0);
});

/* ═══════════════════════════ 4. THE MACRO TABLE ═══════════════════════════ */

test('anchors: dollar, gold and the 10-year yield each carry a figure, a move and a source', () => {
  const rows = Object.fromEntries(buildMacroAnchors(PROD).rows.map((r) => [r.id, r]));
  assert.equal(rows.gold.levelEn, '4,173 USD/oz');
  assert.equal(rows.gold.moveEn, '+0.90%');
  assert.equal(rows.gold.quality, 'measured');
  assert.equal(rows.dollar.quality, 'proxy');
  assert.equal(rows.dollar.moveEn, '-0.21%');
  assert.equal(rows.dollar.dir, 'down');
  assert.equal(rows.us10y.moveEn, '≈ +3.0bp');
  assert.equal(rows.us10y.quality, 'proxy');
  for (const id of ['dollar', 'gold', 'us10y']) assert.ok(rows[id].sourceEn, `${id} names its source`);
});

test('anchors: a level-only metal shows its level and NO move; an unread one shows nothing', () => {
  const rows = Object.fromEntries(buildMacroAnchors(PROD).rows.map((r) => [r.id, r]));
  assert.equal(rows.silver.status, 'level');
  assert.equal(rows.silver.levelEn, '51.20 USD/oz');
  assert.equal(rows.silver.moveEn ?? null, null);
  for (const id of ['brent', 'copper']) {
    assert.equal(rows[id].status, 'unread');
    assert.equal(rows[id].levelEn ?? null, null);
    assert.equal(rows[id].moveEn ?? null, null);
    assert.equal(rows[id].sourceEn ?? null, null);
  }
});

test('anchors: the summary counts direct · proxy · level-only · unread', () => {
  assert.deepEqual(buildMacroAnchors(PROD).summary, { total: 8, direct: 3, proxy: 2, levelOnly: 1, stale: 0, unread: 2 });
  const none = buildMacroAnchors({});
  assert.equal(none.summary.unread, none.summary.total);
});

test('the transmission chain marks each node read · proxy · model · unread, and tests only what moved', () => {
  const t = buildTransmission(PROD);
  assert.equal(t.nodes.length, 6);
  const state = Object.fromEntries(t.nodes.map((n) => [n.id, n.state]));
  assert.equal(state.oil, 'read');
  assert.equal(state.yields, 'proxy');
  assert.equal(state.em, 'model');
  assert.ok(t.consistency.tested <= t.consistency.total);
  assert.equal(buildCausalLocal(PROD).origin, 'local');
});

/* ═══════════════════════════ 5. THE COUNTRIES ═══════════════════════════ */

const country = (id) => COUNTRIES.find((c) => c.id === id);
const snap = (id, data = WITH_FX, isPersian = false) => buildCountrySnapshot(country(id), data, { isPersian });

test('countries: Japan reads the yen from the ECB reference; positive means the yen gained', () => {
  const jp = snap('jp');
  const fx = jp.rows.find((r) => r.sym === 'JPY/USD');
  assert.ok(fx, 'the yen row exists');
  assert.equal(fx.kind, 'direct');
  assert.equal(fx.source, 'ecb');
  assert.equal(fx.valueEn, '158.1 JPY per USD');
  assert.equal(fx.change, 0.2);
  assert.equal(fx.dir, 'up');
  assert.equal(jp.status, 'read');
  assert.equal(jp.netBasis, 'direct');
});

test('countries: Türkiye, India and China are no longer half-read — each has its ECB currency row', () => {
  for (const [id, ccy] of [['tr', 'TRY'], ['in', 'INR'], ['cn', 'CNY']]) {
    const s = snap(id);
    assert.ok(s.rows.some((r) => r.sym === `${ccy}/USD` && r.kind === 'direct' && r.source === 'ecb'), `${id}: ${ccy} row`);
    assert.ok(s.directCount >= 1);
  }
});

test('countries: a pegged currency is labelled a peg and never claims a move', () => {
  for (const id of ['sa', 'ae']) {
    const peg = snap(id).rows.find((r) => r.kind === 'peg');
    assert.ok(peg, `${id}: peg row`);
    assert.equal(peg.change ?? null, null);
    assert.match(peg.sourceEn, /peg/);
  }
});

test('countries: the Eurozone and Germany use the euro pair even without an ECB table', () => {
  const de = snap('de', PROD);
  const eur = de.rows.find((r) => r.kind === 'direct');
  assert.ok(eur, 'a direct euro row');
  assert.equal(eur.valueEn ?? eur.value, '1.1269', 'the panel prints valueEn, falling back to value');
});

test('countries: Iran’s USD/TMN reference row exists only when the Wallex read is fresh', () => {
  assert.ok(!snap('ir', PROD).rows.some((r) => r.kind === 'reference'));
  const withTmn = { ...clone(PROD), toman: { status: 'fresh', value: 98000, source: 'wallex' } };
  const ref = snap('ir', withTmn).rows.find((r) => r.kind === 'reference');
  assert.ok(ref);
  assert.equal(ref.valueEn, '98,000 TMN');
  assert.equal(ref.quality, 'measured');
});

test('countries: a country nobody read says so and invents nothing', () => {
  const br = snap('br', {});
  assert.deepEqual(br.rows, []);
  assert.equal(br.status, 'unread');
  assert.equal(br.net, null);
  assert.match(br.summaryEn, /nothing is guessed/);
  assert.match(br.summaryFa, /هیچ عددی حدس زده نمی‌شود/);
});

test('countries: the English summary is grammatical (1 proxy, not 1 proxies)', () => {
  assert.match(snap('jp').summaryEn, /^1 direct · 1 proxy — /);
});

test('countries: every one of the forty-six builds in both languages with no NaN, undefined or raw code', () => {
  assert.equal(COUNTRIES.length, 46);
  for (const c of COUNTRIES) {
    for (const isPersian of [false, true]) {
      for (const data of [PROD, WITH_FX, {}]) {
        const s = buildCountrySnapshot(c, data, { isPersian });
        const flat = JSON.stringify(s);
        assert.ok(!/NaN|undefined|\[object/.test(flat), `${c.id}/${isPersian ? 'fa' : 'en'}: ${flat.match(/NaN|undefined|\[object/)?.[0]}`);
        for (const r of s.rows) assert.ok(['direct', 'proxy', 'reference', 'peg', 'news'].includes(r.kind), `${c.id}: kind ${r.kind}`);
      }
    }
  }
});

/* ═══════════════════════════ 6. THE CHALLENGER ═══════════════════════════ */

test('challenger: on a calm pass nothing is observed and everything stands', () => {
  const ch = buildChallenger(PROD);
  assert.ok(ch.opportunity, 'the crypto class is rising, so there is a thesis to attack');
  assert.equal(ch.observed, 0);
  assert.equal(ch.summary.strength, 'none');
  assert.deepEqual(ch.summary.top, []);
  assert.equal(ch.summary.standing.length, ch.summary.total);
});

test('challenger: no thesis, no attack', () => {
  const ch = buildChallenger({});
  assert.equal(ch.opportunity, null);
  assert.deepEqual(ch.arguments, []);
});

test('challenger: observed risks lead, at most three, strongest first', () => {
  const d = clone(PROD);
  d.cross.macro.curve = { symbol: 'US2S10S', spreadPct: -0.21, source: 'fred:T10Y2Y' };
  d.cross.macro.indicators = [{ symbol: 'DXY', priceUsd: 101.8, change1dPct: 0.9, source: 'ecb:DXY-basket' }];
  d.flows.chainFlows.net24hUsd = -400_000_000;
  d.intelligence.domains.smart_money.data = { accumulationUsd: 1_000_000, distributionUsd: 6_000_000, topTokens: [] };
  d.cross.divergences = [{ classes: ['crypto', 'stocks'], gapPct: 3.1 }];
  const ch = buildChallenger(d);
  assert.ok(ch.observed >= 4, `observed ${ch.observed}`);
  assert.ok(ch.summary.top.length <= 3);
  const bySev = ch.arguments.filter((a) => a.observed).sort((a, b) => b.severity - a.severity).slice(0, 3).map((a) => a.id);
  assert.deepEqual(ch.summary.top, bySev);
  assert.notEqual(ch.summary.strength, 'none');
  for (const a of ch.arguments.filter((x) => x.observed)) {
    assert.ok(a.evidence && a.evidenceFa, `${a.id}: an observed risk shows the reading that proves it`);
  }
});

test('challenger: dust is not a risk — a small outflow or a small labelled sale stays unobserved', () => {
  const d = clone(PROD);
  d.flows.chainFlows.net24hUsd = -5_000_000;
  d.intelligence.domains.smart_money.data = { accumulationUsd: 1_000_000, distributionUsd: 1_300_000, topTokens: [] };
  const ids = buildChallenger(d).arguments.filter((a) => a.observed).map((a) => a.id);
  assert.ok(!ids.includes('liquidity'), 'a $5M outflow is under the floor');
  assert.ok(!ids.includes('whale'), 'a $0.3M net sale is under the floor');
});

test('challenger: a Persian evidence sentence never contradicts the direction the number moved', () => {
  const fell = buildChallenger(PROD).arguments.find((a) => a.id === 'dollar');
  assert.match(fell.evidenceFa, /پایین آمد/, 'the dollar fell');
  assert.doesNotMatch(fell.evidenceFa, /بالا رفت/);
  const inflow = buildChallenger(PROD).arguments.find((a) => a.id === 'liquidity');
  assert.match(inflow.evidenceFa, /زیاد شد/, 'stablecoin supply grew');
  const d = clone(PROD);
  d.flows.chainFlows.net24hUsd = -250_000_000;
  const out = buildChallenger(d).arguments.find((a) => a.id === 'liquidity');
  assert.equal(out.observed, true);
  assert.match(out.evidenceFa, /کم شد/);
});

test('challenger: the model risk is always listed and never «observed»', () => {
  const ch = buildChallenger(PROD);
  const m = ch.arguments.find((a) => a.id === 'model');
  assert.equal(m.observed, false);
  assert.ok(ch.summary.standing.includes('model'));
});

/* ═══════════════════════════ 7. THE DOMAINS ═══════════════════════════ */

test('domains: nine rows in a fixed order, each named in both languages', () => {
  const rows = buildDomainsView(PROD.intelligence.domains);
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map((r) => r.key), DOMAIN_KEYS);
  for (const r of rows) {
    assert.ok(r.label.fa && r.label.en && r.role.fa && r.role.en, `${r.key}: label and role`);
    assert.ok(r.statusFa && r.statusEn);
  }
});

test('domains: the status words are Persian and plain', () => {
  const by = Object.fromEntries(buildDomainsView(PROD.intelligence.domains).map((r) => [r.key, r]));
  assert.equal(by.news.statusFa, 'کامل');
  assert.equal(by.stocks.statusFa, 'ناقص', 'the server flagged the price-less stocks rows as partial');
  assert.equal(by.stocks.tone, 'warn');
  const dark = buildDomainsView({ ...PROD.intelligence.domains, news: { status: 'UNAVAILABLE', reason: 'DEADLINE' } });
  assert.equal(dark.find((r) => r.key === 'news').statusFa, 'خوانده نشد');
});

test('domains: a class domain that answered OK with ZERO instruments read nothing', () => {
  const d = { ...PROD.intelligence.domains, stocks: { status: 'OK', data: { instruments: [] } } };
  const stocks = buildDomainsView(d).find((r) => r.key === 'stocks');
  assert.equal(stocks.status, 'UNAVAILABLE');
  assert.equal(stocks.statusFa, 'خوانده نشد');
  assert.equal(stocks.tone, 'off');
});

test('domains: an absent domain object is unread, not a crash', () => {
  assert.deepEqual(buildDomainsView(null), []);
  const rows = buildDomainsView({});
  assert.equal(rows.length, 9);
  assert.ok(rows.every((r) => r.status === 'UNAVAILABLE'));
});

test('domains: whale transfers whose parties are objects never print «[object Object]»', () => {
  const d = {
    ...PROD.intelligence.domains,
    whales: { status: 'OK', data: { count: 1, events: [{ symbol: 'ETH', valueUsd: 9_000_000, from: { address: '0xabc', label: 'Binance' }, to: { address: '0xdef' } }] } }
  };
  const w = buildDomainsView(d).find((r) => r.key === 'whales');
  assert.ok(!/\[object/.test(JSON.stringify({ ...w, list: undefined })), 'headline and metrics are clean');
  assert.equal(w.headlineEn, '1 large transfer · largest ETH $9.0M');
  assert.equal(w.stats.length, 2);
});

test('domains: every view is built from the Persian side without a raw code', () => {
  const bad = persianStrings(buildDomainsView(PROD.intelligence.domains)).filter((s) => RAW_PERSIAN.test(s));
  assert.deepEqual(bad, []);
});

/* ═══════════════════════════ 8. THE STATUS-REPORT TILES ═══════════════════════════ */

const TILE_IDS = ['climate', 'dollar', 'gold', 'bonds', 'inflation', 'equity', 'crypto', 'institutional', 'whales', 'news', 'risk', 'countries'];
const TAB_NAV = ['world', 'flows', 'causal', 'globe', 'future'];
const ROUTE_NAV = ['/smart-money', '/news', '/', '/stocks'];

test('tiles: twelve, in a fixed order, and every one knows where it goes', () => {
  const { tiles } = buildBriefingTiles(PROD);
  assert.deepEqual(tiles.map((t) => t.id), TILE_IDS);
  for (const t of tiles) {
    assert.ok(t.nav && ['tab', 'route'].includes(t.nav.kind), `${t.id}: nav kind`);
    if (t.nav.kind === 'tab') assert.ok(TAB_NAV.includes(t.nav.tab), `${t.id}: ${t.nav.tab}`);
    else assert.ok(ROUTE_NAV.includes(t.nav.to), `${t.id}: ${t.nav.to}`);
    assert.ok(t.nav.fa && t.nav.en, `${t.id}: the destination has a name`);
  }
});

test('tiles: the destinations the user asked for', () => {
  const nav = Object.fromEntries(buildBriefingTiles(PROD).tiles.map((t) => [t.id, t.nav]));
  assert.deepEqual([nav.dollar.kind, nav.dollar.tab], ['tab', 'flows']);
  assert.deepEqual([nav.climate.kind, nav.climate.tab], ['tab', 'world']);
  assert.deepEqual([nav.institutional.kind, nav.institutional.to], ['route', '/smart-money']);
  assert.deepEqual([nav.news.kind, nav.news.to], ['route', '/news']);
});

test('tiles: an unread input is still a tile — «unread», empty value, and still a link', () => {
  const whales = buildBriefingTiles(PROD).tiles.find((t) => t.id === 'whales');
  assert.equal(whales.status, 'unread');
  assert.equal(whales.valueEn ?? null, null);
  assert.equal(whales.quality ?? null, null);
  assert.ok(whales.nav);
  const empty = buildBriefingTiles({});
  assert.equal(empty.tiles.length, 12);
  assert.ok(empty.tiles.filter((t) => t.status === 'unread').length >= 8);
});

test('tiles: the number on a tile is the same number as on its station', () => {
  const { tiles } = buildBriefingTiles(PROD);
  const st = buildWeatherStations(PROD);
  for (const id of ['dollar', 'gold', 'bonds']) {
    const tile = tiles.find((t) => t.id === id);
    assert.equal(tile.valueEn, stationOf(st, id).valueText, `${id}: tile and station agree`);
    assert.equal(tile.quality, stationOf(st, id).quality);
  }
});

test('tiles: the summary reports how many tiles are measured, proxy, level and unread', () => {
  const { summary } = buildBriefingTiles(PROD);
  assert.equal(summary.valid + summary.level + summary.unread, summary.total);
});

test('tiles: no tile prints NaN, undefined or a raw code in either language', () => {
  for (const data of [PROD, WITH_FX, {}]) {
    const { tiles } = buildBriefingTiles(data);
    for (const t of tiles) {
      const flat = JSON.stringify(t);
      assert.ok(!/NaN|undefined|\[object/.test(flat), `${t.id}: ${flat}`);
    }
    assert.deepEqual(persianStrings(tiles).filter((s) => RAW_PERSIAN.test(s)), []);
  }
});

/* ═══════════════════════════ 9. NAMES AND NUMBERS ═══════════════════════════ */

test('describeSource: brands stay brands, engine ids become words, prefixes collapse', () => {
  assert.equal(describeSource('ostium:XAU/USD', false), 'Ostium');
  assert.equal(describeSource('treasury:BC_10YEAR', false), 'US Treasury');
  assert.equal(describeSource('treasury:BC_10YEAR', true), 'خزانه‌داری آمریکا');
  assert.equal(describeSource('fred:T10Y2Y', true), 'FRED');
  assert.equal(describeSource('ecb:DXY-basket', false), 'ECB official basket');
  assert.equal(describeSource('cross-asset-engine', true), 'موتور بین‌دارایی');
  assert.equal(describeSource('whales:scanner', true), 'اسکنر نهنگ');
  assert.equal(describeSource('smartMoney:overview', false), 'smart money');
  assert.equal(describeSource('dex-aggregator', true), 'تجمیع‌کنندهٔ صرافی‌های غیرمتمرکز');
  assert.equal(describeSource('brain:rwa', false), 'RWA (Ostium)');
});

test('describeSource: nothing in, nothing out; an unknown id loses its punctuation', () => {
  assert.equal(describeSource(null, true), null);
  assert.equal(describeSource('', false), null);
  assert.equal(describeSource('  ', false), null);
  assert.equal(describeSource('some_new:thing', false), 'some new thing');
});

test('describeSource: no Persian answer carries a colon-separated code', () => {
  for (const id of ['whales:scanner', 'smartMoney:overview', 'macro:classifier', 'brain:stocks', 'ci:markets', 'ci:gas', 'smartMoney:verified-index', 'etf:gold']) {
    assert.doesNotMatch(describeSource(id, true), /[a-z]+:[a-z]/i, id);
  }
});

test('future tree: every nudge carries a Persian value with Persian digits and no raw enum', () => {
  const risk = clone(WITH_FX);
  risk.cross.regime = { regime: 'RISK_OFF' };
  risk.cross.outlook = { label: 'RECESSION_WATCH', score: -0.4 };
  risk.cross.macro.curve = { symbol: 'US2S10S', spreadPct: -0.21, source: 'fred:T10Y2Y' };
  const tree = buildFutureTree(risk, 'btc');
  assert.ok(tree.nudges.length >= 4);
  for (const n of tree.nudges) {
    assert.ok(n.valueFa, `${n.key}: valueFa`);
    assert.doesNotMatch(n.valueFa, /[0-9]/, `${n.key}: Persian digits only (${n.valueFa})`);
    assert.doesNotMatch(n.valueFa, /[A-Z]{2,}_[A-Z]/, `${n.key}: no raw enum`);
    assert.doesNotMatch(String(n.value), /^[A-Z]+_[A-Z_]+$/, `${n.key}: the English value is words too (${n.value})`);
  }
  const regime = tree.nudges.find((n) => n.key === 'riskOffRegime');
  assert.equal(regime.valueFa, 'ریسک‌گریزی');
  assert.equal(regime.value, 'risk off');
  assert.equal(tree.weights.bull + tree.weights.base + tree.weights.stress, 100);
});

test('number shaping: Persian digits, decimal mark, minus and percent', () => {
  assert.equal(faNum('12.5'), '۱۲٫۵');
  assert.equal(faNum(-3), '\u2212۳');
  assert.equal(pctFa(0.8), '+۰٫۸۰٪');
  assert.equal(pctFa(-0.21), '\u2212۰٫۲۱٪');
  assert.equal(pctFa(null), '—');
  assert.equal(usdFaCompact(864_000_000), '+۸۶۴ میلیون دلار');
  assert.equal(usdFaCompact(-2_500_000_000), '\u2212۲٫۵ میلیارد دلار');
  assert.equal(usdFaCompact(null), '—');
});
