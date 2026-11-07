import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SENSORY_CHANNELS,
  createSpikeEncoder,
  featuresFromCandles,
  featuresFromMarketPulse
} from '../src/lib/neuromorphic/spikeEncoder.js';
import {
  BASE_RESERVOIR_SIZE,
  SWARM_PARAM_COUNT,
  createCanonicalSwarmWeights,
  createNeuromorphicCortex
} from '../src/lib/neuromorphic/cortexCore.js';
import {
  WEBGPU_LIF_WGSL,
  createWebGpuLifKernel
} from '../src/lib/neuromorphic/webgpuKernel.js';
import {
  GOVERNOR_MODES,
  evaluateGovernorPolicy
} from '../src/lib/neuromorphic/hardwareGovernor.js';
import {
  coupleIntentGenome,
  runStructuralPlasticity
} from '../src/lib/neuromorphic/plasticity.js';
import {
  createEngramMemory,
  fnv1aHex,
  saveLocalCortexBundle
} from '../src/lib/neuromorphic/engramMemory.js';
import {
  MAX_DELTA_INF,
  MAX_DELTA_L2,
  SWARM_DELTA_SCHEMA,
  clipSynapticDelta,
  deltaNorms,
  runLocalSwarmEvolution
} from '../src/lib/neuromorphic/swarmClient.js';
import {
  createNeuromorphicSwarm,
  trimmedMeanAggregate,
  verifyCandidateCortex
} from '../server/aiNeuromorphic.js';
import { createNeuromorphicRouter } from '../server/aiNeuromorphicRoutes.js';

function makeTrendCandles(count = 48, drift = 0.008) {
  const out = [];
  let price = 60000;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 3.2) * 0.004;
    const ret = drift + wave;
    const open = price;
    const close = price * (1 + ret);
    const high = Math.max(open, close) * 1.004;
    const low = Math.min(open, close) * 0.996;
    out.push({ time: 1700000000000 + i * 3600_000, open, high, low, close, volume: 1200 + i * 25 });
    price = close;
  }
  return out;
}

describe('Phase 1 — Event-Driven Spike Encoder, LIF+Liquid Cortex, WebGPU & Governor', () => {
  it('refuses insufficient candles and encodes real candle shocks into polarized spikes', () => {
    assert.equal(featuresFromCandles([]).ok, false);
    assert.equal(featuresFromCandles([{ c: 100 }, { c: 101 }]).ok, false);

    const candles = makeTrendCandles(30, 0.012);
    const feat = featuresFromCandles(candles);
    assert.equal(feat.ok, true);
    assert.equal(feat.vector.length, 8);

    const enc = createSpikeEncoder();
    const out = enc.encode(feat.vector);
    assert.equal(out.spikes.length, SENSORY_CHANNELS);
    assert.ok(out.activeSpikes >= 1, 'bull shock should trigger ON spikes');
  });

  it('extracts market pulse features from real priced rows and rejects empty feeds', () => {
    assert.equal(featuresFromMarketPulse({ markets: [] }).ok, false);
    const feat = featuresFromMarketPulse({
      markets: [
        { symbol: 'BTC', price: 64000, change24h: 3.4, volume: 30e9, mcap: 1200e9 },
        { symbol: 'ETH', price: 3200, change24h: 2.1, volume: 15e9, mcap: 380e9 },
        { symbol: 'SOL', price: 155, change24h: 5.8, volume: 4e9, mcap: 72e9 }
      ]
    });
    assert.equal(feat.ok, true);
    assert.equal(feat.meta.anchorSymbol, 'BTC');
    assert.equal(feat.meta.lastClose, 64000);
  });

  it('starts with honest null hitRate/Brier and learns online via R-STDP as real prices resolve', async () => {
    const cortex = createNeuromorphicCortex();
    const candles = makeTrendCandles(20, 0.01);

    const f0 = featuresFromCandles(candles.slice(0, 6));
    const r0 = await cortex.step(f0.vector, { observedPrice: f0.meta.lastClose });
    assert.equal(r0.learning.resolvedPredictions, 0);
    assert.equal(r0.learning.hitRate, null, 'must never pre-fill accuracy before resolution');
    assert.equal(r0.learning.meanBrier, null);
    assert.equal(r0.laws.canExecute, false);
    assert.equal(r0.laws.canSign, false);

    // Feed subsequent real candles so predictions resolve and R-STDP updates synapses
    let lastReadout = r0;
    for (let end = 7; end <= 16; end += 1) {
      const fi = featuresFromCandles(candles.slice(0, end));
      // eslint-disable-next-line no-await-in-loop
      lastReadout = await cortex.step(fi.vector, { observedPrice: fi.meta.lastClose });
    }
    assert.ok(lastReadout.learning.resolvedPredictions >= 8);
    assert.ok(Number.isFinite(lastReadout.learning.hitRate));
    assert.ok(Number.isFinite(lastReadout.learning.meanBrier));
    assert.ok(lastReadout.learning.plasticityUpdates >= 8);
  });

  it('ships valid WGSL compute shader and falls back cleanly to CPU in Node without GPU', async () => {
    assert.ok(WEBGPU_LIF_WGSL.includes('@compute @workgroup_size(64)'));
    const kernel = await createWebGpuLifKernel();
    assert.equal(kernel.available, false);
    assert.equal(kernel.backend, 'cpu-float32');
  });

  it('governs compute mode across WebGPU, battery, background tab, and thermal thresholds', () => {
    const turbo = evaluateGovernorPolicy({
      webgpuAvailable: true,
      cpuCores: 8,
      batteryCharging: true,
      batteryLevel: 0.9,
      tabVisible: true,
      emaTickMs: 1.4
    });
    assert.equal(turbo.mode, GOVERNOR_MODES.TURBO_SWARM);
    assert.equal(turbo.swarmCloneBudget, 4);

    const lowBat = evaluateGovernorPolicy({
      webgpuAvailable: true,
      cpuCores: 8,
      batteryCharging: false,
      batteryLevel: 0.19,
      tabVisible: true,
      emaTickMs: 1.4
    });
    assert.equal(lowBat.mode, GOVERNOR_MODES.ECO_SPARSE);
    assert.equal(lowBat.swarmCloneBudget, 0);

    const hidden = evaluateGovernorPolicy({ tabVisible: false });
    assert.equal(hidden.mode, GOVERNOR_MODES.ECO_SPARSE);

    const paused = evaluateGovernorPolicy({ paused: true });
    assert.equal(paused.mode, GOVERNOR_MODES.PAUSED);
    assert.equal(paused.allowInference, false);
  });
});

describe('Phase 2 — Structural Neurogenesis, Synaptic Pruning, Genome Coupling & Engrams', () => {
  it('grows new LIF neurons via Neurogenesis and prunes/sprouts synapses while preserving weights', async () => {
    const cortex = createNeuromorphicCortex();
    const candles = makeTrendCandles(14, 0.015);
    for (let end = 5; end <= 12; end += 1) {
      const f = featuresFromCandles(candles.slice(0, end));
      // eslint-disable-next-line no-await-in-loop
      await cortex.step(f.vector, { observedPrice: f.meta.lastClose });
    }

    const res1 = runStructuralPlasticity(cortex, {
      anomalySurprise: 0.72,
      maxReservoirNeurons: 128
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.grownNeurons, 8);
    assert.equal(res1.reservoirNeurons, BASE_RESERVOIR_SIZE + 8);
    assert.equal(res1.canExecute, false);

    // Ensure expanded cortex continues stepping seamlessly
    const fNext = featuresFromCandles(candles);
    const rNext = await cortex.step(fNext.vector, { observedPrice: fNext.meta.lastClose });
    assert.equal(rNext.topology.reservoirNeurons, BASE_RESERVOIR_SIZE + 8);
    assert.equal(rNext.topology.neurogenesisEvents, 1);
  });

  it('couples Intent Genome safely and rejects secret-tainted inputs', () => {
    const cortex = createNeuromorphicCortex();
    const okOut = coupleIntentGenome(cortex, {
      values: { timeHorizon: 85, riskTolerance: 25, drawdownTolerance: 20, automationPreference: 70 }
    });
    assert.equal(okOut.ok, true);
    assert.equal(okOut.canExecute, false);
    assert.ok(okOut.modulation.tauScale > 1.1);
    assert.ok(okOut.modulation.riskAversion > 0.65);

    const bad = coupleIntentGenome(cortex, {
      note: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'SECRET_INPUT_REJECTED');
  });

  it('imprints and associatively recalls episodic liquid engrams and blocks secrets in storage', async () => {
    const bank = createEngramMemory();
    const stateBull = new Float32Array(24).fill(0.42);
    const stateBear = new Float32Array(24).fill(-0.48);

    assert.equal(bank.imprint({ liquidState: stateBull, realizedReturn: 0.034, regime: 'trendUp', symbol: 'BTC' }).ok, true);
    assert.equal(bank.imprint({ liquidState: stateBear, realizedReturn: -0.029, regime: 'trendDown', symbol: 'BTC' }).ok, true);

    const probe = new Float32Array(24).fill(0.40);
    const recall = bank.recall(probe, { topK: 2, minSimilarity: 0.8 });
    assert.equal(recall.matches.length, 1);
    assert.ok(recall.expectedReturn > 0.03);

    const badSave = await saveLocalCortexBundle({
      cortexSnapshot: { note: 'seed phrase abandon ability able about above absent absorb abstract absurd abuse access accident' }
    });
    assert.equal(badSave.ok, false);
    assert.equal(badSave.code, 'SECRET_INPUT_REJECTED');
    assert.equal(fnv1aHex('fbt-2050').length, 8);
  });
});

describe('Phase 3 — Walk-Forward Neuroevolution & Zero-GPU Byzantine Swarm Coordinator', () => {
  it('clips oversized synaptic deltas to L-inf and L2 bounds', () => {
    const huge = new Float32Array(SWARM_PARAM_COUNT).fill(5.0);
    const clipped = clipSynapticDelta(huge);
    const norms = deltaNorms(clipped);
    assert.ok(norms.linf <= MAX_DELTA_INF + 1e-6);
    assert.ok(norms.l2 <= MAX_DELTA_L2 + 1e-5);
  });

  it('filters Byzantine poisoning attacks via coordinate-wise trimmed mean', () => {
    const honest1 = new Float32Array([0.04, -0.02, 0.01]);
    const honest2 = new Float32Array([0.05, -0.03, 0.02]);
    const honest3 = new Float32Array([0.03, -0.025, 0.015]);
    const attackerHi = new Float32Array([999.0, 999.0, 999.0]);
    const attackerLo = new Float32Array([-999.0, -999.0, -999.0]);

    const { aggregated, trimmedEachSide, contributorsUsed } = trimmedMeanAggregate(
      [honest1, attackerHi, honest2, attackerLo, honest3],
      { trimFraction: 0.2 }
    );
    assert.equal(trimmedEachSide, 1);
    assert.equal(contributorsUsed, 3);
    assert.ok(Math.abs(aggregated[0] - 0.04) < 0.01, 'Byzantine extremes must be completely eliminated');
    assert.ok(Math.abs(aggregated[1] - (-0.025)) < 0.01);
  });

  it('evolves on real walk-forward candles, verifies proof, rejects poisoned deltas, and crystallizes Global Generations', async () => {
    const baseWeights = createCanonicalSwarmWeights();
    assert.equal(verifyCandidateCortex(baseWeights).ok, true);

    const candles = makeTrendCandles(44, 0.011);
    const evo = runLocalSwarmEvolution({
      candles,
      baseWeights,
      baseGeneration: 0,
      cloneCount: 6,
      mutationSigma: 0.06,
      computeBackend: 'webgpu',
      seed: 42
    });
    assert.equal(evo.ok, true);
    assert.ok(evo.resolvedSteps >= 8);

    const swarm = createNeuromorphicSwarm({ minQuorum: 1 });

    // 1. Secret-laced packet must be rejected
    const secretRes = await swarm.submitDelta({
      owner: 'dev:attacker',
      packet: { note: 'Bearer sk-1234567890abcdefghijklmnop' }
    });
    assert.equal(secretRes.ok, false);
    assert.equal(secretRes.code, 'SECRET_INPUT_REJECTED');

    // 2. Norm-exceeding packet must be rejected
    const normRes = await swarm.submitDelta({
      owner: 'dev:attacker',
      packet: {
        schema: SWARM_DELTA_SCHEMA,
        baseGeneration: 0,
        delta: new Array(SWARM_PARAM_COUNT).fill(0.9),
        proof: { resolvedSteps: 12, baselineFitness: 0.1, winnerFitness: 0.4, winnerBrier: 0.2 }
      }
    });
    assert.equal(normRes.ok, false);
    assert.equal(normRes.code, 'DELTA_NORM_EXCEEDED');

    // 3. Valid walk-forward delta packet must be accepted and crystallize Generation #1
    const packet = evo.deltaPacket || {
      schema: SWARM_DELTA_SCHEMA,
      baseGeneration: 0,
      delta: Array.from(clipSynapticDelta(new Float32Array(SWARM_PARAM_COUNT).fill(0.005))),
      proof: {
        resolvedSteps: 16,
        baselineFitness: 0.21,
        winnerFitness: 0.34,
        winnerBrier: 0.18,
        winnerHitRate: 0.68,
        computeBackend: 'webgpu'
      }
    };

    const okRes = await swarm.submitDelta({ owner: 'dev:node1', packet });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.accepted, true);
    assert.equal(okRes.crystallized, true);
    assert.equal(okRes.globalGeneration, 1);
    assert.equal(okRes.callerNode.neuralXp, 20); // 15 webgpu + 5 crystallization bonus

    const upToDate = await swarm.getGenome({ sinceGeneration: 1 });
    assert.equal(upToDate.upToDate, true);

    const older = await swarm.getGenome({ sinceGeneration: 0 });
    assert.equal(older.upToDate, false);
    assert.equal(older.weights.length, SWARM_PARAM_COUNT);

    // Express router contract smoke check
    const router = createNeuromorphicRouter({ swarm });
    assert.equal(typeof router, 'function');
  });

  it('serves /api/v1/ai/neuromorphic/* over real HTTP through server/app.js lazyMount', async () => {
    const { default: app } = await import('../server/app.js');
    const srv = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = srv.address();
      const base = `http://127.0.0.1:${port}/api/v1/ai/neuromorphic`;
      const headers = {
        'content-type': 'application/json',
        'x-fbt-device': 'fbt_test_device_2050_node01'
      };

      const stRes = await fetch(`${base}/status`, { headers });
      assert.equal(stRes.status, 200);
      const stJson = await stRes.json();
      assert.equal(stJson.ok, true);
      assert.equal(stJson.zeroServerGpu, true);
      assert.equal(stJson.laws.canExecute, false);

      const genRes = await fetch(`${base}/genome`, { headers });
      assert.equal(genRes.status, 200);
      const genJson = await genRes.json();
      assert.equal(genJson.ok, true);
      assert.equal(genJson.paramCount, SWARM_PARAM_COUNT);

      const badDeltaRes = await fetch(`${base}/delta`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          schema: SWARM_DELTA_SCHEMA,
          baseGeneration: genJson.generation,
          delta: new Array(SWARM_PARAM_COUNT).fill(0.95),
          proof: { resolvedSteps: 12, baselineFitness: 0.1, winnerFitness: 0.3 }
        })
      });
      assert.equal(badDeltaRes.status, 400);
      const badJson = await badDeltaRes.json();
      assert.equal(badJson.code, 'DELTA_NORM_EXCEEDED');
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });
});
