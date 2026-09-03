/**
 * FBT INTENT OS — Multi-Agent Orchestrator (Universal)
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Multi-Agent Reasoning
 * Orchestrator picks specialist agents, but user sees only Intent AI
 */

import { resolveToolsForIntent } from './toolRegistry.js';
import { understandIntent } from './intentUnderstanding.js';

export const ORCHESTRATOR_SCHEMA = 'fbt.orchestrator.v3';

// Full specialized agent list
const AGENT_IDS = Object.freeze([
  'intent-agent',
  'market-agent',
  'portfolio-agent',
  'risk-agent',
  'strategy-agent',
  'execution-agent',
  'verification-agent',
  'guardian-agent',
  'trading-agent',
  'wallet-agent',
  'yield-agent',
  'research-agent',
  'navigation-agent',
  'media-agent',
  'financial-agent'
]);

export function createOrchestrator({
  agents = {},
  toolRegistry = null,
  contextEngine = null,
  eventBus = null,
  aiGateway = null
} = {}) {
  
  const getAgent = (id) => {
    if (agents[id]) return agents[id];
    return null;
  };
  
  return {
    id: 'orchestrator',
    schema: ORCHESTRATOR_SCHEMA,
    
    /**
     * Plan: Understand → Retrieve Context → Multi-Agent Routing → Tool Selection → Action Plan
     */
    async plan({ intent, context = {}, perception = null } = {}) {
      const type = intent.type || 'GENERAL';
      
      // Select relevant tools
      const tools = toolRegistry?.resolveToolsForIntent
        ? toolRegistry.resolveToolsForIntent(type, context)
        : resolveToolsForIntent(type, context);
      
      // Determine agents needed
      const agentRouting = await this.routeToAgents(intent, context);
      
      // Build action plan
      const actions = [];
      let expected = null;
      
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
      } else if (['PORTFOLIO_ANALYSIS', 'MARKET_ANALYSIS', 'RISK_ANALYSIS', 'WALLET_BALANCE', 'SMART_MONEY', 'WHALE', 'YIELD_DISCOVERY', 'ANALYZE_TOKEN', 'FARM', 'LEND', 'STAKING'].includes(type)) {
        actions.length = 0;
      } else if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND', 'REBALANCE', 'DCA', 'GOAL'].includes(type)) {
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
        const yieldTool = tools.find(t => t.id === 'yield.discover');
        if (yieldTool) {
          actions.push({
            toolId: yieldTool.id,
            id: yieldTool.id,
            input: {
              asset: intent.entities?.token || null,
              riskTolerance: intent.financialParams?.riskPreference || intent.entities?.riskTolerance || 'medium',
              amount: intent.financialParams?.capital || intent.entities?.amount || intent.entities?.amountUsd || null
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
        agentsList.push('portfolio-agent', 'risk-agent', 'market-agent', 'strategy-agent');
      } else if (['MARKET_ANALYSIS', 'MARKET_CONTEXT'].includes(type)) {
        agentsList.push('market-agent', 'research-agent', 'risk-agent');
      } else if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) {
        agentsList.push('yield-agent', 'risk-agent', 'portfolio-agent', 'strategy-agent');
      } else if (['INVESTMENT_PLAN', 'GOAL'].includes(type)) {
        agentsList.push('portfolio-agent', 'market-agent', 'yield-agent', 'risk-agent', 'strategy-agent', 'research-agent');
      } else if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND', 'DCA'].includes(type)) {
        agentsList.push('trading-agent', 'wallet-agent', 'risk-agent', 'guardian-agent', 'execution-agent', 'verification-agent');
      } else if (['NEWS_SEARCH'].includes(type)) {
        agentsList.push('research-agent', 'navigation-agent');
      } else if (['OPEN_CALM', 'PLAY_MUSIC'].includes(type)) {
        agentsList.push('media-agent', 'navigation-agent');
      } else if (['NAVIGATION', 'SIGNALS', 'STOCKS', 'HORIZON', 'FOREX', 'RWA', 'P2P', 'DYDX', 'FUTURES', 'ORDERS', 'BTC_WALLET', 'ADD_TOKEN', 'NOTIFICATIONS', 'SETTINGS', 'REWARDS', 'INTENT_OS', 'WALLET_CONNECT', 'WALLET_DISCONNECT', 'SWITCH_NETWORK', 'BORROW'].includes(type)) {
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
      const fp = intent.financialParams || {};
      const input = {};
      
      if (tool.inputSchema?.properties) {
        for (const key of Object.keys(tool.inputSchema.properties)) {
          if (key === 'fromSymbol' && (entities.fromToken || entities.token)) input[key] = entities.fromToken || entities.token;
          if (key === 'toSymbol' && entities.toToken) input[key] = entities.toToken;
          if (key === 'amount' && (fp.capital || entities.amount)) input[key] = fp.capital || entities.amount;
          if (key === 'token' && entities.token) input[key] = entities.token;
          if (key === 'asset' && (entities.token || entities.amountSymbol)) input[key] = entities.token || entities.amountSymbol;
          if (key === 'chainId' && context.wallet?.chains?.[0]) input[key] = context.wallet.chains[0];
          if (key === 'riskTolerance' && (fp.riskPreference || entities.riskTolerance)) input[key] = fp.riskPreference || entities.riskTolerance;
        }
      }
      
      if (entities.fromToken) input.fromSymbol = entities.fromToken;
      if (entities.toToken) input.toSymbol = entities.toToken;
      if (fp.capital || entities.amount) input.amount = fp.capital || entities.amount;
      if (entities.token && !input.token) input.token = entities.token;
      if (entities.amountUsd && !input.amount) input.amount = entities.amountUsd;
      
      return input;
    },
    
    async isComplete({ intent, plan, result, context } = {}) {
      if (!result) return false;
      if (result.ok === false) return true;
      if (plan.actions?.length === 0) return true;
      if (result.status === 'CONFIRMED' || result.success === true) return true;
      return false;
    },
    
    async replan({ intent, context, previousResult } = {}) {
      return this.plan({ intent, context });
    },
    
    async heal({ error, plan, context } = {}) {
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
