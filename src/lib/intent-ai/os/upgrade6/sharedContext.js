/**
 * FBT AI / Intent OS — UPGRADE 6
 * Shared AI Context + Agent Orchestrator V2 + Multi-Agent Collaboration
 * Spec §5, §6, §19, §42
 */

function makeId(prefix = 'id') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * SharedAIContext per spec §6
 */
export function createSharedContext({
  userIntent = null,
  conversation = null,
  wallet = null,
  portfolio = null,
  market = null,
  riskProfile = null,
  userPreferences = null,
  previousAnswers = null,
  currentTask = null,
  currentPage = null,
  availableTools = null,
  conversationState = null,
  sessionId = null
} = {}) {
  return {
    schema: 'fbt.shared-ai-context.v6',
    version: 6,
    sessionId: sessionId || conversationState?.sessionId || makeId('sess'),
    intentId: conversationState?.intentId || userIntent?.intentId || makeId('intent'),
    timestamp: Date.now(),

    userIntent: userIntent || conversationState?.currentIntent || null,
    conversation: conversation || conversationState?.messages || [],
    wallet: wallet || conversationState?.walletContext || null,
    portfolio: portfolio || null,
    market: market || null,
    riskProfile: riskProfile || null,
    userPreferences: userPreferences || null,
    previousAnswers: previousAnswers || conversationState?.answersReceived || [],
    currentTask: currentTask || conversationState?.currentTask || null,
    currentPage: currentPage || conversationState?.currentRoute || '/intent',
    availableTools: availableTools || [],

    // Derived from conversationState
    collectedSlots: conversationState?.collectedSlots || {},
    missingSlots: conversationState?.missingSlots || [],
    lastQuestion: conversationState?.lastQuestion || null,
    lastQuestionId: conversationState?.lastQuestionId || null,
    lastUserAnswer: conversationState?.lastUserAnswer || null,

    // Agent collaboration
    agentResults: {},
    sharedMemory: {},

    // Observability
    agentsUsed: [],
    toolsUsed: []
  };
}

/**
 * Agent Orchestrator V2 — Spec §5
 * Real orchestration, not just separate chatbots
 * Example: "اگر بیت‌کوین تا چهار ماه آینده ۳۰٪ رشد کند، با سرمایه من چه اتفاقی می‌افتد؟"
 * Should use: Intent Agent + Market Agent + Portfolio Agent + Risk Agent + Scenario Agent
 */
export class AgentOrchestratorV2 {
  constructor({ agents = {}, toolRegistry = null, eventBus = null } = {}) {
    this.agents = agents;
    this.toolRegistry = toolRegistry;
    this.eventBus = eventBus;
    this.sharedContext = null;
  }

  setSharedContext(ctx) {
    this.sharedContext = ctx;
    return this;
  }

  /**
   * Determine which agents are needed for a given intent
   */
  determineRequiredAgents(intent, context = {}) {
    const type = intent?.type || intent?.primaryIntent || context?.currentIntent || 'GENERAL';
    const text = (intent?.raw || context?.lastMessage || '').toLowerCase();

    // Complex scenario: BTC growth prediction with portfolio impact
    if (/اگر.*بیت.*رشد|اگر.*btc.*رشد|what if.*btc|btc.*grow|بیت.*رشد.*سرمایه/.test(text) && /سرمایه|portfolio|پرتفوی/.test(text)) {
      return ['intent-agent', 'market-agent', 'portfolio-agent', 'risk-agent', 'strategy-agent', 'scenario-agent'];
    }

    // Profit goal
    if (/سود|profit|۲۰٪|20%|goal.*profit/.test(text)) {
      return ['intent-agent', 'portfolio-agent', 'market-agent', 'risk-agent', 'yield-agent', 'strategy-agent'];
    }

    // Portfolio analysis
    if (type === 'PORTFOLIO_ANALYSIS' || /پرتفوی.*تحلیل|portfolio.*analysis/.test(text)) {
      return ['intent-agent', 'portfolio-agent', 'risk-agent', 'market-agent'];
    }

    // Market analysis
    if (type === 'MARKET_ANALYSIS' || type === 'ANALYZE_TOKEN') {
      return ['intent-agent', 'market-agent', 'research-agent', 'risk-agent'];
    }

    // Swap / Trading
    if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'].includes(type)) {
      return ['intent-agent', 'trading-agent', 'wallet-agent', 'risk-agent', 'guardian-agent', 'execution-agent'];
    }

    // Yield
    if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) {
      return ['intent-agent', 'yield-agent', 'risk-agent', 'portfolio-agent'];
    }

    // Default: intent + portfolio + market + wallet
    return ['intent-agent', 'portfolio-agent', 'market-agent', 'wallet-agent'];
  }

  /**
   * Orchestrate agents with shared context — sequential collaboration
   * Each agent's result feeds into next
   */
  async orchestrate({ intent, context, sharedContext = null } = {}) {
    const start = Date.now();
    const ctx = sharedContext || this.sharedContext || createSharedContext({ userIntent: intent, conversationState: context });
    const required = this.determineRequiredAgents(intent, context);
    const results = {};
    const errors = [];
    let currentCtx = { ...ctx };

    // Emit AGENT_STARTED
    this.emit('AGENT_ORCHESTRATION_STARTED', { intentId: ctx.intentId, agents: required });

    for (const agentId of required) {
      const agent = this.agents[agentId];
      if (!agent) {
        // Try to load from fallback or skip
        errors.push({ agentId, error: 'AGENT_NOT_FOUND' });
        continue;
      }

      try {
        this.emit('AGENT_STARTED', { agentId, intentId: ctx.intentId });
        
        // Each agent reads shared context but only modifies its own slice
        const agentCtx = {
          ...currentCtx,
          agentId,
          // Provide previous agent results
          previousResults: { ...results }
        };

        let result = null;
        if (typeof agent.handleIntent === 'function') {
          result = await agent.handleIntent(intent, agentCtx);
        } else if (typeof agent.execute === 'function') {
          result = await agent.execute(intent, agentCtx);
        } else if (typeof agent === 'function') {
          result = await agent(intent, agentCtx);
        }

        if (result) {
          results[agentId] = result;
          currentCtx.agentResults[agentId] = result;
          currentCtx.agentsUsed.push(agentId);

          // Collaboration: pass result to next agent
          // e.g., Market Agent → BTC expected scenario → Portfolio Agent → exposure → Risk Agent → impact
          if (result.marketScenario) currentCtx.marketScenario = result.marketScenario;
          if (result.portfolioExposure) currentCtx.portfolioExposure = result.portfolioExposure;
          if (result.riskImpact) currentCtx.riskImpact = result.riskImpact;
          if (result.recommendedAllocation) currentCtx.recommendedAllocation = result.recommendedAllocation;
          if (result.possibleAction) currentCtx.possibleAction = result.possibleAction;
        }

        this.emit('AGENT_COMPLETED', { agentId, intentId: ctx.intentId, ok: true });
      } catch (err) {
        errors.push({ agentId, error: err.message || 'AGENT_FAILED' });
        this.emit('AGENT_COMPLETED', { agentId, intentId: ctx.intentId, ok: false, error: err.message });
        // Try fallback agent if available
        const fallback = this.findFallbackAgent(agentId);
        if (fallback) {
          try {
            const fbResult = await fallback.handleIntent?.(intent, currentCtx);
            if (fbResult) {
              results[`${agentId}_fallback`] = fbResult;
              currentCtx.agentResults[`${agentId}_fallback`] = fbResult;
            }
          } catch {}
        }
      }
    }

    // Aggregate final result
    const final = this.aggregateResults(results, { intent, context: currentCtx });

    this.emit('AGENT_ORCHESTRATION_COMPLETED', {
      intentId: ctx.intentId,
      agentsUsed: Object.keys(results),
      duration: Date.now() - start,
      errors
    });

    return {
      ok: errors.length < required.length, // At least one succeeded
      results,
      aggregated: final,
      agentsUsed: Object.keys(results),
      errors,
      duration: Date.now() - start,
      sharedContext: currentCtx
    };
  }

  aggregateResults(results, { intent, context } = {}) {
    // Combine market + portfolio + risk + strategy into final answer
    const market = results['market-agent'] || results['market'] || {};
    const portfolio = results['portfolio-agent'] || results['portfolio'] || {};
    const risk = results['risk-agent'] || results['risk'] || {};
    const strategy = results['strategy-agent'] || results['strategy'] || {};
    const yieldRes = results['yield-agent'] || {};

    return {
      intent,
      marketScenario: market.scenario || market.expectedScenario || context.marketScenario || null,
      portfolioExposure: portfolio.exposure || portfolio.currentExposure || context.portfolioExposure || null,
      riskImpact: risk.impact || risk.riskImpact || context.riskImpact || null,
      recommendedAllocation: strategy.allocation || strategy.recommendedAllocation || context.recommendedAllocation || null,
      yieldOpportunities: yieldRes.opportunities || null,
      summary: this.buildSummary(results, context),
      raw: results
    };
  }

  buildSummary(results, context) {
    // Build human-readable summary from agent results
    const parts = [];
    if (results['market-agent']?.scenario) parts.push(`Market: ${results['market-agent'].scenario}`);
    if (results['portfolio-agent']?.exposure) parts.push(`Portfolio exposure: ${JSON.stringify(results['portfolio-agent'].exposure)}`);
    if (results['risk-agent']?.impact) parts.push(`Risk impact: ${results['risk-agent'].impact}`);
    if (results['strategy-agent']?.allocation) parts.push(`Strategy: ${results['strategy-agent'].allocation}`);
    return parts.join('\n') || 'Orchestration completed';
  }

  findFallbackAgent(agentId) {
    const fallbacks = {
      'market-agent': this.agents['research-agent'],
      'portfolio-agent': this.agents['wallet-agent'],
      'risk-agent': this.agents['guardian-agent'],
      'yield-agent': this.agents['market-agent']
    };
    return fallbacks[agentId] || null;
  }

  emit(type, payload) {
    try {
      if (this.eventBus?.emit) this.eventBus.emit(type, payload, 'orchestrator-v2');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fbt:ai-event', { detail: { type, payload, source: 'orchestrator-v2' } }));
      }
    } catch {}
  }

  listAgents() {
    return Object.keys(this.agents);
  }
}

// Singleton
let orchestratorInstance = null;
export function getOrchestratorV2(opts = {}) {
  if (!orchestratorInstance) orchestratorInstance = new AgentOrchestratorV2(opts);
  else if (opts.agents) orchestratorInstance.agents = { ...orchestratorInstance.agents, ...opts.agents };
  return orchestratorInstance;
}
