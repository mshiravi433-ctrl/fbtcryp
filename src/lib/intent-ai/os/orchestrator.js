/**
 * FBT INTENT OS — Multi-Agent Orchestrator (Universal)
 * ---------------------------------------------------------------------------
 * Spec §15 + §16 + §38 Final Architecture
 * Orchestrator picks specialist agents, but user sees only Intent AI
 */

import { resolveToolsForIntent } from './toolRegistry.js';
import { understandIntent } from './intentUnderstanding.js';

export const ORCHESTRATOR_SCHEMA = 'fbt.orchestrator.v1';

// Import agents dynamically to avoid circular deps — will be injected
const AGENT_IDS = Object.freeze([
  'intent-agent',
  'portfolio-agent',
  'market-agent',
  'trading-agent',
  'wallet-agent',
  'yield-agent',
  'research-agent',
  'navigation-agent',
  'media-agent',
  'risk-agent',
  'execution-agent',
  'verification-agent'
]);

export function createOrchestrator({
  agents = {},
  toolRegistry = null,
  contextEngine = null,
  eventBus = null
} = {}) {
  
  // Lazy agent getter
  const getAgent = (id) => {
    if (agents[id]) return agents[id];
    // Try to load from os/agents
    return null;
  };
  
  return {
    id: 'orchestrator',
    schema: ORCHESTRATOR_SCHEMA,
    
    /**
     * Plan: Understand → Retrieve Context → Select Tools → Plan
     */
    async plan({ intent, context = {}, perception = null } = {}) {
      const type = intent.type || 'GENERAL';
      
      // Select relevant tools (hierarchical)
      const tools = toolRegistry?.resolveToolsForIntent
        ? toolRegistry.resolveToolsForIntent(type, context)
        : resolveToolsForIntent(type, context);
      
      // Determine agents needed (Spec §15)
      const agentRouting = await this.routeToAgents(intent, context);
      
      // Build action plan
      const actions = [];
      let expected = null;
      
      // Navigation doesn't need confirmation
      if (type === 'NAVIGATION' || type === 'NEWS_SEARCH') {
        const navTool = tools.find(t => t.id === 'navigation.open');
        if (navTool) {
          actions.push({
            toolId: navTool.id,
            id: navTool.id,
            input: { route: intent.navigation?.route || '/news' },
            requiresConfirmation: false,
            readOnly: true
          });
        }
      } else if (type === 'OPEN_CALM' || type === 'PLAY_MUSIC') {
        const mediaTool = tools.find(t => t.id === 'calm.play');
        const navTool = tools.find(t => t.id === 'navigation.open');
        if (navTool) {
          actions.push({
            toolId: navTool.id,
            id: navTool.id,
            input: { route: '/explore' },
            requiresConfirmation: false,
            readOnly: true
          });
        }
        if (mediaTool) {
          actions.push({
            toolId: mediaTool.id,
            id: mediaTool.id,
            input: { mood: intent.entities?.mood || 'relax', category: 'relaxation' },
            requiresConfirmation: false,
            readOnly: true
          });
        }
      } else if (['PORTFOLIO_ANALYSIS', 'MARKET_ANALYSIS', 'RISK_ANALYSIS', 'WALLET_BALANCE', 'SMART_MONEY', 'WHALE'].includes(type)) {
        // Read-only analysis — collect from agents
        // No executable action, just context gathering
        actions.length = 0;
      } else if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND', 'REBALANCE', 'FARM', 'LEND', 'DCA', 'GOAL'].includes(type)) {
        // Financial — needs quote + confirmation
        const tradingTools = tools.filter(t => !t.readOnly && t.requiresConfirmation);
        const primary = tradingTools[0] || tools[0];
        
        if (primary) {
          const input = this.buildInputFromIntent(intent, context, primary);
          actions.push({
            toolId: primary.id,
            id: primary.id,
            input,
            requiresConfirmation: primary.requiresConfirmation,
            readOnly: primary.readOnly,
            expected: input
          });
          expected = input;
        }
      } else if (type === 'INVESTMENT_PLAN') {
        // Multi-agent: Portfolio → Market → Yield → Risk → Research → Strategy
        // For now, just yield discovery + portfolio analysis
        const yieldTool = tools.find(t => t.id === 'yield.discover');
        if (yieldTool) {
          actions.push({
            toolId: yieldTool.id,
            id: yieldTool.id,
            input: {
              asset: intent.entities?.token || null,
              riskTolerance: intent.entities?.riskTolerance || 'medium',
              amount: intent.entities?.amount || intent.entities?.amountUsd || null
            },
            requiresConfirmation: false,
            readOnly: true
          });
        }
      }
      
      const requiresConfirmation = actions.some(a => a.requiresConfirmation);
      const readOnly = actions.length === 0 || actions.every(a => a.readOnly);
      
      return {
        ok: true,
        intent,
        tools,
        agents: agentRouting.agents,
        actions,
        expected,
        requiresConfirmation,
        readOnly,
        context,
        planId: `plan_${Date.now().toString(36)}`,
        createdAt: Date.now()
      };
    },
    
    async routeToAgents(intent, context) {
      const type = intent.type;
      const agentsList = ['intent-agent'];
      
      if (['PORTFOLIO_ANALYSIS', 'REBALANCE'].includes(type)) {
        agentsList.push('portfolio-agent', 'risk-agent', 'market-agent');
      } else if (['MARKET_ANALYSIS', 'MARKET_CONTEXT'].includes(type)) {
        agentsList.push('market-agent', 'research-agent', 'risk-agent');
      } else if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) {
        agentsList.push('yield-agent', 'risk-agent', 'portfolio-agent');
      } else if (['INVESTMENT_PLAN', 'GOAL'].includes(type)) {
        agentsList.push('portfolio-agent', 'market-agent', 'yield-agent', 'risk-agent', 'research-agent');
      } else if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND', 'DCA'].includes(type)) {
        agentsList.push('trading-agent', 'wallet-agent', 'risk-agent', 'execution-agent', 'verification-agent');
      } else if (['NEWS_SEARCH'].includes(type)) {
        agentsList.push('research-agent', 'navigation-agent');
      } else if (['OPEN_CALM', 'PLAY_MUSIC'].includes(type)) {
        agentsList.push('media-agent', 'navigation-agent');
      } else if (['NAVIGATION'].includes(type)) {
        agentsList.push('navigation-agent');
      } else if (['WALLET_BALANCE'].includes(type)) {
        agentsList.push('wallet-agent', 'portfolio-agent');
      } else if (['SMART_MONEY', 'WHALE'].includes(type)) {
        agentsList.push('market-agent');
      } else {
        agentsList.push('wallet-agent', 'portfolio-agent', 'market-agent');
      }
      
      return { agents: [...new Set(agentsList)], intentType: type };
    },
    
    buildInputFromIntent(intent, context, tool) {
      const entities = intent.entities || {};
      const input = {};
      
      if (tool.inputSchema?.properties) {
        for (const key of Object.keys(tool.inputSchema.properties)) {
          if (key === 'fromSymbol' && entities.fromToken) input[key] = entities.fromToken;
          if (key === 'toSymbol' && entities.toToken) input[key] = entities.toToken;
          if (key === 'amount' && entities.amount) input[key] = entities.amount;
          if (key === 'token' && entities.token) input[key] = entities.token;
          if (key === 'asset' && (entities.token || entities.amountSymbol)) input[key] = entities.token || entities.amountSymbol;
          if (key === 'chainId' && context.wallet?.chains?.[0]) input[key] = context.wallet.chains[0];
          if (key === 'riskTolerance' && entities.riskTolerance) input[key] = entities.riskTolerance;
        }
      }
      
      // Fill from entities directly if no schema match
      if (entities.fromToken) input.fromSymbol = entities.fromToken;
      if (entities.toToken) input.toSymbol = entities.toToken;
      if (entities.amount) input.amount = entities.amount;
      if (entities.token && !input.token) input.token = entities.token;
      if (entities.amountUsd && !input.amount) input.amount = entities.amountUsd;
      
      return input;
    },
    
    async isComplete({ intent, plan, result, context } = {}) {
      if (!result) return false;
      if (result.ok === false) return true; // Failed tasks are complete
      if (plan.actions?.length === 0) return true; // Analysis tasks
      if (result.status === 'CONFIRMED' || result.success === true) return true;
      return false;
    },
    
    async replan({ intent, context, previousResult } = {}) {
      // For multi-step tasks
      return this.plan({ intent, context });
    },
    
    async heal({ error, plan, context } = {}) {
      // Self-healing: try alternative tool
      const tools = plan.tools || [];
      const failedToolId = plan.actions?.[0]?.toolId;
      const alternatives = tools.filter(t => t.id !== failedToolId && t.category === (plan.tools?.[0]?.category));
      
      if (alternatives.length) {
        const alt = alternatives[0];
        return {
          ok: true,
          plan: {
            ...plan,
            actions: [{ toolId: alt.id, input: plan.actions[0]?.input, requiresConfirmation: alt.requiresConfirmation }]
          },
          healed: true,
          alternative: alt.id
        };
      }
      
      return { ok: false, error: 'NO_ALTERNATIVE' };
    },
    
    listAgents() {
      return [...AGENT_IDS];
    }
  };
}

export const orchestrator = createOrchestrator();
