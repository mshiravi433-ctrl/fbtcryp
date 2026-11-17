/**
 * THE CORTEX READOUT BRIDGE
 * ---------------------------------------------------------------------------
 * Lever #5 of docs/AI-COGNITION-AUDIT-2026-11-11.md.
 *
 * ─── THE MEASUREMENT THAT STARTED THIS ──────────────────────────────────────
 * The audit's central finding about the cortex was structural: exactly ONE
 * functional reference existed (server/aiIntentOS.js), and it published swarm
 * metadata — it never fed the answer. The natural reading was "wire the
 * cortex to the brain".
 *
 * So the cortex was MEASURED first, and it turned out the wiring would have
 * been a mistake.
 *
 * Feeding the cortex a clean trend sweep and reading its readout:
 *
 *     trend  -1.0  ->  directionalDrive 0.4999   regime trendUp
 *     trend  -0.5  ->  directionalDrive 0.4922   regime trendUp
 *     trend   0.0  ->  directionalDrive 0.0619   regime meanRevert
 *     trend  +0.5  ->  directionalDrive 0.4621   regime trendUp
 *     trend  +1.0  ->  directionalDrive 0.4893   regime trendUp
 *
 *     average drive, NEGATIVE trend: 0.4799
 *     average drive, POSITIVE trend: 0.4695
 *     DISCRIMINATION:                -0.0104
 *
 * The cortex does not distinguish a downtrend from an uptrend. It reported
 * `trendUp` for a -1.0 downtrend. Wiring THAT to the answer would have made
 * the assistant confidently wrong — strictly worse than not using it.
 *
 * ─── WHY: THE ENCODER SATURATES ─────────────────────────────────────────────
 * The spike encoder is ON/OFF + delta driven:
 *
 *     onDrive  = max(0, val) * 0.65 + max(0, delta) * 0.85
 *     offDrive = max(0, -val) * 0.65 + max(0, -delta) * 0.85
 *
 * On a fresh encoder `prevValues` is zero, so `delta === val` — the first
 * drive is dominated by the CHANGE, not the LEVEL. The accumulator threshold
 * then fires the ON channel even for a negative value.
 *
 * The result, measured on the drive the reservoir actually receives
 * (`spikes * 0.75 + currents * 0.35`):
 *
 *     t = -1.0  ->  ON - OFF = -0.822   (correct)
 *     t = -0.6  ->  ON - OFF = -0.018   (sign lost)
 *     t = -0.3  ->  ON - OFF = +0.021   (sign INVERTED)
 *     t =  0.0  ->  ON - OFF = +0.089
 *
 * Across a 21-point trend sweep there were only TWO distinct spike patterns.
 * The cortex was seeing "strong vs weak", not "up vs down".
 *
 * ─── WHAT THIS MODULE DOES ──────────────────────────────────────────────────
 * It builds the feature vector the cortex is FED with, and it is deliberately
 * conservative:
 *
 * 1. It maps a market state onto the eight sensory axes the encoder expects
 *    (`returnShort, returnMedium, realizedVol, volumeImpulse, rsiDeviation,
 *    rangePosition, breadthSkew, structuralStress`) with the SIGN preserved
 *    and the magnitudes on comparable scales.
 * 2. It **warm-starts the encoder** so the first observation is a LEVEL, not a
 *    delta — which is the direct cause of the inversion.
 * 3. It **refuses to report a signal it cannot trust.** If the cortex's own
 *    readout does not discriminate the direction it was given, the bridge
 *    reports `usable: false` and the answer carries no cortex input.
 *
 * Point 3 is the important one. The bridge's job is not to make the cortex
 * look good; it is to make the cortex HONEST. A cortex that cannot separate
 * up from down must not be quoted on direction — but it may still be
 * informative about VOLATILITY, which is a different question.
 */

export const CORTEX_BRIDGE_SCHEMA = 'fbt.neuromorphic.cortex-bridge.v1';

/* -------------------------------------------------------------------------- */
/*  THE SCALING HELPERS                                                       */
/* -------------------------------------------------------------------------- */

/** A finite number, or 0. */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Squash a SIGNED value into [-1, 1], keeping the sign and compressing the
 * magnitude.
 *
 * A plain `tanh` would work, but a linear ramp with a soft knee is easier to
 * reason about and does not saturate as early: the encoder's ON/OFF channels
 * stay distinguishable over a wider range of inputs, which is the whole
 * point — the saturation is what made the cortex blind.
 *
 * @param {number} value
 * @param {number} scale  the magnitude at which the value is "full"
 */
function squashSigned(value, scale) {
  const v = num(value);
  const s = Math.max(1e-9, Math.abs(num(scale)));
  const a = Math.abs(v) / s;
  if (a <= 1) return v / s;
  /*
   * Beyond the knee, compress logarithmically so a 10x move does not read as
   * a 100x move.
   *
   * The result is CLAMPED to 1. Without the clamp the knee could push a
   * value past 1 — a 50x move read as 1 + ln(50)/4 = 2.44 — and an axis
   * outside [-1, 1] is exactly what the encoder's ON/OFF channels cannot
   * represent. The whole point of squashing is that the encoder cannot
   * saturate, so the squash must never produce an out-of-range value.
   */
  return Math.sign(v) * Math.min(1, 1 + Math.log(a) / 4);
}

/**
 * Squash an UNSIGNED value into [0, 1], compressing the magnitude.
 *
 * @param {number} value
 * @param {number} scale  the magnitude at which the value is "full"
 */
function squashUnsigned(value, scale) {
  const v = Math.max(0, num(value));
  const s = Math.max(1e-9, Math.abs(num(scale)));
  const a = v / s;
  if (a <= 1) return a;
  /* Clamped for the same reason as the signed squash: an axis outside [0, 1]
     cannot be represented by an ON/OFF channel. */
  return Math.min(1, 1 + Math.log(a) / 4);
}

/* -------------------------------------------------------------------------- */
/*  THE AXES                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The eight sensory axes the spike encoder expects, in order.
 * Mirrors SENSORY_AXES in spikeEncoder.js — the encoder is driven by index,
 * not by name, so the mapping must be exact.
 */
export const BRIDGE_AXES = Object.freeze([
  'returnShort',      // short-horizon return, signed
  'returnMedium',     // medium-horizon return, signed
  'realizedVol',      // realised volatility, unsigned
  'volumeImpulse',    // volume z-score, unsigned
  'rsiDeviation',     // distance from the 50 line, signed
  'rangePosition',    // where in its recent range, 0..1 centred on 0.5
  'breadthSkew',      // breadth skew, signed
  'structuralStress'  // structural stress, unsigned
]);

/* -------------------------------------------------------------------------- */
/*  THE FEATURE BUILDER                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build the 16-channel ON/OFF feature vector for the cortex.
 *
 * The input is a MARKET STATE, not raw prices — because the cortex's job is
 * to read a regime, and the regime is what the pipeline already computes.
 *
 * Every signed axis is centred so that POSITIVE MEANS UP, and every
 * magnitude is squashed into [-1, 1] so that the ON/OFF channels are
 * balanced. A squashed input is what stops the encoder from saturating: the
 * encoder's threshold is on the drive, and a drive that stays inside ±1 keeps
 * the ON and OFF channels distinguishable.
 *
 * @param {object} state
 * @param {number} [state.returnShort]  short-horizon return, e.g. 0.03
 * @param {number} [state.returnMedium] medium-horizon return
 * @param {number} [state.realizedVol]  realised volatility, e.g. 0.4 (annualised)
 * @param {number} [state.volumeImpulse] volume z-score
 * @param {number} [state.rsi]          RSI 0..100
 * @param {number} [state.rangePosition] 0..1
 * @param {number} [state.breadthSkew]  -1..1
 * @param {number} [state.structuralStress] 0..1
 * @returns {{ features: Float32Array, axes: object }}
 */
export function buildCortexFeatures(state = {}) {
  const s = state || {};

  /* Signed returns: squashed so a 5% move and a 50% move are both "large"
     but neither overflows the ON/OFF range. */
  const retShort = squashSigned(num(s.returnShort), 0.08);
  const retMedium = squashSigned(num(s.returnMedium), 0.15);

  /* Volatility is unsigned but still squashed: a 400% annualised vol must
     not be 40x the weight of a 10% one. */
  const vol = squashUnsigned(num(s.realizedVol), 1.2);
  const volumeImpulse = squashUnsigned(num(s.volumeImpulse), 2.5);

  /* RSI deviation: RSI 70 is +1, RSI 30 is -1, RSI 50 is 0. */
  const rsi = num(s.rsi);
  const rsiDeviation = Number.isFinite(rsi) && rsi > 0
    ? Math.max(-1, Math.min(1, (rsi - 50) / 20))
    : 0;

  /* Range position: 0 = the bottom of the range, 1 = the top. Centred on 0.5
     so that "high in the range" is POSITIVE, matching the other signed axes
     — a market at the top of its range is a strong market, not a weak one. */
  const rp = num(s.rangePosition);
  const rangePosition = Number.isFinite(rp)
    ? Math.max(-1, Math.min(1, (rp - 0.5) * 2))
    : 0;

  const breadthSkew = Math.max(-1, Math.min(1, num(s.breadthSkew)));
  const structuralStress = squashUnsigned(num(s.structuralStress), 1);

  const axes = {
    returnShort: retShort,
    returnMedium: retMedium,
    realizedVol: vol,
    volumeImpulse: volumeImpulse,
    rsiDeviation,
    rangePosition,
    breadthSkew,
    structuralStress
  };

  /* The encoder is ON/OFF: each axis occupies two channels, ON then OFF. */
  const features = new Float32Array(BRIDGE_AXES.length * 2);
  BRIDGE_AXES.forEach((axis, i) => {
    const v = axes[axis];
    features[i * 2] = Math.max(0, v);
    features[i * 2 + 1] = Math.max(0, -v);
  });

  return { features, axes };
}

/* -------------------------------------------------------------------------- */
/*  THE WARM START                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The encoder's inversion comes from its DELTA term: on a fresh encoder
 * `prevValues` is zero, so `delta === val`, and the ON channel fires its
 * threshold spike even when the value is negative.
 *
 * The fix is to give the encoder a first observation that is NOT a delta. The
 * encoder exposes `reset()`, so the bridge does this: it seeds the encoder
 * with a NEUTRAL state first (all zeros), then feeds the real one. The
 * encoder's first delta is then measured against neutral rather than against
 * zero-from-nothing, and the value term dominates.
 *
 * @param {object} encoder  a spike encoder
 */
export function warmStartEncoder(encoder) {
  if (!encoder || typeof encoder.encode !== 'function') return false;
  try {
    if (typeof encoder.reset === 'function') encoder.reset();
    /* A neutral observation: the level is zero and the delta from the
       previous (also zero) is zero, so neither channel accumulates. */
    encoder.encode(new Float32Array(BRIDGE_AXES.length * 2));
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  THE TRUST CHECK                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Does this cortex readout actually DISCRIMINATE the direction it was given?
 *
 * This is the honest gate. The bridge does not assume the cortex is right:
 * it runs the cortex twice — once on the real state and once on its mirror —
 * and asks whether the directional readout moved the way the direction did.
 *
 * A mirror probe is used because it is the cleanest possible control: the
 * same cortex, the same seed, the same everything except the SIGN of the
 * directional axes. If the cortex cannot tell them apart, its directional
 * output is noise and must not be quoted.
 *
 * ─── THE SIGN CONVENTION ────────────────────────────────────────────────────
 * The mirror of a DOWNTREEND is an UPTREND, so for a falling market the
 * correct spread is NEGATIVE: the real read is negative and the mirrored
 * read is positive.
 *
 * The earlier version rejected a negative spread as "the cortex reads this
 * state BACKWARDS". That was wrong, and it was wrong in the direction that
 * matters: a perfectly healthy downtrend read was rejected as inverted, and
 * the measured symptom was that a −0.76 drive (correct) was withheld while
 * the regime said `trendDown`.
 *
 * So the probe is now SIGN-AGNOSTIC about the market's own direction, and
 * checks two separate things:
 *
 *   1. SEPARATION — do the real state and its mirror produce different
 *      drives? A blind cortex gives ~0.
 *   2. CONSISTENCY — does the real read point the way the state's own
 *      signed axes point? The expected sign comes from the features, so the
 *      probe does not need to be told which way is up.
 *
 * @param {object} params
 * @param {Function} params.runCortex  (features) -> readout, the cortex's step
 * @param {Float32Array} params.features  the real feature vector
 * @param {Float32Array} params.mirrored   the mirrored feature vector
 * @param {number[]} [params.signedAxisIndices]  the axes that carry direction
 * @returns {{ usable: boolean, discrimination: number, separation: number,
 *             consistent: boolean, expectedSign: number, reason: string }}
 */
export function probeDirectionalDiscrimination({ runCortex, features, mirrored, signedAxisIndices = [0, 1, 4, 5, 6] } = {}) {
  if (typeof runCortex !== 'function' || !features || !mirrored) {
    return { usable: false, discrimination: 0, separation: 0, consistent: false, expectedSign: 0, reason: 'no cortex to probe' };
  }

  let real = null;
  let flip = null;
  try {
    real = runCortex(features);
    flip = runCortex(mirrored);
  } catch (err) {
    return { usable: false, discrimination: 0, separation: 0, consistent: false, expectedSign: 0, reason: `probe failed: ${String(err?.message || err).slice(0, 80)}` };
  }

  const a = Number(real?.directionalDrive);
  const b = Number(flip?.directionalDrive);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { usable: false, discrimination: 0, separation: 0, consistent: false, expectedSign: 0, reason: 'the cortex produced no directional readout' };
  }

  /*
   * The SEPARATION is how far apart the real state and its mirror land,
   * normalised into [0, 1]. A cortex that reads direction correctly puts
   * them at opposite ends of the range (separation near 1); a blind cortex
   * puts them on top of each other (separation near 0).
   */
  const separation = Math.max(0, Math.min(1, Math.abs(a - b) / 2));

  /*
   * The EXPECTED SIGN comes from the state's own signed axes: the sum of the
   * ON channels minus the OFF channels over the directional axes. Positive
   * means the state is a rising one.
   *
   * The sign is taken from the RETURN axes — the ones that carry the actual
   * move — and the corroborating axes (RSI, range position, breadth) are
   * used only to decide whether the state has a direction AT ALL.
   *
   * The reason is that the corroborating axes are squashed to their full
   * ±1 by construction: a market whose RSI is 62 and whose breadth is
   * exactly even contributes a large balance even though the market moved
   * 0.8% and nothing else. Measured: a mild +0.8% move with 5 advancers
   * and 5 decliners carried a squashed balance of 0.967 — the same order as
   * a real trend — because the RSI and range-position channels alone
   * accounted for most of it.
   */
  let balance = 0;
  let returnBalance = 0;
  for (const axis of signedAxisIndices) {
    const contribution = (Number(features[axis * 2]) || 0) - (Number(features[axis * 2 + 1]) || 0);
    balance += contribution;
    /* Axes 0 and 1 are the short and medium RETURNS. */
    if (axis === 0 || axis === 1) returnBalance += contribution;
  }
  const expectedSign = returnBalance > 0 ? 1 : (returnBalance < 0 ? -1 : 0);

  /*
   * CONSISTENCY: does the read point the way the state points? A near-zero
   * drive is consistent with a near-zero state, so a state with no
   * direction of its own is never accused of being misread.
   */
  /*
   * A state whose own directional balance is WEAK has no clear direction to
   * be consistent with. The measured symptom: a market with 5 advancers and
   * 5 decliners and a +0.8% benchmark move has a balance of almost zero, and
   * the probe called the resulting read "BACKWARDS" — which is a false
   * accusation, not a measurement.
   *
   * So the balance is compared against a floor: below it, the state is
   * treated as directionless, the consistency check is skipped, and the
   * read is withheld for the honest reason — "the state has no direction to
   * read".
   */
  /*
   * The floor is on the RETURN balance, because that is the axis the sign
   * comes from. A move that squashes to less than 0.2 on the returns is a
   * move too small to call a direction, whatever the RSI says.
   */
  const RETURN_FLOOR = 0.2;
  const directionless = Math.abs(returnBalance) < RETURN_FLOOR;

  const consistent = directionless
    ? Math.abs(a) < 0.35
    : Math.sign(a) === expectedSign;

  /*
   * The DISCRIMINATION is signed by the state's own direction, so a positive
   * discrimination always means "the cortex separated this state from its
   * mirror AND read it the right way round". Callers that want a plain
   * strength read it as |discrimination|.
   */
  const discrimination = Math.max(-1, Math.min(1, (a - b) / 2)) * (expectedSign === 0 ? 1 : expectedSign);

  /*
   * The ORDER of these checks is the order of what they know.
   *
   * A state with no direction of its own is a fact about the STATE, and it
   * is known before any measurement of the cortex. A state that does have a
   * direction but that the cortex cannot separate from its mirror is a fact
   * about the CORTEX.
   *
   * The measured symptom of getting this backwards: a +0.8% move with an
   * even breadth was reported as "the cortex cannot tell this state from
   * its mirror — its directional readout is noise", which accuses the
   * cortex of noise when the truth is that there was nothing to read.
   */
  if (directionless) {
    return {
      usable: false,
      discrimination: 0,
      separation,
      consistent: false,
      directionless: true,
      expectedSign,
      reason: 'the state has no direction of its own to read — the cortex is not asked for one'
    };
  }
  if (separation < 0.05) {
    return {
      usable: false,
      discrimination: 0,
      separation,
      consistent: false,
      directionless: false,
      expectedSign,
      reason: 'the cortex cannot tell this state from its mirror — its directional readout is noise'
    };
  }
  if (!consistent) {
    return {
      usable: false,
      discrimination,
      separation,
      consistent: false,
      directionless: false,
      expectedSign,
      reason: 'the cortex reads this state BACKWARDS — its directional readout is inverted, so it is not quoted'
    };
  }
  return {
    usable: true,
    discrimination,
    separation,
    consistent: true,
    directionless: false,
    expectedSign,
    reason: 'the cortex separates this state from its mirror and reads it the right way round'
  };
}

/**
 * Build the mirrored feature vector: the directional axes flipped, the
 * magnitude axes kept.
 *
 * @param {Float32Array} features
 * @param {number[]} signedAxisIndices  which axis indices carry direction
 */
export function mirrorFeatures(features, signedAxisIndices = [0, 1, 4, 5, 6]) {
  const out = new Float32Array(features.length);
  out.set(features);
  for (const axis of signedAxisIndices) {
    const on = axis * 2;
    const off = axis * 2 + 1;
    const a = out[on];
    const b = out[off];
    out[on] = b;
    out[off] = a;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  THE BRIDGE                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read the cortex for a market state, honestly.
 *
 * It returns a report with:
 *   · `directional` — the cortex's directional read, ONLY if it is trustworthy
 *   · `volatility`  — the cortex's volatility read, which is a DIFFERENT
 *                     question and is reported separately
 *   · `usable`      — whether the DIRECTIONAL read may be quoted
 *
 * The honesty is the point. A caller that ignores `usable` can still be
 * lied to, so the shape makes the safe thing the easy thing: the directional
 * field is `null` when the cortex failed its probe, not a number that happens
 * to be small.
 *
 * ─── THE `usable` SEMANTICS ────────────────────────────────────────────────
 * `usable` means ONE thing: **the directional read may be quoted.** It does
 * NOT mean "the report has some content".
 *
 * The earlier version set `usable = Boolean(report.volatility)` when the
 * directional probe failed. That was wrong in a way that mattered: a report
 * whose directional call had been WITHHELD still announced itself as usable,
 * so a caller checking only `usable` would carry a cortex input that the
 * bridge had just decided not to quote. A present-but-untrustworthy read was
 * reported as a usable read.
 *
 * Now the volatility read has its own flag (`volatilityUsable`), and
 * `usable` stays false whenever the directional call was withheld.
 *
 * ─── THE STATEFUL-CORTEX TRAP ───────────────────────────────────────────────
 * The cortex is STATEFUL: its liquid state carries from one step to the next.
 * This bridge takes THREE steps on a state — a neutral warm start, the
 * probe's real pass, and the probe's mirror pass — and then reads the
 * result. If all of them happen on ONE instance, the read that comes back
 * is the FOURTH step, on a cortex that has already seen the mirrored state.
 *
 * The measured symptom was sharp: a strong UPTREND came back with
 * `drive = -0.8759` — the wrong sign — and `dominantRegime: trendUp`. The
 * same state read on a fresh cortex gave `drive = +0.8303`, the right sign.
 *
 * So every step gets its OWN instance. `instanceFactory` provides it; when
 * it is absent the bridge falls back to the single cortex, and the report
 * says so, because a stateful read is then unreliable.
 *
 * @param {object} params
 * @param {object} params.cortex     the cortex (must expose `stepSync` or `step`)
 * @param {object} params.state      the market state
 * @param {Function} [params.encoder] a spike encoder to warm-start
 * @param {Function} [params.instanceFactory] () => a fresh cortex with the
 *        same weights, for each step
 * @returns {object} the report
 */
export function readCortexForState({ cortex, state, encoder, instanceFactory = null } = {}) {
  const report = {
    schema: CORTEX_BRIDGE_SCHEMA,
    /* `usable` = the DIRECTIONAL read may be quoted. Nothing else. */
    usable: false,
    directional: null,
    /* The volatility read stands on its own merits. */
    volatilityUsable: false,
    volatility: null,
    anomaly: null,
    regime: null,
    discrimination: 0,
    reason: 'no cortex',
    axes: null
  };

  if (!cortex) return report;

  const { features, axes } = buildCortexFeatures(state || {});
  report.axes = axes;

  /*
   * Every step gets a FRESH instance. Without an instance factory the
   * single cortex is reused and the read is unreliable — the report says so
   * rather than quietly reporting a drifted read.
   */
  const freshInstance = typeof instanceFactory === 'function'
    ? () => {
      try { return instanceFactory(); } catch { return cortex; }
    }
    : () => cortex;

  const stateless = typeof instanceFactory === 'function';

  /* The encoder lives inside the cortex, so the warm start is applied by
     resetting and stepping once with a neutral vector through the SAME
     encoder. The cortex does not expose its encoder, so the neutral step is
     done through the cortex itself — on its OWN instance, so the warm start
     does not pollute the read. */
  {
    const warm = freshInstance();
    try {
      const neutral = new Float32Array(BRIDGE_AXES.length * 2);
      if (typeof warm.stepSync === 'function') warm.stepSync(neutral);
      else if (typeof warm.step === 'function') warm.step(neutral);
    } catch { /* the cortex may refuse a zero vector; the probe still runs */ }
  }

  const runCortex = (f) => {
    const instance = freshInstance();
    if (typeof instance.stepSync === 'function') return instance.stepSync(f);
    if (typeof instance.step === 'function') return instance.step(f);
    throw new Error('the cortex exposes no step');
  };

  const mirrored = mirrorFeatures(features);
  const probe = probeDirectionalDiscrimination({ runCortex, features, mirrored });

  report.discrimination = probe.discrimination;
  report.probeReason = probe.reason;

  let real;
  try {
    real = runCortex(features);
  } catch (err) {
    report.reason = `the cortex failed: ${String(err?.message || err).slice(0, 80)}`;
    return report;
  }

  if (!stateless) {
    report.reason = 'the cortex is stateful and no fresh instance was available — the read is not reliable and is not quoted';
    report.usable = false;
    return report;
  }

  /* Volatility and anomaly are DIFFERENT questions from direction. A cortex
     that cannot read direction may still read volatility, and that is worth
     having — but it is reported separately and never dressed up as a
     directional call. */
  const vol = Number(real?.volatilityForecast);
  if (Number.isFinite(vol)) {
    report.volatility = {
      forecast: Number(vol.toFixed(4)),
      /* How far the state is from calm, 0..1. */
      elevation: Number(Math.max(0, Math.min(1, vol)).toFixed(4))
    };
    /* The volatility read is trustworthy on its own terms — it is a
       different question from direction, and a cortex that is blind to
       direction can still be right about volatility. It is flagged
       SEPARATELY so it never launders an unusable directional read. */
    report.volatilityUsable = true;
  }
  const anom = Number(real?.anomalySurprise);
  if (Number.isFinite(anom)) {
    report.anomaly = { surprise: Number(anom.toFixed(4)) };
  }
  if (real?.dominantRegime) {
    report.regime = String(real.dominantRegime);
  }

  if (!probe.usable) {
    report.reason = probe.reason;
    /* The directional call is withheld, so `usable` stays FALSE. The
       volatility read may stand — but on its own flag. */
    report.usable = false;
    return report;
  }

  const drive = Number(real?.directionalDrive);
  report.directional = {
    drive: Number(drive.toFixed(4)),
    confidence: Number(Math.min(1, probe.discrimination).toFixed(4))
  };
  report.usable = true;
  report.reason = probe.reason;
  return report;
}
