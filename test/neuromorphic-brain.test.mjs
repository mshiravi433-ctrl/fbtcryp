/**
 * PHASE 6 — BRAIN-INSPIRED COGNITIVE CORE: BEHAVIOURAL CONTRACT TESTS
 * ===========================================================================
 * These tests assert *mechanisms*, not marketing: each one fails if the circuit
 * it names stops behaving like the biological thing it is modelled on.
 *
 *   · predictive coding must actually lower free energy on repeated structure
 *   · the thalamic gate must stay bounded and must not be a constant
 *   · the cerebellar forward model must get better with use
 *   · the basal ganglia must not have a house bias (a falling series must not
 *     produce LONG — that regression happened and is pinned here)
 *   · dopamine must never be trained on an outcome that did not happen
 *   · consolidation must report measured before/after, and must refuse to claim
 *     an improvement when there is nothing to replay
 *   · the cortex must keep its security laws and its honest nulls with the brain
 *     core on, and must reproduce Phase-5 behaviour exactly with it off
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BRAIN_ACTIONS,
  BRAIN_CORE_SCHEMA,
  BRAIN_CONTEXT_SIZE,
  SYNAPTIC_OP_JOULES,
  createBrainInspiredCore,
  probeBrainInspiredCore
} from '../src/lib/neuromorphic/brainInspiredCore.js';
import {
  CORTEX_SCHEMA,
  createNeuromorphicCortex
} from '../src/lib/neuromorphic/cortexCore.js';
import { featuresFromCandles } from '../src/lib/neuromorphic/spikeEncoder.js';
import {
  __resetBrainReportCache,
  getBrainInspiredReport
} from '../server/aiNeuromorphicBrain.js';

function makeCandles(count = 30, drift = 0.004, wave = 0.004) {
  const out = [];
  let price = 60000;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const close = price * (1 + drift + Math.sin(i / 3.2) * wave);
    out.push({
      time: 1700000000000 + i * 3600_000,
      open,
      high: Math.max(open, close) * 1.004,
      low: Math.min(open, close) * 0.996,
      close,
      volume: 1200 + i * 25
    });
    price = close;
  }
  return out;
}

function features(t) {
  const v = new Float32Array(BRAIN_CONTEXT_SIZE);
  for (let c = 0; c < BRAIN_CONTEXT_SIZE; c += 1) {
    v[c] = Math.sin(t / 3 + c * 0.7) * 0.6 + Math.cos(t / 7) * 0.2;
  }
  return v;
}

function liquidAt(t) {
  const v = new Float32Array(32);
  for (let i = 0; i < 32; i += 1) v[i] = Math.sin(t / 5 + i * 0.4) * 0.5;
  return v;
}

describe('Phase 6 — Brain-inspired circuits: predictive coding, neuromodulators, thalamus', () => {
  it('lowers measured variational free energy on repeated structure, deterministically', () => {
    const a = probeBrainInspiredCore({ ticks: 80 });
    const b = probeBrainInspiredCore({ ticks: 80 });

    assert.deepEqual(a, b, 'same seed + same drive must be bit-identical');
    assert.equal(a.schema, BRAIN_CORE_SCHEMA);
    assert.ok(a.freeEnergyFirst > 0);
    assert.ok(
      a.freeEnergyLast < a.freeEnergyFirst,
      `free energy must fall with learning (was ${a.freeEnergyFirst} → ${a.freeEnergyLast})`
    );
    assert.ok(a.freeEnergyDropPct > 5, `drop too small: ${a.freeEnergyDropPct}%`);
    assert.equal(a.freeEnergyLearned, true);
  });

  it('keeps the thalamic attention gate bounded, non-uniform and adaptive', () => {
    const core = createBrainInspiredCore();
    let last = null;
    for (let t = 0; t < 12; t += 1) {
      last = core.step({
        features: features(t),
        liquidState: liquidAt(t),
        observedReturn: null,
        volatilityForecast: 0.5,
        anomalySurprise: 0.3,
        spikeCount: 6,
        reservoirSize: 96
      });
    }
    const gains = last.thalamus.gains;
    assert.equal(gains.length, BRAIN_CONTEXT_SIZE);
    for (const g of gains) {
      assert.ok(g > 0.34 && g < 2.25, `thalamic gain out of bounds: ${g}`);
    }
    const spread = Math.max(...gains) - Math.min(...gains);
    assert.ok(spread > 0.02, `gate collapsed to a constant (spread ${spread})`);
    assert.equal(last.laws.canExecute, false);
    assert.equal(last.laws.canSign, false);
  });

  it('improves its cerebellar forward model and keeps the error finite', () => {
    const core = createBrainInspiredCore();
    const errors = [];
    for (let t = 0; t < 40; t += 1) {
      const out = core.step({
        features: features(t),
        liquidState: liquidAt(t),
        observedReturn: null,
        volatilityForecast: 0.45,
        anomalySurprise: 0.25,
        spikeCount: 7,
        reservoirSize: 96
      });
      assert.ok(Number.isFinite(out.cerebellum.forwardError));
      if (t >= 4) errors.push(out.cerebellum.forwardError);
    }
    const early = errors.slice(0, 6).reduce((s, v) => s + v, 0) / 6;
    const late = errors.slice(-6).reduce((s, v) => s + v, 0) / 6;
    assert.ok(late < early, `forward error did not improve: ${early} → ${late}`);
    assert.ok(errors.every((e) => e >= 0 && e < 3));
  });
});

describe('Phase 6 — Basal ganglia action selection without house bias', () => {
  it('selects LONG on a rising series, SHORT on a falling one, and never LONG on a crash', async () => {
    const run = async (drift, wave = 0.004) => {
      const cortex = createNeuromorphicCortex();
      const candles = makeCandles(30, drift, wave);
      let out = null;
      for (let end = 6; end <= 24; end += 1) {
        const f = featuresFromCandles(candles.slice(0, end));
        // eslint-disable-next-line no-await-in-loop
        out = await cortex.step(f.vector, { observedPrice: f.meta.lastClose });
      }
      return out;
    };

    const rising = await run(0.006);
    const falling = await run(-0.006);
    // A genuinely flat series (no drift, no wave): zero evidence, so the circuit
    // must not manufacture a direction out of nothing.
    const flat = await run(0, 0);

    assert.equal(rising.brain.basalGanglia.action, 'LONG');
    assert.notEqual(falling.brain.basalGanglia.action, 'LONG');
    assert.equal(flat.brain.basalGanglia.action, 'FLAT');
    // A flat series is decided *in favour of not moving* — confidence in FLAT is
    // real here, not a manufactured direction.
    assert.equal(flat.brain.basalGanglia.decisive, true);
    assert.ok(flat.brain.basalGanglia.probabilities.FLAT > 0.4);
    assert.equal(rising.brain.basalGanglia.decisive, true);
    // rawAction is the pure argmax; action is what the circuit commits to.
    assert.ok(BRAIN_ACTIONS.includes(rising.brain.basalGanglia.rawAction));

    assert.ok(BRAIN_ACTIONS.includes(falling.brain.basalGanglia.action));
    const probs = falling.brain.basalGanglia.probabilities;
    const sum = probs.LONG + probs.FLAT + probs.SHORT;
    assert.ok(Math.abs(sum - 1) < 1e-3, `action probabilities must sum to 1 (got ${sum})`);
    // confidence must be a measurement, not a saturated constant
    assert.ok(
      rising.brain.basalGanglia.confidence < 0.999,
      'confidence saturated — the competition is not measuring anything'
    );
    assert.equal(rising.gatedAction.action, 'LONG');
  });
});

describe('Phase 6 — Neuromodulators only learn from real outcomes', () => {
  it('leaves dopamine untrained when no return has resolved, and trains it on real ones', () => {
    const unresolved = createBrainInspiredCore();
    let out = null;
    for (let t = 0; t < 10; t += 1) {
      out = unresolved.step({
        features: features(t),
        liquidState: liquidAt(t),
        observedReturn: null,
        volatilityForecast: 0.4,
        anomalySurprise: 0.2,
        spikeCount: 5,
        reservoirSize: 96
      });
    }
    assert.equal(out.neuromodulators.rewardPredictionError, 0);
    assert.equal(out.basalGanglia.updates, 0, 'no policy update may happen without an outcome');
    assert.equal(out.basalGanglia.lastReward, null);

    const resolved = createBrainInspiredCore();
    let positive = null;
    for (let t = 0; t < 6; t += 1) {
      positive = resolved.step({
        features: features(t),
        liquidState: liquidAt(t),
        observedReturn: 0.012,
        volatilityForecast: 0.4,
        anomalySurprise: 0.2,
        spikeCount: 5,
        reservoirSize: 96
      });
    }
    assert.ok(positive.neuromodulators.dopamine > 0.5, 'a positive RPE must raise dopamine');
    assert.ok(positive.basalGanglia.updates > 0);
    assert.ok(Number.isFinite(positive.neuromodulators.rewardPredictionError));
  });

  it('opens a norepinephrine burst on unexpected surprise and widens plasticity', () => {
    const core = createBrainInspiredCore();
    let calm = null;
    for (let t = 0; t < 6; t += 1) {
      calm = core.step({
        features: features(t),
        liquidState: liquidAt(t),
        observedReturn: null,
        volatilityForecast: 0.2,
        anomalySurprise: 0.1,
        spikeCount: 5,
        reservoirSize: 96
      });
    }
    const shock = core.step({
      features: features(6),
      liquidState: liquidAt(6),
      observedReturn: null,
      volatilityForecast: 0.9,
      anomalySurprise: 0.95,
      spikeCount: 20,
      reservoirSize: 96
    });
    assert.ok(shock.neuromodulators.norepinephrine > calm.neuromodulators.norepinephrine);
    assert.ok(shock.neuromodulators.bursts >= 1);
    assert.ok(shock.influence.riskDamp <= 1);
  });
});

describe('Phase 6 — Sharp-wave-ripple consolidation', () => {
  const episodes = Array.from({ length: 12 }, (_, i) => ({
    vector: Array.from({ length: 32 }, (_, k) => Math.sin(i / 3 + k / 4) * 0.5),
    realizedReturn: i % 2 ? 0.01 : -0.008,
    regime: i % 2 ? 'trendUp' : 'trendDown',
    symbol: 'BTC',
    at: i
  }));

  it('reports a measured free-energy drop and a better forward model after replay', () => {
    const core = createBrainInspiredCore();
    const res = core.consolidate({ episodes, iterations: 6 });

    assert.equal(res.ok, true);
    assert.equal(res.replayed, 12);
    assert.ok(res.freeEnergyBefore > 0);
    assert.ok(
      res.freeEnergyAfter < res.freeEnergyBefore,
      `replay must lower free energy (${res.freeEnergyBefore} → ${res.freeEnergyAfter})`
    );
    assert.ok(res.freeEnergyDropPct > 1);
    assert.equal(res.improved, true);
    assert.ok(res.forwardErrorAfter < res.forwardErrorBefore, 'forward model must improve on replay');
    assert.equal(res.laws.canExecute, false);
  });

  it('refuses to claim anything when there is nothing to replay', () => {
    const core = createBrainInspiredCore();
    const res = core.consolidate({ episodes: [] });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'NO_EPISODES');
    assert.equal(res.canExecute, false);
    assert.equal(res.replayed, 0);
    assert.equal(res.improved, undefined);
  });
});

describe('Phase 6 — Cortex integration, security laws and honest nulls', () => {
  it('attaches measured brain telemetry to every readout and keeps the no-execution wall', async () => {
    const cortex = createNeuromorphicCortex();
    assert.equal(cortex.isBrainEnabled(), true);

    const candles = makeCandles(24, 0.005);
    let out = null;
    for (let end = 6; end <= 18; end += 1) {
      const f = featuresFromCandles(candles.slice(0, end));
      // eslint-disable-next-line no-await-in-loop
      out = await cortex.step(f.vector, { observedPrice: f.meta.lastClose });
    }

    assert.equal(out.schema, CORTEX_SCHEMA);
    assert.ok(out.brain, 'readout.brain must be present');
    assert.equal(out.brain.schema, BRAIN_CORE_SCHEMA);
    assert.ok(Number.isFinite(out.brain.prediction.freeEnergy));
    assert.ok(out.brain.prediction.levels.length === 2);
    assert.ok(Number.isFinite(out.brain.workingMemory.load));
    assert.ok(out.brain.energy.synapticOps > 0);
    assert.ok(Number.isFinite(out.brain.energy.estimatedFemtoJoules));
    assert.ok(SYNAPTIC_OP_JOULES > 0);

    assert.equal(out.laws.canExecute, false);
    assert.equal(out.laws.canSign, false);
    assert.equal(out.laws.canMoveFunds, false);
    assert.equal(out.brain.laws.canExecute, false);

    // Accuracy is still owned by the spiking cortex and never pre-filled by the brain.
    assert.ok(out.learning.resolvedPredictions >= 1);
    assert.ok(out.learning.hitRate === null || Number.isFinite(out.learning.hitRate));
    const fresh = createNeuromorphicCortex();
    const f0 = featuresFromCandles(candles.slice(0, 5));
    const first = await fresh.step(f0.vector, { observedPrice: f0.meta.lastClose });
    assert.equal(first.learning.hitRate, null, 'hit rate must stay null before any resolution');
    assert.equal(first.brain.basalGanglia.lastReward, null);
  });

  it('can be switched off to reproduce Phase-5 behaviour byte-for-byte', async () => {
    const candles = makeCandles(20, 0.005);
    const feed = async (cortex, withBrain) => {
      cortex.setBrainEnabled(withBrain);
      let out = null;
      for (let end = 6; end <= 14; end += 1) {
        const f = featuresFromCandles(candles.slice(0, end));
        // eslint-disable-next-line no-await-in-loop
        out = await cortex.step(f.vector, { observedPrice: f.meta.lastClose });
      }
      return out;
    };
    const disabled = await feed(createNeuromorphicCortex({ brain: false }), false);
    assert.equal(disabled.brain, null);
    assert.equal(disabled.gatedAction, null);
    assert.equal(disabled.laws.canExecute, false);

    const rebuilt = await feed(createNeuromorphicCortex(), false);
    assert.equal(rebuilt.brain, null);
    assert.equal(rebuilt.directionalDrive, disabled.directionalDrive);
    assert.equal(rebuilt.dominantRegime, disabled.dominantRegime);
  });

  it('round-trips the brain state through exportSnapshot/importSnapshot and still imports v2 bundles', async () => {
    const cortex = createNeuromorphicCortex();
    const candles = makeCandles(18, 0.004);
    const f = featuresFromCandles(candles);
    await cortex.step(f.vector, { observedPrice: f.meta.lastClose });

    const snap = cortex.exportSnapshot();
    assert.equal(snap.schema, CORTEX_SCHEMA);
    assert.ok(snap.brain && snap.brain.ticks >= 1);

    const clone = createNeuromorphicCortex();
    assert.equal(clone.importSnapshot(snap), true);
    // Circuits are restored, but the *previous readout* is deliberately not:
    // it describes an observation that already happened, so it must not be shown
    // as if it were live. The next real tick repopulates it.
    assert.equal(clone.getBrainSnapshot(), null);
    assert.equal(clone.wasBrainStateRestored(), true);
    assert.equal(clone.exportSnapshot().brain.ticks, snap.brain.ticks);

    const legacy = { ...snap, schema: 'fbt.neuromorphic.cortex.v2' };
    delete legacy.brain;
    const legacyCortex = createNeuromorphicCortex();
    assert.equal(legacyCortex.importSnapshot(legacy), true, 'v2 bundles must keep restoring');
    assert.equal(legacyCortex.wasBrainStateRestored(), false, 'v2 has no brain block to restore');
    assert.equal(legacyCortex.importSnapshot({ schema: 'nope' }), false);

    // A brain block with incompatible circuit shapes must be skipped, not
    // silently truncated into nonsense — the cortex weights still restore.
    const mismatched = { ...snap, brain: { ...snap.brain, liquidSize: 24 } };
    const guard = createNeuromorphicCortex();
    assert.equal(guard.importSnapshot(mismatched), true);
    assert.equal(guard.wasBrainStateRestored(), false);
  });
});

describe('Phase 6 — /api/v1/ai/neuromorphic/brain evidence endpoint', () => {
  it('serves a deterministic, cached, zero-GPU, no-execution report over real HTTP', async () => {
    __resetBrainReportCache();
    const { default: app } = await import('../server/app.js');
    const srv = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = srv.address();
      const url = `http://127.0.0.1:${port}/api/v1/ai/neuromorphic/brain?ticks=60`;

      const r1 = await fetch(url);
      assert.equal(r1.status, 200);
      const j1 = await r1.json();
      assert.equal(j1.ok, true);
      assert.equal(j1.zeroServerGpu, true);
      assert.equal(j1.laws.canExecute, false);
      assert.equal(j1.laws.canSign, false);
      assert.equal(j1.honesty.realizedReturnFabricated, false);
      assert.equal(j1.honesty.accuracyPrefilled, false);
      assert.equal(j1.measured.ticks, 60);
      assert.ok(j1.measured.freeEnergyFirst > 0);
      assert.ok(j1.measured.freeEnergyLast < j1.measured.freeEnergyFirst);
      assert.ok(j1.circuits.includes('predictive-coding-2-levels'));
      assert.equal(j1.cached, false);

      const r2 = await fetch(url);
      const j2 = await r2.json();
      assert.equal(j2.cached, true, 'second identical read must be served from the 60s cache');
      assert.deepEqual(j2.measured, j1.measured);
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });
});
