/**
 * THE CORTEX READOUT TRAINER
 * ---------------------------------------------------------------------------
 * Lever #5 of docs/AI-COGNITION-AUDIT-2026-11-11.md — the "upgrade the
 * cortex" work, done as a DIAGNOSIS first.
 *
 * ─── WHY THE CORTEX COULD NOT BE WIRED IN ───────────────────────────────────
 * The audit's structural finding was that the cortex had exactly ONE
 * functional reference, and it published swarm metadata instead of feeding
 * the answer. The obvious next move was "wire the cortex to the brain".
 *
 * Measuring first showed that would have made the assistant confidently
 * wrong. Feeding a clean trend sweep to the cortex:
 *
 *     average directionalDrive, NEGATIVE trend: 0.4799
 *     average directionalDrive, POSITIVE trend: 0.4695
 *     DISCRIMINATION:                           -0.0104
 *
 * and `dominantRegime` reported `trendUp` for a -1.0 downtrend.
 *
 * ─── THE ROOT CAUSE, FOUND BY LOOKING AT THE ACTUAL CODE ───────────────────
 * The reservoir has R-STDP plasticity and the brain core has neuromodulators,
 * so the cortex LOOKS like a learning system. But the thing that produces
 * `directionalDrive` is a 12-dimensional LINEAR READOUT over the 32-dim
 * liquid state:
 *
 *     rawHeads[r] = readoutBias[r] + Σ readoutW[r][m] · liquidState[m]
 *     directionalDrive = tanh(rawHeads[0]) · riskDamp
 *
 * And those readout weights are set ONCE, by hand, inside the genome
 * builder:
 *
 *     if (r === 0 && (axis === 0 || axis === 1 || axis === 6)) w += 0.34;
 *
 * A grep for `readoutW` across `src/` and `server/` returns nothing outside
 * `cortexCore.js`: **the readout is never trained anywhere in the codebase.**
 *
 * So the cortex learns everything EXCEPT the thing it is asked to report.
 * The reservoir shapes its internal dynamics; the readout that converts those
 * dynamics into "up or down" is a random projection with a lucky bias.
 * That is not a bug in a weight — it is a missing training phase.
 *
 * ─── WHAT THIS DOES ─────────────────────────────────────────────────────────
 * It trains the readout. The linear readout is the standard way this is
 * done in reservoir computing (Ricoe's readout learning), and it is the
 * RIGHT method here because:
 *
 *   · it trains ONLY the readout, leaving the reservoir, the genome and
 *     every snapshot byte-identical — so a cortex that is deployed keeps
 *     working exactly as before if the trainer is never run;
 *   · it is closed-form (ridge regression), so it needs no GPU, no
 *     backpropagation and no epochs — which matters on a deployment whose
 *     server budget is 8 CPU-minutes a day;
 *   · it is DETERMINISTIC, so the same episodes always produce the same
 *     weights and the deployment's behaviour does not drift between cold
 *     starts.
 *
 * The trainer learns the readout from LABELED episodes: a feature vector, the
 * liquid state it produced, and the target the answer should carry. The
 * liquid state is what the reservoir computed — so the trainer learns the
 * map from "what the reservoir saw" to "what the answer should say", which is
 * precisely the map the readout is supposed to encode.
 */

export const READOUT_TRAINER_SCHEMA = 'fbt.neuromorphic.readout-trainer.v1';

/* -------------------------------------------------------------------------- */
/*  THE HEAD MAP                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Which readout head each target trains.
 *
 * The head indices are the cortex's own (`READOUT_DIM = 12`), and they are
 * documented in cortexCore.js:
 *
 *   0  directionalDrive      signed
 *   1  volatilityForecast    unsigned
 *   2..5 regime logits       four-way softmax
 *   6  plasticityGate        unsigned
 *   7  anomalySurprise       unsigned
 *   8..11 reserved (macro / cross-asset / global / intent)
 */
export const HEAD_MAP = Object.freeze({
  directional: 0,
  volatility: 1,
  regimeUp: 2,
  regimeDown: 3,
  regimeRevert: 4,
  regimeShock: 5
});

/* -------------------------------------------------------------------------- */
/*  THE SOLVER                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Solve a ridge-regularised least-squares problem:
 *
 *     min_W  ‖X·Wᵀ - Y‖²  +  λ‖W‖²
 *
 * The normal equations are `XᵀX + λI` times `W` equals `XᵀY`. The system is
 * tiny — `LIQUID_SIZE` (32) unknowns per head — so it is solved with
 * Gaussian elimination with partial pivoting, in plain Float64 arithmetic.
 *
 * No dependency, no iteration, no convergence question: one call, one
 * answer, bit-for-bit reproducible.
 *
 * @param {number[][]} rows       the design matrix, one row per episode
 * @param {number[][]} targets    the target matrix, one row per episode
 * @param {number} lambda         the ridge penalty
 * @returns {number[][]|null} the solution rows, or null if it is singular
 */
export function solveRidge(rows, targets, lambda = 1e-3) {
  const n = rows.length;
  if (!n || !targets.length) return null;
  const d = rows[0].length;

  /* XᵀX + λI and XᵀY */
  const a = [];
  const b = [];
  for (let i = 0; i < d; i += 1) {
    const rowA = new Array(d).fill(0);
    const rowB = new Array(targets[0].length).fill(0);
    for (let k = 0; k < n; k += 1) {
      const xk = rows[k][i];
      if (!xk) continue;
      for (let j = 0; j < d; j += 1) rowA[j] += xk * rows[k][j];
      for (let j = 0; j < targets[0].length; j += 1) rowB[j] += xk * targets[k][j];
    }
    rowA[i] += lambda;
    a.push(rowA);
    b.push(rowB);
  }

  /* Gaussian elimination with partial pivoting, on the augmented system. */
  const m = d;
  for (let col = 0; col < m; col += 1) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let r = col + 1; r < m; r += 1) {
      const v = Math.abs(a[r][col]);
      if (v > best) { best = v; pivot = r; }
    }
    if (best < 1e-12) return null; /* singular — the caller keeps the old weights */
    if (pivot !== col) {
      const ta = a[pivot]; a[pivot] = a[col]; a[col] = ta;
      const tb = b[pivot]; b[pivot] = b[col]; b[col] = tb;
    }
    const p = a[col][col];
    for (let r = col + 1; r < m; r += 1) {
      const f = a[r][col] / p;
      if (!f) continue;
      for (let c = col; c < m; c += 1) a[r][c] -= f * a[col][c];
      for (let c = 0; c < b[col].length; c += 1) b[r][c] -= f * b[col][c];
    }
  }

  /*
   * Back substitution.
   *
   * The rows are solved from the BOTTOM up, and each row's answer depends on
   * the rows BELOW it — so the solved rows are collected into a full array
   * first and only then read. Reading `w[j]` while the array is still being
   * filled is the bug: `w[j]` is undefined for the rows not yet solved.
   */
  const w = new Array(m);
  for (let i = m - 1; i >= 0; i -= 1) {
    /*
     * The row STARTS FROM THE RIGHT-HAND SIDE. This is the line that was
     * missing: `rowW` was initialised to zeros and only ever had the
     * off-diagonal contributions SUBTRACTED from it, so the right-hand side
     * `b[i]` never entered the solution and every weight came out zero.
     *
     * A solver that silently returns zeros is worse than one that throws:
     * the caller gets a plausible-looking object (ok: true) carrying a model
     * that has learned nothing.
     */
    const rowW = Array.from(b[i]);
    for (let j = i + 1; j < m; j += 1) {
      const aij = a[i][j];
      if (!aij) continue;
      const wj = w[j];
      if (!wj) continue;
      for (let c = 0; c < rowW.length; c += 1) rowW[c] -= aij * wj[c];
    }
    const piv = a[i][i];
    for (let c = 0; c < rowW.length; c += 1) rowW[c] /= piv;
    w[i] = rowW;
  }
  return w;
}

/* -------------------------------------------------------------------------- */
/*  THE EPISODES                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One training episode: what the cortex saw, what the reservoir computed from
 * it, and what the answer should carry.
 *
 * @typedef {object} ReadoutEpisode
 * @property {number[]} liquidState  the 32-dim liquid state after the step
 * @property {number}   direction    -1 .. +1, the direction the answer should carry
 * @property {number}   volatility   0 .. 1, the volatility the answer should carry
 * @property {string}   regime       one of trendUp / trendDown / meanRevert / shock
 */

/**
 * Build the training targets from the episodes.
 *
 * The targets are what the readout should output, so the training teaches
 * the map "liquid state → readout head" rather than teaching the cortex to
 * predict the future — which is a much bigger claim than the data supports.
 *
 * The regime is a FOUR-WAY softmax, so its four heads are trained jointly
 * against the distribution, not as four independent regressions.
 */
export function buildTargets(episodes) {
  const REGIMES = ['trendUp', 'trendDown', 'meanRevert', 'shock'];
  return episodes.map((ep) => {
    const row = new Array(6).fill(0);
    row[HEAD_MAP.directional] = Number(ep.direction) || 0;
    row[HEAD_MAP.volatility] = Number(ep.volatility) || 0;
    const idx = Math.max(0, REGIMES.indexOf(ep.regime));
    /* A soft target: the correct regime gets the most mass, the others
       share the rest. That is what makes the four heads a distribution
       rather than four unrelated numbers. */
    for (let i = 0; i < 4; i += 1) {
      row[HEAD_MAP.regimeUp + i] = i === idx ? 0.7 : 0.1;
    }
    return row;
  });
}

/* -------------------------------------------------------------------------- */
/*  THE SOFTMAX TRAINER                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Train the FOUR REGIME HEADS JOINTLY, the way the cortex reads them.
 *
 * The regime heads are consumed as a 4-way softmax:
 *
 *     regimeProbs = softmax4(rawHeads[2], rawHeads[3], rawHeads[4], rawHeads[5])
 *
 * so what matters is their RELATIVE values, not their absolute ones. Fitting
 * them as four independent regressions (which is what the ridge solver does)
 * is the wrong objective: it can produce four heads that each approximate
 * their target and still give the wrong ARGMAX — which is exactly what
 * `dominantRegime` reports. The measured symptom was `trendUp` for a
 * -1.0 downtrend.
 *
 * The right objective is a cross-entropy on the softmax. The gradient of
 * cross-entropy with respect to the four heads is beautifully simple:
 *
 *     dL/dh_k = p_k - y_k
 *
 * where `p` is the softmax output and `y` is the one-hot target. So the
 * readout is trained by gradient descent on that gradient — a linear model
 * with a convex objective, which converges and cannot diverge.
 *
 * This is plain gradient descent, not a dependency: no autograd, no GPU, no
 * framework. It is deterministic (the episodes are visited in a fixed order),
 * so the same episodes always produce the same weights.
 *
 * @param {object} params
 * @param {ReadoutEpisode[]} params.episodes
 * @param {number[]} params.liquidSize
 * @param {number[]} params.initWeights  the initial weights, [unit][head]
 * @param {number[]} params.initBias
 * @param {number} [params.learningRate]
 * @param {number} [params.epochs]
 * @returns {{ weights: number[][], bias: number[], loss: number }}
 */
export function trainRegimeHeads({
  episodes = [],
  initWeights = [],
  initBias = [],
  learningRate = 0.05,
  epochs = 400
} = {}) {
  /*
   * The episodes may arrive with a liquid state in any of the shapes the
   * cortex produces: an array, a Float32Array, or — after a snapshot/restore
   * cycle — a plain object with numeric keys. `Array.from()` on that object
   * yields an array of `undefined`, which becomes NaN in the normal
   * equations and a ridge solve over NaN returns NaN weights that LOOK
   * trained (ok: true) and predict nothing.
   */
  const toVector = (v) => {
    if (!v) return null;
    if (Array.isArray(v)) return v.map((x) => Number(x) || 0);
    if (ArrayBuffer.isView(v)) return Array.from(v, (x) => Number(x) || 0);
    if (typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => /^-?\d+$/.test(k)).map(Number).sort((a, b) => a - b);
      if (!keys.length) return null;
      return keys.map((k) => Number(v[k]) || 0);
    }
    return null;
  };

  const rows = episodes.map((ep) => toVector(ep?.liquidState) || []);
  const d = rows[0]?.length || 0;
  const REGIMES = ['trendUp', 'trendDown', 'meanRevert', 'shock'];
  if (!d || !rows.length) return { weights: initWeights, bias: initBias, loss: null };

  const w = initWeights.map((row) => row.slice());
  const b = initBias.slice();
  /*
   * The weight matrix carries a trailing BIAS row — the last row is the
   * readout's bias, one entry per head — so it has d + 1 rows for d liquid
   * units. The descent updates the d unit rows; the bias is a separate
   * vector.
   */
  const unitRows = Math.min(d, Math.max(0, w.length - 1));
  const heads = [HEAD_MAP.regimeUp, HEAD_MAP.regimeDown, HEAD_MAP.regimeRevert, HEAD_MAP.regimeShock];

  /*
   * The gradient buffer is as WIDE AS THE WHOLE READOUT, not as wide as the
   * four regime heads.
   *
   * The readout has SIX heads (directional, volatility, and four regimes),
   * but the gradient was allocated with the width of the regime group
   * alone — four. So the gradient for heads 4 and 5 was `undefined`, and
   * `w[i][head] -= lr * undefined` made those two weights NaN.
   *
   * The symptom was silent and nasty: the trainer reported a good loss and
   * `ok: true`, but two of the four regime heads were NaN. In the live
   * cortex that meant `regimeProbs` had two NaN entries, the softmax of
   * them was NaN, and `dominantRegime` fell back to whatever survived.
   *
   * The buffer width is now taken from the weight matrix itself, so it
   * cannot drift out of step with it again.
   */
  const headCount = w[0]?.length || 6;
  const zero = new Array(headCount).fill(0);
  let loss = 0;

  for (let ep = 0; ep < epochs; ep += 1) {
    /* The buffer is as wide as the WHOLE readout — not as wide as the four
       regime heads — and as tall as the UNIT rows, not the bias row. */
    const gradW = w.map(() => zero.slice());
    const gradB = zero.slice();
    let epLoss = 0;

    for (let k = 0; k < rows.length; k += 1) {
      const x = rows[k];
      const raw = heads.map((h) => {
        let acc = b[h] || 0;
        for (let i = 0; i < unitRows; i += 1) acc += (w[i]?.[h] || 0) * x[i];
        return acc;
      });
      /* softmax over the four heads */
      const maxRaw = Math.max(...raw);
      const exps = raw.map((r) => Math.exp(r - maxRaw));
      const sum = exps.reduce((a, v) => a + v, 0) || 1;
      const p = exps.map((e) => e / sum);

      const y = new Array(4).fill(0);
      y[Math.max(0, REGIMES.indexOf(episodes[k].regime))] = 1;
      epLoss += -Math.log(Math.max(1e-9, p[y.indexOf(1)]));
      for (let c = 0; c < 4; c += 1) {
        const g = p[c] - y[c];
        for (let i = 0; i < unitRows; i += 1) gradW[i][heads[c]] += g * x[i];
        gradB[heads[c]] += g;
      }
    }

    const n = rows.length;
    for (let i = 0; i < unitRows; i += 1) {
      for (let c = 0; c < 4; c += 1) {
        const g = gradW[i][heads[c]];
        if (!Number.isFinite(g)) continue;
        w[i][heads[c]] -= learningRate * (g / n);
      }
    }
    for (let c = 0; c < 4; c += 1) {
      const g = gradB[c];
      if (!Number.isFinite(g)) continue;
      b[heads[c]] -= learningRate * (g / n);
    }
    loss = epLoss / n;
  }

  return { weights: w, bias: b, loss };
}

/* -------------------------------------------------------------------------- */
/*  THE TRAINER                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Train the readout over a set of episodes.
 *
 * The result is a set of weights and biases for the heads that were trained.
 * The caller decides what to do with them — this function does not touch the
 * genome, because a trainer that mutates the running cortex is a trainer
 * that can break a live deployment.
 *
 * @param {object} params
 * @param {ReadoutEpisode[]} params.episodes
 * @param {number} [params.lambda] the ridge penalty
 * @returns {object} the trained weights, plus the quality of the fit
 */
export function trainReadout({ episodes = [], lambda = 1e-2, normalize = true } = {}) {
  /*
   * The liquid state arrives in whichever shape the caller had it: a
   * Float32Array, a plain array, or — after a snapshot/restore cycle — a
   * plain OBJECT with numeric keys ("0", "1", …).
   *
   * `Array.from()` on that object yields an array of `undefined`, which
   * becomes NaN in the normal equations, and a ridge solve over NaN returns
   * NaN weights that LOOK trained (ok: true) and predict nothing. So the
   * state is normalised here, and a state that cannot be read is DROPPED
   * rather than poisoning the solve.
   */
  const toVector = (v) => {
    if (!v) return null;
    if (Array.isArray(v)) return v.map((x) => Number(x) || 0);
    if (ArrayBuffer.isView(v)) return Array.from(v, (x) => Number(x) || 0);
    if (typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => /^-?\d+$/.test(k)).map(Number).sort((a, b) => a - b);
      if (!keys.length) return null;
      return keys.map((k) => Number(v[k]) || 0);
    }
    return null;
  };

  const usable = episodes
    .map((ep) => {
      const vec = toVector(ep?.liquidState);
      if (!vec || !vec.length) return null;
      if (vec.some((x) => !Number.isFinite(x))) return null;
      return { ...ep, liquidState: vec };
    })
    .filter(Boolean);
  if (usable.length < 4) {
    return {
      schema: READOUT_TRAINER_SCHEMA,
      ok: false,
      reason: `need at least 4 episodes, got ${usable.length}`,
      episodes: usable.length
    };
  }

  const rawRows = usable.map((ep) => Array.from(ep.liquidState, (v) => Number(v) || 0));

  /*
   * ─── THE LIQUID-STATE NORMALISATION ───────────────────────────────────────
   * The liquid state is all-positive and small (measured: 0.03 to 0.33, mean
   * 0.155). The class separation inside it is real but SMALL: the mean
   * difference between a rising and a falling episode was 0.090 at its
   * largest, against a within-class spread of the same order.
   *
   * A linear readout on those raw numbers has to work with a signal of
   * 0.09 buried in a 0.3-wide range, so it needs large weights, and large
   * weights on a small signal are what makes a fit brittle.
   *
   * Centring and scaling each liquid unit by its own mean and standard
   * deviation removes that scale problem: the separation becomes a
   * measured number of standard deviations, and the readout learns it
   * directly. This is standard practice in reservoir computing, and it is
   * what lets the SAME readout weights generalise across episodes with
   * different volatility.
   *
   * The statistics are computed from the TRAINING episodes only, so the
   * transform leaks nothing from a held-out episode.
   */
  let rows = rawRows;
  let stats = null;
  if (normalize && rawRows.length > 1) {
    const d = rawRows[0].length;
    const mean = new Array(d).fill(0);
    const std = new Array(d).fill(0);
    for (const row of rawRows) for (let i = 0; i < d; i += 1) mean[i] += row[i];
    for (let i = 0; i < d; i += 1) mean[i] /= rawRows.length;
    for (const row of rawRows) for (let i = 0; i < d; i += 1) std[i] += (row[i] - mean[i]) ** 2;
    for (let i = 0; i < d; i += 1) std[i] = Math.sqrt(std[i] / rawRows.length) || 1;
    rows = rawRows.map((row) => row.map((v, i) => (v - mean[i]) / std[i]));
    stats = { mean, std };
  }

  const targets = buildTargets(usable);

  /* A bias column, so the readout can have an offset. */
  const design = rows.map((r) => [...r, 1]);
  const w = solveRidge(design, targets, lambda);
  if (!w) {
    return {
      schema: READOUT_TRAINER_SCHEMA,
      ok: false,
      reason: 'the normal equations are singular — the episodes do not span the liquid state',
      episodes: usable.length
    };
  }

  /* The fit, measured: the mean absolute error per head, and the
     DIRECTIONAL correlation — the one number that says whether the readout
     can now read a direction at all. */
  const perHead = [];
  for (let h = 0; h < targets[0].length; h += 1) {
    let abs = 0;
    for (let k = 0; k < design.length; k += 1) {
      let pred = 0;
      for (let i = 0; i < design[k].length; i += 1) pred += design[k][i] * w[i][h];
      abs += Math.abs(pred - targets[k][h]);
    }
    perHead.push({ head: h, mae: Number((abs / design.length).toFixed(5)) });
  }

  /*
   * The regime heads are then trained JOINTLY on the softmax, starting from
   * the ridge solution. The ridge fit gives them a sensible scale; the
   * softmax fit then makes their RELATIVE values — which is what
   * `dominantRegime` reads — agree with the labels.
   */
  /*
   * The regime heads start from a CLEAN SLATE, not from the ridge solution.
   *
   * The ridge fit fits each head to its own target INDEPENDENTLY, which is
   * the wrong objective for a softmax: it produces four heads that each
   * approximate a number instead of four heads that AGREE on a distribution.
   * Starting the softmax descent from those weights inherits the mismatch —
   * measured: the regime loss stalled at 0.93 with the probabilities nearly
   * uniform (0.32 / 0.15 / 0.18 / 0.36), so `dominantRegime` was still
   * essentially random.
   *
   * So the four regime heads are zeroed before the softmax descent, and
   * only they are trained by it. The directional and volatility heads keep
   * their ridge solution — for those, independent regression IS the right
   * objective, because they are read as separate scalars.
   */
  const cleanWeights = w.map((row) => row.slice());
  const cleanBias = w[w.length - 1].slice();
  for (let i = 0; i < cleanWeights.length; i += 1) {
    for (let c = 0; c < 4; c += 1) {
      cleanWeights[i][HEAD_MAP.regimeUp + c] = 0;
    }
  }
  for (let c = 0; c < 4; c += 1) cleanBias[HEAD_MAP.regimeUp + c] = 0;

  const regime = trainRegimeHeads({
    episodes: usable.map((ep, i) => ({ ...ep, liquidState: rows[i] })),
    initWeights: cleanWeights,
    initBias: cleanBias,
    learningRate: 0.02,
    epochs: 2000
  });

  const dirHead = HEAD_MAP.directional;
  let sumXY = 0; let sumX = 0; let sumY = 0; let sumXX = 0; let sumYY = 0;
  for (let k = 0; k < design.length; k += 1) {
    let pred = 0;
    for (let i = 0; i < design[k].length; i += 1) pred += design[k][i] * w[i][dirHead];
    sumXY += pred * targets[k][dirHead];
    sumX += pred; sumY += targets[k][dirHead];
    sumXX += pred * pred; sumYY += targets[k][dirHead] * targets[k][dirHead];
  }
  const n = design.length;
  const cov = sumXY - (sumX * sumY) / n;
  const varX = sumXX - (sumX * sumX) / n;
  const varY = sumYY - (sumY * sumY) / n;
  const corr = (varX > 0 && varY > 0) ? cov / Math.sqrt(varX * varY) : 0;

  return {
    schema: READOUT_TRAINER_SCHEMA,
    ok: true,
    episodes: usable.length,
    /* `weights[i]` is the weight vector for liquid unit i; the LAST entry is
       the bias. `bias[h]` is the readout bias for head h. */
    weights: regime.weights.map((row) => row.map((v) => Number(v.toFixed(6)))),
    bias: regime.bias.map((v) => Number(v.toFixed(6))),
    regimeLoss: Number.isFinite(regime.loss) ? Number(regime.loss.toFixed(5)) : null,
    /* The normalisation statistics, so a live cortex can reproduce the
       transform the readout was trained under. Without them the weights
       would be applied to raw liquid states and would be meaningless. */
    normalization: stats
      ? { mean: stats.mean.map((v) => Number(v.toFixed(6))), std: stats.std.map((v) => Number(v.toFixed(6))) }
      : null,
    headMap: HEAD_MAP,
    quality: {
      directionalCorrelation: Number(corr.toFixed(4)),
      perHeadMae: perHead
    }
  };
}

/* -------------------------------------------------------------------------- */
/*  THE GENOME PATCH                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Write trained readout weights back into the genome.
 *
 * The genome layout (`SWARM_PARAM_LAYOUT` in cortexCore.js) is:
 *
 *     readoutW:  READOUT_DIM × LIQUID_SIZE   (12 × 32 = 384)
 *     readoutBias: READOUT_DIM               (12)
 *
 * and the readout rows are stored ROW-MAJOR by head: `outRow = OFF_OUT +
 * r * LIQUID_SIZE`, and within a row the unit index runs fastest. So the
 * trained weight for head r, unit m lives at `OFF_OUT + r * LIQUID_SIZE + m`.
 *
 * The trainer's `weights` is indexed `[unit][head]` — the natural layout for
 * a least-squares solve — so it is TRANSPOSED here. Getting this wrong is
 * silent, so the transposition is done explicitly and the unit count is
 * checked.
 *
 * @param {Float32Array} swarm   the genome, modified in place
 * @param {object} trained        the result of `trainReadout`
 * @param {object} layout         SWARM_PARAM_LAYOUT
 * @returns {{ patched: boolean, reason?: string, heads: number[] }}
 */
/**
 * Apply a trained readout to a genome's weight vector.
 *
 * ─── THE INSTALL RULE ──────────────────────────────────────────────────────
 * `cortex.getSwarmWeights()` returns a COPY (`new Float32Array(swarm)`), so a
 * patch written into that copy never reaches the cortex. The ONLY way a
 * trained readout reaches the running cortex is through
 * `cortex.setSwarmWeights(next)`.
 *
 * So this function patches IN PLACE and the caller must re-read and install:
 *
 *     const patched = cortex.getSwarmWeights();
 *     applyTrainedReadout(patched, trained, layout);
 *     cortex.setSwarmWeights(patched);      // ← the line that makes it stick
 *
 * `buildTrainedSwarm` does both steps and is the safer API to use.
 *
 * @param {Float32Array} swarm   the weight vector to patch, IN PLACE
 * @param {object} trained       the result of `trainReadout`
 * @param {object} layout        the genome layout offsets
 * @returns {{ patched: boolean, heads: number[], reason?: string, normalizationFolded?: boolean }}
 */
export function applyTrainedReadout(swarm, trained, layout) {
  if (!swarm || !trained?.ok) return { patched: false, reason: 'nothing to apply' };
  if (!layout?.readoutW || !layout?.readoutBias) return { patched: false, reason: 'no layout' };

  const liquidSize = layout.liquidSize ?? 32;
  const dim = layout.readoutDim ?? 12;
  const offW = layout.readoutW;
  const offB = layout.readoutBias;

  if (trained.weights.length !== liquidSize + 1) {
    return { patched: false, reason: `the trained weight matrix is ${trained.weights.length} rows, expected ${liquidSize + 1}` };
  }

  /*
   * ─── FOLDING THE NORMALISATION INTO THE WEIGHTS ──────────────────────────
   * The readout was trained on NORMALISED liquid states:
   *
   *     x' = (x - mean) / std
   *
   * but the live cortex computes the RAW liquid state and applies the
   * genome's weights to it directly. Patching the normalised weights in
   * would therefore apply them to the wrong numbers — the cortex would read
   * direction from noise.
   *
   * The normalisation can be folded into the weights ALGEBRAICALLY, so the
   * live cortex needs no change at all:
   *
   *     w . x' + b = (w / std) . x  +  (b - w . mean / std)
   *
   * So the patched weight is `w / std` and the patched bias is
   * `b - (w . mean) / std`. One affine change to two vectors, and the
   * genome now computes exactly what the trainer fitted.
   */
  const norm = trained.normalization;
  const useNorm = norm
    && Array.isArray(norm.mean) && Array.isArray(norm.std)
    && norm.mean.length === liquidSize && norm.std.length === liquidSize;

  const heads = [];
  const headCount = Math.min(trained.bias.length, dim);
  for (let r = 0; r < headCount; r += 1) {
    /* The trained solution is [unit][head]; the genome wants [head][unit]. */
    for (let m = 0; m < liquidSize; m += 1) {
      const w = trained.weights[m][r];
      if (!Number.isFinite(w)) continue;
      const sd = useNorm ? (norm.std[m] || 1) : 1;
      const v = useNorm ? w / sd : w;
      if (!Number.isFinite(v)) continue;
      swarm[offW + r * liquidSize + m] = v;
    }
    let b = trained.bias[r];
    if (useNorm && Number.isFinite(b)) {
      /* b' = b - sum_m (w_m / std_m) * mean_m */
      let shift = 0;
      for (let m = 0; m < liquidSize; m += 1) {
        const w = trained.weights[m][r];
        if (!Number.isFinite(w)) continue;
        shift += (w / (norm.std[m] || 1)) * norm.mean[m];
      }
      b -= shift;
    }
    if (Number.isFinite(b)) swarm[offB + r] = b;
    heads.push(r);
  }
  return { patched: true, heads, normalizationFolded: useNorm };
}

/**
 * Build a COMPLETE weight vector with a trained readout already installed.
 *
 * Unlike `applyTrainedReadout`, which patches an array the caller already
 * holds, this returns a fresh array that can be handed straight to
 * `cortex.setSwarmWeights(...)` — so the trained readout cannot be lost in
 * the copy that `getSwarmWeights()` hands back.
 *
 * @param {Float32Array} swarm   the current weight vector (a copy is made)
 * @param {object} trained       the result of `trainReadout`
 * @param {object} layout        the genome layout offsets
 * @returns {{ weights: Float32Array|null, applied: object }}
 */
export function buildTrainedSwarm(swarm, trained, layout) {
  if (!swarm) return { weights: null, applied: { patched: false, reason: 'no swarm' } };
  const next = new Float32Array(swarm);
  const applied = applyTrainedReadout(next, trained, layout);
  return { weights: applied.patched ? next : null, applied };
}
