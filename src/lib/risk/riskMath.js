/**
 * FBT AI RISK ENGINE — THE MATH, AND NOTHING BUT THE MATH
 * ===========================================================================
 * Every number this module returns is a formula with a NAME and its ASSUMPTIONS
 * attached, because the one thing a risk engine must never do is hand a user a
 * confident-looking decimal that nobody can reproduce.
 *
 * ─── WHAT IS MODELLED HERE, AND HOW ─────────────────────────────────────────
 *   sigmaFromSeries()   realised volatility from a real price series. Not a
 *                       forecast: the standard deviation of what already
 *                       happened, scaled to a day.
 *   normalCdf()         the error function (Abramowitz–Stegun 7.1.26, |ε|<1.5e-7).
 *   probTouch()         P(a barrier at distance d is touched within H days)
 *                       under a DRIFTLESS GBM with the measured sigma
 *                       (reflection principle: 2·(1−Φ(d/(σ√H)))). It is a
 *                       model answer, not a prediction, and the caller prints
 *                       `model` beside it.
 *   parametricVar()     σ_p = √(ΣᵢΣⱼ wᵢwⱼσᵢσⱼρᵢⱼ), VaR = z·σ_p, ES = σ_p·φ(z)/(1−α).
 *                       Pairs whose correlation was NOT measured are taken at
 *                       ρ = 1 — no diversification credit for a number we did
 *                       not observe. `correlationCredit` reports how many pairs
 *                       were actually measured.
 *   mulberry32()        the deterministic PRNG the Monte-Carlo paths use. No
 *                       Math.random anywhere: the same evidence must always
 *                       produce the same risk report, or a test cannot pin it
 *                       and a user cannot reproduce last week's reading.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 * No value is ever invented for a missing input. Every function returns `null`
 * (or a `null` field inside an object) when the data behind it did not arrive,
 * and the callers are required to print an em dash. A 0 would be read as "no
 * risk", which is the one wrong answer that costs money.
 */

export const RISK_MATH_VERSION = 'fbt.risk-math.1';

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Coerce to a finite number, else null. `Number(null)` is 0 — the trap. */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const round = (v, digits = 2) => {
  if (!isNum(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const mean = (values = []) => {
  const list = values.filter(isNum);
  if (!list.length) return null;
  return list.reduce((s, v) => s + v, 0) / list.length;
};

/** Sample standard deviation (n−1). Below two samples the answer is null. */
export const stdev = (values = []) => {
  const list = values.filter(isNum);
  if (list.length < 2) return null;
  const m = list.reduce((s, v) => s + v, 0) / list.length;
  const varr = list.reduce((s, v) => s + (v - m) ** 2, 0) / (list.length - 1);
  return Math.sqrt(varr);
};

/** Simple (arithmetic) returns of a price series, skipping unusable points. */
export function returnsOf(series = []) {
  const out = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = Number(series[i - 1]);
    const cur = Number(series[i]);
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0 || cur <= 0) continue;
    out.push(((cur - prev) / prev) * 100);
  }
  return out;
}

/**
 * Daily volatility (in %) from a series of per-period returns of known spacing.
 *
 * @param {number[]} returnsPct  returns in percent
 * @param {number}   periodsPerDay  how many of those returns fit in a day
 *                                  (24 for hourly points, 1 for daily closes)
 */
export function sigmaFromSeries(returnsPct = [], periodsPerDay = 1) {
  const sd = stdev(returnsPct);
  if (sd == null) return null;
  const perDay = Math.max(1, Number(periodsPerDay) || 1);
  return sd * Math.sqrt(perDay);
}

/**
 * Resample an evenly-spaced price sparkline into DAILY closes and return the
 * daily volatility (%).
 *
 * The market feed already carries `sparkline` (7 days, thinned by the server to
 * roughly 24–168 points). That is real observed data — no extra request — and
 * it is enough to answer "how hard does this asset actually move in a day?".
 * When the series is too short or too coarse to bucket into days, the answer is
 * `null` rather than a guess.
 */
export function sigmaFromSparkline(sparkline = [], { days = 7, minPoints = 8 } = {}) {
  const points = (Array.isArray(sparkline) ? sparkline : []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (points.length < minPoints || days < 2) return null;
  const perBucket = Math.floor(points.length / days);
  if (perBucket < 2) return null;
  const closes = [];
  for (let d = 0; d < days; d += 1) {
    const slice = points.slice(d * perBucket, (d + 1) * perBucket);
    if (!slice.length) continue;
    closes.push(slice[slice.length - 1]);
  }
  if (closes.length < 3) return null;
  const sigma = stdev(returnsOf(closes));
  return sigma == null ? null : { sigmaPct: sigma, days: closes.length, points: points.length };
}

/* ── the normal distribution ─────────────────────────────────────────────── */

const ERF_A = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
const ERF_P = 0.3275911;

/** erf(x) — Abramowitz & Stegun 7.1.26, max abs error 1.5e-7. */
export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + ERF_P * ax);
  const y = 1 - (((((ERF_A[4] * t + ERF_A[3]) * t) + ERF_A[2]) * t + ERF_A[1]) * t + ERF_A[0]) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Standard normal PDF — needed for expected shortfall. */
export const normalPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/* Two-sided z for the confidences a risk screen actually quotes. */
export const Z_BY_CONFIDENCE = Object.freeze({ 0.9: 1.2816, 0.95: 1.6449, 0.99: 2.3263 });

/**
 * Probability that a price barrier `distancePct` away is TOUCHED within
 * `horizonDays`, under a driftless random walk with the measured daily sigma.
 *
 * This is the honest version of "احتمال آن چقدر است": it is a model probability
 * conditional on (a) the volatility staying where it was measured and (b) no
 * drift. Both assumptions are printed by the UI next to the number. With no
 * measured sigma the answer is null — never 0%, never 50%.
 */
export function probTouch({ sigmaDailyPct = null, distancePct = null, horizonDays = 1 } = {}) {
  const s = num(sigmaDailyPct);
  const d = num(distancePct);
  const h = num(horizonDays);
  if (s == null || d == null || h == null || s <= 0 || d <= 0 || h <= 0) return null;
  const z = d / (s * Math.sqrt(h));
  const p = 2 * (1 - normalCdf(z));
  return clamp(p, 0, 1);
}

/* ── portfolio variance / VaR ─────────────────────────────────────────────── */

/**
 * Portfolio sigma and parametric VaR/ES.
 *
 * @param {object} input
 * @param {Array}  input.legs   [{ symbol, weight (0..100), sigmaPct|null }]
 * @param {Array}  input.pairs  [{ a, b, r }] measured correlations (optional)
 * @param {number} input.confidence 0.95 default
 * @param {number} input.horizonDays 1 default
 *
 * Pairs that were not measured are taken at ρ = 1 and COUNTED in
 * `unmeasuredPairs`, so the UI can say "no diversification credit was applied
 * to 3 of 6 pairs" instead of quietly reporting a small number.
 */
export function parametricVar({ legs = [], pairs = [], confidence = 0.95, horizonDays = 1 } = {}) {
  const usable = (Array.isArray(legs) ? legs : [])
    .map((l) => ({ symbol: String(l.symbol || ''), weight: num(l.weight), sigmaPct: num(l.sigmaPct) }))
    .filter((l) => l.weight != null && l.weight > 0 && l.sigmaPct != null && l.sigmaPct >= 0);
  if (!usable.length) {
    return { ok: false, reason: 'NO_VOLATILITY', sigmaPct: null, varPct: null, esPct: null, coveredWeightPct: 0 };
  }
  const coveredWeight = usable.reduce((s, l) => s + l.weight, 0);
  const wSum = usable.reduce((s, l) => s + l.weight, 0);
  const norm = usable.map((l) => ({ ...l, w: l.weight / wSum }));

  const corrFor = (a, b) => {
    if (a === b) return 1;
    const hit = (Array.isArray(pairs) ? pairs : []).find(
      (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)
    );
    if (hit && isNum(Number(hit.r))) return clamp(Number(hit.r), -1, 1);
    return null;
  };

  let variance = 0;
  let measuredPairs = 0;
  let unmeasuredPairs = 0;
  for (let i = 0; i < norm.length; i += 1) {
    for (let j = 0; j < norm.length; j += 1) {
      const rho = corrFor(norm[i].symbol, norm[j].symbol);
      if (i !== j) {
        if (rho == null) unmeasuredPairs += 1;
        else measuredPairs += 1;
      }
      const use = rho == null ? 1 : rho;
      variance += norm[i].w * norm[j].w * norm[i].sigmaPct * norm[j].sigmaPct * use;
    }
  }
  /* Every off-diagonal pair is visited twice (i,j) and (j,i); report unique. */
  const uniqueMeasured = Math.floor(measuredPairs / 2);
  const uniqueUnmeasured = Math.floor(unmeasuredPairs / 2);

  const sigmaPct = Math.sqrt(Math.max(0, variance)) * Math.sqrt(Math.max(1, numberOr(horizonDays, 1)));
  const z = Z_BY_CONFIDENCE[confidence] ?? Z_BY_CONFIDENCE[0.95];
  const varPct = sigmaPct * z;
  const esPct = sigmaPct * (normalPdf(z) / (1 - confidence));

  return {
    ok: true,
    model: 'parametric-normal',
    confidence,
    horizonDays: numberOr(horizonDays, 1),
    sigmaPct: round(sigmaPct, 3),
    varPct: round(varPct, 3),
    esPct: round(esPct, 3),
    coveredWeightPct: round(coveredWeight, 2),
    measuredPairs: uniqueMeasured,
    unmeasuredPairs: uniqueUnmeasured,
    /* True when EVERY pair was measured — the only case in which the number
       carries diversification credit it actually observed. */
    fullyMeasured: uniqueUnmeasured === 0
  };
}

const numberOr = (v, fallback) => (isNum(Number(v)) ? Number(v) : fallback);

/* ── deterministic Monte-Carlo (used only where a distribution is stated) ─── */

/** Mulberry32: 32-bit, seeded, fast, reproducible. No Math.random. */
export function mulberry32(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller from a seeded uniform source. Deterministic by construction. */
export function gaussianFrom(rand) {
  let spare = null;
  return function next() {
    if (spare != null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Monte-Carlo of a one-factor shocked book — used by the stress centre.
 *
 * Every leg moves by `beta · marketShock · N(0,1)` plus its own idiosyncratic
 * term, so the simulated distribution has the shape the parametric model
 * assumes. It is a SIMULATION OF THE MODEL, not of the market, and the UI says
 * so; it earns its place because it also produces the tail count
 * ("in 4.1% of 4,000 paths the book lost more than $1,200") that a single
 * parametric number cannot express.
 */
export function simulateBook({
  legs = [], paths = 4000, horizonDays = 1, seed = 0x5eed1234, shockMeanPct = null
} = {}) {
  const usable = (Array.isArray(legs) ? legs : []).filter(
    (l) => num(l.valueUsd) != null && num(l.valueUsd) > 0
  );
  if (!usable.length) return { ok: false, reason: 'NO_VALUE', paths: 0 };
  const total = usable.reduce((s, l) => s + Number(l.valueUsd), 0);
  const rand = mulberry32(seed);
  const gauss = gaussianFrom(rand);
  const n = Math.max(200, Math.min(20000, Number(paths) || 4000));
  const results = [];
  for (let p = 0; p < n; p += 1) {
    const marketZ = gauss();
    let value = 0;
    for (const leg of usable) {
      const beta = num(leg.beta) ?? 1;
      const sigma = Math.max(0, num(leg.sigmaPct) ?? 0);
      const idio = (num(leg.idioPct) ?? sigma * 0.35) * gauss();
      const shockPct = (shockMeanPct ?? 0) + beta * sigma * marketZ + idio;
      value += Number(leg.valueUsd) * (1 + shockPct / 100);
    }
    results.push(value);
  }
  results.sort((a, b) => a - b);
  const at = (q) => results[clamp(Math.floor(q * (results.length - 1)), 0, results.length - 1)];
  const losses = results.map((v) => total - v).filter((l) => l > 0);
  return {
    ok: true,
    model: 'one-factor-gaussian-monte-carlo',
    paths: n,
    seed,
    horizonDays,
    totalUsd: round(total, 2),
    p05Usd: round(at(0.05), 2),
    p50Usd: round(at(0.5), 2),
    p95Usd: round(at(0.95), 2),
    worstUsd: round(results[0], 2),
    lossProbPct: round((results.filter((v) => v < total).length / results.length) * 100, 2),
    meanLossUsd: losses.length ? round(losses.reduce((s, l) => s + l, 0) / losses.length, 2) : 0
  };
}
