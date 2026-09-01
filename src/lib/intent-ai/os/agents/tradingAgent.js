/**
 * FBT INTENT OS — Trading Agent
 */

export const TRADING_AGENT_SCHEMA = 'fbt.trading-agent.v1';

export function createTradingAgent({ swapService = null, bridgeService = null, ordersService = null, eventBus = null } = {}) {
  return {
    id: 'trading-agent',
    schema: TRADING_AGENT_SCHEMA,
    
    async quoteSwap({ fromSymbol, toSymbol, amount, chainId, slippage = 0.5 } = {}) {
      try {
        if (swapService?.getQuote) {
          return await swapService.getQuote({ fromSymbol, toSymbol, amount, chainId, slippage });
        }
        return { ok: false, error: 'NO_SWAP_SERVICE', dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async executeSwap(input) {
      try {
        if (swapService?.execute) return await swapService.execute(input);
        return { ok: false, error: 'NO_SWAP_SERVICE' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async quoteBridge({ fromChain, toChain, token, amount } = {}) {
      try {
        if (bridgeService?.getQuote) return await bridgeService.getQuote({ fromChain, toChain, token, amount });
        return { ok: false, error: 'NO_BRIDGE_SERVICE' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async executeBridge(input) {
      try {
        if (bridgeService?.execute) return await bridgeService.execute(input);
        return { ok: false, error: 'NO_BRIDGE_SERVICE' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const entities = intent.entities || {};
      
      if (intent.type === 'SWAP' || intent.type === 'BUY' || intent.type === 'SELL') {
        const from = entities.fromToken || entities.token || 'USDC';
        const to = entities.toToken || (intent.type === 'BUY' ? entities.token : 'USDC') || 'ETH';
        const amount = entities.amount || entities.amountUsd || '100';
        
        const quote = await this.quoteSwap({
          fromSymbol: from,
          toSymbol: to,
          amount,
          chainId: context.wallet?.chains?.[0] || 42161
        });
        
        return {
          ok: true,
          action: {
            type: intent.type,
            from,
            to,
            amount,
            quote,
            requiresConfirmation: true
          }
        };
      }
      
      if (intent.type === 'BRIDGE') {
        const quote = await this.quoteBridge({
          fromChain: entities.chains?.[0] ? Number(entities.chains[0]) : 56,
          toChain: entities.chains?.[1] ? Number(entities.chains[1]) : 42161,
          token: entities.token || 'USDC',
          amount: entities.amount || '100'
        });
        return { ok: true, action: { type: 'BRIDGE', quote, requiresConfirmation: true } };
      }
      
      return { ok: true };
    }
  };
}

export const tradingAgent = createTradingAgent();
