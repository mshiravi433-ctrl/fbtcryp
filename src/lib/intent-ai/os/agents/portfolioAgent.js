/**
 * FBT INTENT OS — Portfolio Agent
 */

export const PORTFOLIO_AGENT_SCHEMA = 'fbt.portfolio-agent.v1';

export function createPortfolioAgent({ portfolioService = null, riskService = null, marketService = null, eventBus = null } = {}) {
  return {
    id: 'portfolio-agent',
    schema: PORTFOLIO_AGENT_SCHEMA,
    
    async analyze({ wallet, holdings = null, detailed = true } = {}) {
      const portfolio = holdings ? { holdings } : (wallet?.portfolio || null);
      
      if (!portfolio || !portfolio.holdings?.length) {
        return {
          ok: false,
          error: 'EMPTY_PORTFOLIO',
          dataStatus: 'unavailable',
          message: 'پرتفوی خالی است یا خوانده نشده'
        };
      }
      
      try {
        // Real service if available
        if (portfolioService?.analyze) {
          const result = await portfolioService.analyze({ holdings: portfolio.holdings, detailed });
          if (result?.ok !== false) return result;
        }
        
        // Fallback local analysis
        const total = portfolio.holdings.reduce((s, h) => s + (Number(h.valueUsd) || 0), 0);
        const sorted = [...portfolio.holdings].sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
        const largest = sorted[0];
        const allocation = sorted.map(h => ({
          symbol: h.symbol,
          pct: total > 0 ? (h.valueUsd / total) * 100 : 0,
          valueUsd: h.valueUsd
        }));
        
        // Risk: concentration
        const concentration = largest ? (largest.valueUsd / total) * 100 : 0;
        const riskLevel = concentration > 60 ? 'high' : concentration > 40 ? 'medium' : 'low';
        
        return {
          ok: true,
          totalValueUsd: total,
          holdings: portfolio.holdings,
          allocation,
          largest,
          concentration,
          riskLevel,
          dataStatus: 'live',
          suggestions: concentration > 50 ? ['Consider rebalancing to reduce concentration'] : []
        };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },
    
    async planRebalance({ holdings, target = null, riskTolerance = 'medium' } = {}) {
      try {
        if (portfolioService?.planRebalance) {
          return await portfolioService.planRebalance({ holdings, target, riskTolerance });
        }
        
        // Simple rebalance: equal weight if no target
        const total = holdings.reduce((s, h) => s + (Number(h.valueUsd) || 0), 0);
        const targetAlloc = target || holdings.map(h => ({
          symbol: h.symbol,
          pct: 100 / holdings.length
        }));
        
        const trades = [];
        for (const t of targetAlloc) {
          const current = holdings.find(h => h.symbol === t.symbol);
          const currentPct = current ? (current.valueUsd / total) * 100 : 0;
          const diff = t.pct - currentPct;
          if (Math.abs(diff) > 5) {
            trades.push({
              symbol: t.symbol,
              side: diff > 0 ? 'buy' : 'sell',
              amountUsd: Math.abs(diff) * total / 100,
              fromPct: currentPct,
              toPct: t.pct
            });
          }
        }
        
        return {
          ok: true,
          current: holdings.map(h => ({ symbol: h.symbol, pct: (h.valueUsd / total) * 100 })),
          target: targetAlloc,
          trades,
          tradeCount: trades.length,
          totalValueUsd: total
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const wallet = context.wallet;
      const portfolio = context.portfolio;
      
      if (intent.type === 'PORTFOLIO_ANALYSIS') {
        const analysis = await this.analyze({ wallet, holdings: portfolio?.holdings });
        return { ok: true, analysis, portfolio };
      }
      
      if (intent.type === 'REBALANCE') {
        const plan = await this.planRebalance({ holdings: portfolio?.holdings || [], riskTolerance: intent.entities?.riskTolerance || 'medium' });
        return { ok: true, rebalancePlan: plan };
      }
      
      return { ok: true, portfolio };
    }
  };
}

export const portfolioAgent = createPortfolioAgent();
