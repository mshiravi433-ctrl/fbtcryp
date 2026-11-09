/**
 * FBT INTENT OS — Research Agent
 * Evidence retrieval for market context and ticker-specific questions.
 */

export const RESEARCH_AGENT_SCHEMA = 'fbt.research-agent.v1';

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'what', 'when', 'where', 'why', 'how', 'is', 'are', 'was', 'were', 'today', 'price', 'market', 'چرا', 'چه', 'چطور', 'امروز', 'بازار', 'قیمت']);
const textOf = (row) => [row?.title, row?.headline, row?.summary, row?.description, row?.content, row?.source]
  .filter((value) => typeof value === 'string').join(' ').toLowerCase();

function rankRelevantNews(rows, query, limit) {
  const terms = String(query || '').toLowerCase().match(/[a-z0-9]{2,}|[\u0600-\u06ff]{2,}/g) || [];
  const needles = [...new Set(terms.filter((term) => !STOPWORDS.has(term)))];
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, score: needles.reduce((score, term) => score + (textOf(row).includes(term) ? 1 : 0), 0) }))
    .filter(({ score }) => needles.length === 0 || score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => row);
}

export function createResearchAgent({ newsService = null, marketService = null } = {}) {
  return {
    id: 'research-agent',
    schema: RESEARCH_AGENT_SCHEMA,

    async searchNews({ query = 'crypto', category = null, limit = 10 } = {}) {
      try {
        const response = newsService?.search
          ? await newsService.search({ query, category, limit })
          : newsService?.list
            ? await newsService.list({ limit: Math.max(limit, 30) })
            : { ok: true, news: [], dataStatus: 'unavailable' };
        const rows = response?.news || response?.items || [];
        const news = rankRelevantNews(rows, query, limit);
        return {
          ...response,
          news,
          query,
          dataStatus: response?.dataStatus === 'unavailable' ? 'unavailable' : news.length ? 'live' : 'empty'
        };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },

    async marketResearch({ topic = null } = {}) {
      try {
        if (marketService?.getResearch) return await marketService.getResearch({ topic });
        return { ok: true, dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },

    async handleIntent(intent, context = {}) {
      if (intent.type === 'NEWS_SEARCH') {
        const query = intent.entities?.query || intent.message || intent.raw || 'crypto';
        const news = await this.searchNews({ query });
        return { ok: true, news };
      }

      if (intent.type === 'MARKET_CONTEXT' || intent.type === 'MARKET_ANALYSIS') {
        const specificQuestion = intent.questionFrame === 'WHY_MARKET_MOVE';
        const query = String(intent.raw || context.lastMessage || 'market').slice(0, 240);
        const topic = specificQuestion
          ? `${intent.entities?.token || ''} ${query}`.trim()
          : intent.entities?.token || query;
        const [news, research] = await Promise.all([
          this.searchNews({ query: specificQuestion ? query : (intent.entities?.token || 'crypto market') }),
          this.marketResearch({ topic })
        ]);
        return { ok: true, news, research, researchQuery: specificQuestion ? query : null };
      }

      return { ok: true };
    }
  };
}

export const researchAgent = createResearchAgent();
