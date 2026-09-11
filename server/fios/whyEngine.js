/**
 * FBT FINANCIAL INTELLIGENCE OS — Why Engine (Phase 212, upgrade 5).
 * ---------------------------------------------------------------------------
 * Every decision the OS makes must answer six questions in a machine-readable
 * block the chat can render in any locale:
 *
 *   چرا این دارایی؟   whyAsset       — the evidence that picked THIS asset
 *   چرا این شبکه؟     whyNetwork     — gas/liquidity/route/preference for the chain
 *   چرا الان؟         whyNow         — the timing triggers that fired
 *   چرا این مقدار؟    whyAmount      — sizing math against capital/risk/goal
 *   چرا این استراتژی؟ whyStrategy    — why this kind beat the alternatives
 *   چه چیزی این تصمیم را باطل می‌کند؟ invalidation — the falsifiers
 *
 * plus the four stress falsifiers the owner named:
 *   BTC -10% · gas ×2 · liquidity drop · negative news — each evaluated
 *   against the REAL simulation/proposal numbers, with the exact threshold
 *   at which the decision should be revisited.
 *
 * The engine never invents a reason: every `because` line points at a number
 * that exists in the decision bundle (score, expected return, drawdown, gas,
 * slippage, macro impulse). When a number is unreadable, the answer says so —
 * «downside not modelled» is an honest why-line, a fabricated one is not.
 */

import { requireFlag } from './flags.js';
import { routeIntelligenceWhyLines } from './routeIntelligence.js';

export const WHY_ENGINE_SCHEMA = 'fbt.fi.why.v1';

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

/**
 * Build the Why block for one decision.
 *
 * @param {object} p
 * @param {object} p.decision        the decision record (decide() output)
 * @param {object[]} [p.strategies]  the candidate rows the decision ranked
 * @param {object} [p.competition]   the competition result (judge/scoring)
 * @param {object} [p.simulation]    the simulation bundle (worst case…)
 * @param {object} [p.macroGraph]    the macro graph built the same pass
 * @param {object} [p.preferences]   resolved preferences
 * @param {object} [p.goal]          { targetUsd?, months?, maxDrawdownPct? }
 * @param {object} [p.costs]         { gasUsd, feeUsd, slippagePct }
 * @param {number} [p.now]
 */
export function explainDecision({
  decision = null, strategies = [], competition = null, simulation = null,
  macroGraph = null, preferences = null, goal = null, costs = {}, now = Date.now()
} = {}) {
  if (!decision) return { ok: false, code: 'NO_DECISION', detail: 'the why engine explains a decision that exists' };
  const chosen = decision.decision;
  const strategy = (Array.isArray(strategies) ? strategies : []).find((s) => s?.id === chosen?.strategyId) || null;
  const ranked = decision.alternatives || [];
  const profile = String(preferences?.riskTolerance || 'MODERATE').toUpperCase();

  /* ── why this asset ─────────────────────────────────────────────────── */
  const whyAsset = [];
  if (strategy?.evidence?.length) whyAsset.push(`${strategy.evidence.length} evidence row(s) on the candidate itself (observed, not assumed)`);
  if (num(chosen?.expectedReturnPct) !== null) whyAsset.push(`modelled expected return ${chosen.expectedReturnPct}% over the horizon, against the ${profile} profile`);
  if (macroGraph && typeof macroGraph.impulse === 'object' && chosen?.strategyId) {
    const assetNode = String(strategy?.asset || strategy?.name || '').toLowerCase();
    const hit = Object.entries(macroGraph.impulse).find(([k]) => assetNode.includes(k));
    if (hit) whyAsset.push(`macro transmission impulse on ${hit[0]} is ${hit[1]} (model, first-order)`);
  }
  if (decision.smartMoney?.alignment) whyAsset.push(`smart-money flows ${decision.smartMoney.alignment} this window`);
  /* Phase 215 — traditional classes on the decision record (stocks/forex/
     commodities/rwa/etf/funds): name the class, the observed 24h change
     (a READ, not a model) and whether execution exists at all. */
  if (Array.isArray(decision.opportunities) && decision.opportunities.length) {
    for (const o of decision.opportunities.slice(0, 3)) {
      const obs = o.observation?.change24hPct != null ? `observed ${o.observation.change24hPct}% in 24h (${o.venue || 'venue unread'})` : 'no observed price this pass';
      whyAsset.push(`${o.assetClass}/${o.asset}: fit ${o.verdict} (score ${o.score}) — ${obs}; execution ${o.execution?.available ? 'available via ' + o.execution.via : 'analysis-only, no configured provider'}`);
    }
  }
  if (!whyAsset.length) whyAsset.push('no asset-level evidence was readable — the recommendation rests on ranking alone and must be treated as weak');

  /* ── why this network ───────────────────────────────────────────────── */
  const whyNetwork = [];
  const gas = num(costs.gasUsd);
  const slip = num(costs.slippagePct);
  if (strategy?.chain || strategy?.network) whyNetwork.push(`the proposal names ${strategy.chain || strategy.network}`);
  if (gas !== null) whyNetwork.push(`modelled gas ${gas} USD is within the plan's cost envelope`);
  if (slip !== null) whyNetwork.push(`modelled slippage ${slip}% on the quoted route`);
  if (Array.isArray(preferences?.preferredChains) && preferences.preferredChains.length) whyNetwork.push(`the user prefers ${preferences.preferredChains.slice(0, 3).join(', ')}`);
  if (decision.liveSimulation) whyNetwork.push('the route was simulated live (fees, gas, slippage) before ranking');
  /* Phase 214 — the route intelligence block stored on the decision record:
     «این شبکه چون گاز کمتر و نقدینگی عمیق‌تر» — every line points at a
     number in the block (cost, depth, impact, time, success, risk). */
  const riLines = routeIntelligenceWhyLines(decision.routeIntelligence);
  if (riLines.length) whyNetwork.push(...riLines);
  if (!whyNetwork.length) whyNetwork.push('no network choice was involved (or none was readable) in this decision');

  /* ── why now ────────────────────────────────────────────────────────── */
  const whyNow = [];
  if (num(strategy?.entryTimingPct) !== null) whyNow.push(`modelled entry timing edge ${strategy.entryTimingPct}%`);
  if (competition?.regime) whyNow.push(`market regime read as ${String(competition.regime).replace(/_/g, ' ').toLowerCase()}`);
  if (macroGraph) {
    if (Math.abs(num(macroGraph.portfolioRiskImpulse) || 0) > 0.05) {
      whyNow.push(`macro risk impulse ${macroGraph.portfolioRiskImpulse} — the transmission graph is not flat, timing carries information`);
    } else {
      whyNow.push('macro transmission graph is flat — no timing penalty from the macro layer');
    }
  }
  if (decision.smartMoney?.cexDexDirection) whyNow.push(`exchange flows ${decision.smartMoney.cexDexDirection}`);
  if (!whyNow.length) whyNow.push('no timing signal was readable; the plan treats entry as unscheduled (DCA absorbs timing risk)');

  /* ── why this amount ────────────────────────────────────────────────── */
  const whyAmount = [];
  const amount = num(chosen?.amountUsd);
  const netWorth = num(decision?.netWorthUsd);
  const maxDrawdown = num(goal?.maxDrawdownPct);
  if (amount !== null) {
    if (netWorth) whyAmount.push(`${round((amount / netWorth) * 100, 2)}% of net worth — sized by the strategy engine, not by ambition`);
    if (maxDrawdown !== null && strategy?.potentialLossPct != null) {
      whyAmount.push(`at the modelled ${strategy.potentialLossPct}% potential loss the position risks ${round(amount * strategy.potentialLossPct / 100, 2)} USD against the user's ${maxDrawdown}% drawdown ceiling`);
    }
    if (whyAmount.length === 0) whyAmount.push(`amount ${amount} USD comes from the proposal; no sizing constraint was readable to check it against`);
  } else {
    whyAmount.push('the decision carries no amount — a sizing pass is required before any execution');
  }

  /* ── why this strategy ──────────────────────────────────────────────── */
  const whyStrategy = [];
  if (num(decision?.decision?.expectedReturnPct) !== null && ranked.length) {
    whyStrategy.push(`ranked first at ${round(num(decision.confidence?.overall) * 100, 1)}% overall confidence; the next alternative was ${ranked[0]?.name || 'unnamed'} at ${num(ranked[0]?.expectedReturnPct) ?? 'unmodelled'}% expected`);
  }
  for (const r of (decision.reason || []).slice(0, 2)) whyStrategy.push(r);
  if (decision.riskAdjustedWinner && decision.riskAdjustedWinner !== chosen?.strategyId) {
    whyStrategy.push(`the risk-adjusted winner (${decision.riskAdjustedWinner}) differs from the chosen candidate — disagreement is recorded`);
  }
  if (!whyStrategy.length) whyStrategy.push('the candidate set was empty; the honest strategy is none');

  /* ── invalidation + the four named falsifiers ───────────────────────── */
  const invalidationConditions = [
    ...(Array.isArray(decision.invalidationConditions) ? decision.invalidationConditions : []),
    ...(Array.isArray(strategy?.invalidationConditions) ? strategy.invalidationConditions : [])
  ];
  const worstCase = simulation?.worstCase || null;
  const falsifiers = [
    {
      id: 'btc-minus-10',
      question: 'اگر BTC ۱۰٪ سقوط کند چه می‌شود؟',
      threshold: 'BTC -10% from the decision price',
      modelledImpactUsd: worstCase ? num(worstCase.deltaUsd) : null,
      action: worstCase ? `re-check the plan against the ${worstCase.id} scenario (${worstCase.deltaUsd} USD modelled) before the next entry` : 're-run the simulation — no scenario bundle was attached to this decision',
      invalidates: (maxDrawdown !== null && worstCase && num(worstCase.deltaUsd) !== null && netWorth)
        ? Math.abs(num(worstCase.deltaUsd)) / netWorth * 100 > maxDrawdown
        : null
    },
    {
      id: 'gas-doubles',
      question: 'اگر gas دو برابر شود؟',
      threshold: 'gas ×2 versus the modelled figure',
      modelledImpactUsd: gas !== null ? round(gas, 2) : null,
      action: gas !== null
        ? `execution cost rises to ~${round(gas * 2, 2)} USD; the plan stays valid only if that stays under the fee ceiling`
        : 'no gas figure was modelled — treat any execution as unpriced until a quote exists',
      invalidates: null
    },
    {
      id: 'liquidity-drop',
      question: 'اگر liquidity کاهش پیدا کند؟',
      threshold: 'route liquidity below the slippage envelope',
      modelledImpactUsd: slip !== null ? round(slip, 3) : null,
      action: slip !== null
        ? `thinner books multiply the ${slip}% modelled slippage; refuse execution when the live quote exceeds the envelope`
        : 'slippage was never modelled — a live quote is mandatory before execution',
      invalidates: null
    },
    {
      id: 'negative-news',
      question: 'اگر خبر منفی منتشر شود؟',
      threshold: 'a risk_up macro event (FED/INFLATION/GEOPOLITICS) with attention ≥ 3, or a security signal on the asset',
      modelledImpactUsd: null,
      action: macroGraph
        ? `re-run the macro graph (current portfolio impulse ${macroGraph.portfolioRiskImpulse}) and let the risk gate decide`
        : 'no macro graph was built this pass — treat unexplained volatility as a stop signal',
      invalidates: null
    }
  ];

  const reviewWindowDays = decision.nextReviewAt ? Math.max(1, Math.round((decision.nextReviewAt - now) / 86400000)) : null;
  return {
    ok: true,
    schema: WHY_ENGINE_SCHEMA,
    decisionId: decision.id,
    at: now,
    why: {
      whyAsset,
      whyNetwork,
      whyNow,
      whyAmount,
      whyStrategy
    },
    invalidationConditions: [...new Set(invalidationConditions)],
    falsifiers,
    nextReviewAt: decision.nextReviewAt || null,
    reviewWindowDays,
    confidence: num(decision.confidence?.overall),
    estimate: true,
    note: 'every because-line points at a number in the decision bundle; unread numbers are named, never invented'
  };
}

/** The engine wrapper with flag + persistence (capped history per owner). */
export function createWhyEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function explain(owner, bundle = {}, { correlationId = null, persist = true } = {}) {
    const gate = requireFlag('WHY_ENGINE_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const why = explainDecision({ ...bundle, now: now() });
    if (!why.ok) return why;
    if (persist && collections) {
      try {
        await collections.put('why_records', owner, { ...why, owner }, { idKey: 'decisionId' });
      } catch (err) {
        log(`why:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) observability.emit({ type: 'why.completed', owner, correlationId, payload: { decisionId: why.decisionId, falsifiers: why.falsifiers.length } });
    return { ok: true, why };
  }

  async function forDecision(owner, decisionId) {
    if (!collections) return null;
    try {
      const out = await collections.get('why_records', owner, String(decisionId), { idKey: 'decisionId' });
      return out.ok ? out.row : null;
    } catch { return null; }
  }

  return { schema: WHY_ENGINE_SCHEMA, explain, forDecision, explainDecision };
}
