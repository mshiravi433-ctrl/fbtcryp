/**
 * PHASE 9 — ADAPTIVE INTELLIGENCE ECOSYSTEM: BEHAVIOURAL CONTRACT TESTS
 * =========================================================================
 * These tests assert *mechanisms*, not marketing. Each one fails if the thing it
 * names stops behaving like the control system it claims to be:
 *
 *   · the firing-rate servo must actually suppress a saturated reservoir, and must
 *     not be a constant (a constant is not a controller)
 *   · the servo must be stable: it may not oscillate between silent and saturated
 *   · the data profile must be a function of measured telemetry, and must follow
 *     the data rather than the device
 *   · the same device budget must produce different actuator settings on
 *     different data — that is the whole point of the phase
 *   · the learning budget must be a duty cycle, must respect consent, and must
 *     never report learning it did not spend
 *   · `adaptive:false` must reproduce Phase-6 behaviour exactly (A/B integrity)
 *   · before any observation every number must be null, never a fabricated 0
 *   · the HTTP probe must be deterministic, cached, honest about synthetic data
 *     and must keep the no-execution wall
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTUATOR_BOUNDS,
  ADAPTIVE_SCHEMA,
  CONDITION_RULES,
  DATA_PROFILES,
  PROFILE_CODES,
  SERVO_DEFAULTS,
  classifyDataCondition,
  createAdaptiveEcosystem,
  createDataConditioner,
  createRateServo,
  deriveActuators,
  replayServoCounterfactual
} from '../src/lib/neuromorphic/adaptiveEcosystem.js';
import { createNeuromorphicCortex } from '../src/lib/neuromorphic/cortexCore.js';
import { featuresFromCandles } from '../src/lib/neuromorphic/spikeEncoder.js';
import { evaluateGovernorPolicy } from '../src/lib/neuromorphic/hardwareGovernor.js';
import {
  __resetAdaptiveReportCache,
  getAdaptiveReport,
  runAdaptiveFixture
} from '../server/aiNeuromorphicAdaptive.js';

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

function series(count, drift, wave, seed = 0) {
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

const TURBO_POLICY = evaluateGovernorPolicy({
  webgpuAvailable: true,
  cpuCores: 8,
  batteryCharging: true,
  batteryLevel: 0.9,
  tabVisible: true,
  emaTickMs: 1.4
});

const ECO_POLICY = evaluateGovernorPolicy({
  webgpuAvailable: false,
  cpuCores: 2,
  batteryCharging: false,
  batteryLevel: 0.19,
  tabVisible: true,
  emaTickMs: 1.4
});

const tailMean = (arr, n = 20) => {
  const t = arr.slice(-n);
  return t.reduce((a, b) => a + b, 0) / t.length;
};

/** Run the real cortex, optionally through the real ecosystem, and collect telemetry. */
async function runCortex({ candles, adaptiveOn, governorPolicy = TURBO_POLICY, reservoirSize = 96 }) {
  const cortex = createNeuromorphicCortex({ reservoirSize, brain: true });
  const ecosystem = createAdaptiveEcosystem({ learningOptIn: true });
  ecosystem.setGovernorPolicy(governorPolicy);
  const rates = [];
  const entropies = [];
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
  }

  return { cortex, ecosystem, rates, entropies, profiles, last, report: ecosystem.report() };
}

/* ── 1. The servo ─────────────────────────────────────────────────────────── */

describe('Phase 9 — homeostatic firing-rate servo', () => {
  it('drives gain down on a saturated input and up on a silent one', () => {
    const saturated = createRateServo();
    const silent = createRateServo();
    for (let i = 0; i < 20; i += 1) {
      saturated.step(96, 96);
      silent.step(0, 96);
    }
    assert.ok(saturated.gain() < 0.25, `saturated gain should collapse, got ${saturated.gain()}`);
    // A silent network is allowed to recover its efficacy — the servo is
    // two-sided. It must not be pinned to the bottom forever.
    assert.ok(silent.gain() > SATURATED_EPS, `silent gain should recover, got ${silent.gain()}`);
    assert.ok(silent.gain() <= 1, 'gain may never exceed the untransformed genome');
  });

  it('is not a constant controller (a constant is not a controller)', () => {
    const servo = createRateServo();
    const gains = [];
    for (const count of [96, 96, 80, 60, 30, 15, 10, 8, 8, 8, 8, 8, 8, 8]) {
      gains.push(servo.step(count, 96).gain);
    }
    const spread = Math.max(...gains) - Math.min(...gains);
    assert.ok(spread > 0.2, `servo output barely moved (spread ${spread})`);
    assert.equal(new Set(gains).size > 3, true, 'servo must produce more than three distinct outputs');
  });

  it('stays inside its bounds for extreme and invalid inputs', () => {
    const servo = createRateServo();
    for (const bad of [-5, 0, 1e9, NaN, undefined, 'x', null]) {
      const out = servo.step(bad, 96);
      assert.ok(out.gain >= ACTUATOR_BOUNDS.gainMin - 1e-9, `gain below floor on input ${String(bad)}`);
      assert.ok(out.gain <= ACTUATOR_BOUNDS.gainMax + 1e-9, `gain above ceiling on input ${String(bad)}`);
      assert.ok(Number.isFinite(out.gain));
    }
    // Zero-size reservoir must not divide by zero.
    const zero = servo.step(5, 0);
    assert.ok(Number.isFinite(zero.rate));
  });

  it('counts saturation and silence as measured events, not opinions', () => {
    const servo = createRateServo();
    servo.step(96, 96);   // saturated
    servo.step(96, 96);   // saturated
    servo.step(0, 96);    // silent
    servo.step(20, 96);   // neither
    const stats = servo.stats();
    assert.equal(stats.saturationTicks, 2);
    assert.equal(stats.silentTicks, 1);
    assert.equal(stats.ticks, 4);
    assert.ok(stats.meanAbsError > 0);
  });

  it('reports null (not zero) before the first tick', () => {
    const stats = createRateServo().stats();
    assert.equal(stats.lastRate, null);
    assert.equal(stats.meanAbsError, null);
    assert.equal(stats.ticks, 0);
  });

  it('reset returns the servo to the untransformed genome', () => {
    const servo = createRateServo();
    for (let i = 0; i < 10; i += 1) servo.step(96, 96);
    assert.ok(servo.gain() < 1);
    servo.reset();
    assert.equal(servo.gain(), SERVO_DEFAULTS.gainMax);
    assert.equal(servo.stats().ticks, 0);
  });
});

describe('Phase 9 — the servo is rate limited, not a bang-bang switch', () => {
  it('never moves efficacy by more than e^maxLogStep in one tick', () => {
    const servo = createRateServo();
    let previous = servo.gain();
    for (const count of [96, 96, 96, 0, 96, 0, 96]) {
      servo.step(count, 96);
      // Compare the unrounded value: `step()` returns gain to 4 dp for display,
      // and rounding the *previous* term would itself manufacture a violation.
      const current = servo.gain();
      const ratio = current / previous;
      assert.ok(
        ratio <= Math.exp(SERVO_DEFAULTS.maxLogStep) + 1e-9,
        `step of ${ratio.toFixed(3)}× exceeded the rate limit`
      );
      assert.ok(
        ratio >= Math.exp(-SERVO_DEFAULTS.maxLogStep) - 1e-9,
        `step of ${ratio.toFixed(3)}× exceeded the rate limit downwards`
      );
      previous = current;
    }
  });

  it('takes several ticks to reach the floor instead of slamming there in one', () => {
    const servo = createRateServo();
    const first = servo.step(96, 96);
    assert.ok(first.gain > 0.4, `first saturated tick already at ${first.gain}`);
    assert.equal(first.rateLimited, true, 'the first step must be the limited one');
    for (let i = 0; i < 30; i += 1) servo.step(96, 96);
    assert.ok(servo.gain() < 0.1, 'sustained saturation must still reach the floor');
  });

  it('is stable rather than oscillating on an alternating rate', () => {
    const servo = createRateServo();
    const gains = [];
    for (let i = 0; i < 40; i += 1) gains.push(servo.step(i % 2 ? 96 : 0, 96).gain);
    const tail = gains.slice(-20);
    const spread = Math.max(...tail) - Math.min(...tail);
    assert.ok(spread < 0.25, `servo oscillates on an alternating input (spread ${spread})`);
  });
});

const SATURATED_EPS = 0.005;

/* ── 2. Closed loop against the real cortex ───────────────────────────────── */

describe('Phase 9 — the servo fixes the measured saturation defect', () => {
  it('static Phase-6 dynamics saturate; the ecosystem does not', async () => {
    const candles = series(80, 0.005, 0.004);
    const staticRun = await runCortex({ candles, adaptiveOn: false });
    const adaptiveRun = await runCortex({ candles, adaptiveOn: true });

    // The defect: without feedback the reservoir fires essentially every neuron.
    assert.ok(
      tailMean(staticRun.rates) > 0.85,
      `fixture no longer reproduces the saturation defect (tail ${tailMean(staticRun.rates)})`
    );
    // The fix: bounded, non-saturated firing under the same inputs.
    assert.ok(
      tailMean(adaptiveRun.rates) < 0.4,
      `adaptive tail rate still too high: ${tailMean(adaptiveRun.rates)}`
    );
    // And not by silencing the network — that would be the opposite failure.
    assert.ok(
      tailMean(adaptiveRun.rates) > 0.02,
      `adaptive run collapsed to near-silence: ${tailMean(adaptiveRun.rates)}`
    );
  });

  it('removes saturated ticks without creating a silent network', async () => {
    const candles = series(80, 0.005, 0.004);
    const staticRun = await runCortex({ candles, adaptiveOn: false });
    const adaptiveRun = await runCortex({ candles, adaptiveOn: true });

    const staticSat = staticRun.rates.filter((r) => r >= 0.95).length;
    const adaptiveSat = adaptiveRun.rates.filter((r) => r >= 0.95).length;
    const adaptiveSilent = adaptiveRun.rates.filter((r) => r <= 0.001).length;

    assert.ok(staticSat > 40, `static run should be mostly saturated (got ${staticSat})`);
    assert.equal(adaptiveSat, 0, `adaptive run still has ${adaptiveSat} saturated ticks`);
    assert.ok(adaptiveSilent <= 2, `adaptive run has ${adaptiveSilent} silent ticks`);
  });

  it('is stable — it does not oscillate between saturated and silent', async () => {
    const candles = series(80, 0.005, 0.004);
    const { rates } = await runCortex({ candles, adaptiveOn: true });
    // Count direction reversals in the tail: a stable controller settles, an
    // unstable one keeps flipping. Allow normal jitter, reject a limit cycle.
    const tail = rates.slice(-25);
    let reversals = 0;
    for (let i = 2; i < tail.length; i += 1) {
      const a = tail[i - 1] - tail[i - 2];
      const b = tail[i] - tail[i - 1];
      if (a * b < 0 && Math.abs(a) > 0.08 && Math.abs(b) > 0.08) reversals += 1;
    }
    assert.ok(reversals <= 4, `servo limit-cycling (${reversals} large reversals in 25 ticks)`);
  });

  it('reports the counterfactual spike count measured on the same tick', async () => {
    const candles = series(50, 0.005, 0.004);
    const { last } = await runCortex({ candles, adaptiveOn: true });
    const rc = last.rateCode;
    assert.equal(typeof rc.spikesWithoutServo, 'number');
    assert.ok(rc.spikesWithoutServo >= rc.spikes, 'removing the servo cannot reduce spikes');
    assert.equal(rc.suppressed, rc.spikesWithoutServo - rc.spikes);
    assert.ok(rc.synapticEfficacy > 0 && rc.synapticEfficacy <= 1);
  });
});

/* ── 3. A/B integrity ─────────────────────────────────────────────────────── */

describe('Phase 9 — adaptive:false reproduces Phase-6 dynamics exactly', () => {
  it('produces bit-identical readouts with the ecosystem disabled', async () => {
    const candles = series(40, 0.004, 0.004);
    async function run(adaptive) {
      const cortex = createNeuromorphicCortex({ reservoirSize: 96, brain: true, adaptive });
      let last = null;
      for (let end = 10; end <= 34; end += 1) {
        const feat = featuresFromCandles(candles.slice(0, end));
        // eslint-disable-next-line no-await-in-loop
        last = await cortex.step(feat.vector, { observedPrice: feat.meta.lastClose, learningEnabled: true });
      }
      return last;
    }
    /*
     * Compare only the *dynamics*, not the whole readout: `latencyMs` is wall-clock
     * and can never be bit-identical across two runs. Everything the simulation
     * computes has to be.
     */
    const dynamics = (r) => ({
      spikes: r.rateCode.spikes,
      spikesWithoutServo: r.rateCode.spikesWithoutServo,
      efficacy: r.rateCode.synapticEfficacy,
      entropy: r.rateCode.firingRateEntropy,
      drive: r.directionalDrive,
      volatility: r.volatilityForecast,
      regime: r.regimeProbs,
      surprise: r.anomalySurprise,
      liquid: r.liquidPreview,
      membrane: r.membranePreview,
      bg: r.brain.basalGanglia.action,
      freeEnergy: r.brain.prediction.freeEnergy
    });

    const a = await run(false);
    const b = await run(false);
    assert.deepEqual(dynamics(a), dynamics(b), 'two identical static runs must be bit-identical');

    const on = await run(true);
    // `adaptive:true` but with the servo never written: efficacy stays 1 (identity),
    // so the run must be identical as well. This is the A/B integrity guarantee.
    assert.equal(a.rateCode.synapticEfficacy, 1);
    assert.equal(on.rateCode.synapticEfficacy, 1);
    assert.deepEqual(dynamics(a), dynamics(on));
  });

  it('refuses an efficacy outside the physiological envelope', () => {
    const cortex = createNeuromorphicCortex({ reservoirSize: 96 });
    assert.equal(cortex.setSynapticEfficacy(5), 1, 'cannot amplify past the genome');
    assert.equal(cortex.setSynapticEfficacy(-3), 0.02, 'cannot silence the network completely');
    assert.equal(cortex.setSynapticEfficacy(NaN), 1, 'garbage in → identity, not zero');
    // Disabling adaptation must always restore the identity.
    cortex.setSynapticEfficacy(0.1);
    cortex.setAdaptiveEnabled(false);
    assert.equal(cortex.getSynapticEfficacy(), 1);
  });
});

/* ── 4. Conditioner + classifier ──────────────────────────────────────────── */

describe('Phase 9 — data conditioning', () => {
  it('reports null for every condition before the first observation', () => {
    const c = createDataConditioner().current();
    assert.equal(c.ticks, 0);
    for (const key of ['volatility', 'surprise', 'regimeEntropy', 'decisionMargin', 'signalToNoise']) {
      assert.equal(c[key], null, `${key} must be null before any observation`);
    }
  });

  it('is causal: the first observation has no displacement to measure', () => {
    const cond = createDataConditioner();
    const first = cond.observe(new Float32Array([0.5, 0.1, -0.2, 0, 0, 0, 0, 0]), { anomalySurprise: 0 });
    assert.equal(first.volatility, null, 'no previous vector ⇒ no volatility');
    const second = cond.observe(new Float32Array([0.6, 0.1, -0.2, 0, 0, 0, 0, 0]), { anomalySurprise: 0.2 });
    assert.ok(second.volatility > 0, 'second observation has a real displacement');
    assert.ok(second.surprise > 0);
  });

  it('scores a coherent vector above a pure-noise vector on signal-to-noise', () => {
    const coherent = createDataConditioner();
    const noisy = createDataConditioner();
    coherent.observe(new Float32Array([0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]), {});
    noisy.observe(new Float32Array([0.9, -0.9, 0.9, -0.9, 0.9, -0.9, 0.9, -0.9]), {});
    assert.ok(
      coherent.current().signalToNoise > noisy.current().signalToNoise,
      'a coherent stream must outscore an alternating one'
    );
  });

  it('classifies from measured telemetry and names the reason', () => {
    const cases = [
      [{ ticks: 60, surprise: 0.2, decisionMargin: 0.85 }, DATA_PROFILES.EXPLOIT_FULL, 'DECIDED_AND_PREDICTABLE'],
      [{ ticks: 60, surprise: 0.2, decisionMargin: 0.4 }, DATA_PROFILES.CONSOLIDATE, 'STRUCTURE_PARTIAL'],
      [{ ticks: 60, surprise: 0.2, decisionMargin: 0.05 }, DATA_PROFILES.HOLD_SPARSE, 'DECISION_UNDECIDED'],
      [{ ticks: 60, surprise: 0.9, decisionMargin: 0.9 }, DATA_PROFILES.HOLD_SPARSE, 'SURPRISE_ABOVE_CEILING']
    ];
    for (const [condition, profile, reason] of cases) {
      const out = classifyDataCondition(condition);
      assert.equal(out.profile, profile, `wrong profile for surprise=${condition.surprise} margin=${condition.decisionMargin}`);
      assert.equal(out.reason, reason);
      assert.equal(out.ready, true);
      assert.ok(PROFILE_CODES.includes(out.profile));
    }
  });

  it('says COLD — not a neutral zero — when there is no observation', () => {
    const out = classifyDataCondition({ ticks: 0 });
    assert.equal(out.status, 'COLD');
    assert.equal(out.ready, false);
    assert.equal(out.reason, 'NO_OBSERVATION_YET');
    assert.equal(out.scores.predictability, null);
    assert.equal(out.profile, DATA_PROFILES.HOLD_SPARSE);
  });

  it('reports how far each decision sits from flipping (hysteresis)', () => {
    const firm = classifyDataCondition({ ticks: 60, surprise: 0.1, decisionMargin: 0.9 });
    const marginal = classifyDataCondition({ ticks: 60, surprise: 0.1, decisionMargin: 0.705 });
    assert.ok(firm.scores.distanceToExploit > marginal.scores.distanceToExploit);
    assert.ok(marginal.scores.distanceToExploit < 0.1, 'a marginal call must report a small distance');
  });

  it('hysteresis holds a profile against a measurement sitting in the band', () => {
    // Just outside the exploit threshold, new profile would be CONSOLIDATE; but
    // while EXPLOIT_FULL is in force the threshold is relaxed by the band.
    const condition = { ticks: 60, surprise: 0.1, decisionMargin: CONDITION_RULES.marginExploit - CONDITION_RULES.hysteresis / 2 };
    const fresh = classifyDataCondition(condition, null);
    const held = classifyDataCondition(condition, DATA_PROFILES.EXPLOIT_FULL);
    assert.equal(fresh.profile, DATA_PROFILES.CONSOLIDATE);
    assert.equal(held.profile, DATA_PROFILES.EXPLOIT_FULL);
    assert.equal(held.rules.hysteresis, CONDITION_RULES.hysteresis);
  });
});

describe('Phase 9 — dwell control against profile flapping', () => {
  const decisive = { ticks: 60, surprise: 0.2, decisionMargin: 0.9 };
  const partial = { ticks: 60, surprise: 0.2, decisionMargin: 0.4 };

  it('refuses a replacement until the current profile has served its dwell', () => {
    const out = classifyDataCondition(decisive, DATA_PROFILES.CONSOLIDATE, { ticksInProfile: 3 });
    assert.equal(out.profile, DATA_PROFILES.CONSOLIDATE, 'must hold the profile in force');
    assert.equal(out.held, true);
    assert.equal(out.pendingProfile, DATA_PROFILES.EXPLOIT_FULL, 'the candidate must be published, not hidden');
    assert.equal(out.pendingReason, 'DECIDED_AND_PREDICTABLE');
    assert.equal(out.minDwellTicks, CONDITION_RULES.minDwellTicks);
  });

  it('allows the replacement once the dwell has been served', () => {
    const out = classifyDataCondition(decisive, DATA_PROFILES.CONSOLIDATE, {
      ticksInProfile: CONDITION_RULES.minDwellTicks
    });
    assert.equal(out.profile, DATA_PROFILES.EXPLOIT_FULL);
    assert.equal(out.held, false);
    assert.equal(out.pendingProfile, null);
  });

  it('never blocks the first decision, and never blocks a COLD report', () => {
    assert.equal(classifyDataCondition(decisive, null, { ticksInProfile: 0 }).profile, DATA_PROFILES.EXPLOIT_FULL);
    const cold = classifyDataCondition({ ticks: 0 }, null, { ticksInProfile: 0 });
    assert.equal(cold.status, 'COLD');
  });

  it('flapping is measured, and dwell reduces it on the real noisy fixture', async () => {
    const candles = series(80, 0.0, 0.03);
    const { report } = await runCortex({ candles, adaptiveOn: true });
    // Without dwell this fixture flipped 6 times in 71 ticks. With dwell it must
    // be a handful, and every held tick must be accounted for.
    assert.ok(report.dwell.profileSwitches <= 4, `still flapping: ${report.dwell.profileSwitches} switches`);
    assert.equal(report.dwell.minDwellTicks, CONDITION_RULES.minDwellTicks);
    assert.equal(
      report.dwell.profileSwitches === 0 ? report.dwell.heldTicks === 0 : true,
      true,
      'a run with no switches cannot have held ticks'
    );
    // The trend fixture is unambiguous: it must never be suppressed at all.
    const trend = await runCortex({ candles: series(80, 0.005, 0.004), adaptiveOn: true });
    assert.equal(trend.report.dwell.profileSwitches, 0);
    assert.equal(trend.report.dwell.heldTicks, 0);
  });
});

/* ── 5. Profile follows the data, not the device ──────────────────────────── */

describe('Phase 9 — the profile follows the data, not the hardware', () => {
  it('the same device budget yields different actuators on different data', () => {
    const decided = deriveActuators({
      profile: DATA_PROFILES.EXPLOIT_FULL,
      governor: TURBO_POLICY
    });
    const held = deriveActuators({
      profile: DATA_PROFILES.HOLD_SPARSE,
      governor: TURBO_POLICY
    });
    assert.equal(decided.budgetCap, held.budgetCap, 'same device in both cases');
    assert.ok(decided.reservoirCap > held.reservoirCap, 'data must change the growth budget');
    assert.ok(decided.learningDuty > held.learningDuty, 'data must change the learning budget');
    assert.notEqual(decided.tauScale, held.tauScale, 'data must change the integration horizon');
    // Sparse data must never starve learning completely: that is not adapting.
    assert.ok(held.learningDuty >= ACTUATOR_BOUNDS.dutyMin);
  });

  it('never exceeds the device ceiling, whatever the data says', () => {
    for (const gov of [TURBO_POLICY, ECO_POLICY]) {
      for (const profile of PROFILE_CODES) {
        const a = deriveActuators({ profile, governor: gov });
        assert.ok(
          a.reservoirCap <= gov.maxReservoirNeurons,
          `${profile}: cap ${a.reservoirCap} exceeded device ceiling ${gov.maxReservoirNeurons}`
        );
        assert.ok(a.learningDuty <= 1 && a.learningDuty >= 0);
      }
    }
  });

  it('the governor vetoes — the ecosystem can lower a budget but never raise one', () => {
    const paused = deriveActuators({ profile: DATA_PROFILES.EXPLOIT_FULL, governor: ECO_POLICY });
    assert.equal(paused.learningDuty, 0, 'ECO withholds plasticity; data cannot overrule it');
    assert.ok(paused.rationale.includes('GOVERNOR_WITHHOLDS_PLASTICITY'));
    assert.equal(paused.reservoirCap, ACTUATOR_BOUNDS.reservoirCapMin);
  });

  it('reports why the governor paused instead of pretending to allocate', () => {
    const pausedPolicy = evaluateGovernorPolicy({ paused: true });
    const a = deriveActuators({ profile: DATA_PROFILES.EXPLOIT_FULL, governor: pausedPolicy });
    assert.equal(a.learningDuty, 0);
    assert.equal(a.reservoirCapReason, 'GOVERNOR_PAUSED');
    assert.deepEqual(a.rationale, ['GOVERNOR_PAUSED']);
  });

  it('a real ECO device run learns less than a real TURBO device run', async () => {
    const candles = series(70, 0.005, 0.004);
    const turbo = await runCortex({ candles, adaptiveOn: true, governorPolicy: TURBO_POLICY });
    const eco = await runCortex({ candles, adaptiveOn: true, governorPolicy: ECO_POLICY });
    assert.ok(
      turbo.report.learning.ticksSpent > eco.report.learning.ticksSpent,
      `TURBO spent ${turbo.report.learning.ticksSpent}, ECO spent ${eco.report.learning.ticksSpent}`
    );
    assert.equal(eco.report.learning.dutyCyclePct, 0, 'ECO must report a zero duty cycle, not a small one');
  });
});

/* ── 6. Learning budget & consent ─────────────────────────────────────────── */

describe('Phase 9 — the learning budget is a duty cycle with consent', () => {
  it('spends roughly the declared fraction of ticks', () => {
    const eco = createAdaptiveEcosystem({ learningOptIn: true });
    eco.setGovernorPolicy(TURBO_POLICY);
    let learned = 0;
    // Force CONSOLIDATE (duty 0.55) by looking at a partial-structure condition.
    for (let i = 0; i < 200; i += 1) {
      const plan = eco.plan();
      if (plan.learnThisTick) learned += 1;
      eco.observe({
        features: new Float32Array([0.3, 0.2, 0.1, 0, 0, 0, 0, 0]),
        readout: {
          anomalySurprise: 0.3,
          regimeProbs: { trendUp: 0.4, trendDown: 0.3, meanRevert: 0.2, shock: 0.1 },
          brain: { basalGanglia: { margin: 0.4, action: 'FLAT' } },
          spikes: { reservoirActive: 20 },
          topology: { reservoirNeurons: 96 }
        }
      });
    }
    const duty = eco.report().learning.dutyCyclePct / 100;
    assert.ok(duty > 0 && duty < 1, `expected a partial duty cycle, got ${duty}`);
    assert.ok(learned > 0, 'a partial duty cycle must still learn sometimes');
    assert.ok(learned < 200, 'a partial duty cycle must not learn every tick');
  });

  it('spends nothing when consent is withdrawn and says so', () => {
    const eco = createAdaptiveEcosystem({ learningOptIn: false });
    eco.setGovernorPolicy(TURBO_POLICY);
    for (let i = 0; i < 20; i += 1) {
      const plan = eco.plan();
      assert.equal(plan.learnThisTick, false);
    }
    const report = eco.observe({
      features: new Float32Array([0.5, 0, 0, 0, 0, 0, 0, 0]),
      readout: {
        anomalySurprise: 0.2,
        regimeProbs: { trendUp: 0.7, trendDown: 0.1, meanRevert: 0.1, shock: 0.1 },
        brain: { basalGanglia: { margin: 0.8, action: 'LONG' } },
        spikes: { reservoirActive: 12 },
        topology: { reservoirNeurons: 96 }
      }
    });
    assert.equal(report.learning.optIn, false);
    assert.equal(report.learning.ticksSpent, 0);
    assert.equal(report.learning.dutyCyclePct, 0);
  });

  it('counts growth ticks only when the data and the governor both allow growth', () => {
    const eco = createAdaptiveEcosystem({ learningOptIn: true });
    eco.setGovernorPolicy(ECO_POLICY); // allowNeurogenesis false
    for (let i = 0; i < 10; i += 1) {
      eco.plan();
      eco.observe({
        features: new Float32Array([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]),
        readout: {
          anomalySurprise: 0.05,
          regimeProbs: { trendUp: 0.9, trendDown: 0.03, meanRevert: 0.05, shock: 0.02 },
          brain: { basalGanglia: { margin: 0.9, action: 'LONG' } },
          spikes: { reservoirActive: 3 },
          topology: { reservoirNeurons: 96 }
        }
      });
    }
    assert.equal(eco.report().learning.growthTicksAllowed, 0);
  });
});

/* ── 7. Honesty & laws ────────────────────────────────────────────────────── */

describe('Phase 9 — honesty contract', () => {
  it('the first report is COLD with null conditions and the no-execution laws', () => {
    const eco = createAdaptiveEcosystem();
    const report = eco.observe({
      features: new Float32Array([0.4, 0, 0, 0, 0, 0, 0, 0]),
      readout: { anomalySurprise: 0.1, spikes: { reservoirActive: 10 }, topology: { reservoirNeurons: 96 } }
    });
    // One observation in: surprise is measured, but the first tick has no
    // displacement, so volatility is still honestly null.
    assert.equal(report.schema, ADAPTIVE_SCHEMA);
    assert.equal(report.condition.volatility, null);
    assert.equal(typeof report.condition.surprise, 'number');
    assert.equal(report.laws.canExecute, false);
    assert.equal(report.laws.canSign, false);
    assert.equal(report.laws.canMoveFunds, false);
    assert.equal(report.laws.deviceOnly, true);

    const cold = createAdaptiveEcosystem().report();
    assert.equal(cold, null, 'a report before any tick must be null, not a filled object');
  });

  it('never reports an efficiency saving it did not measure', () => {
    const eco = createAdaptiveEcosystem();
    eco.setGovernorPolicy(TURBO_POLICY);
    const noBaseline = eco.observe({
      features: new Float32Array([0.4, 0, 0, 0, 0, 0, 0, 0]),
      readout: { anomalySurprise: 0.1, spikes: { reservoirActive: 10 }, topology: { reservoirNeurons: 96 } }
    });
    assert.equal(noBaseline.efficiency.spikeSavingPct, null, 'no baseline ⇒ no saving percentage');
    assert.match(noBaseline.efficiency.statement, /no static baseline/i);

    const withBaseline = eco.observe({
      features: new Float32Array([0.45, 0, 0, 0, 0, 0, 0, 0]),
      readout: { anomalySurprise: 0.1, spikes: { reservoirActive: 10 }, topology: { reservoirNeurons: 96 } },
      staticSpikeBaseline: 90
    });
    assert.ok(withBaseline.efficiency.spikeSavingPct > 50);
    assert.match(withBaseline.efficiency.statement, /measured/i);
  });

  it('the counterfactual replay is not a constant controller', () => {
    const replay = replayServoCounterfactual(Array.from({ length: 40 }, () => 96), 96);
    assert.ok(replay.isConstant === false, 'servo replay collapsed to a constant');
    assert.ok(replay.suppressedTicks === replay.ticks, 'a fully saturated series must be suppressed every tick');
    assert.ok(replay.maxGain > replay.minGain);
    assert.match(replay.note, /does not re-simulate/i);
  });

  it('exposes the constants it actually uses', () => {
    const eco = createAdaptiveEcosystem();
    const c = eco.constants();
    assert.equal(c.targetRate, SERVO_DEFAULTS.targetRate);
    assert.equal(c.rules.surpriseHold, CONDITION_RULES.surpriseHold);
    assert.equal(c.bounds.gainMax, ACTUATOR_BOUNDS.gainMax);
  });
});

/* ── 8. HTTP evidence probe ───────────────────────────────────────────────── */

describe('Phase 9 — /api/v1/ai/neuromorphic/adaptive evidence', () => {
  it('measures both runs and reports the honest delta', async () => {
    __resetAdaptiveReportCache();
    const out = await getAdaptiveReport();
    assert.equal(out.ok, true);
    assert.equal(out.schema, 'fbt.neuromorphic.adaptive-endpoint.v1');
    assert.equal(out.cached, false);
    assert.equal(out.syntheticDataUsed, true);
    assert.equal(out.zeroServerGpu, true);
    assert.equal(out.laws.canExecute, false);

    for (const name of ['trend', 'noisy', 'flat']) {
      const fixture = out.fixtures[name];
      assert.ok(fixture, `missing fixture ${name}`);
      assert.equal(fixture.static.ticks > 40, true);
      assert.equal(fixture.static.ticks, fixture.adaptive.ticks, 'both runs must see the same data');
      // The defect and the fix, measured on the server's own run.
      assert.ok(fixture.static.tailRate > 0.8, `${name}: static run not saturated (${fixture.static.tailRate})`);
      assert.ok(fixture.adaptive.tailRate < 0.4, `${name}: adaptive run still saturated (${fixture.adaptive.tailRate})`);
      assert.ok(fixture.delta.saturatedTicksRemoved > 0);
      assert.ok(fixture.delta.tailRatePctPoints > 0);
      assert.ok(PROFILE_CODES.includes(fixture.adaptive.profile));
      assert.equal(typeof fixture.adaptive.profileSwitches, 'number');
    }

    // The counterfactual must be computed from the measured counts, not a model.
    assert.equal(out.counterfactual.isConstant, false);
    assert.ok(out.counterfactual.suppressedTicks > 0);
    assert.match(out.counterfactual.note, /does not re-simulate/i);
    assert.match(out.counterfactual.target, /measured/i);
  });

  it('is deterministic and cached for the same payload', async () => {
    __resetAdaptiveReportCache();
    const first = await getAdaptiveReport();
    const second = await getAdaptiveReport();
    assert.equal(second.cached, true);
    for (const name of ['trend', 'noisy', 'flat']) {
      assert.equal(
        second.fixtures[name].adaptive.tailRate,
        first.fixtures[name].adaptive.tailRate,
        `${name} is not deterministic`
      );
    }
  });

  it('never claims accuracy, and keeps hit rate null on synthetic data', async () => {
    __resetAdaptiveReportCache();
    const out = await getAdaptiveReport();
    assert.equal(out.honesty.accuracyClaimed, false);
    assert.equal(out.honesty.syntheticFixture, true);
    assert.equal(out.honesty.realisedReturnUsed, false);
    assert.match(out.honesty.note, /no claim about prediction accuracy/i);
    for (const name of ['trend', 'noisy', 'flat']) {
      // The status decision is a decision, never a fabricated accuracy claim.
      assert.ok(typeof out.fixtures[name].adaptive.decision === 'string');
    }
  });

  it('its classifier self-test proves the mapping is a function of the inputs', async () => {
    __resetAdaptiveReportCache();
    const out = await getAdaptiveReport();
    const byLabel = Object.fromEntries(out.classifierSelfTest.map((r) => [r.label, r.profile]));
    assert.equal(byLabel['decided-and-predictable'], DATA_PROFILES.EXPLOIT_FULL);
    assert.equal(byLabel.undecided, DATA_PROFILES.HOLD_SPARSE);
    assert.equal(byLabel['not-predictable'], DATA_PROFILES.HOLD_SPARSE);
    assert.equal(byLabel.partial, DATA_PROFILES.CONSOLIDATE);
    assert.equal(byLabel.cold, DATA_PROFILES.HOLD_SPARSE);
    assert.equal(new Set(Object.values(byLabel)).size, 3, 'all three profiles must be reachable');
  });

  it('runs a single fixture on demand for a route-level check', async () => {
    const out = await runAdaptiveFixture('probe-trend', { count: 60, drift: 0.005, wave: 0.004, seed: 0 }, {
      governorPolicy: TURBO_POLICY
    });
    assert.equal(out.seriesKind, 'synthetic');
    assert.equal(out.fixture, 'probe-trend');
    assert.equal(out.static.ticks, out.adaptive.ticks);
    assert.ok(out.adaptive.tailEfficacy <= 1 && out.adaptive.tailEfficacy > 0);
  });
});
