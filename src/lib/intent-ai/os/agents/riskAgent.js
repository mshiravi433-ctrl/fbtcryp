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
        
        // This local observation is a concentration check, not a full risk
        // score. Null / missing prices are excluded rather than converted to
        // zero, and the unpriced coverage gap is carried with the result.
        const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
        const valued = holdings.filter((row) => row?.valueUsd != null
          && row.valueUsd !== ''
          && Number.isFinite(Number(row.valueUsd))
          && Number(row.valueUsd) > 0);
        const total = valued.reduce((sum, row) => sum + Number(row.valueUsd), 0);
        const unpricedCount = Math.max(0, holdings.length - valued.length);
        const tokenTotals = new Map();
        for (const row of valued) {
          const symbol = String(row.symbol || '—').toUpperCase();
          tokenTotals.set(symbol, (tokenTotals.get(symbol) || 0) + Number(row.valueUsd));
        }
        const top = [...tokenTotals.entries()].sort((a, b) => b[1] - a[1])[0] || null;
        const concentration = top && total > 0 ? (top[1] / total) * 100 : null;
        const complete = portfolio?.partial !== true
          && portfolio?.dataStatus === 'live'
          && portfolio?.priceDataStatus === 'live'
          && portfolio?.fromSnapshot !== true
          && !(Array.isArray(portfolio?.failedChains) && portfolio.failedChains.length)
          && !(Array.isArray(portfolio?.staleChains) && portfolio.staleChains.length)
          && unpricedCount === 0;
        const dataStatus = !valued.length ? 'unavailable' : complete ? 'live' : 'partial';

        let level = concentration == null ? 'unknown' : 'low';
        const reasons = [];
        if (concentration != null && concentration > 60) {
          level = 'high';
          reasons.push(`Concentration high: ${top[0]} ${concentration.toFixed(1)}% of priced holdings`);
        } else if (concentration != null && concentration > 40) {
          level = 'medium';
          reasons.push(`Concentration medium: ${top[0]} ${concentration.toFixed(1)}% of priced holdings`);
        }
        if (unpricedCount > 0) reasons.push(`${unpricedCount} holding(s) have no valid price; concentration covers priced holdings only`);

        if (action?.amountUsd && total > 0) {
          const actionPct = (Number(action.amountUsd) / total) * 100;
          if (actionPct > 50) {
            level = level === 'low' ? 'medium' : (level === 'unknown' ? 'unknown' : 'high');
            reasons.push(`Action uses about ${actionPct.toFixed(1)}% of priced holdings`);
          }
        }

        return {
          ok: true,
          riskLevel: complete ? level : 'unknown',
          concentrationBand: level,
          concentration,
          concentrationSymbol: top?.[0] || null,
          riskBasis: 'largest-token-share-of-priced-holdings',
          overallRiskScore: null,
          reasons,
          riskTolerance,
          pricedCount: valued.length,
          unpricedCount,
          coverage: holdings.length ? valued.length / holdings.length : 0,
          approved: complete && level !== 'unknown' && (riskTolerance === 'high' || level !== 'high'),
          dataStatus
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
