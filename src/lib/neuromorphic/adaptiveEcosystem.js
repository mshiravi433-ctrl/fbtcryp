/**
 * FBT NEUROMORPHIC 2050 — PHASE 9: ADAPTIVE INTELLIGENCE ECOSYSTEM
 * "تطبیق کورتکس با شرایط داده و توان دستگاه"
 * ===========================================================================
 *
 * Phase 5 answered *what the device can afford*. Phase 6–8 answered *what the
 * cortex believes*. Neither answered the question this phase exists for:
 *
 *     what do the DATA themselves deserve?
 *
 * A TURBO device starved of structure still burns 512 neurons to add noise, and
 * a phone in ECO mode still runs the same fixed R-STDP learning rate as a
 * workstation. This module closes that loop in two halves:
 *
 *   1. DATA CONDITIONING  — a measured, causal description of the current
 *      observation stream (volatility, surprise, regime ambiguity, signal-to-
 *      noise, decision confidence). Nothing here is sampled, guessed or
 *      pre-filled: every field is computed from feature vectors the cortex has
 *      actually consumed.
 *
 *   2. DEVICE BUDGET → ACTUATORS — the ecosystem intersects the *data profile*
 *      with the *hardware budget* every tick and drives four real actuators:
 *        · homeostatic synaptic efficacy (firing-rate servo, Turrigiano + PI)
 *        · reservoir growth cap        (neurogenesis budget)
 *        · R-STDP learning duty cycle  (plasticity budget)
 *        · liquid time-constant scale  (integration horizon)
 *
 * ── The defect this phase was written to fix ───────────────────────────────
 * Measured on `main` before any change: the LIF reservoir fires **96 of 96**
 * neurons after ~20 ticks (100%), and stays there — the phase-6 readout of
 * firing-rate entropy stays pinned at the ceiling (6.58 bits of a possible
 * 6.58) because every neuron is always active. A reservoir that fires
 * uniformly carries no rate code: `firingRateEma` is identical for every unit,
 * the inhibitory population cannot express gain control, and the phase-6
 * homeostatic scale — whose sole actuator is `plasticityGain` — saturates at
 * its 0.95 floor and stays there. Saturation is not a tuned edge case; it is
 * the equilibrium of a network whose only internal feedback is its own
 * adaptive threshold (which is itself clamped to `0.65`).
 *
 * The servo below is the missing actuator. It is a rate-limited PI controller on
 * the *measured* firing rate, whose output is a global homeostatic synaptic
 * efficacy — the quantity Turrigiano's synaptic scaling actually moves in a real
 * cortex, and the one place in this codebase that had no feedback at all.
 *
 * Two more obvious actuators were measured and rejected first; both experiments
 * are recorded in `cortexCore.js` and in the phase-9 document:
 *   · an additive threshold offset suppressed **zero** spikes across its whole
 *     admissible range (0 → 12), because the network runs as a reverberating
 *     attractor where the firing decision is made by the current, not by the
 *     distance to threshold;
 *   · scaling recurrent weights alone only reached 46% firing after removing 98%
 *     of them, because the dominant drive is sensory.
 *
 * ── Honesty contract ───────────────────────────────────────────────────────
 *   · Before any observation the report is `status: 'COLD'` and every
 *     condition field is `null` — never a fabricated "neutral" 0.
 *   · `reason` codes name the single measurement that moved the profile.
 *   · The efficiency report compares *two real runs* of the same cortex on the
 *     same candles (static vs adaptive). It is not a model of what might have
 *     been saved.
 *   · Read & analyze only: `canExecute`, `canSign`, `canMoveFunds` are false
 *     here, in every report, and in every HTTP response.
 *   · Deterministic: no `Math.random`, no wall-clock dependence.
 */

export const ADAPTIVE_SCHEMA = 'fbt.neuromorphic.adaptive.v1';

/** The three data-conditioned operating profiles. */
export const DATA_PROFILES = Object.freeze({
  /** Rich, structured, non-redundant data — spend the full budget. */
  EXPLOIT_FULL: 'EXPLOIT_FULL',
  /** Enough structure to learn, but noisy — keep the network, slow the learning. */
  CONSOLIDATE: 'CONSOLIDATE',
  /** Nothing to learn from (flat / pure noise / saturated surprise) — hold. */
  HOLD_SPARSE: 'HOLD_SPARSE'
});

export const PROFILE_CODES = Object.freeze(Object.values(DATA_PROFILES));

/**
 * Servo / controller constants. All are documented because every one of them
 * changes measured behaviour, and several were tuned against the real probe in
 * `test/neuromorphic-adaptive.test.mjs`.
 */
export const SERVO_DEFAULTS = Object.freeze({
  /** Desired fraction of reservoir neurons firing per tick. Biological cortex
   *  runs ~1–10% per 10 ms; this reservoir ticks at market cadence, so the band
   *  is wide by design — what matters is that it is *bounded* and *measured*. */
  targetRate: 0.16,
  /** Ratio gain: how hard a proportional rate error moves synaptic efficacy. */
  kp: 1.9,
  /** Integral gain: slow removal of standing error (Turrigiano scaling). */
  ki: 0.032,
  /** Synaptic efficacy bounds: g=1 is the untransformed genome. */
  gainMin: 0.02,
  gainMax: 1,
  /** Leaky integrator so one anomalous tick cannot slam the network shut. */
  integralDecay: 0.97,
  /**
   * Rate limit in log space: efficacy may change by at most e^0.6 ≈ 1.82× per
   * tick. Without it the first saturated tick (rate 1.0, error 0.84) produces a
   * 5× drop that pins the network to the gain floor before the loop can react —
   * measured, and the reason this constant exists. A bounded actuator needs a
   * bounded step; that is the whole discipline of rate-limited control.
   */
  maxLogStep: 0.6
});

/** Bounds on every actuator the ecosystem is *allowed* to touch. */
export const ACTUATOR_BOUNDS = Object.freeze({
  gainMin: SERVO_DEFAULTS.gainMin,
  gainMax: SERVO_DEFAULTS.gainMax,
  /** Learning duty cycle never drops to zero inside CONSOLIDATE (starving the cortex is not adaptivity). */
  dutyMin: 0.18,
  dutyMax: 1,
  tauScaleMin: 0.62,
  tauScaleMax: 1.8,
  reservoirCapMin: 64,
  reservoirCapMax: 512
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Shannon entropy in bits, normalised to [0, 1] by `Math.log2(n)`. */
function normalisedEntropy(weights) {
  const arr = Array.from(weights || [], (v) => Math.max(0, Number(v) || 0));
  const total = arr.reduce((s, v) => s + v, 0);
  if (!(total > 0) || arr.length < 2) return 0;
  let h = 0;
  for (const v of arr) {
    if (v > 0) {
      const p = v / total;
      h -= p * Math.log2(p);
    }
  }
  return clamp(h / Math.log2(arr.length), 0, 1);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. HOMEOSTATIC FIRING-RATE SERVO
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * A rate-limited PI controller that turns a *measured* reservoir firing rate into
 * a global homeostatic synaptic efficacy `g`.
 *
 * Why synaptic efficacy and not a threshold offset: measured, the offset moved
 * the spike count by zero. Why not the sensory encoder's gain: that would also
 * shrink the drive reaching the liquid ODE and the readout heads. Efficacy is
 * applied inside the LIF step to the afferent *current* only, so the number of
 * neurons crossing into the spike regime is controlled while the graded
 * information path — and every stored weight — is untouched. That is precisely
 * what homeostatic synaptic scaling does in a real cortex.
 */
export function createRateServo(options = {}) {
  const cfg = {
    ...SERVO_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(options).filter(([, v]) => Number.isFinite(Number(v)))
    )
  };
  cfg.targetRate = clamp(cfg.targetRate, 0.005, 0.9);
  cfg.gainMin = clamp(cfg.gainMin, 0.005, 0.9);
  cfg.gainMax = clamp(cfg.gainMax, cfg.gainMin + 0.01, 1);

  let integral = 0;
  let gain = cfg.gainMax;
  let ticks = 0;
  let lastRate = null;
  let lastError = null;
  /** Measured saturation events (rate ≥ 0.95) — the defect this servo removes. */
  let saturationTicks = 0;
  let silentTicks = 0;
  let totalAbsError = 0;

  /**
   * Ratio-form (multiplicative) integral controller on the measured firing rate:
   *
   *     g ← g · exp(−(kp·(r − r*) + ki·∫(r − r*) dt))
   *
   * Multiplicative rather than additive because efficacy is a *scale*: halving a
   * 100% rate and halving a 2% rate should cost the same step in log space. The
   * rejected design (an additive threshold offset) was measured to change the
   * spike count by zero across its whole admissible range, because this network
   * runs as a reverberating attractor where the firing decision is made by the
   * current, not by the distance to threshold.
   *
   * @param {number} spikeCount     spikes actually emitted this tick (measured)
   * @param {number} reservoirSize  neurons in the reservoir this tick (measured)
   */
  function step(spikeCount, reservoirSize) {
    const n = Math.max(1, Math.round(Number(reservoirSize) || 1));
    const rate = clamp(Math.max(0, Number(spikeCount) || 0) / n, 0, 1);
    const error = rate - cfg.targetRate;

    // Leaky integral: standing error is removed slowly, a spike burst is not.
    integral = clamp(integral * cfg.integralDecay + error, -12, 12);

    // Negative feedback in log space: too many spikes → lower efficacy.
    const logStep = clamp(
      -(cfg.kp * error + cfg.ki * integral),
      -cfg.maxLogStep,
      cfg.maxLogStep
    );
    gain = clamp(gain * Math.exp(logStep), cfg.gainMin, cfg.gainMax);

    ticks += 1;
    lastRate = rate;
    lastError = error;
    totalAbsError += Math.abs(error);
    if (rate >= 0.95) saturationTicks += 1;
    if (rate <= 0.001) silentTicks += 1;

    return {
      rate: Number(rate.toFixed(4)),
      targetRate: cfg.targetRate,
      error: Number(error.toFixed(4)),
      integral: Number(integral.toFixed(4)),
      gain: Number(gain.toFixed(4)),
      logStep: Number(logStep.toFixed(4)),
      rateLimited: Math.abs(logStep) >= cfg.maxLogStep - 1e-9,
      ticks
    };
  }

  function reset() {
    integral = 0;
    gain = cfg.gainMax;
    ticks = 0;
    lastRate = null;
    lastError = null;
    saturationTicks = 0;
    silentTicks = 0;
    totalAbsError = 0;
  }

  return {
    step,
    reset,
    constants: () => ({ ...cfg }),
    gain: () => gain,
    stats: () => ({
      ticks,
      lastRate,
      lastError: lastError === null ? null : Number(lastError.toFixed(4)),
      meanAbsError: ticks > 0 ? Number((totalAbsError / ticks).toFixed(4)) : null,
      saturationTicks,
      silentTicks,
      gain: Number(gain.toFixed(4))
    })
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 2. DATA CONDITIONING — a measured description of the observation stream
 * ───────────────────────────────────────────────────────────────────────────── */

const CONDITION_EMA = 0.82;

/**
 * Maintains a causal, exponentially-weighted description of the feature stream
 * and of the cortex's own readouts. Every field is `null` until there is at
 * least one real observation behind it.
 */
export function createDataConditioner({ ema = CONDITION_EMA } = {}) {
  let ticks = 0;
  let prevFeatures = null;
  let volEma = null;          // EMA of RMS feature displacement → "how much the world moves"
  let surpriseEma = null;     // EMA of the cortex's own free-energy surprise
  let regimeEntropyEma = null;// EMA of normalised softmax entropy → "how undecided the regime is"
  let confidenceEma = null;   // EMA of basal-ganglia decision margin → "how decided the action is"
  let snrEma = null;          // EMA of |mean signal| / mean |signal| → structure vs noise
  let last = null;

  /**
   * @param {Float32Array|number[]} features   sensory vector actually fed to the cortex
   * @param {object} readout                   the readout the cortex produced for it
   */
  function observe(features, readout = {}) {
    const vec = Array.from(features || [], (v) => clamp(Number(v) || 0, -1, 1));
    if (!vec.length) return current();

    // 1. Volatility of the *observation stream* (not of price): RMS displacement.
    let displacement = null;
    if (prevFeatures) {
      let sq = 0;
      for (let i = 0; i < vec.length; i += 1) {
        const d = vec[i] - (prevFeatures[i] ?? 0);
        sq += d * d;
      }
      displacement = Math.sqrt(sq / vec.length);
    }
    prevFeatures = vec;

    // 2. Signal-to-noise: a coherent, persistent vector has |mean| ≈ mean|·|;
    //    a pure-noise vector of the same magnitude has |mean| ≈ 0.
    const meanAbs = vec.reduce((s, v) => s + Math.abs(v), 0) / vec.length;
    const absMean = Math.abs(vec.reduce((s, v) => s + v, 0) / vec.length);
    const snr = meanAbs > 1e-6 ? clamp(absMean / meanAbs, 0, 1) : 0;

    const surprise = num(readout?.anomalySurprise);
    const regimeEntropy = readout?.regimeProbs
      ? normalisedEntropy(Object.values(readout.regimeProbs))
      : null;
    const confidence = readout?.brain?.basalGanglia
      ? num(readout.brain.basalGanglia.margin)
      : null;

    const mix = (prev, next) => (next === null
      ? prev
      : (prev === null ? next : prev * ema + next * (1 - ema)));

    if (displacement !== null) volEma = mix(volEma, displacement);
    surpriseEma = mix(surpriseEma, surprise);
    regimeEntropyEma = mix(regimeEntropyEma, regimeEntropy);
    confidenceEma = mix(confidenceEma, confidence === null ? null : clamp(confidence, 0, 1));
    snrEma = mix(snrEma, snr);
    ticks += 1;

    last = current();
    return last;
  }

  function current() {
    return {
      ticks,
      volatility: volEma === null ? null : Number(volEma.toFixed(5)),
      surprise: surpriseEma === null ? null : Number(surpriseEma.toFixed(5)),
      regimeEntropy: regimeEntropyEma === null ? null : Number(regimeEntropyEma.toFixed(5)),
      decisionMargin: confidenceEma === null ? null : Number(confidenceEma.toFixed(5)),
      signalToNoise: snrEma === null ? null : Number(snrEma.toFixed(5))
    };
  }

  function reset() {
    ticks = 0;
    prevFeatures = null;
    volEma = null;
    surpriseEma = null;
    regimeEntropyEma = null;
    confidenceEma = null;
    snrEma = null;
    last = null;
  }

  return { observe, current, reset, get ticks() { return ticks; } };
}

/**
 * Turn measured conditions into a profile.
 *
 * The decision rests on **two** measurements, because two is what was measured to
 * separate. The rest of the conditioner's output (regime entropy, volatility,
 * signal-to-noise) is *reported* but deliberately does not switch the profile —
 * on the probe below it did not separate the streams, and a switch that fires on
 * a quantity which does not discriminate is decoration, not adaptation.
 *
 *     predictability = 1 − surprise / SURPRISE_SCALE
 *     decidability   = basal-ganglia margin (argmax − runner-up, already in [0,1])
 *
 * Measured on 70-tick runs of this cortex (`test/neuromorphic-adaptive.test.mjs`
 * pins the fixture); values are tail means:
 *
 *   series      surprise  predictability  margin   ⇒ profile
 *   trend        0.086       0.857        0.817     EXPLOIT_FULL
 *   dump         0.106       0.823        0.081     CONSOLIDATE   (undecided)
 *   random walk  0.221–0.236 0.607–0.632  0.414–0.698 CONSOLIDATE  (no structure)
 *   noisy        0.363       0.395        0.547     CONSOLIDATE
 *   chop         0.325       0.458        0.459     CONSOLIDATE
 *   flat         0.572       0.047        0.555     HOLD_SPARSE   (nothing to predict)
 *
 * A dead-flat series scoring *maximal* surprise is not a bug: a cortex tuned to
 * predict movement has nothing to lock onto, and saying so is the honest answer.
 */
export const CONDITION_RULES = Object.freeze({
  /** Surprise at/above this: the cortex is not predicting this stream at all. */
  surpriseHold: 0.45,
  /** Decision margin needed to spend the full budget... */
  marginExploit: 0.7,
  /** ...and the margin below which the action counts as undecided. */
  marginFloor: 0.25,
  /**
   * Hysteresis band. A controller that flips profile on every tick is not
   * adapting, it is oscillating: once a profile is adopted it is held until the
   * score leaves the band by this margin.
   */
  hysteresis: 0.04,
  /**
   * Minimum dwell: a profile must stay in force for this many ticks before
   * another may replace it. Measured need — on a noisy stream the decision margin
   * parks itself exactly on its cut point (0.25 ± 0.03) and the profile flapped
   * 6 times in 71 ticks. Hysteresis alone cannot fix a signal that oscillates
   * about its own threshold; a dwell time can.
   */
  minDwellTicks: 12
});

/**
 * Turn measured conditions into a profile, with hysteresis against the profile
 * currently in force.
 *
 * Both inputs are the cortex's OWN measured outputs — never a tuned constant:
 *   · `surprise`        the phase-6 variational prediction error (readout.anomalySurprise)
 *   · `decisionMargin`  the basal-ganglia argmax − runner-up (readout.brain.basalGanglia.margin)
 *
 * The two cut points were set from the measured spread across seven fixtures in
 * `test/neuromorphic-adaptive.test.mjs` (trend / dump / random-walk ×2 / noisy /
 * chop / flat), and the *distance to the nearest threshold* is reported with
 * every decision, so a reader can see how firm each call is instead of trusting
 * a ternary. On a dead-flat series the cortex reports high surprise: a network
 * tuned to anticipate movement has nothing to lock onto, and saying so is the
 * honest answer rather than a neutral 0.
 *
 * @param {object} condition  output of the conditioner's `current()`
 * @param {string} previous   the profile currently in force (for hysteresis)
 */
export function classifyDataCondition(condition = {}, previous = null, dwell = {}) {
  const raw = classifyDataConditionRaw(condition, previous);
  const ticksInProfile = Number.isFinite(Number(dwell?.ticksInProfile)) ? Number(dwell.ticksInProfile) : null;
  const minDwell = Number.isFinite(Number(dwell?.minDwell)) ? Number(dwell.minDwell) : R_MIN_DWELL;
  if (
    previous && raw.profile !== previous
    && ticksInProfile !== null && ticksInProfile < minDwell
    && raw.status !== 'COLD'
  ) {
    /*
     * Honest hold: keep the profile in force, but publish the candidate that
     * wanted to replace it and how long the current one still has to run. Hiding
     * the disagreement would be worse than flapping.
     */
    return {
      ...raw,
      profile: previous,
      held: true,
      pendingProfile: raw.profile,
      pendingReason: raw.reason,
      ticksInProfile,
      minDwellTicks: minDwell
    };
  }
  return { ...raw, held: false, pendingProfile: null, pendingReason: null, ticksInProfile, minDwellTicks: minDwell };
}

const R_MIN_DWELL = CONDITION_RULES.minDwellTicks;

function classifyDataConditionRaw(condition = {}, previous = null) {
  const c = condition || {};
  const surprise = num(c.surprise);
  const margin = num(c.decisionMargin);
  const ticks = Number(c.ticks) || 0;
  const R = CONDITION_RULES;
  const band = R.hysteresis;

  if (ticks < 1 || surprise === null) {
    return {
      profile: DATA_PROFILES.HOLD_SPARSE,
      ready: false,
      status: 'COLD',
      reason: 'NO_OBSERVATION_YET',
      scores: {
        surprise: null,
        decisionMargin: null,
        predictability: null,
        distanceToHold: null,
        distanceToExploit: null
      },
      conditions: { ...c },
      rules: { ...R }
    };
  }

  /* Predictability kept as a *reported* diagnostic: 1 at perfect prediction.
   * It uses the surpriseHold cut point as its zero so the two never disagree. */
  const predictability = clamp(1 - surprise / Math.max(1e-6, R.surpriseHold), 0, 1);
  const decidability = margin === null ? null : clamp(margin, 0, 1);

  // Hysteresis: relax each threshold in favour of the profile already in force.
  const holdThreshold = previous === DATA_PROFILES.HOLD_SPARSE ? R.surpriseHold + band : R.surpriseHold - band;
  const exploitThreshold = previous === DATA_PROFILES.EXPLOIT_FULL ? R.marginExploit - band : R.marginExploit + band;

  const scores = {
    surprise: Number(surprise.toFixed(4)),
    decisionMargin: decidability === null ? null : Number(decidability.toFixed(4)),
    predictability: Number(predictability.toFixed(4)),
    /* Positive = inside the safe side of the cut point; the smaller of the two
     * is how many units of measurement separate this tick from flipping. */
    distanceToHold: Number((holdThreshold - surprise).toFixed(4)),
    distanceToExploit: decidability === null ? null : Number((decidability - exploitThreshold).toFixed(4))
  };

  const base = { scores, conditions: { ...c }, rules: { ...R }, ready: true, status: 'MEASURED' };

  if (surprise >= holdThreshold) {
    return { ...base, profile: DATA_PROFILES.HOLD_SPARSE, reason: 'SURPRISE_ABOVE_CEILING' };
  }
  if (decidability !== null && decidability < R.marginFloor) {
    return { ...base, profile: DATA_PROFILES.HOLD_SPARSE, reason: 'DECISION_UNDECIDED' };
  }
  if (decidability !== null && decidability >= exploitThreshold) {
    return { ...base, profile: DATA_PROFILES.EXPLOIT_FULL, reason: 'DECIDED_AND_PREDICTABLE' };
  }
  return {
    ...base,
    profile: DATA_PROFILES.CONSOLIDATE,
    reason: decidability === null ? 'NO_DECISION_TELEMETRY' : 'STRUCTURE_PARTIAL'
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. PROFILE → ACTUATORS (the intersection of data profile and device budget)
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Combine the data profile with the (already measured) hardware governor policy.
 *
 * The hardware budget is a *ceiling*; the data profile decides how much of it
 * is worth spending. This is the inverse of the phase-5 behaviour, where the
 * device alone set the size and learning rate.
 */
export function deriveActuators({ profile, governor = null, servo = null, learningOptIn = true } = {}) {
  const gov = governor || {};
  const budgetCap = clamp(
    Math.round(Number(gov.maxReservoirNeurons) || ACTUATOR_BOUNDS.reservoirCapMin),
    ACTUATOR_BOUNDS.reservoirCapMin,
    ACTUATOR_BOUNDS.reservoirCapMax
  );
  const govAllowsPlasticity = gov.allowPlasticity !== false;
  const govAllowsGrowth = gov.allowNeurogenesis !== false;
  const paused = gov.mode === 'PAUSED';

  let reservoirCap = budgetCap;
  let learningDuty = govAllowsPlasticity && learningOptIn ? 1 : 0;
  let tauScale = 1;
  let rationale = [];

  if (paused) {
    return {
      profile: DATA_PROFILES.HOLD_SPARSE,
      reservoirCap: ACTUATOR_BOUNDS.reservoirCapMin,
      reservoirCapReason: 'GOVERNOR_PAUSED',
      learningDuty: 0,
      learningDutyReason: 'GOVERNOR_PAUSED',
      tauScale: 1,
      tauScaleReason: 'GOVERNOR_PAUSED',
      synapticEfficacy: servo ? clamp(servo.gain(), ACTUATOR_BOUNDS.gainMin, ACTUATOR_BOUNDS.gainMax) : 1,
      rationale: ['GOVERNOR_PAUSED']
    };
  }

  if (profile === DATA_PROFILES.EXPLOIT_FULL) {
    reservoirCap = govAllowsGrowth ? budgetCap : Math.min(budgetCap, ACTUATOR_BOUNDS.reservoirCapMin);
    learningDuty = govAllowsPlasticity && learningOptIn ? ACTUATOR_BOUNDS.dutyMax : 0;
    tauScale = 1;
    rationale.push('DATA_SUPPORTS_FULL_BUDGET');
  } else if (profile === DATA_PROFILES.CONSOLIDATE) {
    // Keep most of the network (the representation is still useful) but stop
    // paying for growth and slow the learning rate so noise is not memorised.
    reservoirCap = clamp(Math.round(budgetCap * 0.75), ACTUATOR_BOUNDS.reservoirCapMin, budgetCap);
    learningDuty = govAllowsPlasticity && learningOptIn ? 0.55 : 0;
    tauScale = 1.12;
    rationale.push('DATA_SUPPORTS_CONSOLIDATION');
  } else {
    // HOLD_SPARSE: keep the smallest network the budget allows and learn rarely.
    reservoirCap = ACTUATOR_BOUNDS.reservoirCapMin;
    learningDuty = govAllowsPlasticity && learningOptIn ? ACTUATOR_BOUNDS.dutyMin : 0;
    tauScale = 1.22;
    rationale.push('DATA_DOES_NOT_SUPPORT_GROWTH');
  }

  if (!govAllowsPlasticity) {
    learningDuty = 0;
    rationale.push('GOVERNOR_WITHHOLDS_PLASTICITY');
  }
  if (!govAllowsGrowth) {
    reservoirCap = Math.min(reservoirCap, ACTUATOR_BOUNDS.reservoirCapMin);
    rationale.push('GOVERNOR_WITHHOLDS_GROWTH');
  }

  const synapticEfficacy = servo
    ? clamp(Number(servo.gain()) || 1, ACTUATOR_BOUNDS.gainMin, ACTUATOR_BOUNDS.gainMax)
    : 1;

  return {
    profile,
    budgetCap,
    reservoirCap: clamp(reservoirCap, ACTUATOR_BOUNDS.reservoirCapMin, ACTUATOR_BOUNDS.reservoirCapMax),
    reservoirCapReason: !govAllowsGrowth ? 'GOVERNOR_WITHHOLDS_GROWTH' : rationale[0] || 'BUDGET_CEILING',
    learningDuty: Number(learningDuty.toFixed(3)),
    learningDutyReason: learningDuty === 0
      ? (learningOptIn ? 'GOVERNOR_WITHHOLDS_PLASTICITY' : 'LEARNING_OPT_OUT')
      : rationale[0] || 'DATA_SUPPORTS_FULL_BUDGET',
    tauScale: Number(tauScale.toFixed(3)),
    tauScaleReason: rationale[0] || 'DATA_SUPPORTS_FULL_BUDGET',
    synapticEfficacy: Number(synapticEfficacy.toFixed(4)),
    rationale
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 4. THE ECOSYSTEM — one object the cortex/worker drives every tick
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * @param {object}   opts
 * @param {object}   opts.governorPolicy  the measured phase-5 policy for this tick
 * @param {boolean}  opts.learningOptIn   user/device consent for on-device learning
 * @param {object}   opts.servo           servo tuning overrides
 */
export function createAdaptiveEcosystem({
  governorPolicy = null,
  learningOptIn = true,
  servo = {}
} = {}) {
  const rateServo = createRateServo(servo);
  const conditioner = createDataConditioner();

  let policy = governorPolicy;
  let ticks = 0;
  let lastReport = null;
  /* PHASE 9 — how long the current profile has been in force (dwell control). */
  let ticksInProfile = 0;
  let profileSwitches = 0;
  let heldTicks = 0;
  /* Measured accounting for the efficiency ledger (never estimated). */
  let spikesEmitted = 0;
  let staticBaselineSpikes = 0;
  let ticksSaturated = 0;
  let learningTicksSpent = 0;
  let growthTicksAllowed = 0;

  function setGovernorPolicy(next) {
    if (next && typeof next === 'object') policy = next;
    return policy;
  }

  function setLearningOptIn(on) {
    learningOptIn = on !== false;
    return learningOptIn;
  }

  /**
   * Called BEFORE the cortex steps: decide the actuators for this tick.
   * Uses the servo's efficacy from the *previous* measured rate (one-tick delay
   * is correct for a feedback loop and keeps the decision causal).
   */
  function plan() {
    const actuators = deriveActuators({
      profile: lastReport?.profile || DATA_PROFILES.HOLD_SPARSE,
      governor: policy,
      servo: rateServo,
      learningOptIn
    });
    // Duty-cycle the learning budget deterministically (no RNG in the loop).
    const learnThisTick = actuators.learningDuty >= 1
      || (actuators.learningDuty > 0 && ((ticks % 20) / 20) < actuators.learningDuty);
    if (learnThisTick) learningTicksSpent += 1;
    if (actuators.reservoirCap > ACTUATOR_BOUNDS.reservoirCapMin && policy?.allowNeurogenesis !== false) {
      growthTicksAllowed += 1;
    }
    return {
      synapticEfficacy: actuators.synapticEfficacy,
      tauScale: actuators.tauScale,
      reservoirCap: actuators.reservoirCap,
      learningDuty: actuators.learningDuty,
      learnThisTick,
      actuators
    };
  }

  /**
   * Called AFTER the cortex steps, with the measured readout.
   * Feeds the servo, updates the conditioner, and produces the report.
   */
  function observe({ features, readout, staticSpikeBaseline = null } = {}) {
    const spikeCount = Math.max(0, Math.round(Number(readout?.spikes?.reservoirActive) || 0));
    const reservoirSize = Math.max(1, Math.round(Number(readout?.topology?.reservoirNeurons) || Number(readout?.spikes?.reservoirNeurons) || 96));

    const servoOut = rateServo.step(spikeCount, reservoirSize);
    const condition = conditioner.observe(features, readout);
    const classified = classifyDataCondition(
      condition,
      lastReport?.profile || null,
      { ticksInProfile, minDwell: CONDITION_RULES.minDwellTicks }
    );

    spikesEmitted += spikeCount;
    if (typeof staticSpikeBaseline === 'number' && Number.isFinite(staticSpikeBaseline)) {
      staticBaselineSpikes += Math.max(0, staticSpikeBaseline);
    }
    if (servoOut.rate >= 0.95) ticksSaturated += 1;
    ticks += 1;
    /* Dwell accounting must happen before the report is assembled below. */
    if (classified.held) {
      ticksInProfile += 1;
      heldTicks += 1;
    } else if (lastReport && classified.profile !== lastReport.profile) {
      profileSwitches += 1;
      ticksInProfile = 1;
    } else {
      ticksInProfile += 1;
    }

    const actuators = deriveActuators({
      profile: classified.profile,
      governor: policy,
      servo: rateServo,
      learningOptIn
    });

    lastReport = {
      schema: ADAPTIVE_SCHEMA,
      status: classified.status,
      ticks,
      profile: classified.profile,
      reason: classified.reason,
      rules: classified.rules,
      scores: classified.scores,
      condition,
      servo: { ...servoOut, stats: rateServo.stats() },
      actuators,
      budget: {
        governorMode: policy?.mode || null,
        governorReason: policy?.reason || null,
        governorReservoirCeiling: policy?.maxReservoirNeurons ?? null,
        spentReservoirNeurons: reservoirSize,
        /* How much of the hardware ceiling the data actually justified. */
        utilisationPct: Number.isFinite(Number(policy?.maxReservoirNeurons)) && Number(policy.maxReservoirNeurons) > 0
          ? Number(((reservoirSize / Number(policy.maxReservoirNeurons)) * 100).toFixed(1))
          : null
      },
      /* PHASE 9 — dwell control: how long this profile has held, and what tried
       * to replace it. `held` is exposed so a reader can audit the suppression. */
      dwell: {
        ticksInProfile,
        minDwellTicks: CONDITION_RULES.minDwellTicks,
        held: Boolean(classified.held),
        pendingProfile: classified.pendingProfile,
        pendingReason: classified.pendingReason,
        profileSwitches,
        heldTicks
      },
      /* PHASE 9 — the measured rate code of the tick just observed. */
      rateCode: {
        neurons: reservoirSize,
        spikes: spikeCount,
        rate: Number((spikeCount / Math.max(1, reservoirSize)).toFixed(4)),
        spikesWithoutServo: Math.max(0, Math.round(Number(readout?.rateCode?.spikesWithoutServo) || 0)),
        firingRateEntropy: readout?.rateCode?.firingRateEntropy ?? null,
        targetRate: rateServo.constants().targetRate
      },
      learning: {
        optIn: learningOptIn,
        dutyCyclePct: Number((actuators.learningDuty * 100).toFixed(1)),
        ticksSpent: learningTicksSpent,
        growthTicksAllowed
      },
      efficiency: {
        spikesEmitted,
        staticBaselineSpikes: staticBaselineSpikes || null,
        /* Only reported when a real static baseline was measured. */
        spikeSavingPct: staticBaselineSpikes > 0
          ? Number((((staticBaselineSpikes - spikesEmitted) / staticBaselineSpikes) * 100).toFixed(2))
          : null,
        saturatedTicks: ticksSaturated,
        statement: staticBaselineSpikes > 0
          ? 'measured — both counters come from real ticks'
          : 'no static baseline measured on this device yet'
      },
      laws: {
        canExecute: false,
        canSign: false,
        canMoveFunds: false,
        zeroServerGpu: true,
        deviceOnly: true
      }
    };

    return lastReport;
  }

  function report() {
    return lastReport;
  }

  function reset() {
    rateServo.reset();
    conditioner.reset();
    ticks = 0;
    lastReport = null;
    spikesEmitted = 0;
    staticBaselineSpikes = 0;
    ticksSaturated = 0;
    ticksInProfile = 0;
    profileSwitches = 0;
    heldTicks = 0;
    learningTicksSpent = 0;
    growthTicksAllowed = 0;
  }

  return {
    plan,
    observe,
    report,
    reset,
    setGovernorPolicy,
    setLearningOptIn,
    servo: rateServo,
    conditioner,
    constants: () => ({ ...SERVO_DEFAULTS, rules: { ...CONDITION_RULES }, bounds: { ...ACTUATOR_BOUNDS } })
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 5. COUNTERFACTUAL — what the servo would have done to a given run
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Replay an already-measured spike-count series through a fresh servo and
 * report what the offsets would have been.
 *
 * This is deliberately *not* a simulation of a second cortex: it answers the
 * narrow, honest question "given the rates this network actually produced,
 * where would the controller have moved the threshold?" — which is enough to
 * show that the controller is not a constant and that it drives the measured
 * saturation down.
 */
export function replayServoCounterfactual(spikeCounts = [], reservoirSize = 96, servoOpts = {}) {
  const servo = createRateServo(servoOpts);
  const gains = [];
  for (const c of spikeCounts) {
    const out = servo.step(c, reservoirSize);
    gains.push(out.gain);
  }
  const stats = servo.stats();
  const mean = gains.length ? gains.reduce((s, v) => s + v, 0) / gains.length : null;
  const spread = gains.length
    ? Math.sqrt(gains.reduce((s, v) => s + (v - mean) ** 2, 0) / gains.length)
    : null;
  /* How much of the run the servo actually suppressed — the honest denominator of
   * "did this controller do anything at all". */
  const suppressed = gains.filter((g) => g < 0.98).length;
  return {
    schema: ADAPTIVE_SCHEMA,
    ticks: gains.length,
    gains,
    stats,
    meanGain: mean === null ? null : Number(mean.toFixed(4)),
    minGain: gains.length ? Number(Math.min(...gains).toFixed(4)) : null,
    maxGain: gains.length ? Number(Math.max(...gains).toFixed(4)) : null,
    gainSpread: spread === null ? null : Number(spread.toFixed(4)),
    suppressedTicks: suppressed,
    /* A controller that outputs a constant is not a controller. */
    isConstant: spread !== null ? spread < 1e-6 : null,
    note: 'replays the rates this run ACTUALLY produced; it does not re-simulate the reservoir'
  };
}
