/**
 * FBT FINANCIAL INTELLIGENCE OS — Strategy Competition (§14).
 * ---------------------------------------------------------------------------
 * Independent role-based proposals over the SAME candidate set, allowed to
 * disagree, adjudicated by a Strategy Judge:
 *
 *   Financial Analyst   → best goal-adjusted return
 *   Strategy Architect  → lowest complexity + fees for the same outcome
 *   Risk Auditor        → vetoes what the user's risk profile cannot carry
 *   Yield Analyst       → best evidenced yield
 *   Trading Analyst     → entry timing / execution style
 *   Smart Money Analyst → flow-aligned observation (accumulation/distribution)
 *   External Agent      → only if authorized AND trusted (§27/§28); its vote is
 *                         weighted below the internal roles and its reasoning is
 *                         untrusted text
 *
 * The judge does NOT force consensus. It reports the winner, the alternatives,
 * the rejected proposals AND the rejection reasons, and it refuses to name a
 * winner at all when the evidence is insufficient — in that case the answer is
 * "user choice required", which is the honest result, not a failure.
 *
 * Ranking itself is delegated to `strategyCompetition.compareStrategies` so the
 * scoring rules stay in one place. When live simulations are supplied, the
 * risk-adjusted score (return − risk − drawdown − fees/slippage ± SM/regime)
 * is folded into eligibility so the winner is the best *simulated* plan, not
 * merely the best proposal text.
 */
import { compareStrategies, competeStrategies, explainStrategyComparison } from '../../src/lib/intent-ai/strategyCompetition.js';
import { round } from '../../src/lib/central/schema.js';
import { riskAdjustedScore } from './routeSimulator.js';
import { smartMoneyKindBias } from './smartMoneyIntel.js';

export const COMPETITION_SCHEMA = 'fbt.fi.strategy-competition.v1';

export const AGENT_ROLES = Object.freeze([
  'FINANCIAL_ANALYST', 'STRATEGY_ARCHITECT', 'RISK_AUDITOR',
  'YIELD_ANALYST', 'TRADING_ANALYST', 'SMART_MONEY_ANALYST', 'EXTERNAL_AGENT'
]);

/** Risk ceiling per profile: above this riskPct the Risk Auditor vetoes. */
export const RISK_CEILING = Object.freeze({
  CONSERVATIVE: 30, MODERATE: 55, GROWTH: 75, AGGRESSIVE: 90
});

/** External agents vote, but with less weight than an internal role (§28:
 *  trust is not authority). */
const VOTE_WEIGHT = Object.freeze({
  FINANCIAL_ANALYST: 1.0, STRATEGY_ARCHITECT: 0.9, RISK_AUDITOR: 1.0,
  YIELD_ANALYST: 0.8, TRADING_ANALYST: 0.7, SMART_MONEY_ANALYST: 0.75, EXTERNAL_AGENT: 0.4
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Normalise simulations input: array from simulateAllStrategies OR map/object. */
function simulationList(simulations) {
  if (!simulations) return [];
  if (Array.isArray(simulations)) return simulations;
  if (typeof simulations === 'object') return Object.values(simulations);
  return [];
}

export function createStrategyCompetition({ collections, evidence = null, agents = null, observability = null, modelRouter = null, log = () => {}, now = () => Date.now() } = {}) {
  /**
   * @param {object} p
   * @param {object[]} p.strategies   normalised proposals from the strategy engine
   * @param {object} p.preferences    resolved preference model
   * @param {object} [p.goal]
   * @param {object|object[]} [p.simulations]  live route simulations (array or map)
   * @param {object} [p.smartMoney]   smart-money intel digest
   * @param {object} [p.financial]    capital for fee-drag / risk-adjusted score
   * @param {object} [p.crossAsset]   regime for risk-adjusted score
   * @param {object} [p.externalAgent] { passport, trust, authorized } — optional
   */
  async function compete({
    owner, strategies = [], preferences = null, goal = null,
    simulations = null, smartMoney = null, financial = null, crossAsset = null,
    externalAgent = null, correlationId = null, intentId = null
  } = {}) {
    const at = now();
    const rows = (Array.isArray(strategies) ? strategies : []).filter(Boolean);
    if (rows.length < 2) return { ok: false, code: 'NEEDS_AT_LEAST_TWO_STRATEGIES', count: rows.length };

    const profile = String(preferences?.riskTolerance || 'MODERATE').toUpperCase();
    const ceiling = RISK_CEILING[profile] ?? RISK_CEILING.MODERATE;
    const capitalUsd = num(financial?.computed?.netWorthUsd ?? financial?.netWorthUsd ?? financial?.computed?.availableCapitalUsd);
    const regime = crossAsset?.regime?.regime || rows.find((s) => s?.globalContext?.regime)?.globalContext?.regime || null;
    const smNet = num(smartMoney?.signals?.netFlowUsd ?? rows.find((s) => s?.smartMoney?.netFlowUsd != null)?.smartMoney?.netFlowUsd);
    const sims = simulationList(simulations);
    const simById = new Map(sims.filter((s) => s?.strategyId).map((s) => [s.strategyId, s]));

    /* ── agent proposals ───────────────────────────────────────────────── */
    const agentReports = [];

    const byReturn = rows.filter((s) => num(s.expectedReturnPct) !== null).sort((a, b) => num(b.expectedReturnPct) - num(a.expectedReturnPct));
    agentReports.push(roleReport('FINANCIAL_ANALYST', {
      pick: bestGoalAdjusted(rows),
      reasoning: byReturn.length
        ? `Highest modelled return is ${byReturn[0].id} at ${byReturn[0].expectedReturnPct}%, but goal-adjusted fit favours ${bestGoalAdjusted(rows)?.id || 'none'}.`
        : 'No proposal carries a modelled return, so I cannot rank on return.',
      confidence: byReturn.length ? 0.6 : 0.2,
      dissent: byReturn.length && bestGoalAdjusted(rows)?.id !== byReturn[0].id
    }));

    const cheapest = rows.slice().sort((a, b) => (num(a.feesUsd) ?? Infinity) - (num(b.feesUsd) ?? Infinity))[0] || null;
    agentReports.push(roleReport('STRATEGY_ARCHITECT', {
      pick: cheapest,
      reasoning: cheapest ? `${cheapest.id} reaches a similar outcome with the fewest steps and $${cheapest.feesUsd ?? 0} of modelled fees.` : 'No fee estimates were available.',
      confidence: cheapest ? 0.65 : 0.2
    }));

    const overCeiling = rows.filter((s) => num(s.riskPct) !== null && num(s.riskPct) > ceiling);
    const safest = rows.filter((s) => num(s.riskPct) !== null).sort((a, b) => num(a.riskPct) - num(b.riskPct))[0] || null;
    agentReports.push(roleReport('RISK_AUDITOR', {
      pick: safest,
      reasoning: overCeiling.length
        ? `Vetoing ${overCeiling.map((s) => s.id).join(', ')}: riskPct above the ${profile} ceiling of ${ceiling}.`
        : `No proposal exceeds the ${profile} ceiling of ${ceiling}.`,
      confidence: 0.85,
      veto: overCeiling.map((s) => ({ strategyId: s.id, reason: `riskPct ${s.riskPct} > ${profile} ceiling ${ceiling}` }))
    }));

    const yieldCandidates = rows.filter((s) => s.kind === 'YIELD_ON_IDLE');
    agentReports.push(roleReport('YIELD_ANALYST', {
      pick: yieldCandidates[0] || null,
      reasoning: yieldCandidates.length
        ? `${yieldCandidates[0].id} carries an observed APY of ${yieldCandidates[0].expectedReturnPct}% (evidence: ${yieldCandidates[0].evidenceQuality?.status}).`
        : 'No yield opportunity was evidenced in the current state.',
      confidence: yieldCandidates.length ? 0.6 : 0.25
    }));

    const dca = rows.find((s) => s.kind === 'DCA_IN') || null;
    agentReports.push(roleReport('TRADING_ANALYST', {
      pick: dca,
      reasoning: dca ? 'A single entry takes the full price risk of one fill; spreading it is the only timing edge that does not require a forecast.' : 'No recurring-entry proposal was generated.',
      confidence: dca ? 0.55 : 0.3
    }));

    /* Smart Money Analyst — only votes when the feed actually observed something. */
    if (smartMoney && smartMoney.status !== 'unavailable' && smartMoney.signals) {
      const biasRows = rows
        .map((s) => ({ s, bias: smartMoneyKindBias(s.kind, smartMoney) }))
        .filter((x) => x.bias !== null);
      const pick = biasRows.length
        ? biasRows.sort((a, b) => (b.bias - a.bias) || a.s.id.localeCompare(b.s.id))[0].s
        : null;
      const net = smNet;
      agentReports.push(roleReport('SMART_MONEY_ANALYST', {
        pick,
        reasoning: net == null
          ? 'Smart-money window was partial; no net flow to align against.'
          : `Observed net flow $${Math.round(net / 1000)}k (${net >= 0 ? 'accumulation-leaning' : 'distribution-leaning'}); ${pick ? `posture aligns most with ${pick.id}` : 'no kind bias applied'}. Observation only — not a trade signal.`,
        confidence: smartMoney.status === 'observed' ? 0.55 : 0.3,
        dissent: false
      }));
    }

    /* External agent: only with an authorized, sufficiently trusted passport. */
    if (externalAgent) {
      const authorized = externalAgent.authorized === true;
      const trust = num(externalAgent.trust?.score ?? externalAgent.trustScore);
      const allowed = authorized && trust !== null && trust >= 60 && externalAgent.trust?.expired !== true;
      if (allowed) {
        let pick = null;
        let reasoning = 'external agent returned no ranked preference';
        try {
          const out = await Promise.resolve(agents?.external?.propose
            ? agents.external.propose({ strategies: rows, owner, goal })
            : null);
          if (out?.strategyId) {
            pick = rows.find((s) => s.id === out.strategyId) || null;
            reasoning = String(out.reasoning || reasoning).slice(0, 400);
          }
        } catch (err) {
          reasoning = `external agent failed: ${String(err?.message || err).slice(0, 120)}`;
        }
        agentReports.push(roleReport('EXTERNAL_AGENT', {
          pick, reasoning, confidence: 0.35,
          untrusted: true,
          agentId: externalAgent.passport?.id || externalAgent.id || null,
          trust
        }));
      } else {
        agentReports.push(roleReport('EXTERNAL_AGENT', {
          pick: null,
          reasoning: !authorized ? 'external agent is not authorized for this scope' : `trust ${trust ?? 'unknown'} is below the 60 threshold or the passport expired`,
          confidence: 0, excluded: true
        }));
      }
    }

    /* ── ranking (shared rules + live risk-adjusted overlay) ───────────── */
    const comparison = compareStrategies(rows, { objective: 'risk-adjusted', now: at });
    const withSims = sims.length
      ? competeStrategies({ strategies: rows, simulations: sims, now: at })
      : null;

    /* ── judge ─────────────────────────────────────────────────────────── */
    const vetoed = new Map();
    for (const report of agentReports) for (const v of report.veto || []) vetoed.set(v.strategyId, v.reason);

    const scored = rows.map((s) => {
      const votes = agentReports
        .filter((r) => r.proposalId === s.id && !r.excluded)
        .reduce((a, r) => a + (VOTE_WEIGHT[r.role] || 0.5) * (r.confidence || 0), 0);
      const rankRow = comparison.ranked.find((r) => r.id === s.id);
      const sim = simById.get(s.id);
      const simPassed = sim?.status === 'passed';
      const simNet = simPassed ? num(sim.output) - (num(sim.fee) || 0) : null;
      /* Evidence gate: risk-adjusted may ONLY crown a winner when the classic
         comparison already had observed evidence, OR a live simulation passed
         with its own evidence. Bare expectedReturn/risk without samples must
         not invent a winner (the no-evidence probe depends on this). */
      const evidenceObserved = rankRow?.evidenceStatus === 'observed'
        || s.evidenceQuality?.status === 'observed'
        || (simPassed && Array.isArray(sim.evidence) && sim.evidence.some((e) => (e.sampleSize || 0) >= 5));
      const raRaw = evidenceObserved
        ? riskAdjustedScore({
            expectedReturnPct: s.expectedReturnPct,
            riskPct: s.riskPct,
            drawdownPct: s.maximumDrawdownPct ?? s.potentialLossPct,
            feesUsd: s.feesUsd ?? sim?.fee,
            slippagePct: sim?.slippagePct,
            capitalUsd,
            liquidity: s.liquidity,
            smartMoneyNetUsd: smNet,
            regime,
            simulationNet: simNet != null && capitalUsd != null ? simNet : null
          })
        : null;
      /* Fold SM kind bias into the risk-adjusted score when present. */
      const smBias = evidenceObserved ? smartMoneyKindBias(s.kind, smartMoney) : null;
      const riskAdjusted = raRaw !== null
        ? round(raRaw + (smBias || 0), 4)
        : null;

      const rejectedByGenome = s.genomeVerdict === 'REJECTED_BY_GENOME';
      const reasons = [];
      if (vetoed.has(s.id)) reasons.push(vetoed.get(s.id));
      if (rejectedByGenome) reasons.push('rejected by the user genome (stated or verified behaviour)');
      /* Eligible if classic comparison scored OR (evidence-backed) risk-adjusted scored. */
      const hasScore = (rankRow?.score !== null && rankRow?.score !== undefined) || riskAdjusted !== null;
      if (!hasScore) reasons.push('insufficient evidence to score');
      /* When simulations ran, a failed/unavailable sim is a soft mark, not a hard
         reject — HOLD with no route still passes. */
      if (sims.length && sim && sim.status !== 'passed' && String(s.kind).toUpperCase() !== 'HOLD') {
        reasons.push(`route simulation ${sim.status || 'unavailable'}`);
      }
      const finalScore = riskAdjusted !== null
        ? riskAdjusted
        : (rankRow?.score ?? null);
      return {
        strategyId: s.id, kind: s.kind,
        comparisonScore: finalScore,
        classicScore: rankRow?.score ?? null,
        riskAdjustedScore: riskAdjusted,
        simulationStatus: sim?.status || (sims.length ? 'unavailable' : null),
        simulationNet: simNet,
        evidenceStatus: rankRow?.evidenceStatus || s.evidenceQuality?.status || 'insufficient-evidence',
        agentVotes: round(votes, 3),
        goalCompatibilityPct: s.goalCompatibilityPct ?? null,
        userCompatibilityPct: s.userCompatibilityPct ?? null,
        riskPct: s.riskPct ?? null,
        expectedReturnPct: s.expectedReturnPct ?? null,
        feesUsd: s.feesUsd ?? null,
        drawdownPct: s.maximumDrawdownPct ?? s.potentialLossPct ?? null,
        slippagePct: sim?.slippagePct ?? null,
        smartMoneyBias: smBias,
        liquidity: s.liquidity ?? null,
        vetoed: vetoed.has(s.id),
        rejectedByGenome,
        eligible: reasons.length === 0,
        rejectionReasons: reasons
      };
    });

    const eligible = scored.filter((r) => r.eligible && r.comparisonScore !== null);
    eligible.sort((a, b) => (b.comparisonScore - a.comparisonScore) || (b.agentVotes - a.agentVotes) || a.strategyId.localeCompare(b.strategyId));
    const winner = eligible[0] || null;
    const alternatives = eligible.slice(1, 4);
    const rejected = scored.filter((r) => !r.eligible || (winner && r.strategyId !== winner.strategyId && !alternatives.some((a) => a.strategyId === r.strategyId)));

    const liveSim = sims.length > 0 && sims.some((s) => s.status === 'passed');
    const result = {
      schema: COMPETITION_SCHEMA,
      id: `cmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      owner,
      intentId,
      at,
      profile,
      riskCeiling: ceiling,
      agents: agentReports,
      /* Disagreement is a first-class output (§26): distinct picks, or any agent
         that flagged dissent, or a veto that removed a scored proposal. */
      disagreement: agentReports.filter((r) => r.dissent).length > 0
        || distinctPicks(agentReports).size > 1
        || agentReports.some((r) => (r.veto || []).length > 0),
      ranking: comparison,
      simulationRanking: withSims,
      liveSimulation: liveSim,
      smartMoney: smartMoney
        ? {
            status: smartMoney.status,
            netFlowUsd: smNet,
            alignment: smartMoney.alignment ?? null,
            cexDexDirection: smartMoney.signals?.cexDexDirection || null
          }
        : null,
      regime,
      objective: 'risk-adjusted-return',
      explanation: explainStrategyComparison({ strategies: rows, competition: comparison, now: at }),
      judge: {
        winnerId: winner?.strategyId || null,
        winnerStatus: winner
          ? (liveSim ? 'live-simulated-provisional' : 'evidence-backed-provisional')
          : 'no-winner-without-evidence',
        winnerRationale: winner
          ? `${winner.strategyId} scored ${winner.comparisonScore} (risk-adjusted${liveSim ? ', live-simulated' : ''}) with ${winner.agentVotes} weighted agent support, goal fit ${winner.goalCompatibilityPct} and no veto.`
          : 'No proposal was both eligible and evidenced. The choice belongs to the user.',
        alternatives: alternatives.map((a) => ({
          strategyId: a.strategyId,
          comparisonScore: a.comparisonScore,
          riskAdjustedScore: a.riskAdjustedScore,
          agentVotes: a.agentVotes,
          simulationStatus: a.simulationStatus
        })),
        rejected: rejected.map((r) => ({ strategyId: r.strategyId, reasons: r.rejectionReasons.length ? r.rejectionReasons : ['not selected'] })),
        requiresUserChoice: !winner,
        unanimous: distinctPicks(agentReports).size <= 1,
        scoringFactors: ['expectedReturn', 'risk', 'drawdown', 'fees', 'slippage', 'liquidity', 'smartMoney', 'regime', 'probability']
      },
      scored,
      executionPermission: false,
      guaranteed: false
    };
    await collections.put('strategy_comparisons', owner, result);
    if (observability && winner) observability.emit({ type: 'strategy.selected', owner, correlationId, payload: { strategyId: winner.strategyId, comparisonId: result.id, alternatives: alternatives.length, liveSimulation: liveSim } });
    return { ok: true, competition: result };
  }

  async function get(owner, id) { return collections.get('strategy_comparisons', owner, id); }

  return { schema: COMPETITION_SCHEMA, compete, get, AGENT_ROLES, RISK_CEILING };
}

/** Distinct proposals the (non-excluded) agents actually voted for. */
function distinctPicks(agentReports = []) {
  return new Set(agentReports.filter((r) => !r.excluded && r.proposalId).map((r) => r.proposalId));
}

function roleReport(role, { pick = null, reasoning = '', confidence = 0, veto = [], dissent = false, untrusted = false, excluded = false, agentId = null, trust = null } = {}) {
  return {
    role,
    proposalId: pick?.id || null,
    proposalKind: pick?.kind || null,
    vote: pick?.id || null,
    reasoning: String(reasoning).slice(0, 500),
    confidence: round(Math.max(0, Math.min(1, confidence)), 3),
    veto: veto.length ? veto : [],
    dissent,
    untrusted,
    excluded,
    agentId,
    trust
  };
}

function bestGoalAdjusted(rows = []) {
  const scored = rows
    .filter((s) => num(s.expectedReturnPct) !== null && num(s.riskPct) !== null)
    .map((s) => ({ s, adj: num(s.expectedReturnPct) - num(s.riskPct) * 0.5 + (num(s.goalCompatibilityPct) || 0) * 0.05 }));
  if (!scored.length) return null;
  return scored.sort((a, b) => b.adj - a.adj)[0].s;
}
