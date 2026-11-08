/**
 * FBT AI RISK ENGINE — the arithmetic probe.
 * ---------------------------------------------------------------------------
 * Every assertion here exists because something was WRONG at some point while
 * this engine was being written, or because a rule the owner set can only be
 * enforced by a number:
 *
 *   · the stress scenarios summed `valueUsd` off rows that carry `afterUsd`,
 *     so every scenario reported a −100% book;
 *   · the "worst asset" picked the row with the largest loss, and losses are
 *     negative, so it labelled the best performer the worst;
 *   · the depeg scenario charged a full −3% to a leg that had already fallen to
 *     −3%, in the same breath as the stablecoin family calling it fine;
 *   · the pre-trade gate scored a $30k buy into a memecoin as a 6-point
 *     IMPROVEMENT, because it modelled only external funding and dropped the
 *     concentration family entirely.
 *
 * Run: node test/risk-engine.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  RISK_FAMILIES, RISK_BANDS, bandForScore, familyLabel, toneOf
} from '../src/lib/risk/taxonomy.js';
import {
  normalCdf, probTouch, sigmaFromSparkline, simulateBook, mulberry32
} from '../src/lib/risk/riskMath.js';
import {
  buildRiskReport, createRiskMonitor, gradeSmartContract, gradeStablecoin
} from '../src/lib/risk/riskEngine.js';
import {
  buildStressLegs, runAllScenarios, runStableDepeg, runCrash, runMonteCarlo
} from '../src/lib/risk/stressTests.js';
import { evaluateTradeRisk, evaluateSwapRisk, verdictSummary, GATE_VERDICT } from '../src/lib/risk/tradeGate.js';
import { writeBookSnapshot, readBookSnapshot, MAX_AGE_MS } from '../src/lib/risk/bookSnapshot.js';
import { RISK_COPY, riskCopyParity, rt, reasonText } from '../src/lib/risk/copy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
};

/* ── fixtures: one book, one tape, used by every section ─────────────────── */

const spark = (base, amp, n = 72) => Array.from({ length: n }, (_, i) => base * (1 + Math.sin(i / 5) * amp));

const MARKETS = [
  { symbol: 'BTC', price: 60000, volume: 3e9, mcap: 1.2e12, change24h: 1.2, sparkline: spark(60000, 0.03) },
  { symbol: 'ETH', price: 3000, volume: 1.5e9, mcap: 3.5e11, change24h: -2.1, sparkline: spark(3000, 0.05) },
  { symbol: 'USDC', price: 1, volume: 8e9, mcap: 3e10, change24h: 0.01, sparkline: spark(1, 0.0004) },
  { symbol: 'PEPE', price: 0.00001, volume: 2e6, mcap: 5e8, change24h: -6.4, sparkline: spark(0.00001, 0.12) }
];

const HOLDINGS = [
  { symbol: 'BTC', value: 40000, chainId: 56, address: '0xaaa00000000000000000000000000000000000a1', name: 'Bitcoin' },
  { symbol: 'ETH', value: 30000, chainId: 1, address: '0xbbb00000000000000000000000000000000000b2', name: 'Ethereum' },
  { symbol: 'USDC', value: 5000, chainId: 1, address: '0xccc00000000000000000000000000000000000c3', name: 'USD Coin' },
  { symbol: 'PEPE', value: 12000, chainId: 1, address: '0xddd00000000000000000000000000000000000d4', name: 'Pepe' }
];

const TOTAL = HOLDINGS.reduce((s, h) => s + h.value, 0);

const INTEL = {
  total: TOTAL,
  topShare: (40000 / TOTAL) * 100,
  rows: HOLDINGS.map((h) => ({ ...h, weight: (h.value / TOTAL) * 100, cost: null })),
  chainAllocation: [{ chainId: 1, value: TOTAL - 40000 }, { chainId: 56, value: 40000 }],
  partial: true
};

const BASE_INPUTS = {
  holdings: HOLDINGS,
  intel: INTEL,
  markets: MARKETS,
  correlation: { average: 0.78, pairs: [{ a: 'BTC', b: 'ETH', r: 0.82 }], sufficient: ['BTC', 'ETH'], insufficient: [] },
  performance: { returns: { d1: -3.4 }, status: 'partial' },
  scans: { [`1:${HOLDINGS[3].address}`]: { score: 88, level: 'critical', unknown: false, flags: [{ id: 'honeypot' }] } },
  lending: { status: 'read', healthFactor: 1.42, totalDebtUsd: 9000, totalCollateralUsd: 16000, ltvPct: 56, liquidationThresholdPct: 80 },
  chainReads: [
    { chainId: 1, failed: false, stale: false, unpriced: 0, rows: 3 },
    { chainId: 56, failed: true, stale: false, unpriced: 2, rows: 1 }
  ],
  providers: {
    providers: [
      { id: 'kyberswap', configured: true, reachable: true, authenticated: true },
      { id: 'lifi', configured: true, reachable: false, authenticated: false }
    ]
  },
  leverage: {
    status: 'read',
    positions: [{ symbol: 'BTC/USD', leverage: 10, liquidationDistancePct: 4.2, notionalUsd: 20000, collateralUsd: 2000 }]
  },
  settings: { autoLockMinutes: 0, walletSessionMinutes: 60 * 24 * 30, hideBalances: false }
};

/* ── 1. the taxonomy ────────────────────────────────────────────────────── */

check('ten risk families, all with a weight, a name in both languages and a question', () => {
  assert.equal(RISK_FAMILIES.length, 10);
  for (const f of RISK_FAMILIES) {
    assert.ok(f.weight > 0, `${f.id} has no weight`);
    assert.ok(f.fa && f.en, `${f.id} is missing a label`);
    assert.ok(f.questionFa && f.questionEn, `${f.id} is missing its question`);
    assert.ok(f.hue.startsWith('var(--'), `${f.id} hue is not a token`);
  }
  const ids = RISK_FAMILIES.map((f) => f.id);
  assert.deepEqual(ids, [
    'volatility', 'portfolio', 'liquidity', 'smartContract', 'defi',
    'network', 'counterparty', 'leverage', 'stablecoin', 'operational'
  ]);
});

check('the green gate: a LOW score with LOW coverage is not "safe"', () => {
  assert.equal(bandForScore(12, { coverage: 1 }).id, 'safe');
  const gated = bandForScore(12, { coverage: 0.3 });
  assert.equal(gated.id, 'unverified');
  assert.notEqual(gated.tone, 'safe');
  /* And the band it WOULD have been is still visible, so the UI can say why. */
  assert.equal(gated.band.id, 'safe');
});

check('bands are ordered, and only "serious" is red / only "safe" is green', () => {
  const maxes = RISK_BANDS.map((b) => b.max);
  assert.deepEqual([...maxes].sort((a, b) => a - b), maxes);
  const tones = RISK_BANDS.map((b) => b.tone);
  assert.equal(tones.filter((t) => t === 'serious').length, 1);
  assert.equal(tones.filter((t) => t === 'safe').length, 1);
  assert.equal(toneOf(bandForScore(90)), 'serious');
});

check('a null score is banded "not measured", never "safe"', () => {
  const band = bandForScore(null);
  assert.equal(band.id, 'unverified');
  assert.notEqual(band.tone, 'safe');
});

check('familyLabel answers in both languages', () => {
  assert.match(familyLabel('volatility', 'fa'), /[\u0600-\u06FF]/);
  assert.match(familyLabel('volatility', 'en'), /[A-Za-z]/);
});

/* ── 2. the math ────────────────────────────────────────────────────────── */

check('normalCdf is a real CDF (0 → 0.5, ±∞ → 0/1, monotone)', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(-8)) < 1e-10);
  assert.ok(Math.abs(normalCdf(8) - 1) < 1e-10);
  let prev = 0;
  for (let z = -4; z <= 4; z += 0.25) {
    const v = normalCdf(z);
    assert.ok(v >= prev, 'normalCdf must be monotone');
    prev = v;
  }
});

check('probTouch falls with distance and rises with horizon and sigma', () => {
  const near = probTouch({ sigmaDailyPct: 3, distancePct: 5, horizonDays: 1 });
  const far = probTouch({ sigmaDailyPct: 3, distancePct: 20, horizonDays: 1 });
  const week = probTouch({ sigmaDailyPct: 3, distancePct: 5, horizonDays: 7 });
  const wild = probTouch({ sigmaDailyPct: 6, distancePct: 5, horizonDays: 1 });
  assert.ok(near > far);
  assert.ok(week > near);
  assert.ok(wild > near);
  assert.ok(near > 0 && near < 1);
});

check('sigmaFromSparkline refuses a series too short to measure', () => {
  assert.equal(sigmaFromSparkline([1, 2, 3]), null);
  const s = sigmaFromSparkline(spark(100, 0.05));
  assert.ok(s && s.sigmaPct > 0 && s.points >= 8);
});

check('the Monte-Carlo is seeded: the same input yields the same output', () => {
  const legs = [{ symbol: 'BTC', valueUsd: 1000, beta: 1, sigmaPct: 4, idioPct: 1.2 }];
  const a = simulateBook({ legs, paths: 500, horizonDays: 1, seed: 0x5eed1234 });
  const b = simulateBook({ legs, paths: 500, horizonDays: 1, seed: 0x5eed1234 });
  assert.equal(a.p05Usd, b.p05Usd);
  assert.equal(a.p50Usd, b.p50Usd);
  assert.ok(a.p05Usd < a.p50Usd && a.p50Usd < a.p95Usd);
  /* And a different seed MUST give a different path set — otherwise the
     "seeded" claim is decoration. */
  const c = simulateBook({ legs, paths: 500, horizonDays: 1, seed: 7 });
  assert.notEqual(a.p05Usd, c.p05Usd);
});

check('mulberry32 is a deterministic PRNG in [0,1)', () => {
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 20; i += 1) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

/* ── 3. the report ──────────────────────────────────────────────────────── */

check('the report is deterministic: same evidence, same score', () => {
  const a = buildRiskReport({ ...BASE_INPUTS, now: 1_700_000_000_000 });
  const b = buildRiskReport({ ...BASE_INPUTS, now: 1_700_000_000_000 });
  assert.equal(a.score.value, b.score.value);
  assert.deepEqual(a.families.map((f) => f.score), b.families.map((f) => f.score));
});

check('nothing in the report is NaN', () => {
  const r = buildRiskReport({ ...BASE_INPUTS, now: 1_700_000_000_000 });
  const walk = (v, path) => {
    if (typeof v === 'number') {
      assert.ok(Number.isFinite(v), `NaN/Infinity at ${path}`);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
  };
  walk(r, 'report');
});

check('an empty book yields a null score and NAMES what it could not see', () => {
  const r = buildRiskReport({ holdings: [], intel: null, markets: [], now: 1 });
  assert.equal(r.score.value, null);
  assert.ok(r.unavailable.includes('no-portfolio'));
  assert.equal(r.heatmap.length, 0);
  assert.equal(r.direction, 'higher-is-riskier');
});

check('the no-execution laws are present and false', () => {
  const r = buildRiskReport({ ...BASE_INPUTS, now: 1 });
  assert.equal(r.laws.canExecute, false);
  assert.equal(r.laws.canSign, false);
  assert.equal(r.laws.canMoveFunds, false);
  assert.equal(r.laws.notAdvice, true);
  assert.equal(r.laws.inventsPrices, false);
});

check('every family carries the reasons that produced its number', () => {
  const r = buildRiskReport({ ...BASE_INPUTS, now: 1 });
  for (const f of r.families) {
    if (f.score == null) {
      assert.ok(f.unavailable.length > 0, `${f.id} is null but names no missing input`);
    } else {
      assert.ok(f.reasons.length > 0, `${f.id} scored ${f.score} without a reason`);
      for (const reason of f.reasons) {
        assert.ok(reason.key, `${f.id} reason without a key`);
        assert.equal(typeof reason.params, 'object');
      }
    }
  }
});

check('a critical contract floors the family instead of being averaged away', () => {
  /* `contractKey` is part of the grader's contract: `buildRiskReport` derives
     it from address + chainId, but a direct call has to carry it. Passing rows
     without it is how the earlier draft silently scored `null`. */
  const withKeys = HOLDINGS.map((h) => ({ ...h, contractKey: `${h.chainId}:${h.address.toLowerCase()}` }));
  const g = gradeSmartContract({
    holdings: withKeys,
    scans: { [withKeys[3].contractKey]: { score: 90, level: 'critical', unknown: false, flags: [] } },
    total: TOTAL
  });
  assert.ok(g.score >= 70, `expected the critical floor, got ${g.score}`);
});

check('an UNSCANNED contract is not treated as a safe one', () => {
  const withKeys = HOLDINGS.map((h) => ({ ...h, contractKey: `${h.chainId}:${h.address.toLowerCase()}` }));
  const g = gradeSmartContract({ holdings: withKeys, scans: {}, total: TOTAL });
  assert.equal(g.score, null);
  assert.ok(g.unavailable.includes('contract-scan'));
});

check('a depegged stablecoin scores, and a pegged one does not lie about it', () => {
  const offPeg = gradeStablecoin({
    holdings: [{ symbol: 'USDT', value: 10000 }],
    markets: [{ symbol: 'USDT', price: 0.972 }],
    total: 10000
  });
  assert.ok(offPeg.score > 0);
  /* 40% of the book, so the single-asset concentration term does not fire and
     the assertion is about the PEG alone. */
  const onPeg = gradeStablecoin({
    holdings: [{ symbol: 'USDC', value: 4000 }],
    markets: [{ symbol: 'USDC', price: 1.0002 }],
    total: 10000
  });
  /* A measured peg is a measured ZERO, which is different from "not measured":
     the family must return a number so the composite can average it. */
  assert.equal(onPeg.score, 0);
  assert.equal(onPeg.coverage, 1);
  assert.ok(onPeg.reasons.some((r) => r.key === 'peg-holds'));
});

check('every recommendation keeps its impact (measured or explicitly knowledge-only)', () => {
  const r = buildRiskReport({ ...BASE_INPUTS, now: 1 });
  assert.ok(r.recommendations.length > 0);
  for (const rec of r.recommendations) {
    assert.ok(rec.action, 'recommendation without an action');
    assert.ok(['rescore', 'knowledge-only'].includes(rec.impactBasis), `bad basis ${rec.impactBasis}`);
    if (rec.impactBasis === 'rescore') {
      assert.ok(rec.impactPts == null || rec.impactPts <= 0, 'a fix must not raise risk');
    }
  }
  /* The ledger suggestion is CERTAIN, so it must never be filtered out. */
  assert.ok(r.recommendations.some((x) => x.action === 'record-cost-basis'));
});

check('alerts are severity-ranked and carry a body + a cause', () => {
  const r = buildRiskReport({ ...BASE_INPUTS, now: 1 });
  const rank = { critical: 0, high: 1, watch: 2 };
  for (let i = 1; i < r.alerts.length; i += 1) {
    assert.ok(rank[r.alerts[i - 1].severity] <= rank[r.alerts[i].severity], 'alerts are out of order');
  }
  for (const a of r.alerts) {
    assert.ok(rt('fa', `alert.${a.code}`) !== `alert.${a.code}`, `${a.code} has no title`);
    assert.ok(rt('en', `alert.body.${a.code}`) !== `alert.body.${a.code}`, `${a.code} has no body`);
    assert.ok(a.because && a.because.length, `${a.code} explains no cause`);
    assert.ok(['serious', 'raised', 'watch'].includes(a.tone));
  }
});

check('one critical contract produces a critical alert, painted red', () => {
  const r = buildRiskReport({ ...BASE_INPUTS, now: 1 });
  const hit = r.alerts.find((a) => a.code === 'dangerous-contract');
  assert.ok(hit, 'no dangerous-contract alert');
  assert.equal(hit.severity, 'critical');
  assert.equal(hit.tone, 'serious');
});

/* ── 4. the stress centre ───────────────────────────────────────────────── */

const LEGS = buildStressLegs({ holdings: HOLDINGS, markets: MARKETS, total: TOTAL, bookSigmaPct: 5 });

check('stress legs carry a measured beta, sigma and volume ratio', () => {
  assert.equal(LEGS.length, 4);
  const btc = LEGS.find((l) => l.symbol === 'BTC');
  assert.equal(btc.beta, 1);
  assert.ok(btc.sigmaPct > 0 && btc.sigmaMeasured);
  const pepe = LEGS.find((l) => l.symbol === 'PEPE');
  assert.ok(pepe.beta > btc.beta, 'a memecoin must carry more beta than BTC');
  assert.ok(pepe.volumeRatio > 0);
});

check('a crash scenario loses REAL money, not the whole book', () => {
  const s = runCrash({ legs: LEGS, dropPct: -25 });
  assert.ok(s.beforeUsd > 0);
  assert.ok(s.afterUsd > 0, 'the book vanished — the after-sum is reading the wrong field');
  assert.ok(s.deltaUsd < 0);
  assert.ok(s.deltaPct > -100 && s.deltaPct < -5, `implausible delta ${s.deltaPct}%`);
  assert.ok(Math.abs(s.deltaUsd - (s.afterUsd - s.beforeUsd)) < 0.02);
});

check('the worst asset is the one that lost the MOST (losses are negative)', () => {
  const s = runCrash({ legs: LEGS, dropPct: -30 });
  assert.ok(s.worst, 'no worst asset reported');
  /* Assert the PROPERTY, not a guess about which symbol carries the most beta:
     the worst row is the row with the smallest lossUsd, and no other row lost
     more. (An earlier draft compared with `>`, which picked the best row.) */
  const smallest = s.rows.reduce((a, b) => (b.lossUsd < a.lossUsd ? b : a));
  assert.equal(s.worst.symbol, smallest.symbol);
  assert.equal(s.worst.lossUsd, smallest.lossUsd);
  assert.ok(s.worst.lossUsd < 0);
  assert.ok(s.rows.filter((r) => r.lossUsd < s.worst.lossUsd).length === 0);
});

check('a deeper crash loses strictly more than a shallower one', () => {
  const a = runCrash({ legs: LEGS, dropPct: -10 });
  const b = runCrash({ legs: LEGS, dropPct: -40 });
  assert.ok(b.deltaUsd < a.deltaUsd);
});

check('stable legs do not move in a crash scenario', () => {
  const s = runCrash({ legs: LEGS, dropPct: -40 });
  const stable = s.rows.find((r) => r.symbol === 'USDC');
  assert.equal(stable.lossUsd, 0);
});

check('the depeg scenario agrees with the stablecoin family (no double charge)', () => {
  /* A book whose stables are ON peg loses the full depth — a hypothetical. */
  const pegged = runStableDepeg({ legs: LEGS, depthPct: -3 });
  const peggedRow = pegged.rows.find((r) => r.symbol === 'USDC');
  assert.ok(Math.abs(peggedRow.movePct + 3) < 0.01, `expected −3%, got ${peggedRow.movePct}`);

  /* A leg ALREADY at −3% must lose nothing more: the depth is an END STATE. */
  const already = buildStressLegs({
    holdings: [{ symbol: 'USDT', value: 10000 }],
    markets: [{ symbol: 'USDT', price: 0.97 }],
    total: 10000,
    bookSigmaPct: 1
  });
  const s = runStableDepeg({ legs: already, depthPct: -3 });
  const row = s.rows.find((r) => r.symbol === 'USDT');
  assert.ok(Math.abs(row.movePct) < 0.05, `a leg already at the depth was charged again: ${row.movePct}%`);
});

check('the liquidity freeze charges thin markets more than deep ones', () => {
  const s = runAllScenarios({ legs: LEGS }).find((x) => x.id === 'liquidity-freeze');
  const pepe = s.rows.find((r) => r.symbol === 'PEPE');
  const btc = s.rows.find((r) => r.symbol === 'BTC');
  assert.ok(pepe.movePct < btc.movePct, 'the thin market was not charged more');
  assert.ok(s.deltaUsd < 0);
});

check('the leverage cascade liquidates the position whose distance is too small', () => {
  const s = runAllScenarios({
    legs: LEGS,
    positions: [
      { symbol: 'BTC/USD', leverage: 20, collateralUsd: 2000, liquidationDistancePct: 2, sigmaPct: 5, beta: 1.3 },
      { symbol: 'ETH/USD', leverage: 2, collateralUsd: 500, liquidationDistancePct: 45, sigmaPct: 5, beta: 1.3 }
    ]
  }).find((x) => x.id === 'leverage-cascade');
  const near = s.liquidations.find((l) => l.symbol === 'BTC/USD');
  const far = s.liquidations.find((l) => l.symbol === 'ETH/USD');
  assert.equal(near.liquidated, true);
  assert.equal(far.liquidated, false);
  assert.equal(s.forcedLossUsd, 2000);
  assert.equal(s.severity, 'critical');
});

check('correlation-one prices diversification, and can never price it negative', () => {
  const one = runAllScenarios({ legs: LEGS, bookSigmaPct: 4.6, var95Usd: 87000 * 0.046 * 1.6449 })
    .find((x) => x.id === 'correlation-one');
  assert.ok(one.sigmaRhoOnePct > 0);
  /* σ at ρ=1 is the weighted SUM of the legs, so it is >= the measured book
     sigma for any book with more than one risky leg. */
  assert.ok(one.sigmaRhoOnePct >= 4.6 - 0.01, `rho-1 sigma ${one.sigmaRhoOnePct} < measured 4.6`);
  assert.ok(one.diversificationValueUsd >= 0);
  assert.ok(one.diversificationValueUsd > 0);
  /* A single risky leg has nothing to diversify. */
  const single = buildStressLegs({
    holdings: [{ symbol: 'BTC', value: 1000 }], markets: MARKETS, total: 1000, bookSigmaPct: 3
  });
  const solo = runAllScenarios({ legs: single }).find((x) => x.id === 'correlation-one');
  assert.equal(solo.diversificationValueUsd, 0);
});

check('every scenario names its assumptions and declares itself not a forecast', () => {
  const all = runAllScenarios({ legs: LEGS });
  assert.equal(all.length, 8);
  const ids = new Set();
  for (const s of all) {
    assert.ok(!ids.has(s.id), `duplicate scenario id ${s.id}`);
    ids.add(s.id);
    assert.equal(s.notAForecast, true);
    assert.ok(s.assumptions.length >= 2, `${s.id} has no assumptions`);
    for (const a of s.assumptions) assert.ok(a.fa && a.en, `${s.id} assumption is not bilingual`);
    assert.ok(s.titleFa && s.titleEn);
  }
});

check('the Monte-Carlo card reports a distribution and a seeded horizon', () => {
  const s = runMonteCarlo({ legs: LEGS, paths: 2000 });
  assert.ok(s.p05Usd < s.p50Usd && s.p50Usd < s.p95Usd);
  assert.ok(s.lossProbPct >= 0 && s.lossProbPct <= 100);
  assert.ok(s.assumptions.some((a) => /بذر|seed/i.test(`${a.fa} ${a.en}`)), 'the seed is not stated');
});

/* ── 5. the pre-trade gate ──────────────────────────────────────────────── */

check('the gate refuses to certify without a trade or a book', () => {
  const noTrade = evaluateTradeRisk({ trade: null, inputs: BASE_INPUTS });
  assert.equal(noTrade.verdict, GATE_VERDICT.INSUFFICIENT_EVIDENCE);
  const noBook = evaluateTradeRisk({
    trade: { symbol: 'BTC', side: 'buy', valueUsd: 100 },
    inputs: { holdings: [], markets: [], intel: null }
  });
  assert.equal(noBook.verdict, GATE_VERDICT.INSUFFICIENT_EVIDENCE);
  assert.equal(noBook.after, null);
  /* It never issues a false block: the swap's own gates keep their authority. */
  assert.equal(noBook.canProceed, true);
});

check('a trade that takes over the book is BLOCKED, not waved through', () => {
  /*
   * The fixture is chosen so the assertion is about the GATE and not about the
   * book already being risky: a cash-heavy book (80% USDC) into a thin memecoin
   * large enough to become most of it.
   */
  const cashBook = {
    holdings: [{ symbol: 'USDC', value: 80000, chainId: 1 }, { symbol: 'ETH', value: 20000, chainId: 1 }],
    markets: MARKETS
  };
  const g = evaluateTradeRisk({
    trade: { symbol: 'PEPE', side: 'buy', valueUsd: 70000 },
    inputs: cashBook
  });
  assert.equal(g.verdict, GATE_VERDICT.BLOCK);
  assert.equal(g.canProceed, false);
  assert.ok(g.delta > 0, `expected a risk rise, got ${g.delta}`);
  assert.ok(g.reasons.some((r) => r.key === 'risk-jump'));
  assert.ok(g.reasons.some((r) => r.key === 'trade-vs-book'));
  assert.ok(g.after.value > g.before.value);
  /* The block must be explained by a RATIO, not only by a total: the book's own
     risk grew by more than a quarter. */
  assert.ok(g.after.value / g.before.value >= 1.25);
});

check('the same trade on an ALREADY-risky book is warned, not blocked on noise', () => {
  /* A book starting at 58 does not double; +2 points there is not a refusal,
     and a gate that blocked every addition to a risky book would be ignored. */
  const g = evaluateTradeRisk({
    trade: { symbol: 'PEPE', side: 'buy', valueUsd: 30000 },
    inputs: BASE_INPUTS
  });
  assert.equal(g.verdict, GATE_VERDICT.WARN);
  assert.equal(g.canProceed, true);
  /* +2 on 58 is under the 4-point warning line, so it must carry the
     serious-family warning and no block — that is the honest reading. */
  assert.ok(!g.reasons.some((r) => r.key === 'risk-jump'), 'warned trade was blocked');
  assert.ok(g.reasons.some((r) => r.key === 'serious-family'));
});

check('the gate reports the WORSE funding model, and keeps both', () => {
  const g = evaluateTradeRisk({
    trade: { symbol: 'PEPE', side: 'buy', valueUsd: 30000 },
    inputs: BASE_INPUTS
  });
  const m = g.evidence.fundingModels;
  assert.ok(m.externalCash && m.fromBook);
  assert.ok(m.fromBook.after >= m.externalCash.after, 'the worse reading must be the funded one');
  assert.equal(m.reported, 'from-book');
});

check('the concentration family survives the round trip through the gate', () => {
  const g = evaluateTradeRisk({
    trade: { symbol: 'PEPE', side: 'buy', valueUsd: 30000 },
    inputs: BASE_INPUTS
  });
  /* Before the fix this family was dropped after patching, so `impacts` never
     mentioned it and the score barely moved. */
  assert.ok(g.impacts.some((i) => i.id === 'portfolio'), 'concentration did not move');
  const port = g.impacts.find((i) => i.id === 'portfolio');
  assert.ok(port.delta > 0, 'adding to a position must raise concentration risk');
});

check('a de-risking trade is CLEAR and shows the fall', () => {
  const g = evaluateTradeRisk({
    trade: { symbol: 'PEPE', side: 'sell', valueUsd: 11000 },
    inputs: BASE_INPUTS
  });
  assert.equal(g.verdict, GATE_VERDICT.CLEAR);
  assert.ok(g.delta <= 0);
});

check('the gate explains itself in both languages', () => {
  const g = evaluateTradeRisk({ trade: { symbol: 'PEPE', side: 'buy', valueUsd: 30000 }, inputs: BASE_INPUTS });
  assert.match(verdictSummary(g, 'fa'), /[\u0600-\u06FF]/);
  assert.match(verdictSummary(g, 'en'), /[A-Za-z]/);
});

/* ── 6. the book snapshot ───────────────────────────────────────────────── */

const ADDRESS = '0x1111111111111111111111111111111111111111';
const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k)
  };
};

check('the snapshot round-trips, and stamps its own age', () => {
  const storage = memoryStorage();
  const at = 1_700_000_000_000;
  assert.equal(writeBookSnapshot({ address: ADDRESS, rows: HOLDINGS, markets: MARKETS, total: TOTAL, at, storage }), true);
  const back = readBookSnapshot(ADDRESS, { storage, at: at + 60_000 });
  assert.ok(back);
  assert.equal(back.rows.length, 4);
  assert.equal(back.total, TOTAL);
  assert.ok(back.ageMs >= 60_000);
  assert.equal(back.markets.length, 4);
  /* The sparkline survives, so a sigma can be measured from it. */
  assert.ok(back.markets[0].sparkline.length > 8);
});

check('a snapshot for another address is never returned', () => {
  const storage = memoryStorage();
  writeBookSnapshot({ address: ADDRESS, rows: HOLDINGS, markets: MARKETS, total: TOTAL, storage });
  assert.equal(readBookSnapshot('0x2222222222222222222222222222222222222222', { storage }), null);
});

check('a snapshot older than the ceiling is refused, not shown as current', () => {
  const storage = memoryStorage();
  const at = 1_700_000_000_000;
  writeBookSnapshot({ address: ADDRESS, rows: HOLDINGS, markets: MARKETS, total: TOTAL, at, storage });
  assert.equal(readBookSnapshot(ADDRESS, { storage, at: at + MAX_AGE_MS + 1 }), null);
});

check('the swap entry point answers "no book" instead of a green light', () => {
  const storage = memoryStorage();
  const g = evaluateSwapRisk({ wallet: ADDRESS, fromSymbol: 'USDC', toSymbol: 'PEPE', amountUsd: 500, storage });
  assert.equal(g.evidenceStatus, 'no-book');
  assert.equal(g.verdict, GATE_VERDICT.INSUFFICIENT_EVIDENCE);
  assert.equal(g.delta, null);
  assert.match(verdictSummary(g, 'fa'), /[\u0600-\u06FF]/);
});

check('the swap entry point scores a real swap: sell USDC, buy PEPE', () => {
  const storage = memoryStorage();
  writeBookSnapshot({ address: ADDRESS, rows: HOLDINGS, markets: MARKETS, total: TOTAL, storage });
  const g = evaluateSwapRisk({ wallet: ADDRESS, fromSymbol: 'USDC', toSymbol: 'PEPE', amountUsd: 30000, storage });
  assert.equal(g.evidenceStatus, 'fresh');
  assert.equal(g.verdict, GATE_VERDICT.BLOCK);
  assert.ok(g.delta > 0);
  assert.ok(g.after.value > g.before.value);
});

/* ── 7. the copy ────────────────────────────────────────────────────────── */

check('the two dictionaries carry exactly the same keys', () => {
  const parity = riskCopyParity();
  assert.deepEqual(parity.onlyFa, []);
  assert.deepEqual(parity.onlyEn, []);
  assert.ok(Object.keys(RISK_COPY.fa).length > 150);
});

check('the Persian dictionary is actually Persian, and the English one is not', () => {
  const persian = /[\u0600-\u06FF]/;
  for (const [k, v] of Object.entries(RISK_COPY.fa)) {
    if (/^page\.eyebrow$/.test(k)) continue;
    assert.match(v, persian, `fa.${k} has no Persian`);
    assert.ok(!/[A-Za-z]{4,}/.test(v.replace(/\{(\w+)\}/g, '')), `fa.${k} leaks English`);
  }
  for (const [k, v] of Object.entries(RISK_COPY.en)) {
    assert.ok(!persian.test(v), `en.${k} leaks Persian`);
  }
});

check('an unknown placeholder stays visible instead of vanishing', () => {
  assert.equal(rt('fa', 'score.measured', {}), '{n} از {total} خانواده اندازه‌گیری شد');
  assert.equal(rt('fa', 'score.measured', { n: 8, total: 10 }), '8 از 10 خانواده اندازه‌گیری شد');
});

check('every reason key the engine can emit has a sentence in both languages', () => {
  const src = readFileSync(resolve(root, 'src/lib/risk/riskEngine.js'), 'utf8');
  const keys = [...new Set([...src.matchAll(/key:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length > 20);
  for (const key of keys) {
    assert.ok(RISK_COPY.fa[`reason.${key}`], `no fa sentence for reason.${key}`);
    assert.ok(RISK_COPY.en[`reason.${key}`], `no en sentence for reason.${key}`);
    const text = reasonText('fa', { key, params: {} });
    assert.equal(text, text.replace(/\{\{/g, ''), `reason.${key} breaks on empty params`);
  }
});

check('every recommendation has a title and a body in both languages', () => {
  const src = readFileSync(resolve(root, 'src/lib/risk/riskEngine.js'), 'utf8');
  const actions = [...new Set([...src.matchAll(/action:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))];
  assert.ok(actions.length >= 7);
  for (const a of actions) {
    for (const loc of ['fa', 'en']) {
      assert.ok(RISK_COPY[loc][`rec.${a}`], `no ${loc} title for rec.${a}`);
      assert.ok(RISK_COPY[loc][`rec.body.${a}`], `no ${loc} body for rec.${a}`);
    }
  }
});

/* ── 8. the monitor ─────────────────────────────────────────────────────── */

check('the monitor needs two readings before it reports a change', () => {
  const m = createRiskMonitor({ max: 5 });
  assert.equal(m.push({ at: 0, value: 40 }), null);
  const d = m.push({ at: 20 * 60_000, value: 52 });
  assert.ok(d);
  assert.equal(d.delta, 12);
  assert.equal(d.points, 2);
});

check('a move under one point is not news', () => {
  const m = createRiskMonitor();
  m.push({ at: 0, value: 40 });
  const d = m.push({ at: 30 * 60_000, value: 40 });
  assert.equal(d.delta, 0);
});

check('the monitor names which family moved, and never fakes a newcomer', () => {
  const m = createRiskMonitor();
  m.push({ at: 0, value: 40, families: [{ id: 'volatility', score: 30 }, { id: 'liquidity', score: null }] });
  const d = m.push({
    at: 20 * 60_000,
    value: 48,
    families: [{ id: 'volatility', score: 45 }, { id: 'liquidity', score: 20 }]
  });
  const vol = d.families.find((f) => f.id === 'volatility');
  const liq = d.families.find((f) => f.id === 'liquidity');
  assert.equal(vol.delta, 15);
  assert.equal(liq.newlyMeasured, true);
  assert.equal(liq.delta, 0, 'a family that started being measured did not "jump"');
});

check('the monitor ring is bounded', () => {
  const m = createRiskMonitor({ max: 3 });
  for (let i = 0; i < 10; i += 1) m.push({ at: i * 20 * 60_000, value: i });
  assert.equal(m.series().length, 3);
});

/* ── report ─────────────────────────────────────────────────────────────── */

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\nAI risk engine probe: ${passed}/${results.length} passed`);
for (const f of failed) console.log(`  ✗ ${f.name}\n     ${f.error}`);
process.exit(failed.length ? 1 : 0);
