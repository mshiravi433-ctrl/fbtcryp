/**
 * «هوش مصنوعی ما از هیچ نظر باهوش نیست» — EXPLANATION vs OBSERVATION.
 * ---------------------------------------------------------------------------
 * The assistant used to answer an explainer question in one of three ways:
 *
 *   «استیکینگ چیه؟»                → «اول کیف پولتان را متصل کنید»
 *   «چرا باید تنوع داشته باشم؟»     → «منبع زندهٔ تأییدشده‌ای ندارم»
 *   «استراتژی … ۲۰٪ سود در ۶ ماه»   → the Earn page, at score 110
 *
 * None of those is a knowledge problem. They are a CLASSIFICATION problem:
 * the turn never decided whether the human was asking what something IS, or
 * what the market is doing RIGHT NOW. This file pins that decision down from
 * both sides — what must be answered, and what must still be refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyQuestionShape, isConceptualQuestion, isPlanRequest } from '../../server/aiQuestionShape.js';
import { classifyFreshness } from '../../src/lib/intent-ai/os/collaborationRouter.js';
import { answerRequiresEvidence } from '../../server/aiEvidenceFallback.js';
import { evaluateLocalFirst } from '../../server/aiLocalFirstGate.js';
import { formatHumanResponse } from '../../src/lib/intent-ai/humanResponse.js';
import { searchKnowledge } from '../../src/lib/intent-ai/os/knowledgeCenter.js';
import { hybridKnowledgeSearch } from '../../src/lib/intent-ai/os/semanticKnowledge.js';

/* -------------------------------------------------------------------------- */
/*  A. THE CLASSIFIER                                                         */
/* -------------------------------------------------------------------------- */

test('an explanation is recognised in Persian and English', () => {
  for (const q of [
    'ایمپرمننت لاس چیه؟',
    'فاندینگ ریت چطور کار می‌کنه؟',
    'تحلیل تکنیکال چیه؟',
    'معنی APY چیه؟',
    'why should I diversify?',
    /* A how-to about the user's own wallet is an explanation, not a reading:
       «چطور کیف پول من را وصل کنم؟» is answered from the connect-wallet
       instructions, and only an ACTION needs the wallet to actually be there. */
    'چطور کیف پول من را وصل کنم؟',
    'what is impermanent loss',
    'how does funding work',
    'explain soft rug'
  ]) {
    assert.equal(isConceptualQuestion(q), true, `"${q}" should be an explanation`);
  }
});

test('a question about the current state is never an explanation', () => {
  for (const q of [
    'قیمت بیت کوین چنده؟',
    'بازار امروز چطوره؟',
    'اخبار امروز بازار',
    'موجودی من چنده',
    'کیف پول من چی داره؟',
    'تحلیل بیت کوین',
    'what is my balance',
    'why did BTC drop today'
  ]) {
    assert.equal(isConceptualQuestion(q), false, `"${q}" needs live data, not a definition`);
  }
});

test('a plan request is work, not a definition — even when it ends in «چیست»', () => {
  const q = 'استراتژی سرمایه‌گذاری ۲۰٪ سود در ۶ ماه با این سبد چیست؟';
  assert.equal(classifyQuestionShape(q).reason, 'PLAN_REQUEST');
  assert.equal(isConceptualQuestion(q), false);
  assert.equal(isPlanRequest(q), true);
  assert.equal(isPlanRequest('ایمپرمننت لاس چیه؟'), false);
});

test('freshness follows the shape: explanations are STATIC, prices are not', () => {
  assert.equal(classifyFreshness('چرا باید تنوع داشته باشم؟'), 'STATIC');
  assert.equal(classifyFreshness('ایمپرمننت لاس چیه؟'), 'STATIC');
  assert.equal(classifyFreshness('قیمت بیت کوین چنده؟'), 'LIVE');
  assert.equal(classifyFreshness('اخبار امروز بازار'), 'LIVE');
  assert.equal(classifyFreshness('بیت کوین این هفته چه وضعی داشت'), 'RECENT');
});

/* -------------------------------------------------------------------------- */
/*  B. THE EVIDENCE GATE                                                      */
/* -------------------------------------------------------------------------- */

test('an explanation may be answered without a live source', () => {
  assert.equal(
    answerRequiresEvidence({ conversationKind: 'QUESTION', intentType: 'RESEARCH', freshness: 'STATIC', conceptual: true }),
    false
  );
  /* …and the same question with no conceptual flag still needs evidence. */
  assert.equal(
    answerRequiresEvidence({ conversationKind: 'QUESTION', intentType: 'RESEARCH', freshness: 'STATIC' }),
    true
  );
});

test('a live question is not excused by a conceptual-sounding phrasing', () => {
  assert.equal(
    answerRequiresEvidence({ conversationKind: 'QUESTION', intentType: 'RESEARCH', freshness: 'LIVE', conceptual: true }),
    true
  );
  assert.equal(
    answerRequiresEvidence({ conversationKind: 'QUESTION', intentType: 'RESEARCH', freshness: 'RECENT', conceptual: true }),
    true
  );
});

/* -------------------------------------------------------------------------- */
/*  C. THE TWO RENDERERS THAT USED TO LIE                                     */
/* -------------------------------------------------------------------------- */

test('a plan request is not answered from the corpus, however well it scores', () => {
  const message = 'استراتژی سرمایه‌گذاری ۲۰٪ سود در ۶ ماه با این سبد چیست؟';
  const knowledge = hybridKnowledgeSearch(message, { locale: 'fa', limit: 3, lexicalSearch: searchKnowledge });
  const r = evaluateLocalFirst({
    message, locale: 'fa', knowledge, context: {}, env: { FBT_AI_LOCAL_FIRST: '1' }
  });
  assert.equal(r.used, false);
  assert.equal(r.reason, 'plan-request');
});

test('an explainer question is not answered with a wallet demand', () => {
  for (const [message, locale, classification] of [
    ['استیکینگ چیه؟', 'fa', { type: 'STAKING' }],
    ['چطور ریسک پرتفوی‌ام را کم کنم؟', 'fa', null],
    ['what is staking', 'en', { type: 'STAKING' }]
  ]) {
    const r = formatHumanResponse({ message, context: {}, locale, classification, suggestions: [] });
    assert.notEqual(r.ui?.type, 'CONNECT_WALLET', `"${message}" must not demand a wallet`);
    assert.doesNotMatch(r.message, /کیف پولتان را متصل کنید|connect your wallet/i);
    assert.ok(String(r.message).length > 60, `"${message}" must be answered, got: ${r.message}`);
  }
});

test('a wallet-needing ACTION still asks for the wallet', () => {
  const r = formatHumanResponse({
    message: '۱۰۰ USDT به ETH سواپ کن', context: {}, locale: 'fa',
    classification: { type: 'SWAP' }, suggestions: []
  });
  assert.equal(r.ui?.type, 'CONNECT_WALLET');
});

/* -------------------------------------------------------------------------- */
/*  D. THE ANSWERS THEMSELVES                                                 */
/* -------------------------------------------------------------------------- */

test('the staking question is answered about staking', () => {
  const r = formatHumanResponse({ message: 'استیکینگ چیه؟', context: {}, locale: 'fa', classification: { type: 'STAKING' }, suggestions: [] });
  assert.match(r.message, /استیکینگ|stak/i);
  assert.match(r.message, /اعتبارسنج|validator|قفل/i);
  assert.doesNotMatch(r.message, /APY نمایش|Earn جاهایی/);
});

test('the risk question is answered with risk reduction, not a risk score', () => {
  const r = formatHumanResponse({ message: 'چطور ریسک پرتفوی‌ام را کم کنم؟', context: {}, locale: 'fa', suggestions: [] });
  assert.match(r.message, /اندازهٔ موقعیت|position size|تنوع|اهرم/i);
  assert.doesNotMatch(r.message, /امتیاز ریسک FBT/);
});

test('the funding question explains funding, not on-chain indicators', () => {
  const hits = hybridKnowledgeSearch('فاندینگ ریت چطور کار می‌کنه؟', {
    locale: 'fa', limit: 3, lexicalSearch: searchKnowledge
  });
  assert.equal(hits[0].id, 'kb.trading.funding-rate');
});
