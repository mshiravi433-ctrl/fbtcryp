/**
 * FBT INTENT OS — Market Agent
 */

export const MARKET_AGENT_SCHEMA = 'fbt.market-agent.v1';

export function createMarketAgent({ marketService = null, signalsService = null, smartMoneyService = null, whaleService = null } = {}) {
  return {
    id: 'market-agent',
    schema: MARKET_AGENT_SCHEMA,
    
    async getOverview({ timeframe = '24h' } = {}) {
      try {
        if (marketService?.getOverview) return await marketService.getOverview({ timeframe });
        if (marketService?.getRelevantData) return await marketService.getRelevantData();
        return { ok: true, dataStatus: 'unavailable', overview: null };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },
    
    async analyzeToken({ symbol, chainId = null } = {}) {
      try {
        if (marketService?.getToken) return await marketService.getToken({ symbol, chainId });
        return { ok: true, symbol, dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async getSignals({ asset = null } = {}) {
      try {
        if (signalsService?.list) return await signalsService.list({ asset });
        return { ok: true, signals: [], dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async getSmartMoney({ token = null } = {}) {
      try {
        if (smartMoneyService?.overview) return await smartMoneyService.overview({ token });
        if (smartMoneyService?.track) return await smartMoneyService.track({ token });
        return { ok: true, dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async getWhaleActivity({ token = null, minAmount = null } = {}) {
      try {
        if (whaleService?.track) return await whaleService.track({ token, minAmount });
        return { ok: true, dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const type = intent.type;
      
      if (type === 'MARKET_ANALYSIS' || type === 'MARKET_CONTEXT') {
        const overview = await this.getOverview();
        return { ok: true, market: overview };
      }
      
      if (type === 'SMART_MONEY') {
        const sm = await this.getSmartMoney({ token: intent.entities?.token });
        return { ok: true, smartMoney: sm };
      }
      
      if (type === 'WHALE') {
        const whale = await this.getWhaleActivity({ token: intent.entities?.token });
        return { ok: true, whale };
      }
      
      if (type === 'ANALYZE_TOKEN' && intent.entities?.token) {
        const token = await this.analyzeToken({ symbol: intent.entities.token });
        return { ok: true, token };
      }
      
      return { ok: true, market: await this.getOverview() };
    }
  };
}

export const marketAgent = createMarketAgent();
