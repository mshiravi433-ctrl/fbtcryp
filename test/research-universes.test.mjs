/**
 * FBT NEUROMORPHIC 2050 — PHASE 8: PARALLEL RESEARCH UNIVERSES
 * ===========================================================================
 * These tests lock the *honesty* of the engine, not a number that happens to
 * look good:
 *   · no look-ahead (a prediction cannot be replaced before it is resolved),
 *   · nothing scored before a real next bar exists,
 *   · no invented prices (empty feeds are refused, never filled),
 *   · deterministic + bit-identical restore,
 *   · selection really culls/breeds, with an auditable lineage,
 *   · no `Math.random` anywhere in the research path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_POPULATION,
  MAX_PULSE_BARS,
  MIN_POPULATION,
  SELECTION_INTERVAL,
  UNIVERSES_SCHEMA,
  UNIVERSES_VERSION,
  UNIVERSE_GENES,
  createResearchUniverses,
  createUniversePrng,
  classifyGenome,
  normalizeGenome,
  probeResearchUniverses,
  randomGenome,
  shrunkLogLoss
} from '../src/lib/neuromorphic/researchUniverses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Deterministic, realistic-ish random walk (not a trend generator). */
function walkSeries(n = 260, { seed = 42, drift = 0.0002, vol = 0.012 } = {}) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let price = 60000;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const u1 = rand();
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, u1))) * Math.cos(2 * Math.PI * u2);
    price = Math.max(100, price * (1 + drift + z * vol));
    out.push({
      t: 1_700_000_000_000 + i * 3_600_000,
      o: price * 0.999,
      h: price * 1.003,
      l: price * 0.997,
      c: price
    });
  }
  return out;
}

function assertFiniteOrNull(value, label, pathParts = '') {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${label}${pathParts} must be finite, got ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((row, i) => assertFiniteOrNull(row, label, `${pathParts}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, row] of Object.entries(value)) {
      assertFiniteOrNull(row, label, `${pathParts}.${key}`);
    }
  }
}

test('fresh population markets every score as not-yet-measured', () => {
  const engine = createResearchUniverses({ seed: 2026, population: 10 });
  const report = engine.report();

  assert.equal(report.schema, UNIVERSES_SCHEMA);
  assert.equal(report.version, UNIVERSES_VERSION);
  assert.equal(report.population, 10);
  assert.equal(report.resolved, 0);
  assert.equal(report.ticks, 0);
  assert.equal(report.consensus.probability, null);
  assert.equal(report.consensus.brier, null);
  assert.equal(report.consensus.logLoss, null);
  assert.equal(report.consensus.hitRate, null);
  assert.equal(report.consensus.brierSkill, null);
  assert.equal(report.consensus.ece, null);
  assert.equal(report.best, null);
  assert.equal(report.oracle, null);
  assert.equal(report.diversity.meanDisagreement, null);
  assert.equal(report.selection.rounds, 0);
  assert.equal(report.honesty.hitRateNull, true);
  assert.equal(report.honesty.lookaheadBars, 0);
  assert.equal(report.honesty.inventsPrices, false);
  assert.equal(report.laws.canExecute, false);
  assert.equal(report.laws.canSign, false);
  assert.equal(report.laws.canMoveFunds, false);
  for (const u of report.universes) {
    assert.equal(u.resolved, 0);
    assert.equal(u.brier, null);
    assert.equal(u.weight > 0, true);
  }
  assertFiniteOrNull(report, 'fresh report');
});

test('a prediction cannot be replaced before it is resolved (no look-ahead by construction)', () => {
  const engine = createResearchUniverses({ seed: 11, population: 6 });
  const features = [0.3, 0.2, 0.1, 0.05, -0.2, 0.25, 0.1, 0.15];

  const first = engine.observe({ features, at: 1 });
  assert.equal(first.ok, true);
  assert.ok(first.metaProbability > 0 && first.metaProbability < 1);
  assert.equal(engine.report().resolved, 0, 'nothing may be scored before a real outcome');

  const second = engine.observe({ features, at: 2 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'PENDING_UNRESOLVED');

  const resolved = engine.resolve({ outcome: 1, at: 2 });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.resolved, 1);
  const report = engine.report();
  assert.equal(report.resolved, 1);
  assert.equal(report.ticks, 1);
  assert.ok(report.consensus.brier >= 0 && report.consensus.brier <= 1);
  assert.equal(report.pending, false);
  assert.equal(report.consensus.probability, null, 'after resolution there is no pending probability');
});

test('invalid observations and unresolvable states are refused, never silently repaired', () => {
  const engine = createResearchUniverses({ seed: 3, population: 6 });
  assert.equal(engine.observe({ features: null }).ok, false);
  assert.equal(engine.observe({ features: [1, 2, 3] }).ok, false);
  assert.equal(engine.observe({ features: [1, 2, 3, 4, 5, 6, 7, NaN] }).ok, false);
  assert.equal(engine.resolve({ outcome: 1 }).ok, false);

  engine.observe({ features: [0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(engine.resolve({ outcome: 7 }).ok, false, 'an impossible outcome must be refused');
  const tie = engine.resolve({ outcome: 0 });
  assert.equal(tie.ok, true);
  assert.equal(tie.scored, false, 'a close-to-close tie carries no direction and must not be scored');
  assert.equal(engine.report().resolved, 0);
  assert.equal(engine.report().ties, 1);
  assert.equal(engine.report().consensus.brier, null);

  const empty = engine.runPulse({ candles: [] });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'INSUFFICIENT_CANDLES');
  assert.equal(engine.report().resolved, 0, 'a refused pulse must not fabricate observations');
});

test('a real-candle pulse walks forward with zero look-ahead bars and measured scores', () => {
  const candles = walkSeries(220);
  const engine = createResearchUniverses({ seed: 0x2050fb71, population: 12 });
  const pulse = engine.runPulse({ candles, symbol: 'BTC' });

  assert.equal(pulse.ok, true);
  assert.ok(pulse.bars > 100, `expected many walk-forward steps, got ${pulse.bars}`);
  assert.ok(pulse.bars <= MAX_PULSE_BARS);
  assert.equal(pulse.skipped, 0);
  assert.equal(pulse.evidenceClass, 'retrospective');

  const report = pulse.report;
  assert.equal(report.resolved, pulse.bars);
  assert.equal(report.ticks, pulse.bars + 1, 'the live tail observation is a tick but not yet a scored outcome');
  assert.equal(report.honesty.lookaheadBars, 0);
  assert.equal(report.honesty.scoredOnlyAfterResolution, true);
  assert.equal(report.honesty.syntheticDataUsed, false);
  assert.equal(report.evidence.class, 'mixed', 'historical steps are retrospective; the live tail is prospective');
  assert.equal(report.evidence.retrospective, pulse.bars);
  assert.equal(report.evidence.prospective, 1);
  assert.equal(report.pending, true, 'the population must commit to the next, still-unknown bar');
  assert.ok(report.consensus.probability > 0 && report.consensus.probability < 1);
  assert.ok(['UP', 'DOWN', 'FLAT'].includes(report.consensus.direction));
  assert.ok(report.consensus.confidence >= 0 && report.consensus.confidence <= 1);
  assert.ok(report.consensus.brier > 0 && report.consensus.brier < 1);
  assert.ok(report.consensus.logLoss > 0 && report.consensus.logLoss < 5);
  assert.ok(report.consensus.committed <= report.consensus.resolved);
  assert.ok(report.selection.rounds >= Math.floor(pulse.bars / SELECTION_INTERVAL) - 1);
  assert.equal(report.population, 12, 'selection keeps the population size constant');
  assert.ok(report.diversity.distinctLineages >= 10);
  assert.ok(report.diversity.meanDisagreement > 0, 'independent universes must actually disagree');
  assert.ok(report.consensus.control.brier !== null);
  assert.equal(report.gap.coinBrier, 0.25);
  assert.equal(report.oracle.hindsight, true);
  assert.equal(report.best.hindsight, false);
  assert.ok(Math.abs(report.consensus.brierSkill - (1 - report.consensus.brier / 0.25)) < 1e-5);
  assert.equal(report.consensus.holdout.scope.includes('never used by a selection decision'), true);

  for (const u of report.universes) {
    assert.ok(u.weight >= 0 && u.weight <= 1, `weight out of range: ${u.id}`);
    assert.ok(u.brier === null || (u.brier >= 0 && u.brier <= 1));
    assert.ok(u.resolved > 0);
    assert.ok(UNIVERSE_GENES.every((g) => u.genome[g.key] >= g.min && u.genome[g.key] <= g.max));
    assert.equal(u.lineage.length, 8);
    assert.ok(u.trace.every((v) => Number.isFinite(v)));
  }
  assertFiniteOrNull(report, 'pulse report');

  // Every probability that ever existed was inside the unit interval.
  const weightSum = report.universes.reduce((sum, u) => sum + u.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-3, `weights must be normalised, sum=${weightSum}`);
});

test('selection culls the worst quartile, breeds from survivors and keeps a lineage', () => {
  const engine = createResearchUniverses({ seed: 77, population: 12, selectionInterval: 6 });
  engine.runPulse({ candles: walkSeries(180, { seed: 5 }), symbol: 'BTC' });
  const report = engine.report();
  const last = report.selection.last;

  assert.ok(report.selection.rounds > 5);
  assert.ok(last, 'a selection round must be recorded');
  assert.equal(last.culled.length, Math.floor(report.population / 4));
  assert.equal(last.born.length, last.culled.length);
  assert.equal(report.selection.culled, report.selection.born);
  assert.ok(last.born.some((b) => b.reason === 'explorer'), 'at least one explorer keeps diversity alive');
  const crossover = last.born.filter((b) => b.reason === 'crossover');
  assert.ok(crossover.length >= 1);
  for (const child of crossover) {
    assert.equal(child.parents.length, 2);
    assert.notEqual(child.parents[0], child.parents[1]);
  }
  const activeIds = new Set(report.universes.map((u) => u.id));
  for (const c of last.culled) assert.equal(activeIds.has(c.id), false, 'culled universes must be gone');
  for (const b of last.born) assert.equal(activeIds.has(b.id), true, 'children must be in the population');
  const descendants = report.universes.filter((u) => u.generation > 0 && u.parents.length === 2);
  assert.ok(descendants.length >= 1, 'at least one living universe must descend from two parents');
  for (const child of descendants) {
    assert.equal(child.parents[0] !== child.parents[1], true);
    assert.match(child.lineage, /^[0-9a-f]{8}$/);
  }

  const manual = engine.evolve();
  assert.equal(manual.ok, true);
  assert.equal(manual.generation, last.generation + 1);
  assert.equal(engine.report().population, 12);
});

test('identical seeds reproduce identical runs; different seeds genuinely differ', () => {
  const candles = walkSeries(200, { seed: 9 });
  const run = (seed) => {
    const engine = createResearchUniverses({ seed, population: 12 });
    return engine.runPulse({ candles, symbol: 'BTC' }).report;
  };
  const a = run(1234);
  const b = run(1234);
  const c = run(4321);

  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.consensus.brier, b.consensus.brier);
  assert.equal(a.consensus.logLoss, b.consensus.logLoss);
  assert.equal(a.generation, b.generation);
  assert.notEqual(a.contentHash, c.contentHash);
});

test('snapshot restore is bit-identical and can continue the same run', () => {
  const candles = walkSeries(180, { seed: 21 });
  const engine = createResearchUniverses({ seed: 0x2050fb71, population: 10 });
  engine.runPulse({ candles, symbol: 'BTC' });
  const before = engine.report();
  const snapshot = engine.toJSON();

  const clone = createResearchUniverses({ seed: 0x2050fb71, population: 10 });
  const restored = clone.restore(snapshot);
  assert.equal(restored.ok, true);
  assert.equal(restored.restored, 10);
  assert.equal(clone.report().contentHash, before.contentHash);

  const more = walkSeries(120, { seed: 55 });
  const forwardA = engine.runPulse({ candles: more, symbol: 'BTC' }).report;
  const forwardB = clone.runPulse({ candles: more, symbol: 'BTC' }).report;
  assert.equal(forwardA.contentHash, forwardB.contentHash);
  assert.equal(forwardA.resolved, forwardB.resolved);

  const wrongSchema = clone.restore({ ...snapshot, schema: 'fbt.neuromorphic.cortex.v3' });
  assert.equal(wrongSchema.ok, false);
  assert.equal(wrongSchema.reason, 'SCHEMA_MISMATCH');
  const badPopulation = clone.restore({ ...snapshot, universes: snapshot.universes.slice(0, 2) });
  assert.equal(badPopulation.ok, false);
  assert.equal(badPopulation.reason, 'POPULATION_OUT_OF_RANGE');
});

test('genomes stay inside the declared envelope and mutation/crossover never escape it', () => {
  const rand = createUniversePrng(99);
  for (let i = 0; i < 200; i += 1) {
    const genome = randomGenome(rand);
    for (const g of UNIVERSE_GENES) {
      assert.ok(genome[g.key] >= g.min && genome[g.key] <= g.max, `${g.key} out of bounds`);
    }
    const normalized = normalizeGenome({ ...genome, momentum: 999, memory: -50 });
    assert.equal(normalized.momentum, 1.2);
    assert.equal(normalized.memory, 0);
    assert.ok(['momentum', 'reversion', 'volatility', 'breadth', 'structural', 'balanced'].includes(classifyGenome(genome)));
  }
  assert.equal(classifyGenome({ momentum: 1, contrarian: 0, volatility: 0, precision: 1, memory: 0.2, breadth: 0, temperature: 1, plasticity: 0.2 }), 'momentum');
  assert.equal(classifyGenome({ momentum: 0, contrarian: -1, volatility: 0, precision: 1, memory: 0.2, breadth: 0, temperature: 1, plasticity: 0.2 }), 'reversion');
  assert.equal(classifyGenome({ momentum: 0, contrarian: 0, volatility: 1.2, precision: 2, memory: 0.2, breadth: 0, temperature: 1, plasticity: 0.2 }), 'volatility');
  assert.equal(classifyGenome({ momentum: 0, contrarian: 0, volatility: 0, precision: 1, memory: 0.2, breadth: 0.2, temperature: 1, plasticity: 0.2 }, { explorer: true }), 'explorer');
});

test('a live prediction is settled by the first new real bar, and never matched to another market', () => {
  const series = walkSeries(120, { seed: 17 });
  const engine = createResearchUniverses({ seed: 17, population: 8 });

  const first = engine.runPulse({ candles: series, symbol: 'BTC' });
  const liveProbability = first.report.consensus.probability;
  assert.equal(first.report.pending, true);
  assert.ok(liveProbability > 0 && liveProbability < 1);
  assert.equal(first.livePending.components, 8);
  const resolvedAfterFirst = first.report.resolved;

  // Re-running on the same (unchanged) series cannot invent a new outcome.
  const replay = engine.runPulse({ candles: series, symbol: 'BTC' });
  assert.equal(replay.bars, 0);
  assert.equal(replay.reason, 'AWAITING_NEXT_BAR');
  assert.equal(replay.report.resolved, resolvedAfterFirst);
  assert.equal(replay.report.pending, true);

  // The first bar that closed after the prediction settles it — and only it.
  const extended = walkSeries(150, { seed: 17 });
  const second = engine.runPulse({ candles: extended, symbol: 'BTC' });
  assert.equal(second.settlement, 'settled');
  assert.ok(second.report.resolved > resolvedAfterFirst);
  assert.equal(second.report.pending, true);
  assert.equal(second.report.honesty.abandonedUnscored, 0);

  // A different market must not be used to judge the ETH/BTC pending prediction.
  const other = engine.runPulse({ candles: walkSeries(150, { seed: 88 }), symbol: 'ETH' });
  assert.equal(other.abandoned, 'SYMBOL_CHANGED');
  assert.equal(other.report.honesty.abandonedUnscored, 1);
  // Abandoned means unscored: the record may only grow by real BTC outcomes.
  assert.ok(other.report.resolved >= second.report.resolved);
});

test('the engine probe is a labelled synthetic self-test and is reproducible', () => {
  const a = probeResearchUniverses({ seed: 0x2050fb71, population: 12, steps: 120 });
  const b = probeResearchUniverses({ seed: 0x2050fb71, population: 12, steps: 120 });

  assert.equal(a.probe.syntheticDataUsed, true);
  assert.equal(a.honesty.syntheticDataUsed, true);
  assert.match(a.probe.disclaimer, /synthetic fixture/);
  assert.equal(a.probe.contentHash, b.probe.contentHash);
  assert.equal(a.probe.steps, b.probe.steps);
  assert.ok(a.probe.steps > 40);
  assert.ok(a.consensus.brier > 0 && a.consensus.brier < 1);
  assert.ok(a.consensus.control.brier > 0 && a.consensus.control.brier < 1);
  assert.equal(a.laws.canExecute, false);
  assert.equal(a.oracle.hindsight, true);
  assert.ok(a.probe.selectionRounds > 3);
  assertFiniteOrNull(a.probe, 'probe block');
});

test('selection scores shrink small track records toward chance (auditable)', () => {
  const fresh = shrunkLogLoss({ logLossSum: 0, resolved: 0 });
  assert.ok(Math.abs(fresh - Math.LN2) < 1e-9, 'a universe with no evidence is exactly a fair coin');
  const luckyChild = shrunkLogLoss({ logLossSum: 5.5, resolved: 8 });
  const longRecord = shrunkLogLoss({ logLossSum: 5.5 * 8, resolved: 64 });
  assert.ok(luckyChild > longRecord, 'the same rate over 8 observations must not outrank 64');
  assert.ok(Math.abs(shrunkLogLoss({ logLossSum: 0, resolved: 0 }) - Math.LN2) < 1e-9);

  const engine = createResearchUniverses({ seed: 5, population: 12 });
  const report = engine.runPulse({ candles: walkSeries(160, { seed: 3 }), symbol: 'BTC' }).report;
  assert.ok(report.best.shrunkLogLoss >= Math.LN2 - 1e-6 || report.best.resolved > 0);
  assert.ok(Number.isFinite(report.best.shrunkLogLoss));
  assert.ok(report.best.resolved > 0);
});

test('population bounds are enforced rather than trusted', () => {
  const tooSmall = createResearchUniverses({ population: 1 }).report();
  const tooBig = createResearchUniverses({ population: 999 }).report();
  assert.equal(tooSmall.population, MIN_POPULATION);
  assert.equal(tooBig.population, 32);
  assert.equal(createResearchUniverses({}).report().population, DEFAULT_POPULATION);
});

test('the research path never calls Math.random (reproducibility is a code property)', () => {
  const files = [
    'src/lib/neuromorphic/researchUniverses.js',
    'src/lib/neuromorphic/useResearchUniverses.js',
    'src/components/ai/ParallelUniversesPanel.jsx',
    'server/aiResearchUniverses.js'
  ];
  const stripComments = (source) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
  for (const rel of files) {
    const source = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.equal(/Math\.random\s*\(/.test(source), false, `${rel} must not use Math.random`);
  }
});
