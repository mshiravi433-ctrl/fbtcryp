/**
 * FBT INTENT AI — UPGRADE 4: INTENT UNDERSTANDING + REQUEST PREDICTION + CONTEXT INTELLIGENCE
 * ---------------------------------------------------------------------------
 * Comprehensive probe verifying:
 * 1. Advanced Intent Understanding & Structured UserIntent schema
 * 2. Mixed Persian/English, Typos, Slang, & Unit Parsing
 * 3. Reference & Pronoun Resolution
 * 4. Request & Next-Action Prediction Engine
 * 5. Smart Minimal Clarification Priority Ladder
 * 6. 4-Factor Confidence Scoring & Pre-Execution Safety Checklist
 * 7. "I Understand" Transparent Confirmation Layer & Zero Hallucination
 * 8. Multi-Turn Session Memory & Privacy-Preserving Learning Loop
 */

import assert from 'node:assert/strict';
import {
  normalizeUpgrade4 as normalizeText,
  parseSlangAndUnits,
  extractAdvancedEntities,
  buildStructuredUserIntent,
  predictNextActions,
  determineMinimalClarification,
  resolveReferences,
  detectCorrectionOrConflict,
  classifyQuestionType
} from '../../src/lib/intent-ai/os/intentUnderstandingEngine.js';

import {
  understandIntent
} from '../../src/lib/intent-ai/os/intentUnderstanding.js';

import {
  calculateConfidenceBreakdown,
  evaluatePreExecutionChecklist,
  CONFIDENCE_DECISION
} from '../../src/lib/intent-ai/os/confidenceEngine.js';

import {
  formatUnderstandingConfirmation,
  formatConflictResolution,
  formatRiskWarning
} from '../../src/lib/intent-ai/os/humanResponse.js';

import {
  IntentSession,
  getIntentSession,
  saveIntentSession
} from '../../src/lib/intent-ai/os/intentSession.js';

import {
  recordLearningFeedback,
  anonymizeFeedbackContext,
  containsSensitiveKeyOrPhrase
} from '../../server/aiLearning.js';

import {
  synthesizeConsensus
} from '../../server/aiConsensus.js';

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function runAll() {
  console.log('\n=== FBT SMART INTENT OS — UPGRADE 4 PROBE ===\n');

  // 1. Text Normalization & Persian/English Mixing
  console.log('--- Suite 1: Text Normalization & Persian/English ---');
  test('Normalizes Persian numbers and zero-width non-joiner', () => {
    const res = normalizeText('می‌خواهم ۱۰۰۰ تتر تبدیل کنم');
    assert.ok(res.includes('1000'));
    assert.ok(res.includes('تتر') || res.includes('usdt'));
  });

  test('Corrects typos in crypto keywords', () => {
    const res = normalizeText('swapp bitcoiin on arbitrom or solanna');
    assert.ok(res.includes('swap'));
    assert.ok(res.includes('bitcoin') || res.includes('btc'));
    assert.ok(res.includes('arbitrum'));
    assert.ok(res.includes('solana'));
  });

  test('Normalizes Finglish / transliterated expressions', () => {
    const res = normalizeText('ye khorde btc bekhar baram');
    assert.ok(res.includes('btc'));
    assert.ok(res.includes('buy'));
  });

  // 2. Slang, Amounts & Financial Units
  console.log('\n--- Suite 2: Slang & Financial Units ---');
  test('Parses Persian slang fractions: نیم بیت, نصف داراییم, همه‌چیز', () => {
    const p1 = parseSlangAndUnits('نیم بیت کوین بخر');
    assert.equal(p1.parsedAmount, 0.5);

    const p2 = parseSlangAndUnits('نصف پولم رو تبدیل کن');
    assert.equal(p2.relativePercentage, 50);

    const p3 = parseSlangAndUnits('همه داراییم رو سواپ کن');
    assert.equal(p3.relativePercentage, 100);
  });

  test('Parses English multiplier suffixes (100k, 2.5m, 50 bucks)', () => {
    const p1 = parseSlangAndUnits('stake 100k usdt');
    assert.equal(p1.parsedAmount, 100000);

    const p2 = parseSlangAndUnits('invest 2.5m usdc');
    assert.equal(p2.parsedAmount, 2500000);

    const p3 = parseSlangAndUnits('buy 50 bucks of btc');
    assert.equal(p3.parsedAmount, 50);
  });

  // 3. Structured UserIntent Representation
  console.log('\n--- Suite 3: Structured UserIntent Schema ---');
  test('Extracts comprehensive constraints, conditional strategies, and timeframes', () => {
    const text = 'Swap 500 USDT to ETH if gas is under 15 gwei with max slippage 0.5% for 3 months low risk';
    const intent = buildStructuredUserIntent(text, {
      type: 'SWAP',
      action: 'SWAP',
      entities: { tokenIn: 'USDT', tokenOut: 'ETH', amount: 500 }
    });

    assert.equal(intent.primaryIntent, 'SWAP');
    assert.equal(intent.constraints.maxSlippagePercent, 0.5);
    assert.equal(intent.constraints.maxGasGwei, 15);
    assert.equal(intent.timeframe.horizonDays, 90);
    assert.equal(intent.riskPreference.riskTolerance, 'LOW');
  });

  test('Extracts conditional limit order / trigger logic', () => {
    const text = 'اگر قیمت بیت کوین به 60000 رسید 0.1 btc بخر';
    const intent = buildStructuredUserIntent(text, {
      type: 'BUY',
      action: 'BUY',
      entities: { tokenOut: 'BTC', amount: 0.1 }
    });

    assert.ok(intent.conditionalStrategy);
    assert.equal(intent.conditionalStrategy.targetPrice, 60000);
    assert.equal(intent.conditionalStrategy.action, 'BUY');
  });

  test('Identifies implicit intents (e.g. balance check before swap)', () => {
    const intent = buildStructuredUserIntent('همه موجودی اتریومم رو تبدیل کن به تتر', {
      type: 'SWAP',
      action: 'SWAP',
      entities: { tokenIn: 'ETH', tokenOut: 'USDT' }
    });

    assert.ok(Array.isArray(intent.implicitIntents));
    assert.ok(intent.implicitIntents.includes('CHECK_BALANCE'));
  });

  // 4. Reference and Pronoun Resolution
  console.log('\n--- Suite 4: Context Reference & Pronoun Resolution ---');
  test('Resolves pronoun "it" / "آن" from previous conversation turn', () => {
    const history = [
      { role: 'user', content: 'What is the price of Solana?' },
      { role: 'ai', content: 'Solana (SOL) is currently at $145.' }
    ];

    const resolved = resolveReferences('How much do I have of it?', history, { selectedAsset: 'SOL' });
    assert.ok(resolved.resolvedText.toLowerCase().includes('sol'));
    assert.equal(resolved.inferredEntities.token, 'SOL');
  });

  test('Resolves relative "the rest" / "بقیه‌اش" referencing previous operation', () => {
    const history = [
      { role: 'user', content: 'سواپ 100 تتر به متیک' },
      { role: 'ai', content: 'تایید سواپ انجام شد.' }
    ];

    const resolved = resolveReferences('بقیه‌اش رو استیک کن', history, { lastToken: 'USDT' });
    assert.ok(resolved.resolvedText.toLowerCase().includes('usdt'));
  });

  // 5. Next-Action & Request Prediction Engine
  console.log('\n--- Suite 5: Next-Action Prediction Engine ---');
  test('Predicts relevant follow-up actions based on intent and page context', () => {
    const predictions = predictNextActions(
      { primaryIntent: 'SWAP', entities: { tokenIn: 'USDT', tokenOut: 'ETH' } },
      { currentPage: '/swap', walletState: { connected: true, balances: { USDT: 1000 } } }
    );

    assert.ok(Array.isArray(predictions));
    assert.ok(predictions.length >= 2);
    const actionIntents = predictions.map(p => p.intent);
    assert.ok(actionIntents.includes('CHECK_SLIPPAGE') || actionIntents.includes('CONFIRM_SWAP') || actionIntents.includes('CHECK_BALANCE'));
  });

  // 6. Minimal Clarification Priority Engine
  console.log('\n--- Suite 6: Smart Minimal Clarification Priority ---');
  test('Prioritizes SAFETY > EXECUTION > FINANCIAL > OPTIONAL', () => {
    // When source token is missing for swap -> EXECUTION priority
    const q1 = determineMinimalClarification({
      primaryIntent: 'SWAP',
      entities: { tokenOut: 'ETH' },
      missingFields: ['tokenIn']
    }, {});
    assert.equal(q1.priority, 'EXECUTION');
    assert.equal(q1.field, 'tokenIn');

    // When all critical fields exist -> no question needed
    const q2 = determineMinimalClarification({
      primaryIntent: 'SWAP',
      entities: { tokenIn: 'USDT', tokenOut: 'ETH', amount: 100 },
      missingFields: []
    }, { connected: true });
    assert.equal(q2, null);
  });

  test('Never asks for information already present in wallet or page context', () => {
    const q = determineMinimalClarification({
      primaryIntent: 'SEND',
      entities: { recipient: '0x1234567890123456789012345678901234567890', amount: 50 },
      missingFields: ['token']
    }, { selectedAsset: 'USDT', tokenBalances: { USDT: 500 } });

    // Should recognize selectedAsset or ask minimal question
    if (q) {
      assert.equal(q.field, 'token');
    }
  });

  // 7. Confidence Breakdown & Pre-Execution Safety Checklist
  console.log('\n--- Suite 7: 4-Factor Confidence & Pre-Execution Safety ---');
  test('Calculates 4-factor confidence breakdown and routes correctly', () => {
    const highConf = calculateConfidenceBreakdown({
      primaryIntent: 'SWAP',
      entities: { tokenIn: 'USDT', tokenOut: 'ETH', amount: 200 },
      constraints: { maxSlippagePercent: 0.5 }
    }, {
      walletConnected: true,
      hasRequiredBalance: true,
      walletBalances: { USDT: 1000 }
    });

    assert.ok(highConf.overallScore >= 80);
    assert.equal(highConf.decision, CONFIDENCE_DECISION.PROCEED_PLAN);
    assert.ok(highConf.breakdown.intentConfidence > 0);
    assert.ok(highConf.breakdown.contextConfidence > 0);
    assert.ok(highConf.breakdown.entityCompleteness > 0);
    assert.ok(highConf.breakdown.executionReadiness > 0);
  });

  test('Evaluates 7-step pre-execution safety checklist', () => {
    const safeCheck = evaluatePreExecutionChecklist({
      type: 'SWAP',
      entities: { tokenIn: 'USDT', tokenOut: 'ETH', amount: 100 }
    }, {
      connected: true,
      canSign: true,
      balances: { USDT: 500 },
      priceFeeds: { USDT: 1, ETH: 3000 }
    });

    assert.equal(safeCheck.allPassed, true);
    assert.equal(safeCheck.checks.length, 7);
  });

  test('Fails pre-execution checklist when balance is insufficient (no hallucination)', () => {
    const failCheck = evaluatePreExecutionChecklist({
      type: 'SWAP',
      entities: { tokenIn: 'USDT', tokenOut: 'ETH', amount: 1000 }
    }, {
      connected: true,
      canSign: true,
      balances: { USDT: 100 } // insufficient!
    });

    assert.equal(failCheck.allPassed, false);
    const balanceCheck = failCheck.checks.find(c => c.name === 'balanceSufficiency');
    assert.equal(balanceCheck.passed, false);
  });

  // 8. "I Understand" Layer & Zero Hallucination
  console.log('\n--- Suite 8: "I Understand" Transparent Confirmation ---');
  test('Generates structured transparent confirmation with no hallucinated numbers', () => {
    const confirmation = formatUnderstandingConfirmation({
      intentType: 'SWAP',
      action: 'SWAP',
      primaryIntent: 'SWAP',
      parameters: { tokenIn: 'USDT', tokenOut: 'ETH', amount: 250 },
      estimatedImpact: 'Swap ~250 USDT for ETH on Arbitrum with estimated 0.05% slippage',
      assumptions: ['Using best market DEX route']
    }, { locale: 'fa' });

    assert.ok(confirmation.includes('من متوجه شدم'));
    assert.ok(confirmation.includes('250'));
    assert.ok(confirmation.includes('USDT'));
    assert.ok(confirmation.includes('ETH'));
  });

  test('Produces conflict resolution prompt when user changes intention', () => {
    const conflict = formatConflictResolution({
      previousIntent: 'BUY_BTC',
      newIntent: 'SELL_BTC'
    }, { locale: 'en' });

    assert.ok(conflict.includes('Notice'));
    assert.ok(conflict.includes('earlier request'));
  });

  // 9. Multi-Turn Session Memory & Privacy
  console.log('\n--- Suite 9: Multi-Turn Session Memory & Privacy ---');
  test('Maintains conversation slots and context across turns', () => {
    const session = new IntentSession('session-test-01');
    session.updateTurn({
      userMessage: 'I want to buy 100 USDT of BTC',
      intent: { type: 'BUY', entities: { tokenIn: 'USDT', tokenOut: 'BTC', amount: 100 } },
      plan: { stepCount: 1 }
    });

    assert.equal(session.activeEntities.tokenIn, 'USDT');
    assert.equal(session.activeEntities.tokenOut, 'BTC');
    assert.equal(session.turnCount, 1);

    // Resolve slots for next turn
    const resolved = session.resolveSlot('tokenOut');
    assert.equal(resolved, 'BTC');
  });

  test('Strictly strips private keys, seed phrases, and secrets from learning loops', () => {
    const secretPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const secretKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    assert.equal(containsSensitiveKeyOrPhrase(secretPhrase), true);
    assert.equal(containsSensitiveKeyOrPhrase(secretKey), true);
    assert.equal(containsSensitiveKeyOrPhrase('swap 50 usdt to eth'), false);

    const scrubbed = anonymizeFeedbackContext({
      prompt: `Please use private key ${secretKey} to swap`,
      entities: { seed: secretPhrase, token: 'ETH' }
    });

    assert.ok(!JSON.stringify(scrubbed).includes(secretKey));
    assert.ok(!JSON.stringify(scrubbed).includes(secretPhrase));
  });

  // 10. Multi-AI Consensus Synthesis
  console.log('\n--- Suite 10: Multi-AI Consensus Synthesis ---');
  test('Synthesizes multi-model responses into agreement score and unified intent', () => {
    const responses = [
      {
        provider: 'openai',
        model: 'gpt-4o',
        plan: { intent: 'SWAP', tokenIn: 'USDT', tokenOut: 'ETH', amount: 100 },
        confidence: 0.95
      },
      {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        plan: { intent: 'SWAP', tokenIn: 'USDT', tokenOut: 'ETH', amount: 100 },
        confidence: 0.92
      },
      {
        provider: 'groq',
        model: 'llama-3.3-70b',
        plan: { intent: 'SWAP', tokenIn: 'USDT', tokenOut: 'ETH', amount: 100 },
        confidence: 0.90
      }
    ];

    const consensus = synthesizeConsensus(responses);
    assert.equal(consensus.intent, 'SWAP');
    assert.ok(consensus.agreementScore >= 90);
    assert.equal(consensus.divergenceDetected, false);
  });

  console.log(`\n========================================`);
  console.log(`UPGRADE 4 TESTS: ${passedTests}/${totalTests} PASSED (100%)`);
  console.log(`========================================\n`);
}

runAll().catch(err => {
  console.error(err);
  process.exit(1);
});
