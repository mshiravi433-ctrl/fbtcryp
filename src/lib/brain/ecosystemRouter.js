/**
 * FBT FINANCIAL OS — Ecosystem Router (Upgrade 11+12 §4, §13, §27, §29)
 * ---------------------------------------------------------------------------
 * The central routing layer that takes a user intent, resolves it against the
 * Knowledge Graph, selects which modules need to participate, and produces a
 * routing plan. Supports single-module and multi-module execution.
 *
 * WHY THIS EXISTS
 * Without a router, each intent goes to exactly one module. "20% profit"
 * goes to Trading. But the user might have DeFi positions, RWA holdings,
 * and credit exposure — all of which should be part of the answer. The
 * router uses the Knowledge Graph to discover ALL relevant modules and
 * creates a plan for parallel or sequential execution.
 *
 * HOW IT RELATES TO THE EXISTING BRAIN
 * The brain (server/ci/brain.js) executes the plan. The router just decides
 * which modules to involve and in what order. The brain's module registry
 * provides the actual read/quote/execute methods.
 */
import { resolveIntentToModules, ECOSYSTEM_MODULES } from './knowledgeGraph.js';

export const ROUTER_SCHEMA = 'fbt.ecosystem-router.v1';

/**
 * Route a user intent to the appropriate ecosystem modules.
 * Returns a routing plan that the orchestrator can execute.
 */
export function routeIntent({
  message = '',
  page = null,
  financialState = null,
  userProfile = null,
  activeGoals = [],
  existingPositions = {},
  riskProfile = null,
  conversationContext = null,
  now = Date.now()
} = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return { ok: false, code: 'EMPTY_INTENT', detail: 'No message to route' };
  }

  // Resolve intent to modules using knowledge graph
  const graph = resolveIntentToModules(text, {
    financialState, userProfile, activeGoals, existingPositions,
    riskProfile, now
  });

  // Determine routing strategy
  const primaryModules = graph.modules.filter(m => m.score >= 0.5).map(m => m.id);
  const secondaryModules = graph.modules.filter(m => m.score >= 0.2 && m.score < 0.5).map(m => m.id);
  const supportiveModules = graph.modules.filter(m => m.score < 0.2 && m.score > 0).map(m => m.id);

  // Determine execution mode
  const isMultiModule = primaryModules.length > 1 || secondaryModules.length > 0;
  const executionMode = primaryModules.length > 3 ? 'PARALLEL' :
                        primaryModules.length > 1 ? 'SEQUENTIAL' : 'SINGLE';

  // Build the routing plan
  const plan = {
    schema: ROUTER_SCHEMA,
    routingId: `rt_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    intentText: text.slice(0, 200),
    at: now,
    page: page || null,
    graph,
    executionMode,
    isMultiModule,
    modules: {
      primary: primaryModules.map(id => ({
        id,
        definition: ECOSYSTEM_MODULES[id] || null,
        score: graph.modules.find(m => m.id === id)?.score || 0,
        reasons: graph.modules.find(m => m.id === id)?.reasons || [],
        executionPhase: 'PRIMARY',
        canRunParallel: true,
        requiredTools: getModuleTools(id)
      })),
      secondary: secondaryModules.map(id => ({
        id,
        definition: ECOSYSTEM_MODULES[id] || null,
        score: graph.modules.find(m => m.id === id)?.score || 0,
        reasons: graph.modules.find(m => m.id === id)?.reasons || [],
        executionPhase: 'SECONDARY',
        canRunParallel: true,
        requiredTools: getModuleTools(id)
      })),
      supportive: supportiveModules.slice(0, 3).map(id => ({
        id,
        definition: ECOSYSTEM_MODULES[id] || null,
        score: graph.modules.find(m => m.id === id)?.score || 0,
        reasons: graph.modules.find(m => m.id === id)?.reasons || [],
        executionPhase: 'SUPPORTIVE',
        canRunParallel: true,
        requiredTools: getModuleTools(id)
      }))
    },
    // Cross-module dependencies
    dependencies: resolveDependencies(primaryModules.concat(secondaryModules)),
    // Expected output shape
    expectedOutput: {
      totalModules: primaryModules.length + secondaryModules.length,
      crossModule: isMultiModule,
      needsConsensus: primaryModules.length > 2,
      needsCouncil: graph.modules.some(m => m.score >= 0.7) && isMultiModule
    },
    // Page context integration
    pageModule: resolvePageModule(page),
    // Conversation context
    conversationContext: conversationContext ? {
      hasHistory: true,
      lastIntentId: conversationContext.lastIntentId || null,
      activeSlots: conversationContext.activeSlots || [],
      pendingQuestion: conversationContext.pendingQuestion || null
    } : null
  };

  return { ok: true, plan };
}

/**
 * Get the tools/methods a module needs
 */
function getModuleTools(moduleId) {
  const TOOLS = {
    PAY: ['wallet.balance', 'payment.process', 'payment.verify'],
    WALLET: ['wallet.read', 'wallet.refresh', 'wallet.balances'],
    PORTFOLIO: ['portfolio.read', 'portfolio.allocation', 'portfolio.concentration'],
    TRADING: ['swap.quote', 'swap.simulate', 'swap.execute', 'market.read'],
    SWAP: ['swap.quote', 'swap.simulate', 'swap.execute', 'swap.verify'],
    DEFI: ['farming.read', 'lending.read', 'defi.opportunities', 'protocol.health'],
    FARM: ['farming.read', 'farming.quote', 'farming.simulate'],
    LENDING: ['lending.read', 'lending.quote', 'lending.simulate'],
    FUTURES: ['futures.read', 'futures.quote', 'futures.execute'],
    CREDIT: ['credit.profile', 'credit.capacity', 'credit.risk'],
    RWA: ['rwa.read', 'rwa.opportunities', 'rwa.compare'],
    BUSINESS: ['business.read', 'business.cashflow', 'business.analyze'],
    MARKETPLACE: ['marketplace.search', 'marketplace.compare', 'payment.process'],
    RESEARCH: ['research.token', 'research.protocol', 'research.macro', 'news.read'],
    SMART_MONEY: ['smartmoney.read', 'smartmoney.alerts', 'whale.track'],
    SIGNALS: ['signals.read', 'signals.analyze'],
    NEWS: ['news.read', 'news.sentiment', 'news.impact'],
    GOALS: ['goals.read', 'goals.progress', 'goals.forecast'],
    RISK: ['risk.assess', 'risk.scenario', 'risk.guardian'],
    SECURITY: ['security.audit', 'security.approvals', 'security.alerts'],
    MACRO: ['macro.read', 'macro.regime', 'macro.forecast'],
    NFT: ['nft.read', 'nft.value'],
    STOCKS: ['stocks.read', 'stocks.compare'],
    FOREX: ['forex.read', 'forex.convert'],
    COMMODITIES: ['commodities.read', 'commodities.compare'],
    CROSS_CHAIN: ['crosschain.quote', 'crosschain.route'],
    BRIDGE: ['bridge.quote', 'bridge.execute', 'bridge.verify']
  };
  return TOOLS[moduleId] || [];
}

/**
 * Resolve inter-module dependencies
 */
function resolveDependencies(moduleIds) {
  const deps = [];
  const set = new Set(moduleIds);

  // Trading depends on Wallet (for balances)
  if (set.has('TRADING') && set.has('WALLET')) {
    deps.push({ from: 'TRADING', to: 'WALLET', type: 'READS_BALANCE', required: true });
  }
  // Portfolio depends on Wallet
  if (set.has('PORTFOLIO') && set.has('WALLET')) {
    deps.push({ from: 'PORTFOLIO', to: 'WALLET', type: 'READS_BALANCE', required: true });
  }
  // DeFi depends on Research (for protocol info)
  if (set.has('DEFI') && set.has('RESEARCH')) {
    deps.push({ from: 'DEFI', to: 'RESEARCH', type: 'USES_RESEARCH', required: false });
  }
  // Credit depends on Risk
  if (set.has('CREDIT') && set.has('RISK')) {
    deps.push({ from: 'CREDIT', to: 'RISK', type: 'USES_RISK', required: true });
  }
  // Goals depends on Portfolio
  if (set.has('GOALS') && set.has('PORTFOLIO')) {
    deps.push({ from: 'GOALS', to: 'PORTFOLIO', type: 'READS_PROGRESS', required: true });
  }
  // Risk is needed by most investment modules
  for (const mod of ['TRADING', 'DEFI', 'FUTURES', 'CREDIT', 'RWA']) {
    if (set.has(mod) && set.has('RISK')) {
      deps.push({ from: mod, to: 'RISK', type: 'USES_RISK_ASSESSMENT', required: false });
    }
  }

  return deps;
}

/**
 * Map a page path to its primary module
 */
function resolvePageModule(page) {
  if (!page) return null;
  const path = String(page.pathname || page.path || page || '').toLowerCase();

  const PAGE_MODULE_MAP = {
    '/wallet': 'WALLET', '/send': 'PAY', '/receive': 'PAY',
    '/swap': 'SWAP', '/trade': 'TRADING', '/buy': 'TRADING',
    '/portfolio': 'PORTFOLIO', '/earn': 'DEFI', '/farm': 'FARM',
    '/futures': 'FUTURES', '/dydx': 'FUTURES', '/perp': 'FUTURES',
    '/loan': 'CREDIT', '/borrow': 'CREDIT',
    '/invest': 'PORTFOLIO', '/stocks': 'STOCKS',
    '/shop': 'MARKETPLACE', '/explore': 'RESEARCH',
    '/signals': 'SIGNALS', '/news': 'NEWS',
    '/smart-money': 'SMART_MONEY', '/security': 'SECURITY',
    '/vault': 'DEFI', '/bridge': 'BRIDGE', '/cross-chain': 'CROSS_CHAIN',
    '/business': 'BUSINESS', '/nft': 'NFT',
    '/intent': 'GOALS', '/settings': null
  };

  for (const [pattern, mod] of Object.entries(PAGE_MODULE_MAP)) {
    if (path.startsWith(pattern)) return mod;
  }
  return null;
}

/**
 * Merge results from multiple modules into a unified response
 */
export function mergeModuleResults(results = [], plan = null) {
  const merged = {
    schema: ROUTER_SCHEMA,
    at: Date.now(),
    sections: {},
    recommendations: [],
    warnings: [],
    opportunities: [],
    crossModuleInsights: [],
    confidence: 0,
    totalModules: results.length,
    successfulModules: 0,
    failedModules: 0
  };

  let totalConfidence = 0;
  let confidenceCount = 0;

  for (const result of results) {
    if (!result) continue;
    const moduleId = result.module || result.moduleId || 'UNKNOWN';

    if (result.status === 'OK' || result.status === 'PARTIAL') {
      merged.successfulModules++;
      merged.sections[moduleId.toLowerCase()] = {
        data: result.data || result,
        status: result.status,
        freshness: result.freshness || null,
        source: result.source || moduleId
      };

      // Extract recommendations
      if (result.recommendations) {
        merged.recommendations.push(...result.recommendations.map(r => ({
          ...r, sourceModule: moduleId
        })));
      }

      // Extract warnings
      if (result.warnings) {
        merged.warnings.push(...result.warnings.map(w => ({
          ...w, sourceModule: moduleId
        })));
      }

      // Extract opportunities
      if (result.opportunities) {
        merged.opportunities.push(...result.opportunities.map(o => ({
          ...o, sourceModule: moduleId
        })));
      }

      // Track confidence
      if (result.confidence != null) {
        totalConfidence += Number(result.confidence);
        confidenceCount++;
      }
    } else {
      merged.failedModules++;
      merged.sections[moduleId.toLowerCase()] = {
        status: result.status || 'UNAVAILABLE',
        reason: result.reason || 'MODULE_FAILED',
        source: moduleId
      };
    }
  }

  // Generate cross-module insights
  merged.crossModuleInsights = generateCrossModuleInsights(merged.sections, plan);

  // Compute overall confidence
  merged.confidence = confidenceCount > 0
    ? Math.round((totalConfidence / confidenceCount) * 100) / 100
    : 0;

  // Sort recommendations by score
  merged.recommendations.sort((a, b) => (b.score || 0) - (a.score || 0));

  return merged;
}

/**
 * Generate insights that only make sense when looking across modules
 */
function generateCrossModuleInsights(sections, plan) {
  const insights = [];
  const wallet = sections.wallet?.data;
  const portfolio = sections.portfolio?.data;
  const risk = sections.risk?.data;
  const defi = sections.defi?.data;
  const trading = sections.trading?.data;
  const goals = sections.goals?.data;
  const credit = sections.credit?.data;

  // Portfolio + Risk: concentration warning
  if (portfolio?.totalValueUsd && risk?.factors) {
    const concentrationRisk = risk.factors.find(f => f.code === 'CONCENTRATION');
    if (concentrationRisk) {
      insights.push({
        type: 'RISK_ALERT',
        severity: 'HIGH',
        modules: ['PORTFOLIO', 'RISK'],
        text: 'Portfolio concentration detected — consider diversifying',
        detail: concentrationRisk.detail || null
      });
    }
  }

  // Wallet + DeFi: idle capital
  if (wallet?.totalUsd > 100 && defi?.opportunities?.length > 0) {
    const idlePct = wallet.stableUsd ? (wallet.stableUsd / wallet.totalUsd) * 100 : 0;
    if (idlePct > 30) {
      insights.push({
        type: 'OPPORTUNITY',
        severity: 'MEDIUM',
        modules: ['WALLET', 'DEFI'],
        text: `${Math.round(idlePct)}% of your capital is idle in stablecoins`,
        detail: 'Consider yield strategies for unused stablecoins'
      });
    }
  }

  // Goals + Portfolio: goal deviation
  if (goals?.goals?.length > 0 && portfolio?.totalValueUsd) {
    for (const goal of goals.goals) {
      if (goal.progress && goal.progress.pct < 50 && goal.deadline) {
        const daysLeft = Math.ceil((new Date(goal.deadline) - Date.now()) / 86400000);
        if (daysLeft < 90 && daysLeft > 0) {
          insights.push({
            type: 'GOAL_DEVIATION',
            severity: 'HIGH',
            modules: ['GOALS', 'PORTFOLIO'],
            text: `Goal "${goal.name}" is ${goal.progress.pct}% complete with ${daysLeft} days left`,
            detail: 'Consider adjusting strategy or timeline'
          });
        }
      }
    }
  }

  // Credit + Risk: liquidation proximity
  if (credit?.ltv && credit.ltv > 70) {
    insights.push({
      type: 'LIQUIDATION_WARNING',
      severity: 'CRITICAL',
      modules: ['CREDIT', 'RISK'],
      text: `LTV at ${credit.ltv}% — approaching liquidation threshold`,
      detail: 'Consider adding collateral or reducing debt'
    });
  }

  return insights;
}

export default { routeIntent, mergeModuleResults, ROUTER_SCHEMA };
