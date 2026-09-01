/**
 * FBT INTENT OS — Risk Agent
 */

export const RISK_AGENT_SCHEMA = 'fbt.risk-agent.v1';

export function createRiskAgent({ riskService = null } = {}) {
  return {
    id: 'risk-agent',
    schema: RISK_AGENT_SCHEMA,
    
    async analyze({ portfolio = null, action = null, riskTolerance = 'medium' } = {}) {
      try {
        if (riskService?.analyze) return await riskService.analyze({ portfolio, action, riskTolerance });
        
        // Local risk analysis
        const holdings = portfolio?.holdings || [];
        const total = holdings.reduce((s, h) => s + (Number(h.valueUsd) || 0), 0);
        const sorted = [...holdings].sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
        const top = sorted[0];
        const concentration = top ? (top.valueUsd / total) * 100 : 0;
        
        let level = 'low';
        let reasons = [];
        
        if (concentration > 60) {
          level = 'high';
          reasons.push(`Concentration high: ${top.symbol} ${concentration.toFixed(1)}%`);
        } else if (concentration > 40) {
          level = 'medium';
          reasons.push(`Concentration medium: ${top.symbol} ${concentration.toFixed(1)}%`);
        }
        
        if (action?.amountUsd && total) {
          const pct = (Number(action.amountUsd) / total) * 100;
          if (pct > 50) {
            level = level === 'low' ? 'medium' : 'high';
            reasons.push(`Action uses ${pct.toFixed(1)}% of portfolio`);
          }
        }
        
        return {
          ok: true,
          riskLevel: level,
          concentration,
          reasons,
          riskTolerance,
          approved: riskTolerance === 'high' ? true : level !== 'high',
          dataStatus: 'live'
        };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const riskTolerance = intent.entities?.riskTolerance || context.preferences?.riskTolerance || 'medium';
      const analysis = await this.analyze({
        portfolio: context.portfolio,
        action: intent.action || null,
        riskTolerance
      });
      return { ok: true, risk: analysis };
    }
  };
}

export const riskAgent = createRiskAgent();
