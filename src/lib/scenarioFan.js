/**
 * SCENARIO FAN — «سناریوهای احتمالی»
 * ===========================================================================
 * The page has a scenario block that answers ONE question with historical
 * frequencies: over this token's own past, how often did a `horizon`-day move
 * land above / inside / below a band? That is a real measurement and it stays.
 *
 * What it cannot answer is the question a reader actually asks before acting:
 * «and GIVEN what the market is doing right now, which of those futures is
 *  likelier — and how much do I lose if I am wrong?»
 *
 * ─── THE METHOD, AND WHY IT IS NOT A FITTED MODEL ──────────────────────────
 * 1. Take the EMPIRICAL distribution: every overlapping `horizon`-day return in
 *    the token's own history. No assumed shape, no normal curve.
 * 2. Re-weight those returns by how much each one resembles the CURRENT state
 *    of the four planes the consensus reads (technical score, tape behaviour,
 *    smart-money lean, market lean). Resemblance is a simple, bounded kernel —
 *    a return from a period whose state was similar to today counts more.
 *    This is nearest-neighbour re-weighting, the oldest honest method there is:
 *    it cannot extrapolate beyond the returns that actually happened, and every
 *    weight is visible.
 * 3. Report the three outcomes, the LOSS if the adverse path happens (so a
 *    probability is never printed without its cost), and the effective sample
 *    size — how many historical windows genuinely contributed after weighting.
 *
 * ─── GUARDS THAT MAKE IT HONEST ────────────────────────────────────────────
 * • Under `MIN_SAMPLES` windows, or when the weights collapse onto a handful of
 *   look-alikes (`effectiveN` too small), it returns `null`. A 71% from six
 *   observations is a lie with a decimal point.
 * • The weighting cannot invent a return that did not happen: it only changes
 *   the MULTIPLICITY of real ones, and no return is ever reconstructed.
 * • The probabilities are labelled as conditional frequencies, never as
 *   forecasts, and the note says which planes did the weighting.
 * • Pure arithmetic over a series the page already holds. No request, no timer,
 *   no storage. Cost: one pass over the series, O(n × samples) bounded below.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clampf = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Minimum raw windows before any probability is printed at all. */
export const MIN_SAMPLES = 24;
/** Below this, the weights are too concentrated for the answer to mean much. */
export const MIN_EFFECTIVE = 12;
/** How far the state kernel reaches. Small on purpose: look-alikes, not vibes. */
export const STATE_BANDWIDTH = 25;

/**
 * The current state, as one number per plane, each on a −100…+100 scale.
 * Missing planes are simply absent — they contribute no distance term.
 */
function stateVector({ technical = null, behavior = null, smartMoney = null, market = null } = {}) {
  const v = {};
  const t = num(technical);
  if (t !== null) v.technical = clampf(t, -100, 100);
  const b = behavior && num(behavior.score) !== null && (behavior.parts ?? 0) > 0 ? num(behavior.score) : null;
  if (b !== null) v.behavior = clampf(b, -100, 100);
  const s = smartMoney;
  if (s && typeof s === 'object') {
    const flow = num(s.netUsd) ?? num(s.netFlowUsd);
    if (flow !== null && flow !== 0) {
      /* Same log-scale direction the consensus uses, on the same axis. */
      v.smartMoney = clampf(Math.sign(flow) * Math.min(100, 25 + Math.log10(1 + Math.abs(flow) / 10_000) * 25), -100, 100);
    }
  }
  const m = market;
  if (m && typeof m === 'object') {
    const mcap = num(m.mcapChange);
    const breadth = num(m.breadth);
    const fc = num(m.forecast);
    const parts = [];
    if (mcap !== null) parts.push(clampf(mcap * 20, -60, 60));
    if (breadth !== null) parts.push(clampf((breadth - 0.5) * 200, -60, 60));
    if (fc !== null) parts.push(clampf(fc * 20, -60, 60));
    if (parts.length) v.market = parts.reduce((a, x) => a + x, 0) / parts.length;
  }
  return v;
}

/** Distance between two state vectors, over the planes BOTH of them measured. */
function stateDistance(a, b) {
  const keys = Object.keys(a).filter((k) => k in b);
  if (!keys.length) return null;
  const sum = keys.reduce((acc, k) => acc + ((a[k] - b[k]) / 100) ** 2, 0);
  return Math.sqrt(sum / keys.length) * 100;
}

/**
 * Historical state at index `i`, from the same series (no look-ahead).
 *
 * The four planes cannot be reconstructed from prices alone — smart money and
 * the market read are not in the series. What CAN be reconstructed is the
 * technical plane: a short-window momentum/trend score over the bars that end
 * at `i`. The other planes are represented by their SIGN only, applied as a
 * global tilt; see `reweight`. This is stated plainly rather than dressed up:
 * the conditional part of this model is technical-state conditioned.
 */
function technicalStateAt(v, i) {
  if (i < 20) return null;
  const now = v[i];
  const ago20 = v[i - 20];
  const ago5 = v[i - 5];
  if (!(now > 0) || !(ago20 > 0) || !(ago5 > 0)) return null;
  const r20 = ((now - ago20) / ago20) * 100;
  const r5 = ((now - ago5) / ago5) * 100;
  return clampf(r20 * 6 + r5 * 4, -100, 100);
}

/**
 * @param {object} input
 * @param {number[]} input.series     chronological prices
 * @param {number}   input.horizon    days/bars ahead
 * @param {number}   input.bandPct    the neutral band, in %
 * @param {object=}  input.technical  current technical read (analysis.score)
 * @param {object=}  input.behavior   `readTokenBehavior` output
 * @param {object=}  input.smartMoney `{ signal, netUsd, confidence }`
 * @param {object=}  input.market     `{ mcapChange, breadth, forecast, ... }`
 * @param {number=}  input.price      current price (for the loss figure)
 *
 * @returns {null | {
 *   up:number, neutral:number, down:number, samples:number,
 *   effectiveN:number, band:number, horizon:number,
 *   weightedAvgPct:number|null, lossPct:number|null, gainPct:number|null,
 *   tilt:number, lookalikes:number, note:string
 * }}
 */
export function scenarioFan({
  series = [],
  horizon = 7,
  bandPct = 1.5,
  technical = null,
  behavior = null,
  smartMoney = null,
  market = null
} = {}) {
  const v = (series ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const h = Math.max(1, Math.round(Number(horizon) || 7));
  const band = Math.abs(Number(bandPct));
  /*
   * TWO GUARDS, NOT ONE. `v.length >= h * 4 + MIN_SAMPLES` exists because the
   * windows OVERLAP by `h` bars each: 40 prices produce 33 7-bar windows that
   * are mostly the same seven days shifted by one, and treating them as 33
   * independent observations is how a model convinces itself with four weeks
   * of data. Requiring four horizon-lengths on top of the minimum sample count
   * keeps the effective count honest.
   */
  if (v.length < h * 4 + MIN_SAMPLES || !Number.isFinite(band) || band <= 0) return null;

  /* ── 1 · the empirical distribution, no assumed shape ─────────────────── */
  const windows = [];
  for (let i = 0; i + h < v.length; i += 1) {
    const from = v[i];
    if (!(from > 0)) continue;
    windows.push({
      ret: ((v[i + h] - from) / from) * 100,
      state: technicalStateAt(v, i)
    });
  }
  if (windows.length < MIN_SAMPLES) return null;

  /* ── 2 · re-weight by resemblance to the CURRENT state ────────────────── */
  const current = stateVector({ technical, behavior, smartMoney, market });
  const currentTech = num(current.technical);
  /*
   * A global tilt from the planes that cannot be reconstructed historically.
   * It never creates a window; it can only make the look-alike band slightly
   * wider or narrower, and it is bounded to ±1 standard deviation of the
   * kernel so it cannot dominate the technical term.
   */
  const st = stateVector({ smartMoney, market, behavior });
  const extra = ['smartMoney', 'market', 'behavior']
    .map((k) => st[k])
    .filter((x) => x !== undefined);
  const tilt = extra.length ? clampf(extra.reduce((a, b) => a + b, 0) / extra.length / 100, -1, 1) : 0;

  let weightSum = 0;
  let weightSq = 0;
  let lookalikes = 0;
  const weighted = windows.map((w) => {
    let weight = 1;
    if (w.state !== null && currentTech !== null) {
      const d = Math.abs(w.state - currentTech);
      /* Gaussian-ish kernel on the distance, bandwidth STATE_BANDWIDTH. */
      weight = Math.exp(-((d / STATE_BANDWIDTH) ** 2));
      if (d <= STATE_BANDWIDTH) lookalikes += 1;
    }
    /* The tilt only sharpens or flattens the weighting, never negates it. */
    weight *= 1 + tilt * 0.25;
    weight = Math.max(1e-6, weight);
    weightSum += weight;
    weightSq += weight * weight;
    return { ...w, weight };
  });

  /* Kish effective sample size: how many windows really contributed. */
  const effectiveN = weightSq > 0 ? (weightSum * weightSum) / weightSq : 0;
  if (effectiveN < MIN_EFFECTIVE) return null;

  /* ── 3 · the three outcomes, weighted, plus their cost ────────────────── */
  let up = 0;
  let neutral = 0;
  let down = 0;
  let retSum = 0;
  let adverseSum = 0;
  let bestSum = 0;
  for (const w of weighted) {
    const share = w.weight / weightSum;
    if (w.ret > band) up += share;
    else if (w.ret < -band) down += share;
    else neutral += share;
    retSum += w.ret * share;
    /* What the reader loses on the adverse half — the number a probability
       must never be printed without. */
    adverseSum += Math.min(0, w.ret) * share;
    bestSum += Math.max(0, w.ret) * share;
  }

  const pct = (x) => Math.round(x * 1000) / 10; // one decimal, as a percentage
  const upPct = pct(up);
  const downPct = pct(down);
  return {
    up: upPct,
    neutral: pct(neutral),
    down: downPct,
    samples: windows.length,
    effectiveN: Math.round(effectiveN * 10) / 10,
    band: Math.round(band * 100) / 100,
    horizon: h,
    weightedAvgPct: Math.round(retSum * 100) / 100,
    /* Expected shortfall of the adverse half and of the favourable half, both
       conditional on that half happening. */
    lossPct: downPct > 0 ? Math.round((adverseSum / Math.max(1e-9, down)) * 100) / 100 : null,
    gainPct: upPct > 0 ? Math.round((bestSum / Math.max(1e-9, up)) * 100) / 100 : null,
    tilt: Math.round(tilt * 100) / 100,
    lookalikes,
    note: 'conditionalFrequency'
  };
}

export default scenarioFan;
