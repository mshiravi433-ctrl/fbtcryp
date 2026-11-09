import { describe, expect, it } from 'vitest';
import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import { createOrchestrator } from '../../src/lib/intent-ai/os/orchestrator.js';
import { executeIntentTools } from '../../src/lib/intent-ai/os/toolExecutor.js';
import { buildHumanResponse } from '../../src/lib/intent-ai/os/humanResponse.js';
import { createResearchAgent } from '../../src/lib/intent-ai/os/agents/researchAgent.js';

describe('natural-language question frames', () => {
  it('routes explain-why market questions to market analysis with the ticker retained', () => {
    const result = understandIntent('Can you explain why BTC dropped today?');
    expect(result.type).toBe('MARKET_ANALYSIS');
    expect(result.entities.token).toBe('BTC');
    expect(result.matched.some((row) => row.questionFrame === 'WHY_MARKET_MOVE')).toBe(true);
  });

  it('keeps multi-asset comparison targets together instead of treating them as a swap pair', () => {
    const result = understandIntent('Compare BTC and ETH for a long-term portfolio');
    expect(result.type).toBe('ANALYZE_TOKEN');
    expect(result.entities.analysisMode).toBe('COMPARISON');
    expect(result.entities.comparisonTokens).toEqual(['BTC', 'ETH']);
  });

  it('executes a read-only comparison against real token-detail adapters and answers from returned data', async () => {
    const intent = understandIntent('Compare BTC and ETH');
    const queried = [];
    const tools = await executeIntentTools({
      intent,
      services: { marketService: {
        getOverview: async () => ({ ok: true, dataStatus: 'live', markets: [] }),
        getToken: async ({ symbol }) => {
          queried.push(symbol);
          return symbol === 'BTC'
            ? { ok: true, dataStatus: 'live', symbol, priceUsd: 60000, change24hPct: 2, rank: 1 }
            : { ok: true, dataStatus: 'live', symbol, priceUsd: 3000, change24hPct: -1, rank: 2 };
        }
      } }
    });
    expect(queried.sort()).toEqual(['BTC', 'ETH']);
    const answer = buildHumanResponse({ intent, results: tools.data, locale: 'en' });
    expect(answer.message).toContain('BTC: price: $60,000');
    expect(answer.message).toContain('ETH: price: $3,000');
    expect(answer.message).toContain('not a forecast or guarantee');
  });

  it('turns a why-market question into a targeted research query and only surfaces matching leads', async () => {
    const intent = understandIntent('Can you explain why BTC dropped today?');
    const seen = { query: null, topic: null };
    const researcher = createResearchAgent({
      newsService: { list: async ({ limit }) => ({ ok: true, dataStatus: 'live', news: [
        { title: 'BTC exchange outflows rise as spot demand shifts', source: 'Fixture A', url: 'https://example.test/a' },
        { title: 'SOL ecosystem launches a new game', source: 'Fixture B', url: 'https://example.test/b' }
      ].slice(0, limit) }) },
      marketService: { getResearch: async ({ topic }) => { seen.topic = topic; return { ok: true, summary: 'fixture summary' }; } }
    });
    const originalSearch = researcher.searchNews.bind(researcher);
    researcher.searchNews = async (args) => { seen.query = args.query; return originalSearch(args); };
    const result = await researcher.handleIntent(intent, {});
    expect(seen.query).toContain('BTC');
    expect(seen.topic).toContain('BTC');
    expect(result.news.news).toHaveLength(1);
    const answer = buildHumanResponse({ intent, results: {
      token: { ok: true, dataStatus: 'live', symbol: 'BTC', priceUsd: 60000, change24hPct: -2 },
      news: result.news
    }, locale: 'en' });
    expect(answer.message).toContain('BTC exchange outflows');
    expect(answer.message).toContain('not proof of causation');
    expect(answer.message).not.toContain('SOL ecosystem');
  });

  it('uses question frames to select specialists and carries answer guidance into the plan', async () => {
    const orchestrator = createOrchestrator();
    const explain = understandIntent('What does impermanent loss mean?');
    const compare = understandIntent('Compare BTC and ETH');
    const explainAgents = await orchestrator.routeToAgents(explain, {});
    const compareAgents = await orchestrator.routeToAgents(compare, {});
    expect(explainAgents.agents).toContain('research-agent');
    expect(explainAgents.agents).not.toContain('wallet-agent');
    expect(compareAgents.agents).toEqual(expect.arrayContaining(['market-agent', 'risk-agent', 'research-agent']));
    const plan = await orchestrator.plan({ intent: explain, context: {} });
    expect(plan).toMatchObject({ questionFrame: 'EXPLANATION', answerGuidance: 'PLAIN_LANGUAGE_WITH_EXAMPLE' });
  });

  it('understands risk-ranked comparisons and single-asset investment questions', () => {
    const safer = understandIntent('ETH از BTC امن‌تره؟');
    expect(safer.type).toBe('ANALYZE_TOKEN');
    expect(safer.entities.analysisMode).toBe('COMPARISON');
    expect(safer.entities.comparisonTokens).toEqual(['ETH', 'BTC']);
    expect(safer.entities.comparisonCriteria).toEqual(['risk']);
    const riskData = { tokenComparisons: ['ETH', 'BTC'].map((symbol) => ({ symbol, result: { ok: true, dataStatus: 'live', priceUsd: 5 } })) };
    const riskAnswer = buildHumanResponse({ intent: safer, results: riskData, locale: 'en' });
    expect(riskAnswer.message).toContain('requested comparison data unavailable');
    expect(riskAnswer.message).not.toContain('price:');
    const advice = understandIntent('Is BTC a good investment?');
    expect(advice.type).toBe('ANALYZE_TOKEN');
    expect(advice.questionFrame).toBe('INVESTMENT_RECOMMENDATION');
    expect(advice.executionRequested).toBe(false);
  });

  it('resolves pronouns and elliptical follow-ups against conversation context', async () => {
    const context = { selectedAsset: 'BTC', conversation: [{ role: 'user', content: 'BTC price today?' }] };
    const risk = understandIntent('What about its risk?', context);
    expect(risk.type).toBe('ANALYZE_TOKEN');
    expect(risk.entities.token).toBe('BTC');
    expect(risk.entities.analysisMode).toBe('ASSET_RISK');
    expect(risk.entities.resolvedReferences.token).toBe('conversation_context');

    const nextAsset = understandIntent('And ETH?', context);
    expect(nextAsset.type).toBe('ANALYZE_TOKEN');
    expect(nextAsset.entities.token).toBe('ETH');
    expect(nextAsset.entities.relatedToken).toBe('BTC');
    expect(nextAsset.answerStyle).toBe('ANSWER_SAME_QUESTION_FOR_NEW_ASSET');
    const specialists = await createOrchestrator().routeToAgents(nextAsset, {});
    expect(specialists.agents).toEqual(expect.arrayContaining(['market-agent', 'risk-agent']));

    const compare = understandIntent('Compare it with ETH', context);
    expect(compare.entities.comparisonTokens).toEqual(['BTC', 'ETH']);
  });

  it('keeps multi-asset allocation planning read-only through orchestration', async () => {
    const intent = understandIntent('I have $1000, split it between BTC and ETH safely');
    const plan = await createOrchestrator().plan({ intent });
    expect(plan.readOnly).toBe(true);
    expect(plan.requiresConfirmation).toBe(false);
    expect(plan.actions).toEqual([]);
    expect(plan.agents).toEqual(expect.arrayContaining(['market-agent', 'risk-agent', 'strategy-agent']));
  });

  it('retrieves fresh per-asset market quotes for an allocation plan without creating swap quotes', async () => {
    const intent = understandIntent('I have $1000, split it between BTC and ETH safely');
    const requested = [];
    const result = await executeIntentTools({ intent, services: { marketService: {
      getOverview: async () => ({ ok: true, dataStatus: 'live', markets: [] }),
      getToken: async ({ symbol }) => {
        requested.push(symbol);
        return { ok: true, dataStatus: 'live', symbol, priceUsd: symbol === 'BTC' ? 60000 : 3000 };
      }
    } } });
    expect(requested).toEqual(expect.arrayContaining(['BTC', 'ETH']));
    expect(result.data.tokenComparisons.map((row) => row.symbol)).toEqual(['BTC', 'ETH']);
    expect(result.data.quote).toBeUndefined();
    const answer = buildHumanResponse({ intent, results: result.data, locale: 'en' });
    expect(answer.allocationPlan).toMatchObject({ budgetUsd: 1000, assets: ['BTC', 'ETH'], weightsProvided: false, executionRequested: false });
    expect(answer.message).toContain('I need your preferred weights');
    expect(answer.message).toContain('Stated budget: $1,000');
  });

  it('calculates only user-specified allocation weights and validates their total', () => {
    const intent = understandIntent('Split $1000: 60% BTC and 40% ETH');
    expect(intent.entities.allocationWeights).toEqual([
      { symbol: 'BTC', weightPct: 60 }, { symbol: 'ETH', weightPct: 40 }
    ]);
    const answer = buildHumanResponse({ intent, locale: 'en', results: { tokenComparisons: [
      { symbol: 'BTC', result: { dataStatus: 'live', priceUsd: 50000 } },
      { symbol: 'ETH', result: { dataStatus: 'live', priceUsd: 2500 } }
    ] } });
    expect(answer.allocationPlan.amounts).toEqual([
      expect.objectContaining({ symbol: 'BTC', budgetUsd: 600, estimatedUnits: 0.012 }),
      expect.objectContaining({ symbol: 'ETH', budgetUsd: 400, estimatedUnits: 0.16 })
    ]);
    expect(answer.allocationPlan.executionRequested).toBe(false);
    const staleAnswer = buildHumanResponse({ intent, locale: 'en', results: { tokenComparisons: [
      { symbol: 'BTC', result: { dataStatus: 'stale', priceUsd: 50000 } },
      { symbol: 'ETH', result: { dataStatus: 'unavailable', priceUsd: 2500 } }
    ] } });
    expect(staleAnswer.allocationPlan.amounts.every((row) => row.estimatedUnits == null && row.priceUsd == null)).toBe(true);

    const invalid = understandIntent('Split $1000: 60% BTC and 30% ETH');
    expect(invalid.entities.allocationWeights).toBeNull();
    const equal = understandIntent('Split $1000 evenly between BTC and ETH');
    expect(equal.entities.allocationWeights).toEqual([
      { symbol: 'BTC', weightPct: 50 }, { symbol: 'ETH', weightPct: 50 }
    ]);
    const reversed = understandIntent('Split $1000: BTC 60% and ETH 40%');
    expect(reversed.entities.allocationWeights).toEqual([
      { symbol: 'BTC', weightPct: 60 }, { symbol: 'ETH', weightPct: 40 }
    ]);
  });

  it('classifies multi-asset budget splits as read-only plans and does not treat safely as risk', () => {
    const plan = understandIntent('I have $1000, split it between BTC and ETH safely');
    expect(plan.type).toBe('INVESTMENT_PLAN');
    expect(plan.questionFrame).toBe('READ_ONLY_ALLOCATION_PLAN');
    expect(plan.entities.allocationAssets).toEqual(['BTC', 'ETH']);
    expect(plan.entities.allocationBudgetUsd).toBe(1000);
    expect(plan.entities.fromToken).toBeNull();
    expect(plan.entities.toToken).toBeNull();
    expect(plan.entities.analysisMode).not.toBe('ASSET_RISK');

    const risk = understandIntent('How safe is BTC?');
    expect(risk.entities.analysisMode).toBe('ASSET_RISK');
  });

  it('asks for clarification instead of guessing when a scenario contains both directions', () => {
    const intent = understandIntent('What if BTC falls 10% but rises 20%?');
    expect(intent.entities.analysisMode).toBe('SCENARIO_CLARIFICATION');
    expect(intent.questionFrame).toBe('SCENARIO_AMBIGUOUS');
    const answer = buildHumanResponse({ intent, locale: 'en' });
    expect(answer.clarification).toMatchObject({ required: true, fields: ['direction', 'movePct'] });
    expect(answer.message).toContain('I will not calculate until that is clear');
  });

  it('runs what-if scenarios as arithmetic on retrieved prices or verified portfolio exposure', () => {
    const tokenIntent = understandIntent('What if BTC drops 20%?');
    expect(tokenIntent.type).toBe('ANALYZE_TOKEN');
    expect(tokenIntent.entities.scenarioMovePct).toBe(-20);
    const tokenAnswer = buildHumanResponse({ intent: tokenIntent, results: { token: {
      ok: true, dataStatus: 'live', symbol: 'BTC', priceUsd: 100000
    } }, locale: 'en' });
    expect(tokenAnswer.scenario).toMatchObject({ basePrice: 100000, movePct: -20, scenarioPrice: 80000, forecast: false });
    expect(tokenAnswer.message).toContain('change −$20,000 per unit');
    const positionIntent = understandIntent('What if my 2 BTC drops 10%?');
    const positionAnswer = buildHumanResponse({ intent: positionIntent, results: { token: {
      ok: true, dataStatus: 'live', symbol: 'BTC', priceUsd: 100000
    } }, locale: 'en' });
    expect(positionAnswer.scenario).toMatchObject({ quantity: 2, positionImpact: -20000 });
    expect(positionAnswer.message).toContain('impact on the stated quantity: −$20,000');

    const portfolioIntent = understandIntent('If ETH falls 15%, what happens to my portfolio?');
    const portfolioAnswer = buildHumanResponse({ intent: portfolioIntent, context: { wallet: { connected: true } }, results: {
      portfolio: { dataStatus: 'live', totalValueUsd: 10000, holdings: [{ symbol: 'ETH', amount: 2, valueUsd: 6000 }] }
    }, locale: 'en' });
    expect(portfolioAnswer.scenario).toMatchObject({ exposureUsd: 6000, movePct: -15, impactUsd: -900, forecast: false });
    expect(portfolioAnswer.message).toContain('changes by about −$900');
  });

  it('answers an asset-risk question only with observed moves and a clearly limited range proxy', () => {
    const intent = understandIntent('Is BTC safer?');
    expect(intent.type).toBe('ANALYZE_TOKEN');
    expect(intent.entities.analysisMode).toBe('ASSET_RISK');
    const answer = buildHumanResponse({ intent, results: { token: {
      ok: true, dataStatus: 'live', symbol: 'BTC', priceUsd: 100, high24h: 110, low24h: 95, change24hPct: -2
    } }, locale: 'en' });
    expect(answer.message).toContain('24h move: -2%');
    expect(answer.message).toContain('recorded 24h range: 15%');
    expect(answer.message).toContain('not a complete risk score');
    expect(answer.message).not.toContain('safer than');
  });

  it('routes wallet security questions to risk analysis, not balance lookup', () => {
    expect(understandIntent('Is my wallet safe?').type).toBe('RISK_ANALYSIS');
  });

  it('marks explanation and troubleshooting questions with answer strategies', () => {
    const explain = understandIntent('What does impermanent loss mean?');
    expect(explain.questionFrame).toBe('EXPLANATION');
    expect(explain.answerStyle).toBe('PLAIN_LANGUAGE_WITH_EXAMPLE');
    expect(understandIntent('What is gas fee?').questionFrame).toBe('EXPLANATION');
    const troubleshoot = understandIntent('My wallet is not working');
    expect(troubleshoot.questionFrame).toBe('TROUBLESHOOTING');
    expect(troubleshoot.answerStyle).toBe('DIAGNOSE_THEN_MINIMAL_NEXT_STEP');
  });

  it('treats buying advice as read-only analysis, while explicit buy remains a buy intent', () => {
    const advice = understandIntent('Should I buy BTC or ETH?');
    expect(advice.type).toBe('ANALYZE_TOKEN');
    expect(advice.entities.analysisMode).toBe('COMPARISON_RECOMMENDATION');
    expect(advice.entities.comparisonTokens).toEqual(['BTC', 'ETH']);
    expect(understandIntent('Buy BTC now').type).toBe('BUY');
  });

  it.each([
    'Should I sell BTC?',
    'Should I swap BTC for ETH?',
    'Is it safe to buy BTC?',
    'Buy BTC or ETH?',
    'آیا ETH را بفروشم؟',
    'بهتره BTC بخرم یا ETH؟'
  ])('keeps advice-seeking %s read-only', (text) => {
    const result = understandIntent(text);
    expect(result.type).toBe('ANALYZE_TOKEN');
    expect(result.executionRequested).toBe(false);
    expect(result.requiresConfirmation).toBe(false);
    if (result.entities.tokens.length > 1) {
      expect(result.entities.fromToken).toBeNull();
      expect(result.entities.toToken).toBeNull();
    }
  });
});
