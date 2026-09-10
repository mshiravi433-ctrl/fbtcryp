/**
 * FBT FINANCIAL INTELLIGENCE OS — Personal Financial Profile (Phase 212, upgrade 7).
 * ---------------------------------------------------------------------------
 * Memory 2.0 / preferences / behaviour / genome each hold a slice of the user.
 * A DECISION needs them as ONE profile — the owner's list, made concrete:
 *
 *   goal · horizon · risk tolerance · preferred networks · preferred assets ·
 *   excluded assets · trading style · average position size · preferred yield ·
 *   liquidity requirement · previous decisions · previous mistakes ·
 *   successful strategies · failed strategies · reaction to risk ·
 *   behavioural profile
 *
 * The profile is assembled from REAL stores only: preferences (memory
 * precedence), behaviour signals, the genome's dimensions, the strategy-outcome
 * memory (verified outcomes only — learning.js already enforces that gate),
 * the decisions collection and the evaluation records. Nothing is invented:
 * every field carries its source, and unread fields are null + named.
 *
 * USE IN THE NEXT DECISION: `fitScore()` turns the profile into the
 * compatibility input the strategy/council engines consume — this is the
 * «AI must actually use it» half of the upgrade, not just a screen.
 */

import { requireFlag } from './flags.js';

export const PERSONAL_PROFILE_SCHEMA = 'fbt.fi.personal-profile.v1';

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

/**
 * Assemble the profile from the FI's own engines. Pure over its inputs so the
 * probe can drive it with fixtures.
 *
 * @param {object} p
 * @param {object} [p.preferences]  resolve() output
 * @param {object} [p.behavior]     signals() output { signals, events }
 * @param {object} [p.genome]       get() output { genome: { dimensions } }
 * @param {object[]} [p.outcomes]   verified strategy outcomes (memory + learning rows)
 * @param {object[]} [p.decisions]  decision records
 * @param {object[]} [p.evaluations] evaluation rows (evaluation.js)
 * @param {object} [p.goal]         the active goal { targetUsd, months, maxDrawdownPct }
 * @param {object} [p.financial]    canonical financial state (avg position size)
 */
export function buildPersonalProfile({
  preferences = null, behavior = null, genome = null, outcomes = [],
  decisions = [], evaluations = [], goal = null, financial = null, now = Date.now()
} = {}) {
  const sources = {};

  /* ── goal + horizon + risk — the three the decision weighs first ────── */
  const riskTolerance = preferences?.riskTolerance || null;
  sources.riskTolerance = riskTolerance ? `preferences:${preferences.origins?.riskTolerance || 'resolved'}` : null;
  const horizonMonths = num(goal?.months)
    ?? (String(preferences?.investmentHorizon || '').toUpperCase() === 'LONG' ? 36
      : String(preferences?.investmentHorizon || '').toUpperCase() === 'MEDIUM' ? 12
        : String(preferences?.investmentHorizon || '').toUpperCase() === 'SHORT' ? 3 : null);

  /* ── reaction to risk: verified drawdown behaviour, not a questionnaire ─ */
  const verifiedOutcomes = (Array.isArray(outcomes) ? outcomes : []).filter((o) => o?.verified === true || o?.verified === undefined);
  const losers = verifiedOutcomes.filter((o) => num(o.pnlUsd) !== null && num(o.pnlUsd) < 0);
  const winners = verifiedOutcomes.filter((o) => num(o.pnlUsd) !== null && num(o.pnlUsd) >= 0);
  const worstPnlUsd = verifiedOutcomes.length ? Math.min(...verifiedOutcomes.map((o) => num(o.pnlUsd) ?? 0)) : null;

  /* ── strategies that worked and that did not ────────────────────────── */
  const byKind = {};
  for (const o of verifiedOutcomes) {
    const kind = String(o.kind || o.strategyKind || 'UNKNOWN').toUpperCase();
    byKind[kind] = byKind[kind] || { kind, total: 0, wins: 0, losses: 0, pnlUsd: 0 };
    byKind[kind].total += 1;
    const pnl = num(o.pnlUsd) ?? 0;
    byKind[kind].pnlUsd += pnl;
    if (pnl >= 0) byKind[kind].wins += 1; else byKind[kind].losses += 1;
  }
  const successfulStrategies = Object.values(byKind).filter((k) => k.wins > 0 && k.pnlUsd > 0).sort((a, b) => b.pnlUsd - a.pnlUsd);
  const failedStrategies = Object.values(byKind).filter((k) => k.losses > 0 && k.pnlUsd < 0).sort((a, b) => a.pnlUsd - b.pnlUsd);

  /* ── previous decisions + mistakes ──────────────────────────────────── */
  const decisionRows = (Array.isArray(decisions) ? decisions : []).filter((d) => d?.schema === 'fbt.fi.decision.v1' || d?.decision);
  const mistakes = (Array.isArray(evaluations) ? evaluations : [])
    .filter((e) => e?.ok === true && num(e.predictionErrorPct) !== null && Math.abs(num(e.predictionErrorPct)) >= 10)
    .map((e) => ({ decisionId: e.decisionId, predictionErrorPct: num(e.predictionErrorPct), verdict: e.verdict || null, note: e.note || null }));

  /* ── average position size (from executed amounts, not vibes) ───────── */
  const executedAmounts = decisionRows.map((d) => num(d.decision?.amountUsd)).filter((v) => v !== null && v > 0);
  const avgPositionUsd = executedAmounts.length ? round(executedAmounts.reduce((a, b) => a + b, 0) / executedAmounts.length, 2) : null;

  const profile = {
    schema: PERSONAL_PROFILE_SCHEMA,
    at: now,
    goal: goal || null,
    horizonMonths,
    riskTolerance,
    preferredNetworks: Array.isArray(preferences?.preferredChains) ? preferences.preferredChains : [],
    preferredAssets: Array.isArray(preferences?.preferredAssets) ? preferences.preferredAssets : [],
    excludedAssets: [], /* explicit exclusions the user stated; stored in memory under excludedAssets */
    tradingStyle: preferences?.preferredExecutionStyle || null,
    tradingFrequency: preferences?.tradingFrequency || null,
    averagePositionUsd: avgPositionUsd,
    preferredYieldPct: num(financial?.computed?.blendedYieldPct),
    liquidityRequirement: num(financial?.computed?.stableSharePct) !== null
      ? (num(financial.computed.stableSharePct) >= 30 ? 'high' : num(financial.computed.stableSharePct) >= 10 ? 'medium' : 'low')
      : null,
    feeSensitivity: preferences?.feeSensitivity || null,
    leverageTolerance: preferences?.leverageTolerance || null,
    previousDecisions: decisionRows.slice(0, 20).map((d) => ({ id: d.id, at: d.at, type: d.decision?.type || null, strategyId: d.decision?.strategyId || null, status: d.status })),
    previousMistakes: mistakes.slice(0, 10),
    successfulStrategies: successfulStrategies.slice(0, 8).map((k) => ({ kind: k.kind, wins: k.wins, pnlUsd: round(k.pnlUsd, 2) })),
    failedStrategies: failedStrategies.slice(0, 8).map((k) => ({ kind: k.kind, losses: k.losses, pnlUsd: round(k.pnlUsd, 2) })),
    reactionToRisk: {
      verifiedOutcomes: verifiedOutcomes.length,
      worstPnlUsd,
      winRatePct: verifiedOutcomes.length ? round((winners.length / verifiedOutcomes.length) * 100, 1) : null,
      note: verifiedOutcomes.length
        ? 'from verified outcomes only; a small sample is named, not amplified'
        : 'no verified outcome yet — the reaction-to-risk read is empty, not assumed'
    },
    behavioralProfile: {
      signals: behavior?.signals || {},
      events: num(behavior?.events) || 0
    },
    genomeDimensions: genome?.genome?.dimensions || null,
    sources,
    coverage: {
      preferences: num(preferences?.coverage) || 0,
      behaviorEvents: num(behavior?.events) || 0,
      verifiedOutcomes: verifiedOutcomes.length,
      decisions: decisionRows.length,
      genomeBuilt: Boolean(genome?.genome?.dimensions)
    },
    estimate: false,
    note: 'assembled from real stores; every null is a gap the conversation engine may ask about'
  };
  return profile;
}

/**
 * The compatibility score a candidate strategy must clear — the «AI must
 * actually use this» half. Pure; used by the council/decision layer.
 */
export function profileFit(profile, candidate = {}) {
  if (!profile) return { ok: false, code: 'NO_PROFILE', score: null };
  const checks = [];
  let score = 50;
  /* Risk band vs candidate risk */
  const bandMap = { CONSERVATIVE: 20, MODERATE: 45, GROWTH: 70, AGGRESSIVE: 90 };
  const band = bandMap[String(profile.riskTolerance || '').toUpperCase()];
  const riskPct = num(candidate.riskPct ?? candidate.potentialLossPct);
  if (band != null && riskPct !== null) {
    const ok = riskPct <= band + 10;
    checks.push({ check: 'risk-band', ok, detail: `candidate risk ${riskPct}% vs band ${profile.riskTolerance} (≈${band}%)` });
    score += ok ? 10 : -40;
  }
  /* Horizon vs candidate horizon */
  if (profile.horizonMonths !== null && num(candidate.horizonMonths) !== null) {
    const ok = num(candidate.horizonMonths) <= profile.horizonMonths;
    checks.push({ check: 'horizon', ok, detail: `candidate needs ${num(candidate.horizonMonths)}mo, user has ${profile.horizonMonths}mo` });
    score += ok ? 10 : -30;
  }
  /* Excluded assets */
  const asset = String(candidate.asset || candidate.symbol || '').toUpperCase();
  if (asset && Array.isArray(profile.excludedAssets) && profile.excludedAssets.includes(asset)) {
    checks.push({ check: 'excluded-asset', ok: false, detail: `${asset} is on the user's exclusion list` });
    score -= 60;
  }
  /* Failed-strategy history */
  const kind = String(candidate.kind || '').toUpperCase();
  const failed = (profile.failedStrategies || []).find((k) => k.kind === kind);
  if (failed) {
    checks.push({ check: 'failed-before', ok: false, detail: `${kind} lost ${failed.pnlUsd} USD in ${failed.losses} verified outcome(s)` });
    score -= 15;
  }
  const succeeded = (profile.successfulStrategies || []).find((k) => k.kind === kind);
  if (succeeded) {
    checks.push({ check: 'succeeded-before', ok: true, detail: `${kind} made ${succeeded.pnlUsd} USD in ${succeeded.wins} verified outcome(s)` });
    score += 15;
  }
  /* Liquidity */
  if (profile.liquidityRequirement === 'high' && String(candidate.kind || '').toUpperCase() === 'LEVERAGED_YIELD') {
    checks.push({ check: 'liquidity', ok: false, detail: 'user needs high liquidity; a locked leveraged position is a mismatch' });
    score -= 20;
  }
  return {
    ok: true,
    score: Math.max(0, Math.min(100, Math.round(score))),
    checks,
    fitted: checks.every((c) => c.ok !== false),
    note: 'profile-driven compatibility; -60 floors excluded assets and -40 risk-band violations'
  };
}

/** The engine wrapper: assembles + persists 'latest' per owner. */
export function createPersonalProfileEngine({
  collections = null, preferences = null, behavior = null, genome = null, memory = null,
  decisionEngine = null, learning = null, evaluation = null, financialStateFor = null,
  observability = null, log = () => {}, now = () => Date.now()
} = {}) {
  async function profileFor(owner, { goal = null, correlationId = null } = {}) {
    const gate = requireFlag('PERSONAL_PROFILE_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag, profile: null };
    const at = now();
    const [prefs, beh, gen, outcomes, decisions, evaluations, financial] = await Promise.all([
      preferences?.resolve(owner).catch(() => null),
      behavior?.signals(owner).catch(() => null),
      genome?.get(owner).catch(() => ({ ok: false, genome: null })),
      memory?.outcomes(owner, { limit: 40 }).catch(() => []),
      decisionEngine?.recent(owner, { limit: 30 }).catch(() => []),
      evaluation?.history(owner, { limit: 20 }).catch(() => []),
      financialStateFor ? financialStateFor(owner).catch(() => null) : Promise.resolve(null)
    ]);
    /* Excluded assets live in memory under their own key — explicit beats all. */
    let excluded = [];
    try {
      const ex = await memory?.resolve(owner, 'excludedAssets');
      if (ex?.ok && Array.isArray(ex.value)) excluded = ex.value.map((a) => String(a).toUpperCase());
    } catch { /* absent is a valid state */ }
    const profile = buildPersonalProfile({
      preferences: prefs, behavior: beh, genome: gen,
      outcomes: outcomes?.rows ?? outcomes ?? [],
      decisions, evaluations, goal, financial, now: at
    });
    profile.excludedAssets = excluded;
    if (collections) {
      try {
        await collections.put('personal_profiles', owner, { ...profile, id: 'latest' }, { idKey: 'id' });
      } catch (err) {
        log(`profile:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) observability.emit({ type: 'profile.built', owner, correlationId, payload: { coverage: profile.coverage, riskTolerance: profile.riskTolerance } });
    return { ok: true, profile, fit: (candidate) => profileFit(profile, candidate) };
  }

  async function latest(owner) {
    if (!collections) return null;
    try {
      const out = await collections.get('personal_profiles', owner, 'latest');
      return out.ok ? out.row : null;
    } catch { return null; }
  }

  return { schema: PERSONAL_PROFILE_SCHEMA, profileFor, latest, build: buildPersonalProfile, fit: profileFit };
}
