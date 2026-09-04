/**
 * FBT INTENT AI — UPGRADE 5: COLLABORATIVE MULTI-AI INTELLIGENCE + WEB RESEARCH + CUSTOMER QUESTION INTELLIGENCE
 * ---------------------------------------------------------------------------
 * Comprehensive probe verifying:
 *  1. Question Analyzer: conversation kind, emotion, FOMO, freshness, complexity
 *  2. Intelligent routing & cost law — greetings never reach multi-AI (§4, §45)
 *  3. Web-usage discipline (§13-15)
 *  4. Collaborative protocol stages with injected providers (§9): independent
 *     analysis → compare → verification → consensus → single FBT answer (§37)
 *  5. Fact consensus — AI agreement alone is NOT verification (§11)
 *  6. Disagreement handling — never forced consensus (§38)
 *  7. Uncertainty engine (§39) & answer quality score (§36)
 *  8. Provider health + circuit breaker + graceful degradation (§46-48)
 *  9. Security: no secrets to models, no secrets in analytics (§44, §28)
 * 10. Source tiering (§21) & news impact scoring shape (§19)
 * 11. Customer Question Intelligence: clustering (§29), gaps (§31), FAQ
 *     candidates DRAFT-only (§32), feedback taxonomy (§64)
 * 12. Knowledge Center retrieval + versioning (§55-57)
 * 13. Full evaluation corpus regression (§35, §65-66)
 *
 * Runs fully offline: no provider keys → internal engine only; the multi-model
 * stages are exercised through injected fake providers. No network calls.
 */

import assert from 'node:assert/strict';
import {
  planCollaboration,
  classifyConversationKind,
  classifyFreshness,
  classifyComplexity,
  detectEmotion,
  detectFomo,
  determineCollaborationLevel,
  needsWebResearch,
  decideAnswerPath,
  CONVERSATION_KINDS
} from '../../src/lib/intent-ai/os/collaborationRouter.js';

import {
  clusterQuestion,
  containsSecretMaterial,
  redactForStorage,
  detectKnowledgeGaps,
  buildFaqCandidate,
  classifyFeedbackReason,
  FEEDBACK_REASONS
} from '../../src/lib/intent-ai/os/questionIntel.js';

import {
  searchKnowledge,
  listKnowledge,
  getKnowledgeItem,
  knowledgeStats,
  FBT_KNOWLEDGE
} from '../../src/lib/intent-ai/os/knowledgeCenter.js';

import {
  EVAL_QUESTIONS,
  runEvaluation,
  validateCorpusCoverage,
  REQUIRED_EVAL_CATEGORIES
} from '../../src/lib/intent-ai/os/evaluationSuite.js';

import {
  runCollaborativeAnalysis,
  compareAnalyses,
  verifyClaims,
  computeUncertainty,
  scoreAnswerQuality,
  buildSafeContextBlock,
  formatEmotionalAcknowledgement,
  recordProviderCall,
  isProviderHealthy,
  getProviderHealth,
  resetProviderHealth
} from '../../server/aiCollaboration.js';

import {
  classifySourceTier,
  extractNewsEntities,
  analyzeNewsImpact
} from '../../server/aiWebResearch.js';

import {
  recordQuestion,
  recordAnswerFeedback,
  getQuestionAnalytics,
  getKnowledgeGaps,
  getFaqCandidates,
  getQualityDashboard,
  _resetQuestionIntelMemory
} from '../../server/aiQuestionIntel.js';

import { readFileSync } from 'node:fs';

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    const r = fn();
    if (r instanceof Promise) throw new Error('async test not awaited');
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function atest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/*  FAKE PROVIDER FLEET — exercises the real stages without network            */
/* -------------------------------------------------------------------------- */

function makeFakeFleet({ bias = 'same', failing = false } = {}) {
  const calls = [];
  const execute = async (providerId, opts) => {
    calls.push({ providerId, system: String(opts.system || '').slice(0, 60) });
    if (failing) throw new Error('PROVIDER_DOWN');
    const sys = String(opts.system || '');
    if (sys.includes('Market AI')) {
      return {
        provider: providerId, model: 'fake-market', durationMs: 5,
        text: JSON.stringify({
          answer: bias === 'opposite'
            ? 'به نظر می‌رسد فشار خرید در حال افزایش است و روند صعودی محتمل است.'
            : 'فشار فروش امروز محسوس بود و روند کوتاه‌مدت نزولی به نظر می‌رسد.',
          claims: [{ claim: 'قیمت بیت کوین 108000 دلار است', type: 'factual', confidence: 88 }],
          uncertainty: 'داده کلان فردا منتشر می‌شود'
        })
      };
    }
    if (sys.includes('Risk AI')) {
      return {
        provider: providerId, model: 'fake-risk', durationMs: 5,
        text: JSON.stringify({
          answer: 'ریسک نزول بیشتر منتفی نیست؛ مدیریت پوزیشن ضروری است.',
          claims: [{ claim: 'سطح حمایت بعدی 105000 است', type: 'factual', confidence: 50 }],
          uncertainty: 'سطوح حمایت قابل اتکا نیستند'
        })
      };
    }
    if (sys.includes('Verification AI')) {
      return {
        provider: providerId, model: 'fake-verif', durationMs: 5,
        text: JSON.stringify({ answer: 'ادعای قیمت با داده ابزار هم‌خوانی دارد؛ ادعای حمایت بدون شاهد است.', claims: [], uncertainty: 'منبع نامشخص' })
      };
    }
    return {
      provider: providerId, model: 'fake-final', durationMs: 5,
      text: JSON.stringify({
        answer: 'جمع‌بندی FBT: بر اساس داده زنده و منابع، فشار فروش امروز محسوس بود اما این تحلیل قطعی نیست.',
        claims: [], uncertainty: 'وابسته به رویدادهای پیش‌رو'
      })
    };
  };
  return { execute, selectProviders: () => ['fake-a', 'fake-b'], calls };
}

const MARKET_CTX = { market: { priceMap: { BTC: 108000, ETH: 2500 }, change24hPct: -4.2, dataStatus: 'live' } };
const WEB_EVIDENCE = async () => ({
  ok: true,
  sources: [
    { title: 'Fed decision hits crypto', url: 'https://www.coindesk.com/a', snippet: 'bitcoin fell to 108000 as risk assets dropped', tier: 2 },
    { title: 'Macro wrap', url: 'https://www.theblock.co/b', snippet: 'BTC dropped 4% on macro pressure today', tier: 2 }
  ],
  corroborated: true,
  sourceCount: 2
});

async function runAll() {
  console.log('\n=== FBT SMART INTENT OS — UPGRADE 5 PROBE ===\n');

  /* ---------------------------------------------------------------------- */
  console.log('--- Suite 1: Question Analyzer — kinds, emotion, FOMO, freshness ---');

  test('greetings never trigger tools or web (§14, §23)', () => {
    for (const msg of ['سلام', 'سلام خوبی؟', 'صبح بخیر', 'خسته نباشی', 'hi', 'good morning']) {
      const a = planCollaboration({ message: msg });
      assert.equal(a.conversationKind, 'GREETING', `${msg} should be GREETING`);
      assert.equal(a.needsWeb, false, `${msg} must not use web`);
      assert.equal(a.level, 1, `${msg} must stay at level 1`);
      assert.equal(a.answerPath, 'CONVERSATION');
    }
  });

  test('thanks never re-explain finance (§24)', () => {
    for (const msg of ['ممنون', 'مرسی', 'دمت گرم', 'خیلی کمک کردی', 'thanks']) {
      const a = planCollaboration({ message: msg });
      assert.equal(a.conversationKind, 'THANKS', msg);
      assert.equal(a.level, 1, msg);
    }
  });

  test('greeting wearing an action stays an action', () => {
    const a = planCollaboration({ message: 'سلام، BTC بخر' });
    assert.equal(a.conversationKind, 'ACTION');
  });

  test('fear and panic detection (§26)', () => {
    assert.equal(detectEmotion('میترسم ضرر کنم').state, 'fearful');
    assert.equal(detectEmotion('خیلی نگرانم').state, 'fearful');
    assert.equal(detectEmotion('وای داره می‌ریزه').state, 'panic');
    assert.equal(detectEmotion('احساس میکنم بازار می‌ریزه').state, 'panic');
    assert.equal(detectEmotion('کار نمیکنه لعنتی').state, 'frustrated');
    assert.equal(detectEmotion('نمیدونم چیکار کنم').state, 'uncertain');
    assert.equal(detectEmotion('سلام').state, 'calm');
  });

  test('FOMO detection without amplification flag (§27)', () => {
    assert.equal(detectFomo('الان بخرم جا نمونم؟').detected, true);
    assert.equal(detectFomo('همین الان دو برابر میشه؟').detected, true);
    assert.equal(detectFomo('بیت کوین چیست').detected, false);
    const a = planCollaboration({ message: 'الان بخرم جا نمونم؟' });
    assert.equal(a.fomo.detected, true);
    assert.equal(a.requiresExecutionGuard, true);
  });

  test('freshness classification (§15)', () => {
    assert.equal(classifyFreshness('BTC چیست؟'), 'STATIC');
    assert.equal(classifyFreshness('چرا BTC امروز افت کرد؟'), 'LIVE');
    assert.equal(classifyFreshness('اخبار امروز BTC چیست؟'), 'LIVE');
    assert.equal(classifyFreshness('این خبر همین الان چه اثری دارد؟'), 'BREAKING');
    assert.equal(classifyFreshness('این هفته چه گذشت'), 'RECENT');
  });

  test('web usage rules (§13-14)', () => {
    assert.equal(needsWebResearch({ freshness: 'LIVE', conversationKind: 'QUESTION' }), true);
    assert.equal(needsWebResearch({ freshness: 'STATIC', conversationKind: 'QUESTION' }), false);
    assert.equal(needsWebResearch({ freshness: 'LIVE', conversationKind: 'GREETING' }), false);
    assert.equal(needsWebResearch({ freshness: 'LIVE', conversationKind: 'ACTION' }), false);
  });

  test('question → tool decision ladder (§42-43)', () => {
    assert.equal(decideAnswerPath({ conversationKind: 'GREETING', freshness: 'STATIC' }), 'CONVERSATION');
    assert.equal(decideAnswerPath({ conversationKind: 'QUESTION', freshness: 'STATIC', intentType: 'WALLET_BALANCE' }), 'TOOL');
    assert.equal(decideAnswerPath({ conversationKind: 'QUESTION', freshness: 'LIVE', intentType: 'GENERAL' }), 'WEB');
    assert.equal(decideAnswerPath({ conversationKind: 'QUESTION', freshness: 'STATIC', intentType: 'GENERAL', complexity: 'COMPLEX' }), 'MULTI_AI');
    assert.equal(decideAnswerPath({ conversationKind: 'QUESTION', freshness: 'STATIC', intentType: 'LEARN', entities: { token: 'BTC' } }), 'KNOWLEDGE');
  });

  test('collaboration levels — cost law (§45)', () => {
    assert.equal(determineCollaborationLevel({ conversationKind: 'GREETING', complexity: 'SIMPLE', freshness: 'STATIC', needsWeb: false }), 1);
    assert.equal(determineCollaborationLevel({ conversationKind: 'QUESTION', complexity: 'HIGH_STAKES', freshness: 'LIVE', needsWeb: true }), 5);
    assert.equal(determineCollaborationLevel({ conversationKind: 'QUESTION', complexity: 'COMPLEX', freshness: 'LIVE', needsWeb: true }), 4);
    assert.equal(determineCollaborationLevel({ conversationKind: 'QUESTION', complexity: 'MEDIUM', freshness: 'LIVE', needsWeb: true }), 3);
    assert.equal(determineCollaborationLevel({ conversationKind: 'QUESTION', complexity: 'MEDIUM', freshness: 'STATIC', needsWeb: false }), 2);
    // «BTC چیست؟» must NEVER reach level 5
    const a = planCollaboration({ message: 'BTC چیست؟' });
    assert.ok(a.level <= 2, `BTC چیست reached level ${a.level}`);
  });

  test('complexity classes (§4)', () => {
    assert.equal(classifyComplexity('الان همه پولم رو بیت کوین بخرم؟', { conversationKind: 'QUESTION', freshness: 'LIVE' }), 'HIGH_STAKES');
    assert.equal(classifyComplexity('آیا این خبر می‌تواند باعث ریزش BTC شود؟', { conversationKind: 'QUESTION', freshness: 'RECENT' }), 'COMPLEX');
    assert.equal(classifyComplexity('چرا بیت کوین امروز افت کرد؟', { conversationKind: 'QUESTION', freshness: 'LIVE' }), 'MEDIUM');
    assert.equal(classifyComplexity('ممنون', { conversationKind: 'THANKS', freshness: 'STATIC' }), 'SIMPLE');
  });

  test('follow-ups resolve against the previous turn (§41)', () => {
    assert.equal(classifyConversationKind('چرا؟', { priorIntent: 'MARKET_ANALYSIS' }), 'FOLLOW_UP');
    assert.equal(classifyConversationKind('خب حالا چی؟', { priorIntent: 'MARKET_ANALYSIS' }), 'FOLLOW_UP');
    assert.equal(classifyConversationKind('tell me more', { priorIntent: 'ANALYZE_TOKEN' }), 'FOLLOW_UP');
    // decision question ≠ execution command
    assert.equal(classifyConversationKind('پس بفروشم؟', { priorIntent: 'MARKET_ANALYSIS' }), 'QUESTION');
    assert.equal(classifyConversationKind('بفروش', {}), 'ACTION');
  });

  test('personalization guard — no asset, no guess (§40)', () => {
    const a = planCollaboration({ message: 'این ارز خوبه؟', context: { currentPage: '/' } });
    assert.equal(a.needsAssetClarification, true);
    const b = planCollaboration({ message: 'این ارز خوبه؟', context: { currentPage: '/coin/BTC' } });
    assert.equal(b.needsAssetClarification, false);
  });

  /* ---------------------------------------------------------------------- */
  console.log('\n--- Suite 2: Collaborative Protocol Stages (§9) with fake providers ---');

  await atest('level 4 runs market+risk in parallel, verification, one final answer', async () => {
    resetProviderHealth();
    const fleet = makeFakeFleet();
    const r = await runCollaborativeAnalysis({
      message: 'آیا این خبر می‌تواند باعث ریزش BTC شود؟',
      locale: 'fa',
      context: MARKET_CTX,
      deps: { ...fleet, research: WEB_EVIDENCE },
      deadlineMs: 5000
    });
    assert.equal(r.level, 4);
    assert.ok(r.answer.includes('جمع‌بندی'), 'final answer should be the synthesized one');
    assert.ok(!/fake-market|fake-risk/.test(r.answer), 'user never sees per-model output (§37)');
    assert.ok(r.providersUsed.length > 0);
    assert.ok(fleet.calls.length >= 4, `expected >=4 provider calls, got ${fleet.calls.length}`);
    assert.equal(r.evidence.webUsed, true);
    assert.equal(r.evidence.toolDataUsed, true);
    assert.ok(r.quality?.answerQualityScore > 0);
    assert.ok(r.uncertainty);
  });

  await atest('fact consensus — tool/web-backed vs AI-only claims (§11)', async () => {
    const fleet = makeFakeFleet();
    const r = await runCollaborativeAnalysis({
      message: 'آیا این خبر می‌تواند باعث ریزش BTC شود؟',
      locale: 'fa',
      context: MARKET_CTX,
      deps: { ...fleet, research: WEB_EVIDENCE },
      deadlineMs: 5000
    });
    // "قیمت بیت کوین 108000" is supported by tool data / web evidence
    assert.ok(r.verifiedClaims.some((c) => c.claim.includes('108000')), 'price claim must be verified by evidence');
    // "سطح حمایت بعدی 105000" has no evidence → aiConsensusOnly
    assert.ok(r.aiConsensusOnly.some((c) => c.claim.includes('105000')), 'unsupported claim must be marked aiConsensusOnly');
  });

  await atest('disagreement is never forced into false consensus (§38)', async () => {
    const fleet = makeFakeFleet({ bias: 'opposite' });
    const r = await runCollaborativeAnalysis({
      message: 'آیا این خبر روی بازار تاثیر مثبت دارد یا منفی؟',
      locale: 'fa',
      context: MARKET_CTX,
      deps: { ...fleet, research: WEB_EVIDENCE },
      deadlineMs: 5000
    });
    assert.equal(r.disagreement, true, 'opposing stances must be flagged');
    assert.equal(r.consensus.reached, false);
    assert.ok(r.consensus.note, 'disagreement must be communicated');
  });

  test('compareAnalyses — agreement math', () => {
    const analyses = [
      { ok: true, role: 'market', answer: 'روند نزولی است', claims: [] },
      { ok: true, role: 'risk', answer: 'خطر ریزش بیشتر', claims: [] }
    ];
    const cmp = compareAnalyses(analyses);
    assert.equal(cmp.agreement, '2/2');
    assert.equal(cmp.disagreement, false);
  });

  test('verifyClaims — social media never verifies (§21)', () => {
    const v = verifyClaims({
      factualClaims: [{ claim: 'token X listed on Binance today', confidence: 90 }],
      context: {},
      sources: [{ title: 'token X listed', snippet: 'token X listed on Binance today', tier: 4 }]
    });
    assert.equal(v.verified.length, 0);
    assert.equal(v.aiConsensusOnly.length, 1);
  });

  test('uncertainty engine (§39)', () => {
    const u = computeUncertainty({
      analyses: [{ ok: true, claims: [{ confidence: 40 }] }],
      comparison: { disagreement: true },
      evidence: { toolDataUsed: false, webUsed: false, knowledgeUsed: false },
      freshness: 'LIVE'
    });
    assert.equal(u.level, 'HIGH');
    const u2 = computeUncertainty({
      analyses: [{ ok: true, claims: [{ confidence: 90 }] }],
      comparison: { disagreement: false },
      evidence: { toolDataUsed: true },
      freshness: 'LIVE'
    });
    assert.ok(u2.level === 'LOW' || u2.level === 'MEDIUM');
  });

  test('quality score dimensions (§36)', () => {
    const q = scoreAnswerQuality({
      answer: 'تحلیل با ریسک و عدم قطعیت همراه است و مبتنی بر داده زنده است',
      uncertainty: { freshness: 'LIVE', level: 'LOW' },
      evidence: { toolDataUsed: true },
      sources: [{ tier: 2 }],
      comparison: {},
      degraded: false
    });
    assert.ok(q.answerQualityScore >= 0 && q.answerQualityScore <= 100);
    assert.ok(q.hallucinationRisk < 40, 'grounded answers carry low hallucination risk');
    const q2 = scoreAnswerQuality({ answer: '', uncertainty: { freshness: 'LIVE', level: 'HIGH' }, evidence: {}, sources: [], comparison: {}, degraded: true });
    assert.ok(q2.answerQualityScore < q.answerQualityScore, 'degraded empty answers score lower');
  });

  /* ---------------------------------------------------------------------- */
  console.log('\n--- Suite 3: Provider health, circuit breaker, degradation (§46-48) ---');

  test('circuit breaker opens after consecutive failures', () => {
    resetProviderHealth();
    for (let i = 0; i < 4; i++) recordProviderCall('flaky', { ok: false, durationMs: 100 });
    assert.equal(isProviderHealthy('flaky'), false, 'circuit must be open');
    const health = getProviderHealth();
    assert.equal(health.flaky.circuitOpen, true);
    assert.equal(health.flaky.availability, 'DEGRADED');
    // success resets the streak
    recordProviderCall('flaky', { ok: true, durationMs: 10 });
    resetProviderHealth();
  });

  test('provider health aggregates latency and success', () => {
    resetProviderHealth();
    recordProviderCall('p1', { ok: true, durationMs: 100 });
    recordProviderCall('p1', { ok: true, durationMs: 200 });
    recordProviderCall('p1', { ok: false, durationMs: 50 });
    const h = getProviderHealth().p1;
    assert.equal(h.calls, 3);
    assert.equal(h.avgLatencyMs, Math.round(350 / 3));
    assert.ok(Math.abs(h.successRate - 0.67) < 0.01);
    resetProviderHealth();
  });

  await atest('all providers failing → honest degraded answer, never invention', async () => {
    const fleet = makeFakeFleet({ failing: true });
    const r = await runCollaborativeAnalysis({
      message: 'آیا این خبر می‌تواند باعث ریزش BTC شود؟',
      locale: 'fa',
      context: MARKET_CTX,
      deps: { ...fleet, research: async () => ({ ok: false, sources: [] }) },
      deadlineMs: 5000
    });
    assert.equal(r.degraded, true);
    assert.ok(r.answer.length > 0, 'must still answer honestly');
    assert.ok(r.answer.includes('108'), 'degraded answer must still carry the live tool data it has');
  });

  await atest('no external AI configured → knowledge-grounded answer, no fabrication', async () => {
    // No deps injected and no provider keys in this environment → internal only
    const r = await runCollaborativeAnalysis({ message: 'بیت کوین چیست؟', locale: 'fa' });
    assert.equal(r.degraded, true);
    assert.equal(r.evidence.knowledgeUsed, true);
    assert.ok(r.answer.includes('غیرمتمرکز'), 'answer must come from the verified knowledge item');
  });

  await atest('greeting costs zero provider calls (§4)', async () => {
    const fleet = makeFakeFleet();
    const before = fleet.calls.length;
    const r = await runCollaborativeAnalysis({ message: 'سلام', locale: 'fa', deps: fleet });
    assert.equal(r.level, 1);
    assert.equal(fleet.calls.length, before, 'greetings must not call any model');
    assert.ok(r.answer.length > 0);
  });

  /* ---------------------------------------------------------------------- */
  console.log('\n--- Suite 4: Security boundaries (§28, §44, §67) ---');

  test('secret material never enters question analytics', () => {
    assert.equal(containsSecretMaterial('private key: 0x' + 'ab'.repeat(32)), true);
    assert.equal(containsSecretMaterial('my seed phrase is abandon ability able about above'), true);
    assert.equal(containsSecretMaterial('قیمت بیت کوین چنده'), false);
    assert.equal(redactForStorage('کیف من 0x' + 'ab'.repeat(20) + ' است'), 'کیف من [ADDR] است');
  });

  test('safe context block excludes addresses and keys (§44)', () => {
    const block = buildSafeContextBlock({
      context: {
        market: { priceMap: { BTC: 100 } },
        portfolio: { totalValueUsd: 5000, holdings: [{ symbol: 'BTC', valueUsd: 5000 }] }
      }
    });
    assert.ok(block.includes('BTC'), 'aggregate market data allowed');
    assert.ok(!/0x[a-fA-F0-9]{40}/.test(block), 'no raw addresses in model context');
    assert.ok(block.includes('weights=BTC:100%'), 'portfolio appears only as aggregate weights');
  });

  test('emotional acknowledgement: no false reassurance (§25)', () => {
    const fear = formatEmotionalAcknowledgement({ emotion: { state: 'fearful' }, fomo: {}, locale: 'fa' });
    assert.ok(fear && fear.includes('طبیعی است'), 'acknowledges the concern');
    assert.ok(!/حتما|قطعاً|نگران نباش|مطمئن باش/.test(fear), 'no false reassurance');
    const fomo = formatEmotionalAcknowledgement({ emotion: { state: 'calm' }, fomo: { detected: true }, locale: 'fa' });
    assert.ok(fomo && fomo.includes('ریسک'), 'FOMO gets risk framing, not hype');
    assert.equal(formatEmotionalAcknowledgement({ emotion: { state: 'calm' }, fomo: {}, locale: 'fa' }), null);
  });

  test('execution path is untouched by collaboration (§67)', () => {
    // The chat pipeline must not let Upgrade 5 create pending intents or actions
    const src = readFileSync(new URL('../../server/aiIntentOS.js', import.meta.url), 'utf8');
    assert.ok(src.includes('runCollaborativeAnalysis'), 'collaboration is wired into /chat');
    // The collaboration result never feeds actions/actionPlan/pending/execute fields
    assert.ok(!/collaboration\??\.(actions|actionPlan|pendingIntent|execute)/.test(src), 'collaboration output must never become an action');
    assert.ok(!/(actions|actionPlan|pendingIntent|requiresUserSignature)\s*[:=][^,\n]*collaboration/.test(src), 'no reply execution field may read from collaboration');
    // The only reply fields sourced from collaboration are text + intelligence metadata
    assert.ok(/collaborationUsable/.test(src) && /intelligence:\s*{/.test(src));
  });

  /* ---------------------------------------------------------------------- */
  console.log('\n--- Suite 5: Web research & news impact (§12, §18-22) ---');

  test('source tiering (§21)', () => {
    assert.equal(classifySourceTier('https://ethereum.org/en/roadmap'), 1);
    assert.equal(classifySourceTier('https://www.sec.gov/news'), 1);
    assert.equal(classifySourceTier('https://www.coindesk.com/markets/x'), 2);
    assert.equal(classifySourceTier('https://www.reuters.com/tech'), 2);
    assert.equal(classifySourceTier('https://cryptoslate.com/x'), 3);
    assert.equal(classifySourceTier('https://x.com/someuser/status/1'), 4);
    assert.equal(classifySourceTier('https://reddit.com/r/x'), 4);
    assert.equal(classifySourceTier('https://unknown-blog.example/x'), 3);
  });

  test('news entity + event extraction (§18)', () => {
    const e1 = extractNewsEntities('The SEC approved a new bitcoin ETF yesterday');
    assert.ok(e1.assets.includes('BTC'));
    assert.ok(['ETF_FLOW', 'REGULATION'].includes(e1.eventClass));
    const e2 = extractNewsEntities('هک صرافی بزرگ و سرقت اتریوم');
    assert.equal(e2.eventClass, 'HACK_EXPLOIT');
    assert.ok(e2.assets.includes('ETH'));
    const e3 = extractNewsEntities('نرخ بهره فدرال رزرو افزایش یافت');
    assert.equal(e3.eventClass, 'MACRO');
  });

  await atest('news impact score shape — analytical, capped, never certain (§19-20)', async () => {
    const impact = await analyzeNewsImpact({
      news: 'Federal reserve raises interest rates by 50bps',
      locale: 'fa',
      marketContext: MARKET_CTX,
      webEvidence: { corroborated: false, sourceCount: 1, sources: [{ title: 'x', snippet: 'y', tier: 4 }] }
    });
    assert.equal(impact.ok, true);
    assert.ok(['positive', 'negative', 'neutral', 'mixed'].includes(impact.impactDirection));
    assert.ok(impact.impactStrength >= 0 && impact.impactStrength <= 100);
    assert.ok(impact.confidence <= 60, 'single-source news confidence must be capped at 60');
    assert.ok(['immediate', 'short', 'medium', 'long'].includes(impact.timeHorizon));
    assert.ok(impact.bullScenario !== undefined && impact.bearScenario !== undefined && impact.neutralScenario !== undefined);
    assert.ok(impact.disclaimer.includes('قطعی') || impact.disclaimer.length > 0, 'never claims certainty');
    assert.equal(impact.corroboration.treatedAs, 'lead-only');
  });

  /* ---------------------------------------------------------------------- */
  console.log('\n--- Suite 6: Customer Question Intelligence (§28-33, §62-64) ---');

  test('question clustering — spec examples (§29)', () => {
    for (const q of ['BTC چطوره؟', 'بیت کوین چه وضعیه؟', 'نظرت درباره بیت کوین چیه؟', 'بیت کوین الان خوبه؟']) {
      assert.equal(clusterQuestion(q).clusterId, 'MARKET_OUTLOOK', q);
    }
    for (const q of ['چطور USDT بخرم؟', 'با تومان تتر بخرم؟', 'خرید تتر چطوریه؟']) {
      assert.equal(clusterQuestion(q).clusterId, 'USDT_PURCHASE', q);
    }
    assert.equal(clusterQuestion('آیا کیف پول من امن است؟').clusterId, 'WALLET_SECURITY');
    assert.equal(clusterQuestion('این خبر روی BTC چه تاثیری داره؟').clusterId, 'NEWS_IMPACT');
    assert.equal(clusterQuestion('میترسم ضرر کنم').clusterId, 'RISK_FEAR');
    assert.equal(clusterQuestion('سلام').clusterId, 'GREETING');
    assert.equal(clusterQuestion('ممنون').clusterId, 'THANKS');
  });

  await atest('analytics, gaps and DRAFT-only FAQ candidates (§30-32)', async () => {
    _resetQuestionIntelMemory();
    const seed = [
      ['BTC چطوره؟', { resolved: true, confidenceScore: 80 }],
      ['بیت کوین چه وضعیه؟', { resolved: true, confidenceScore: 75 }],
      ['نظرت درباره بیت کوین چیه', { resolved: false, clarificationAsked: true, confidenceScore: 40 }],
      ['چطور USDT بخرم؟', { resolved: false, clarificationAsked: true, confidenceScore: 40 }],
      ['با تومان تتر بخرم؟', { resolved: false, confidenceScore: 35 }],
      ['خرید تتر چطوریه؟', { resolved: false, clarificationAsked: true, confidenceScore: 30 }],
      ['میترسم ضرر کنم', { resolved: false, confidenceScore: 45 }],
      ['میترسم پولم رو از دست بدم', { resolved: false, confidenceScore: 40 }],
      ['استرس دارم از بازار', { resolved: false, clarificationAsked: true, confidenceScore: 30 }]
    ];
    for (const [msg, meta] of seed) await recordQuestion({ message: msg, ...meta });

    const rejected = await recordQuestion({ message: 'seed phrase: abandon ability able about above absent absorb abstract absurd abuse access accident' });
    assert.equal(rejected.rejected, 'SECRET_MATERIAL_DETECTED', 'seed phrases must be rejected before storage');

    const analytics = await getQuestionAnalytics();
    const usdt = analytics.topQuestions.find((q) => q.clusterId === 'USDT_PURCHASE');
    assert.ok(usdt && usdt.count === 3, 'USDT variants cluster into one row');
    assert.equal(usdt.resolutionRate, 0);
    assert.ok(usdt.clarificationRate > 0.3);
    assert.ok(analytics.highRiskQuestions.some((q) => q.clusterId === 'USDT_PURCHASE' || q.clusterId === 'RISK_FEAR'));

    const gaps = await getKnowledgeGaps();
    assert.ok(gaps.gaps.some((g) => g.clusterId === 'USDT_PURCHASE'), 'weak USDT answers must surface as a gap');
    assert.ok(gaps.gaps.every((g) => g.recommendation?.action), 'every gap carries a recommendation');

    const faqs = await getFaqCandidates();
    assert.ok(faqs.candidates.length > 0);
    for (const f of faqs.candidates) {
      assert.equal(f.status, 'draft');
      assert.equal(f.reviewed, false);
      assert.equal(f.publishable, false, 'FAQ candidates are never auto-publishable (§32)');
    }
  });

  test('feedback taxonomy (§64)', () => {
    assert.equal(classifyFeedbackReason('جواب غلط بود'), 'incorrect');
    assert.equal(classifyFeedbackReason('outdated info'), 'outdated');
    assert.equal(classifyFeedbackReason('too long'), 'too_long');
    assert.equal(classifyFeedbackReason('منظورم رو نفهمید'), 'wrong_intent');
    assert.equal(classifyFeedbackReason(''), null);
    assert.ok(FEEDBACK_REASONS.includes('missing_data'));
  });

  await atest('quality dashboard aggregates feedback into evaluation (§63)', async () => {
    await recordAnswerFeedback({ intentId: 'int_a', rating: -1, reason: 'قیمت اشتباه بود' });
    await recordAnswerFeedback({ intentId: 'int_b', rating: 1 });
    const dash = await getQualityDashboard();
    assert.ok(dash.feedback.thumbsUp >= 1 && dash.feedback.thumbsDown >= 1);
    assert.ok(dash.feedback.hallucinationReports >= 1, 'incorrect/outdated feedback counts as hallucination report');
    assert.ok(dash.questions.total > 0);
    assert.ok(dash.providerHealth !== undefined);
  });

  /* ---------------------------------------------------------------------- */
  console.log('\n--- Suite 7: Knowledge Center (§55-57) ---');

  test('retrieval returns relevant, versioned items', () => {
    const r = searchKnowledge('کلید خصوصی من کجا نگهداری می شود', { locale: 'fa' });
    assert.ok(r.length > 0);
    assert.ok(r[0].id.startsWith('kb.wallet'));
    assert.ok(r[0].version >= 1 && r[0].status && r[0].source, 'items carry versioning metadata');
  });

  test('product questions retrieve product knowledge (English)', () => {
    const r = searchKnowledge('is my wallet safe non-custodial', { locale: 'en' });
    assert.ok(r.length > 0, 'English retrieval works');
  });

  test('knowledge base facts are product-real and statuses valid', () => {
    for (const k of FBT_KNOWLEDGE) {
      assert.ok(['verified', 'unverified', 'deprecated'].includes(k.status), `${k.id} status`);
      assert.ok(k.id && k.version && k.category && k.source, `${k.id} metadata`);
    }
    const stats = knowledgeStats();
    assert.ok(stats.total >= 10);
    assert.equal(listKnowledge({ category: 'SWAP' }).every((i) => i.category === 'SWAP'), true);
    assert.ok(getKnowledgeItem('kb.wallet.never-asks'));
  });

  /* ---------------------------------------------------------------------- */
  console.log('\n--- Suite 8: Evaluation corpus regression (§35, §65-66) ---');

  test('corpus covers all required categories', () => {
    const cov = validateCorpusCoverage();
    assert.equal(cov.ok, true, `missing categories: ${cov.missing.join(',')}`);
    assert.ok(cov.total >= 150, `corpus too small: ${cov.total}`);
    for (const cat of REQUIRED_EVAL_CATEGORIES) assert.ok(cov.categories.includes(cat), cat);
  });

  test('full corpus passes the analyzer at 100% (§66 gate)', () => {
    const r = runEvaluation();
    if (r.failed > 0) {
      console.error('    failures:');
      for (const f of r.failures.slice(0, 10)) console.error(`      ${f.id} "${f.text}" → ${f.failures.join('; ')}`);
    }
    assert.equal(r.accuracy, 1, `accuracy ${r.accuracy} (${r.passed}/${r.total})`);
    assert.ok(EVAL_QUESTIONS.length >= 150);
  });

  test('wiring: Upgrade 5 endpoints are registered in the AI OS router', () => {
    const src = readFileSync(new URL('../../server/aiIntentOS.js', import.meta.url), 'utf8');
    for (const route of ['/collaborate', '/research', '/news-impact', '/feedback', '/questions/analytics', '/questions/gaps', '/questions/faq-candidates', '/quality', '/knowledge', '/knowledge/search']) {
      assert.ok(src.includes(`router.post('${route}'`) || src.includes(`router.get('${route}'`), `missing route ${route}`);
    }
    // analytics endpoints are admin-gated (§62)
    const analyticsIdx = src.indexOf("router.get('/questions/analytics'");
    const gateSlice = src.slice(analyticsIdx, analyticsIdx + 200);
    assert.ok(gateSlice.includes('adminSecretOk'), 'analytics must be behind the admin gate');
    // intelligence metadata travels with the reply
    assert.ok(src.includes("schema: 'fbt.intelligence-meta.v1'"));
    // questions are recorded for customer question intelligence
    assert.ok(src.includes('recordQuestion({'), 'chat must record anonymized questions');
  });

  console.log(`\n=== UPGRADE 5 PROBE RESULT: ${passedTests}/${totalTests} passed ===\n`);
  if (passedTests !== totalTests) process.exit(1);
}

runAll().catch((err) => {
  console.error(`\nUPGRADE 5 PROBE FAILED: ${err.message}\n`);
  process.exit(1);
});
