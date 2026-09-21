/**
 * FBT INTENT AI — UPGRADE 13: CONVERSATIONAL DEPTH PROBE
 * ---------------------------------------------------------------------------
 * This probe is written against the complaint it exists to answer:
 *
 *   «۳۸ هزار خط intent-ai، اما ارزش کاربر با کیفیت ۱۰ سؤال برتر تعیین می‌شود»
 *
 * So it does not count modules. It measures the ten sentences a real user types
 * most, and it fails when the assistant hears one of them as something else.
 *
 * Suites
 *   1. The split — «حالت چطوره» (pleasantry) vs «چخبر» (request for a report)
 *   2. Twelve languages in, twelve languages out — detection and reply parity
 *   3. Cost law — politeness must never bill a model or a search
 *   4. The economic brief — real numbers, named gaps, never an invention
 *   5. The answer gap and the escalation ladder — "ask the others", literally
 *   6. What the split must NOT touch: money turns, cards, approvals (§67)
 *   7. Speech — dictation normalisation and the never-auto-send law
 *   8. Wiring — the route actually composes the social turn and the ladder
 *
 * Fully offline: no provider keys, no network. The multi-model ladder is
 * exercised through injected fake providers, exactly as Upgrade 5 does.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  planCollaboration,
  classifyConversationKind,
  needsWebResearch,
  decideAnswerPath,
  determineCollaborationLevel,
  classifyComplexity,
  isPureSmallTalk,
  CONVERSATION_KINDS
} from '../../src/lib/intent-ai/os/collaborationRouter.js';
import {
  classifySocialAct,
  socialCostOf,
  SOCIAL_ACTS
} from '../../src/lib/intent-ai/os/conversation/socialIntent.js';
import {
  detectLanguage,
  respondIn,
  SUPPORTED_LANGS,
  MIN_CONFIDENCE
} from '../../src/lib/intent-ai/os/conversation/languageSense.js';
import {
  renderSocialReply,
  voiceParity,
  VOICE_LOCALES
} from '../../src/lib/intent-ai/os/conversation/socialVoice.js';
import {
  buildEconomicBrief,
  assertNoInventedNumbers,
  emptyPayloadStaysEmpty,
  extractDigits,
  normalizeSeparators
} from '../../src/lib/intent-ai/os/conversation/economicBrief.js';
import {
  normalizeTranscript,
  speechRecognitionLangFor,
  dictatedDraft,
  normalizeDigits as dictationDigits
} from '../../src/lib/intent-ai/os/conversation/dictation.js';

/* Server half — imported directly; these modules have no network at import. */
const { answerGap, escalateToProviders, isRefusalOrNonAnswer } = await import('../../server/aiEscalation.js');
const { composeSocialTurn } = await import('../../server/aiSocial.js');

const results = [];

/*
 * One failing assertion must not hide the other forty-two. Every case is
 * recorded and the process exits non-zero at the END, which is also what lets
 * `test/run.mjs` run this file in a child process and read its verdict.
 */
function record(name, fn) {
  return { name, fn };
}

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests += 1;
  try {
    const r = fn();
    if (r instanceof Promise) throw new Error('async test not awaited — use atest()');
    passedTests += 1;
    results.push([name, true]);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push([name, false]);
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message.split('\n')[0]}`);
  }
}

async function atest(name, fn) {
  totalTests += 1;
  try {
    await fn();
    passedTests += 1;
    results.push([name, true]);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push([name, false]);
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message.split('\n')[0]}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  FIXTURES — one realistic context, reused so every assertion is comparable  */
/* -------------------------------------------------------------------------- */

const NOW = 1_770_000_000_000;
const LIVE_CONTEXT = {
  market: {
    dataStatus: 'live',
    capturedAt: NOW - 30_000,
    change24hPct: -3.421,
    priceMap: { BTC: 63412.77, ETH: 2984.11, SOL: 146.32 }
  },
  yields: [
    { protocol: 'Aave', symbol: 'USDT', apy: 5.82, riskBand: 'Low', tvlUsd: 1.2e9 },
    { protocol: 'Morpho', symbol: 'USDC', apy: 9.4, riskBand: 'High', tvlUsd: 3e7 }
  ],
  portfolio: {
    dataStatus: 'live',
    totalValueUsd: 4123.55,
    holdings: [
      { symbol: 'BTC', pct: 66.4 },
      { symbol: 'USDT', pct: 20.1 },
      { symbol: 'SOL', pct: 13.5 }
    ]
  },
  wallet: { connected: true },
  news: { dataStatus: 'live', at: NOW, items: [{ title: 'Fed holds rates; risk assets wobble', source: 'Reuters', at: NOW - 3_600_000 }] }
};

/* The twelve languages this product claims to speak, in their own words. */
const PLEASANTRIES = Object.freeze([
  ['fa', 'حالت چطوره'], ['en', 'how are you?'], ['ar', 'كيف حالك'], ['tr', 'nasılsın'],
  ['ru', 'как дела'], ['zh', '你好吗'], ['hi', 'आप कैसे हैं'], ['ur', 'کیسے ہو'],
  ['id', 'apa kabar'], ['es', '¿qué tal?'], ['pt', 'tudo bem?'], ['fr', 'comment ça va']
]);
/* The phone-keyboard half of the audience: same acts, no accents, no layout switch. */
const PLEASANTRIES_TYPED = Object.freeze([
  ['pt', 'como voce esta?'], ['fr', 'tu vas bien?'], ['es', 'como estas?'],
  ['ur', 'kiya hal'], ['tr', 'nasilsin'], ['fa', 'salam khoobi?'], ['id', 'apa khabar']
]);
const NEWS_ASKS = Object.freeze([
  ['fa', 'چخبر'], ['en', "what's up"], ['ar', 'ايه الاخبار'], ['tr', 'ne var ne yok'],
  ['ru', 'что нового'], ['zh', '有什么新闻'], ['hi', 'क्या खबर'], ['ur', 'کیا خبر ہے'],
  ['id', 'ada berita?'], ['es', '¿qué hay de nuevo?'], ['pt', 'tem novidade?'], ['fr', 'quoi de neuf']
]);

async function runAll() {
  console.log('\n=== FBT INTENT OS — UPGRADE 13 (CONVERSATIONAL DEPTH) PROBE ===\n');

  /* ------------------------------------------------------------------------ */
  console.log('--- Suite 1: the split — pleasantry vs request for a report ---');

  test('«حالت چطوره» is read as HOW_ARE_YOU, and stays a pleasantry', () => {
    for (const text of ['حالت چطوره', 'خوبی؟', 'سلام خوبی؟', 'how are you?', 'nasılsın']) {
      const social = classifySocialAct(text);
      assert.equal(social.act, SOCIAL_ACTS.HOW_ARE_YOU, `${text} must be a pleasantry`);
      const plan = planCollaboration({ message: text, locale: social.lang });
      assert.equal(plan.conversationKind, CONVERSATION_KINDS.GREETING, `${text} must stay conversational`);
      assert.equal(plan.answerPath, 'CONVERSATION', `${text} must not become a report`);
      assert.equal(plan.social.needsData, false, `${text} asks for no data`);
    }
  });

  test('«چخبر» is read as WHATS_UP and demands a brief, not a hello', () => {
    for (const text of ['چخبر', 'چه خبر؟', 'خبری نیس؟', 'بازار چی میگه', "what's up", 'que hay de nuevo']) {
      const social = classifySocialAct(text);
      assert.equal(social.act, SOCIAL_ACTS.WHATS_UP, `${text} is a request to be told what is going on`);
      const plan = planCollaboration({ message: text, locale: social.lang });
      assert.equal(plan.conversationKind, CONVERSATION_KINDS.WHATS_UP, `${text} must not be GREETING`);
      assert.equal(plan.answerPath, 'BRIEF', `${text} must be answered with the brief`);
      assert.equal(plan.briefRequested, true, `${text} must request the brief`);
    }
  });

  test('the two are NOT interchangeable — the split is the whole upgrade', () => {
    const a = planCollaboration({ message: 'حالت چطوره', locale: 'fa' });
    const b = planCollaboration({ message: 'چخبر', locale: 'fa' });
    assert.notEqual(a.answerPath, b.answerPath, 'a pleasantry and a news request cannot share an answer path');
    assert.equal(isPureSmallTalk(a.conversationKind), true);
    assert.equal(isPureSmallTalk(b.conversationKind), false, '«چخبر» is small talk in grammar only');
  });

  test('thanks, goodbye, identity and capability are all recognised', () => {
    const cases = [['ممنون', SOCIAL_ACTS.THANKS], ['thanks a lot', SOCIAL_ACTS.THANKS],
      ['خداحافظ', SOCIAL_ACTS.GOODBYE], ['good night', SOCIAL_ACTS.GOODBYE],
      ['تو کیستی', SOCIAL_ACTS.IDENTITY], ['who are you', SOCIAL_ACTS.IDENTITY],
      ['چیکار میکنی', SOCIAL_ACTS.CAPABILITY], ['what can you do', SOCIAL_ACTS.CAPABILITY]];
    for (const [text, want] of cases) {
      assert.equal(classifySocialAct(text).act, want, text);
    }
  });

  /* ------------------------------------------------------------------------ */
  console.log('\n--- Suite 2: twelve languages in, twelve languages out ---');

  test('language detection resolves the twelve UI languages', () => {
    const probes = [['حالت چطوره', 'fa'], ['how are you', 'en'], ['كيف حالك', 'ar'], ['nasılsın', 'tr'],
      ['как дела', 'ru'], ['你好吗', 'zh'], ['आप कैसे हैं', 'hi'], ['کیسے ہو', 'ur'],
      ['apa kabar', 'id'], ['¿qué tal?', 'es'], ['tudo bem', 'pt'], ['comment ça va', 'fr']];
    for (const [text, want] of probes) {
      const d = detectLanguage(text);
      assert.equal(d.lang, want, `${text} → expected ${want}, got ${d.lang} (conf ${d.confidence}, ${d.evidence.join(' ')})`);
      assert.ok(d.confidence >= MIN_CONFIDENCE, `${text} confidence too low: ${d.confidence}`);
    }
  });

  test('Finglish is understood as Persian, not as English', () => {
    for (const text of ['salam chetori', 'mamnoon', 'khabar chie']) {
      const d = detectLanguage(text);
      assert.equal(d.lang, 'fa', `${text} should read as Persian`);
      assert.equal(respondIn(text).lang, 'fa', `${text} must be ANSWERED in Persian`);
    }
  });

  test('a number or a ticker alone never invents a language', () => {
    assert.equal(detectLanguage('1000').lang, null, 'digits have no language');
    assert.equal(detectLanguage('BTC').lang, detectLanguage('the').lang, 'a bare ticker is ambiguous and must stay ambiguous');
    for (const text of ['1000', 'BTC', 'the', 'ok']) {
      const out = respondIn(text);
      assert.equal(out.lang, 'en', `${text}: with nothing to go on, the interface language answers`);
      assert.equal(out.source, 'fallback', `${text}: that is a fallback, not a guess`);
      assert.notEqual(out.lang, 'tr');
      assert.notEqual(out.lang, 'fa');
      assert.notEqual(out.lang, 'bn');
    }
    /* An explicit interface language is used when the text says nothing else… */
    assert.equal(respondIn('BTC 1000', { declared: 'tr' }).lang, 'tr', 'the declared UI language is honored');
    /* …but never over the language the user actually typed in. */
    assert.equal(respondIn('۵۰ تتر بخر', { declared: 'en' }).lang, 'fa',
      'an English interface must not turn a Persian sentence into English');
    /* A language the UI cannot read is reported as itself, not silently folded into en. */
    assert.equal(respondIn('খুবি?').detection.lang, 'bn', 'Bengali is detected');
    assert.equal(respondIn('খুবি?').supported, undefined, 'and left to the caller to report honestly');
  });

  test('an accent is never the difference between being understood and being ignored', () => {
    /* Half this audience types on a phone with no accented keys. Whatever they
       manage to type has to decide the same act as the correct orthography. */
    const pairs = [
      ['como você está?', 'como voce esta?'],
      ['¿cómo estás?', 'como estas?'],
      ['ça va?', 'ca va?'],
      ['nasılsın?', 'nasilsin?'],
      ['merhaba, iyiyim', 'merhaba, iyiyim'],
      ['সব ঠিক আছে?', 'sab thik ache?']
    ];
    for (const [accented, plain] of pairs) {
      const a = classifySocialAct(accented);
      const b = classifySocialAct(plain);
      assert.equal(b.act, a.act, `«${plain}» must decide the same act as «${accented}»`);
      assert.equal(b.lang, a.lang, `«${plain}» must be answered in the same language as «${accented}»`);
    }
    assert.equal(classifySocialAct('como você está?').lang, 'pt', 'Portuguese stays Portuguese');
    assert.equal(classifySocialAct('¿cómo estás?').lang, 'es', 'Spanish stays Spanish');
  });

  test('a transliterated act is never overwritten by another language\'s table', () => {
    /* Two blocks once lived in one object literal under the same keys, and the
       second silently deleted the first — the Finglish list disappeared behind
       the Romanised Urdu one. They must coexist. */
    assert.equal(classifySocialAct('salam chetori').act, SOCIAL_ACTS.HOW_ARE_YOU, 'Finglish how-are-you');
    assert.equal(classifySocialAct('salam khoobi?').act, SOCIAL_ACTS.HOW_ARE_YOU, 'Finglish khoobi');
    assert.equal(classifySocialAct('kya hal hai').act, SOCIAL_ACTS.HOW_ARE_YOU, 'Romanised Urdu still works');
    assert.equal(classifySocialAct('mamnoon').act, SOCIAL_ACTS.THANKS, 'Finglish thanks survived');
    assert.equal(classifySocialAct('shukriya').act, SOCIAL_ACTS.THANKS, 'Romanised Urdu thanks survived');
    /*
     * The invariant, checked where it can actually break: every pattern table
     * in the classifier must declare each act at most once inside a single
     * literal. A repeated key is legal JavaScript and deletes a language.
     */
    const src = readFileSync(new URL('../../src/lib/intent-ai/os/conversation/socialIntent.js', import.meta.url), 'utf8');
    const tables = [...src.matchAll(/const ([A-Z_]+) = Object\.freeze\(\{([\s\S]*?)\n\}\);/g)];
    assert.ok(tables.length >= 2, 'the classifier tables were found to scan');
    for (const [, name, body] of tables) {
      const keys = [...body.matchAll(/^\s*\[SOCIAL_ACTS\.[A-Z_]+\]:/gm)].map((m) => m[0].trim());
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      assert.deepEqual(dupes, [], `${name} repeats ${dupes.join(', ')} — the second list would delete the first`);
    }
    assert.ok(src.includes('mergeActLists('), 'the two transliteration groups are merged, not overwritten');
  });

  test('the UI language never overrides the language the user typed in', () => {
    const fa = planCollaboration({ message: 'حالت چطوره', locale: 'en' });
    assert.equal(fa.social.lang, 'fa', 'a Persian sentence answered in Persian');
    const en = planCollaboration({ message: 'how are you', locale: 'fa' });
    assert.equal(en.social.lang, 'en', 'an English sentence answered in English');
    assert.equal(planCollaboration({ message: 'BTC', locale: 'fa' }).social.lang, 'fa',
      'when the text carries no language at all, the interface language decides');
  });

  test('social reply exists in all twelve locales for every act (no silent English)', () => {
    const parity = voiceParity();
    assert.equal(parity.ok, true, `voice gaps: ${JSON.stringify(parity.gaps)}`);
    assert.equal(parity.locales.length, 12);
    for (const row of parity.rows) assert.equal(row.covered, row.total, `${row.act} incomplete`);
  });

  test('each pleasantry is answered in its own language', () => {
    for (const [lang, text] of PLEASANTRIES) {
      const social = classifySocialAct(text, { locale: 'en' });
      assert.equal(social.lang, lang, `${text}: detection should say ${lang}, said ${social.lang}`);
      const reply = renderSocialReply({ act: social.act, lang: social.lang, seed: text });
      assert.equal(reply.ok, true, `${text}: no voice`);
      assert.equal(reply.lang, lang, `${text}: answered in ${reply.lang} instead of ${lang}`);
      assert.equal(reply.fellBack, false, `${text}: silent English fallback`);
      assert.ok(reply.text.length > 10, `${text}: empty reply`);
    }
  });

  test('the reply never claims a body, a mood or a day it cannot have', () => {
    const banned = [/من امروز/i, /dün /, /\bmy day\b/i, /احساس می?کنم/i, /feelings? about/i, /دلم/i, /я устал/i];
    for (const [lang, text] of PLEASANTRIES) {
      const reply = renderSocialReply({ act: SOCIAL_ACTS.HOW_ARE_YOU, lang, seed: text });
      for (const re of banned) {
        assert.ok(!re.test(reply.text), `${lang}/${text}: reply claims a human state (${re})`);
      }
      assert.ok(!/\$\s?\d|\d[\d.,]*\s?%/.test(reply.text), `${lang}/${text}: a pleasantry must not carry an unsourced number`);
    }
  });

  /* ------------------------------------------------------------------------ */
  console.log('\n--- Suite 3: cost law — politeness must not bill anything ---');

  test('a pleasantry in ANY of the twelve languages costs zero models and zero searches', () => {
    for (const [lang, text] of PLEASANTRIES) {
      const plan = planCollaboration({ message: text, locale: lang });
      assert.equal(plan.level, 1, `${text}: must stay level 1 (was the misroute that spent two models + a web search)`);
      assert.equal(plan.needsWeb, false, `${text}: must never search the web`);
      assert.equal(plan.complexity, 'SIMPLE', `${text}: not a complex question`);
      const cost = socialCostOf(plan.social.act);
      assert.equal(cost.modelCalls, 0, `${text}: zero provider calls`);
      assert.equal(cost.webCalls, 0, `${text}: zero searches`);
    }
  });

  test('the unaccented, phone-keyboard spelling is treated as the same politeness', () => {
    for (const [lang, text] of PLEASANTRIES_TYPED) {
      const social = classifySocialAct(text, { locale: lang });
      assert.equal(social.social, true, `${text} is still a pleasantry when typed without accents`);
      assert.equal(social.act, SOCIAL_ACTS.HOW_ARE_YOU, `${text} is still «how are you»`);
      assert.equal(social.lang, lang, `${text} is still answered in ${lang}`);
      const plan = planCollaboration({ message: text, locale: lang });
      assert.equal(plan.level, 1, `${text}: politeness costs nothing`);
      assert.equal(plan.needsWeb, false, `${text}: no search for a greeting`);
      const voice = renderSocialReply({ act: SOCIAL_ACTS.HOW_ARE_YOU, lang, seed: 1 });
      assert.equal(voice.lang, lang, `${text}: a real ${lang} sentence, not English`);
      assert.ok(!/\d/.test(voice.text), `${text}: no numbers in a pleasantry`);
    }
  });

  test('a news ask costs one cached read, not a completion', () => {
    for (const [lang, text] of NEWS_ASKS) {
      const plan = planCollaboration({ message: text, locale: lang });
      assert.equal(plan.conversationKind, CONVERSATION_KINDS.WHATS_UP, `${text} should be WHATS_UP (${plan.social.confidence})`);
      assert.equal(plan.level, 1, `${text}: the brief is computed, not generated`);
      assert.equal(plan.needsWeb, false, `${text}: never a web round trip`);
      const cost = socialCostOf(plan.social.act);
      assert.equal(cost.modelCalls, 0, `${text}: no provider spend`);
      assert.equal(cost.toolCalls, 1, `${text}: one cached data read`);
    }
  });

  test('a short non-English greeting no longer reaches the question path', () => {
    /* The regression in one line: these three used to be QUESTION at level 3
       with web research attached, and were answered in English. */
    for (const text of ['nasılsın', 'как дела', '你好吗']) {
      assert.equal(classifyConversationKind(text, { locale: 'en' }), CONVERSATION_KINDS.GREETING, text);
      assert.equal(needsWebResearch({ freshness: 'RECENT', conversationKind: CONVERSATION_KINDS.GREETING }), false);
      assert.equal(classifyComplexity(text, { conversationKind: CONVERSATION_KINDS.GREETING, freshness: 'RECENT' }), 'SIMPLE');
    }
  });

  test('the WHATS_UP discipline is set by the classifiers, not by luck', () => {
    assert.equal(decideAnswerPath({ conversationKind: CONVERSATION_KINDS.WHATS_UP, freshness: 'RECENT', entities: {} }), 'BRIEF');
    assert.equal(determineCollaborationLevel({ conversationKind: CONVERSATION_KINDS.WHATS_UP, complexity: 'SIMPLE', freshness: 'RECENT', needsWeb: false }), 1);
    assert.equal(needsWebResearch({ conversationKind: CONVERSATION_KINDS.WHATS_UP, freshness: 'LIVE' }), false,
      'even a "live" reading of «چخبر» is answered from the cache the app already holds');
  });

  /* ------------------------------------------------------------------------ */
  console.log('\n--- Suite 4: the economic brief — real numbers or no numbers ---');

  const briefFor = (lang, over = {}) => buildEconomicBrief({ ...LIVE_CONTEXT, lang, now: NOW, ...over });

  test('every figure in the brief is copied from the payload, in all twelve locales', () => {
    for (const lang of VOICE_LOCALES) {
      const brief = briefFor(lang);
      assert.equal(brief.ok, true, lang);
      assert.equal(brief.dataStatus, 'live', `${lang}: expected a live brief, got ${brief.dataStatus} / missing ${brief.missing}`);
      const check = assertNoInventedNumbers(brief, LIVE_CONTEXT);
      assert.equal(check.ok, true, `${lang}: invented numbers ${JSON.stringify(check.invented)}`);
      assert.ok(brief.usedValues.length >= 5, `${lang}: provenance too thin`);
    }
  });

  test('the brief reads as a report: trend, majors, yield, wallet, headline', () => {
    const brief = briefFor('fa');
    const keys = brief.lines.map((l) => l.key);
    for (const k of ['trend', 'prices', 'yield', 'wallet', 'news']) {
      assert.ok(keys.includes(k), `missing section ${k}`);
    }
    assert.equal(brief.mood, 'down', 'a -3.4% day is not "flat"');
    assert.ok(brief.text.includes('۶۳.۴K'), 'BTC price must appear in Persian digits');
    assert.ok(brief.lines.find((l) => l.key === 'wallet').concentrated === true, '66% in one asset must be flagged');
    assert.ok(!/۹\.۴|9\.4/.test(brief.text), 'the high-risk 9.4% pool must NOT be advertised as the highlight');
  });

  test('a missing feed is a named gap, never a guess', () => {
    const noYields = buildEconomicBrief({ market: LIVE_CONTEXT.market, lang: 'en', now: NOW, yields: null });
    assert.ok(noYields.missing.includes('yields'), 'yields must be named as missing');
    assert.ok(noYields.text.includes('unavailable'), 'and must be visible in the text');
    const empty = buildEconomicBrief({ lang: 'en', now: NOW });
    assert.equal(empty.dataStatus, 'unavailable');
    assert.equal(emptyPayloadStaysEmpty().ok, true, 'an empty payload must produce an empty brief');
  });

  test('a disconnected wallet is reported as disconnected, not as zero', () => {
    const brief = briefFor('en', { wallet: { connected: false }, portfolio: null });
    assert.match(brief.lines.find((l) => l.key === 'wallet').text, /not connected/i);
    assert.ok(!/\$0\b/.test(brief.text), 'never print a zero balance for an unread wallet');
    assert.ok(brief.missing.includes('portfolio'));
  });

  test('a tampered brief is caught by its own honesty check', () => {
    const brief = briefFor('en');
    const tampered = { ...brief, text: 'BTC $99999, up 4.7%' };
    tampered.numbers = extractDigits(tampered.text);
    const check = assertNoInventedNumbers(tampered, LIVE_CONTEXT);
    assert.equal(check.ok, false, 'invented figures must be reported');
    assert.deepEqual(check.invented, [99999, 4.7]);
  });

  test('separators and digit systems are read the way each locale writes them', () => {
    assert.equal(normalizeSeparators('63,4'), '63.4', 'tr writes a comma decimal');
    assert.equal(normalizeSeparators('1,234'), '1234', 'en writes a thousands group');
    assert.equal(normalizeSeparators('۶۳.۴'), '63.4');
    assert.deepEqual(extractDigits('BTC $۶۳.۴K · ٥.٨٪'), [63.4, 5.8]);
  });

  test('the social turn composes warmth + brief, and claims no authority', () => {
    const plan = planCollaboration({ message: 'چخبر', locale: 'fa' });
    const turn = composeSocialTurn({ u5: plan, human: { ui: { type: 'TEXT' } }, context: LIVE_CONTEXT, locale: 'fa', now: NOW });
    assert.equal(turn.handled, true);
    assert.equal(turn.providerCalls, 0, 'the brief must cost no model call');
    assert.ok(turn.text.includes('خلاصهٔ بازار'), 'the report header must be Persian');
    assert.ok(turn.text.includes('۶۳.۴K'), 'and must carry the real BTC figure');
    assert.equal(turn.brief.executionAuthorized, false);
    assert.equal(turn.brief.notAdvice, true);
  });

  test('a pleasantry turn says nothing about money it has not been asked about', () => {
    const plan = planCollaboration({ message: 'حالت چطوره', locale: 'fa' });
    const turn = composeSocialTurn({ u5: plan, human: { ui: { type: 'TEXT' } }, context: LIVE_CONTEXT, locale: 'fa', now: NOW });
    assert.equal(turn.handled, true);
    assert.equal(turn.brief, null, 'a "how are you" must not be answered with a report');
    assert.ok(!/\d{2,}/.test(turn.text), `no figures in a pleasantry: ${turn.text}`);
  });

  test('no data at all produces an honest gap note, never an empty report', () => {
    const plan = planCollaboration({ message: 'چخبر', locale: 'fa' });
    const turn = composeSocialTurn({ u5: plan, human: { ui: { type: 'TEXT' } }, context: {}, locale: 'fa', now: NOW });
    assert.equal(turn.handled, true);
    assert.ok(turn.text.length > 20);
    assert.ok(!/^\s*•\s*$/.test(turn.text));
    assert.match(turn.text, /داده/i, 'it must say that live data was missing');
  });

  /* ------------------------------------------------------------------------ */
  console.log('\n--- Suite 5: the answer gap and the escalation ladder ---');

  test('a shrug is recognised as a gap; a real answer is not', () => {
    assert.equal(answerGap({ text: 'ok', intentType: 'GENERAL', providersConfigured: 3 }).escalate, true);
    assert.equal(answerGap({ text: 'I cannot answer that without verified sources.', intentType: 'GENERAL', providersConfigured: 3 }).escalate, true);
    assert.equal(answerGap({ text: 'نمی‌دانم، دسترسی ندارم به اطلاعات', intentType: 'GENERAL', providersConfigured: 3 }).escalate, true);
    assert.equal(
      answerGap({ text: 'The market fell 1.2% after the Fed decision; sources are listed below for the other numbers.', intentType: 'MARKET_ANALYSIS', providersConfigured: 3 }).escalate,
      false,
      'a real answer must never be escalated away'
    );
  });

  test('the answer itself is tested for refusal, not just its length', () => {
    for (const refusal of ['I do not know the answer to that, sorry.', "I don't have live data for this token.", 'нет данных для ответа на это', '我不知道']) {
      assert.equal(isRefusalOrNonAnswer(refusal), true, refusal);
    }
    for (const real of ['بازار امروز ۱.۲٪ افت کرده و دلیلش اعلام نرخ بهره بود.', 'The market fell 1.2% after the Fed decision, and your wallet is not connected so I cannot speak to holdings.']) {
      assert.equal(isRefusalOrNonAnswer(real), false, real);
    }
  });

  atest('money and wallet questions are refused BEFORE any provider is called', async () => {
    let calls = 0;
    const deps = { execute: async () => { calls += 1; return { text: 'you have 12 BTC', model: 'x' }; } };
    const out = await escalateToProviders({ message: 'چقدر تتر دارم', locale: 'fa', deps });
    assert.equal(out.ok, false, 'a model must never answer a balance question');
    assert.equal(calls, 0, 'refused before the network, not after it');
    /* And the gap predicate agrees, so the route never even reaches the ladder. */
    const gap = answerGap({ text: 'کیفت در دسترس نبود', intentType: 'WALLET_BALANCE', providersConfigured: 3 });
    assert.deepEqual(gap.reasons, ['TOOL_TRUTH_REQUIRED']);
  });

  await atest('the ladder walks on past refusals and stops at the first real answer', async () => {
    const seen = [];
    const deps = {
      providers: ['openrouter', 'groq', 'gemini'],
      execute: async (id) => {
        seen.push(id);
        if (id === 'openrouter') return { text: 'I cannot answer that without live sources.', model: 'a' };
        if (id === 'groq') return { text: 'нет данных', model: 'b' };
        return { text: 'بازار امروز پس از اعلام نرخ بهره تحت فشار بود؛ این از دادهٔ خود اپ است.', model: 'c' };
      }
    };
    const out = await escalateToProviders({ message: 'چرا بازار ریخت؟', locale: 'fa', deps, taskType: 'market' });
    assert.equal(out.ok, true, 'the third provider had an answer');
    assert.ok(seen.length >= 2, `earlier providers must have been asked first (asked ${seen.length})`);
    assert.equal(out.executionAuthorized, false, 'escalation buys words, never authority (§67)');
    assert.equal(out.canSignOrSend, false);
    assert.equal(out.changesLimits, false);
    const statuses = out.tried.map((t) => t.status);
    assert.ok(statuses.includes('REFUSED'), 'a refusal must be recorded as a refusal, not an outage');
  });

  await atest('when every provider refuses, nothing is invented and the caller keeps its own reply', async () => {
    const out = await escalateToProviders({
      message: 'قیمت فردا بیت کوین چنده؟',
      locale: 'en',
      taskType: 'market',
      deps: { providers: ['openrouter', 'groq'], execute: async () => ({ text: 'I cannot predict a price.', model: 'x' }) }
    });
    assert.equal(out.ok, false);
    assert.equal(out.answer, undefined, 'a failed ladder must not leave an empty string to overwrite the real reply');
    assert.match(String(out.reason), /REFUSED|UNAVAILABLE/);
  });

  await atest('a hanging provider cannot hold the turn open', async () => {
    const started = Date.now();
    const out = await escalateToProviders({
      message: 'بگو ببینم چی شده',
      locale: 'fa',
      taskType: 'market',
      deadlineMs: 700,
      deps: { providers: ['openrouter', 'groq'], execute: () => new Promise(() => { /* never settles */ }) }
    });
    const took = Date.now() - started;
    assert.equal(out.ok, false);
    assert.ok(took < 4000, `the ladder returned after ${took}ms for a 700ms budget`);
    assert.ok(out.tried.every((t) => t.status === 'TIMEOUT' || t.status === 'SKIPPED_DEADLINE'),
      `a hung provider is named TIMEOUT, not silently dropped: ${JSON.stringify(out.tried)}`);
  });

  test('with no keys configured the ladder says so and the deterministic reply stands', () => {
    const gap = answerGap({ text: 'مطمئن نیستم', intentType: 'GENERAL', providersConfigured: 0 });
    assert.equal(gap.escalate, false);
    assert.equal(gap.blocked, true, 'a gap with nobody to ask must be reported as blocked, not as silence');
    assert.equal(gap.blockedBy, 'NO_EXTERNAL_PROVIDERS');
    assert.ok(gap.reasons.includes('NO_EXTERNAL_PROVIDERS'));
    /* The reply itself is still a shrug — the caller must keep its own text. */
    assert.ok(gap.reasons.includes('REPLY_IS_A_NON_ANSWER'), 'the shrug was seen as a gap');
  });

  test('escalation is skipped when the turn already owns its answer', () => {
    assert.deepEqual(answerGap({ text: 'چیزی', intentType: 'GENERAL', hasCard: true, providersConfigured: 3 }).reasons, ['CARD_IS_THE_ANSWER']);
    assert.deepEqual(answerGap({ text: 'چیزی', intentType: 'GENERAL', hasPendingIntent: true, providersConfigured: 3 }).reasons, ['PENDING_INTENT_OWNS_TURN']);
    assert.deepEqual(answerGap({ text: 'چیزی', intentType: 'GENERAL', socialHandled: true, providersConfigured: 3 }).reasons, ['SOCIAL_TURN_OWNS_REPLY']);
  });

  /* ------------------------------------------------------------------------ */
  console.log('\n--- Suite 6: what the split must NOT touch ---');

  test('a greeting wearing an order is still an order', () => {
    for (const text of ['سلام، ۵۰ دلار تتر بخر', 'hi, buy 50 usdt', 'ممنون، بیتکوین رو بفروش', 'خوبی؟ سواپ رو انجام بده']) {
      const social = classifySocialAct(text);
      assert.equal(social.social, false, `${text} is not small talk`);
      assert.equal(social.guard.blocks, true, `${text} must trip the action guard`);
      const plan = planCollaboration({ message: text, locale: social.lang });
      assert.equal(plan.conversationKind, CONVERSATION_KINDS.ACTION, `${text} must reach the action path`);
    }
  });

  test('a question about a token is not a pleasantry', () => {
    for (const text of ['بیت کوین چطوره', 'BTC چطوره؟', 'sol چطوره', 'اتریوم چطوره']) {
      const social = classifySocialAct(text);
      assert.notEqual(social.act, SOCIAL_ACTS.HOW_ARE_YOU, `${text} asks about a market, not about me`);
      assert.equal(social.social, false, `${text} is not a pure social act`);
    }
  });

  test('a social reply can never overwrite an action card or a pending intent', () => {
    const plan = planCollaboration({ message: 'چخبر', locale: 'fa' });
    for (const human of [{ ui: { type: 'ACTION_CARD' } }, { ui: { type: 'CONNECT_WALLET' } }, { ui: { type: 'CHOICE' } }, { pendingIntent: { id: 'x' } }]) {
      const turn = composeSocialTurn({ u5: plan, human, context: LIVE_CONTEXT, locale: 'fa', now: NOW });
      assert.equal(turn.handled, false, `${human.ui?.type || 'pendingIntent'} must win over the social reply`);
    }
  });

  test('every social and brief object states it authorises nothing', () => {
    for (const text of ['سلام', 'چخبر', 'ممنون', 'تو کیستی']) {
      const social = classifySocialAct(text);
      assert.equal(social.executionAuthorized, false, text);
      const brief = briefFor('en');
      assert.equal(brief.executionAuthorized, false);
      assert.equal(brief.requiresSignatureForAnything, false);
    }
  });

  test('the money parser is untouched by the social layer', () => {
    /* The same sentences Upgrade 13 must not disturb, checked through the real
       analyzer: an ACTION turn keeps its level and its tool path. */
    const buy = planCollaboration({ message: '۵۰ دلار تتر بخر', locale: 'fa' });
    assert.equal(buy.conversationKind, CONVERSATION_KINDS.ACTION);
    assert.equal(buy.social.social, false);
    const conditional = planCollaboration({ message: 'اگر btc به 100000 رسید بخر', locale: 'fa' });
    assert.equal(conditional.conversationKind, CONVERSATION_KINDS.ACTION);
  });

  /* ------------------------------------------------------------------------ */
  console.log('\n--- Suite 7: speech — the microphone must not be a gamble ---');

  test('dictation is asked for in the browser\'s own language tag', () => {
    const probes = [['fa', 'fa-IR'], ['tr', 'tr-TR'], ['ru', 'ru-RU'], ['zh', 'zh-CN'], ['hi', 'hi-IN'], ['ur', 'ur-PK'], ['id', 'id-ID'], ['es', 'es-ES'], ['pt', 'pt-BR'], ['fr', 'fr-FR'], ['en', 'en-US'], ['ar', 'ar-SA']];
    for (const [lang, want] of probes) {
      assert.equal(speechRecognitionLangFor(lang).lang, want, lang);
    }
    /* A browser that advertises a narrower set gets the best available tag. */
    assert.equal(speechRecognitionLangFor('ar', { availableLocales: ['en-US', 'ar-EG'] }).lang, 'ar-EG');
    assert.equal(speechRecognitionLangFor('de', { availableLocales: ['en-US'] }).lang, 'de-DE');
  });

  test('a transcript is normalised into what the parser already reads', () => {
    const cases = [
      ['۵۰ تتر بخر.', { digits: true, filler: true }],
      ['bitcoiin\u200c را بفروش.', { zwnj: true }],
      [' ۱۰۰دلار  BTC  بخر ', { digits: true }]
    ];
    for (const [raw, expect] of cases) {
      const out = normalizeTranscript(raw, { lang: 'fa', confidence: 0.92, isFinal: true });
      assert.equal(out.empty, false, raw);
      if (expect.digits) assert.match(out.text, /\d/, `${raw}: digits must become ASCII`);
      if (expect.filler) assert.ok(!/[.،]$/.test(out.text), `${raw}: trailing punctuation must go`);
      if (expect.zwnj) assert.ok(!/\u200c/.test(out.text), `${raw}: ZWNJ must be folded`);
      assert.ok(out.edits.length >= 1, `${raw}: edits must be reported`);
    }
    /* Arabic-script letters a Persian keyboard does not use. */
    assert.equal(normalizeTranscript('بيت.coin بخر').text.includes('ی'), true, 'ي must fold to ی');
    assert.equal(dictationDigits('١٢٣'), '123');
  });

  test('a low-confidence transcript asks the human to read it, and never sends itself', () => {
    const shaky = normalizeTranscript('۵۰ تتر بخر', { lang: 'fa', confidence: 0.31, isFinal: true });
    assert.equal(shaky.needsConfirmation, true, '0.31 confidence must not be trusted with money');
    const solid = normalizeTranscript('۵۰ تتر بخر', { lang: 'fa', confidence: 0.97, isFinal: true });
    assert.equal(solid.needsConfirmation, false);
    const interim = normalizeTranscript('۵۰', { lang: 'fa', confidence: 0.9, isFinal: false });
    assert.equal(interim.needsConfirmation, true, 'an interim result is never final input');
    const draft = dictatedDraft('', solid);
    assert.equal(draft.shouldAutoSend, false, 'dictation may fill a field, never press send');
    /* A greeting plus a spoken order becomes one line, in the writer's own script and digits. */
    const merged = dictatedDraft('سلام ', solid);
    assert.equal(merged.value, 'سلام ۵۰ تتر بخر', 'the field keeps the digits the user spoke');
    assert.equal(merged.normalized, 'سلام 50 تتر بخر', 'the router sees Latin digits');
    assert.equal(merged.shouldAutoSend, false);
    assert.equal(merged.requiresUserSend, true, 'the human presses send');
  });

  /* ------------------------------------------------------------------------ */
  console.log('\n--- Suite 8: wiring — the route must actually call this ---');

  test('the chat route composes the social turn and the ladder', () => {
    const src = readFileSync(new URL('../../server/aiIntentOS.js', import.meta.url), 'utf8');
    assert.ok(src.includes("from './aiSocial.js'"), 'aiSocial must be imported by the chat route');
    assert.ok(src.includes('const deterministicLocale ='), 'the two-language legacy renderer must be told which of its two to use');
    assert.ok(/locale:\s*deterministicLocale,/.test(src), 'formatHumanResponse receives the resolved language, not the raw declared locale');
    assert.ok(!/locale: locale \|\| 'fa',\n\s*resumed,/.test(src), 'no raw-locale handoff to the Persian-or-English renderer');
    assert.ok(src.includes('composeSocialTurn({'), 'the route must compose a social turn');
    assert.ok(src.includes('answerGap({'), 'the route must ask whether the reply is a gap');
    assert.ok(src.includes('escalateToProviders({'), 'and must be able to consult the rest of the fleet');
    assert.ok(src.includes('&& !socialTurn.handled;'), 'collaboration must be skipped for a composed social turn');
    assert.ok(src.includes('brief: socialTurn.brief || null'), 'the brief travels with the reply for the UI');
    assert.ok(src.includes('social: socialTurn.social || u5.social || null'), 'the language read travels with the reply');
    /* The news read joins the context with its own deadline, so a cold feed
       cannot slow the first turn of a session. */
    assert.ok(src.includes("ctxDeadline(newsContext(), 4000)"), 'news must be bounded by the context deadline');
  });

  test('the router exposes the social read to every consumer', () => {
    const plan = planCollaboration({ message: 'چخبر', locale: 'fa' });
    assert.ok(plan.social, 'plan.social must exist');
    assert.equal(plan.social.act, SOCIAL_ACTS.WHATS_UP);
    assert.equal(plan.social.lang, 'fa');
    assert.equal(plan.social.executionAuthorized, false);
    assert.equal(typeof plan.social.cost, 'object', 'the cost of the turn is reported');
    assert.equal(plan.social.cost.modelCalls, 0);
  });

  test('the collaboration engine no longer claims the fleet is unavailable when it is not', () => {
    const src = readFileSync(new URL('../../server/aiCollaboration.js', import.meta.url), 'utf8');
    assert.ok(src.includes('getActiveProviderIds()'), 'the degraded message checks the real fleet');
    assert.ok(!/No external AI model is available right now and no trusted data was found/.test(src), 'the old blanket claim is gone');
    assert.ok(src.includes('languageInstruction(locale)'), 'model answers are requested in the user\'s language, not fa-or-en');
    assert.ok(src.includes('renderSocialReply'), 'the social reply comes from the twelve-locale voice table');
  });

  const failed = totalTests - passedTests;
  console.log(`\n=== UPGRADE 13 PROBE RESULT: ${passedTests}/${totalTests} passed${failed ? ` — ${failed} FAILED` : ''} ===\n`);
  return { passed: passedTests, total: totalTests, results };
}

/** Imported by `test/run.mjs` (and by anyone who wants the rows, not the exit code). */
export default runAll;

/* Standalone: a non-zero exit is the verdict `npm run test:upgrade13` reports. */
if ((process.argv[1] || '').endsWith('upgrade13-conversation-depth-probe.mjs')) {
  runAll().then((r) => { if (r.passed !== r.total) process.exitCode = 1; }).catch((err) => {
    console.error(`\nUPGRADE 13 PROBE CRASHED: ${err?.stack || err}\n`);
    process.exitCode = 1;
  });
}
