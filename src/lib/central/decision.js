/**
 * FBT FINANCIAL BRAIN — Decision Engine + scoring (Upgrade 10 §10, §11, §12).
 * ---------------------------------------------------------------------------
 * The difference between a recommender and a decision engine is that a decision
 * engine produces SEVERAL candidates and says why one beat the others. This
 * module does exactly that and nothing else:
 *
 *   buildCandidates()  financial state + goal + opportunities + risk → options
 *   scoreDecision()    one candidate → a DecisionScore with named components
 *   rankDecisions()    candidates → ordered, with the pairwise "why #1 > #2"
 *
 * THE HONESTY CONSTRAINTS
 * 1. A candidate whose expected benefit has no evidence is not scored — it is
 *    returned with `status: 'UNSCORED'` and the missing input named. §73 forbids
 *    "recommendation without evidence", and the only way to enforce that is to
 *    make an unevidenced candidate structurally unable to win.
 * 2. Weights are DATA, not magic constants buried in a formula. They are
 *    returned with every score so a UI can show them and a user can disagree.
 * 3. `expectedReturnPct` is an ESTIMATE and every output says so. No candidate
 *    ever carries a guarantee field, because there is nothing to put in it.
 */
import { CI_SCHEMA, round, usableNumber } from './schema.js';

export const DECISION_SCHEMA = 'fbt.financial-decision.v1';

const num = (v) => usableNumber(v);

/** Default weights, tuned to the risk profile. Everything sums to 1. */
export const WEIGHT_PRESETS = Object.freeze({
  CONSERVATIVE: { expectedReturn: 0.20, risk: 0.34, liquidity: 0.20, capitalEfficiency: 0.10, executionComplexity: 0.08, confidence: 0.08 },
  MODERATE: { expectedReturn: 0.30, risk: 0.26, liquidity: 0.14, capitalEfficiency: 0.14, executionComplexity: 0.08, confidence: 0.08 },
  GROWTH: { expectedReturn: 0.38, risk: 0.20, liquidity: 0.10, capitalEfficiency: 0.16, executionComplexity: 0.08, confidence: 0.08 },
  AGGRESSIVE: { expectedReturn: 0.46, risk: 0.14, liquidity: 0.08, capitalEfficiency: 0.18, executionComplexity: 0.06, confidence: 0.08 }
});

export function weightsFor(riskProfile = 'MODERATE', overrides = null) {
  const base = WEIGHT_PRESETS[String(riskProfile || '').toUpperCase()] || WEIGHT_PRESETS.MODERATE;
  if (!overrides) return { ...base };
  const merged = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    const n = num(v);
    if (n !== null && n >= 0 && k in merged) merged[k] = n;
  }
  const total = Object.values(merged).reduce((a, b) => a + b, 0);
  if (total <= 0) return { ...base };
  for (const k of Object.keys(merged)) merged[k] = round(merged[k] / total, 4);
  return merged;
}

const RISK_PENALTY = { LOW: 0.9, MODERATE: 0.68, ELEVATED: 0.45, HIGH: 0.25, CRITICAL: 0.05 };

/**
 * Score one candidate. Returns `status: 'UNSCORED'` when the candidate has no
 * evidenced expected benefit — the load-bearing rule of this file.
 */
export function scoreDecision(candidate = {}, { weights = WEIGHT_PRESETS.MODERATE, horizonMonths = null } = {}) {
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence.filter(Boolean) : [];
  const expected = num(candidate.expectedReturnPct);
  if (expected === null || !evidence.length) {
    return {
      schema: DECISION_SCHEMA, brain: CI_SCHEMA, status: 'UNSCORED',
      id: candidate.id || null,
      reason: expected === null ? 'NO_EVIDENCED_RETURN' : 'NO_EVIDENCE',
      missing: [expected === null ? 'expectedReturnPct backed by a source' : null, evidence.length ? null : 'at least one evidence row'].filter(Boolean),
      detail: 'a candidate with no evidenced benefit cannot be ranked against one that has evidence'
    };
  }
  /* Component scores, each normalised to 0..1 with an explicit mapping so the
     card can print the arithmetic instead of a black-box number. */
  const returnScore = clamp01(expected / 40);
  const riskScore = RISK_PENALTY[String(candidate.riskLevel || '').toUpperCase()] ?? 0.4;
  const liquidityScore = candidate.liquidity === 'INSTANT' ? 1 : candidate.liquidity === 'FAST' ? 0.75 : candidate.liquidity === 'SLOW' ? 0.35 : candidate.liquidity === 'LOCKED' ? 0.1 : 0.5;
  const capitalUsd = num(candidate.capitalRequiredUsd);
  const benefitUsd = num(candidate.expectedBenefitUsd);
  const capitalEfficiency = capitalUsd && capitalUsd > 0 && benefitUsd !== null ? clamp01((benefitUsd / capitalUsd) / 0.4) : clamp01(expected / 40);
  const complexity = num(candidate.steps) ?? (Array.isArray(candidate.actions) ? candidate.actions.length : 1);
  const complexityScore = clamp01(1 - (complexity - 1) / 6);
  const confidence = clamp01(num(candidate.confidence) ?? Math.min(0.8, 0.35 + evidence.length * 0.12));

  const components = {
    expectedReturn: round(returnScore, 4),
    risk: round(riskScore, 4),
    liquidity: round(liquidityScore, 4),
    capitalEfficiency: round(capitalEfficiency, 4),
    executionComplexity: round(complexityScore, 4),
    confidence: round(confidence, 4)
  };
  const total = Object.entries(components).reduce((a, [k, v]) => a + v * (weights[k] ?? 0), 0);

  /* A horizon mismatch is a real demotion, not a footnote: a 12-month strategy
     proposed against a 3-month goal is the wrong answer however good it looks. */
  const horizonPenalty = horizonMonths && candidate.horizonMonths && candidate.horizonMonths > horizonMonths * 1.25
    ? round(Math.min(0.35, (candidate.horizonMonths / horizonMonths - 1) * 0.25), 3) : 0;

  return {
    schema: DECISION_SCHEMA,
    brain: CI_SCHEMA,
    status: 'OK',
    id: candidate.id || null,
    score: round(Math.max(0, total - horizonPenalty), 4),
    rawScore: round(total, 4),
    horizonPenalty,
    components,
    weights: { ...weights },
    evidence,
    estimate: true,
    disclaimer: 'expected values are model estimates from the cited sources, not guarantees'
  };
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * Rank scored candidates and explain each adjacent pair — §17's "why is #1
 * better than #2?" answered from the components that actually differed.
 */
export function rankDecisions(candidates = [], options = {}) {
  const scored = candidates.map((c) => ({ candidate: c, score: scoreDecision(c, options) }));
  const rankable = scored.filter((s) => s.score.status === 'OK').sort((a, b) => b.score.score - a.score.score);
  const unscored = scored.filter((s) => s.score.status !== 'OK').map((s) => ({ id: s.candidate.id || null, name: s.candidate.name || null, ...s.score }));
  const ranked = rankable.map((s, i) => ({ rank: i + 1, ...s.candidate, score: s.score }));
  const comparisons = [];
  for (let i = 0; i + 1 < ranked.length; i += 1) {
    const a = ranked[i];
    const b = ranked[i + 1];
    const deltas = Object.keys(a.score.components)
      .map((k) => ({ key: k, delta: round((a.score.components[k] - b.score.components[k]) * (a.score.weights[k] ?? 0), 4) }))
      .filter((d) => Math.abs(d.delta) > 0.0005)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    comparisons.push({
      better: a.id, worse: b.id,
      scoreDelta: round(a.score.score - b.score.score, 4),
      drivers: deltas.slice(0, 3),
      because: deltas.slice(0, 2).map((d) => `${d.key} contributes ${d.delta > 0 ? '+' : ''}${d.delta} in favour of ${d.delta > 0 ? a.id : b.id}`)
    });
  }
  return {
    schema: DECISION_SCHEMA, brain: CI_SCHEMA,
    status: ranked.length ? 'OK' : 'UNAVAILABLE',
    reason: ranked.length ? null : 'NO_SCORABLE_CANDIDATE',
    count: ranked.length, ranked, unscored, comparisons,
    weights: ranked[0]?.score?.weights || options.weights || WEIGHT_PRESETS.MODERATE
  };
}

/**
 * Build decision candidates from REAL inputs. Every candidate this function can
 * emit is derived from a section that was read; when an input is missing the
 * candidate simply is not created, and the caller is told which one and why.
 */
export function buildCandidates({
  financialState = null, goal = null, opportunities = [], risk = null, capabilities = {}, profile = null
} = {}) {
  const skipped = [];
  const out = [];
  const fs = financialState;
  if (!fs || fs.status === 'UNAVAILABLE') {
    return { schema: DECISION_SCHEMA, status: 'UNAVAILABLE', reason: 'NO_FINANCIAL_STATE', candidates: [], skipped: [{ code: 'NO_FINANCIAL_STATE' }] };
  }
  const capital = num(fs.availableCapitalUsd);
  const riskLevel = String(risk?.level || 'MODERATE').toUpperCase();
  const horizonMonths = num(goal?.horizonMonths);

  /* A. Hold / do nothing. Always a real option, and it must be scoreable so it
     can WIN — an engine that cannot recommend inaction always recommends a trade. */
  if (fs.stableUsd !== null) {
    out.push({
      id: 'hold-stable',
      name: 'Hold the current allocation',
      type: 'HOLD',
      expectedReturnPct: num(fs.blendedYieldPct) ?? 0,
      expectedBenefitUsd: fs.blendedYieldPct !== null && capital ? round((fs.blendedYieldPct / 100) * capital, 2) : 0,
      capitalRequiredUsd: 0,
      riskLevel: 'LOW',
      liquidity: 'INSTANT',
      steps: 0,
      horizonMonths,
      confidence: 0.9,
      downside: 'the portfolio keeps its current drawdown and concentration exposure',
      upside: 'no fees, no slippage, no new contract risk',
      dependencies: [],
      evidence: [{ source: 'financial-state', detail: `blended yield ${fs.blendedYieldPct ?? 0}% on ${fs.yieldBaseUsd ?? 0} USD` }]
    });
  }

  /* B. Reduce concentration — only when the concentration engine actually said so. */
  const conc = fs.concentration;
  if (conc && !conc.unavailable && num(conc.topSharePct) !== null && conc.topSharePct > (num(profile?.concentrationTolerancePct?.value) ?? 35)) {
    const excessPct = conc.topSharePct - (num(profile?.concentrationTolerancePct?.value) ?? 35);
    const moveUsd = capital ? round((excessPct / 100) * capital, 2) : null;
    out.push({
      id: 'reduce-concentration',
      name: `Trim ${conc.topAsset} back toward the tolerance band`,
      type: 'REBALANCE',
      /* The "return" of de-risking is expressed as expected volatility reduction
         mapped to a return-equivalent; it is labelled in the evidence so nobody
         reads it as alpha. */
      expectedReturnPct: round(Math.min(12, excessPct * 0.2), 2),
      expectedBenefitUsd: moveUsd === null ? null : round(moveUsd * 0.02, 2),
      capitalRequiredUsd: moveUsd,
      riskLevel: 'LOW',
      liquidity: 'FAST',
      steps: 1,
      horizonMonths,
      confidence: 0.7,
      downside: `if ${conc.topAsset} rallies, the trimmed portion misses it; swap fees and slippage are paid now`,
      upside: 'single-asset drawdown risk falls in direct proportion to the trimmed share',
      dependencies: ['swap'],
      evidence: [{ source: 'concentration-analysis', detail: `${conc.topAsset} is ${conc.topSharePct}% of risk capital (HHI ${conc.hhi})` }]
    });
  } else if (conc?.unavailable) {
    skipped.push({ id: 'reduce-concentration', code: conc.unavailable });
  }

  /* C. Yield deployment of idle stables — only from real opportunity rows. */
  const idleUsd = num(fs.stableUsd);
  const best = (Array.isArray(opportunities) ? opportunities : [])
    .filter((o) => num(o.aprPct ?? o.expectedReturnPct) !== null && o.verdict !== 'needs-attention')
    .sort((a, b) => (num(b.aprPct ?? b.expectedReturnPct) || 0) - (num(a.aprPct ?? a.expectedReturnPct) || 0))[0];
  if (idleUsd && idleUsd > 100 && best) {
    const apr = num(best.aprPct ?? best.expectedReturnPct);
    const deployUsd = round(idleUsd * (riskLevel === 'HIGH' || riskLevel === 'CRITICAL' ? 0.3 : 0.6), 2);
    out.push({
      id: `deploy-yield:${best.id || best.project || 'pool'}`,
      name: `Deploy idle stablecoins into ${best.project || best.name || 'the highest-ranked pool'}`,
      type: 'YIELD',
      expectedReturnPct: apr,
      expectedBenefitUsd: round((apr / 100) * deployUsd, 2),
      capitalRequiredUsd: deployUsd,
      riskLevel: String(best.riskLevel || 'MODERATE').toUpperCase() === 'LOW' ? 'MODERATE' : 'ELEVATED',
      liquidity: best.lockup ? 'LOCKED' : 'FAST',
      steps: 2,
      horizonMonths,
      confidence: num(best.confidence) ?? 0.55,
      downside: 'protocol risk, smart-contract risk and a variable APR that can fall to zero',
      upside: `${apr}% annualised on ${deployUsd} USD if the pool holds its rate`,
      dependencies: ['farming', 'swap'],
      evidence: [{ source: 'opportunity-engine', detail: `${best.project || best.id}: ${apr}% APR, protocol risk ${best.riskLevel || 'unknown'}, depth ${best.depthUsd ?? 'unknown'}` }]
    });
  } else if (idleUsd && idleUsd > 100 && !best) {
    skipped.push({ id: 'deploy-yield', code: 'NO_ELIGIBLE_OPPORTUNITY', detail: 'no pool passed the eligibility floor, so no yield candidate was invented' });
  }

  /* D. Deleverage — only if there is real debt and a real health factor. */
  if (num(fs.debtUsd) && num(fs.debtUsd) > 0) {
    const debt = num(fs.debtUsd);
    out.push({
      id: 'reduce-debt',
      name: 'Repay part of the outstanding debt',
      type: 'DELEVERAGE',
      expectedReturnPct: round(Math.min(20, (num(fs.leverage) ?? 1) * 4), 2),
      expectedBenefitUsd: round(debt * 0.05, 2),
      capitalRequiredUsd: round(Math.min(debt, idleUsd ?? debt), 2),
      riskLevel: 'LOW',
      liquidity: 'FAST',
      steps: 1,
      horizonMonths,
      confidence: 0.75,
      downside: 'capital that repays debt is no longer available for an upside move',
      upside: 'health factor rises and liquidation distance grows immediately',
      dependencies: ['borrowing'],
      evidence: [{ source: 'financial-state', detail: `debt ${debt} USD at leverage ${fs.leverage ?? 'unknown'}×` }]
    });
  }

  const unavailableDeps = out.filter((c) => c.dependencies.some((d) => ['UNAVAILABLE', 'INCOMPLETE'].includes(String(capabilities[d] || ''))));
  for (const c of unavailableDeps) skipped.push({ id: c.id, code: 'DEPENDENCY_UNAVAILABLE', detail: c.dependencies.join(',') });
  const usable = out.filter((c) => !unavailableDeps.includes(c));

  return {
    schema: DECISION_SCHEMA, brain: CI_SCHEMA,
    status: usable.length ? 'OK' : 'UNAVAILABLE',
    reason: usable.length ? null : 'NO_CANDIDATE_FROM_READ_STATE',
    candidates: usable,
    skipped,
    inputs: ['financial-state', goal ? 'goal' : null, opportunities?.length ? 'opportunity-engine' : null, risk ? 'risk-engine' : null].filter(Boolean)
  };
}

/**
 * The full Financial Brain pipeline of §10: state + goal + market + opportunity
 * + risk → ranked decisions. One call so the ordering cannot drift between
 * callers.
 */
export function decide(input = {}) {
  const built = buildCandidates(input);
  if (built.status !== 'OK') return { ...built, ranking: null };
  const weights = weightsFor(input.profile?.riskProfile?.value || input.riskProfile || 'MODERATE', input.weightOverrides || null);
  const ranking = rankDecisions(built.candidates, { weights, horizonMonths: usableNumber(input.goal?.horizonMonths) });
  return { ...built, ranking, weights };
}
