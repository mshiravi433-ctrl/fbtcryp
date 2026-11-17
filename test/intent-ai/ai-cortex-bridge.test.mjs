/**
 * THE CORTEX BRIDGE — THE TESTS
 * ---------------------------------------------------------------------------
 * Lever #5 of docs/AI-COGNITION-AUDIT-2026-11-11.md.
 *
 * These tests are written around the MEASUREMENTS, not around the code's
 * shape. The point of lever #5 was that the cortex could not read direction
 * — so the tests assert that it now can, and that the gates that make it
 * safe are real.
 *
 * The measured before/after:
 *
 *     untrained readout:  discrimination 0.072, regimes {trendUp: 2, shock: 9}
 *     trained readout:    discrimination 0.963, regimes {trendUp: 4,
 *                                                     trendDown: 4,
 *                                                     meanRevert: 3}
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CORTEX_BRIDGE_SCHEMA,
  BRIDGE_AXES,
  buildCortexFeatures,
  mirrorFeatures,
  warmStartEncoder,
  probeDirectionalDiscrimination,
  readCortexForState
} from '../../src/lib/neuromorphic/cortexReadout.js';

import {
  READOUT_TRAINER_SCHEMA,
  HEAD_MAP,
  solveRidge,
  buildTargets,
  trainReadout,
  trainRegimeHeads,
  applyTrainedReadout,
  buildTrainedSwarm
} from '../../src/lib/neuromorphic/cortexReadoutTrainer.js';

import {
  CORTEX_TRAIN_SCHEMA,
  labelForState,
  buildTrainingEpisodes,
  createTrainedCortex,
  measureDirectionalDiscrimination
} from '../../src/lib/neuromorphic/cortexReadoutTrain.js';

import {
  createNeuromorphicCortex,
  SWARM_PARAM_LAYOUT,
  SWARM_PARAM_OFFSETS,
  SWARM_PARAM_COUNT
} from '../../src/lib/neuromorphic/cortexCore.js';

import {
  CORTEX_BRIDGE_SERVER_SCHEMA,
  cortexBridgeStatus,
  readCortex,
  renderCortexBlock,
  cortexReadPayload,
  marketStateFromFrame
} from '../../server/aiCortexBridge.js';

/* ── helpers ─────────────────────────────────────────────────────────────── */

const UP = {
  returnShort: 0.04, returnMedium: 0.08, realizedVol: 0.3, volumeImpulse: 0.9,
  rsi: 66, rangePosition: 0.8, breadthSkew: 0.7, structuralStress: 0.2
};
const DOWN = {
  returnShort: -0.04, returnMedium: -0.08, realizedVol: 0.3, volumeImpulse: 0.9,
  rsi: 34, rangePosition: 0.2, breadthSkew: -0.7, structuralStress: 0.2
};
const FLAT = {
  returnShort: 0, returnMedium: 0, realizedVol: 0.3, volumeImpulse: 0.9,
  rsi: 50, rangePosition: 0.5, breadthSkew: 0, structuralStress: 0.2
};

/* ── the feature mapping ─────────────────────────────────────────────────── */

test('the bridge maps a market state onto the eight sensory axes, sign preserved', () => {
  const { axes, features } = buildCortexFeatures(UP);
  assert.equal(BRIDGE_AXES.length, 8);
  assert.equal(features.length, 16);
  assert.ok(axes.returnShort > 0, 'a rising market has a positive short return');
  assert.ok(axes.breadthSkew > 0, 'breadth skew keeps its sign');
  assert.ok(axes.realizedVol >= 0, 'volatility is unsigned');
  assert.ok(axes.structuralStress >= 0, 'structural stress is unsigned');
});

test('the ON channel carries the positive part and the OFF channel the negative part', () => {
  const { features } = buildCortexFeatures(UP);
  for (let axis = 0; axis < 8; axis += 1) {
    assert.ok(features[axis * 2] >= 0);
    assert.ok(features[axis * 2 + 1] >= 0);
  }
  /* A rising market lights the ON channel of the directional axes and leaves
     the OFF channel dark. */
  assert.ok(features[0] > 0, 'the short-return ON channel fires');
  assert.equal(features[1], 0, 'the short-return OFF channel stays dark');
});

test('the magnitudes stay inside [-1, 1] so the encoder cannot saturate', () => {
  const { axes } = buildCortexFeatures({
    returnShort: 50, returnMedium: 50, realizedVol: 40, volumeImpulse: 90,
    rsi: 100, rangePosition: 1, breadthSkew: 99, structuralStress: 9
  });
  for (const axis of BRIDGE_AXES) {
    assert.ok(axes[axis] >= -1 && axes[axis] <= 1, `${axis} is inside [-1, 1]`);
  }
});

test('the mirror flips the signed axes and leaves the magnitude axes alone', () => {
  const { features } = buildCortexFeatures(UP);
  const mirrored = mirrorFeatures(features);
  assert.equal(mirrored.length, features.length);
  assert.equal(mirrored[0], features[1], 'the short-return ON/OFF swap');
  assert.equal(mirrored[1], features[0]);
  assert.equal(mirrored[4], features[4], 'the volatility channel is untouched');
});

test('the warm start survives an encoder without a reset', () => {
  const calls = [];
  const fake = { encode: (v) => calls.push(v) };
  assert.equal(warmStartEncoder(fake), true);
  assert.equal(calls.length, 1);
  assert.equal(warmStartEncoder(null), false);
  assert.equal(warmStartEncoder({}), false);
});

/* ── the solver ──────────────────────────────────────────────────────────── */

test('the ridge solver returns the least-squares solution', () => {
  /* A one-unknown fit: y = 1*x + 0. */
  const w = solveRidge([[1], [2], [3]], [[1], [2], [3]], 1e-9);
  assert.ok(Array.isArray(w));
  assert.ok(Math.abs(w[0][0] - 1) < 1e-3, `expected ~1, got ${w[0][0]}`);
});

test('the ridge solver is not the zero solver', () => {
  /*
   * The bug this guards against: an earlier version initialised the
   * back-substitution row to zeros and only ever SUBTRACTED from it, so the
   * right-hand side never entered the solution and every weight came out
   * zero — while the trainer still reported ok: true.
   */
  const w = solveRidge([[1, 2], [2, 1], [3, 2]], [[1], [2], [3]], 1e-9);
  assert.ok(Math.abs(w[0][0] - 1) < 1e-3, `the first weight must not be zero: ${w[0][0]}`);
  assert.ok(Math.abs(w[1][0]) < 1e-2, 'the second weight must be near zero');
});

test('the ridge solver reports a singular system instead of guessing', () => {
  const w = solveRidge([[1, 1], [1, 1]], [[1], [2]], 0);
  assert.equal(w, null);
});

test('the ridge solver refuses an empty problem', () => {
  assert.equal(solveRidge([], [], 1e-3), null);
});

/* ── the targets ─────────────────────────────────────────────────────────── */

test('the targets carry the direction, the volatility and a four-way regime', () => {
  const targets = buildTargets([
    { direction: -0.5, volatility: 0.4, regime: 'trendDown' },
    { direction: 0.5, volatility: 0.2, regime: 'trendUp' }
  ]);
  assert.equal(targets.length, 2);
  assert.equal(targets[0][HEAD_MAP.directional], -0.5);
  assert.equal(targets[0][HEAD_MAP.volatility], 0.4);
  assert.equal(targets[1][HEAD_MAP.directional], 0.5);
  /* The regime is a DISTRIBUTION: the correct head carries the most mass. */
  const regime = targets[0].slice(HEAD_MAP.regimeUp, HEAD_MAP.regimeUp + 4);
  assert.ok(regime[1] > regime[0], 'trendDown carries more mass than trendUp');
  assert.equal(regime.reduce((a, b) => a + b, 0).toFixed(2), '1.00');
});

/* ── the trainer ─────────────────────────────────────────────────────────── */

test('the trained readout learns to read direction', () => {
  const { episodes } = buildTrainingEpisodes();
  const trained = trainReadout({ episodes, lambda: 1e-4 });
  assert.equal(trained.schema, READOUT_TRAINER_SCHEMA);
  assert.equal(trained.ok, true);
  assert.ok(trained.quality.directionalCorrelation > 0.8,
    `the directional correlation must be strong, got ${trained.quality.directionalCorrelation}`);
});

test('the regime heads are trained on all four heads, not only the first two', () => {
  /*
   * The bug this guards against: the gradient buffer was allocated with the
   * width of the REGIME GROUP alone (four) instead of the width of the whole
   * readout (six), so the gradient for heads 4 and 5 was undefined and those
   * two weights became NaN. The trainer still reported a good loss.
   */
  const { episodes } = buildTrainingEpisodes();
  const trained = trainReadout({ episodes, lambda: 1e-4 });
  for (const row of trained.weights) {
    for (let head = 0; head < 6; head += 1) {
      assert.ok(Number.isFinite(row[head]), `head ${head} must be finite`);
    }
  }
  for (const b of trained.bias) assert.ok(Number.isFinite(b));
});

test('the softmax regime trainer lowers the loss it is asked to lower', () => {
  const { episodes } = buildTrainingEpisodes();
  const d = 32;
  const initW = Array.from({ length: d + 1 }, () => new Array(6).fill(0));
  const initB = new Array(6).fill(0);
  const trained = trainRegimeHeads({
    episodes, initWeights: initW, initBias: initB, learningRate: 0.02, epochs: 800
  });
  assert.ok(Number.isFinite(trained.loss));
  assert.ok(trained.loss < 1.0, `the regime loss must beat chance, got ${trained.loss}`);
});

test('the trainer tolerates a liquid state that is not an array', () => {
  /*
   * `cortex.liquidSnapshot` is a Float32Array on a fresh cortex and a plain
   * OBJECT after a snapshot/restore cycle. `Array.from()` on the object
   * yields an array of undefined, which becomes NaN in the normal
   * equations — and a ridge solve over NaN returns NaN weights that look
   * trained.
   */
  const asObject = { 0: 0.2, 1: 0.3, 2: 0.1, 3: 0.05 };
  const episodes = [];
  for (let i = 0; i < 6; i += 1) {
    episodes.push({
      liquidState: { 0: 0.2 + i * 0.01, 1: 0.3, 2: 0.1 - i * 0.005, 3: 0.05 },
      direction: i / 6,
      volatility: 0.4,
      regime: 'trendUp'
    });
  }
  const trained = trainReadout({ episodes, lambda: 1e-4 });
  assert.equal(trained.ok, true);
  assert.equal(trained.episodes, 6);
  for (const row of trained.weights) {
    for (const v of row) assert.ok(Number.isFinite(v), 'no NaN may survive');
  }
  for (const b of trained.bias) assert.ok(Number.isFinite(b));
});

test('a liquid state that cannot be read is dropped rather than poisoning the solve', () => {
  const episodes = [];
  for (let i = 0; i < 6; i += 1) {
    episodes.push({ liquidState: [1 + i * 0.1, 2, 3, 4], direction: i / 6, volatility: 0.4, regime: 'trendUp' });
  }
  episodes.push({ liquidState: null, direction: -0.5, volatility: 0.4, regime: 'trendDown' });
  const trained = trainReadout({ episodes, lambda: 1e-4 });
  assert.equal(trained.episodes, 6, 'the unreadable episode must be dropped, not counted');
  for (const row of trained.weights) {
    for (const v of row) assert.ok(Number.isFinite(v), 'no NaN may survive');
  }
});

/* ── the layout ──────────────────────────────────────────────────────────── */

test('the genome offsets are not the genome sizes', () => {
  /*
   * `SWARM_PARAM_LAYOUT.readoutW` is the SIZE of the readout block (384),
   * not its OFFSET. Using the size as an offset lands in the middle of the
   * RECURRENT weights: the reservoir is corrupted and the readout keeps its
   * untrained values, so the cortex still cannot read direction and nothing
   * looks broken.
   */
  assert.equal(SWARM_PARAM_LAYOUT.readoutW, 384);
  assert.equal(SWARM_PARAM_OFFSETS.readoutW, 1568);
  assert.equal(SWARM_PARAM_OFFSETS.readoutBias, 1952);
  assert.equal(SWARM_PARAM_OFFSETS.readoutBias + SWARM_PARAM_LAYOUT.readoutBias, SWARM_PARAM_COUNT);
  assert.ok(SWARM_PARAM_OFFSETS.readoutW !== SWARM_PARAM_LAYOUT.readoutW);
});

test('the trained swarm is installed through setSwarmWeights', () => {
  /*
   * `getSwarmWeights()` returns a COPY, so a patch written into that copy
   * never reaches the cortex. The install has to go through
   * `setSwarmWeights`.
   */
  const { episodes } = buildTrainingEpisodes();
  const trained = trainReadout({ episodes, lambda: 1e-4 });
  const base = createNeuromorphicCortex({ seed: 2050, reservoirSize: 96 });
  const { weights, applied } = buildTrainedSwarm(base.getSwarmWeights(), trained, {
    readoutW: SWARM_PARAM_OFFSETS.readoutW,
    readoutBias: SWARM_PARAM_OFFSETS.readoutBias,
    liquidSize: 32,
    readoutDim: 12
  });
  assert.equal(applied.patched, true);
  assert.ok(weights instanceof Float32Array);
  assert.equal(weights.length, SWARM_PARAM_COUNT);

  const before = base.getSwarmWeights();
  assert.notEqual(before[SWARM_PARAM_OFFSETS.readoutBias], weights[SWARM_PARAM_OFFSETS.readoutBias],
    'the patched weights must differ from the original');
});

test('the trained readout refuses a weight matrix of the wrong shape', () => {
  const trained = { ok: true, weights: [[0], [0]], bias: [0, 0], normalization: null };
  const out = applyTrainedReadout(new Float32Array(SWARM_PARAM_COUNT), trained, {
    readoutW: SWARM_PARAM_OFFSETS.readoutW,
    readoutBias: SWARM_PARAM_OFFSETS.readoutBias,
    liquidSize: 32,
    readoutDim: 12
  });
  assert.equal(out.patched, false);
  assert.ok(out.reason);
});

/* ── the labels ──────────────────────────────────────────────────────────── */

test('the labels are derived from the state, not from the cortex output', () => {
  const up = labelForState({ returnShort: 0.05, returnMedium: 0.1, rsi: 68, rangePosition: 0.8, breadthSkew: 0.75, realizedVol: 0.3, structuralStress: 0.2 });
  const down = labelForState({ returnShort: -0.05, returnMedium: -0.1, rsi: 32, rangePosition: 0.2, breadthSkew: -0.75, realizedVol: 0.3, structuralStress: 0.2 });
  assert.ok(up.direction > 0, 'a rising state is labelled upward');
  assert.ok(down.direction < 0, 'a falling state is labelled downward');
  assert.equal(up.regime, 'trendUp');
  assert.equal(down.regime, 'trendDown');
});

test('a directionless, violent state is labelled a shock', () => {
  const shock = labelForState({
    returnShort: 0.001, returnMedium: 0.002, realizedVol: 1.0,
    structuralStress: 0.9, rsi: 50, rangePosition: 0.5, breadthSkew: 0
  });
  assert.equal(shock.regime, 'shock');
});

test('the training episodes cover every regime', () => {
  const { episodes, meta } = buildTrainingEpisodes();
  assert.equal(meta.schema, CORTEX_TRAIN_SCHEMA);
  const regimes = new Set(episodes.map((e) => e.regime));
  assert.ok(regimes.has('trendUp'));
  assert.ok(regimes.has('trendDown'));
  assert.ok(regimes.has('meanRevert'));
  assert.ok(episodes.length >= 20);
});

/* ── the trained cortex ──────────────────────────────────────────────────── */

test('the trained cortex reads direction, and the untrained one does not', () => {
  const trained = createTrainedCortex({ seed: 2050, reservoirSize: 96 });
  assert.equal(trained.meta.installed, true);
  const after = measureDirectionalDiscrimination({ cortex: trained.cortex, sibling: trained.sibling });
  const bare = createNeuromorphicCortex({ seed: 2050, reservoirSize: 96 });
  const before = measureDirectionalDiscrimination({ cortex: bare });

  assert.ok(before.discrimination < 0.15,
    `the untrained cortex must be nearly blind, got ${before.discrimination}`);
  assert.ok(after.discrimination > 0.5,
    `the trained cortex must separate up from down, got ${after.discrimination}`);
  assert.ok(after.discrimination > before.discrimination * 5,
    'training must improve the discrimination by a wide margin');
});

test('the trained cortex reads a falling market as falling', () => {
  const { cortex, sibling } = createTrainedCortex({ seed: 2050, reservoirSize: 96 });
  const out = sibling().stepSync(buildCortexFeatures(DOWN).features);
  assert.ok(out.directionalDrive < 0, `a downtrend must read negative, got ${out.directionalDrive}`);
  assert.equal(out.dominantRegime, 'trendDown');
});

test('the trained cortex reads a rising market as rising', () => {
  const { sibling } = createTrainedCortex({ seed: 2050, reservoirSize: 96 });
  const out = sibling().stepSync(buildCortexFeatures(UP).features);
  assert.ok(out.directionalDrive > 0, `an uptrend must read positive, got ${out.directionalDrive}`);
  assert.equal(out.dominantRegime, 'trendUp');
});

test('a directionless state reads as mean reversion, not as a trend', () => {
  const { sibling } = createTrainedCortex({ seed: 2050, reservoirSize: 96 });
  const out = sibling().stepSync(buildCortexFeatures(FLAT).features);
  assert.equal(out.dominantRegime, 'meanRevert');
});

test('the trained cortex is deterministic', () => {
  const { sibling } = createTrainedCortex({ seed: 2050, reservoirSize: 96 });
  const a = sibling().stepSync(buildCortexFeatures(UP).features);
  const b = sibling().stepSync(buildCortexFeatures(UP).features);
  assert.equal(a.directionalDrive, b.directionalDrive);
  assert.equal(a.dominantRegime, b.dominantRegime);
});

/* ── the bridge ──────────────────────────────────────────────────────────── */

test('the bridge quotes a rising market and withholds a directionless one', () => {
  const up = readCortex(UP);
  assert.equal(up.schema, CORTEX_BRIDGE_SERVER_SCHEMA);
  assert.equal(up.usable, true);
  assert.ok(up.directional.drive > 0);

  const flat = readCortex(FLAT);
  assert.equal(flat.usable, false);
  assert.equal(flat.directional, null, 'a withheld directional read must be null, not a small number');
});

test('the bridge quotes a falling market with a NEGATIVE drive', () => {
  /*
   * The bug this guards against: the probe rejected a NEGATIVE spread as
   * "the cortex reads this state BACKWARDS". But the mirror of a downtrend is
   * an uptrend, so a correct downtrend read has a negative spread — and it
   * was being withheld.
   */
  const down = readCortex(DOWN);
  assert.equal(down.usable, true, `a falling market must be quotable: ${down.reason}`);
  assert.ok(down.directional.drive < 0, `the drive must be negative, got ${down.directional.drive}`);
  assert.equal(down.regime, 'trendDown');
});

test('the bridge reports the volatility read on its own flag', () => {
  /*
   * `usable` means ONE thing: the DIRECTIONAL read may be quoted. An earlier
   * version set `usable = Boolean(volatility)` when the directional probe
   * failed, so a report whose directional call had been WITHHELD still
   * announced itself as usable.
   */
  const flat = readCortex(FLAT);
  assert.equal(flat.usable, false, 'no directional call, so not usable');
  assert.ok(flat.volatility, 'the volatility read is still reported');
  assert.equal(flat.volatilityUsable, true, 'the volatility read carries its own flag');
});

test('the bridge withholds the read when the cortex is stateful and no fresh instance exists', () => {
  const bare = createNeuromorphicCortex({ seed: 2050, reservoirSize: 96 });
  const report = readCortexForState({ cortex: bare, state: UP });
  assert.equal(report.usable, false);
  assert.equal(report.directional, null);
  assert.ok(/stateful/.test(report.reason), report.reason);
});

test('a state too small to have a direction is withheld, and NOT called inverted', () => {
  /*
   * The reason matters: the state had a large SQUASHED balance — the RSI
   * and range-position channels contribute their full ±1 by construction —
   * but a tiny move. Calling that "the cortex reads this state BACKWARDS"
   * is a false accusation, not a measurement.
   */
  const mild = {
    returnShort: 0.008, returnMedium: 0.004, realizedVol: 0.06,
    volumeImpulse: 0.4, rsi: 62, rangePosition: 0.62, breadthSkew: 0, structuralStress: 0.2
  };
  const report = readCortex(mild);
  assert.equal(report.usable, false);
  assert.equal(report.directional, null);
  assert.ok(/no direction of its own/.test(report.reason), report.reason);
  assert.ok(!/BACKWARDS/.test(report.reason), 'a directionless state must not be called inverted');
});

test('a state with no move at all is withheld as noise', () => {
  const report = readCortex(FLAT);
  assert.equal(report.usable, false);
  assert.equal(report.directional, null);
  assert.ok(/cannot tell this state from its mirror|own to read/.test(report.reason), report.reason);
});

test('the probe detects a blind cortex', () => {
  const blind = () => ({ directionalDrive: 0.5, dominantRegime: 'trendUp' });
  const { features } = buildCortexFeatures(UP);
  const probe = probeDirectionalDiscrimination({
    runCortex: blind, features, mirrored: mirrorFeatures(features)
  });
  assert.equal(probe.usable, false);
  assert.ok(/noise/.test(probe.reason), probe.reason);
});

test('the probe detects an inverted cortex', () => {
  /* A cortex that answers the opposite of what it is given. */
  const inverted = (f) => {
    const { features: real } = buildCortexFeatures(UP);
    const same = f[0] === real[0];
    return { directionalDrive: same ? -0.8 : 0.8, dominantRegime: 'trendUp' };
  };
  const { features } = buildCortexFeatures(UP);
  const probe = probeDirectionalDiscrimination({
    runCortex: inverted, features, mirrored: mirrorFeatures(features)
  });
  assert.equal(probe.usable, false);
  assert.ok(/BACKWARDS/.test(probe.reason), probe.reason);
});

test('the probe survives a cortex that throws', () => {
  const { features } = buildCortexFeatures(UP);
  const probe = probeDirectionalDiscrimination({
    runCortex: () => { throw new Error('boom'); },
    features,
    mirrored: mirrorFeatures(features)
  });
  assert.equal(probe.usable, false);
  assert.ok(/probe failed/.test(probe.reason), probe.reason);
});

test('the bridge renders a block that says what the cortex is', () => {
  const block = renderCortexBlock({ state: UP });
  assert.ok(block.length > 0);
  assert.ok(/not evidence/.test(block), 'the block must say it is not evidence');
  assert.ok(/HARD RULE/.test(block), 'the block must carry a rule');
  assert.ok(/Directional bias/.test(block));
});

test('the bridge renders nothing when the cortex has nothing trustworthy', () => {
  assert.equal(renderCortexBlock({ state: FLAT }), '');
});

test('the bridge report carries the schema and the reason', () => {
  const report = readCortex(UP);
  assert.equal(report.schema, CORTEX_BRIDGE_SERVER_SCHEMA);
  assert.ok(report.reason);
  assert.equal(report.trained, true);
});

test('the read payload mirrors the report', () => {
  const payload = cortexReadPayload({ state: UP });
  assert.equal(payload.usable, true);
  assert.ok(payload.directional);
  assert.equal(payload.regime, 'trendUp');
});

/* ── the market state ────────────────────────────────────────────────────── */

test('the market state is derived from the market frame', () => {
  const frame = {
    regime: 'normal',
    benchmark: { symbol: 'BTC', change24hPct: 2.4 },
    breadth: { advancers: 7, decliners: 3 },
    instruments: [
      { symbol: 'BTC', change24hPct: 2.4, rangePosition: 0.72, volume24hUsd: 2e9 },
      { symbol: 'ETH', change24hPct: 3.1, rangePosition: 0.8, volume24hUsd: 1e9 },
      { symbol: 'XRP', change24hPct: -0.4, rangePosition: 0.44, volume24hUsd: 2e8 }
    ]
  };
  const state = marketStateFromFrame(frame);
  assert.ok(state, 'a frame with instruments yields a state');
  assert.ok(state.returnShort > 0, 'a rising benchmark gives a positive short return');
  assert.ok(state.breadthSkew > 0, 'more advancers than decliners gives a positive skew');
  assert.ok(state.rsi >= 0 && state.rsi <= 100);
});

test('a frame with no instruments yields no state — an absent signal is not fabricated', () => {
  assert.equal(marketStateFromFrame(null), null);
  assert.equal(marketStateFromFrame({}), null);
  assert.equal(marketStateFromFrame({ instruments: [] }), null);
});

/* ── the central brain ───────────────────────────────────────────────────── */

test('the central brain consults the cortex on a market turn', async () => {
  const { createCentralBrain } = await import('../../src/lib/intent-ai/orchestrator/centralBrain.js');
  const brain = createCentralBrain({
    availableProviders: ['openrouterfree'],
    cortexReader: async () => ({
      usable: true, directional: { drive: 0.7, confidence: 0.8 },
      regime: 'trendUp', discrimination: 0.8, reason: 'ok'
    })
  });
  const run = await brain.run({ owner: 'cortex-test', message: 'analyse the market trend for BTC' });
  assert.equal(run.cortex.consulted, true);
  assert.equal(run.cortex.read.usable, true);
  assert.equal(run.cortex.read.regime, 'trendUp');
});

test('the central brain does not consult the cortex on a non-market turn', async () => {
  const { createCentralBrain } = await import('../../src/lib/intent-ai/orchestrator/centralBrain.js');
  const brain = createCentralBrain({
    availableProviders: ['openrouterfree'],
    cortexReader: async () => ({ usable: true, regime: 'trendUp' })
  });
  const run = await brain.run({ owner: 'cortex-test', message: 'what is the capital of France' });
  assert.equal(run.cortex.consulted, false);
  assert.ok(run.cortex.reason);
});

test('the central brain works with no cortex at all', async () => {
  const { createCentralBrain } = await import('../../src/lib/intent-ai/orchestrator/centralBrain.js');
  const brain = createCentralBrain({ availableProviders: ['openrouterfree'] });
  const run = await brain.run({ owner: 'cortex-test', message: 'analyse the market trend for BTC' });
  assert.equal(run.cortex.consulted, false);
  assert.ok(run.cortex.reason);
});

test('a cortex that throws does not take the answer down', async () => {
  const { createCentralBrain } = await import('../../src/lib/intent-ai/orchestrator/centralBrain.js');
  const brain = createCentralBrain({
    availableProviders: ['openrouterfree'],
    cortexReader: async () => { throw new Error('the reservoir melted'); }
  });
  const run = await brain.run({ owner: 'cortex-test', message: 'analyse the market trend for BTC' });
  assert.equal(run.cortex.consulted, true);
  assert.equal(run.cortex.read, null);
  assert.ok(/failed/.test(run.cortex.reason), run.cortex.reason);
});

test('the central brain RUNTIME consults the cortex on a market turn', async () => {
  /*
   * The gap this closes: the central brain had NO neuromorphic input at all.
   * `createCentralBrain` accepted a `cortexReader`, but the server runtime
   * never passed one — so the cortex was a spectator to the whole pipeline.
   */
  const { getCentralBrain } = await import('../../server/centralBrainRuntime.js');
  const brain = getCentralBrain();
  assert.ok(brain, 'the runtime must build a brain');
  const run = await brain.run({ owner: 'cortex-runtime', message: 'analyse the market trend for BTC' });
  assert.ok(run.cortex, 'the brain must publish a cortex entry');
  assert.equal(typeof run.cortex.consulted, 'boolean');
  /*
   * With no market feed reachable (the sandbox has no provider keys) the
   * brain must still work and must still publish WHY there was no read.
   * It must never fabricate one.
   */
  if (!run.cortex.read) {
    assert.ok(run.cortex.reason, 'the absence of a read must carry a reason');
  }
});

test('the central brain runtime wires a cortex reader that returns a usable shape', async () => {
  const { readCortex, marketStateFromFrame } = await import('../../server/aiCortexBridge.js');
  const frame = {
    regime: 'normal',
    benchmark: { symbol: 'BTC', change24hPct: 3.1 },
    breadth: { advancers: 7, decliners: 2 },
    instruments: [
      { symbol: 'BTC', change24hPct: 3.1, rangePosition: 0.82 },
      { symbol: 'ETH', change24hPct: 3.9, rangePosition: 0.88 },
      { symbol: 'XRP', change24hPct: -0.5, rangePosition: 0.44 }
    ]
  };
  const state = marketStateFromFrame(frame);
  const read = readCortex(state);
  assert.equal(read.usable, true);
  assert.ok(read.directional.drive > 0, 'a rising market reads positive');
  assert.equal(read.regime, 'trendUp');
  /* And the shape the brain consumes must be the one the bridge produces. */
  assert.ok(typeof read.discrimination === 'number');
  assert.ok(typeof read.reason === 'string');
});

/* ── the status endpoint ─────────────────────────────────────────────────── */

test('the status endpoint reports the cortex as available and trained', () => {
  const status = cortexBridgeStatus();
  assert.equal(status.schema, CORTEX_BRIDGE_SERVER_SCHEMA);
  assert.equal(status.available, true);
  assert.equal(status.trained, true);
  assert.equal(status.installed, true);
  assert.ok(status.discrimination > 0.5, `the measured discrimination must be strong, got ${status.discrimination}`);
  assert.ok(status.directionalCorrelation > 0.8);
});

test('the status endpoint reports the regime spread', () => {
  const status = cortexBridgeStatus();
  assert.ok(status.regimes);
  assert.ok(status.regimes.trendUp > 0, 'a trained cortex must read some uptrends');
  assert.ok(status.regimes.trendDown > 0, 'a trained cortex must read some downtrends');
});
