/**
 * FBT FINANCIAL INTELLIGENCE OS — Agent Council (Phase 212, upgrade 9).
 * ---------------------------------------------------------------------------
 * The existing council (council.js) adjudicates STRATEGY CANDIDATES through
 * six analyst roles. This engine is the other body the owner asked for: the
 * DOMAIN council — a Master AI chairing specialist agents, each of which
 * reads ONE real domain and votes on ONE question (BUY / HOLD / SELL for the
 * subject asset right now), exactly the owner's example:
 *
 *   Market: BUY · Risk: HOLD · Whale: BUY · News: HOLD · Macro: SELL
 *   → Master AI: HOLD
 *
 * AGENTS AND THEIR REAL INPUTS (no vote without a read):
 *   MARKET      price/24h moves of the subject asset (world market domain)
 *   RISK        risk level + concentration + drawdown (financial state)
 *   TRADING     entry timing + smart-money net flow (smartMoney intel)
 *   PORTFOLIO   how the position fits the goal + weights (financial + profile)
 *   DEFI        the yield actually available on the subject (blended/live APY)
 *   RWA         stocks/forex/commodities/rwa regime (cross-asset analysis)
 *   NEWS        headline risk classification (global news domain)
 *   ONCHAIN     chain health + activity (onchain domain)
 *   MACRO       transmission-graph impulse (macroGraph.js)
 *   EXECUTION   feasibility: gas, slippage, route, liquidity
 *   SECURITY    security signals + venue health
 *   WHALE       whale flow direction (whales domain)
 *
 * AGGREGATION (the Master AI chair)
 *   - a vote needs a readable input; an agent with no read ABSTAINS and says why
 *   - SELL from RISK or SECURITY is a VETO-grade signal: the aggregate can
 *     never be BUY against it (risk outweighs upside in this product's law)
 *   - otherwise: score = Σ(weight × vote) / Σ(weight of non-abstaining)
 *   - disagreement is recorded per agent, never averaged away
 *
 * This engine ADVISES. It never signs, never executes, and its record carries
 * executionAuthorized: false.
 */

import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';

export const AGENT_COUNCIL_SCHEMA = 'fbt.fi.agent-council.v1';

export const AGENT_VOTES = Object.freeze(['BUY', 'HOLD', 'SELL', 'ABSTAIN']);

export const COUNCIL_AGENTS = Object.freeze([
  { id: 'market', role: 'MARKET_AGENT', weight: 1.0 },
  { id: 'risk', role: 'RISK_AGENT', weight: 1.4, vetoGrade: true },
  { id: 'trading', role: 'TRADING_AGENT', weight: 0.8 },
  { id: 'portfolio', role: 'PORTFOLIO_AGENT', weight: 1.1 },
  { id: 'defi', role: 'DEFI_AGENT', weight: 0.8 },
  { id: 'rwa', role: 'RWA_AGENT', weight: 0.6 },
  { id: 'news', role: 'NEWS_AGENT', weight: 0.9 },
  { id: 'onchain', role: 'ONCHAIN_AGENT', weight: 0.7 },
  { id: 'macro', role: 'MACRO_AGENT', weight: 1.2 },
  { id: 'execution', role: 'EXECUTION_AGENT', weight: 0.9 },
  { id: 'security', role: 'SECURITY_AGENT', weight: 1.3, vetoGrade: true },
  { id: 'whale', role: 'WHALE_AGENT', weight: 0.7 }
]);

const VOTE_SCORE = Object.freeze({ BUY: 1, HOLD: 0, SELL: -1 });
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 3) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

function vote(direction, confidence, reason, read = true) {
  return { vote: direction, confidence: Math.max(0, Math.min(1, confidence)), reason, read };
}
const abstain = (reason) => ({ vote: 'ABSTAIN', confidence: 0, reason, read: false });

/** Each agent is a pure function over the shared context. */
function agentVotes({ asset = 'BTC', market = null, risk = null, financial = null, profile = null, goal = null, smartMoney = null, crossAsset = null, news = null, onchain = null, macroGraph = null, whales = null, costs = null, securitySignals = null, defi = null } = {}) {
  const sym = String(asset || 'BTC').toUpperCase();

  /* MARKET — the subject asset's real move. */
  const marketAgent = (() => {
    const instruments = Array.isArray(market?.instruments) ? market.instruments
      : (market?.prices ? Object.entries(market.prices).map(([symbol, priceUsd]) => ({ symbol, priceUsd, change24hPct: market.changes24hPct?.[symbol] ?? null })) : []);
    const row = instruments.find((r) => String(r.symbol || '').toUpperCase() === sym);
    const change = num(row?.change24hPct);
    if (change === null) return abstain(`no readable 24h move for ${sym}`);
    if (change > 3) return vote('BUY', 0.55, `${sym} +${change}% in 24h — momentum is real but late entries pay for it`);
    if (change > 0.5) return vote('BUY', 0.45, `${sym} +${change}% in 24h — mild positive drift`);
    if (change < -8) return vote('SELL', 0.6, `${sym} ${change}% in 24h — a falling knife is not a discount`);
    if (change < -3) return vote('HOLD', 0.5, `${sym} ${change}% in 24h — weak tape, wait for stabilization`);
    return vote('HOLD', 0.4, `${sym} ${change}% in 24h — no edge from price alone`);
  })();

  /* RISK — the portfolio's risk reading. */
  const riskAgent = (() => {
    const level = String(risk?.level || financial?.computed?.riskLevel || '').toUpperCase();
    const signals = Array.isArray(risk?.securitySignals) ? risk.securitySignals : [];
    const concentration = financial?.computed?.concentration;
    if (!level && !signals.length && !concentration) return abstain('no risk assessment was readable');
    if (signals.length >= 2 || level === 'CRITICAL') return vote('SELL', 0.85, `risk level ${level || 'unknown'} with ${signals.length} security signal(s) — capital preservation first`);
    if (level === 'HIGH') return vote('HOLD', 0.7, `risk level HIGH — no new exposure until it decays`);
    if (concentration?.topSharePct != null && num(concentration.topSharePct) > 40) return vote('HOLD', 0.6, `top position is ${concentration.topSharePct}% of the book — adding is concentration, not conviction`);
    if (level === 'LOW' || level === 'MODERATE') return vote('BUY', 0.5, `risk level ${level}; concentration ${concentration?.topSharePct ?? 'unread'}`);
    return vote('HOLD', 0.45, `risk level ${level || 'partial read'} — not a green light, not a stop`);
  })();

  /* TRADING — entry timing via smart money. */
  const tradingAgent = (() => {
    if (!smartMoney || smartMoney.status === 'unavailable') return abstain('smart-money feed unavailable');
    const netFlow = num(smartMoney.signals?.netFlowUsd);
    const alignment = smartMoney.alignment;
    if (alignment === 'accumulating' || (netFlow !== null && netFlow > 0)) return vote('BUY', 0.55, `smart money ${alignment || 'net inflow'} (${netFlow ?? 'unread'} USD window)`);
    if (alignment === 'distributing' || (netFlow !== null && netFlow < 0)) return vote('SELL', 0.5, `smart money ${alignment || 'net outflow'} — the fast money is leaving`);
    return vote('HOLD', 0.4, 'smart money flat this window');
  })();

  /* PORTFOLIO — fit against the profile + goal. */
  const portfolioAgent = (() => {
    if (!financial || financial.status === 'UNAVAILABLE') return abstain('financial state unreadable');
    const netWorth = num(financial.computed?.netWorthUsd);
    const stable = num(financial.computed?.stableSharePct);
    const horizon = profile?.horizonMonths ?? num(goal?.months);
    if (netWorth === null) return abstain('net worth unreadable');
    if (stable !== null && stable < 10 && String(goal?.months ? 'short' : '').length) return vote('HOLD', 0.6, `only ${stable}% stables — the liquidity buffer is too thin to add risk`);
    if (horizon != null && horizon <= 4) return vote('HOLD', 0.55, `a ${horizon}-month horizon carries timing risk; incremental entries only`);
    return vote('BUY', 0.5, `portfolio can absorb a new ${sym} position (net worth ${netWorth} USD, stables ${stable ?? 'unread'}%)`);
  })();

  /* DEFI — what the money can actually earn where it is. */
  const defiAgent = (() => {
    const apy = num(defi?.apyPct ?? financial?.computed?.blendedYieldPct);
    if (apy === null) return abstain('no readable APY this pass');
    if (apy >= 12) return vote('BUY', 0.5, `blended ${apy}% APY is available — idle capital is the expensive choice`);
    if (apy <= 2) return vote('HOLD', 0.45, `blended ${apy}% APY barely clears costs`);
    return vote('HOLD', 0.4, `blended ${apy}% APY — reasonable, not a reason by itself`);
  })();

  /* RWA — the traditional-market regime. */
  const rwaAgent = (() => {
    const regime = crossAsset?.regime?.regime || crossAsset?.regime;
    if (!regime) return abstain('cross-asset regime unreadable');
    const riskOff = /risk.?off|defensive|contraction/i.test(String(regime));
    if (riskOff) return vote('SELL', 0.5, `traditional markets read ${regime} — risk-off spills into crypto`);
    if (/risk.?on|expansion/i.test(String(regime))) return vote('BUY', 0.5, `traditional markets read ${regime} — risk appetite supports entries`);
    return vote('HOLD', 0.4, `traditional markets read ${regime}`);
  })();

  /* NEWS — headline risk for the subject. */
  const newsAgent = (() => {
    const items = Array.isArray(news?.items) ? news.items : [];
    if (!items.length) return abstain('news domain unavailable');
    const now3 = Date.now();
    const fresh = items.filter((n) => !n.at || now3 - n.at < 48 * 3600_000);
    const negative = fresh.filter((n) => /(hack|exploit|crash|ban|lawsuit|liquidation|dump|fall|plunge|SEC|fraud|سقوط|هک|کلاهبرداری)/i.test(String(n.title || ''))).length;
    const positive = fresh.filter((n) => /(rally|surge|adoption|approval|inflow|record|all-time|breakout|ETF approval|صعود|تأیید)/i.test(String(n.title || ''))).length;
    if (negative >= 3) return vote('SELL', 0.6, `${negative} negative headline(s) in the window — news risk is priced late, act early`);
    if (negative > positive) return vote('HOLD', 0.5, `${negative} negative vs ${positive} positive headline(s)`);
    if (positive > negative + 1) return vote('BUY', 0.45, `${positive} positive headline(s) vs ${negative} negative`);
    return vote('HOLD', 0.4, `headline flow balanced (${positive}+ / ${negative}−)`);
  })();

  /* ONCHAIN — chain health. */
  const onchainAgent = (() => {
    const health = onchain?.health || onchain;
    if (!health) return abstain('on-chain intel unavailable');
    const degraded = health.degraded === true || (Array.isArray(health.issues) && health.issues.length >= 2);
    if (degraded) return vote('HOLD', 0.55, 'chain health degraded — execution risk is elevated');
    return vote('BUY', 0.35, 'chain health nominal');
  })();

  /* MACRO — the transmission graph (causal pressure on the subject). */
  const macroAgent = (() => {
    if (!macroGraph || typeof macroGraph.pressure !== 'object') return abstain('macro graph not built');
    const pressure = num(macroGraph.pressure[String(sym).toLowerCase()]);
    const portfolioRisk = num(macroGraph.portfolioRiskImpulse);
    /* Negative macro pressure on the asset = bearish headwind = risk UP for
       holding it. The portfolio risk impulse (positive = risk up) is the
       fallback when the asset itself is not a graph node. */
    const v = pressure !== null ? pressure : (portfolioRisk !== null ? -portfolioRisk : null);
    if (v === null) return abstain('no macro pressure readable for the subject');
    if (v < -0.3) return vote('SELL', 0.55, `macro transmission pressure ${v} — the causal chain (rates→dollar→risk) is against the asset`);
    if (v > 0.3) return vote('BUY', 0.5, `macro transmission pressure ${v} — the causal chain supports risk assets`);
    return vote('HOLD', 0.45, `macro transmission pressure ${v} — flat`);
  })();

  /* EXECUTION — can the trade even be done at a sane cost. */
  const executionAgent = (() => {
    const gas = num(costs?.gasUsd);
    const slip = num(costs?.slippagePct);
    if (gas === null && slip === null) return abstain('no cost model available');
    if (gas !== null && gas > 25) return vote('HOLD', 0.6, `modelled gas ${gas} USD eats the edge — wait for a cheaper block`);
    if (slip !== null && slip > 1.5) return vote('HOLD', 0.55, `modelled slippage ${slip}% — the venue is too thin for this size`);
    return vote('BUY', 0.45, `execution costs sane (gas ${gas ?? 'n/a'} USD, slippage ${slip ?? 'n/a'}%)`);
  })();

  /* SECURITY — signals + venue health. */
  const securityAgent = (() => {
    const signals = Array.isArray(securitySignals) ? securitySignals : (Array.isArray(risk?.securitySignals) ? risk.securitySignals : null);
    if (!signals) return abstain('no security signals read');
    const blocking = signals.filter((s) => String(s.severity || '').toUpperCase() === 'BLOCK' || s.blocking === true);
    if (blocking.length) return vote('SELL', 0.9, `${blocking.length} blocking security signal(s): ${blocking.slice(0, 2).map((s) => s.detail || s.id || s.reason).join('; ')}`);
    if (signals.length) return vote('HOLD', 0.6, `${signals.length} security warning(s) — proceed only with eyes open`);
    return vote('BUY', 0.5, 'no security signals');
  })();

  /* WHALE — the big money. */
  const whaleAgent = (() => {
    if (!whales || whales.status === 'unavailable') return abstain('whale feed unavailable');
    const events = Array.isArray(whales.events) ? whales.events : [];
    if (!events.length) return abstain('no whale events in the window');
    const outflow = events.filter((e) => /exchange|deposit|sell|out/i.test(String(e.type || e.direction || ''))).length;
    const inflow = events.filter((e) => /withdraw|buy|accumulate|in/i.test(String(e.type || e.direction || ''))).length;
    if (outflow >= inflow + 2) return vote('BUY', 0.5, `${outflow} exchange-out vs ${inflow} in — whales moving to cold storage is accumulation-shaped`);
    if (inflow >= outflow + 2) return vote('SELL', 0.5, `${inflow} exchange-in vs ${outflow} out — whales pre-positioning to sell`);
    return vote('HOLD', 0.4, `whale flow mixed (${inflow} in / ${outflow} out)`);
  })();

  return {
    market: marketAgent, risk: riskAgent, trading: tradingAgent, portfolio: portfolioAgent,
    defi: defiAgent, rwa: rwaAgent, news: newsAgent, onchain: onchainAgent,
    macro: macroAgent, execution: executionAgent, security: securityAgent, whale: whaleAgent
  };
}

/**
 * Convene the domain council. Pure — the wrapper owns persistence.
 *
 * @param {object} p the shared context (asset, market, risk, financial,
 *                   profile, goal, smartMoney, crossAsset, news, onchain,
 *                   macroGraph, whales, costs, securitySignals, defi)
 */
export function conveneAgentCouncil(context = {}) {
  const votes = agentVotes(context);
  const rows = COUNCIL_AGENTS.map((agent) => {
    const v = votes[agent.id] || abstain('agent produced no vote');
    return {
      agent: agent.id,
      role: agent.role,
      weight: agent.weight,
      vetoGrade: Boolean(agent.vetoGrade),
      vote: v.vote,
      confidence: v.confidence,
      reason: v.reason,
      read: v.read === true
    };
  });

  const voting = rows.filter((r) => r.vote !== 'ABSTAIN');
  const abstained = rows.filter((r) => r.vote === 'ABSTAIN').map((r) => r.agent);
  /* The Master AI chair: weighted mean, then the veto-grade correction. */
  const weightSum = voting.reduce((a, r) => a + r.weight, 0);
  const raw = weightSum > 0 ? voting.reduce((a, r) => a + r.weight * VOTE_SCORE[r.vote] * r.confidence, 0) / weightSum : 0;
  const vetoSell = voting.filter((r) => r.vetoGrade && r.vote === 'SELL');
  const vetoBuy = voting.filter((r) => r.vetoGrade && r.vote === 'BUY');
  let score = round(raw, 3);
  let decision;
  if (vetoSell.length) {
    decision = 'HOLD';
    if (score < -0.15) decision = 'SELL';
  } else if (vetoBuy.length >= 2) {
    decision = score >= 0 ? 'BUY' : 'HOLD';
  } else if (score >= 0.22) decision = 'BUY';
  else if (score <= -0.22) decision = 'SELL';
  else decision = 'HOLD';

  const disagreements = voting.filter((r) => r.vote !== decision);
  const confidence = voting.length
    ? round(Math.max(0.05, Math.min(0.95, 0.55 + (voting.length - disagreements.length) * 0.04 - abstained.length * 0.02)), 3)
    : 0;

  return {
    schema: AGENT_COUNCIL_SCHEMA,
    asset: String(context.asset || 'PORTFOLIO').toUpperCase(),
    votes: rows,
    abstained,
    decision,
    score,
    vetoApplied: vetoSell.map((r) => r.agent),
    unanimous: voting.length > 0 && disagreements.length === 0,
    disagreement: disagreements.length > 0,
    disagreements: disagreements.map((r) => ({ agent: r.agent, vote: r.vote, reason: r.reason })),
    votingAgents: voting.length,
    confidence,
    narrative: voting.length === 0
      ? 'every agent abstained — there is nothing real to decide on'
      : vetoSell.length
        ? `${vetoSell.map((r) => r.agent).join(', ')} veto-grade SELL capped the decision at ${decision} (${disagreements.length} dissenting vote(s))`
        : `${voting.filter((r) => r.vote === decision).length} of ${voting.length} voting agents align on ${decision} (${abstained.length} abstained)`,
    executionAuthorized: false,
    note: 'domain agents vote on real reads only; an abstention names what was unread'
  };
}

/** The engine wrapper: convene + persist + recent. */
export function createAgentCouncilEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function convene(owner, context = {}, { correlationId = null, persist = true } = {}) {
    const gate = requireFlag('AGENT_COUNCIL_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag, council: null };
    const record = { ...conveneAgentCouncil(context), id: `ac_${randomUUID().replace(/-/g, '').slice(0, 20)}`, owner, at: now() };
    if (persist && collections) {
      try {
        await collections.put('agent_councils', owner, record, { idKey: 'id' });
      } catch (err) {
        log(`agent-council:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) observability.emit({ type: 'agent-council.convened', owner, correlationId, payload: { asset: record.asset, decision: record.decision, voting: record.votingAgents, abstained: record.abstained.length } });
    return { ok: true, council: record };
  }

  async function recent(owner, { limit = 10 } = {}) {
    if (!collections) return { ok: false, code: 'COLUMNS_NOT_WIRED', records: [] };
    const { rows } = await collections.read('agent_councils', owner);
    return { ok: true, records: rows.filter((r) => r?.schema === AGENT_COUNCIL_SCHEMA).slice(0, Math.max(1, limit)) };
  }

  return { schema: AGENT_COUNCIL_SCHEMA, convene, recent, conveneAgentCouncil, AGENTS: COUNCIL_AGENTS, VOTES: AGENT_VOTES };
}
