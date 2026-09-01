/**
 * FBT INTENT OS — Proactive Agent
 * Spec §18: AI should be proactive, not just waiting
 * If user has active goal and market changes, create opportunity
 * But proposal ≠ auto execution
 */

export const PROACTIVE_SCHEMA = 'fbt.proactive.v1';

export function createProactiveAgent({ marketService = null, portfolioService = null, eventBus = null } = {}) {
  const opportunities = [];
  
  return {
    id: 'proactive-agent',
    schema: PROACTIVE_SCHEMA,
    
    async checkOpportunities({ portfolio, goals = [], market = {}, preferences = {} } = {}) {
      const found = [];
      const total = portfolio?.totalValueUsd || 0;
      
      // If goal is active and market drops, suggest buying
      if (goals.length && market.change24hPct != null && market.change24hPct < -5) {
        found.push({
          id: `opp_${Date.now()}_dip`,
          type: 'MARKET_DIP',
          title: 'فرصت خرید در افت بازار',
          description: `بازار ${Math.abs(market.change24hPct).toFixed(1)}% افت کرده — فرصت مناسبی برای خرید است`,
          suggestedAction: 'BUY',
          asset: 'ETH',
          reason: 'Market dip',
          requiresConfirmation: true,
          createdAt: Date.now()
        });
      }
      
      // If portfolio concentration high, suggest rebalance
      if (portfolio?.holdings?.length) {
        const sorted = [...portfolio.holdings].sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
        const top = sorted[0];
        if (top && total && (top.valueUsd / total) > 0.6) {
          found.push({
            id: `opp_${Date.now()}_concent`,
            type: 'REBALANCE_NEEDED',
            title: 'تمرکز بالا در پرتفوی',
            description: `${top.symbol} بیش از 60% پرتفوی شماست — متعادل‌سازی پیشنهاد می‌شود`,
            suggestedAction: 'REBALANCE',
            reason: 'High concentration',
            requiresConfirmation: true,
            createdAt: Date.now()
          });
        }
      }
      
      // If idle stablecoins, suggest yield
      if (portfolio?.holdings?.length) {
        const stables = portfolio.holdings.filter(h => ['USDC', 'USDT', 'DAI'].includes(h.symbol) && (h.valueUsd || 0) > 100);
        if (stables.length && stables.reduce((s, h) => s + (h.valueUsd || 0), 0) > 500) {
          found.push({
            id: `opp_${Date.now()}_yield`,
            type: 'YIELD_OPPORTUNITY',
            title: 'سود بیشتر برای استیبل‌کوین‌ها',
            description: `${stables.reduce((s, h) => s + (h.valueUsd || 0), 0).toFixed(0)} دلار استیبل بیکار دارید — می‌تواند سود بسازد`,
            suggestedAction: 'YIELD_DISCOVERY',
            reason: 'Idle stables',
            requiresConfirmation: false,
            createdAt: Date.now()
          });
        }
      }
      
      opportunities.push(...found);
      if (opportunities.length > 20) opportunities.splice(0, opportunities.length - 20);
      
      // Emit events for each (proactive but not auto-executing)
      if (eventBus?.emit) {
        for (const opp of found) {
          eventBus.emit('opportunity.detected', opp, 'proactive-agent');
        }
      }
      
      return found;
    },
    
    getOpportunities({ limit = 5 } = {}) {
      return opportunities.slice(-limit).reverse();
    },
    
    clearOpportunities() {
      opportunities.length = 0;
    }
  };
}

export const proactiveAgent = createProactiveAgent();
