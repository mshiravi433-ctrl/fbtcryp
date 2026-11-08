/**
 * FBT NEUROMORPHIC 2050 — PHASE 8: PARALLEL RESEARCH UNIVERSES (PRU)
 * ===========================================================================
 * «جهان‌های تحقیقاتی موازی» — یک لایهٔ پژوهشی واقعی روی همان کورتکس نورومورفیک
 *
 * Phase 6 (brain core) answers «what does this cortex believe right now?».
 * Phase 7 (scientific memory) answers «is that belief better than chance?».
 * Both answer from a *single* trajectory. Science does not work that way: a
 * claim becomes knowledge when independent attempts, starting from different
 * assumptions, have to face the same evidence — and when their disagreement is
 * measured instead of averaged away.
 *
 * This module runs a population of complete research universes. Every universe
 * is an independent learner with its own genome, inductive bias, evidence
 * memory time-constant, online synapses and track record. All universes see the
 * exact same real market observations in the exact same order, and each must
 * commit to a probability for the next bar *before* that bar exists.
 *
 * Mechanisms (each one testable, none decorative):
 *
 *   1. GENOME → INDUCTIVE BIAS
 *      Eight bounded, interpretable genes (precision, plasticity, momentum,
 *      contrarian, volatility, temperature, memory, breadth). They decide how
 *      the same 8-D sensory vector is read, how fast synapses adapt, how sharply
 *      a universe commits and how long evidence is integrated. Different genome
 *      ⇒ genuinely different hypothesis, not another seed of one model.
 *
 *   2. HONEST ONLINE PREDICTION (no look-ahead, enforced by an invariant)
 *      Each universe is a leaky-evidence logistic learner. At bar t it emits
 *      p(up at t+1) from data available at t. `observe()` refuses to run again
 *      before `resolve()`, so a prediction can never be silently replaced.
 *      Outcomes are only the realised sign of the *next* real bar; ties are
 *      counted and never scored.
 *
 *   3. PROPER SCORING, NOT ACCURACY THEATRE
 *      Log loss and Brier from resolved pairs only; hit rate over *committed*
 *      decisions (|p − 0.5| ≥ 0.05) so abstaining forever cannot look accurate;
 *      ECE from the consensus universe's own resolved history.
 *
 *   4. HEDGE / EXPONENTIATED-WEIGHTS FUSION
 *      Consensus = online no-regret mixture: w ← w·exp(−η·loss) with a floor.
 *      It is scored separately and compared honestly with the best single
 *      universe and with a hindsight oracle (labelled, never used to decide).
 *
 *   5. SELECTION, CROSSOVER, MUTATION — WITH A LINEAGE
 *      Every `selectionInterval` resolutions the worst quartile is culled and
 *      replaced by children of two tournament-selected survivors (uniform
 *      crossover + decaying Gaussian mutation) plus one explorer mutant, so the
 *      population cannot collapse. Parents, lineage hashes and birth reasons are
 *      recorded — evolution is auditable, not a label.
 *
 *   6. MEASURED DISPERSION
 *      Mean pairwise disagreement, normalised weight entropy, agreement share,
 *      committed/abstained counts, distinct lineages and the hindsight gap.
 *
 * Security & honesty laws (identical to every other neuromorphic module):
 *   · `canExecute: false`, `canSign: false`, `canMoveFunds: false` — always.
 *   · No invented prices: features come from `spikeEncoder.featuresFromCandles`,
 *     which itself refuses to fabricate missing bars.
 *   · A pulse over history is labelled `retrospective`; retrospective selection
 *     can never be reported as confirmation.
 *   · No `Math.random()`: seeded Mulberry32 only ⇒ `contentHash` reproducible.
 */

import { featuresFromCandles, SENSORY_AXES } from './spikeEncoder.js';

export const UNIVERSES_SCHEMA = 'fbt.neuromorphic.research-universes.v1';
export const UNIVERSES_VERSION = 1;
export const UNIVERSES_CANONICAL_SEED = 0x2050fb71;

export const MIN_POPULATION = 4;
export const MAX_POPULATION = 32;
export const DEFAULT_POPULATION = 12;
export const MIN_CONTEXT_BARS = 8;
export const MAX_PULSE_BARS = 240;
export const SELECTION_INTERVAL = 8;
export const TRACE_LENGTH = 40;
export const META_TRACE_LENGTH = 64;
export const WEIGHT_FLOOR = 1e-4;
export const HEDGE_ETA = 0.35;
export const COMMIT_MARGIN = 0.05;
export const MAX_ABS_WEIGHT = 3;
export const MUTATION_BASE = 0.22;
export const MUTATION_DECAY = 0.72;
export const MIN_RESOLVED_FOR_SELECTION = 3;
/**
 * Bayesian shrinkage toward chance for every *decision* (selection, tournament,
 * "best"). A child with 16 lucky observations must not outrank a universe with
 * 120 honest ones, so each track record is pulled toward log(2) with this many
 * pseudo-observations.
 */
export const SHRINK_PRIOR_OBSERVATIONS = 4;
export const MAX_PULSE_LEDGER = 12;
export const MAX_CULL_LEDGER = 8;
export const MAX_LINEAGE_CHARS = 64;
export const MAX_PULSE_POPULATION = 32;

/** Sensory width — must match `spikeEncoder.SENSORY_AXES`. */
export const UNIVERSE_FEATURE_SIZE = SENSORY_AXES.length; // 8
/** Feature vector + bias fed to each universe's online learner. */
export const UNIVERSE_INPUT_SIZE = UNIVERSE_FEATURE_SIZE + 1; // 9

/** Genome: bounded, interpretable traits. Mutation/crossover stay inside this envelope. */
export const UNIVERSE_GENES = Object.freeze([
  Object.freeze({ key: 'precision', min: 0.25, max: 2.5, fa: 'دقت حسی', en: 'Sensory precision' }),
  Object.freeze({ key: 'plasticity', min: 0.02, max: 0.6, fa: 'نرخ یادگیری', en: 'Plasticity' }),
  Object.freeze({ key: 'momentum', min: -1.2, max: 1.2, fa: 'مومنتوم', en: 'Momentum' }),
  Object.freeze({ key: 'contrarian', min: -1.2, max: 1.2, fa: 'ضد‌روند', en: 'Contrarian' }),
  Object.freeze({ key: 'volatility', min: 0, max: 1.5, fa: 'فیلتر نوسان', en: 'Volatility filter' }),
  Object.freeze({ key: 'temperature', min: 0.4, max: 1.8, fa: 'دمای تصمیم', en: 'Decision temperature' }),
  Object.freeze({ key: 'memory', min: 0, max: 0.95, fa: 'حافظهٔ شواهد', en: 'Evidence memory' }),
  Object.freeze({ key: 'breadth', min: -1, max: 1, fa: 'عرض بازار', en: 'Breadth tilt' })
]);

export const GENE_KEYS = Object.freeze(UNIVERSE_GENES.map((g) => g.key));

export const GENE_BOUNDS = Object.freeze(
  UNIVERSE_GENES.reduce((acc, g) => {
    acc[g.key] = Object.freeze({ min: g.min, max: g.max });
    return acc;
  }, {})
);

export const HYPOTHESES = Object.freeze([
  Object.freeze({ id: 'momentum', fa: 'شکارچی مومنتوم', en: 'Momentum hunter' }),
  Object.freeze({ id: 'reversion', fa: 'تک‌تیرانداز بازگشت', en: 'Reversion sniper' }),
  Object.freeze({ id: 'volatility', fa: 'سپر نوسان', en: 'Volatility shield' }),
  Object.freeze({ id: 'breadth', fa: 'چرخان عرض بازار', en: 'Breadth rotator' }),
  Object.freeze({ id: 'structural', fa: 'خوانش ریزساختار', en: 'Microstructure reader' }),
  Object.freeze({ id: 'balanced', fa: 'متعادل‌گر', en: 'Balancer' }),
  Object.freeze({ id: 'explorer', fa: 'کاوشگر جهش‌یافته', en: 'Mutant explorer' })
]);

const HYPOTHESIS_BY_ID = Object.freeze(
  HYPOTHESES.reduce((acc, h) => {
    acc[h.id] = h;
    return acc;
  }, {})
);

export const EVIDENCE_CLASSES = Object.freeze(['prospective', 'retrospective']);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const safeNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const sigmoid = (x) => {
  if (x > 16) return 1;
  if (x < -16) return 0;
  return 1 / (1 + Math.exp(-x));
};
const round6 = (v) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 1e6) / 1e6;

/** Deterministic Mulberry32 (same PRNG family as `cortexCore.js`). */
export function createUniversePrng(seed = UNIVERSES_CANONICAL_SEED) {
  let s = (Number(seed) >>> 0) || UNIVERSES_CANONICAL_SEED;
  const next = function nextDraw() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // State accessors: a snapshot can therefore continue *bit-identically*.
  next.state = () => s >>> 0;
  next.restore = (value) => {
    s = (Number(value) >>> 0) || UNIVERSES_CANONICAL_SEED;
  };
  return next;
}

/** FNV-1a 32-bit hex — lineage and content hashes (auditable, not cryptographic). */
export function fnv1aHex(text) {
  const str = String(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Stable JSON for hashing (keys sorted, numbers rounded to 6 dp). */
export function canonicalHashJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(round6(value));
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalHashJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalHashJson(value[k])}`).join(',')}}`;
  }
  return 'null';
}

/** Deterministic Gaussian draw (Box–Muller over the seeded PRNG). */
function gaussian(rand) {
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function clampGenomeValue(key, value) {
  const b = GENE_BOUNDS[key];
  if (!b) return 0;
  return round6(clamp(safeNum(value, (b.min + b.max) / 2), b.min, b.max));
}

export function normalizeGenome(raw = {}) {
  const out = {};
  for (const g of UNIVERSE_GENES) out[g.key] = clampGenomeValue(g.key, raw?.[g.key]);
  return out;
}

export function randomGenome(rand) {
  const out = {};
  for (const g of UNIVERSE_GENES) out[g.key] = clampGenomeValue(g.key, g.min + rand() * (g.max - g.min));
  return out;
}

/** Deterministic hypothesis label — a description of the bias, not a profit claim. */
export function classifyGenome(genome, { explorer = false } = {}) {
  if (explorer) return 'explorer';
  const g = normalizeGenome(genome);
  if (g.volatility > 0.95 && g.precision > 1.3) return 'volatility';
  if (g.contrarian < -0.3 && Math.abs(g.contrarian) >= Math.abs(g.momentum)) return 'reversion';
  if (g.momentum > 0.3) return 'momentum';
  if (Math.abs(g.breadth) > 0.55) return 'breadth';
  if (g.memory > 0.7) return 'structural';
  return 'balanced';
}

export function genomeHash(genome) {
  return fnv1aHex(GENE_KEYS.map((k) => `${k}:${round6(genome[k])}`).join('|'));
}

/**
 * Genome-conditioned reading of the 8-D sensory vector.
 * The genome decides which sensory evidence a universe even *looks at* — the
 * cheapest honest way to create genuinely different hypotheses.
 */
function encodeInput(features, genome) {
  const g = genome;
  const f = new Float64Array(UNIVERSE_INPUT_SIZE);
  f[0] = features[0] * (0.55 + 0.75 * g.precision);   // short return
  f[1] = features[1] * (0.35 + 1.15 * g.momentum);    // medium momentum
  f[2] = features[2] * (0.35 + 0.85 * g.volatility);  // realized volatility
  f[3] = features[3] * 0.8;                            // volume impulse
  f[4] = features[4] * (0.4 + 0.95 * g.contrarian);   // RSI tension (sign from gene)
  f[5] = features[5] * (0.5 + 0.45 * g.momentum);     // range position
  f[6] = features[6] * (0.3 + 0.9 * g.breadth);       // breadth skew
  f[7] = features[7] * (0.45 + 0.55 * g.volatility);  // structural stress
  f[8] = 1;                                            // bias
  // Bounded interaction: "risky trend" — momentum only counts with stress context.
  f[1] += clamp(features[1] * features[7] * g.momentum * 0.35, -1, 1);
  // Bounded interaction: reversion is only listened to inside compressed volatility.
  f[4] += clamp(-features[2] * features[4] * g.contrarian * 0.25, -1, 1);
  for (let i = 0; i < f.length; i += 1) f[i] = clamp(f[i], -4, 4);
  return f;
}

const logLossOf = (probability, outcome) => {
  const p = clamp(safeNum(probability, 0.5), 1e-4, 1 - 1e-4);
  return outcome === 1 ? -Math.log(p) : -Math.log(1 - p);
};
const brierOf = (probability, outcome) => {
  const p = clamp(safeNum(probability, 0.5), 0, 1);
  const target = outcome === 1 ? 1 : 0;
  return (p - target) ** 2;
};
const isCommitted = (probability) => Math.abs(safeNum(probability, 0.5) - 0.5) >= COMMIT_MARGIN;

function normalizeWeights(raw) {
  const n = raw.length;
  const out = new Float64Array(n);
  if (!n) return out;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const w = Number.isFinite(Number(raw[i])) ? Math.max(WEIGHT_FLOOR, Number(raw[i])) : WEIGHT_FLOOR;
    out[i] = w;
    sum += w;
  }
  if (!(sum > 0) || !Number.isFinite(sum)) {
    out.fill(1 / n);
    return out;
  }
  for (let i = 0; i < n; i += 1) out[i] /= sum;
  return out;
}

function entropy01(probs) {
  const n = probs.length;
  if (n <= 1) return 0;
  let h = 0;
  for (const p of probs) {
    const v = safeNum(p, 0);
    if (v > 0) h -= v * Math.log(v);
  }
  return clamp(h / Math.log(n), 0, 1);
}

function expectedCalibrationError(pairs, buckets = 4) {
  const usable = (Array.isArray(pairs) ? pairs : []).filter(
    (r) => r && Number.isFinite(Number(r.p)) && (r.y === 0 || r.y === 1)
  );
  if (usable.length < 8) return null;
  let ece = 0;
  let counted = 0;
  for (let b = 0; b < buckets; b += 1) {
    const lo = b / buckets;
    const hi = (b + 1) / buckets;
    const rows = usable.filter((r) => {
      const p = Number(r.p);
      return b === buckets - 1 ? p >= lo && p <= hi : p >= lo && p < hi;
    });
    if (!rows.length) continue;
    const avgP = rows.reduce((s, r) => s + Number(r.p), 0) / rows.length;
    const freq = rows.reduce((s, r) => s + r.y, 0) / rows.length;
    ece += (rows.length / usable.length) * Math.abs(avgP - freq);
    counted += rows.length;
  }
  if (!counted) return null;
  return round6(clamp(ece, 0, 1));
}

const meanLoss = (u) => (u.resolved > 0 ? u.logLossSum / u.resolved : Number.POSITIVE_INFINITY);
/**
 * Shrunk log loss: (evidence + prior·ln2) / (n + prior). Lower is better.
 * Exported so an auditor can reproduce every selection decision.
 */
export function shrunkLogLoss({ logLossSum = 0, resolved = 0 } = {}) {
  return (
    (safeNum(logLossSum, 0) + SHRINK_PRIOR_OBSERVATIONS * Math.LN2) /
    (Math.max(0, safeNum(resolved, 0)) + SHRINK_PRIOR_OBSERVATIONS)
  );
}
const shrunkLoss = (u) => shrunkLogLoss(u);
/** Shrunk Brier toward the fair-coin reference (0.25). */
const shrunkBrier = (u) =>
  (safeNum(u.brierSum, 0) + SHRINK_PRIOR_OBSERVATIONS * 0.25) /
  (Math.max(0, safeNum(u.resolved, 0)) + SHRINK_PRIOR_OBSERVATIONS);

function sanitizeFeatures(features) {
  if (!features) return null;
  const arr = Array.isArray(features) ? features : Array.from(features);
  if (arr.length < UNIVERSE_FEATURE_SIZE) return null;
  const out = new Float64Array(UNIVERSE_FEATURE_SIZE);
  for (let i = 0; i < UNIVERSE_FEATURE_SIZE; i += 1) {
    const v = Number(arr[i]);
    if (!Number.isFinite(v)) return null;
    out[i] = clamp(v, -2, 2);
  }
  return out;
}

function cleanCandles(candles) {
  if (!Array.isArray(candles)) return [];
  return candles
    .map((c) => {
      const volume = Number(c?.volume ?? c?.v);
      return {
        open: Number(c?.open ?? c?.o),
        high: Number(c?.high ?? c?.h),
        low: Number(c?.low ?? c?.l),
        close: Number(c?.close ?? c?.c),
        volume: Number.isFinite(volume) ? volume : undefined,
        time: c?.time ?? c?.t ?? null
      };
    })
    .filter(
      (c) =>
        Number.isFinite(c.close) && c.close > 0 &&
        Number.isFinite(c.high) && Number.isFinite(c.low)
    );
}

/**
 * Create a parallel-universe research population.
 *
 * @param {object} [opts]
 * @param {number} [opts.seed] canonical seed (deterministic runs)
 * @param {number} [opts.population] 4..32 universes
 * @param {number} [opts.selectionInterval] resolved observations per selection round
 */
export function createResearchUniverses({
  seed = UNIVERSES_CANONICAL_SEED,
  population = DEFAULT_POPULATION,
  selectionInterval = SELECTION_INTERVAL
} = {}) {
  const rand = createUniversePrng(seed);
  const origin = Number(seed) >>> 0;
  const popSize = clamp(
    Math.round(safeNum(population, DEFAULT_POPULATION)) || DEFAULT_POPULATION,
    MIN_POPULATION,
    MAX_POPULATION
  );
  const selInterval = clamp(
    Math.round(safeNum(selectionInterval, SELECTION_INTERVAL)) || SELECTION_INTERVAL,
    3,
    64
  );

  let universes = [];
  let weights = new Float64Array(popSize).fill(1 / popSize);
  let generation = 0;
  let ticks = 0;
  let resolved = 0;
  let ties = 0;
  let sinceSelection = 0;
  let hedgeUpdates = 0;
  let totalBorn = 0;
  let totalCulled = 0;
  let selectionRounds = 0;
  let pendingActive = false;
  let pendingMeta = null;
  let pendingControl = null;
  let pendingAt = null;
  let pendingFeatures = null;
  let lastResolution = null;
  let lastSelection = null;
  let lastError = null;
  let nextOrdinal = 1;
  let abandonedPredictions = 0;
  const cullLedger = [];
  const pulseDeck = [];
  const metaTrace = [];
  const evidence = { prospective: 0, retrospective: 0 };
  const consensusStats = { resolved: 0, hits: 0, committed: 0, brierSum: 0, logLossSum: 0 };
  /**
   * Out-of-sample window: predictions the consensus made *after* the most recent
   * selection round. No selection decision ever saw these outcomes, so this block
   * is the only honest answer to "did evolution help?".
   */
  const holdout = { resolved: 0, hits: 0, committed: 0, brierSum: 0, logLossSum: 0 };
  /**
   * Equal-weight control arm. Same universes, same evidence, no Hedge weighting:
   * the only honest way to say whether the fusion rule itself adds anything.
   */
  const control = { resolved: 0, hits: 0, committed: 0, brierSum: 0, logLossSum: 0 };

  function makeUniverse({ genome, generation: gen, parents = [], bornReason = 'genesis', explorer = false } = {}) {
    const g = normalizeGenome(genome);
    const learner = new Float64Array(UNIVERSE_INPUT_SIZE);
    // Small seeded prior; bias starts at exactly 0 so no universe is born
    // long/short-biased (a real regression captured in Phase 6).
    for (let i = 0; i < UNIVERSE_INPUT_SIZE; i += 1) {
      learner[i] = i === UNIVERSE_INPUT_SIZE - 1 ? 0 : (rand() - 0.5) * 0.16;
    }
    const id = `U${String(nextOrdinal).padStart(2, '0')}`;
    nextOrdinal += 1;
    return {
      id,
      genome: g,
      genomeHash: genomeHash(g),
      hypothesis: classifyGenome(g, { explorer }),
      explorer: Boolean(explorer),
      generation: clamp(Math.round(safeNum(gen, 0)), 0, 999),
      parents: Array.isArray(parents) ? parents.slice(0, 2).map(String) : [],
      lineage: fnv1aHex(`${origin}:${id}:${genomeHash(g)}:${gen}`),
      bornReason,
      alive: true,
      learner,
      evidenceState: new Float64Array(UNIVERSE_INPUT_SIZE),
      resolved: 0,
      hits: 0,
      committed: 0,
      brierSum: 0,
      logLossSum: 0,
      pendingProbability: null,
      pendingCommitted: false,
      pendingInput: null,
      lastProbability: null,
      trace: []
    };
  }

  function reset({ seed: nextSeed = seed, population: nextPop = popSize } = {}) {
    const localRand = createUniversePrng(nextSeed);
    const size = clamp(
      Math.round(safeNum(nextPop, popSize)) || popSize,
      MIN_POPULATION,
      MAX_POPULATION
    );
    nextOrdinal = 1;
    universes = [];
    for (let i = 0; i < size; i += 1) {
      universes.push(makeUniverse({ genome: randomGenome(localRand), generation: 0 }));
    }
    weights = new Float64Array(size).fill(1 / size);
    generation = 0;
    ticks = 0;
    resolved = 0;
    ties = 0;
    sinceSelection = 0;
    hedgeUpdates = 0;
    totalBorn = 0;
    totalCulled = 0;
    selectionRounds = 0;
    pendingActive = false;
    pendingMeta = null;
    pendingAt = null;
    pendingFeatures = null;
    lastResolution = null;
    lastSelection = null;
    lastError = null;
    abandonedPredictions = 0;
    cullLedger.length = 0;
    pulseDeck.length = 0;
    metaTrace.length = 0;
    evidence.prospective = 0;
    evidence.retrospective = 0;
    consensusStats.resolved = 0;
    consensusStats.hits = 0;
    consensusStats.committed = 0;
    consensusStats.brierSum = 0;
    consensusStats.logLossSum = 0;
    holdout.resolved = 0;
    holdout.hits = 0;
    holdout.committed = 0;
    holdout.brierSum = 0;
    holdout.logLossSum = 0;
    control.resolved = 0;
    control.hits = 0;
    control.committed = 0;
    control.brierSum = 0;
    control.logLossSum = 0;
    return { ok: true, population: universes.length, seed: Number(nextSeed) >>> 0 };
  }

  /** Forward pass: leaky evidence → bounded logit → probability. */
  function forward(u, features) {
    const x = encodeInput(features, u.genome);
    const memory = clamp(safeNum(u.genome.memory, 0.3), 0, 0.95);
    for (let i = 0; i < UNIVERSE_INPUT_SIZE; i += 1) {
      u.evidenceState[i] = memory * u.evidenceState[i] + (1 - memory) * x[i];
    }
    let z = 0;
    for (let i = 0; i < UNIVERSE_INPUT_SIZE; i += 1) {
      z += u.learner[i] * (x[i] * 0.55 + u.evidenceState[i] * 0.45);
    }
    const sharpness = 0.55 + 0.95 * clamp(safeNum(u.genome.temperature, 1), 0.4, 1.8);
    return { probability: sigmoid(clamp(z * sharpness, -4.5, 4.5)), input: x };
  }

  /** Online logistic delta rule, RPE-gated and volatility-damped. */
  function learn(u, input, probability, outcome, features) {
    const plasticity = clamp(safeNum(u.genome.plasticity, 0.2), 0.02, 0.6);
    const target = outcome === 1 ? 1 : 0;
    const rpe = target - probability;
    const arousal = 0.55 + 0.9 * Math.min(1, Math.abs(rpe));
    const volDamp = 1 - 0.4 * clamp(safeNum(u.genome.volatility, 0.5), 0, 1.5) * Math.max(0, safeNum(features?.[2]));
    const lr = clamp(plasticity * arousal * clamp(volDamp, 0.35, 1), 0.002, 0.75);
    for (let i = 0; i < UNIVERSE_INPUT_SIZE; i += 1) {
      const decay = i === UNIVERSE_INPUT_SIZE - 1 ? 0.999 : 0.9985;
      u.learner[i] = clamp(
        u.learner[i] * decay + lr * rpe * (input?.[i] ?? 0),
        -MAX_ABS_WEIGHT,
        MAX_ABS_WEIGHT
      );
    }
  }

  /**
   * Emit one prediction for the *next* bar using only data available now.
   * Refuses a second observation before the previous one is resolved — that
   * invariant is what makes "no look-ahead" checkable rather than claimed.
   */
  function observe({ features, at = null, symbol = null, close = null, evidenceClass = 'prospective' } = {}) {
    const vector = sanitizeFeatures(features);
    if (!vector) {
      lastError = 'INVALID_FEATURES';
      return { ok: false, reason: 'INVALID_FEATURES' };
    }
    if (pendingActive) {
      lastError = 'PENDING_UNRESOLVED';
      return { ok: false, reason: 'PENDING_UNRESOLVED' };
    }
    let meta = 0;
    let equal = 0;
    let components = 0;
    let committedCount = 0;
    for (let i = 0; i < universes.length; i += 1) {
      const u = universes[i];
      if (!u.alive) continue;
      const { probability, input } = forward(u, vector);
      u.pendingProbability = round6(probability);
      u.pendingCommitted = isCommitted(probability);
      u.pendingInput = input;
      if (u.pendingCommitted) committedCount += 1;
      meta += weights[i] * probability;
      equal += probability;
      components += 1;
    }
    pendingMeta = round6(clamp(meta, 0.0001, 0.9999));
    pendingControl = components > 0 ? round6(clamp(equal / components, 0.0001, 0.9999)) : null;
    pendingActive = true;
    pendingAt = {
      at,
      symbol: symbol ? String(symbol).slice(0, 24) : null,
      close: Number.isFinite(Number(close)) ? Number(close) : null
    };
    pendingFeatures = vector;
    ticks += 1;
    if (evidenceClass === 'retrospective') evidence.retrospective += 1;
    else evidence.prospective += 1;
    lastError = null;
    return {
      ok: true,
      tick: ticks,
      metaProbability: pendingMeta,
      probabilities: universes.map((u) => (u.alive ? u.pendingProbability : null)),
      committed: committedCount,
      at
    };
  }

  /** Drop an unsettleable pending prediction WITHOUT scoring it (never silently). */
  function abandonPending(reasonCode) {
    pendingActive = false;
    pendingMeta = null;
    pendingControl = null;
    pendingFeatures = null;
    pendingAt = null;
    for (const u of universes) {
      u.pendingProbability = null;
      u.pendingCommitted = false;
      u.pendingInput = null;
    }
    abandonedPredictions += 1;
    lastResolution = { scored: false, abandoned: reasonCode, at: null };
    return { ok: true, settled: false, abandoned: reasonCode, index: null };
  }

  /**
   * Settle the live pending prediction with the FIRST real bar that closed after
   * it was made. A different symbol, or a missing timestamp/close reference,
   * means the prediction cannot be judged — it is abandoned unscored instead of
   * being matched to an unrelated candle.
   */
  function settlePending(clean, symbol, evidenceClass) {
    if (!pendingActive) return { ok: true, settled: false, index: null };
    if (pendingAt?.symbol && symbol && String(pendingAt.symbol) !== String(symbol)) {
      return abandonPending('SYMBOL_CHANGED');
    }
    const atTime = Number(pendingAt?.at);
    const atClose = Number(pendingAt?.close);
    if (!Number.isFinite(atTime) || !Number.isFinite(atClose) || atClose <= 0) {
      return abandonPending('MISSING_PENDING_REFERENCE');
    }
    let index = -1;
    for (let i = 0; i < clean.length; i += 1) {
      const t = Number(clean[i].time);
      if (Number.isFinite(t) && t > atTime) {
        index = i;
        break;
      }
    }
    if (index < 0) return { ok: true, settled: false, index: null, reason: 'AWAITING_NEXT_BAR' };
    const delta = clean[index].close - atClose;
    const outcome = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    const res = resolve({ outcome, at: clean[index].time ?? null, evidenceClass });
    return {
      ok: res.ok,
      settled: Boolean(res.ok && res.scored),
      tied: Boolean(res.tied),
      index,
      outcome,
      reason: res.ok ? null : res.reason
    };
  }

  /** Cull the worst quartile and breed children from tournament-selected survivors. */
  function runSelection({ reason = 'manual' } = {}) {
    if (resolved < MIN_RESOLVED_FOR_SELECTION) {
      return { ok: false, reason: 'INSUFFICIENT_EVIDENCE', resolved };
    }
    const ranked = [...universes].sort((a, b) => {
      if (shrunkLoss(a) !== shrunkLoss(b)) return shrunkLoss(a) - shrunkLoss(b);
      if (shrunkBrier(a) !== shrunkBrier(b)) return shrunkBrier(a) - shrunkBrier(b);
      return a.id.localeCompare(b.id);
    });
    const cullCount = Math.max(1, Math.floor(universes.length / 4));
    const victims = ranked.slice(-cullCount);
    const survivors = ranked.slice(0, ranked.length - cullCount);
    const sigma = Math.max(0.06, MUTATION_BASE * MUTATION_DECAY ** generation);
    const culled = [];
    const born = [];
    const replacement = new Map();

    const tournamentPick = (excludeId = null) => {
      const pool = survivors.length > 1 && excludeId
        ? survivors.filter((u) => u.id !== excludeId)
        : survivors;
      const source = pool.length ? pool : survivors;
      const a = source[Math.floor(rand() * source.length)] || source[0];
      const b = source[Math.floor(rand() * source.length)] || source[0];
      if (!a) return null;
      if (!b) return a;
      return shrunkLoss(a) <= shrunkLoss(b) ? a : b;
    };

    for (let v = 0; v < victims.length; v += 1) {
      const victim = victims[v];
      victim.alive = false;
      culled.push({
        id: victim.id,
        lineage: victim.lineage,
        hypothesis: victim.hypothesis,
        loss: round6(meanLoss(victim))
      });
      const isExplorerSlot = v === victims.length - 1;
      if (isExplorerSlot) {
        const child = makeUniverse({
          genome: randomGenome(rand),
          generation: generation + 1,
          parents: [],
          bornReason: 'explorer',
          explorer: true
        });
        replacement.set(victim.id, child);
        born.push({ id: child.id, lineage: child.lineage, parents: [], hypothesis: child.hypothesis, reason: 'explorer' });
        continue;
      }
      const a = tournamentPick();
      // Never breed a universe with itself: a clone is not a crossover.
      const b = tournamentPick(a?.id);
      if (!a || !b) {
        const child = makeUniverse({ genome: randomGenome(rand), generation: generation + 1, bornReason: 'fallback' });
        replacement.set(victim.id, child);
        born.push({ id: child.id, lineage: child.lineage, parents: [], hypothesis: child.hypothesis, reason: 'fallback' });
        continue;
      }
      const child = makeUniverse({
        genome: mutateGenome(crossoverGenome(a.genome, b.genome, rand), rand, sigma),
        generation: generation + 1,
        parents: [a.id, b.id],
        bornReason: 'crossover'
      });
      replacement.set(victim.id, child);
      born.push({
        id: child.id,
        lineage: child.lineage,
        parents: [a.id, b.id],
        hypothesis: child.hypothesis,
        reason: 'crossover',
        sigma: round6(sigma)
      });
    }

    const survivorMean =
      survivors.length > 0
        ? survivors.reduce((sum, u) => sum + safeNum(weights[universes.indexOf(u)], 0), 0) / survivors.length
        : 1 / universes.length;
    const nextWeights = Array.from(weights);
    universes = universes.map((u, i) => {
      const child = replacement.get(u.id);
      if (child) {
        // A child has zero evidence: it starts at the population mean weight and
        // must earn influence through the Hedge updates, exactly like everyone else.
        nextWeights[i] = Math.max(WEIGHT_FLOOR, survivorMean);
        return child;
      }
      return u;
    });
    weights = normalizeWeights(nextWeights);
    generation += 1;
    selectionRounds += 1;
    holdout.resolved = 0;
    holdout.hits = 0;
    holdout.committed = 0;
    holdout.brierSum = 0;
    holdout.logLossSum = 0;
    totalBorn += born.length;
    totalCulled += culled.length;
    sinceSelection = 0;
    lastSelection = { at: resolved, reason, generation, culled, born, sigma: round6(sigma) };
    cullLedger.push({ generation, reason, culled: culled.map((c) => c.id), born: born.map((b) => b.id) });
    while (cullLedger.length > MAX_CULL_LEDGER) cullLedger.shift();
    return { ok: true, generation, culled, born, sigma: round6(sigma), reason };
  }

  /** Resolve the pending prediction with the *realised* next-bar direction. */
  function resolve({ outcome, at = null, evidenceClass = 'prospective' } = {}) {
    const y = Number(outcome);
    if (!pendingActive) {
      lastError = 'NO_PENDING_PREDICTION';
      return { ok: false, reason: 'NO_PENDING_PREDICTION' };
    }
    if (y !== 1 && y !== -1 && y !== 0) {
      lastError = 'INVALID_OUTCOME';
      return { ok: false, reason: 'INVALID_OUTCOME' };
    }
    pendingActive = false;
    if (y === 0) {
      ties += 1;
      for (const u of universes) {
        u.pendingProbability = null;
        u.pendingCommitted = false;
        u.pendingInput = null;
      }
      pendingMeta = null;
      pendingControl = null;
      pendingFeatures = null;
      lastResolution = { outcome: 0, scored: false, tied: true, at, evidenceClass };
      return { ok: true, scored: false, tied: true, tieCount: ties };
    }

    const losses = [];
    let committedCorrect = 0;
    for (const u of universes) {
      if (!u.alive) continue;
      const p = clamp(safeNum(u.pendingProbability, 0.5), 1e-4, 1 - 1e-4);
      const loss = logLossOf(p, y);
      losses.push(loss);
      u.resolved += 1;
      u.lastProbability = p;
      u.brierSum += brierOf(p, y);
      u.logLossSum += loss;
      if (u.pendingCommitted) {
        u.committed += 1;
        if ((p >= 0.5 && y === 1) || (p < 0.5 && y === -1)) {
          u.hits += 1;
          committedCorrect += 1;
        }
      }
      // Learn *after* scoring, from the same input that produced the prediction.
      learn(u, u.pendingInput, p, y, pendingFeatures);
      const skill = 1 - u.brierSum / u.resolved / 0.25;
      u.trace.push(round6(skill));
      if (u.trace.length > TRACE_LENGTH) u.trace.shift();
      u.pendingProbability = null;
      u.pendingCommitted = false;
      u.pendingInput = null;
    }

    // Hedge / exponentiated-weights update (no-regret fusion rule).
    const next = new Float64Array(universes.length);
    let k = 0;
    for (let i = 0; i < universes.length; i += 1) {
      if (!universes[i].alive) {
        next[i] = WEIGHT_FLOOR;
        continue;
      }
      next[i] = Math.max(WEIGHT_FLOOR, weights[i] * Math.exp(-HEDGE_ETA * clamp(losses[k] ?? Math.LN2, 1e-4, 20)));
      k += 1;
    }
    weights = normalizeWeights(next);
    hedgeUpdates += 1;

    // Consensus is scored against its own snapshot prediction — never rebuilt.
    const metaP = clamp(safeNum(pendingMeta, 0.5), 1e-4, 1 - 1e-4);
    consensusStats.resolved += 1;
    consensusStats.brierSum += brierOf(metaP, y);
    consensusStats.logLossSum += logLossOf(metaP, y);
    if (isCommitted(metaP)) {
      consensusStats.committed += 1;
      if ((metaP >= 0.5 && y === 1) || (metaP < 0.5 && y === -1)) consensusStats.hits += 1;
    }
    metaTrace.push({ p: metaP, y: y === 1 ? 1 : 0 });
    if (metaTrace.length > META_TRACE_LENGTH) metaTrace.shift();

    const controlP = clamp(safeNum(pendingControl, 0.5), 1e-4, 1 - 1e-4);
    control.resolved += 1;
    control.brierSum += brierOf(controlP, y);
    control.logLossSum += logLossOf(controlP, y);
    if (isCommitted(controlP)) {
      control.committed += 1;
      if ((controlP >= 0.5 && y === 1) || (controlP < 0.5 && y === -1)) control.hits += 1;
    }
    pendingControl = null;

    resolved += 1;
    sinceSelection += 1;
    pendingMeta = null;
    pendingControl = null;
    pendingFeatures = null;
    lastResolution = {
      outcome: y,
      scored: true,
      tied: false,
      at,
      evidenceClass,
      metaProbability: round6(metaP),
      metaCorrect: (metaP >= 0.5 && y === 1) || (metaP < 0.5 && y === -1),
      committedCorrect
    };
    lastError = null;

    let selection = null;
    if (sinceSelection >= selInterval) {
      selection = runSelection({ reason: 'auto' });
    } else {
      holdout.resolved += 1;
      holdout.brierSum += brierOf(metaP, y);
      holdout.logLossSum += logLossOf(metaP, y);
      if (isCommitted(metaP)) {
        holdout.committed += 1;
        if ((metaP >= 0.5 && y === 1) || (metaP < 0.5 && y === -1)) holdout.hits += 1;
      }
    }
    return { ok: true, scored: true, outcome: y, resolved, selection, consensus: consensusSnapshot() };
  }

  function consensusSnapshot() {
    const n = consensusStats.resolved;
    const brier = n > 0 ? consensusStats.brierSum / n : null;
    const logLoss = n > 0 ? consensusStats.logLossSum / n : null;
    const probability = pendingActive ? pendingMeta : null;
    const direction =
      probability === null ? null : probability >= 0.52 ? 'UP' : probability <= 0.48 ? 'DOWN' : 'FLAT';
    const normalized = normalizeWeights(Array.from(weights));
    const activeIndexes = universes.map((u, i) => (u.alive ? i : -1)).filter((i) => i >= 0);
    return {
      probability: probability === null ? null : round6(probability),
      direction,
      confidence: probability === null ? null : round6(Math.abs(probability * 2 - 1)),
      pending: pendingActive,
      resolved: n,
      committed: consensusStats.committed,
      hits: consensusStats.hits,
      hitRate: consensusStats.committed > 0 ? round6(consensusStats.hits / consensusStats.committed) : null,
      brier: brier === null ? null : round6(brier),
      logLoss: logLoss === null ? null : round6(logLoss),
      brierSkill: brier === null ? null : round6(1 - brier / 0.25),
      ece: expectedCalibrationError(metaTrace),
      weightedUniverses: activeIndexes.filter((i) => normalized[i] > 0.02).length,
      componentCount: activeIndexes.length,
      control: {
        resolved: control.resolved,
        committed: control.committed,
        hitRate: control.committed > 0 ? round6(control.hits / control.committed) : null,
        brier: control.resolved > 0 ? round6(control.brierSum / control.resolved) : null,
        logLoss: control.resolved > 0 ? round6(control.logLossSum / control.resolved) : null,
        brierSkill: control.resolved > 0 ? round6(1 - control.brierSum / control.resolved / 0.25) : null,
        note: 'same universes, equal weights, no Hedge update — the control for the fusion rule'
      },
      holdout: {
        resolved: holdout.resolved,
        committed: holdout.committed,
        hitRate: holdout.committed > 0 ? round6(holdout.hits / holdout.committed) : null,
        brier: holdout.resolved > 0 ? round6(holdout.brierSum / holdout.resolved) : null,
        logLoss: holdout.resolved > 0 ? round6(holdout.logLossSum / holdout.resolved) : null,
        brierSkill: holdout.resolved > 0 ? round6(1 - holdout.brierSum / holdout.resolved / 0.25) : null,
        scope: 'consensus predictions made after the most recent selection round (never used by a selection decision)'
      }
    };
  }

  function report() {
    const normalized = normalizeWeights(Array.from(weights));
    const active = universes
      .map((u, i) => ({ u, weight: normalized[i], index: i }))
      .filter((row) => row.u.alive);
    const dispersionProbs = active.map((row) =>
      row.u.pendingProbability !== null && row.u.pendingProbability !== undefined
        ? row.u.pendingProbability
        : row.u.lastProbability
    );
    const pendingProbs = dispersionProbs
      .filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)))
      .map(Number);
    let pairSum = 0;
    let pairCount = 0;
    for (let i = 0; i < pendingProbs.length; i += 1) {
      for (let j = i + 1; j < pendingProbs.length; j += 1) {
        pairSum += Math.abs(pendingProbs[i] - pendingProbs[j]);
        pairCount += 1;
      }
    }
    const bullish = pendingProbs.filter((p) => p > 0.5).length;
    const total = pendingProbs.length;

    const ranked = [...active].sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return shrunkLoss(a.u) - shrunkLoss(b.u) || a.u.id.localeCompare(b.u.id);
    });

    const scored = active.filter((row) => row.u.resolved > 0);
    const best = [...scored].sort(
      (a, b) => shrunkLoss(a.u) - shrunkLoss(b.u) || a.u.id.localeCompare(b.u.id)
    )[0] || null;
    const oracle = [...scored].sort(
      (a, b) => a.u.brierSum / a.u.resolved - b.u.brierSum / b.u.resolved || a.u.id.localeCompare(b.u.id)
    )[0] || null;

    const consensus = consensusSnapshot();
    const bestBrier = best ? best.u.brierSum / best.u.resolved : null;
    const oracleBrier = oracle ? oracle.u.brierSum / oracle.u.resolved : null;

    const universesOut = ranked.map((row, index) => {
      const u = row.u;
      return {
        id: u.id,
        rank: index + 1,
        hypothesis: u.hypothesis,
        hypothesisFa: HYPOTHESIS_BY_ID[u.hypothesis]?.fa || null,
        hypothesisEn: HYPOTHESIS_BY_ID[u.hypothesis]?.en || null,
        generation: u.generation,
        parents: u.parents.slice(),
        lineage: u.lineage,
        genomeHash: u.genomeHash,
        explorer: u.explorer,
        bornReason: u.bornReason,
        alive: u.alive,
        genome: { ...u.genome },
        weight: round6(row.weight),
        resolved: u.resolved,
        committed: u.committed,
        hits: u.hits,
        hitRate: u.committed > 0 ? round6(u.hits / u.committed) : null,
        brier: u.resolved > 0 ? round6(u.brierSum / u.resolved) : null,
        logLoss: u.resolved > 0 ? round6(u.logLossSum / u.resolved) : null,
        brierSkill: u.resolved > 0 ? round6(1 - u.brierSum / u.resolved / 0.25) : null,
        pendingProbability: u.pendingProbability,
        pendingCommitted: u.pendingCommitted,
        lastProbability: u.lastProbability,
        trace: u.trace.slice()
      };
    });

    const body = {
      ok: true,
      schema: UNIVERSES_SCHEMA,
      version: UNIVERSES_VERSION,
      generatedAt: Date.now(),
      seed: origin,
      population: active.length,
      configuredPopulation: universes.length,
      generation,
      selectionInterval: selInterval,
      ticks,
      resolved,
      ties,
      pending: pendingActive,
      pendingAt,
      evidence: {
        ...evidence,
        class:
          evidence.retrospective > 0 && evidence.prospective > 0
            ? 'mixed'
            : evidence.retrospective > 0
              ? 'retrospective'
              : 'prospective'
      },
      consensus,
      best: best
        ? {
            id: best.u.id,
            hypothesis: best.u.hypothesis,
            brier: round6(bestBrier),
            logLoss: round6(meanLoss(best.u)),
            shrunkLogLoss: round6(shrunkLoss(best.u)),
            resolved: best.u.resolved,
            committed: best.u.committed,
            evidence: 'measured',
            hindsight: false
          }
        : null,
      oracle: oracle
        ? {
            id: oracle.u.id,
            hypothesis: oracle.u.hypothesis,
            brier: round6(oracleBrier),
            logLoss: round6(meanLoss(oracle.u)),
            resolved: oracle.u.resolved,
            committed: oracle.u.committed,
            hindsight: true,
            note: 'look-ahead reference only; never used for any decision'
          }
        : null,
      gap: (() => {
        if (consensus.brier === null) return null;
        const controlBrier = consensus.control.brier;
        return {
          controlBrier,
          consensusMinusControlBrier:
            controlBrier !== null ? round6(consensus.brier - controlBrier) : null,
          consensusMinusBestBrier: bestBrier !== null ? round6(consensus.brier - bestBrier) : null,
          consensusMinusOracleBrier: oracleBrier !== null ? round6(consensus.brier - oracleBrier) : null,
          coinBrier: 0.25,
          note:
            'control = same universes with equal weights (no Hedge). oracle is future-aware by construction; a positive oracle gap is expected.'
        };
      })(),
      diversity: {
        meanDisagreement: pairCount > 0 && pendingProbs.length >= 2 ? round6(pairSum / pairCount) : null,
        weightEntropy: round6(entropy01(active.map((row) => row.weight))),
        agreement: total ? round6(Math.max(bullish, total - bullish) / total) : null,
        distinctLineages: new Set(active.map((row) => row.u.lineage)).size,
        distinctGenomes: new Set(active.map((row) => row.u.genomeHash)).size,
        explorers: active.filter((row) => row.u.explorer).length
      },
      selection: {
        rounds: selectionRounds,
        born: totalBorn,
        culled: totalCulled,
        hedgeUpdates,
        last: lastSelection,
        ledger: cullLedger.slice()
      },
      pulses: pulseDeck.slice(),
      universes: universesOut,
      scope: {
        features: 'real candle features only (spikeEncoder.featuresFromCandles)',
        selectionEvidence: evidence.retrospective > 0 ? 'includes retrospective pulses' : 'prospective only',
        hitRateScope: 'committed decisions only (|p - 0.5| >= 0.05)',
        brierBaseline: 0.25,
        selectionScore: `log loss shrunk toward ln(2) with ${SHRINK_PRIOR_OBSERVATIONS} pseudo-observations`
      },
      honesty: {
        inventsPrices: false,
        lookaheadBars: 0,
        scoredOnlyAfterResolution: true,
        predictionCannotBeReplaced: true,
        abandonedUnscored: abandonedPredictions,
        hitRateRequiresResolution: true,
        hitRateNull: consensus.hitRate === null,
        oracleIsHindsight: true,
        retrospectiveConfirmsNothing: true,
        accuracyIsNotProfitability: true,
        syntheticDataUsed: false
      },
      laws: {
        canExecute: false,
        canSign: false,
        canMoveFunds: false,
        readOnly: true,
        zeroServerGpu: true
      },
      lastError
    };

    const hashInput = {
      seed: body.seed,
      population: body.population,
      generation: body.generation,
      ticks: body.ticks,
      resolved: body.resolved,
      ties: body.ties,
      consensus: [
        body.consensus.resolved,
        Number(body.consensus.brier ?? 0).toFixed(4),
        Number(body.consensus.logLoss ?? 0).toFixed(4),
        body.consensus.committed
      ],
      universes: body.universes.map((u) => [
        u.id,
        u.genomeHash,
        u.resolved,
        Number(u.brier ?? 0).toFixed(4),
        Number(u.logLoss ?? 0).toFixed(4),
        u.alive
      ])
    };
    return { ...body, contentHash: fnv1aHex(canonicalHashJson(hashInput)) };
  }

  /**
   * Walk forward over a real candle series.
   *
   * Contract:
   *   · If a live prediction is pending from an earlier pulse, the first bar that
   *     closed after it settles it (that bar did not exist when it was made).
   *   · Every step predicts bar i+1 using only bars up to i.
   *   · With `leavePending` (default) the population commits to the next,
   *     still-unknown bar, so the console can show a genuinely live probability.
   *   · A pulse over history is `retrospective`; the final live prediction is
   *     prospective because no such bar existed when it was made.
   */
  function runPulse({
    candles = [],
    symbol = null,
    breadthRatio = null,
    maxBars = MAX_PULSE_BARS,
    evidenceClass = 'retrospective',
    leavePending = true
  } = {}) {
    const clean = cleanCandles(candles);
    if (clean.length < MIN_CONTEXT_BARS + 2) {
      lastError = 'INSUFFICIENT_CANDLES';
      return { ok: false, reason: 'INSUFFICIENT_CANDLES', bars: clean.length, required: MIN_CONTEXT_BARS + 2 };
    }
    const settlement = settlePending(clean, symbol, evidenceClass);
    if (!settlement.ok) {
      lastError = settlement.reason || 'PENDING_UNRESOLVED';
      return { ok: false, reason: lastError };
    }
    const limit = clamp(Math.round(safeNum(maxBars, MAX_PULSE_BARS)) || MAX_PULSE_BARS, 1, MAX_PULSE_BARS);
    let start = Math.max(MIN_CONTEXT_BARS - 1, clean.length - 1 - limit);
    if (settlement.index !== null && settlement.index > start) start = settlement.index;
    // A live prediction is still waiting for the next bar: no new bar exists in
    // this series, so the walk-forward loop must not replay old steps.
    const awaitingNextBar = pendingActive;
    let steps = 0;
    let skipped = 0;
    let tieSteps = 0;
    for (let i = start; !awaitingNextBar && i < clean.length - 1; i += 1) {
      const features = featuresFromCandles(clean.slice(0, i + 1), { breadthRatio });
      if (!features.ok) {
        skipped += 1;
        continue;
      }
      const observed = observe({
        features: features.vector,
        at: clean[i].time ?? null,
        symbol,
        close: clean[i].close,
        evidenceClass
      });
      if (!observed.ok) {
        skipped += 1;
        break;
      }
      const delta = clean[i + 1].close - clean[i].close;
      const outcome = delta > 0 ? 1 : delta < 0 ? -1 : 0;
      const res = resolve({ outcome, at: clean[i + 1].time ?? null, evidenceClass });
      if (!res.ok) {
        skipped += 1;
        break;
      }
      if (res.tied) tieSteps += 1;
      steps += 1;
    }

    // Commit to the next, still-unknown bar (a live, unscored prediction).
    let live = null;
    if (leavePending && !pendingActive && clean.length >= 3) {
      const last = clean[clean.length - 1];
      const features = featuresFromCandles(clean, { breadthRatio });
      if (features.ok) {
        const observed = observe({
          features: features.vector,
          at: last.time ?? null,
          symbol,
          close: last.close,
          evidenceClass: 'prospective'
        });
        if (observed.ok) {
          live = {
            probability: observed.metaProbability,
            at: last.time ?? null,
            close: last.close,
            components: observed.probabilities.filter((v) => v !== null).length
          };
        }
      }
    }

    const summary = {
      ok: true,
      symbol: symbol ? String(symbol).slice(0, 24) : null,
      bars: steps,
      reason: awaitingNextBar ? 'AWAITING_NEXT_BAR' : null,
      skipped,
      ties: tieSteps,
      settlement: settlement.settled ? 'settled' : settlement.reason || settlement.abandoned || 'none',
      abandoned: settlement.abandoned || null,
      livePending: live,
      evidenceClass,
      from: clean[start]?.time ?? null,
      to: clean[clean.length - 1]?.time ?? null,
      generatedAt: Date.now()
    };
    pulseDeck.push(summary);
    while (pulseDeck.length > MAX_PULSE_LEDGER) pulseDeck.shift();
    lastError = null;
    return { ...summary, report: report() };
  }

  function toJSON() {
    return {
      schema: UNIVERSES_SCHEMA,
      version: UNIVERSES_VERSION,
      seed: origin,
      population: universes.length,
      selectionInterval: selInterval,
      generation,
      ticks,
      resolved,
      ties,
      sinceSelection,
      hedgeUpdates,
      totalBorn,
      totalCulled,
      selectionRounds,
      pendingActive,
      pendingMeta,
      pendingControl,
      pendingAt,
      pendingFeatures: pendingFeatures ? Array.from(pendingFeatures) : null,
      prngState: rand.state(),
      abandonedPredictions,
      lastResolution,
      lastSelection,
      consensusStats: { ...consensusStats },
      holdout: { ...holdout },
      controlStats: { ...control },
      evidence: { ...evidence },
      metaTrace: metaTrace.slice(),
      cullLedger: cullLedger.slice(),
      pulseDeck: pulseDeck.slice(),
      weights: Array.from(weights),
      universes: universes.map((u) => ({
        id: u.id,
        genome: { ...u.genome },
        hypothesis: u.hypothesis,
        explorer: u.explorer,
        generation: u.generation,
        parents: u.parents.slice(),
        lineage: u.lineage,
        bornReason: u.bornReason,
        alive: u.alive,
        learner: Array.from(u.learner),
        evidenceState: Array.from(u.evidenceState),
        resolved: u.resolved,
        hits: u.hits,
        committed: u.committed,
        brierSum: u.brierSum,
        logLossSum: u.logLossSum,
        pendingProbability: u.pendingProbability,
        pendingCommitted: u.pendingCommitted,
        lastProbability: u.lastProbability,
        trace: u.trace.slice()
      }))
    };
  }

  function restore(snapshot) {
    try {
      if (!snapshot || snapshot.schema !== UNIVERSES_SCHEMA || snapshot.version !== UNIVERSES_VERSION) {
        return { ok: false, reason: 'SCHEMA_MISMATCH' };
      }
      const rows = Array.isArray(snapshot.universes) ? snapshot.universes : [];
      if (rows.length < MIN_POPULATION || rows.length > MAX_POPULATION) {
        return { ok: false, reason: 'POPULATION_OUT_OF_RANGE' };
      }
      const rebuilt = rows.map((row) => {
        const genome = normalizeGenome(row.genome);
        const learner = new Float64Array(UNIVERSE_INPUT_SIZE);
        const evidenceState = new Float64Array(UNIVERSE_INPUT_SIZE);
        for (let i = 0; i < UNIVERSE_INPUT_SIZE; i += 1) {
          learner[i] = clamp(safeNum(row.learner?.[i], 0), -MAX_ABS_WEIGHT, MAX_ABS_WEIGHT);
          evidenceState[i] = clamp(safeNum(row.evidenceState?.[i], 0), -4, 4);
        }
        const id = String(row.id || '').slice(0, 8) || 'U??';
        const hash = genomeHash(genome);
        return {
          id,
          genome,
          genomeHash: hash,
          hypothesis: HYPOTHESIS_BY_ID[row.hypothesis] ? row.hypothesis : classifyGenome(genome, { explorer: row.explorer }),
          explorer: Boolean(row.explorer),
          generation: clamp(Math.round(safeNum(row.generation, 0)), 0, 999),
          parents: Array.isArray(row.parents) ? row.parents.slice(0, 2).map(String) : [],
          lineage: String(row.lineage || '').slice(0, MAX_LINEAGE_CHARS) || fnv1aHex(`${id}:${hash}`),
          bornReason: String(row.bornReason || 'restored').slice(0, 24),
          alive: row.alive !== false,
          learner,
          evidenceState,
          resolved: Math.max(0, Math.round(safeNum(row.resolved, 0))),
          hits: Math.max(0, Math.round(safeNum(row.hits, 0))),
          committed: Math.max(0, Math.round(safeNum(row.committed, 0))),
          brierSum: Math.max(0, safeNum(row.brierSum, 0)),
          logLossSum: Math.max(0, safeNum(row.logLossSum, 0)),
          pendingProbability: Number.isFinite(Number(row.pendingProbability)) ? Number(row.pendingProbability) : null,
          pendingCommitted: Boolean(row.pendingCommitted),
          pendingInput: null,
          lastProbability: Number.isFinite(Number(row.lastProbability)) ? Number(row.lastProbability) : null,
          trace: Array.isArray(row.trace)
            ? row.trace.filter((v) => Number.isFinite(Number(v))).slice(-TRACE_LENGTH).map(round6)
            : []
        };
      });

      const maxOrdinal = rebuilt.reduce((m, u) => {
        const n = Number(String(u.id).replace(/[^0-9]/g, ''));
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      nextOrdinal = Math.max(1, maxOrdinal + 1);
      universes = rebuilt;
      const rawWeights = Array.isArray(snapshot.weights) ? snapshot.weights : [];
      weights = normalizeWeights(
        rawWeights.length === rebuilt.length
          ? rawWeights.map((w) => safeNum(w, 0))
          : new Array(rebuilt.length).fill(1 / rebuilt.length)
      );
      generation = Math.max(0, Math.round(safeNum(snapshot.generation, 0)));
      ticks = Math.max(0, Math.round(safeNum(snapshot.ticks, 0)));
      resolved = Math.max(0, Math.round(safeNum(snapshot.resolved, 0)));
      ties = Math.max(0, Math.round(safeNum(snapshot.ties, 0)));
      sinceSelection = Math.max(0, Math.round(safeNum(snapshot.sinceSelection, 0)));
      hedgeUpdates = Math.max(0, Math.round(safeNum(snapshot.hedgeUpdates, 0)));
      totalBorn = Math.max(0, Math.round(safeNum(snapshot.totalBorn, 0)));
      totalCulled = Math.max(0, Math.round(safeNum(snapshot.totalCulled, 0)));
      selectionRounds = Math.max(0, Math.round(safeNum(snapshot.selectionRounds, 0)));
      pendingActive =
        Boolean(snapshot.pendingActive) && rebuilt.some((u) => Number.isFinite(Number(u.pendingProbability)));
      pendingMeta = pendingActive && Number.isFinite(Number(snapshot.pendingMeta)) ? Number(snapshot.pendingMeta) : null;
      pendingAt = snapshot.pendingAt && typeof snapshot.pendingAt === 'object' ? snapshot.pendingAt : null;
      pendingFeatures = null;
      pendingControl = pendingActive && Number.isFinite(Number(snapshot.pendingControl)) ? Number(snapshot.pendingControl) : null;
      const pf = Array.isArray(snapshot.pendingFeatures) && snapshot.pendingFeatures.length === UNIVERSE_FEATURE_SIZE
        ? snapshot.pendingFeatures.map((v) => clamp(safeNum(v, 0), -2, 2))
        : null;
      pendingFeatures = pendingActive ? pf : null;
      if (pendingActive && pendingFeatures) {
        for (const u of rebuilt) {
          if (Number.isFinite(Number(u.pendingProbability))) {
            u.pendingInput = encodeInput(pendingFeatures, u.genome);
          }
        }
      }
      if (Number.isFinite(Number(snapshot.prngState))) rand.restore(snapshot.prngState);
      abandonedPredictions = Math.max(0, Math.round(safeNum(snapshot.abandonedPredictions, 0)));
      lastResolution = snapshot.lastResolution && typeof snapshot.lastResolution === 'object' ? snapshot.lastResolution : null;
      lastSelection = snapshot.lastSelection && typeof snapshot.lastSelection === 'object' ? snapshot.lastSelection : null;
      const cs = snapshot.consensusStats || {};
      consensusStats.resolved = Math.max(0, Math.round(safeNum(cs.resolved, 0)));
      consensusStats.hits = Math.max(0, Math.round(safeNum(cs.hits, 0)));
      consensusStats.committed = Math.max(0, Math.round(safeNum(cs.committed, 0)));
      consensusStats.brierSum = Math.max(0, safeNum(cs.brierSum, 0));
      consensusStats.logLossSum = Math.max(0, safeNum(cs.logLossSum, 0));
      const ctl = snapshot.controlStats || {};
      control.resolved = Math.max(0, Math.round(safeNum(ctl.resolved, 0)));
      control.hits = Math.max(0, Math.round(safeNum(ctl.hits, 0)));
      control.committed = Math.max(0, Math.round(safeNum(ctl.committed, 0)));
      control.brierSum = Math.max(0, safeNum(ctl.brierSum, 0));
      control.logLossSum = Math.max(0, safeNum(ctl.logLossSum, 0));
      const ho = snapshot.holdout || {};
      holdout.resolved = Math.max(0, Math.round(safeNum(ho.resolved, 0)));
      holdout.hits = Math.max(0, Math.round(safeNum(ho.hits, 0)));
      holdout.committed = Math.max(0, Math.round(safeNum(ho.committed, 0)));
      holdout.brierSum = Math.max(0, safeNum(ho.brierSum, 0));
      holdout.logLossSum = Math.max(0, safeNum(ho.logLossSum, 0));
      evidence.prospective = Math.max(0, Math.round(safeNum(snapshot.evidence?.prospective, 0)));
      evidence.retrospective = Math.max(0, Math.round(safeNum(snapshot.evidence?.retrospective, 0)));
      metaTrace.length = 0;
      if (Array.isArray(snapshot.metaTrace)) {
        for (const row of snapshot.metaTrace.slice(-META_TRACE_LENGTH)) {
          if (row && Number.isFinite(Number(row.p)) && (row.y === 0 || row.y === 1)) {
            metaTrace.push({ p: Number(row.p), y: row.y });
          }
        }
      }
      cullLedger.length = 0;
      if (Array.isArray(snapshot.cullLedger)) {
        for (const row of snapshot.cullLedger.slice(-MAX_CULL_LEDGER)) {
          if (row && typeof row === 'object') cullLedger.push(row);
        }
      }
      pulseDeck.length = 0;
      if (Array.isArray(snapshot.pulseDeck)) {
        for (const row of snapshot.pulseDeck.slice(-MAX_PULSE_LEDGER)) {
          if (row && typeof row === 'object') pulseDeck.push(row);
        }
      }
      lastError = null;
      return { ok: true, restored: rebuilt.length, generation, resolved };
    } catch (err) {
      lastError = 'RESTORE_FAILED';
      return { ok: false, reason: 'RESTORE_FAILED', detail: String(err?.message || err).slice(0, 120) };
    }
  }

  reset({ seed, population: popSize });

  return {
    observe,
    resolve,
    runPulse,
    evolve: (opts) => runSelection({ reason: 'manual', ...(opts || {}) }),
    report,
    reset,
    toJSON,
    restore,
    stats: () => ({
      ticks,
      resolved,
      ties,
      generation,
      population: universes.filter((u) => u.alive).length
    })
  };
}

function crossoverGenome(a, b, rand) {
  const child = {};
  for (const key of GENE_KEYS) {
    child[key] = rand() < 0.5 ? a[key] : b[key];
  }
  return normalizeGenome(child);
}

function mutateGenome(genome, rand, sigma) {
  const out = {};
  for (const g of UNIVERSE_GENES) {
    const span = g.max - g.min;
    out[g.key] = clampGenomeValue(g.key, safeNum(genome[g.key]) + gaussian(rand) * sigma * span * 0.18);
  }
  return normalizeGenome(out);
}

/**
 * Pure-engine probe over a *clearly labelled synthetic* fixture. It is a
 * self-test of the mechanics (determinism, selection, dispersion), never market
 * evidence: the returned report sets `syntheticDataUsed: true` and repeats it
 * in words.
 */
export function probeResearchUniverses({
  seed = UNIVERSES_CANONICAL_SEED,
  population = DEFAULT_POPULATION,
  steps = 120,
  selectionInterval = SELECTION_INTERVAL
} = {}) {
  const engine = createResearchUniverses({ seed, population, selectionInterval });
  const rand = createUniversePrng((Number(seed) ^ 0x9e3779b9) >>> 0);
  const n = clamp(Math.round(safeNum(steps, 120)) || 120, 40, 600);
  const prices = [100];
  let drift = 0.0006;
  for (let i = 1; i <= n + 1; i += 1) {
    if (i % 37 === 0) drift = -drift * 1.15; // deterministic regime switch
    prices.push(Math.max(1, prices[i - 1] * (1 + drift + gaussian(rand) * 0.011)));
  }
  const candles = prices.map((p, i) => ({
    t: 1_700_000_000_000 + i * 3_600_000,
    o: p * (1 - 0.001),
    h: p * 1.004,
    l: p * 0.996,
    c: p
  }));
  const pulse = engine.runPulse({ candles, symbol: 'PROBE', maxBars: n });
  const report = engine.report();
  const universeBriers = report.universes.map((u) => u.brier).filter((v) => Number.isFinite(Number(v)));
  const meanUniverseBrier = universeBriers.length
    ? round6(universeBriers.reduce((s, v) => s + Number(v), 0) / universeBriers.length)
    : null;
  return {
    ...report,
    ok: true,
    probe: {
      kind: 'engine-self-test',
      syntheticDataUsed: true,
      fixture: 'deterministic seeded geometric random walk with a regime switch',
      steps: pulse.bars ?? 0,
      skipped: pulse.skipped ?? 0,
      ties: pulse.ties ?? 0,
      consensusBrier: report.consensus.brier,
      meanUniverseBrier,
      bestUniverseBrier: report.best?.brier ?? null,
      oracleBrier: report.oracle?.brier ?? null,
      selectionRounds: report.selection.rounds,
      diversityAfter: report.diversity.meanDisagreement,
      contentHash: report.contentHash,
      disclaimer:
        'synthetic fixture: proves the mechanics are deterministic and honest; it says nothing about the market'
    },
    honesty: { ...report.honesty, syntheticDataUsed: true }
  };
}
