/**
 * FBT INTENT OS — Intent Agent (top-level)
 * Parses, understands, routes
 */

import { understandIntent } from '../intentUnderstanding.js';

export const INTENT_AGENT_SCHEMA = 'fbt.intent-agent.v1';

export function createIntentAgent() {
  return {
    id: 'intent-agent',
    schema: INTENT_AGENT_SCHEMA,
    
    async perceive({ message, context = {} } = {}) {
      // PERCEIVE: get raw input + current context
      return {
        message: String(message || '').trim(),
        context,
        timestamp: Date.now(),
        currentPage: context.currentPage || '/',
        hasWallet: Boolean(context.wallet?.connected)
      };
    },
    
    async understand({ message, context = {} } = {}) {
      // UNDERSTAND: extract intent
      const intent = understandIntent(message, context);
      return intent;
    },
    
    async route(intent) {
      // Determine which specialist agents needed
      const type = intent.type;
      
      const routing = {
        agents: ['intent-agent'],
        tools: [],
        requiresWallet: intent.requiresWallet || false,
        readOnly: intent.readOnly || false
      };
      
      if (['PORTFOLIO_ANALYSIS', 'REBALANCE'].includes(type)) {
        routing.agents.push('portfolio-agent', 'risk-agent', 'market-agent');
      } else if (['MARKET_ANALYSIS', 'MARKET_CONTEXT', 'ANALYZE_TOKEN'].includes(type)) {
        routing.agents.push('market-agent', 'research-agent');
      } else if (['SMART_MONEY', 'WHALE'].includes(type)) {
        routing.agents.push('market-agent');
      } else if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'].includes(type)) {
        routing.agents.push('trading-agent', 'wallet-agent', 'risk-agent');
      } else if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) {
        routing.agents.push('yield-agent', 'risk-agent', 'portfolio-agent');
      } else if (['INVESTMENT_PLAN', 'GOAL', 'DCA'].includes(type)) {
        routing.agents.push('portfolio-agent', 'market-agent', 'yield-agent', 'risk-agent', 'research-agent');
      } else if (['NEWS_SEARCH'].includes(type)) {
        routing.agents.push('research-agent', 'navigation-agent');
      } else if (['OPEN_CALM', 'PLAY_MUSIC'].includes(type)) {
        routing.agents.push('media-agent', 'navigation-agent');
      } else if (['NAVIGATION', 'ORDERS', 'WALLET_BALANCE'].includes(type)) {
        routing.agents.push('navigation-agent', 'wallet-agent');
      } else if (['EXECUTE_CURRENT', 'CONTINUE'].includes(type)) {
        routing.agents.push('execution-agent');
      }
      
      return routing;
    }
  };
}

export const intentAgent = createIntentAgent();
