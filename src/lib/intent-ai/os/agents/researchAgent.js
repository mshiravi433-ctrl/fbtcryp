/**
 * FBT INTENT OS — Research Agent
 */

export const RESEARCH_AGENT_SCHEMA = 'fbt.research-agent.v1';

export function createResearchAgent({ newsService = null, marketService = null } = {}) {
  return {
    id: 'research-agent',
    schema: RESEARCH_AGENT_SCHEMA,
    
    async searchNews({ query = 'crypto', category = null, limit = 10 } = {}) {
      try {
        if (newsService?.search) return await newsService.search({ query, category, limit });
        if (newsService?.list) return await newsService.list({ limit });
        return { ok: true, news: [], dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },
    
    async marketResearch({ topic = null } = {}) {
      try {
        if (marketService?.getResearch) return await marketService.getResearch({ topic });
        return { ok: true, dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async handleIntent(intent, context = {}) {
      if (intent.type === 'NEWS_SEARCH') {
        const query = intent.entities?.query || intent.message || 'crypto';
        const news = await this.searchNews({ query });
        return { ok: true, news };
      }
      
      if (intent.type === 'MARKET_CONTEXT' || intent.type === 'MARKET_ANALYSIS') {
        const news = await this.searchNews({ query: 'market' });
        const research = await this.marketResearch({ topic: intent.entities?.token || null });
        return { ok: true, news, research };
      }
      
      return { ok: true };
    }
  };
}

export const researchAgent = createResearchAgent();
