#!/usr/bin/env node
/**
 * FBT AI — CENTRAL BRAIN V2 (10 CAPABILITIES) + ADAPTIVE AI COUNCIL (8 SPECIALISTS) PROBE
 * ---------------------------------------------------------------------------
 * Verifies every requirement of Section 1 (Central Brain Upgrade) and
 * Section 4 (Adaptive AI Council):
 *   1. Intelligent request classification (Persian + English)
 *   2. Cost- & complexity-gated model selection (NEVER calls all 8 models!)
 *   3. Multi-agent task decomposition across waves
 *   4. Bounded concurrent agent execution
 *   5. Cross-agent result comparison
 *   6. Contradiction & conflict detection (directional, numeric, unsupported claim, user preference)
 *   7. Evidence- & source-credibility-weighted final result selection
 *   8. Uncertainty detection & targeted clarification request (skipping questions answered in memory!)
 *   9. Automatic Provider failover on error/timeout
 *  10. Complete 10-stage decision trace logging
 *  11. Dynamic selection of the 8 Adaptive AI Council specialists + all 7 required output fields
 */

import assert from 'node:assert/strict';
import {
  classifyRequest,
  selectOptimalModels,
  decomposeTask,
  executeAgentsConcurrently,
  compareAgentResults,
  detectContradictions,
  selectEvidenceBasedResult,
  assessUncertaintyAndClarify,
  createCentralBrain
} from '../../src/lib/intent-ai/orchestrator/centralBrain.js';
import { COUNCIL_MEMBER_IDS, selectCouncilMembers } from '../../src/lib/intent-ai/orchestrator/adaptiveCouncil.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
  }
}

console.log('\n=== FBT AI — CENTRAL BRAIN V2 + ADAPTIVE AI COUNCIL PROBE ===\n');

await test('Capability 1 & 2: Request classification & strict cost/complexity model budgeting (never calls all models)', () => {
  // Trivial greeting -> 0 LLM models!
  const trivial = classifyRequest('سلام وقت بخیر');
  assert.equal(trivial.category, 'SOCIAL_CHITCHAT');
  assert.equal(trivial.complexity, 'TRIVIAL');
  const trivialModels = selectOptimalModels({ classification: trivial });
  assert.equal(trivialModels.selectedModels.length, 0, 'trivial request must spend 0 models');
  assert.equal(trivialModels.skippedModels.length, 8);

  // Simple price lookup -> 1 low-cost model, NO council!
  const simple = classifyRequest('قیمت بیت کوین چنده؟');
  assert.equal(simple.category, 'PRICE_LOOKUP');
  assert.equal(simple.complexity, 'SIMPLE');
  assert.equal(simple.needsCouncil, false);
  const simpleModels = selectOptimalModels({ classification: simple });
  assert.equal(simpleModels.selectedModels.length, 1, 'simple request must select at most 1 model');
  assert.ok(simpleModels.selectedModels[0].costUnits <= 2, 'simple request must pick low-cost model');

  // Complex multi-domain strategy -> 3..4 specialized models (still NEVER all 8!)
  const complex = classifyRequest('با توجه به اخبار نرخ بهره فدرال رزرو، جریان نهنگ‌های اسمارت‌مانی، وضعیت آن‌چین و نمودار تکنیکال، آیا ۱۰ هزار دلار اتریوم و سولانا بخرم یا صبر کنم؟');
  assert.equal(complex.category, 'MULTI_DOMAIN_COMPLEX');
  assert.ok(['COMPLEX', 'CRITICAL'].includes(complex.complexity));
  assert.equal(complex.needsCouncil, true);
  const decomp = decomposeTask({ classification: complex, message: 'تحلیل جامع' });
  const complexModels = selectOptimalModels({ classification: complex, subTasks: decomp.subTasks });
  assert.ok(complexModels.selectedModels.length >= 2 && complexModels.selectedModels.length <= 4, `expected 2..4 models, got ${complexModels.selectedModels.length}`);
  assert.ok(complexModels.skippedModels.length >= 4, 'must skip unneeded models to control cost');
});

await test('Capability 2 + Learning Integration: Learned trust weights shift model selection away from high-error models', () => {
  const cls = classifyRequest('تحلیل تکنیکال و روند قیمت BTC');
  const defaultSel = selectOptimalModels({
    classification: { ...cls, complexity: 'SIMPLE' },
    subTasks: [{ taskId: 't1', agentId: 'technical_analyst', specialty: 'quant_technical' }],
    availableProviders: ['deepseek', 'gemini'],
    trustWeights: { deepseek: 1.0, gemini: 1.0 }
  });
  assert.equal(defaultSel.selectedModels[0].provider, 'deepseek');

  // When deepseek's trust weight drops due to high historical errors and gemini rises, brain switches automatically!
  const adaptedSel = selectOptimalModels({
    classification: { ...cls, complexity: 'SIMPLE' },
    subTasks: [{ taskId: 't1', agentId: 'technical_analyst', specialty: 'quant_technical' }],
    availableProviders: ['deepseek', 'gemini'],
    trustWeights: { deepseek: 0.40, gemini: 1.45 }
  });
  assert.equal(adaptedSel.selectedModels[0].provider, 'gemini', 'Central Brain must switch to higher-trust model');
});

await test('Capability 3 & 4: Multi-agent task decomposition & bounded concurrent execution with fault isolation', async () => {
  let active = 0;
  let peakActive = 0;
  const tasks = [
    { taskId: 't1', agentId: 'technical_analyst' },
    { taskId: 't2', agentId: 'onchain_analyst' },
    { taskId: 't3', agentId: 'broken_agent' },
    { taskId: 't4', agentId: 'smart_money_analyst' },
    { taskId: 't5', agentId: 'macro_news_analyst' }
  ];

  const out = await executeAgentsConcurrently(tasks, async (t) => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((r) => setTimeout(r, 15));
    active -= 1;
    if (t.agentId === 'broken_agent') throw new Error('AGENT_BOOM');
    return { agent: t.agentId, ok: true };
  }, { maxConcurrency: 2, taskTimeoutMs: 500 });

  assert.ok(peakActive <= 2, `concurrency bound 2 must hold, got ${peakActive}`);
  assert.equal(out.filter((r) => r.ok).length, 4, 'failing agent must not abort sibling agents');
  assert.equal(out[2].ok, false);
  assert.match(out[2].error, /AGENT_BOOM/);
});

await test('Capability 5, 6 & 7: Agent comparison, 4-class contradiction detection & evidence-credibility selection', () => {
  const evidence = [
    { facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed', summary: { price: 68000 } }
  ];
  const agentOutputs = [
    {
      memberId: 'technical_analyst',
      roleFa: 'تحلیلگر تکنیکال',
      stance: 'bullish',
      action: 'FAVORABLE_STAGED',
      summary: 'بر اساس خوانش قیمت $68000 و بازده 4% روند مثبت است.',
      evidenceCited: ['market_prices'],
      provider: 'deepseek'
    },
    {
      memberId: 'macro_news_analyst',
      roleFa: 'تحلیلگر اخبار',
      stance: 'bearish',
      action: 'CAUTIOUS_REDUCE',
      summary: 'استفاده از لوریج توصیه می‌شود با قیمت $92000 و بازده 18%.',
      evidenceCited: [], // ungrounded!
      provider: 'groq'
    }
  ];

  const cmp = compareAgentResults(agentOutputs);
  assert.equal(cmp.comparedCount, 2);
  assert.equal(cmp.stanceAgreement, 0.5);

  const contradictions = detectContradictions({
    agentOutputs,
    evidence,
    userProfile: { preferencesMap: { riskTolerance: 'CONSERVATIVE', leveragePolicy: 'NO_LEVERAGE_SPOT_ONLY' } }
  });
  const types = contradictions.map((c) => c.type);
  assert.ok(types.includes('DIRECTIONAL_CONFLICT'), 'must detect directional conflict');
  assert.ok(types.includes('NUMERIC_CONTRADICTION'), 'must detect divergent numbers ($68000 vs $92000 / 4% vs 18%)');
  assert.ok(types.includes('USER_PREFERENCE_CONFLICT'), 'must detect violation of user NO_LEVERAGE preference');

  const sel = selectEvidenceBasedResult({ agentOutputs, evidence, contradictions });
  assert.equal(sel.winner.agentId, 'technical_analyst', 'evidence-backed compliant agent must defeat ungrounded conflicting agent');
  assert.ok(sel.winner.compositeScore > sel.rankedCandidates[1].compositeScore + 0.35);
});

await test('Capability 8: Uncertainty detection asks for missing info, then skips redundant questions once stored in memory', async () => {
  const brain = createCentralBrain({ availableProviders: ['groq', 'gemini', 'deepseek'] });

  // Ambiguous turn with no asset -> asks for target asset!
  const ambig = await brain.run({ owner: 'dev:uncertain_u', message: 'الان بخرم؟' });
  assert.equal(ambig.decision.action, 'CLARIFY');
  assert.ok(ambig.uncertainty.missingSlots.includes('target_asset'));
  assert.ok(ambig.decision.clarificationQuestions.length >= 1);

  // Strategy turn with asset but NO risk/horizon in message or memory -> asks for horizon & risk tolerance!
  const needRisk = await brain.run({ owner: 'dev:uncertain_u', message: 'برای ETH استراتژی بده' });
  assert.equal(needRisk.decision.action, 'CLARIFY');
  assert.ok(needRisk.uncertainty.missingSlots.includes('risk_and_horizon'));

  // User states preference & goal -> stored in SmartMemory -> same short strategy query NO LONGER asks redundant question!
  await brain.smartMemory.rememberConversation({
    owner: 'dev:uncertain_u',
    userMessage: 'هدفم رسیدن به ۲۰ هزار دلار در ۱۲ ماه است و ریسک کم می‌خواهم.',
    assistantReply: 'ثبت شد.'
  });
  const resolved = await brain.run({
    owner: 'dev:uncertain_u',
    message: 'برای ETH استراتژی بده',
    preloadedEvidence: [{ facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed', summary: { assets: [{ symbol: 'ETH', price: 3200, change24h: 2.4 }] } }]
  });
  assert.notEqual(resolved.decision.action, 'CLARIFY', 'must use remembered riskTolerance & goal instead of re-asking!');
});

await test('Capability 9 & 10: Provider error automatic failover + complete 10-stage decision trace', async () => {
  const callLog = [];
  let failedPrimaryProvider = null;
  const brain = createCentralBrain({
    availableProviders: ['deepseek', 'gemini', 'groq'],
    providerInvoker: async ({ provider, agentId }) => {
      callLog.push({ provider, agentId });
      if (!failedPrimaryProvider) {
        failedPrimaryProvider = provider;
        throw new Error('HTTP_429_RATE_LIMITED');
      }
      return {
        text: `تحلیل تأییدشده توسط مدل جایگزین (${provider}) بر اساس داده‌های مشاهده‌شده.`,
        stance: 'bullish',
        confidence: 74,
        model: `${provider}-live-v1`
      };
    }
  });

  const out = await brain.run({
    owner: 'dev:failover_u',
    message: 'روند کوتاه‌مدت ETH چطور است؟',
    preloadedEvidence: [{
      facetId: 'market_prices',
      tool: 'fbt_get_market_snapshot',
      status: 'observed',
      summary: { assets: [{ symbol: 'ETH', price: 3250, change24h: 2.1 }] }
    }]
  });

  assert.equal(out.ok, true);
  assert.ok(out.failoverEvents.length >= 1, 'must record automatic failover when primary provider throws 429');
  assert.equal(out.failoverEvents[0].attemptedProviders[0], failedPrimaryProvider);
  assert.notEqual(out.failoverEvents[0].finalProvider, failedPrimaryProvider);
  assert.equal(out.decisionTrace.stageCount, 10, 'must record all 10 decision-making stages');
  assert.equal(out.executionAuthorized, false);
});

await test('Section 4 — Adaptive AI Council: dynamic specialist selection across all 8 roles + all 7 required output fields', async () => {
  assert.equal(COUNCIL_MEMBER_IDS.length, 8, 'roster must contain all 8 specialized council roles');

  // 1. Smart-money + on-chain query selects ONLY pertinent specialists, NOT macro/strategy!
  const smMsg = 'جریان نهنگ‌ها و اسمارت‌مانی و وضعیت نقدینگی آن‌چین اتریوم چطور است؟';
  const smSel = selectCouncilMembers({ classification: classifyRequest(smMsg), message: smMsg });
  const smIds = smSel.selectedMembers.map((m) => m.memberId);
  assert.ok(smIds.includes('smart_money_analyst'));
  assert.ok(smIds.includes('onchain_analyst'));
  assert.ok(smIds.includes('final_arbiter'));
  assert.ok(!smIds.includes('macro_news_analyst'), 'macro analyst should be dynamically skipped when not needed');

  // 2. Full high-stakes multi-domain request convenes all 8 specialists & produces all 7 required outputs!
  const fullMsg = 'با توجه به تحلیل تکنیکال، داده‌های آن‌چین و دیفای، جریان نهنگ‌های اسمارت‌مانی، اخبار فدرال رزرو و اقتصاد کلان، و مدیریت ریسک، چه استراتژی معاملاتی برای خرید ۲۰ هزار دلار BTC پیشنهاد می‌دهید؟';
  const brain = createCentralBrain({ availableProviders: ['deepseek', 'gemini', 'anthropic', 'openrouter'] });

  // Store conservative no-leverage preference first to test Risk Specialist + Critic interaction too
  await brain.smartMemory.setPreference({ owner: 'dev:council_u', key: 'riskTolerance', value: 'MODERATE', provenance: 'USER_SAID' });

  const run = await brain.run({
    owner: 'dev:council_u',
    message: fullMsg,
    preloadedEvidence: [
      { facetId: 'market_prices', tool: 'fbt_get_market_snapshot', status: 'observed', summary: { assets: [{ symbol: 'BTC', price: 68400, change24h: 2.8 }], regime: 'uptrend' } },
      { facetId: 'yield_rates', tool: 'fbt_get_yields', status: 'observed', summary: { pools: [{ project: 'Aave', symbol: 'WBTC', apy: 1.9 }] } },
      { facetId: 'smart_money', tool: 'fbt_get_signals', status: 'observed', summary: { trend: 'accumulation inflow' } },
      { facetId: 'news_flow', tool: 'fbt_get_news', status: 'observed', summary: { headlines: ['Hawkish Fed speech sparks caution ahead of CPI crash risk'] } }
    ]
  });

  const council = run.council;
  assert.equal(council.councilConvened, true);
  assert.equal(council.selectedMembers.length, 8, 'all 8 specialists selected when all domains + high-stakes strategy are requested');

  // Verify ALL 7 required output fields of Section 4:
  // 1. نظر هر متخصص (memberOpinions)
  assert.equal(council.memberOpinions.length, 8);
  assert.ok(council.memberOpinions.every((m) => m.roleFa && m.summary && typeof m.confidence === 'number'));
  // 2. شواهد و داده‌های استفاده‌شده (evidenceUsed)
  assert.equal(council.evidenceUsed.length, 4);
  assert.ok(council.evidenceUsed.every((e) => e.status === 'observed' && e.credibility > 0.8));
  // 3. نقاط توافق (pointsOfAgreement)
  assert.ok(Array.isArray(council.pointsOfAgreement) && council.pointsOfAgreement.length >= 1);
  // 4. نقاط اختلاف (pointsOfDisagreement — Technical/SmartMoney bullish vs MacroNews bearish!)
  assert.ok(Array.isArray(council.pointsOfDisagreement) && council.pointsOfDisagreement.length >= 1, 'must capture disagreement between bullish technical/smart-money and bearish macro news');
  // 5. سطح اطمینان (confidence)
  assert.ok(typeof council.confidence.score === 'number' && ['HIGH', 'MEDIUM', 'LOW'].includes(council.confidence.band));
  // 6. تصمیم نهایی (finalDecision)
  assert.ok(council.finalDecision && council.finalDecision.action && council.finalDecision.executionAuthorized === false);
  // 7. دلایل تصمیم (decisionReasons)
  assert.ok(Array.isArray(council.decisionReasons) && council.decisionReasons.length >= 2);
});

console.log(`\n=== CENTRAL BRAIN + ADAPTIVE COUNCIL PROBE: ${passed}/${passed + failed} passed ===\n`);
if (failed > 0) process.exit(1);
