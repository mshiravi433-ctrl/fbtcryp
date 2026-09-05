/**
 * FBT FINANCIAL OS — Brain Index (Upgrade 11+12)
 * ---------------------------------------------------------------------------
 * Central entry point that unifies all brain subsystems:
 *   - Knowledge Graph
 *   - Ecosystem Router
 *   - Universal Action Model
 *   - Predictive Brain
 *   - Opportunity Engine
 *   - Financial Guardian
 *
 * This is the ONE import any page or component needs to interact with the
 * full Financial Operating System brain. It delegates to the existing
 * Central Intelligence Kernel (src/lib/central/*) for state management
 * and to the Central Brain (server/ci/brain.js) for execution.
 *
 * The brain layer is additive — it does NOT replace the existing kernel,
 * it adds cross-module intelligence on top of it.
 */

// Core subsystems
export { resolveEcosystemGraph, resolveIntentToModules, ECOSYSTEM_MODULES, KNOWLEDGE_SCHEMA } from './knowledgeGraph.js';
export { routeIntent, mergeModuleResults, ROUTER_SCHEMA } from './ecosystemRouter.js';
export {
  createUniversalAction, transitionAction, checkIdempotency,
  computeBatchRisk, actionToConfirmationCard, ACTION_TYPES,
  RISK_LEVELS, PERMISSION_LEVELS, UAM_SCHEMA
} from './universalActionModel.js';
export {
  forecastGoal, forecastPortfolio, forecastCashflow, forecastRisk,
  detectMarketRegime, createFinancialTwin, projectTwin, detectAnomalies,
  PREDICTIVE_SCHEMA, TWIN_SCHEMA
} from './predictiveBrain.js';
export { scanOpportunities, OPPORTUNITY_SCHEMA } from './opportunityEngine.js';
export { runGuardianSweep, evaluateEvent, GUARDIAN_SCHEMA } from './financialGuardian.js';

// Direct imports for internal use by orchestrateBrain
import { routeIntent as _routeIntent } from './ecosystemRouter.js';
import { runGuardianSweep as _runGuardianSweep } from './financialGuardian.js';
import { scanOpportunities as _scanOpportunities } from './opportunityEngine.js';
import { forecastGoal as _forecastGoal, forecastPortfolio as _forecastPortfolio, forecastRisk as _forecastRisk, createFinancialTwin as _createFinancialTwin } from './predictiveBrain.js';

export const BRAIN_SCHEMA = 'fbt.financial-brain.v1';
export const BRAIN_VERSION = '11.12.0';

/**
 * Master orchestration: given a user message and context, produce a full
 * brain response including routing, predictions, opportunities, and guardian status.
 */
export function orchestrateBrain({
  message = '',
  page = null,
  financialState = null,
  userProfile = null,
  activeGoals = [],
  existingPositions = {},
  riskProfile = null,
  conversationContext = null,
  walletBalances = {},
  portfolio = null,
  marketContext = null,
  defiOpportunities = [],
  rwaOpportunities = [],
  smartMoneySignals = [],
  recentTransactions = [],
  autonomyLevel = 2,
  now = Date.now()
} = {}) {
  // 1. Route the intent
  const routing = _routeIntent({
    message, page, financialState, userProfile,
    activeGoals, existingPositions, riskProfile,
    conversationContext, now
  });

  // 2. Run guardian sweep
  const guardian = _runGuardianSweep({
    financialState, portfolio, wallet: walletBalances,
    goals: activeGoals, marketContext, recentTransactions,
    autonomyLevel, now
  });

  // 3. Scan opportunities
  const opportunities = _scanOpportunities({
    financialState, userProfile, goals: activeGoals,
    walletBalances, portfolio, marketContext,
    defiOpportunities, rwaOpportunities, smartMoneySignals,
    riskProfile: riskProfile || userProfile?.riskProfile || 'MODERATE',
    now
  });

  // 4. Generate predictions if we have enough data
  let predictions = null;
  if (financialState && (financialState.netWorthUsd > 0 || financialState.availableCapitalUsd > 0)) {
    predictions = {
      portfolio: _forecastPortfolio({ financialState, months: 6, now }),
      risk: _forecastRisk({ financialState, positions: portfolio?.holdings || [], marketContext, now })
    };

    // Goal forecasts
    if (activeGoals.length > 0) {
      predictions.goals = activeGoals.map(g =>
        _forecastGoal({ goal: g, financialState, now })
      );
    }
  }

  // 5. Financial Twin
  let twin = null;
  if (financialState) {
    const twinResult = _createFinancialTwin({
      financialState, goals: activeGoals,
      riskProfile: riskProfile || 'MODERATE', now
    });
    if (twinResult.ok) twin = twinResult.twin;
  }

  return {
    schema: BRAIN_SCHEMA,
    version: BRAIN_VERSION,
    at: now,
    routing: routing.ok ? routing.plan : null,
    guardian,
    opportunities,
    predictions,
    twin,
    // Summary
    summary: {
      modulesInvolved: routing.ok ? routing.plan.selectedModuleIds?.length || routing.plan.modules?.primary?.length || 0 : 0,
      guardianHealth: guardian.healthLevel,
      guardianAlerts: guardian.alertCount,
      opportunityCount: opportunities.total,
      hasPredictions: predictions !== null,
      hasTwin: twin !== null
    }
  };
}

/**
 * Generate a Daily Financial Brief (§32)
 */
export function generateDailyBrief({
  financialState = null,
  portfolio = null,
  goals = [],
  guardian = null,
  opportunities = null,
  predictions = null,
  marketContext = null,
  now = Date.now()
} = {}) {
  const sections = [];

  // Portfolio section
  if (portfolio || financialState) {
    const total = Number(portfolio?.totalValueUsd || financialState?.netWorthUsd || 0);
    const change24h = Number(portfolio?.change24hPct || financialState?.change24hPct || 0);
    sections.push({
      id: 'portfolio',
      title: 'Portfolio',
      items: [
        { label: 'Total Value', value: `$${total.toLocaleString()}`, highlight: true },
        { label: '24h Change', value: `${change24h > 0 ? '+' : ''}${change24h.toFixed(1)}%`, color: change24h >= 0 ? '#22c55e' : '#ef4444' }
      ]
    });
  }

  // Goals section
  if (goals.length > 0) {
    sections.push({
      id: 'goals',
      title: 'Goals',
      items: goals.slice(0, 3).map(g => ({
        label: g.name || 'Goal',
        value: `${Math.round(g.progressPct || 0)}%`,
        color: (g.progressPct || 0) > 70 ? '#22c55e' : (g.progressPct || 0) > 30 ? '#eab308' : '#ef4444'
      }))
    });
  }

  // Risk section
  if (guardian) {
    sections.push({
      id: 'risk',
      title: 'Risk & Security',
      items: [
        { label: 'Health Score', value: `${guardian.healthScore}/100`, color: guardian.healthScore >= 70 ? '#22c55e' : guardian.healthScore >= 40 ? '#eab308' : '#ef4444' },
        { label: 'Active Alerts', value: String(guardian.alertCount), color: guardian.criticalAlerts > 0 ? '#ef4444' : guardian.highAlerts > 0 ? '#f97316' : '#22c55e' }
      ]
    });
  }

  // Market section
  if (marketContext) {
    sections.push({
      id: 'market',
      title: 'Market',
      items: [
        { label: 'Regime', value: marketContext.regime || 'Unknown' },
        { label: 'Trend', value: marketContext.trend || 'Unknown', color: marketContext.trend === 'BULLISH' ? '#22c55e' : marketContext.trend === 'BEARISH' ? '#ef4444' : '#eab308' }
      ]
    });
  }

  // Opportunities section
  if (opportunities?.opportunities?.length > 0) {
    const top = opportunities.opportunities.slice(0, 3);
    sections.push({
      id: 'opportunities',
      title: 'Opportunities',
      items: top.map(o => ({
        label: o.title?.slice(0, 40),
        value: o.urgency,
        color: o.urgency === 'HIGH' ? '#f97316' : o.urgency === 'MEDIUM' ? '#eab308' : '#22c55e'
      }))
    });
  }

  // Required Actions
  if (guardian?.alerts?.length > 0) {
    const actions = guardian.alerts
      .filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH')
      .slice(0, 3)
      .map(a => ({ label: a.recommendedAction || 'Review needed', detail: a.title }));

    if (actions.length > 0) {
      sections.push({
        id: 'actions',
        title: 'Required Actions',
        items: actions
      });
    }
  }

  return {
    schema: 'fbt.daily-brief.v1',
    at: now,
    date: new Date(now).toISOString().split('T')[0],
    sections,
    overallMood: guardian?.healthScore >= 80 ? 'POSITIVE' : guardian?.healthScore >= 50 ? 'NEUTRAL' : 'CAUTIOUS'
  };
}

export default { orchestrateBrain, generateDailyBrief, BRAIN_SCHEMA, BRAIN_VERSION };
