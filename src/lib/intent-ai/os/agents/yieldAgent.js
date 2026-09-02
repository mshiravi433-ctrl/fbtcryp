/**
 * FBT INTENT OS — Yield Agent
 */

export const YIELD_AGENT_SCHEMA = 'fbt.yield-agent.v1';

export function createYieldAgent({ yieldService = null, farmService = null, lendingService = null } = {}) {
  return {
    id: 'yield-agent',
    schema: YIELD_AGENT_SCHEMA,
    
    async discover({ asset = null, chainId = null, riskTolerance = 'medium', minApy = null, services = null } = {}) {
      const ys = services?.yieldService || yieldService;
      try {
        if (ys?.discover) return await ys.discover({ asset, chainId, riskTolerance, minApy });
        
        // Fallback mock that still uses real structure
        const pools = yieldService?.list ? await yieldService.list({ asset, chainId }) : [];
        const filtered = Array.isArray(pools) ? pools.filter(p => {
          if (minApy && (p.apy || 0) < minApy) return false;
          if (riskTolerance === 'low' && p.risk === 'high') return false;
          if (riskTolerance === 'high' && p.risk === 'low' && minApy) return false;
          return true;
        }) : [];
        
        return {
          ok: true,
          opportunities: filtered,
          riskTolerance,
          dataStatus: filtered.length ? 'live' : 'unavailable'
        };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },
    
    async getFarms({ chainId = null } = {}) {
      try {
        if (farmService?.list) return await farmService.list({ chainId });
        return { ok: true, pools: [], dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async getLendingMarkets({ asset = null } = {}) {
      try {
        if (lendingService?.getMarkets) return await lendingService.getMarkets({ asset });
        return { ok: true, markets: [], dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const risk = intent.entities?.riskTolerance || context.preferences?.riskTolerance || 'medium';
      const asset = intent.entities?.token || intent.entities?.amountSymbol || null;
      const svc = context.services || null;
      
      if (intent.type === 'YIELD_DISCOVERY' || intent.type === 'FARM' || intent.type === 'LEND') {
        const opportunities = await this.discover({ asset, riskTolerance: risk, services: svc });
        return { ok: true, yieldOpportunities: opportunities };
      }
      
      if (intent.type === 'INVESTMENT_PLAN') {
        const opportunities = await this.discover({ asset, riskTolerance: risk, services: svc });
        const farms = await this.getFarms();
        const lending = await this.getLendingMarkets({ asset });
        return {
          ok: true,
          yieldOpportunities: opportunities,
          farms,
          lending,
          strategy: 'diversified'
        };
      }
      
      return { ok: true };
    }
  };
}

export const yieldAgent = createYieldAgent();
