/**
 * «باهوش‌تر کن» — the THIRD depth layer: completeness + numeric honesty.
 * ---------------------------------------------------------------------------
 * Two deterministic checks that cost zero extra model calls and cannot invent
 * anything:
 *
 *   A. QUESTION DECOMPOSITION — a two-part question («قیمت BTC چنده؟ ریسک
 *      سبد من چیه؟») is split ONLY on structure the user typed: numbering,
 *      newlines, semicolons, several question marks, «و همچنین». Every analyst
 *      receives the parts as a checklist, the reviewer is told which part the
 *      draft never touched, and the reply publishes how many were answered.
 *      A plain Persian «و» is deliberately NOT a separator.
 *
 *   B. NUMERIC EVIDENCE AUDIT — every meaningful number in the draft is
 *      checked against the evidence the draft was allowed to use. Unsourced
 *      numbers are handed to the reviewer as MUST-FIX; the audit itself never
 *      edits a word, because a wrong deletion is worse than a flagged figure.
 *
 * Invariants pinned here:
 *   · Persian/Arabic digits behave exactly like ASCII digits;
 *   · counts and list indices («۲ سناریو») are never flagged;
 *   · a clean draft produces an EMPTY reviewer block (byte-identical prompt);
 *   · `balanced` splits nothing and audits nothing.
 *
 * Fully offline: the fleet is injected, no provider is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractNumbers,
  auditNumbers,
  buildEvidenceCorpus,
  renderUnsourcedBlock,
  normalizeDigits,
  EVIDENCE_AUDIT_SCHEMA
} from '../../server/aiEvidenceAudit.js';
import {
  decomposeQuestion,
  decomposeQuestionDetailed,
  renderSubQuestionChecklist,
  assessQuestionCoverage,
  renderUnansweredParts
} from '../../src/lib/intent-ai/os/questionDecomposition.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

/* -------------------------------------------------------------------------- */
/*  A. NUMERIC EVIDENCE AUDIT                                                 */
/* -------------------------------------------------------------------------- */

test('Persian, Arabic and ASCII digits produce the same number', () => {
  assert.equal(normalizeDigits('۱۰۸'), '108');
  assert.equal(normalizeDigits('١٠٨'), '108');
  assert.deepEqual(extractNumbers('۱۰۸٬۰۰۰').map((n) => n.value), [108000]);
  assert.deepEqual(extractNumbers('108,000').map((n) => n.value), [108000]);
  assert.deepEqual(extractNumbers('١٠٨٬٠٠٠').map((n) => n.value), [108000]);
  assert.deepEqual(extractNumbers('۴.۲٪').map((n) => n.value), [4.2]);
});

test('a number present in the evidence passes; a fabricated one is flagged', () => {
  const corpus = buildEvidenceCorpus({ context: { market: { priceMap: { BTC: 108000 } } } });
  const ok = auditNumbers('بیت‌کوین حدود ۱۰۸٬۰۰۰ دلار است.', corpus);
  assert.equal(ok.schema, EVIDENCE_AUDIT_SCHEMA);
  assert.equal(ok.clean, true);
  assert.equal(ok.sourced, 1);

  const bad = auditNumbers('حمایت بعدی ۱۰۵٬۰۰۰ دلار است.', corpus);
  assert.equal(bad.clean, false);
  assert.deepEqual(bad.unsourced.map((n) => n.value), [105000]);
  /* The audit reports; it does not rewrite. */
  assert.equal(Object.prototype.hasOwnProperty.call(bad, 'answer'), false);
});

test('counts, indices and small integers are never audited', () => {
  const audit = auditNumbers('سه سناریو داریم: ۲ صعودی و ۱ نزولی. همچنین ۳ ریسک اصلی وجود دارد.', '');
  assert.equal(audit.checked, 0, 'prose counts must not become "unsourced numbers"');
  assert.equal(audit.clean, true);
});

test('a clean draft renders an empty reviewer block; a dirty one names the figures', () => {
  const clean = auditNumbers('قیمت 108,000 است.', 'BTC 108000');
  assert.equal(renderUnsourcedBlock(clean), '');

  const dirty = auditNumbers('حمایت 105,000 و کارمزد 0.7٪ است.', 'BTC 108000');
  const block = renderUnsourcedBlock(dirty);
  assert.match(block, /105,000/);
  assert.match(block, /0\.7/);
  assert.match(block, /Remove them, recompute them/i);
});

test('the corpus covers context, knowledge, sources and the analysts — not the final draft', () => {
  const corpus = buildEvidenceCorpus({
    context: { portfolio: { totalValueUsd: 4200 } },
    knowledge: [{ title: 'Fees', body: 'FBT fee is 0.25%', bodyEn: 'FBT fee is 0.25%' }],
    sources: [{ title: 'ETF flows', snippet: 'inflow 640' }],
    analyses: [
      { ok: true, answer: 'level 101500 held', claims: [{ claim: 'funding 0.03' }] },
      { ok: false, answer: 'ignored 999999' }
    ]
  });
  for (const n of [4200, 0.25, 640, 101500, 0.03]) {
    assert.ok(corpus.includes(String(n).replace('0.', '0.')), `corpus should contain ${n}`);
  }
  assert.equal(corpus.includes('999999'), false, 'a failed analysis is not evidence');
});

/* -------------------------------------------------------------------------- */
/*  B. QUESTION DECOMPOSITION                                                 */
/* -------------------------------------------------------------------------- */

test('explicit numbering, several question marks and newlines split; a plain «و» does not', () => {
  assert.deepEqual(decomposeQuestion('۱) قیمت BTC چنده؟ ۲) ریسک سبد من چیه؟'), [
    'قیمت BTC چنده؟',
    'ریسک سبد من چیه؟'
  ]);
  assert.deepEqual(decomposeQuestion('قیمت BTC چنده؟ ریسک سبد من چیه؟'), [
    'قیمت BTC چنده؟',
    'ریسک سبد من چیه؟'
  ]);
  assert.equal(decomposeQuestion('قیمت BTC چنده و ریسک سبد من چیه؟').length, 0,
    'a plain conjunction is not a structure — splitting it would invent parts');
  assert.deepEqual(decomposeQuestion('وضعیت بازار چطور است؛ و همچنین ریسک سبد من چیست؟'), [
    'وضعیت بازار چطور است',
    'ریسک سبد من چیست؟'
  ]);
  assert.equal(decomposeQuestion('سلام، خوبی؟').length, 0);
  assert.equal(decomposeQuestionDetailed('انتخاب بین BTC و ETH').parts.length, 0);
});

test('the checklist is empty for one question and names every part otherwise', () => {
  assert.equal(renderSubQuestionChecklist([], 'fa'), '');
  assert.equal(renderSubQuestionChecklist(['فقط یک سؤال'], 'fa'), '');
  const block = renderSubQuestionChecklist(['قیمت BTC چنده؟', 'ریسک سبد من چیه؟'], 'fa');
  assert.match(block, /2 بخش/);
  assert.match(block, /1\) قیمت BTC چنده؟/);
  assert.match(block, /2\) ریسک سبد من چیه؟/);
});

test('coverage finds the part the draft never answered', () => {
  const parts = ['قیمت BTC چنده؟', 'ریسک سبد من چیه؟'];
  const partial = assessQuestionCoverage(parts, 'قیمت بیت‌کوین الان ۱۰۸ هزار دلار است.');
  assert.deepEqual(partial.covered, [true, false]);
  assert.deepEqual(partial.uncovered, ['ریسک سبد من چیه؟']);
  assert.match(renderUnansweredParts(partial.uncovered, 'fa'), /ریسک سبد/);
  assert.equal(renderUnansweredParts([], 'fa'), '');

  const full = assessQuestionCoverage(parts, 'قیمت BTC حدود ۱۰۸ هزار است و ریسک سبد شما بالاست.');
  assert.equal(full.uncovered.length, 0);
});

/* -------------------------------------------------------------------------- */
/*  C. INTEGRATION — the checks reach the prompts and the reply               */
/* -------------------------------------------------------------------------- */

const TWO_PART = '۱) قیمت BTC چنده؟ ۲) ریسک سبد من چیه؟';
const DRAFT_WITH_INVENTED_LEVEL = 'بیت‌کوین حدود ۱۰۸٬۰۰۰ دلار معامله می‌شود و سطح حمایت بعدی ۱۰۵٬۰۰۰ دلار است. '
  + 'این خوانش قطعی نیست و به داده تازه وابسته است؛ بدون خواندن جریان صندوق‌ها تصمیم‌گیری توصیه نمی‌شود.';
const REPAIRED = 'بیت‌کوین در داده خوانده‌شده حدود ۱۰۸٬۰۰۰ دلار است. سطح حمایت بعدی در داده موجود نیست و آن را حدس نمی‌زنم؛ '
  + 'ریسک سبد شما به وزن همین دارایی وابسته است و بدون خواندن جریان صندوق‌ها نمی‌توان عدد داد.';

function makeFleet() {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, engine: 'external-model', text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) {
      return reply({ answer: REPAIRED, claims: [{ claim: 'removed unsourced 105000 support level', type: 'opinion', confidence: 90 }], uncertainty: '' });
    }
    if (system.includes('Final Answer AI')) {
      return reply({ answer: DRAFT_WITH_INVENTED_LEVEL, claims: [], uncertainty: 'وابسته به داده تازه' });
    }
    return reply({ answer: 'تحلیل نقش: داده زنده فشار فروش را نشان می‌دهد.', claims: [], uncertainty: 'خوانش بعدی لازم است' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer')),
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI'))
  };
}

test('max: the parts reach the analysts and the reviewer, and the reply publishes coverage', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: TWO_PART,
    locale: 'fa',
    context: { market: { priceMap: { BTC: 108000 } } },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.finalCalls()[0].message.includes('این پیام 2 بخش دارد'),
    'the synthesiser must be told the message has two parts');

  const critique = fleet.critiqueCalls()[0];
  assert.match(critique.message, /UNSOURCED NUMBERS/, 'the fabricated support level must be flagged');
  assert.match(critique.message, /105/);
  assert.match(critique.message, /بخش‌هایی از پرسش/, 'the unanswered part must be named to the reviewer');

  /* The published audit describes the FINAL text (after the review withdrew
     the invented level), not the draft that had it. */
  assert.equal(out.numericAudit.schema, EVIDENCE_AUDIT_SCHEMA);
  assert.equal(out.numericAudit.clean, true);
  assert.deepEqual(out.numericAudit.unsourced, []);
  assert.equal(out.subQuestions.parts.length, 2);
  assert.equal(Array.isArray(out.subQuestions.uncovered), true);
  assert.equal(out.critique.used, true);
});

test('balanced: no split, no audit, no extra block — the historical turn', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: TWO_PART,
    locale: 'fa',
    context: { market: { priceMap: { BTC: 108000 } } },
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.equal(out.numericAudit, null);
  assert.equal(out.subQuestions, null);
  for (const call of fleet.calls) {
    assert.equal(call.message.includes('این پیام'), false, 'balanced must not receive the checklist');
    assert.equal(call.message.includes('UNSOURCED NUMBERS'), false);
  }
  assert.equal(fleet.critiqueCalls().length, 0);
});

test('max on a single question: no checklist and no audit block on a clean draft', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'سناریوهای استراتژی بیت‌کوین چیست؟',
    locale: 'fa',
    context: { market: { priceMap: { BTC: 108000 } } },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.subQuestions, null);
  for (const call of fleet.calls) {
    assert.equal(call.message.includes('این پیام'), false);
  }
  /* The draft invents 105000; the review withdrew it, so the published audit
     of the final text is clean. The audit itself changed nothing. */
  assert.equal(out.numericAudit.clean, true);
  assert.equal(out.answer, REPAIRED);
  assert.equal(fleet.critiqueCalls()[0].message.includes('UNSOURCED NUMBERS'), true);
});
