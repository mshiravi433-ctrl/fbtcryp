/**
 * FBT NEUROMORPHIC 2050 — PHASE 7: UNIVERSAL SCIENTIFIC MEMORY (USM)
 * ===========================================================================
 * The cortex already has a *local* memory: `engramMemory.js` stores up to 64
 * episodic engrams (a 32-D liquid state + one realised return). That memory can
 * say «last time the liquid state looked like this, the return was +0.4 %». It
 * can never say «this pattern beats chance», because a handful of episodes
 * cannot separate signal from luck, and because the very act of looking for a
 * pattern after seeing the data guarantees that some patterns look great.
 *
 * This module is the missing epistemic layer — not another storage bucket:
 *
 *   1. PRE-REGISTRATION. A hypothesis must exist *before* the observation it is
 *      scored against (`NOT_PREREGISTERED` otherwise). Families are fixed in
 *      code (`PRESPECIFIED_FAMILIES`), so the set of tests is not chosen after
 *      seeing the results (no HARKing, no p-hacking by bucket explosion).
 *   2. HONEST EVIDENCE CLASSES. Data that existed before the memory was created
 *      is `retrospective`: it moves belief but is discounted (0.35) and can
 *      NEVER confirm a hypothesis on its own. Only `prospective` evidence can.
 *   3. BAYESIAN BELIEF WITH CREDIBLE INTERVALS. Beta–binomial posterior with a
 *      Jeffreys prior, exact log Bayes factor against the fair-coin null, and a
 *      genuine quantile function (bisection over the regularised incomplete
 *      beta) for the 95 % credible interval.
 *   4. MULTIPLE-COMPARISON CONTROL. Benjamini–Hochberg FDR over every tested
 *      hypothesis. A "discovery" in the report means a hypothesis that survives
 *      FDR at the requested q — not merely one with a big posterior.
 *   5. UNIVERSALITY BY META-ANALYSIS. Evidence is pooled across markets and
 *      regimes with a DerSimonian–Laird random-effects model (τ², I², shrunken
 *      per-stratum estimates), so one market's small sample borrows strength
 *      from the others instead of being treated as equally trustworthy.
 *   6. PORTABLE PRIORS, NOT RAW DATA. Cross-device sharing exports only the
 *      log Bayes factor + effective counts of pre-specified families — never
 *      prices, vectors or episodes. Packets are deduplicated by provenance so
 *      the same evidence cannot vote twice.
 *   7. DECAY. Evidence halves every `halfLifeMs`. A belief that nothing keeps
 *      reproducing fades back to "inconclusive" instead of becoming immortal.
 *
 * Security & honesty laws (identical to every other neuromorphic module):
 *   · `canExecute: false`, `canSign: false`, `canMoveFunds: false` — always.
 *   · No accuracy number is invented: Brier and coverage stay `null` until real
 *     observations exist; the memory reports its *own* prequential calibration.
 *   · Sensitive material is rejected at the door (`containsSensitiveKeyOrPhrase`).
 *   · Everything here is pure, deterministic and runs offline on the device.
 */

import { createPrng } from './cortexCore.js';
import { containsSensitiveKeyOrPhrase } from '../intent-ai/orchestrator/redact.js';

export const SCIENCE_SCHEMA = 'fbt.neuromorphic.science.v1';
export const SCIENCE_PRIOR_SCHEMA = 'fbt.neuromorphic.science.prior.v1';
export const SCIENCE_VERSION = 1;

export const MAX_HYPOTHESES = 96;
export const MAX_OBSERVATIONS_PER_HYPOTHESIS = 512;
export const MAX_EXTERNAL_RECORDS = 256;
export const DEFAULT_HALF_LIFE_MS = 45 * 24 * 3600_000;
export const DEFAULT_ALPHA = 0.05;

/** Evidence weights by provenance class. Retrospective evidence is discounted. */
export const EVIDENCE_WEIGHTS = Object.freeze({ prospective: 1, retrospective: 0.35 });
export const EVIDENCE_CLASSES = Object.freeze(['prospective', 'retrospective']);

/** Kass–Raftery (1995) interpretation of log10 Bayes factors. */
export const BAYES_BANDS = Object.freeze([
  { min: 2, label: 'decisive' },
  { min: 1.5, label: 'very-strong' },
  { min: 1, label: 'strong' },
  { min: 0.5, label: 'moderate' },
  { min: 0, label: 'weak' }
]);

export const HYPOTHESIS_STATUS = Object.freeze([
  'open',
  'inconclusive',
  'supported',
  'refuted',
  'retired'
]);

export const REGIMES = Object.freeze(['trendUp', 'trendDown', 'meanRevert', 'shock']);

/**
 * The pre-specified hypothesis family. Declared in code, at build time, so no
 * bucket can be invented to fit an already-observed result. Each entry is a
 * falsifiable statement about a *sign rate*, scored with a Beta–binomial test.
 */
export const PRESPECIFIED_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'regime-positive-return',
    kind: 'sign-rate',
    direction: '+',
    description:
      'Resolved returns that follow this cortical regime are positive more often than the 50 % chance rate.',
    minSamples: 24,
    minProspective: 12
  })
]);

const FAMILY_BY_ID = new Map(PRESPECIFIED_FAMILIES.map((f) => [f.id, f]));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/* `null` must NOT count as a number here: Number(null) === 0 would silently turn
   "no timestamp supplied" into the 1970 epoch and defeat every freshness check. */
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const round = (v, d = 6) => Number(Number(v).toFixed(d));

/* ── Deterministic hashing (same FNV-1a contract as the engram bank) ───────── */

export function fnv1aHex(text) {
  const str = String(text || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Stable JSON so a record's checksum does not depend on key insertion order. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function contentHash(value) {
  return fnv1aHex(canonicalJson(value));
}

/**
 * Fast fingerprint for a numeric vector (no JSON, no allocation growth).
 * Ingesting 64 engrams × 2 scopes used to stringify the 32-D vector 128 times per
 * tick; this keeps the per-tick science cost in the low milliseconds.
 */
export function vectorFingerprint(vector) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) return '0';
  let h = 0x811c9dc5;
  h = Math.imul(h ^ vector.length, 0x01000193) >>> 0;
  for (let i = 0; i < vector.length; i += 1) {
    const q = Math.round((Number(vector[i]) || 0) * 10000) | 0;
    h = Math.imul(h ^ (q & 0xffff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((q >>> 16) & 0xffff), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* ── Special functions (log-gamma, incomplete beta, exact binomial) ────────── */

const LANCZOS = Object.freeze([
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
]);

/** Lanczos approximation of ln Γ(x), accurate to ~1e-13 over the domain used. */
export function logGamma(x) {
  const z0 = Number(x);
  if (!(z0 > 0)) return NaN;
  if (z0 < 0.5) {
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z0))) - logGamma(1 - z0);
  }
  const z = z0 - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function logBetaFn(a, b) {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function betaContinuedFraction(a, b, x) {
  const FPMIN = 1e-300;
  const EPS = 3e-14;
  const MAXIT = 400;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x, a, b) {
  const xx = Number(x);
  if (!isNum(xx)) return NaN;
  if (xx <= 0) return 0;
  if (xx >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(xx) + b * Math.log1p(-xx)
  );
  if (xx < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(a, b, xx)) / a;
  return 1 - (bt * betaContinuedFraction(b, a, 1 - xx)) / b;
}

/** Quantile of the Beta(a, b) distribution by monotone bisection on I_x. */
export function betaQuantile(p, a, b) {
  const target = clamp(Number(p), 1e-9, 1 - 1e-9);
  if (!(a > 0) || !(b > 0)) return NaN;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 90; i += 1) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function betaMean(a, b) {
  if (!(a > 0) || !(b > 0)) return NaN;
  return a / (a + b);
}

export function betaSd(a, b) {
  if (!(a > 0) || !(b > 0)) return NaN;
  const s = a + b;
  return Math.sqrt((a * b) / (s * s * (s + 1)));
}

/**
 * log P(data | Beta(a, b) prior) for the beta–binomial model.
 * Used for the exact Bayes factor against the fair-coin null H0: p = 0.5.
 */
export function logBetaBinomialMarginal(hits, misses, a = 0.5, b = 0.5) {
  const h = Math.max(0, Number(hits) || 0);
  const m = Math.max(0, Number(misses) || 0);
  return logBetaFn(a + h, b + m) - logBetaFn(a, b);
}

/** Natural-log Bayes factor for H1: p ~ Beta(a, b) against H0: p = 0.5. */
export function logBayesFactor(hits, misses, a = 0.5, b = 0.5) {
  const n = (Number(hits) || 0) + (Number(misses) || 0);
  if (n <= 0) return 0;
  return logBetaBinomialMarginal(hits, misses, a, b) - n * Math.log(0.5);
}

export const log10BayesFactor = (hits, misses, a, b) =>
  logBayesFactor(hits, misses, a, b) / Math.LN10;

/** Kass–Raftery label for a log10 Bayes factor (two-sided). */
export function bayesBand(log10bf) {
  if (!isNum(log10bf)) return 'unmeasured';
  const v = Math.abs(Number(log10bf));
  for (const band of BAYES_BANDS) if (v >= band.min) return band.label;
  return 'negligible';
}

/**
 * Exact two-sided binomial p-value against H0: p = p0 (method of small p-values,
 * i.e. sum of every outcome at least as improbable as the observed one).
 */
export function binomialTwoSidedP(k, n, p0 = 0.5) {
  const nn = Math.round(Number(n) || 0);
  const kk = Math.round(Number(k) || 0);
  if (nn <= 0) return null;
  const logPmf = (i) =>
    logGamma(nn + 1) - logGamma(i + 1) - logGamma(nn - i + 1) +
    i * Math.log(p0) + (nn - i) * Math.log(1 - p0);
  const observed = logPmf(clamp(kk, 0, nn));
  let total = 0;
  for (let i = 0; i <= nn; i += 1) {
    const lp = logPmf(i);
    if (lp <= observed + 1e-9) total += Math.exp(lp);
  }
  return clamp(total, 0, 1);
}

/** Wilson score interval — behaves sanely at 0 and n successes. */
export function wilsonInterval(hits, n, z = 1.96) {
  const nn = Number(n) || 0;
  if (nn <= 0) return { low: null, high: null };
  const p = (Number(hits) || 0) / nn;
  const denom = 1 + (z * z) / nn;
  const centre = (p + (z * z) / (2 * nn)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / nn + (z * z) / (4 * nn * nn))) / denom;
  return { low: round(clamp(centre - half, 0, 1)), high: round(clamp(centre + half, 0, 1)) };
}

/**
 * Benjamini–Hochberg step-up FDR control.
 * `discoveries` counts hypotheses rejected at level q; `adjustedP` is the
 * monotone q-value, so a caller can also rank without re-running the procedure.
 */
export function benjaminiHochberg(pValues, q = DEFAULT_ALPHA) {
  const pvals = Array.isArray(pValues) ? pValues : [];
  const m = pvals.length;
  if (m === 0) return { threshold: 0, discoveries: 0, rejected: [], adjustedP: [], m: 0, q };
  const order = pvals
    .map((p, i) => ({ p: clamp(isNum(p) ? Number(p) : 1, 0, 1), i }))
    .sort((a, b) => a.p - b.p);
  let k = 0;
  for (let j = 0; j < m; j += 1) {
    if (order[j].p <= (q * (j + 1)) / m) k = j + 1;
  }
  const adjustedP = new Array(m).fill(1);
  let prev = 1;
  for (let j = m - 1; j >= 0; j -= 1) {
    const adj = Math.min(prev, (order[j].p * m) / (j + 1));
    adjustedP[order[j].i] = round(clamp(adj, 0, 1));
    prev = adjustedP[order[j].i];
  }
  return {
    threshold: k > 0 ? round((q * k) / m) : 0,
    discoveries: k,
    rejected: order.slice(0, k).map((o) => o.i),
    adjustedP,
    m,
    q
  };
}

/**
 * DerSimonian–Laird random-effects meta-analysis over independent strata.
 * Each stratum gives a rate and a sampling variance; between-study variance τ²
 * is estimated from Cochran's Q, then every stratum is shrunk toward the pooled
 * estimate by its own precision. This is what makes the memory *universal*: a
 * market with 6 episodes borrows strength from the other markets instead of
 * being trusted as if it were a balanced trial.
 */
export function randomEffectsPool(strata) {
  const rows = (Array.isArray(strata) ? strata : [])
    .map((s) => ({
      key: String(s?.key ?? ''),
      hits: Math.max(0, Number(s?.hits) || 0),
      n: Math.max(0, Number(s?.n) || 0)
    }))
    .filter((s) => s.n > 0);

  if (rows.length === 0) {
    return { pooled: null, tau2: 0, i2: 0, q: 0, k: 0, totalN: 0, strata: [] };
  }

  const enriched = rows.map((s) => {
    // Add 0.5/0.5 continuity so p=0 or p=1 still has a finite variance.
    const p = (s.hits + 0.5) / (s.n + 1);
    const v = (p * (1 - p)) / (s.n + 1);
    return { ...s, p, v, w: 1 / v };
  });

  const sw = enriched.reduce((acc, s) => acc + s.w, 0);
  const swp = enriched.reduce((acc, s) => acc + s.w * s.p, 0);
  const fixed = swp / sw;
  const qStat = enriched.reduce((acc, s) => acc + s.w * (s.p - fixed) ** 2, 0);
  const df = Math.max(1, enriched.length - 1);
  const sw2 = enriched.reduce((acc, s) => acc + s.w * s.w, 0);
  const cDenom = sw - sw2 / sw;
  const tau2 = enriched.length > 1 && cDenom > 0 ? Math.max(0, (qStat - df) / cDenom) : 0;

  const withRe = enriched.map((s) => {
    const wStar = 1 / (s.v + tau2);
    return { ...s, wStar };
  });
  const swStar = withRe.reduce((acc, s) => acc + s.wStar, 0);
  const pooled = withRe.reduce((acc, s) => acc + s.wStar * s.p, 0) / swStar;

  const strataOut = withRe.map((s) => {
    const precision = 1 / s.v;
    const priorPrecision = tau2 > 0 ? 1 / tau2 : 0;
    const shrunk = priorPrecision > 0
      ? (s.p * precision + pooled * priorPrecision) / (precision + priorPrecision)
      : s.p;
    return {
      key: s.key,
      hits: s.hits,
      n: s.n,
      rawRate: round(s.p, 4),
      shrunkenRate: round(shrunk, 4),
      weight: round(s.wStar / swStar, 4)
    };
  });

  const i2 = qStat > 0 ? clamp((qStat - df) / qStat, 0, 1) : 0;
  return {
    pooled: round(pooled, 4),
    tau2: round(tau2, 6),
    i2: round(i2, 4),
    q: round(qStat, 4),
    k: rows.length,
    totalN: rows.reduce((acc, s) => acc + s.n, 0),
    strata: strataOut
  };
}

/* ── Hypothesis bookkeeping ────────────────────────────────────────────────── */

export const hypothesisKey = ({ family = 'regime-positive-return', regime = 'meanRevert', symbol = null } = {}) =>
  `${family}|${String(regime).slice(0, 24)}|${symbol ? String(symbol).toUpperCase().slice(0, 16) : '*'}`;

function emptyRecord({ key, family, regime, symbol, registeredAt }) {
  return {
    key,
    family,
    regime,
    symbol: symbol || null,
    direction: family?.direction || '+',
    description: family?.description || '',
    registeredAt: Number(registeredAt) || 0,
    prespecified: true,
    minSamples: family?.minSamples ?? 24,
    minProspective: family?.minProspective ?? 12,
    expiresAt: null,
    retiredAt: null,
    observations: [],
    provenance: {},
    createdAt: Number(registeredAt) || 0
  };
}

/**
 * Universal Scientific Memory.
 *
 * Pure and synchronous: every input (including `now`) is explicit, so a test can
 * replay a year of evidence in milliseconds and get identical bytes back.
 */
export function createScientificMemory({
  now = () => Date.now(),
  halfLifeMs = DEFAULT_HALF_LIFE_MS,
  priorAlpha = 0.5,
  priorBeta = 0.5,
  q = DEFAULT_ALPHA,
  maxHypotheses = MAX_HYPOTHESES,
  birthAt = null,
  external = []
} = {}) {
  const clock = typeof now === 'function' ? now : () => Number(now) || Date.now();
  const createdAt = Number(birthAt) || clock();
  const halfLife = Math.max(3600_000, Number(halfLifeMs) || DEFAULT_HALF_LIFE_MS);
  const alpha0 = Number(priorAlpha) > 0 ? Number(priorAlpha) : 0.5;
  const beta0 = Number(priorBeta) > 0 ? Number(priorBeta) : 0.5;
  const cap = clamp(Math.round(Number(maxHypotheses) || MAX_HYPOTHESES), 4, MAX_HYPOTHESES);
  const fdrQ = clamp(Number(q) || DEFAULT_ALPHA, 1e-4, 0.5);

  /** @type {Map<string, ReturnType<typeof emptyRecord>>} */
  const records = new Map();
  let externalRecords = Array.isArray(external) ? external.slice(-MAX_EXTERNAL_RECORDS) : [];

  /* Beliefs only change when state changes (or the clock moves far enough for
     decay to be visible). Caching keeps the per-tick cortex path cheap: without
     it, report() + priorForCortex() cost ~5 ms of the tick budget. */
  let dirty = true;
  const IMPLICIT_BUCKET_MS = 30_000;
  let reportCache = { key: null, payload: null };
  const priorCache = new Map();
  const markDirty = () => {
    dirty = true;
    reportCache = { key: null, payload: null };
    priorCache.clear();
  };
  const counters = {
    observations: 0,
    prospective: 0,
    retrospective: 0,
    duplicatesRejected: 0,
    rejectedUnknownHypothesis: 0,
    beforeRegistration: 0,
    sensitiveRejected: 0,
    capacityRejected: 0,
    capRejected: 0
  };

  /* Pre-specify every regime × pooled-scope hypothesis up front. Declaring the
     whole family before any data arrives is the point: the *set of tests* is
     fixed, so BH-FDR has an honest denominator. */
  for (const family of PRESPECIFIED_FAMILIES) {
    for (const regime of REGIMES) {
      const key = hypothesisKey({ family: family.id, regime, symbol: null });
      records.set(key, emptyRecord({ key, family, regime, symbol: null, registeredAt: 0 }));
    }
  }

  const decayWeight = (observation, at) => {
    const age = Math.max(0, at - (Number(observation.at) || 0));
    return 0.5 ** (age / halfLife);
  };

  /** Effective (decayed, class-weighted) hit/miss counts for one record. */
  function effectiveEvidence(record, at = clock()) {
    let wHits = 0;
    let wMisses = 0;
    let prospective = 0;
    let retrospective = 0;
    let rawHits = 0;
    let rawN = 0;
    let lastAt = 0;
    for (const obs of record.observations) {
      const decay = decayWeight(obs, at);
      const base = EVIDENCE_WEIGHTS[obs.klass] ?? EVIDENCE_WEIGHTS.retrospective;
      const w = base * decay * (Number(obs.weight) || 1);
      if (obs.hit) wHits += w;
      else wMisses += w;
      if (obs.klass === 'prospective') prospective += decay * (Number(obs.weight) || 1);
      else retrospective += decay * (Number(obs.weight) || 1);
      if (obs.hit) rawHits += 1;
      rawN += 1;
      lastAt = Math.max(lastAt, Number(obs.at) || 0);
    }
    const nEff = wHits + wMisses;
    return {
      wHits,
      wMisses,
      nEff,
      prospectiveEff: prospective,
      retrospectiveEff: retrospective,
      rawHits,
      rawN,
      lastAt,
      halfLifeMs: halfLife,
      decayedFraction: record.observations.length ? round(nEff / record.observations.length, 4) : null
    };
  }

  function posteriorFor(record, at = clock()) {
    const eff = effectiveEvidence(record, at);
    const a = alpha0 + eff.wHits;
    const b = beta0 + eff.wMisses;
    const mean = betaMean(a, b);
    const log10bf = log10BayesFactor(eff.wHits, eff.wMisses, alpha0, beta0);
    const ci = eff.nEff > 0
      ? { low: round(betaQuantile(0.025, a, b)), high: round(betaQuantile(0.975, a, b)) }
      : { low: null, high: null };
    return {
      alpha: round(a, 4),
      beta: round(b, 4),
      mean: round(mean, 4),
      sd: round(betaSd(a, b), 4),
      credibleInterval: ci,
      log10BayesFactor: round(log10bf, 4),
      band: bayesBand(log10bf),
      pValue: eff.rawN > 0 ? round(binomialTwoSidedP(eff.rawHits, eff.rawN, 0.5), 6) : null,
      evidence: eff
    };
  }

  /** Status is a function of decayed evidence, not of the peak ever observed. */
  function statusFor(record, at = clock()) {
    if (record.retiredAt) return { status: 'retired', reason: 'RETIRED' };
    if (record.expiresAt && Number(record.expiresAt) <= at) {
      return { status: 'retired', reason: 'EXPIRED' };
    }
    const post = posteriorFor(record, at);
    const eff = post.evidence;
    if (eff.rawN === 0) return { status: 'open', reason: 'NO_EVIDENCE' };
    if (eff.nEff < record.minSamples) {
      return { status: 'open', reason: 'BELOW_MIN_SAMPLES' };
    }
    if (eff.prospectiveEff < record.minProspective) {
      return { status: 'inconclusive', reason: 'INSUFFICIENT_PROSPECTIVE' };
    }
    if (post.log10BayesFactor >= Math.log10(10)) return { status: 'supported', reason: 'BF10_DECISIVE' };
    if (post.log10BayesFactor <= -Math.log10(10)) return { status: 'refuted', reason: 'BF01_DECISIVE' };
    return { status: 'inconclusive', reason: 'BF_INCONCLUSIVE' };
  }

  function sanitizeKey(raw) {
    const key = String(raw || '').trim();
    if (!key || key.length > 120) return null;
    if (containsSensitiveKeyOrPhrase(key)) return null;
    return key;
  }

  /**
   * Declare a hypothesis. Pre-specified families are registered automatically;
   * this exposes the same door for an explicitly declared extension, provided
   * the *family id already exists in code*. There is no API to invent a family
   * after seeing data — that is the whole point.
   */
  function declare({
    family = 'regime-positive-return',
    regime = 'meanRevert',
    symbol = null,
    registeredAt = null,
    expiresAt = null,
    minSamples = null,
    minProspective = null
  } = {}) {
    const fam = FAMILY_BY_ID.get(String(family));
    if (!fam) return { ok: false, code: 'UNKNOWN_FAMILY' };
    if (!REGIMES.includes(String(regime))) return { ok: false, code: 'UNKNOWN_REGIME' };
    const key = sanitizeKey(hypothesisKey({ family: fam.id, regime, symbol }));
    if (!key) {
      counters.sensitiveRejected += 1;
      return { ok: false, code: 'SECRET_INPUT_REJECTED' };
    }
    const existing = records.get(key);
    if (existing) return { ok: true, existing: true, key };
    if (records.size >= cap) {
      counters.capacityRejected += 1;
      return { ok: false, code: 'CAPACITY_REACHED' };
    }
    const at = isNum(registeredAt) ? Number(registeredAt) : clock();
    const record = emptyRecord({
      key,
      family: fam,
      regime: String(regime),
      symbol: symbol ? String(symbol).toUpperCase() : null,
      registeredAt: at
    });
    if (isNum(expiresAt)) record.expiresAt = Number(expiresAt);
    if (isNum(minSamples)) record.minSamples = clamp(Math.round(Number(minSamples)), 4, 512);
    if (isNum(minProspective)) record.minProspective = clamp(Math.round(Number(minProspective)), 0, 512);
    records.set(key, record);
    markDirty();
    return { ok: true, existing: false, key, registeredAt: record.registeredAt };
  }

  /**
   * Score one observation against an already-declared hypothesis.
   * `outcome` is the observed event: 1 / 'positive' for a positive realised
   * return, 0 / 'negative' otherwise. Refusals are explicit and countable.
   */
  function observe({
    key,
    outcome = null,
    at = null,
    klass = 'prospective',
    weight = 1,
    provenance = null,
    source = null
  } = {}) {
    const safeKey = sanitizeKey(key);
    const record = safeKey ? records.get(safeKey) : null;
    if (!record) {
      counters.rejectedUnknownHypothesis += 1;
      return { ok: false, code: 'NOT_PREREGISTERED' };
    }
    const ts = isNum(at) ? Number(at) : clock();
    if (ts < Number(record.registeredAt || 0)) {
      counters.beforeRegistration += 1;
      return { ok: false, code: 'BEFORE_REGISTRATION' };
    }
    let event = outcome;
    if (typeof event === 'string') {
      const lowered = event.toLowerCase();
      if (['positive', 'up', 'gain', '+'].includes(lowered)) event = 1;
      else if (['negative', 'down', 'loss', '-'].includes(lowered)) event = 0;
      else return { ok: false, code: 'INVALID_OUTCOME' };
    }
    if (!isNum(event)) return { ok: false, code: 'INVALID_OUTCOME' };
    if (record.observations.length >= MAX_OBSERVATIONS_PER_HYPOTHESIS) {
      counters.capRejected += 1;
      return { ok: false, code: 'OBSERVATION_CAP' };
    }
    const klassSafe = EVIDENCE_CLASSES.includes(klass) ? klass : 'retrospective';
    const provInput = provenance || `${source || 'local'}:${ts}:${event}`;
    if (containsSensitiveKeyOrPhrase(String(provInput))) {
      counters.sensitiveRejected += 1;
      return { ok: false, code: 'SECRET_INPUT_REJECTED' };
    }
    /* Provenance is an identity, not a label: when the caller supplies one the
       same string can never be counted twice (even with a flipped outcome, which
       would otherwise be double-counted as two independent observations). With
       no provenance we derive one from (key, time, outcome, source). */
    const prov = provenance
      ? fnv1aHex(`p|${String(provenance).slice(0, 120)}`)
      : fnv1aHex(`d|${safeKey}|${ts}|${event}|${source || 'local'}`);
    if (record.provenance[prov]) {
      counters.duplicatesRejected += 1;
      return { ok: false, code: 'DUPLICATE_PROVENANCE' };
    }
    record.provenance[prov] = 1;
    // The hypothesis states the sign it expects; flip so `hit` is always
    // "the pre-registered prediction was right".
    const positive = Number(event) > 0;
    const hit = record.direction === '-' ? !positive : positive;
    record.observations.push({
      at: ts,
      hit: hit ? 1 : 0,
      klass: klassSafe,
      weight: clamp(Number(weight) || 1, 0.05, 4),
      provenance: prov,
      source: source ? String(source).slice(0, 24) : null
    });
    if (record.observations.length > MAX_OBSERVATIONS_PER_HYPOTHESIS) {
      record.observations = record.observations.slice(-MAX_OBSERVATIONS_PER_HYPOTHESIS);
    }
    counters.observations += 1;
    if (klassSafe === 'prospective') counters.prospective += 1;
    else counters.retrospective += 1;
    markDirty();
    return { ok: true, key: safeKey, hit, klass: klassSafe };
  }

  /**
   * Convert this device's resolved episodic engrams into evidence.
   *
   * The engram bank stores *episodes*, not tests. Ingesting them is only honest
   * because the test they feed is pre-specified (`PRESPECIFIED_FAMILIES`) and
   * because episodes observed before this memory existed are discounted as
   * retrospective and can never confirm anything by themselves.
   */
  function ingestEngrams(episodes = [], { at = null } = {}) {
    const list = Array.isArray(episodes) ? episodes : [];
    const ts = isNum(at) ? Number(at) : clock();
    let ingested = 0;
    let duplicates = 0;
    let skipped = 0;
    const touched = new Set();
    const byClass = { prospective: 0, retrospective: 0 };

    for (const ep of list) {
      const ret = Number(ep?.realizedReturn);
      if (!Number.isFinite(ret)) {
        skipped += 1;
        continue;
      }
      const regime = REGIMES.includes(String(ep?.regime)) ? String(ep.regime) : 'meanRevert';
      const symbol = ep?.symbol ? String(ep.symbol).toUpperCase().slice(0, 16) : null;
      const obsAt = Number(ep?.at) || ts;
      const klass = obsAt >= createdAt ? 'prospective' : 'retrospective';
      const scopes = symbol ? [symbol, null] : [null];
      const fingerprint = vectorFingerprint(ep?.vector);

      for (const scopeSymbol of scopes) {
        const family = FAMILY_BY_ID.get('regime-positive-return');
        const key = hypothesisKey({ family: family.id, regime, symbol: scopeSymbol });
        if (!records.has(key)) {
          const declared = declare({ family: family.id, regime, symbol: scopeSymbol, registeredAt: 0 });
          if (!declared.ok) continue;
        }
        const res = observe({
          key,
          outcome: ret > 0 ? 1 : 0,
          at: obsAt,
          klass,
          provenance: `${symbol || 'MARKET'}:${obsAt}:${fingerprint}`,
          source: 'engram'
        });
        if (res.ok) {
          ingested += 1;
          byClass[klass] += 1;
          touched.add(key);
        } else if (res.code === 'DUPLICATE_PROVENANCE') {
          duplicates += 1;
        } else {
          skipped += 1;
        }
      }
    }

    if (ingested > 0) markDirty();
    return {
      ok: ingested > 0,
      ingested,
      duplicates,
      skipped,
      hypothesesTouched: touched.size,
      byClass,
      totalEngrams: list.length
    };
  }

  /** Decayed evidence, posterior, FDR verdict and status for every record. */
  function evaluated(at = clock()) {
    const rows = [];
    for (const record of records.values()) {
      const post = posteriorFor(record, at);
      const st = statusFor(record, at);
      rows.push({ record, post, ...st });
    }
    return rows;
  }

  /**
   * Full report. The FDR step is applied to *tested* hypotheses (those with at
   * least `minSamples` of decayed evidence), so `discoveries` is a corrected
   * count rather than a raw tally of large posteriors.
   */
  function report({ at = null } = {}) {
    const explicit = isNum(at);
    const now = explicit ? Number(at) : clock();
    const ts = explicit ? now : Math.floor(now / IMPLICIT_BUCKET_MS) * IMPLICIT_BUCKET_MS;
    if (!dirty && reportCache.key === ts) return reportCache.payload;
    const rows = evaluated(ts);
    /* Only hypotheses that are *eligible to be confirmed* enter the FDR family:
       enough decayed evidence AND enough of it observed after registration. A
       retrospective-only bucket must not consume the discovery budget. */
    const tested = rows.filter(
      (r) =>
        r.post.evidence.rawN > 0 &&
        r.post.evidence.nEff >= r.record.minSamples &&
        r.post.evidence.prospectiveEff >= r.record.minProspective
    );
    const fdr = benjaminiHochberg(
      tested.map((r) => (r.post.pValue == null ? 1 : r.post.pValue)),
      fdrQ
    );
    const discoveredKeys = new Set(fdr.rejected.map((i) => tested[i].record.key));

    const byStatus = { open: 0, inconclusive: 0, supported: 0, refuted: 0, retired: 0 };
    for (const r of rows) byStatus[r.status] += 1;

    const withEvidence = rows
      .filter((r) => r.post.evidence.rawN > 0)
      .sort((a, b) => b.post.log10BayesFactor - a.post.log10BayesFactor);

    const best = withEvidence[0] || null;
    const supported = rows.filter((r) => r.status === 'supported');
    /* "Confirmed" = two independent gates: a decisive Bayes factor AND survival
       of Benjamini–Hochberg at q. Neither gate alone is called confirmation. */
    const confirmed = supported.filter((r) => discoveredKeys.has(r.record.key));
    const bestConfirmed = confirmed.sort(
      (a, b) => b.post.log10BayesFactor - a.post.log10BayesFactor
    )[0] || null;

    /* Meta-analysis: the same pre-specified claim, pooled across markets. */
    const metaStrata = [];
    for (const r of rows) {
      if (!r.record.symbol) continue;
      if (r.post.evidence.rawN === 0) continue;
      metaStrata.push({
        key: `${r.record.regime}:${r.record.symbol}`,
        hits: r.post.evidence.rawHits,
        n: r.post.evidence.rawN
      });
    }
    const meta = randomEffectsPool(metaStrata);

    /* Internal (device) evidence per key, used for consensus with the world. */
    const internalByKey = new Map(rows.map((r) => [r.record.key, r.post.log10BayesFactor]));
    const externalByKey = new Map();
    for (const ext of externalRecords) {
      const key = String(ext?.key || '');
      if (!key) continue;
      externalByKey.set(key, (externalByKey.get(key) || 0) + clamp(Number(ext.log10BayesFactor) || 0, -24, 24));
    }
    const consensusKeys = new Set([...internalByKey.keys(), ...externalByKey.keys()]);
    let consensusBest = null;
    for (const key of consensusKeys) {
      const local = internalByKey.get(key);
      const world = externalByKey.get(key);
      if (local == null && world == null) continue;
      const combined = clamp((local || 0) + (world || 0), -60, 60);
      if (!consensusBest || Math.abs(combined) > Math.abs(consensusBest.log10BayesFactor)) {
        consensusBest = {
          key,
          localLog10BayesFactor: local == null ? null : round(local, 4),
          worldLog10BayesFactor: world == null ? null : round(world, 4),
          log10BayesFactor: round(combined, 4),
          band: bayesBand(combined)
        };
      }
    }

    const calibration = prequentialCalibration(rows);
    const totalRaw = rows.reduce((acc, r) => acc + r.post.evidence.rawN, 0);
    const sensitivity = best
      ? {
          key: best.record.key,
          flipsAtAdditionalMisses: additionalMissesToFlip(best.record, ts)
        }
      : null;

    const payload = {
      ok: true,
      schema: SCIENCE_SCHEMA,
      version: SCIENCE_VERSION,
      simulated: false,
      marketEvidence: false,
      createdAt,
      at: ts,
      halfLifeMs: halfLife,
      fdrQ,
      prior: { alpha: alpha0, beta: beta0, family: 'jeffreys' },
      totals: {
        hypotheses: records.size,
        prespecifiedFamilies: PRESPECIFIED_FAMILIES.length,
        regimes: REGIMES.length,
        tested: tested.length,
        observations: counters.observations,
        rawObservations: totalRaw,
        prospective: counters.prospective,
        retrospective: counters.retrospective,
        duplicatesRejected: counters.duplicatesRejected
      },
      byStatus,
      fdr: {
        m: fdr.m,
        discoveries: fdr.discoveries,
        supported: supported.length,
        confirmed: confirmed.length,
        supportedButCorrected: Math.max(0, supported.length - confirmed.length),
        threshold: fdr.threshold,
        q: fdrQ
      },
      best: best
        ? {
            key: best.record.key,
            regime: best.record.regime,
            symbol: best.record.symbol,
            status: best.status,
            statusReason: best.reason,
            posteriorMean: best.post.mean,
            credibleInterval: best.post.credibleInterval,
            log10BayesFactor: best.post.log10BayesFactor,
            band: best.post.band,
            nEff: round(best.post.evidence.nEff, 3),
            rawN: best.post.evidence.rawN,
            prospectiveEff: round(best.post.evidence.prospectiveEff, 3),
            fdrDiscovery: discoveredKeys.has(best.record.key)
          }
        : null,
      bestConfirmed: bestConfirmed
        ? {
            key: bestConfirmed.record.key,
            regime: bestConfirmed.record.regime,
            symbol: bestConfirmed.record.symbol,
            posteriorMean: bestConfirmed.post.mean,
            credibleInterval: bestConfirmed.post.credibleInterval,
            log10BayesFactor: bestConfirmed.post.log10BayesFactor,
            band: bestConfirmed.post.band
          }
        : null,
      meta,
      consensus: {
        externalRecords: externalRecords.length,
        keys: externalByKey.size,
        best: consensusBest
      },
      calibration,
      sensitivity,
      recent: withEvidence.slice(0, 6).map((r) => ({
        key: r.record.key,
        regime: r.record.regime,
        symbol: r.record.symbol,
        status: r.status,
        statusReason: r.reason,
        posteriorMean: r.post.mean,
        log10BayesFactor: r.post.log10BayesFactor,
        credibleInterval: r.post.credibleInterval,
        nEff: round(r.post.evidence.nEff, 3)
      })),
      counts: { ...counters },
      honesty: {
        preregistrationEnforced: true,
        harkingBlocked: true,
        retrospectiveCannotConfirm: true,
        multipleComparisonsCorrected: 'benjamini-hochberg',
        accuracyPrefilled: false,
        realizedReturnFabricated: false,
        rawDataShared: false,
        note:
          'Every number is computed from observations actually scored here. A hypothesis is only "supported" when its decayed, mostly prospective evidence reaches a decisive Bayes factor AND survives FDR at q. Retrospective engrams are discounted 0.35× and can never confirm a claim alone.'
      },
      laws: { canExecute: false, canSign: false, canMoveFunds: false }
    };
    reportCache = { key: ts, payload };
    dirty = false;
    return payload;
  }

  /**
   * Prequential (predict-then-score) calibration of the memory's own beliefs.
   * Each observation is scored against the posterior formed by the observations
   * *before* it, so there is no leakage and no retro-fitted accuracy.
   */
  function prequentialCalibration(rows) {
    let scored = 0;
    let brierSum = 0;
    const bins = new Map();
    for (const r of rows) {
      const ordered = r.record.observations.slice().sort((a, b) => a.at - b.at);
      let h = alpha0;
      let m = beta0;
      for (const obs of ordered) {
        const p = h / (h + m);
        const y = obs.hit ? 1 : 0;
        brierSum += (p - y) ** 2;
        const bin = clamp(Math.floor(p * 5), 0, 4);
        const cell = bins.get(bin) || { n: 0, sumP: 0, sumY: 0 };
        cell.n += 1;
        cell.sumP += p;
        cell.sumY += y;
        bins.set(bin, cell);
        if (obs.hit) h += 1;
        else m += 1;
        scored += 1;
      }
    }
    if (scored < 12) {
      return {
        samples: scored,
        brier: null,
        ece: null,
        bins: [],
        note: 'Not enough scored observations yet — calibration stays null rather than optimistic.'
      };
    }
    let ece = 0;
    const binRows = [];
    for (const [bin, cell] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
      const meanP = cell.sumP / cell.n;
      const meanY = cell.sumY / cell.n;
      ece += (cell.n / scored) * Math.abs(meanP - meanY);
      binRows.push({ bin, n: cell.n, meanPredicted: round(meanP, 4), observedRate: round(meanY, 4) });
    }
    return {
      samples: scored,
      brier: round(brierSum / scored, 6),
      ece: round(ece, 6),
      bins: binRows,
      note: 'Prequential Brier: each observation scored against the belief held before it.'
    };
  }

  /** How many extra misses would erase this hypothesis's evidence (sensitivity). */
  function additionalMissesToFlip(record, at = clock()) {
    const post = posteriorFor(record, at);
    if (post.log10BayesFactor <= 0) return 0;
    const target = Math.log10(3); // below "moderate" evidence
    let extra = 0;
    let h = post.evidence.wHits;
    let m = post.evidence.wMisses;
    while (extra < 400 && log10BayesFactor(h, m, alpha0, beta0) > target) {
      m += 1;
      extra += 1;
    }
    return extra;
  }

  /**
   * Advisory prior for the cortex's *local* memory.
   *
   * USM never silently edits the readout. It answers one question: "is the
   * regime-conditional sign claim that this engram recall relies on actually
   * confirmed?" When it is not, the recall keeps its number but is labelled
   * unvalidated, and the returned bias is exactly 0.
   */
  function priorForCortex({ regime = null, symbol = null, at = null } = {}) {
    const explicit = isNum(at);
    const now = explicit ? Number(at) : clock();
    const ts = explicit ? now : Math.floor(now / IMPLICIT_BUCKET_MS) * IMPLICIT_BUCKET_MS;
    const cacheKey = `${ts}|${regime || '*'}|${symbol || '*'}`;
    if (priorCache.has(cacheKey)) return priorCache.get(cacheKey);
    const candidates = [];
    for (const r of evaluated(ts)) {
      if (regime && r.record.regime !== regime) continue;
      if (r.status !== 'supported') continue;
      const symMatch = symbol && r.record.symbol === String(symbol).toUpperCase();
      const pooled = !r.record.symbol;
      if (!pooled && !symMatch) continue;
      candidates.push({ ...r, scopeWeight: symMatch ? 1 : 0.6 });
    }
    if (candidates.length === 0) {
      const empty = {
        ok: true,
        source: 'none',
        validated: false,
        bias: 0,
        damping: 1,
        confidence: 0,
        reason: 'NO_CONFIRMED_HYPOTHESIS',
        at: ts
      };
      priorCache.set(cacheKey, empty);
      return empty;
    }
    candidates.sort((a, b) => b.post.log10BayesFactor * b.scopeWeight - a.post.log10BayesFactor * a.scopeWeight);
    const top = candidates[0];
    const confidence = clamp(
      (1 - 2 * top.post.sd) * clamp(top.post.log10BayesFactor / 10, 0.1, 1),
      0,
      1
    );
    const excess = clamp((top.post.mean - 0.5) * 2, -1, 1);
    const out = {
      ok: true,
      source: 'usm',
      validated: true,
      key: top.record.key,
      regime: top.record.regime,
      symbol: top.record.symbol,
      posteriorMean: top.post.mean,
      credibleInterval: top.post.credibleInterval,
      confidence: round(confidence, 4),
      bias: round(clamp(0.15 * excess * confidence, -0.15, 0.15), 4),
      damping: round(clamp(1 - 0.25 * confidence, 0.7, 1), 4),
      reason: 'CONFIRMED_HYPOTHESIS',
      at: ts
    };
    priorCache.set(cacheKey, out);
    return out;
  }

  /** Retire hypotheses whose declared expiry has passed. Returns the count. */
  function retireExpired({ at = null } = {}) {
    const ts = isNum(at) ? Number(at) : clock();
    let retired = 0;
    for (const record of records.values()) {
      if (!record.retiredAt && record.expiresAt && Number(record.expiresAt) <= ts) {
        record.retiredAt = ts;
        retired += 1;
      }
    }
    if (retired > 0) markDirty();
    return { ok: true, retired, at: ts };
  }

  /**
   * Portable prior: log Bayes factors + effective counts of pre-specified
   * families only. No prices, no vectors, no timestamps of individual trades.
   */
  function exportPrior({ at = null, minAbsLog10 = 0.5 } = {}) {
    const ts = isNum(at) ? Number(at) : clock();
    const rows = evaluated(ts)
      .filter((r) => r.post.evidence.rawN > 0 && Math.abs(r.post.log10BayesFactor) >= minAbsLog10)
      .sort((a, b) => Math.abs(b.post.log10BayesFactor) - Math.abs(a.post.log10BayesFactor))
      .slice(0, 64)
      .map((r) => ({
        key: r.record.key,
        family: r.record.family.id,
        regime: r.record.regime,
        symbol: r.record.symbol,
        log10BayesFactor: round(clamp(r.post.log10BayesFactor, -24, 24), 4),
        prospectiveEff: round(r.post.evidence.prospectiveEff, 3),
        rawN: r.post.evidence.rawN,
        status: r.status
      }));
    const packet = {
      schema: SCIENCE_PRIOR_SCHEMA,
      version: SCIENCE_VERSION,
      at: ts,
      prespecifiedFamilies: PRESPECIFIED_FAMILIES.map((f) => f.id),
      records: rows,
      laws: { canExecute: false, canSign: false, canMoveFunds: false }
    };
    return { ...packet, packetHash: contentHash(packet) };
  }

  /**
   * Merge a prior packet produced by another device (or by the world registry).
   * Strict: pre-specified keys only, |log10 BF| ≤ 24, one vote per packet hash.
   */
  function mergePrior(packet, { at = null } = {}) {
    const ts = isNum(at) ? Number(at) : clock();
    if (!packet || packet.schema !== SCIENCE_PRIOR_SCHEMA || !Array.isArray(packet.records)) {
      return { ok: false, code: 'INVALID_PRIOR_PACKET' };
    }
    const hash = packet.packetHash || contentHash({
      schema: packet.schema,
      at: packet.at,
      records: packet.records
    });
    const already = externalRecords.some((r) => r.packetHash === hash);
    if (already) return { ok: false, code: 'DUPLICATE_PACKET', packetHash: hash };

    const familyIds = new Set(PRESPECIFIED_FAMILIES.map((f) => f.id));
    let merged = 0;
    let rejected = 0;
    for (const rec of packet.records.slice(0, 64)) {
      const key = String(rec?.key || '');
      const parsed = key.split('|');
      const family = parsed[0];
      const regime = parsed[1];
      if (!familyIds.has(family) || !REGIMES.includes(regime)) {
        rejected += 1;
        continue;
      }
      const log10bf = Number(rec?.log10BayesFactor);
      if (!Number.isFinite(log10bf) || Math.abs(log10bf) > 24) {
        rejected += 1;
        continue;
      }
      if (externalRecords.length >= MAX_EXTERNAL_RECORDS) {
        rejected += 1;
        continue;
      }
      externalRecords.push({
        key,
        log10BayesFactor: round(log10bf, 4),
        packetHash: hash,
        at: ts
      });
      merged += 1;
    }
    if (merged > 0) markDirty();
    return { ok: merged > 0, code: merged > 0 ? 'MERGED' : 'NO_VALID_RECORDS', merged, rejected, packetHash: hash };
  }

  function get(key) {
    const record = records.get(String(key));
    if (!record) return null;
    const at = clock();
    return {
      key: record.key,
      claim: {
        family: record.family.id,
        kind: record.family.kind,
        regime: record.regime,
        symbol: record.symbol,
        direction: record.direction,
        description: record.description
      },
      registeredAt: record.registeredAt,
      prespecified: record.prespecified,
      minSamples: record.minSamples,
      minProspective: record.minProspective,
      observations: record.observations.length,
      ...posteriorFor(record, at),
      ...statusFor(record, at)
    };
  }

  function toJSON() {
    return {
      schema: SCIENCE_SCHEMA,
      version: SCIENCE_VERSION,
      createdAt,
      halfLifeMs: halfLife,
      fdrQ,
      prior: { alpha: alpha0, beta: beta0 },
      records: [...records.values()].map((r) => ({
        key: r.key,
        family: r.family.id,
        regime: r.regime,
        symbol: r.symbol,
        registeredAt: r.registeredAt,
        expiresAt: r.expiresAt,
        retiredAt: r.retiredAt,
        minSamples: r.minSamples,
        minProspective: r.minProspective,
        observations: r.observations
      })),
      external: externalRecords.slice(-MAX_EXTERNAL_RECORDS),
      counts: { ...counters }
    };
  }

  /** Restore from `toJSON()`. Unknown families/regimes are dropped, not guessed. */
  function loadJSON(state) {
    if (!state || state.schema !== SCIENCE_SCHEMA || !Array.isArray(state.records)) {
      return { ok: false, code: 'INVALID_STATE' };
    }
    let restored = 0;
    let dropped = 0;
    for (const r of state.records) {
      const family = FAMILY_BY_ID.get(String(r?.family));
      if (!family || !REGIMES.includes(String(r?.regime))) {
        dropped += 1;
        continue;
      }
      const key = hypothesisKey({ family: family.id, regime: r.regime, symbol: r.symbol });
      const record = emptyRecord({
        key,
        family,
        regime: String(r.regime),
        symbol: r.symbol ? String(r.symbol).toUpperCase() : null,
        registeredAt: r.registeredAt
      });
      if (isNum(r.expiresAt)) record.expiresAt = Number(r.expiresAt);
      if (isNum(r.retiredAt)) record.retiredAt = Number(r.retiredAt);
      if (isNum(r.minSamples)) record.minSamples = Number(r.minSamples);
      if (isNum(r.minProspective)) record.minProspective = Number(r.minProspective);
      for (const obs of Array.isArray(r.observations) ? r.observations : []) {
        if (!EVIDENCE_CLASSES.includes(obs?.klass) || !isNum(obs?.at)) continue;
        const prov = String(obs.provenance || '');
        record.observations.push({
          at: Number(obs.at),
          hit: obs.hit ? 1 : 0,
          klass: obs.klass,
          weight: clamp(Number(obs.weight) || 1, 0.05, 4),
          provenance: prov,
          source: obs.source ? String(obs.source).slice(0, 24) : null
        });
        if (prov) record.provenance[prov] = 1;
      }
      record.observations.sort((a, b) => a.at - b.at);
      records.set(key, record);
      restored += 1;
    }
    if (Array.isArray(state.external)) {
      externalRecords = state.external.slice(-MAX_EXTERNAL_RECORDS);
    }
    /* Counters are derived from the restored observations rather than trusted
       from the file: a tampered counter must not be able to claim evidence. */
    let retrospective = 0;
    let prospective = 0;
    for (const record of records.values()) {
      for (const obs of record.observations) {
        if (obs.klass === 'prospective') prospective += 1;
        else retrospective += 1;
      }
    }
    counters.observations = prospective + retrospective;
    counters.prospective = prospective;
    counters.retrospective = retrospective;
    markDirty();
    return {
      ok: true,
      restored,
      dropped,
      observations: counters.observations,
      prospective,
      retrospective
    };
  }

  function wipe() {
    records.clear();
    externalRecords = [];
    for (const family of PRESPECIFIED_FAMILIES) {
      for (const regime of REGIMES) {
        const key = hypothesisKey({ family: family.id, regime, symbol: null });
        records.set(key, emptyRecord({ key, family, regime, symbol: null, registeredAt: 0 }));
      }
    }
    markDirty();
    return { ok: true, at: clock() };
  }

  return {
    // lifecycle
    declare,
    observe,
    ingestEngrams,
    retireExpired,
    // reading
    report,
    get,
    evaluated,
    posteriorFor,
    effectiveEvidence,
    statusFor,
    priorForCortex,
    // portability
    exportPrior,
    mergePrior,
    toJSON,
    loadJSON,
    wipe,
    // introspection
    meta: () => ({
      schema: SCIENCE_SCHEMA,
      createdAt,
      halfLifeMs: halfLife,
      fdrQ,
      hypotheses: records.size,
      externalRecords: externalRecords.length,
      laws: { canExecute: false, canSign: false, canMoveFunds: false }
    })
  };
}

/* ── Deterministic evidence probe (server + tests) ─────────────────────────── */

/**
 * The statistics this module claims are not visible in a UI. This probe measures
 * them on seeded simulations and reports what it actually observed:
 *
 *   · null calibration — how many "discoveries" a fair coin produces with and
 *     without BH correction (FDR must bite; raw p < 0.05 must not);
 *   · power — how many genuinely biased streams are detected at the same q;
 *   · shrinkage — MSE of per-market rates versus random-effects estimates
 *     against the known truth (universal pooling must help, not hurt);
 *   · interval coverage — how often the 95 % Wilson interval contains the truth.
 *
 * Every number is a simulation result and is labelled `simulated: true`; none of
 * it is market evidence, and none of it is claimed as a return.
 */
export function probeScientificMemory({
  seed = 0x2050fb71,
  nullTests = 240,
  nullSamples = 60,
  altTests = 40,
  altSamples = 80,
  altRate = 0.75,
  coverageRuns = 400,
  coverageSamples = 40,
  markets = 12
} = {}) {
  const rand = createPrng(seed);

  /* 1. False-discovery behaviour under the global null. */
  const nullP = [];
  for (let t = 0; t < nullTests; t += 1) {
    let hits = 0;
    for (let i = 0; i < nullSamples; i += 1) hits += rand() < 0.5 ? 1 : 0;
    nullP.push(binomialTwoSidedP(hits, nullSamples, 0.5));
  }
  const uncorrected = nullP.filter((p) => p != null && p < 0.05).length;
  const corrected = benjaminiHochberg(nullP, 0.05);

  /* 2. Power on genuinely biased streams at the same q. */
  const altP = [];
  for (let t = 0; t < altTests; t += 1) {
    let hits = 0;
    for (let i = 0; i < altSamples; i += 1) hits += rand() < altRate ? 1 : 0;
    altP.push(binomialTwoSidedP(hits, altSamples, 0.5));
  }
  const powerFdr = benjaminiHochberg(altP, 0.05).discoveries;

  /* 3. Random-effects shrinkage against a known truth. */
  const truth = Array.from({ length: markets }, () => 0.35 + rand() * 0.3);
  const strata = truth.map((p, i) => {
    const n = 8 + ((i % 3) * 6);
    let hits = 0;
    for (let k = 0; k < n; k += 1) hits += rand() < p ? 1 : 0;
    return { key: `m${i}`, hits, n };
  });
  const pool = randomEffectsPool(strata);
  let mseRaw = 0;
  let mseShrunk = 0;
  for (let i = 0; i < markets; i += 1) {
    const raw = (strata[i].hits + 0.5) / (strata[i].n + 1);
    const shrunk = pool.strata[i]?.shrunkenRate ?? raw;
    mseRaw += (raw - truth[i]) ** 2;
    mseShrunk += (shrunk - truth[i]) ** 2;
  }
  mseRaw /= markets;
  mseShrunk /= markets;

  /* 4. Coverage of the 95 % Wilson interval on fair coins. */
  let covered = 0;
  for (let r = 0; r < coverageRuns; r += 1) {
    let hits = 0;
    for (let i = 0; i < coverageSamples; i += 1) hits += rand() < 0.5 ? 1 : 0;
    const ci = wilsonInterval(hits, coverageSamples);
    if (ci.low != null && ci.low <= 0.5 && 0.5 <= ci.high) covered += 1;
  }

  const measured = {
    seed,
    simulated: true,
    nullFamily: { tests: nullTests, samples: nullSamples },
    falseDiscoveries: {
      uncorrectedAtPointZeroFive: uncorrected,
      uncorrectedRate: round(uncorrected / nullTests, 4),
      afterBenjaminiHochberg: corrected.discoveries,
      afterRate: round(corrected.discoveries / nullTests, 4),
      fdrQ: 0.05
    },
    power: {
      tests: altTests,
      samples: altSamples,
      trueRate: altRate,
      discoveries: powerFdr,
      rate: round(powerFdr / altTests, 4)
    },
    shrinkage: {
      markets,
      mseRaw: round(mseRaw, 6),
      mseShrunk: round(mseShrunk, 6),
      mseReductionPct: round(mseRaw > 0 ? (1 - mseShrunk / mseRaw) * 100 : 0, 2),
      tau2: pool.tau2,
      i2: pool.i2
    },
    intervalCoverage: {
      runs: coverageRuns,
      samples: coverageSamples,
      nominal: 0.95,
      observed: round(covered / coverageRuns, 4)
    },
    determinism: {
      hash: contentHash({
        uncorrected,
        corrected: corrected.discoveries,
        powerFdr,
        mseRaw: round(mseRaw, 6),
        mseShrunk: round(mseShrunk, 6),
        covered
      })
    }
  };

  return {
    ok: true,
    schema: SCIENCE_SCHEMA,
    probe: 'scientific-memory-statistics',
    measured,
    honesty: {
      simulated: true,
      marketEvidence: false,
      realizedReturnFabricated: false,
      accuracyPrefilled: false,
      note:
        'Seeded simulations of the statistics engine itself. No market outcome, price or return was observed, invented or implied.'
    },
    laws: { canExecute: false, canSign: false, canMoveFunds: false, zeroServerGpu: true }
  };
}
