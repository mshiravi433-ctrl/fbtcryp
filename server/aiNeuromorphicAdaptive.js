/**
 * FBT NEUROMORPHIC 2050 — PHASE 9: ADAPTIVE ECOSYSTEM EVIDENCE ENDPOINT
 * ===========================================================================
 * The ecosystem runs on the user's device, but its central claim is falsifiable
 * outside the browser and therefore has to be reproducible outside the browser:
 *
 *     "a data-conditioned homeostatic servo stops the LIF reservoir from
 *      saturating, and the profile it picks follows the data, not the hardware."
 *
 *     GET /api/v1/ai/neuromorphic/adaptive
 *
 * What this probe actually does — and does NOT do:
 *   · It runs the **same cortex module** the browser runs (`cortexCore.js`), on a
 *     **synthetic, fixed, seeded** candle fixture, twice: once with the ecosystem
 *     driving synaptic efficacy, once with it statically held at 1 (Phase-6
 *     behaviour). `syntheticDataUsed: true` is reported so nobody mistakes the
 *     fixture for market data.
 *   · Every number in `measured` comes from those two runs: spike counts, firing
 *     rate entropy, the servo's trajectory and the profile decisions. Nothing is
 *     a constant and nothing is pre-filled.
 *   · It never claims the adaptation improves prediction accuracy. Accuracy lives
 *     in the cortex readout, is `null` until a real price resolves a prediction,
 *     and this endpoint does not touch it.
 *   · Deterministic (fixed seed, fixed fixture) and cached for 60s.
 *   · Zero server GPU, zero execution authority.
 */

import { createNeuromorphicCortex } from '../src/lib/neuromorphic/cortexCore.js';
import { featuresFromCandles } from '../src/lib/neuromorphic/spikeEncoder.js';
import {
  ADAPTIVE_SCHEMA,
  DATA_PROFILES,
  classifyDataCondition,
  createAdaptiveEcosystem,
  replayServoCounterfactual
} from '../src/lib/neuromorphic/adaptiveEcosystem.js';
import { evaluateGovernorPolicy } from '../src/lib/neuromorphic/hardwareGovernor.js';

export const NEUROMORPHIC_ADAPTIVE_SCHEMA = 'fbt.neuromorphic.adaptive-endpoint.v1';

const CACHE_TTL_MS = 60_000;
let cache = { at: 0, payload: null, ticks: null };

/** Deterministic synthetic fixture. Synthetic by construction, and labelled as such. */
function syntheticCandles({ count, drift, wave, seed = 12345 }) {
  const out = [];
  let price = 60000;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const close = price * (1 + drift + Math.sin(i / 3.2 + seed) * wave);
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

const FIXTURES = Object.freeze({
  trend: { count: 80, drift: 0.005, wave: 0.004, seed: 0 },
  noisy: { count: 80, drift: 0.0, wave: 0.03, seed: 0 },
  flat: { count: 80, drift: 0.0, wave: 0.0, seed: 0 }
});

const tailMean = (arr, n = 20) => {
  const t = arr.slice(-n);
  return t.length ? t.reduce((a, b) => a + b, 0) / t.length : null;
};
const round = (v, d = 4) => (v === null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(d)));

/**
 * Run one fixture twice (static vs adaptive) and measure both runs.
 * `governorPolicy` is injected so the endpoint can show that the *same* device
 * budget produces different actuator settings on different data.
 */
export async function runAdaptiveFixture(name, fixture, { governorPolicy, reservoirSize = 96 } = {}) {
  const candles = syntheticCandles(fixture);
  const policy = governorPolicy || evaluateGovernorPolicy({
    webgpuAvailable: false,
    cpuCores: 4,
    batteryCharging: true,
    batteryLevel: 0.9,
    tabVisible: true,
    emaTickMs: 2
  });

  async function run(adaptiveOn) {
    const cortex = createNeuromorphicCortex({ reservoirSize, brain: true });
    const ecosystem = createAdaptiveEcosystem({ learningOptIn: true });
    ecosystem.setGovernorPolicy(policy);
    const rates = [];
    const entropies = [];
    const gains = [];
    const profiles = [];
    let last = null;

    for (let end = 10; end <= candles.length; end += 1) {
      const feat = featuresFromCandles(candles.slice(0, end));
      if (!feat.ok) continue;
      const plan = adaptiveOn ? ecosystem.plan() : null;
      if (adaptiveOn) cortex.setSynapticEfficacy(plan.synapticEfficacy);
      // eslint-disable-next-line no-await-in-loop
      last = await cortex.step(feat.vector, {
        observedPrice: feat.meta.lastClose,
        learningEnabled: adaptiveOn ? plan.learnThisTick : true
      });
      if (adaptiveOn) {
        const rep = ecosystem.observe({
          features: feat.vector,
          readout: last,
          staticSpikeBaseline: last.rateCode.spikesWithoutServo
        });
        profiles.push(rep.profile);
      }
      rates.push(last.rateCode.rate);
      entropies.push(last.rateCode.firingRateEntropy);
      gains.push(last.rateCode.synapticEfficacy);
    }

    const report = adaptiveOn ? ecosystem.report() : null;
    return {
      ticks: rates.length,
      tailRate: round(tailMean(rates)),
      tailEntropy: round(tailMean(entropies)),
      tailEfficacy: round(tailMean(gains)),
      saturatedTicks: rates.filter((r) => r >= 0.95).length,
      silentTicks: rates.filter((r) => r <= 0.001).length,
      rates,
      entropies,
      gains,
      profile: report?.profile || null,
      profileReason: report?.reason || null,
      condition: report?.condition || null,
      scores: report?.scores || null,
      actuators: report?.actuators || null,
      decision: last?.brain?.basalGanglia?.action || null,
      regime: last?.dominantRegime || null,
      /* The count of how often the chosen profile changed — a controller that
       * flips every tick is oscillating, not adapting. */
      profileSwitches: profiles.reduce(
        (n, p, i) => (i > 0 && p !== profiles[i - 1] ? n + 1 : n),
        0
      )
    };
  }

  const staticRun = await run(false);
  const adaptiveRun = await run(true);

  return {
    fixture: name,
    seriesKind: 'synthetic',
    reservoirNeurons: reservoirSize,
    static: staticRun,
    adaptive: adaptiveRun,
    /* The headline measurement, computed from the two runs above. */
    delta: {
      tailRatePctPoints: staticRun.tailRate !== null && adaptiveRun.tailRate !== null
        ? round((staticRun.tailRate - adaptiveRun.tailRate) * 100, 2)
        : null,
      saturatedTicksRemoved: staticRun.saturatedTicks - adaptiveRun.saturatedTicks,
      tailEntropyChange: staticRun.tailEntropy !== null && adaptiveRun.tailEntropy !== null
        ? round(adaptiveRun.tailEntropy - staticRun.tailEntropy)
        : null,
      profileChanged: staticRun.profile !== adaptiveRun.profile
    }
  };
}

/**
 * Deterministic adaptive-ecosystem evidence report.
 * @param {{ ticks?: number, now?: () => number }} args  `ticks` is accepted for
 *   route-symmetry with the other probes; the fixtures are fixed-length.
 */
export async function getAdaptiveReport({ now = () => Date.now() } = {}) {
  const ts = now();
  if (cache.payload && ts - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true, at: ts };
  }

  const ecoPolicy = evaluateGovernorPolicy({
    webgpuAvailable: false,
    cpuCores: 4,
    batteryCharging: true,
    batteryLevel: 0.9,
    tabVisible: true,
    emaTickMs: 2
  });

  const results = {};
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    // eslint-disable-next-line no-await-in-loop
    results[name] = await runAdaptiveFixture(name, fixture, { governorPolicy: ecoPolicy });
  }

  /*
   * The classifier must be a function of the measurements, and it must be
   * demonstrable that it is: feed it the two extremes by hand and check the
   * profiles differ. This is a self-test of the mapping, not a claim about data.
   */
  const classifierSelfTest = [
    { label: 'decided-and-predictable', input: { ticks: 60, surprise: 0.2, decisionMargin: 0.85 } },
    { label: 'undecided', input: { ticks: 60, surprise: 0.12, decisionMargin: 0.05 } },
    { label: 'not-predictable', input: { ticks: 60, surprise: 0.9, decisionMargin: 0.9 } },
    { label: 'partial', input: { ticks: 60, surprise: 0.25, decisionMargin: 0.45 } },
    { label: 'cold', input: { ticks: 0 } }
  ].map(({ label, input }) => {
    const out = classifyDataCondition(input);
    return { label, input, profile: out.profile, reason: out.reason };
  });

  /* Counterfactual: replay the measured spike counts of the static run through a
   * fresh servo. `isConstant` is the check that the controller is not a constant. */
  const counterfactual = replayServoCounterfactual(
    results.trend.static.rates.map((r) => Math.round(r * 96)),
    96
  );

  const payload = {
    ok: true,
    schema: NEUROMORPHIC_ADAPTIVE_SCHEMA,
    ecosystemSchema: ADAPTIVE_SCHEMA,
    zeroServerGpu: true,
    deviceCompute: true,
    syntheticDataUsed: true,
    profiles: Object.values(DATA_PROFILES),
    fixtures: results,
    classifierSelfTest,
    counterfactual: {
      target: 'the measured spike counts of this endpoint\'s own static trend run',
      ticks: counterfactual.ticks,
      meanGain: counterfactual.meanGain,
      minGain: counterfactual.minGain,
      maxGain: counterfactual.maxGain,
      gainSpread: counterfactual.gainSpread,
      suppressedTicks: counterfactual.suppressedTicks,
      isConstant: counterfactual.isConstant,
      note: counterfactual.note
    },
    actuators: [
      'homeostatic-synaptic-efficacy-servo',
      'data-conditioned-reservoir-growth-cap',
      'data-conditioned-learning-duty-cycle',
      'liquid-time-constant-tilt'
    ],
    honesty: {
      syntheticFixture: true,
      accuracyClaimed: false,
      realisedReturnUsed: false,
      profileHasHysteresis: true,
      note:
        'Both runs use this repo\'s own cortex on a fixed synthetic fixture. The endpoint measures firing-rate control and profile selection. It makes no claim about prediction accuracy or profitability, and hitRate/Brier stay null because no real price resolved a prediction here.'
    },
    laws: {
      canExecute: false,
      canSign: false,
      canMoveFunds: false,
      zeroServerGpu: true
    },
    at: ts
  };

  cache = { at: ts, payload };
  return { ...payload, cached: false };
}

/** Test hook: forget the cached probe so a test can observe a cold run. */
export function __resetAdaptiveReportCache() {
  cache = { at: 0, payload: null };
}
