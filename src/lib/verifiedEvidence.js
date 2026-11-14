/**
 * EVIDENCE QUALITY — «هوش تأییدشده», read for how much it is worth believing.
 * ===========================================================================
 * The verified board already refuses to invent wallets, prices, win rates and
 * scores. What it could not say is the thing «تأییدشده» actually implies:
 *
 *   An 82 built from 5 closes over 2 days and an 82 built from 40 closes over
 *   9 months are the same number on the card and a different claim about the
 *   world.
 *
 * Every input here is already on the payload or already derived by
 * `performance.js`. It adds no request, no timer and no storage, and it changes
 * no existing number — it explains one.
 *
 * ─── THE FOUR QUESTIONS ────────────────────────────────────────────────────
 *   1. HOW MANY TRADES?      5 is an admission floor, not a sample. A
 *                            Sharpe-like ratio on five returns is arithmetic.
 *   2. OVER HOW LONG?        Ten closes in one afternoon is one afternoon.
 *   3. FROM HOW MANY FILLS?  6 closes off 12 fills is six observations; 40
 *                            fills is a pattern.
 *   4. WHAT IS UNMEASURED?   Exit timing and early-entry accuracy are optional
 *                            and expensive. A 70%-covered score has 30% of its
 *                            weight resting on nothing, and now says so.
 *
 * ─── AND ONE RULE THAT MATTERS MORE THAN THE NUMBER ────────────────────────
 * A THIN sample is not a BAD wallet. It is one we cannot yet judge — so
 * `verdict` says `thin`, never `weak`, when the fault is sample size. Calling a
 * real trader «weak» because the indexer had 12 fills is the same lie as
 * calling an unmeasured wallet «strong», pointed the other way.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** Admission floor in performance.js: below this there is no score at all. */
export const EVIDENCE_MIN_CLOSES = 5;
/** The span below which a sample describes one session, not a track record. */
export const EVIDENCE_MIN_DAYS = 2;
/** At or above these, a dimension counts as established (weight 1). */
export const EVIDENCE_STRONG_CLOSES = 15;
export const EVIDENCE_STRONG_DAYS = 30;
export const EVIDENCE_STRONG_FILLS = 40;
/** Coverage under this means a third of the score's weight is unmeasured. */
export const EVIDENCE_COVERAGE_WEAK = 0.6;

/** Verdicts. `thin` is deliberately distinct from `weak`. */
export const EVIDENCE_VERDICTS = Object.freeze([
  'strong',    // enough trades, enough time, enough fills, most factors measured
  'fair',      // real but modest evidence
  'thin',      // the sample is the problem, not the wallet
  'weak',      // the evidence is adequate but the measured factors are poor
  'unmeasured' // no score to weigh — nothing to say about the wallet either way
]);

const FACTOR_KEYS = Object.freeze(['profitability', 'winRate', 'earlyEntryAccuracy',
  'exitTiming', 'consistency', 'capitalEfficiency', 'riskAdjustedPerformance']);

/**
 * Weigh one verified profile / leaderboard row.
 *
 * @param {object} input
 * @param {number} [input.score]            0–100 verified score (null = no score)
 * @param {number} [input.coverage]         measured weight, after truncation penalty
 * @param {number} [input.measuredCoverage] measured weight, before the penalty
 * @param {number} [input.closedTrades]
 * @param {object} [input.sample]           { swaps, closedTrades, observedDays, historyTruncated }
 * @param {object} [input.factors]          the seven factor values (null = unmeasured)
 * @param {boolean} [input.qualified]
 */
export function readEvidenceQuality({ score = null, coverage = null, measuredCoverage = null,
  closedTrades = null, sample = null, factors = null, qualified = false } = {}) {
  const closes = num(closedTrades) ?? num(sample?.closedTrades);
  const swaps = num(sample?.swaps);
  const days = num(sample?.observedDays);
  const cov = num(measuredCoverage) ?? num(coverage);
  const truncated = sample?.historyTruncated === true;
  const sc = num(score);

  /* ── growth curves: ramp from the floor to "established", never past 1 ────
     Log-shaped on purpose: the difference between 5 and 15 closes matters far
     more than the difference between 200 and 210. */
  const ramp = (v, floor, strong) => {
    if (v === null) return null;
    if (v <= floor) return 0;
    return clamp(Math.log1p(v - floor) / Math.log1p(Math.max(1, strong - floor)), 0, 1);
  };
  const depth = ramp(closes, EVIDENCE_MIN_CLOSES, EVIDENCE_STRONG_CLOSES);
  const span = ramp(days, EVIDENCE_MIN_DAYS, EVIDENCE_STRONG_DAYS);
  const breadth = ramp(swaps, closes ?? EVIDENCE_MIN_CLOSES, EVIDENCE_STRONG_FILLS);

  const parts = { depth, span, breadth, coverage: cov === null ? null : clamp(cov, 0, 1) };
  const measuredKeys = Object.keys(parts).filter((k) => parts[k] !== null);
  const weights = { depth: 0.34, span: 0.26, breadth: 0.20, coverage: 0.20 };

  /* A confidence number built from one part is that part wearing a hat. Without
     both a close count and a span there is nothing to weigh, and the refusal
     names the missing inputs rather than returning a flattering zero. */
  const requiredMissing = [];
  if (depth === null) requiredMissing.push('closedTrades');
  if (span === null) requiredMissing.push('observedDays');
  const confidence = (requiredMissing.length || !measuredKeys.length)
    ? null
    : Math.round(clamp(
      measuredKeys.reduce((s, k) => s + parts[k] * weights[k], 0)
        / measuredKeys.reduce((s, k) => s + weights[k], 0),
      0, 1
    ) * 100);

  /* ── what went unmeasured, by name ─────────────────────────────────────── */
  const missingFactors = factors && typeof factors === 'object'
    ? FACTOR_KEYS.filter((k) => num(factors[k]) === null) : [];
  const measuredFactors = factors && typeof factors === 'object'
    ? FACTOR_KEYS.filter((k) => num(factors[k]) !== null) : [];

  /* ── the verdict: sample first, quality second ────────────────────────────
     ORDER MATTERS. A 91 with five closes is `thin` — not `strong`, and not
     `weak` either: the score is real, the sample cannot support it. */
  let verdict = 'unmeasured';
  let reason = sc === null ? 'no-verified-score' : 'not-computed';
  if (sc !== null && confidence !== null) {
    if (depth === 0 || span === 0) {
      verdict = 'thin';
      reason = depth === 0 ? 'at-the-admission-floor' : 'single-session-sample';
    } else if (sc < 55 && confidence >= 45) {
      /* POOR FACTORS OUTRANK DEEP EVIDENCE. A score of 42 measured over 22
         closes is *well-evidenced* and still a bad trader — and a card that
         read «strong» next to a 42 would be read as praise for the wallet. The
         evidence is good; the answer is no. */
      verdict = 'weak';
      reason = 'adequate-sample-poor-factors';
    } else if (confidence >= 70 && (cov === null || cov >= EVIDENCE_COVERAGE_WEAK)) {
      verdict = 'strong';
      reason = 'deep-and-measured';
    } else {
      verdict = 'fair';
      reason = 'real-but-modest';
    }
  }

  /* ── the ranking correction ──────────────────────────────────────────────
     A 91 from five closes must not outrank a 78 from forty. The shrinkage is
     towards the scale's own midpoint and only ever PULLS DOWN a thin score —
     it never invents a better one — and the card shows both numbers, so the
     adjustment is auditable rather than mysterious.
     
     The floor is 0.35, not 0.55: the first draft kept 55% of every score no
     matter how thin the sample, and a lucky 95 on five closes still came out
     at 79.6 — above a genuinely measured 78. A score we cannot support should
     have to be FURTHER ahead to win, and 0.35 does that while leaving even a
     zero-evidence score with the shape of its own result. */
  const SHRINK_FLOOR = 0.35;
  const adjustedScore = sc === null || confidence === null
    ? null
    : round(50 + (sc - 50) * (SHRINK_FLOOR + (1 - SHRINK_FLOOR) * (confidence / 100)), 1);

  return {
    schema: 'fbt.smart-money-evidence.v1',
    measured: confidence !== null,
    confidence,
    partsCovered: measuredKeys.length,
    partsMissing: Object.keys(parts).filter((k) => parts[k] === null),
    refusedBecause: confidence === null ? `no-sample:${requiredMissing.join('+')}` : null,
    verdict,
    reason,
    score: sc,
    adjustedScore,
    qualified: qualified === true,
    closes,
    swaps,
    observedDays: days,
    coverage: cov,
    historyTruncated: truncated,
    measuredFactors,
    missingFactors,
    /* Missing factors are not "bad", they are expensive to measure. */
    factorsNote: missingFactors.length
      ? `${missingFactors.length} of ${FACTOR_KEYS.length} factors unmeasured (${missingFactors.join(', ')}); the score is normalised over the rest.`
      : null,
    note: verdict === 'thin'
      ? 'The sample is too small to judge this wallet — not evidence that it trades badly.'
      : verdict === 'strong' ? null : 'Behavioural evidence, not a probability of profit.'
  };
}

/**
 * Weigh a whole leaderboard, in the order the reader will read it.
 *
 * The board sorts by raw score, which is exactly the comparison a thin sample
 * cannot survive: one lucky 6-close wallet sits above established traders.
 * This returns the board re-ordered by the shrunk score with the raw score kept
 * beside it, plus the board-level facts a per-card read cannot state.
 *
 * @param {object} input
 * @param {Array}  input.wallets leaderboard rows
 */
export function readBoardQuality({ wallets = [] } = {}) {
  const rows = (Array.isArray(wallets) ? wallets : []).filter((w) => w && w.address);
  if (!rows.length) {
    return { measured: false, count: 0, rows: [], strong: 0, fair: 0, thin: 0, weak: 0,
      unmeasured: 0, established: 0, boardConfidence: null, concentratedIn: null,
      topShare: null, note: 'empty-board' };
  }
  const read = rows.map((w) => ({ ...w, evidence: readEvidenceQuality(w) }));
  const count = (v) => read.filter((r) => r.evidence.verdict === v).length;

  /* Ordering: established evidence first, then the shrunk score. A row with no
     score cannot outrank a measured one — it goes last, not top. */
  const ranked = [...read].sort((a, b) => {
    const av = a.evidence.adjustedScore;
    const bv = b.evidence.adjustedScore;
    if (av === null && bv === null) return (b.evidence.closes ?? 0) - (a.evidence.closes ?? 0);
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });

  const withScore = read.map((r) => r.evidence.confidence).filter((c) => c !== null);
  const boardConfidence = withScore.length
    ? Math.round(withScore.reduce((s, c) => s + c, 0) / withScore.length) : null;

  /* Concentration over CLOSED TRADES, not dollars: the board's evidential
     weight sitting in one wallet is the interesting number, and a flat-P&L
     wallet with forty closes is more evidence than a big one with five. */
  const totalCloses = read.reduce((s, r) => s + (r.evidence.closes ?? 0), 0);
  const top = read.reduce((a, b) => ((b.evidence.closes ?? 0) > (a?.evidence.closes ?? 0) ? b : a), null);
  const topShare = totalCloses > 0 && top
    ? clamp((top.evidence.closes ?? 0) / totalCloses, 0, 1) : null;

  const strong = count('strong');
  const fair = count('fair');
  return {
    measured: true,
    count: read.length,
    rows: ranked,
    strong,
    fair,
    thin: count('thin'),
    weak: count('weak'),
    unmeasured: count('unmeasured'),
    established: strong + fair,
    boardConfidence,
    /* A board where nothing clears the thin line is a watchlist, and the note
       says so instead of letting the cards imply otherwise. */
    concentratedIn: topShare !== null && topShare >= 0.5 && top
      ? { address: top.address, sharePct: Math.round(topShare * 100) } : null,
    topShare,
    note: !withScore.length ? 'nothing-scored'
      : count('thin') > strong + fair ? 'mostly-thin-samples'
        : strong === 0 ? 'no-established-track-record'
          : 'established-majority'
  };
}

/**
 * WHY a wallet is not qualified, as countable causes.
 *
 * «INSUFFICIENT_EVIDENCE» is one word for a wallet with four closes, one with a
 * losing record, and one whose history page was truncated — and only one of
 * those is a reason to stop watching. This names them, over gates the server
 * already applied; it evaluates nothing new and fetches nothing.
 *
 * @param {object} input
 */
export function readQualificationGaps({ qualified = false, closedTrades = null, sample = null,
  winRate = null, realizedUsd = null, score = null, coverage = null } = {}) {
  const gaps = [];
  if (qualified === true) return { qualified: true, gaps, primary: null, gate: 'passed', note: null };
  const closes = num(closedTrades) ?? num(sample?.closedTrades);
  const days = num(sample?.observedDays);
  const cov = num(coverage);
  if (closes !== null && closes < EVIDENCE_MIN_CLOSES) {
    gaps.push({ gate: 'closes', have: closes, need: EVIDENCE_MIN_CLOSES });
  }
  if (days !== null && days < EVIDENCE_MIN_DAYS) {
    gaps.push({ gate: 'days', have: days, need: EVIDENCE_MIN_DAYS });
  }
  if (cov !== null && cov < EVIDENCE_COVERAGE_WEAK) {
    gaps.push({ gate: 'coverage', have: round(cov, 2), need: EVIDENCE_COVERAGE_WEAK });
  }
  if (score !== null && num(score) !== null && num(score) < 70) {
    gaps.push({ gate: 'score', have: num(score), need: 70 });
  }
  if (winRate !== null && num(winRate) !== null && num(winRate) < 55) {
    gaps.push({ gate: 'winRate', have: num(winRate), need: 55 });
  }
  if (realizedUsd !== null && num(realizedUsd) !== null && num(realizedUsd) <= 0) {
    gaps.push({ gate: 'realized', have: num(realizedUsd), need: '>0' });
  }
  return {
    qualified: false,
    gaps,
    /* The FIRST binding gate is the one worth printing: a wallet with two
       closes does not need to hear about its win rate yet. */
    primary: gaps[0]?.gate ?? null,
    gate: gaps.length ? 'blocked' : 'unmeasured',
    note: gaps.length
      ? 'Not qualified yet — the named gate is the first one not met, not a judgement on the wallet.'
      : 'Not qualified, and no gate could be evaluated: the measurement itself is missing.'
  };
}

export default readEvidenceQuality;
