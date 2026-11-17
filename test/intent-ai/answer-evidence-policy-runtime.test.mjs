import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessAnswerEvidence,
  answerRequiresEvidence,
  buildEvidenceLimitationReply
} from '../../server/aiEvidenceFallback.js';

test('model prose or an ungrounded internal synthesis is not evidence', () => {
  const assessed = assessAnswerEvidence({
    collaboration: { ok: true, answer: 'A confident-looking answer from a model.', evidence: { internalSynthesis: true } },
    orchestration: { ok: true, answer: 'Another answer.', evidence: [{ status: 'failed' }], passages: [] }
  });
  assert.equal(assessed.available, false);
  assert.equal(assessed.reason, 'NO_TRUSTED_EVIDENCE');
});

test('only observable tools, verified knowledge, sourced web, or observed orchestration ground an answer', () => {
  /* Fixtures mirror the real producer contracts (buildAIContext / researchWeb /
     aiOrchestrator): a trusted context schema, an explicit dataStatus, a
     source + timestamp, and citable web rows. A bare priceMap without that
     provenance is exactly what the gate must refuse. */
  const now = Date.now();
  const fixtures = [
    [{ context: { schema: 'fbt.ai-context.v1', market: { dataStatus: 'live', source: 'coingecko', at: now, priceMap: { BTC: 65000 } } }, intentType: 'MARKET_ANALYSIS' }, 'market-tool'],
    [{ context: { schema: 'fbt.ai-context.v1', portfolio: { totalValueUsd: 1200, dataStatus: 'live' } }, intentType: 'PORTFOLIO_ANALYSIS' }, 'portfolio-tool'],
    [{ context: { schema: 'fbt.ai-context.v1', dataStatus: { yield: 'live' }, yields: [{ apy: 4.2, protocol: 'Example', dataStatus: 'live', source: 'yield-feed' }] }, intentType: 'YIELD_DISCOVERY' }, 'yield-tool'],
    [{ tokenCard: { priceUsd: 10, dataStatus: 'live' } }, 'token-card'],
    [{ productRead: { confidence: 'verified' } }, 'verified-product-knowledge'],
    [{ collaboration: { evidence: { knowledgeUsed: true } } }, 'verified-knowledge'],
    [{ collaboration: { evidence: { webUsed: true }, sources: [{ title: 'Example source title', url: 'https://example.test/source', tier: 2, snippet: 'A sufficiently long snippet describing the source.' }] } }, 'web-source'],
    [{ orchestration: { ok: true, answer: 'Observed tool result.', evidence: [{ facetId: 'market_prices', status: 'observed' }] } }, 'orchestrator-evidence'],
    [{ orchestration: { ok: true, answer: 'Retrieved passage.', passages: [{ cite: 'kb.example', title: 'Verified repository passage', score: 0.9 }] } }, 'orchestrator-evidence']
  ];
  for (const [input, source] of fixtures) {
    const assessed = assessAnswerEvidence(input);
    assert.equal(assessed.available, true, source);
    assert.ok(assessed.sources.includes(source), source);
  }
  assert.equal(assessAnswerEvidence({
    collaboration: { evidence: { webUsed: true }, sources: [{ title: 'uncited result' }] }
  }).available, false, 'a web-used flag without a URL is not citable evidence');
  assert.equal(assessAnswerEvidence({
    collaboration: { evidence: { internalSynthesis: true, toolDataUsed: false, knowledgeUsed: false, webUsed: false } }
  }).available, false, 'internal synthesis alone is not evidence');
  assert.equal(assessAnswerEvidence({
    context: { schema: 'fbt.ai-context.v1', market: { dataStatus: 'live', source: 'coingecko', at: now, priceMap: { BTC: 65000 } } }, intentType: 'GENERAL'
  }).available, false, 'irrelevant market context cannot ground an unrelated answer');
  assert.equal(assessAnswerEvidence({
    context: { market: { priceMap: { BTC: 65000 } } }, intentType: 'MARKET_ANALYSIS'
  }).available, false, 'a priceMap without a trusted context schema has no provenance');
  assert.equal(assessAnswerEvidence({
    context: { schema: 'fbt.ai-context.v1', portfolio: { totalValueUsd: null, dataStatus: 'unavailable' } }, intentType: 'PORTFOLIO_ANALYSIS'
  }).available, false, 'a missing portfolio read is not a zero balance');
  assert.equal(assessAnswerEvidence({
    context: { schema: 'fbt.ai-context.v1', dataStatus: { yield: 'live' }, yields: [{ apy: null, protocol: 'Example' }] }, intentType: 'YIELD_DISCOVERY'
  }).available, false, 'a row without an APY does not support a yield claim');
  assert.equal(assessAnswerEvidence({
    collaboration: { evidence: { knowledgeUsed: true } }, intentType: 'MARKET_ANALYSIS', freshness: 'LIVE'
  }).available, false, 'static knowledge does not substantiate a live market fact');
  assert.equal(assessAnswerEvidence({
    orchestration: {
      ok: true, answer: 'Retrieved static passage.', evidence: [{ facetId: 'knowledge', status: 'observed' }],
      passages: [{ cite: 'kb.market', title: 'Static market primer', score: 0.9 }]
    },
    intentType: 'MARKET_ANALYSIS', freshness: 'LIVE'
  }).available, false, 'a static RAG passage cannot substitute for a live market read');
  assert.equal(assessAnswerEvidence({
    orchestration: {
      ok: true, answer: 'Observed market snapshot.', evidence: [{ facetId: 'market_prices', status: 'observed' }]
    },
    intentType: 'MARKET_ANALYSIS', freshness: 'LIVE'
  }).available, true, 'the observed current-data facet can support a live answer');
});

test('evidence is required for factual questions but not social or already gated actions', () => {
  assert.equal(answerRequiresEvidence({ answerPath: 'WEB', intentType: 'NEWS_SEARCH' }), true);
  assert.equal(answerRequiresEvidence({ freshness: 'LIVE', conversationKind: 'QUESTION' }), true);
  assert.equal(answerRequiresEvidence({ intentType: 'MARKET_ANALYSIS' }), true);
  assert.equal(answerRequiresEvidence({ conversationKind: 'QUESTION', intentType: 'GENERAL' }), true);
  assert.equal(answerRequiresEvidence({ conversationKind: 'GREETING', answerPath: 'KNOWLEDGE' }), false);
  assert.equal(answerRequiresEvidence({ socialHandled: true, answerPath: 'WEB' }), false);
  assert.equal(answerRequiresEvidence({ pendingIntent: true, answerPath: 'TOOL' }), false);
  assert.equal(answerRequiresEvidence({ actionPlan: true, answerPath: 'TOOL' }), false);
  assert.equal(answerRequiresEvidence({ uiType: 'ACTION_CARD', answerPath: 'TOOL' }), false);
  assert.equal(answerRequiresEvidence({ productVerified: true, answerPath: 'KNOWLEDGE' }), false);
});

test('no-evidence replies are explicit, localized, and preserve a single necessary clarification', () => {
  const fa = buildEvidenceLimitationReply({
    locale: 'fa-IR', intentType: 'MARKET_ANALYSIS', freshness: 'LIVE',
    minimalQuestion: { fa: 'کدام دارایی و چه بازه‌ای؟', en: 'Which asset and time window?' }
  });
  assert.match(fa, /شاهد تأییدشدهٔ کافی/);
  assert.match(fa, /حدس نمی‌زنم/);
  assert.match(fa, /کدام دارایی و چه بازه‌ای؟/);
  assert.equal((fa.match(/کدام دارایی/g) || []).length, 1);

  const noProvider = buildEvidenceLimitationReply({
    locale: 'en', intentType: 'NEWS_SEARCH', freshness: 'RECENT', providerAnswered: false
  });
  assert.match(noProvider, /No live AI provider returned an answer/);
  const clarifier = buildEvidenceLimitationReply({ locale: 'fa', clarificationOnly: true, providerAnswered: false });
  assert.match(clarifier, /بخش نامشخص را حدس نمی‌زنم/);
  assert.doesNotMatch(clarifier, /دارایی و بازهٔ زمانی را مشخص کنید/,
    'the route appends its one slot-specific question; no second generic question');

  const en = buildEvidenceLimitationReply({ locale: 'en', intentType: 'MARKET_ANALYSIS', freshness: 'LIVE' });
  assert.match(en, /verified live source/);
  assert.match(en, /will not guess/);

  const wallet = buildEvidenceLimitationReply({ locale: 'en', intentType: 'PORTFOLIO_ANALYSIS' });
  assert.match(wallet, /will not guess balances or positions/);
  const walletFa = buildEvidenceLimitationReply({ locale: 'fa', intentType: 'WALLET_BALANCE' });
  assert.match(walletFa, /موجودی یا موقعیت‌ها را حدس نمی‌زنم/);
});

test('smart-money evidence must be indexed inside its claimed window', () => {
  const now = Date.now();
  const row = { symbol: 'BTC', signal: 'ACCUMULATION' };
  const fresh = assessAnswerEvidence({
    smartMoneyEvidence: { dataStatus: 'observed', rows: [row], indexedAt: now - 60_000, window: '24h' },
    intentType: 'SMART_MONEY'
  });
  assert.equal(fresh.available, true, 'a freshly indexed consensus grounds the answer');
  assert.ok(fresh.sources.includes('smart-money-index'));

  const stale = assessAnswerEvidence({
    smartMoneyEvidence: { dataStatus: 'observed', rows: [row], indexedAt: now - 3 * 24 * 3_600_000, window: '24h' },
    intentType: 'SMART_MONEY'
  });
  assert.equal(stale.available, false, 'a 3-day-old index cannot support a 24h-window claim');

  const noIndexTime = assessAnswerEvidence({
    smartMoneyEvidence: { dataStatus: 'observed', rows: [row], indexedAt: null, window: '24h' },
    intentType: 'SMART_MONEY'
  });
  assert.equal(noIndexTime.available, false, 'read time (at) is not a freshness proof');

  const abstention = assessAnswerEvidence({
    smartMoneyEvidence: { dataStatus: 'insufficient-evidence', rows: [], indexedAt: now - 60_000, window: '24h' },
    intentType: 'SMART_MONEY'
  });
  assert.equal(abstention.available, true, 'a fresh honest abstention is itself grounded');
});

test('conditional allocation answers need fresh, successful price reads', () => {
  const now = Date.now();
  const fresh = assessAnswerEvidence({
    conditionalEvidence: { reads: [
      { symbol: 'GOLD', ok: true, source: 'stooq:GC.F', at: now },
      { symbol: 'BTC', ok: true, source: 'coingecko', at: now }
    ] },
    intentType: 'CONDITIONAL_ALLOCATION'
  });
  assert.equal(fresh.available, true, 'fresh reads ground the conditional answer');
  assert.ok(fresh.sources.includes('conditional-price-reads'));

  const stale = assessAnswerEvidence({
    conditionalEvidence: { reads: [
      { symbol: 'GOLD', ok: true, source: 'stooq:GC.F', at: now - 8 * 24 * 3_600_000 },
      { symbol: 'BTC', ok: true, source: 'coingecko', at: now }
    ] },
    intentType: 'CONDITIONAL_ALLOCATION'
  });
  assert.equal(stale.available, false, 'a week-old quote is not a current observation');

  const failed = assessAnswerEvidence({
    conditionalEvidence: { reads: [
      { symbol: 'GOLD', ok: false, code: 'NO_FEED_FOR_INSTRUMENT' },
      { symbol: 'BTC', ok: true, source: 'coingecko', at: now }
    ] },
    intentType: 'CONDITIONAL_ALLOCATION'
  });
  assert.equal(failed.available, false, 'one dead feed makes the whole instruction unsupported');

  const empty = assessAnswerEvidence({ conditionalEvidence: { reads: [] }, intentType: 'CONDITIONAL_ALLOCATION' });
  assert.equal(empty.available, false, 'no reads at all is no evidence');
});
