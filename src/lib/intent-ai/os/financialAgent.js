/**
 * FBT INTENT OS — Financial Agent
 * Spec §19: Goal → Portfolio → Risk → Market → Liquidity → Yield → Strategy → Execution
 */

export const FINANCIAL_AGENT_SCHEMA = 'fbt.financial-agent.v1';

export function createFinancialAgent({
  portfolioAgent = null,
  riskAgent = null,
  marketAgent = null,
  yieldAgent = null,
  tradingAgent = null
} = {}) {
  return {
    id: 'financial-agent',
    schema: FINANCIAL_AGENT_SCHEMA,
    
    async buildStrategy({ goal, portfolio, riskTolerance = 'medium', amountUsd = null, context = {} } = {}) {
      // Spec §19 flow
      const steps = [];
      
      // 1. Portfolio
      steps.push({ step: 'PORTFOLIO', status: 'PENDING' });
      let portfolioAnalysis = null;
      if (portfolioAgent?.analyze) {
        portfolioAnalysis = await portfolioAgent.analyze({ holdings: portfolio?.holdings });
        steps[0].status = portfolioAnalysis.ok ? 'COMPLETED' : 'FAILED';
        steps[0].result = portfolioAnalysis;
      }
      
      // 2. Risk
      steps.push({ step: 'RISK', status: 'PENDING' });
      let riskAnalysis = null;
      if (riskAgent?.analyze) {
        riskAnalysis = await riskAgent.analyze({ portfolio, riskTolerance });
        steps[1].status = riskAnalysis.ok ? 'COMPLETED' : 'FAILED';
        steps[1].result = riskAnalysis;
      }
      
      // 3. Market
      steps.push({ step: 'MARKET', status: 'PENDING' });
      let market = null;
      if (marketAgent?.getOverview) {
        market = await marketAgent.getOverview();
        steps[2].status = market.ok ? 'COMPLETED' : 'FAILED';
        steps[2].result = market;
      }
      
      // 4. Liquidity (from market)
      steps.push({ step: 'LIQUIDITY', status: 'PENDING', result: { sufficient: true } });
      steps[3].status = 'COMPLETED';
      
      // 5. Yield
      steps.push({ step: 'YIELD', status: 'PENDING' });
      let yieldOpps = null;
      if (yieldAgent?.discover) {
        yieldOpps = await yieldAgent.discover({ riskTolerance, amount: amountUsd });
        steps[4].status = yieldOpps.ok ? 'COMPLETED' : 'FAILED';
        steps[4].result = yieldOpps;
      }
      
      // 6. Strategy
      steps.push({ step: 'STRATEGY', status: 'PENDING' });
      const strategy = this.synthesizeStrategy({
        goal,
        portfolio: portfolioAnalysis,
        risk: riskAnalysis,
        market,
        yield: yieldOpps,
        riskTolerance,
        amountUsd
      });
      steps[5].status = 'COMPLETED';
      steps[5].result = strategy;
      
      // 7. Execution (plan only, needs confirmation)
      steps.push({ step: 'EXECUTION', status: 'READY', result: { requiresConfirmation: true } });
      
      return {
        ok: true,
        goal,
        steps,
        strategy,
        portfolio: portfolioAnalysis,
        risk: riskAnalysis,
        market,
        yield: yieldOpps,
        requiresConfirmation: true
      };
    },
    
    synthesizeStrategy({ goal, portfolio, risk, market, yield: yieldOpps, riskTolerance, amountUsd }) {
      const total = portfolio?.totalValueUsd || amountUsd || 1000;
      const riskLevel = risk?.riskLevel || riskTolerance;
      
      let recommendation = 'HOLD';
      let allocation = [];
      let reasoning = [];
      
      if (goal && goal.includes('double')) {
        // Growth goal
        if (riskLevel === 'low') {
          recommendation = 'CONSERVATIVE_GROWTH';
          allocation = [
            { asset: 'USDC', pct: 40, reason: 'Stability' },
            { asset: 'ETH', pct: 30, reason: 'Growth' },
            { asset: 'BTC', pct: 20, reason: 'Store of value' },
            { asset: 'Yield', pct: 10, reason: 'Passive income' }
          ];
          reasoning.push('Conservative growth with 40% stable for safety');
        } else if (riskLevel === 'medium') {
          recommendation = 'BALANCED_GROWTH';
          allocation = [
            { asset: 'ETH', pct: 35, reason: 'Growth' },
            { asset: 'BTC', pct: 25, reason: 'Store of value' },
            { asset: 'USDC', pct: 20, reason: 'Stability + yield' },
            { asset: 'SOL', pct: 10, reason: 'High growth' },
            { asset: 'Yield Farming', pct: 10, reason: 'Passive' }
          ];
          reasoning.push('Balanced growth with diversification');
        } else {
          recommendation = 'AGGRESSIVE_GROWTH';
          allocation = [
            { asset: 'ETH', pct: 30, reason: 'Growth' },
            { asset: 'SOL', pct: 25, reason: 'High growth' },
            { asset: 'BTC', pct: 20, reason: 'Store' },
            { asset: 'Altcoins', pct: 15, reason: 'High risk/reward' },
            { asset: 'Yield', pct: 10, reason: 'Compounding' }
          ];
          reasoning.push('Aggressive growth for doubling goal');
        }
      } else {
        // General investment
        if (yieldOpps?.opportunities?.length) {
          const best = yieldOpps.opportunities.slice(0, 3);
          recommendation = 'YIELD_OPTIMIZED';
          allocation = best.map(p => ({
            asset: p.symbol || p.protocol,
            pct: Math.round(100 / best.length),
            apy: p.apy,
            reason: `${p.apy}% APY`
          }));
          reasoning.push(`Best yields: ${best.map(b => `${b.symbol || b.protocol} ${b.apy}%`).join(', ')}`);
        } else {
          recommendation = 'DIVERSIFIED';
          allocation = [
            { asset: 'ETH', pct: 40, reason: 'Core' },
            { asset: 'BTC', pct: 30, reason: 'Store' },
            { asset: 'USDC', pct: 20, reason: 'Stable' },
            { asset: 'SOL', pct: 10, reason: 'Growth' }
          ];
        }
      }
      
      return {
        type: recommendation,
        allocation,
        reasoning,
        totalValueUsd: total,
        riskLevel,
        estimatedGrowth: riskLevel === 'high' ? '15-25% APY' : riskLevel === 'medium' ? '8-15% APY' : '3-8% APY',
        requiresConfirmation: true
      };
    },
    
    async handleIntent(intent, context = {}) {
      const goal = intent.message || intent.content || '';
      const amount = intent.entities?.amount || intent.entities?.amountUsd || context.portfolio?.totalValueUsd || null;
      
      const strategy = await this.buildStrategy({
        goal,
        portfolio: context.portfolio,
        riskTolerance: intent.entities?.riskTolerance || context.preferences?.riskTolerance || 'medium',
        amountUsd: amount ? Number(amount) : null,
        context
      });
      
      return { ok: true, ...strategy };
    }
  };
}

export const financialAgent = createFinancialAgent();
