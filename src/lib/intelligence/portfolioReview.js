/**
 * FBT AI INTELLIGENCE — PORTFOLIO REVIEW
 * ---------------------------------------------------------------------------
 * «بررسی پرتفوی باید از نظر زیان‌دهی، سود، بهترین و ضعیف‌ترین عملکرد بررسی کند
 *  و داده‌های معتبر بده و همچنین پیشنهادهایی برای بهتر شدن بده»
 *
 * A review is not a score. It is an ANSWER with a shape, and this module is
 * that shape. It reads the measured blocks that already exist — valuation,
 * price performance, allocation, concentration, risk with its causes — and
 * turns them into the four things a person actually asks:
 *
 *   1. «الان کجایم؟»   verdict + the two numbers that produced it
 *   2. «سود یا زیان؟»  performance (measured) beside P&L (known or unknown)
 *   3. «بهترین/ضعیف‌ترین» best and worst with the dollars they moved, and the
 *      loss list, because a review that only lists winners is marketing
 *   4. «چه کنم؟»       ordered actions, each with the evidence that raised it,
 *      its horizon, and how confident the measurement allows us to be
 *
 * ─── WHY EVERY ACTION IS DERIVED, NOT WRITTEN ───────────────────────────────
 * The suggestions are not a fixed script with the numbers dropped in. Each
 * finding is a RULE over a measured value, and a rule fires only when its
 * threshold is crossed by a number that exists. An empty portfolio produces
 * zero findings rather than five generic tips, and a portfolio that is fine
 * produces the sentence that says so — «کاری لازم نیست» is a legitimate
 * review result.
 *
 * ─── WHAT THE REVIEW WILL NOT DO ────────────────────────────────────────────
 * · It will not claim a profit the lot ledger cannot prove. Performance is
 *   labelled as performance; P&L is labelled P&L and may be 'unknown'.
 * · It will not invent a target allocation. When it recommends trimming a
 *   position it names the measured reason and the measured size; the actual
 *   percentages are the user's call, and the UI says so.
 * · Every finding carries `severity`, `evidence` (the numbers) and
 *   `confidence` (what coverage allows), and the whole review carries
 *   'not-advice'.
 */

export const PORTFOLIO_REVIEW_VERSION = 'fbt.portfolio-review.v1';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, d = 2) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Severity order used for sorting and for the headline tone. */
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

export const FINDING_KINDS = Object.freeze({
  CONCENTRATION: 'concentration',
  DRAWDOWN_HOLDING: 'largest-loss',
  NO_CASH_BUFFER: 'no-cash-buffer',
  CORRELATION: 'correlated-book',
  NETWORK: 'network-concentration',
  UNPRICED: 'unpriced-holdings',
  NO_COST_BASIS: 'missing-cost-basis',
  PNL_NEGATIVE: 'negative-pnl',
  PERFORMANCE_NEGATIVE: 'negative-performance',
  PERFORMANCE_POSITIVE: 'positive-performance',
  WINNER_TOO_SMALL: 'winner-underweight',
  UNMEASURED: 'unmeasured-performance'
});

/**
 * Turn one measured fact into a finding. Kept as a helper so every finding in
 * this file has exactly the same shape — the UI, the chat and the tests all
 * read `kind`, `severity`, `value`, `evidence`, `confidence`.
 */
function finding({ kind, severity, value, evidence = [], confidence, horizon = 'short', actionHref = null }) {
  return {
    kind,
    severity,
    value: round(value),
    evidence,
    confidence: isNum(confidence) ? Math.round(clamp(confidence, 1, 99)) : null,
    horizon,
    actionHref
  };
}

/**
 * How much the measurements can be trusted, as a 0..99 confidence.
 * Coverage is the weight share that actually had a 24h change; provenance can
 * only lower it. A review built on half the book says so by being less sure.
 */
export function reviewConfidence({ performance = null, coverageShare = null, provenance = null } = {}) {
  const covered = num(coverageShare) ?? num(performance?.coverage?.coveredSharePct) ?? 0;
  let c = 40 + Math.min(1, covered / 100) * 45;
  const rows = num(performance?.coverage?.withChange1d) ?? 0;
  if (rows >= 5) c += 5;
  if (provenance === 'stale') c -= 12;
  if (provenance === 'offline') c -= 25;
  return Math.round(clamp(c, 5, 95));
}

/**
 * Build the review.
 *
 * @param {object} input.intel        buildIntelligence() output
 * @param {object} input.analysis     buildPortfolioAnalysis() output
 * @param {object} input.performance  buildPerformance() output
 * @param {string} input.locale       'fa' | 'en'
 * @param {number} input.now
 */
export function buildPortfolioReview({ intel = null, analysis = null, performance = null, locale = 'fa', now = Date.now() } = {}) {
  const fa = String(locale || '').startsWith('fa');
  if (!intel || !(num(intel.total) > 0)) {
    return {
      version: PORTFOLIO_REVIEW_VERSION,
      ok: false,
      reason: 'no-priced-holdings',
      headline: fa
        ? 'برای بررسی، دست‌کم یک دارایی قیمت‌گذاری‌شده لازم است.'
        : 'A review needs at least one priced holding.',
      findings: [],
      confidence: 0,
      caveats: ['not-advice'],
      generatedAt: now
    };
  }

  const rows = intel.rows || [];
  const risk = analysis?.risk || null;
  const pnl = analysis?.pnl || { status: 'unknown' };
  const conf = reviewConfidence({ performance, coverageShare: performance?.coverage?.coveredSharePct });
  const findings = [];

  const best = performance?.best?.d1 ?? null;
  const worst = performance?.worst?.d1 ?? null;
  const d1 = performance?.returns?.d1 ?? null;
  const d7 = performance?.returns?.d7 ?? null;

  /* ── 1. performance, positive or negative ─────────────────────────────── */
  if (isNum(d1)) {
    if (d1 <= -0.5) {
      findings.push(finding({
        kind: FINDING_KINDS.PERFORMANCE_NEGATIVE,
        severity: d1 <= -5 ? 'critical' : d1 <= -2 ? 'high' : 'medium',
        value: d1,
        confidence: conf,
        horizon: 'short',
        evidence: [
          { key: 'portfolio-return-24h', value: d1 },
          { key: 'portfolio-move-usd-24h', value: performance?.returns?.absUsd1d ?? null },
          { key: 'covered-weight', value: performance?.coverage?.coveredSharePct ?? null }
        ]
      }));
    } else if (d1 >= 0.5) {
      findings.push(finding({
        kind: FINDING_KINDS.PERFORMANCE_POSITIVE,
        severity: 'none',
        value: d1,
        confidence: conf,
        horizon: 'short',
        evidence: [
          { key: 'portfolio-return-24h', value: d1 },
          { key: 'portfolio-move-usd-24h', value: performance?.returns?.absUsd1d ?? null },
          ...(isNum(d7) ? [{ key: 'portfolio-return-7d', value: d7 }] : [])
        ]
      }));
    }
  } else {
    findings.push(finding({
      kind: FINDING_KINDS.UNMEASURED,
      severity: 'medium',
      value: null,
      confidence: 95,
      evidence: [{ key: 'missing-24h-change', value: (performance?.missing || []).join(', ') || null }]
    }));
  }

  /* ── 2. the weakest holding, named with the money it lost ─────────────── */
  if (worst && isNum(worst.change1d) && worst.change1d <= -1) {
    findings.push(finding({
      kind: FINDING_KINDS.DRAWDOWN_HOLDING,
      severity: worst.change1d <= -10 ? 'high' : worst.change1d <= -5 ? 'medium' : 'low',
      value: worst.change1d,
      confidence: conf,
      horizon: 'short',
      evidence: [
        { key: 'symbol', value: worst.symbol },
        { key: 'change-24h', value: worst.change1d },
        { key: 'holding-weight', value: worst.weight },
        { key: 'move-usd-24h', value: worst.move1dUsd }
      ]
    }));
  }

  /* ── 3. concentration, from the measured top weight ───────────────────── */
  const topShare = num(intel.topShare) ?? 0;
  const topSymbol = rows[0]?.symbol ?? null;
  if (topShare >= 35) {
    findings.push(finding({
      kind: FINDING_KINDS.CONCENTRATION,
      severity: topShare >= 70 ? 'critical' : topShare >= 50 ? 'high' : 'medium',
      value: topShare,
      confidence: 90,
      horizon: 'medium',
      evidence: [
        { key: 'symbol', value: topSymbol },
        { key: 'top-share', value: topShare },
        { key: 'effective-holdings', value: analysis?.concentration?.effectiveHoldings ?? null }
      ]
    }));
  }

  /* ── 4. cash buffer ──────────────────────────────────────────────────── */
  const stablePct = num(intel.stablePct) ?? 0;
  if (stablePct < 5) {
    findings.push(finding({
      kind: FINDING_KINDS.NO_CASH_BUFFER,
      severity: stablePct < 1 ? 'medium' : 'low',
      value: stablePct,
      confidence: 85,
      horizon: 'short',
      evidence: [{ key: 'stablecoin-share', value: stablePct }]
    }));
  }

  /* ── 5. the book moves as one asset ───────────────────────────────────── */
  const avgCorr = num(analysis?.correlation?.average);
  if (isNum(avgCorr) && avgCorr >= 0.7) {
    findings.push(finding({
      kind: FINDING_KINDS.CORRELATION,
      severity: avgCorr >= 0.85 ? 'high' : 'medium',
      value: avgCorr,
      confidence: 80,
      horizon: 'long',
      evidence: [
        { key: 'average-correlation', value: avgCorr },
        { key: 'pairs', value: analysis?.correlation?.pairs?.length ?? null }
      ]
    }));
  }

  /* ── 6. one network carrying everything ───────────────────────────────── */
  const chains = analysis?.chainAllocation || [];
  const topChain = chains[0];
  if (topChain && num(topChain.weight) >= 70) {
    findings.push(finding({
      kind: FINDING_KINDS.NETWORK,
      severity: num(topChain.weight) >= 90 ? 'high' : 'medium',
      value: topChain.weight,
      confidence: 82,
      horizon: 'medium',
      evidence: [{ key: 'chain-id', value: topChain.chainId }, { key: 'chain-share', value: topChain.weight }]
    }));
  }

  /* ── 7. rows we could not price ──────────────────────────────────────── */
  const unpriced = rows.filter((r) => !isNum(r.value) && Number(r.amount) > 0).length;
  if (unpriced > 0) {
    findings.push(finding({
      kind: FINDING_KINDS.UNPRICED,
      severity: 'medium',
      value: unpriced,
      confidence: 95,
      horizon: 'immediate',
      evidence: [{ key: 'unpriced-rows', value: unpriced }]
    }));
  }

  /* ── 8. P&L: only when the ledger can prove it ────────────────────────── */
  if (pnl.status === 'unknown' || pnl.status === 'partial') {
    const rowsWithoutCost = rows.filter((r) => r.cost == null).length;
    findings.push(finding({
      kind: FINDING_KINDS.NO_COST_BASIS,
      severity: 'low',
      value: rowsWithoutCost,
      confidence: 95,
      horizon: 'immediate',
      evidence: [
        { key: 'pnl-status', value: pnl.status },
        { key: 'rows-without-cost', value: rowsWithoutCost }
      ]
    }));
  } else if (isNum(pnl.unrealised) && pnl.unrealised < 0) {
    findings.push(finding({
      kind: FINDING_KINDS.PNL_NEGATIVE,
      severity: 'medium',
      value: pnl.unrealised,
      confidence: 90,
      horizon: 'short',
      evidence: [
        { key: 'unrealised-pnl', value: pnl.unrealised },
        { key: 'realised-pnl', value: pnl.realised ?? null }
      ]
    }));
  }

  /* ── 9. the winner that does not matter ──────────────────────────────── */
  if (best && isNum(best.change1d) && best.change1d >= 5 && isNum(best.weight) && best.weight < 3) {
    findings.push(finding({
      kind: FINDING_KINDS.WINNER_TOO_SMALL,
      severity: 'low',
      value: best.weight,
      confidence: 70,
      horizon: 'short',
      evidence: [
        { key: 'symbol', value: best.symbol },
        { key: 'change-24h', value: best.change1d },
        { key: 'holding-weight', value: best.weight }
      ]
    }));
  }

  findings.sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || ((b.confidence ?? 0) - (a.confidence ?? 0)));

  /* ── the verdict line ─────────────────────────────────────────────────── */
  const toneOf = (perf, riskBand) => {
    if (isNum(perf) && perf <= -3) return 'loss';
    if (riskBand === 'high' && !(isNum(perf) && perf > 1)) return 'fragile';
    if (isNum(perf) && perf >= 1) return 'gain';
    return 'flat';
  };
  const verdict = toneOf(d1, risk?.band);

  const headline = (() => {
    if (verdict === 'loss') {
      return fa
        ? `پرتفوی در ۲۴ ساعت ${Math.abs(d1).toFixed(2)}٪ افت کرده است — زیان‌ده.`
        : `The portfolio is down ${Math.abs(d1).toFixed(2)}% over 24h — a loss.`;
    }
    if (verdict === 'fragile') {
      return fa
        ? `پرتفوی حرکت بزرگی نداشته، اما ریسکش ${risk?.score ?? '—'}/۱۰۰ و بالاست.`
        : `The portfolio has not moved much, but its risk is ${risk?.score ?? '—'}/100 — high.`;
    }
    if (verdict === 'gain') {
      return fa
        ? `پرتفوی در ۲۴ ساعت ${d1.toFixed(2)}٪ رشد کرده است — سودده.`
        : `The portfolio is up ${d1.toFixed(2)}% over 24h — profitable in price terms.`;
    }
    return fa
      ? 'پرتفوی در ۲۴ ساعت تغییر معناداری نداشته است.'
      : 'The portfolio has not moved meaningfully over 24h.';
  })();

  /* Ordered actions, only from findings that are actually actionable. */
  const actions = findings
    .filter((f) => f.kind !== FINDING_KINDS.PERFORMANCE_POSITIVE && f.kind !== FINDING_KINDS.UNMEASURED)
    .map((f, index) => ({ rank: index + 1, ...f }));

  return {
    version: PORTFOLIO_REVIEW_VERSION,
    ok: true,
    generatedAt: now,
    verdict,
    headline,
    confidence: conf,
    coverage: performance?.coverage ?? null,
    performance: performance
      ? {
          status: performance.status,
          basis: performance.basis,
          d1,
          d7,
          absUsd1d: performance.returns?.absUsd1d ?? null,
          absUsd7d: performance.returns?.absUsd7d ?? null,
          dispersion: performance.dispersion1d ?? null,
          breadth: performance.breadth ?? null,
          missing: performance.missing ?? []
        }
      : null,
    /* P&L is reported beside performance, never merged with it. */
    pnl: {
      status: pnl.status || 'unknown',
      realised: pnl.realised ?? null,
      unrealised: pnl.unrealised ?? null,
      cost: pnl.cost ?? null
    },
    best: best
      ? { symbol: best.symbol, change: best.change1d, weight: best.weight, moveUsd: best.move1dUsd, value: best.valueUsd }
      : null,
    worst: worst
      ? { symbol: worst.symbol, change: worst.change1d, weight: worst.weight, moveUsd: worst.move1dUsd, value: worst.valueUsd }
      : null,
    losses: (performance?.attribution || [])
      .filter((a) => isNum(a.change1d) && a.change1d < 0)
      .slice(0, 5)
      .map((a) => ({ symbol: a.symbol, change: a.change1d, weight: a.weight, moveUsd: a.move1dUsd })),
    risk: risk
      ? { score: risk.score, band: risk.band, reasons: risk.reasons, unavailable: risk.unavailable }
      : null,
    findings,
    actions,
    /* One sentence the UI can print when there is nothing to change. */
    note: findings.length
      ? null
      : (fa
        ? 'با داده اندازه‌گیری‌شده فعلی، تغییر مشخصی لازم نیست؛ همین ترکیب را رصد کنید.'
        : 'On the current measurements nothing specific needs changing; keep watching this mix.'),
    caveats: [
      'not-advice',
      'performance-is-not-realised-pnl',
      ...(pnl.status === 'unknown' ? ['cost-basis-unknown'] : []),
      ...(performance?.status === 'partial' ? ['partial-performance-coverage'] : [])
    ]
  };
}
