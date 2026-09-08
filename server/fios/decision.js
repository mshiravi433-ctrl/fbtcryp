/**
 * FBT FINANCIAL INTELLIGENCE OS — Decision Engine (§17).
 * ---------------------------------------------------------------------------
 * Inputs: intent, financial state, world model, research, strategies,
 * simulation, risk, policy, evidence.
 * Output: decision · reason · confidence · alternatives · conditions · evidence.
 *
 * The SCORING is not re-implemented: candidates are ranked by
 * `src/lib/central/decision.js#rankDecisions`, whose load-bearing rule is that a
 * candidate without evidence is returned UNSCORED and therefore cannot win.
 * What this module adds is the composition around it — pulling the winning
 * strategy's evidence into the decision, attaching the confidence breakdown,
 * opening the decision trace, and refusing to produce a decision at all when
 * the state was never read.
 *
 * A decision is a RECOMMENDATION. `executionPermission` is always false here;
 * authority comes from the policy engine (§22) or an explicit user
 * confirmation, never from this file (§50).
 */
import { randomUUID } from 'node:crypto';
import { rankDecisions, weightsFor } from '../../src/lib/central/decision.js';
import { confidenceFromEvidence } from './evidence.js';

export const DECISION_RECORD_SCHEMA = 'fbt.fi.decision.v1';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function createDecisionEngine({ collections, evidence, traceStore, confidenceEngine, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  /**
   * @param {object} p
   * @param {object} p.intent          classified intent (from the brain)
   * @param {object} p.financial       canonical financial state
   * @param {object} p.world           world model
   * @param {object} [p.research]      research bundle
   * @param {object[]} [p.strategies]  normalised proposals
   * @param {object} [p.competition]   strategy competition result
   * @param {object} [p.simulation]    simulation bundle
   * @param {object} [p.risk]          risk assessment
   * @param {object} [p.policyVerdict] policy check result (required to execute)
   * @param {boolean} [p.executionRequested]
   */
  async function decide({
    owner, intent = null, financial = null, world = null, research = null,
    strategies = [], competition = null, simulation = null, risk = null,
    policyVerdict = null, preferences = null, goal = null,
    executionRequested = false, correlationId = null, trace = null
  } = {}) {
    const at = now();

    /* Refuse rather than invent. */
    if (!financial || financial.status === 'UNAVAILABLE') {
      return { ok: false, code: 'NO_FINANCIAL_STATE', detail: financial?.reason || 'the financial state was never readable', state: 'BLOCKED' };
    }

    const traceRef = trace || await traceStore.open({ owner, correlationId, intentId: intent?.intentId || null });
    const ownTrace = !trace;
    const step = async (state, note) => {
      const out = await traceStore.move(owner, traceRef, state, { note });
      /* A refused edge is a real failure: the trace is the audit record, so a
         decision must not continue as if the machine had advanced. */
      if (!out.ok && ownTrace) throw Object.assign(new Error(out.code), { code: out.code, detail: JSON.stringify(out) });
      return out;
    };
    await step('UNDERSTANDING', intent?.intentType || 'intent received');
    await step('COLLECTING_DATA', 'decision composition started');
    if (world?.id) traceStore.link(traceRef, 'worldStateId', world.id);
    if (financial?.id) traceStore.link(traceRef, 'financialStateId', financial.id);
    if (research?.id) traceStore.link(traceRef, 'researchId', research.id);
    if (simulation?.id) traceStore.link(traceRef, 'simulationId', simulation.id);
    if (policyVerdict?.policyId) traceStore.link(traceRef, 'policyId', policyVerdict.policyId);

    /* ── candidates from the competition ───────────────────────────────── */
    const rows = Array.isArray(strategies) ? strategies : [];
    const scoredRows = competition?.scored || [];
    const winnerId = competition?.judge?.winnerId || null;
    const byId = new Map(rows.map((s) => [s.id, s]));

    const candidates = rows.map((s) => {
      const judgeRow = scoredRows.find((r) => r.strategyId === s.id) || {};
      const strategyEvidence = (s.evidence || []).map((e) => ({ source: e.source, detail: `observed at ${e.observedAt}, samples ${e.sampleSize ?? 'n/a'}, quality ${e.quality ?? 'n/a'}` }));
      const researchEvidence = research?.evidence?.length
        ? [{ source: `research:${research.id}`, detail: `${research.evidence.length} evidence rows, confidence ${research.confidence}` }]
        : [];
      const stateEvidence = [{ source: 'financial-state', detail: `net worth ${financial.computed?.netWorthUsd ?? 'unread'}, confidence ${financial.confidence}` }];
      return {
        id: s.id,
        name: s.name,
        type: mapKindToDecisionType(s.kind),
        expectedReturnPct: num(s.expectedReturnPct),
        expectedBenefitUsd: num(s.expectedReturnPct) !== null && num(financial.computed?.netWorthUsd) !== null
          ? Number(((num(s.expectedReturnPct) / 100) * num(financial.computed.netWorthUsd)).toFixed(2))
          : null,
        capitalRequiredUsd: num(s.feesUsd) !== null ? num(s.feesUsd) : null,
        riskLevel: riskLevelFrom(s.riskPct),
        liquidity: String(s.liquidity || 'UNKNOWN').toUpperCase().includes('IMPROVED') ? 'FAST' : 'NORMAL',
        steps: Array.isArray(s.route) ? s.route.length : 1,
        horizonMonths: goal?.months ? Math.max(1, Math.round(num(goal.months))) : 12,
        confidence: num(s.confidencePct) !== null ? num(s.confidencePct) / 100 : null,
        downside: s.potentialLossPct !== null ? `modelled downside ${s.potentialLossPct}%` : 'downside not modelled',
        upside: s.expectedReturnPct !== null ? `modelled return ${s.expectedReturnPct}%` : 'return not modelled',
        dependencies: Array.isArray(s.uses) ? s.uses : [],
        evidence: [...stateEvidence, ...strategyEvidence, ...researchEvidence],
        /* Carried for the record, not for scoring. */
        kind: s.kind,
        goalCompatibilityPct: s.goalCompatibilityPct ?? null,
        userCompatibilityPct: s.userCompatibilityPct ?? null,
        vetoed: judgeRow.vetoed === true,
        rejectedByGenome: judgeRow.rejectedByGenome === true,
        ineligibleReasons: judgeRow.rejectionReasons || []
      };
    });

    const eligible = candidates.filter((c) => !c.vetoed && !c.rejectedByGenome && c.ineligibleReasons.length === 0);
    const profile = String(preferences?.riskTolerance || 'MODERATE').toUpperCase();
    const ranking = rankDecisions(eligible, { weights: weightsFor(profile), horizonMonths: goal?.months || null });
    const ranked = ranking.ranked || [];
    const unscored = ranking.unscored || [];

    const chosen = ranked[0] || null;
    const chosenStrategy = chosen ? byId.get(chosen.id) : null;

    /* ── confidence ────────────────────────────────────────────────────── */
    const confidence = confidenceEngine.assess({
      intent, financial, world, research,
      strategy: chosenStrategy, competition, simulation, risk,
      quote: null, wallet: world?.domains?.user?.wallets?.value || null,
      capabilities: world?.capabilities || null, policy: policyVerdict,
      executionRequested, now: at
    });

    /* ── conditions: what must still be true ───────────────────────────── */
    const conditions = [];
    if (!chosen) conditions.push('no candidate is both eligible and evidenced — a human choice is required');
    if (executionRequested) {
      if (!policyVerdict?.ok) conditions.push(`policy: ${policyVerdict?.code || 'no policy check performed'}`);
      if (!confidence.actionable) conditions.push(`confidence: blockers ${confidence.blockers.join(', ')}`);
      conditions.push('explicit user confirmation of the exact chain, asset, amount, fees, slippage, route and destination');
    }
    if (financial.missing?.length) conditions.push(`unread inputs: ${financial.missing.join(', ')}`);
    if (simulation?.worstCase) conditions.push(`worst modelled case is ${simulation.worstCase.id} at ${simulation.worstCase.deltaUsd} USD`);

    /* ── reason ────────────────────────────────────────────────────────── */
    const reason = [];
    if (chosen) {
      reason.push(`${chosen.name} ranked first at ${chosen.score?.score ?? 'n/a'} under the ${profile} weights.`);
      const pairwise = (ranking.comparisons || [])[0];
      if (pairwise) reason.push(...(pairwise.because || []).map((b) => `vs ${pairwise.worse}: ${b}.`));
    } else if (unscored.length) {
      reason.push(`No candidate could be scored: ${unscored.map((u) => `${u.id} (${u.missing?.join('+') || u.status})`).join('; ')}.`);
    } else {
      reason.push('No eligible candidate survived risk review, the genome and the evidence bar.');
    }
    if (competition?.disagreement) reason.push('The council disagreed; the dissenting positions are attached.');

    /* ── evidence bundle ───────────────────────────────────────────────── */
    const decisionId = `dec_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const evidenceInputs = [];
    if (chosenStrategy?.expectedReturnPct !== null && chosenStrategy?.expectedReturnPct !== undefined) {
      evidenceInputs.push({ type: 'research', source: `decision:${chosenStrategy.kind}`, value: { decisionId, strategyId: chosenStrategy.id, expectedReturnPct: chosenStrategy.expectedReturnPct, riskPct: chosenStrategy.riskPct }, at, ttlMs: 15 * 60_000 });
    }
    if (financial.computed?.netWorthUsd !== null && financial.computed?.netWorthUsd !== undefined) {
      evidenceInputs.push({ type: 'balance', source: 'financial-state', value: financial.computed.netWorthUsd, at, ttlMs: 60_000 });
    }
    const recorded = await evidence.record(owner, evidenceInputs, { correlationId });
    const evidenceIds = [...new Set([...(recorded.evidence.map((e) => e.id)), ...(research?.evidenceIds || []), ...(simulation?.evidenceIds || [])])];
    if (evidenceIds.length) await evidence.link(owner, { targetType: 'decision', targetId: decisionId, evidenceIds, correlationId });
    traceRef.evidenceIds = [...new Set([...(traceRef.evidenceIds || []), ...evidenceIds])];

    /* ── risk verdict on the trace ─────────────────────────────────────── */
    if (risk) traceStore.link(traceRef, 'riskCheckId', risk.id || `risk_${at}`);
    await step('BUILDING_STATE', 'decision composed');
    await step('GENERATING_STRATEGIES', `${rows.length} candidates`);
    await step('RISK_REVIEW', risk?.level || 'no risk assessment');
    if (risk && ['HIGH', 'CRITICAL'].includes(String(risk.level).toUpperCase()) && !policyVerdict?.overrideRisk) {
      await step('BLOCKED', `risk level ${risk.level}`);
    } else {
      await step('WAITING_FOR_CONFIRMATION', chosen ? chosen.id : 'no winner');
    }

    /* The spec's decision contract (§11): action, strategy, rationale,
       alternatives, risks, expectedRange, confidence, evidence, assumptions,
       invalidationConditions, nextReviewAt. The extra fields are DERIVED from
       the chosen strategy's canonical contract + the risk/simulation reads —
       never fabricated. */
    const horizonMonths = chosen?.horizonMonths || goal?.months || null;
    const reviewWindowMs = horizonMonths
      ? Math.max(1, Math.min(Number(horizonMonths), 12)) * 30 * 24 * 3600_000
      : 7 * 24 * 3600_000;
    const risks = [
      risk?.level ? `risk level: ${risk.level}` : 'no risk assessment was available',
      ...(Array.isArray(risk?.securitySignals) && risk.securitySignals.length ? [`${risk.securitySignals.length} security signal(s)`] : []),
      ...(simulation?.worstCase ? [`worst modelled case: ${simulation.worstCase.id} (${simulation.worstCase.deltaUsd} USD)`] : []),
      ...(competition?.judge?.rejected?.length ? [`competition rejected: ${competition.judge.rejected.map((r) => r.strategyId).join(', ')}`] : [])
    ];

    const record = {
      schema: DECISION_RECORD_SCHEMA,
      id: decisionId,
      owner,
      at,
      state: traceRef.state,
      intentId: intent?.intentId || null,
      intentType: intent?.intentType || null,
      decision: chosen
        ? {
            type: chosen.type,
            strategyId: chosen.id,
            name: chosen.name,
            expectedReturnPct: chosen.expectedReturnPct,
            expectedBenefitUsd: chosen.expectedBenefitUsd,
            riskLevel: chosen.riskLevel,
            amountUsd: chosen.capitalRequiredUsd,
            horizonMonths: chosen.horizonMonths
          }
        : null,
      status: chosen ? 'RECOMMENDED' : 'NO_RECOMMENDATION',
      reason,
      confidence,
      alternatives: ranked.slice(1, 5).map((r) => ({ strategyId: r.id, name: r.name, type: r.type, score: r.score?.score ?? null, expectedReturnPct: r.expectedReturnPct })),
      risks,
      expectedRange: chosenStrategy?.expectedRange || null,
      assumptions: Array.isArray(chosenStrategy?.assumptions) ? chosenStrategy.assumptions : [],
      invalidationConditions: Array.isArray(chosenStrategy?.invalidationConditions) ? chosenStrategy.invalidationConditions : [],
      nextReviewAt: at + reviewWindowMs,
      unscored: unscored.map((u) => ({ id: u.id, status: u.status, missing: u.missing || [] })),
      conditions,
      evidenceIds,
      competitionId: competition?.id || null,
      simulationId: simulation?.id || null,
      researchId: research?.id || null,
      policyId: policyVerdict?.policyId || null,
      traceId: traceRef.id,
      executionPermission: false,
      executionId: null,
      verificationId: null,
      guaranteed: false,
      durable: collections.durable()
    };
    traceStore.link(traceRef, 'strategyId', chosen?.id || 'none');
    await traceStore.save(owner, traceRef);
    await collections.put('decisions', owner, record);
    if (observability) {
      observability.emit({ type: 'decision.completed', owner, correlationId, payload: { decisionId, strategyId: chosen?.id || null, state: traceRef.state, confidence: confidence.overall } });
    }
    return { ok: true, decision: record, trace: traceStore.summary(traceRef), ranking, weights: ranking.weights || null };
  }

  async function get(owner, id) { return collections.get('decisions', owner, id); }
  async function recent(owner, { limit = 10 } = {}) {
    const { rows } = await collections.read('decisions', owner);
    return rows.slice(0, Math.max(1, limit));
  }

  return { schema: DECISION_RECORD_SCHEMA, decide, get, recent };
}

function mapKindToDecisionType(kind) {
  switch (String(kind || '').toUpperCase()) {
    case 'DCA_IN': return 'BUY';
    case 'REBALANCE': return 'REBALANCE';
    case 'YIELD_ON_IDLE': return 'YIELD';
    case 'DELEVERAGE': return 'DELEVERAGE';
    case 'CROSS_CHAIN_CONSOLIDATE': return 'BRIDGE';
    case 'RISK_REDUCTION': return 'REBALANCE';
    default: return 'HOLD';
  }
}

function riskLevelFrom(riskPct) {
  const v = num(riskPct);
  if (v === null) return 'UNKNOWN';
  if (v <= 20) return 'LOW';
  if (v <= 45) return 'MODERATE';
  if (v <= 70) return 'ELEVATED';
  return 'HIGH';
}

export { confidenceFromEvidence };
