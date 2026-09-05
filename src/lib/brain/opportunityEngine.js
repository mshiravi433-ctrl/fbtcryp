/**
 * FBT FINANCIAL OS — Opportunity Engine (Upgrade 11+12 §21)
 * ---------------------------------------------------------------------------
 * Continuously scans the ecosystem for personalized opportunities based on
 * the user's profile, wallet, risk, goals, market, smart money, and research.
 * Each opportunity is scored for relevance, risk, confidence, and timing.
 *
 * Not general market opportunities — PERSONALIZED to this user.
 */

export const OPPORTUNITY_SCHEMA = 'fbt.opportunity-engine.v1';

/**
 * Scan for opportunities relevant to the current user state
 */
export function scanOpportunities({
  financialState = null,
  userProfile = null,
  goals = [],
  walletBalances = {},
  portfolio = null,
  marketContext = null,
  defiOpportunities = [],
  rwaOpportunities = [],
  smartMoneySignals = [],
  newsSignals = [],
  riskProfile = 'MODERATE',
  now = Date.now()
} = {}) {
  const opportunities = [];

  // 1. Idle capital → yield opportunities
  if (financialState) {
    const liquidUsd = Number(financialState.liquidUsd || financialState.availableCapitalUsd || 0);
    if (liquidUsd > 50) {
      const stableRatio = financialState.stableRatio || 0;
      if (stableRatio > 0.3) {
        opportunities.push(createOpportunity({
          type: 'YIELD_ON_IDLE',
          title: 'Yield on idle stablecoins',
          description: `${Math.round(stableRatio * 100)}% of your liquid capital is in stablecoins earning no yield`,
          modules: ['DEFI', 'LENDING', 'WALLET'],
          urgency: stableRatio > 0.5 ? 'HIGH' : 'MEDIUM',
          expectedReturnPct: estimateStableYield(),
          riskLevel: 'LOW',
          confidence: 0.8,
          liquidity: 'HIGH',
          timeHorizon: 'FLEXIBLE',
          capitalRequiredUsd: Math.round(liquidUsd * stableRatio),
          source: 'FINANCIAL_STATE',
          evidence: [{ type: 'BALANCE_ANALYSIS', detail: `Stable ratio: ${Math.round(stableRatio * 100)}%` }]
        }, now));
      }
    }
  }

  // 2. Portfolio rebalance opportunities
  if (portfolio?.holdings?.length > 1) {
    const total = portfolio.holdings.reduce((s, h) => s + Number(h.valueUsd || 0), 0);
    const overweight = portfolio.holdings.filter(h => total > 0 && (Number(h.valueUsd || 0) / total) > 0.4);
    if (overweight.length > 0) {
      opportunities.push(createOpportunity({
        type: 'REBALANCE',
        title: 'Portfolio concentration detected',
        description: `${overweight.length} asset(s) represent >40% of your portfolio`,
        modules: ['PORTFOLIO', 'RISK', 'TRADING'],
        urgency: overweight.some(h => (Number(h.valueUsd || 0) / total) > 0.6) ? 'HIGH' : 'MEDIUM',
        riskLevel: 'LOW',
        confidence: 0.9,
        liquidity: 'HIGH',
        timeHorizon: 'SHORT_TERM',
        source: 'PORTFOLIO_ANALYSIS',
        evidence: overweight.map(h => ({
          type: 'CONCENTRATION',
          detail: `${h.symbol}: ${Math.round((Number(h.valueUsd || 0) / total) * 100)}%`
        }))
      }, now));
    }
  }

  // 3. DeFi yield opportunities
  for (const defi of defiOpportunities.slice(0, 5)) {
    if (!defi.apy || defi.apy < 1) continue;
    const riskAdjustedScore = defi.apy / Math.max(1, defi.riskScore || 5);
    if (riskAdjustedScore < 0.5) continue;

    opportunities.push(createOpportunity({
      type: 'DEFI_YIELD',
      title: `${defi.protocol || 'Protocol'} — ${Math.round(defi.apy)}% APY`,
      description: defi.description || `Yield opportunity on ${defi.protocol || 'DeFi protocol'}`,
      modules: ['DEFI', 'RESEARCH', 'RISK'],
      urgency: defi.apy > 15 ? 'HIGH' : 'MEDIUM',
      expectedReturnPct: defi.apy,
      riskLevel: defi.riskScore > 7 ? 'HIGH' : defi.riskScore > 4 ? 'MEDIUM' : 'LOW',
      confidence: Math.min(0.85, riskAdjustedScore / 3),
      liquidity: defi.liquidity || 'MEDIUM',
      timeHorizon: defi.duration || 'FLEXIBLE',
      source: 'DEFI_SCAN',
      evidence: [{
        type: 'YIELD_DATA',
        detail: `APY: ${defi.apy}%, TVL: ${defi.tvl || 'unknown'}, Risk: ${defi.riskScore || '?'}/10`
      }]
    }, now));
  }

  // 4. Smart money signals
  for (const signal of smartMoneySignals.slice(0, 3)) {
    opportunities.push(createOpportunity({
      type: 'SMART_MONEY',
      title: `Smart Money: ${signal.action || 'Activity'} on ${signal.asset || 'asset'}`,
      description: signal.detail || 'Notable on-chain activity detected',
      modules: ['SMART_MONEY', 'RESEARCH', 'TRADING'],
      urgency: signal.urgency || 'LOW',
      riskLevel: signal.riskLevel || 'MEDIUM',
      confidence: signal.confidence || 0.5,
      liquidity: 'HIGH',
      timeHorizon: 'SHORT_TERM',
      source: 'SMART_MONEY',
      evidence: [{ type: 'ON_CHAIN', detail: signal.detail || signal.action }]
    }, now));
  }

  // 5. Goal-based opportunities
  for (const goal of goals.slice(0, 3)) {
    if (goal.progressPct < 50 && goal.horizonMonths && goal.horizonMonths > 2) {
      opportunities.push(createOpportunity({
        type: 'GOAL_OPTIMIZATION',
        title: `Optimize strategy for "${goal.name}"`,
        description: `Goal is ${goal.progressPct || 0}% complete — review allocation for better trajectory`,
        modules: ['GOALS', 'PORTFOLIO', 'RESEARCH', 'RISK'],
        urgency: goal.progressPct < 20 ? 'HIGH' : 'MEDIUM',
        riskLevel: 'LOW',
        confidence: 0.7,
        liquidity: 'HIGH',
        timeHorizon: `${goal.horizonMonths} months`,
        source: 'GOAL_ENGINE',
        evidence: [{ type: 'GOAL_PROGRESS', detail: `${goal.progressPct || 0}% toward ${goal.targetUsd || 'target'}` }]
      }, now));
    }
  }

  // 6. RWA opportunities (for conservative/medium risk profiles)
  if (riskProfile !== 'AGGRESSIVE' && rwaOpportunities.length > 0) {
    for (const rwa of rwaOpportunities.slice(0, 2)) {
      opportunities.push(createOpportunity({
        type: 'RWA_INVESTMENT',
        title: `${rwa.category || 'RWA'} — ${rwa.name || 'Real World Asset'}`,
        description: rwa.description || `Tokenized ${rwa.category || 'real world asset'} opportunity`,
        modules: ['RWA', 'RESEARCH', 'RISK'],
        urgency: 'LOW',
        expectedReturnPct: rwa.expectedYield || null,
        riskLevel: rwa.riskLevel || 'LOW',
        confidence: rwa.confidence || 0.6,
        liquidity: rwa.liquidity || 'LOW',
        timeHorizon: rwa.duration || 'MEDIUM_TERM',
        source: 'RWA_CATALOG',
        evidence: rwa.evidence || []
      }, now));
    }
  }

  // 7. Risk-based opportunities (when risk is high, suggest hedging)
  if (marketContext?.regime === 'BEAR_HIGH_VOL' || marketContext?.volatilityPct > 80) {
    opportunities.push(createOpportunity({
      type: 'RISK_HEDGE',
      title: 'Consider hedging portfolio',
      description: 'Market volatility is elevated — protective strategies may reduce downside',
      modules: ['RISK', 'PORTFOLIO', 'TRADING'],
      urgency: 'HIGH',
      riskLevel: 'LOW',
      confidence: 0.7,
      liquidity: 'HIGH',
      timeHorizon: 'SHORT_TERM',
      source: 'RISK_ENGINE',
      evidence: [{ type: 'MARKET_REGIME', detail: `Regime: ${marketContext.regime}, Vol: ${marketContext.volatilityPct}%` }]
    }, now));
  }

  // Score and sort
  const scored = opportunities
    .map(opp => ({ ...opp, score: computeOpportunityScore(opp, riskProfile, goals) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return {
    schema: OPPORTUNITY_SCHEMA,
    status: 'OK',
    at: now,
    opportunities: scored,
    total: scored.length,
    byType: groupByType(scored),
    byUrgency: groupByUrgency(scored)
  };
}

function createOpportunity(input, now) {
  return {
    opportunityId: `opp_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type: input.type,
    title: input.title,
    description: input.description,
    modules: input.modules || [],
    urgency: input.urgency || 'LOW',
    expectedReturnPct: input.expectedReturnPct || null,
    riskLevel: input.riskLevel || 'MEDIUM',
    confidence: input.confidence || 0.5,
    liquidity: input.liquidity || 'MEDIUM',
    timeHorizon: input.timeHorizon || 'FLEXIBLE',
    capitalRequiredUsd: input.capitalRequiredUsd || null,
    source: input.source || 'SCANNER',
    evidence: input.evidence || [],
    score: 0,
    discoveredAt: now,
    expiresAt: now + 24 * 3600_000 // 24h default
  };
}

function computeOpportunityScore(opp, riskProfile, goals) {
  let score = 0;

  // Confidence weight
  score += (opp.confidence || 0.5) * 30;

  // Urgency weight
  const urgencyWeight = { CRITICAL: 1.0, HIGH: 0.8, MEDIUM: 0.5, LOW: 0.2 };
  score += (urgencyWeight[opp.urgency] || 0.3) * 20;

  // Risk alignment
  const riskAlignment = {
    CONSERVATIVE: { LOW: 1.0, MEDIUM: 0.5, HIGH: 0.1, CRITICAL: 0 },
    MODERATE: { LOW: 0.8, MEDIUM: 1.0, HIGH: 0.6, CRITICAL: 0.2 },
    BALANCED: { LOW: 0.7, MEDIUM: 0.9, HIGH: 0.7, CRITICAL: 0.3 },
    AGGRESSIVE: { LOW: 0.4, MEDIUM: 0.7, HIGH: 1.0, CRITICAL: 0.6 }
  };
  score += (riskAlignment[riskProfile]?.[opp.riskLevel] || 0.5) * 25;

  // Goal relevance
  if (goals.length > 0) {
    const goalRelevant = opp.modules.some(m => ['GOALS', 'PORTFOLIO', 'RESEARCH'].includes(m));
    if (goalRelevant) score += 15;
  }

  // Evidence strength
  score += Math.min(10, (opp.evidence?.length || 0) * 3);

  return Math.round(Math.min(100, score) * 10) / 10;
}

function estimateStableYield() {
  // Conservative estimate based on current DeFi stable yields
  return 4; // 4% conservative baseline
}

function groupByType(opps) {
  const groups = {};
  for (const o of opps) {
    const t = o.type || 'OTHER';
    if (!groups[t]) groups[t] = [];
    groups[t].push(o.opportunityId);
  }
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
}

function groupByUrgency(opps) {
  const groups = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const o of opps) {
    groups[o.urgency] = (groups[o.urgency] || 0) + 1;
  }
  return groups;
}

export default { scanOpportunities, OPPORTUNITY_SCHEMA };
