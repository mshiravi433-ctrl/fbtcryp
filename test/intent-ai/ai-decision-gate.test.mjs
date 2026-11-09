/**
 * «مغز تصمیم‌گیری را باهوش کن» — the DECISION GATE.
 * ---------------------------------------------------------------------------
 * Most answers are read as advice whether or not advice was asked for. The
 * dangerous case is narrow: the user asks for a DECISION («الان بخرم؟»), the
 * evidence is thin — no live market, no source, nothing verified — and the
 * answer still says «بخر» in a confident sentence. Three models agreeing does
 * not make that evidence.
 *
 * The gate is deterministic:
 *   1. is this a decision question?
 *   2. how much evidence does the turn actually hold? (scored from what is in
 *      hand — nothing is fetched, nothing is guessed)
 *   3. what does that level permit? sufficient → recommendation with a
 *      condition; partial → conditional only; thin → no-action or an explicit
 *      conditional plan.
 *   4. after the draft: did it obey? A bare direction on thin/partial evidence
 *      is a DEFICIT for the reviewer.
 *
 * Refusing to act is always allowed, and «توصیه نمی‌کنم بخرید» is not a
 * violation — the gate is about unjustified confidence, not about caution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessEvidence,
  evaluateDecision,
  renderDecisionContract,
  renderDecisionDeficit,
  DECISION_GATE_SCHEMA
} from '../../server/aiDecisionGate.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const THIN = assessEvidence({});
const RICH = assessEvidence({
  context: { market: { priceMap: { BTC: 108000 }, dataStatus: 'live' }, portfolio: { totalValueUsd: 10000 } },
  sources: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
  knowledge: [{ id: 'kb' }],
  comparison: { agreement: '3/3', disagreement: false },
  ledger: { verifiedCount: 2, conflictCount: 0 }
});
const PARTIAL = assessEvidence({
  context: { market: { priceMap: { BTC: 108000 }, dataStatus: 'live' }, portfolio: { totalValueUsd: 10000 } }
});

/* -------------------------------------------------------------------------- */
/*  A. EVIDENCE                                                               */
/* -------------------------------------------------------------------------- */

test('an empty turn is thin; live data plus verified claims is sufficient', () => {
  assert.equal(THIN.schema, DECISION_GATE_SCHEMA);
  assert.equal(THIN.level, 'thin');
  assert.deepEqual(THIN.missing, ['live_market', 'verified_claims']);

  assert.equal(RICH.level, 'sufficient');
  for (const reason of ['live_market', 'portfolio', 'multiple_sources', 'internal_knowledge', 'models_agree', 'verified_claims']) {
    assert.ok(RICH.reasons.includes(reason), `expected ${reason}`);
  }
});

test('stale data and conflicting figures count against the evidence', () => {
  const stale = assessEvidence({ context: { market: { priceMap: { BTC: 1 }, dataStatus: 'stale' } } });
  assert.ok(stale.reasons.includes('stale_market'));
  const conflicted = assessEvidence({ ledger: { verifiedCount: 1, conflictCount: 2 } });
  assert.ok(conflicted.reasons.includes('conflicting_figures'));
});

/* -------------------------------------------------------------------------- */
/*  B. WHAT THE LEVEL PERMITS                                                 */
/* -------------------------------------------------------------------------- */

test('only decision questions are gated', () => {
  assert.equal(evaluateDecision({ message: 'قیمت BTC چنده؟', evidence: THIN, answer: '۱۱۰ هزار' }).applicable, false);
  assert.equal(evaluateDecision({ message: 'الان بخرم یا نه؟', evidence: THIN, answer: 'صبر کن.' }).applicable, true);
  assert.equal(evaluateDecision({ message: 'should i buy now?', evidence: THIN, answer: 'wait.' }).applicable, true);
});

test('thin evidence does not permit a bare direction', () => {
  const gate = evaluateDecision({ message: 'الان بخرم؟', evidence: THIN, answer: 'الان بخر، بازار خوبه.' });
  assert.equal(gate.verdict, 'NO_ACTION_OR_CONDITIONAL');
  assert.equal(gate.recommendationDetected, true);
  assert.equal(gate.compliant, false);
});

test('a conditional plan and the safe direction are both allowed on thin evidence', () => {
  const conditional = evaluateDecision({
    message: 'الان بخرم؟',
    evidence: THIN,
    answer: 'اگر بتوانی افت ۳۰٪ را تحمل کنی، پلکانی بخر.'
  });
  assert.equal(conditional.compliant, true);
  assert.equal(conditional.conditional, true);

  const safe = evaluateDecision({ message: 'الان بخرم؟', evidence: THIN, answer: 'نخر؛ صبر کن تا داده تازه برسد.' });
  assert.equal(safe.recommendationDetected, false);
  assert.equal(safe.compliant, true);
});

test('a negated instruction is not read as an instruction', () => {
  const gate = evaluateDecision({
    message: 'الان بخرم؟',
    evidence: THIN,
    answer: 'توصیه نمی‌کنم بخرید؛ داده کافی نیست.'
  });
  assert.equal(gate.recommendationDetected, false);
  assert.equal(gate.compliant, true);
});

test('partial evidence demands a condition; sufficient evidence does not', () => {
  assert.equal(PARTIAL.level, 'partial');
  const bare = evaluateDecision({ message: 'الان بخرم؟', evidence: PARTIAL, answer: 'بخر.' });
  assert.equal(bare.compliant, false);
  const conditional = evaluateDecision({ message: 'الان بخرم؟', evidence: PARTIAL, answer: 'اگر افت ۱۰٪ را تحمل کنی، بخر.' });
  assert.equal(conditional.compliant, true);

  const allowed = evaluateDecision({ message: 'الان بخرم؟', evidence: RICH, answer: 'بخر، با حد ضرر مشخص.' });
  assert.equal(allowed.verdict, 'ALLOWED');
  assert.equal(allowed.compliant, true);
});

test('the contract and the deficit say different things at different levels', () => {
  assert.match(renderDecisionContract({ message: 'الان بخرم؟', evidence: THIN }), /THIN/);
  assert.match(renderDecisionContract({ message: 'الان بخرم؟', evidence: THIN }), /NO-ACTION/);
  assert.match(renderDecisionContract({ message: 'الان بخرم؟', evidence: PARTIAL }), /CONDITIONAL/);
  assert.match(renderDecisionContract({ message: 'الان بخرم؟', evidence: RICH }), /SUFFICIENT/);
  assert.equal(renderDecisionContract({ message: 'قیمت چنده؟', evidence: THIN }), '');

  const deficit = renderDecisionDeficit(evaluateDecision({ message: 'الان بخرم؟', evidence: THIN, answer: 'بخر.' }));
  assert.match(deficit, /DECISION DEFICIT/);
  assert.match(deficit, /Do not soften the wording/);
  assert.equal(renderDecisionDeficit(evaluateDecision({ message: 'الان بخرم؟', evidence: RICH, answer: 'بخر.' })), '');
  assert.equal(renderDecisionDeficit(null), '');
});

/* -------------------------------------------------------------------------- */
/*  C. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

const BARE_BUY = 'به نظر من الان بخر و نگران نباش؛ شرایط بازار برای ورود مناسب است و در چند هفته آینده '
  + 'روند صعودی ادامه دارد. ریسک را هم می‌توانی بعداً مدیریت کنی و لازم نیست الان به آن فکر کنی.';

function makeFleet({ finalAnswer = BARE_BUY } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: داده کافی نیست.', claims: [], uncertainty: 'داده کم است' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer'))
  };
}

test('max: a decision on thin evidence reaches the model with the gate and the reviewer with the deficit', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'الان بخرم یا نه؟',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.match(fleet.finalCalls()[0].system, /DECISION GATE/);
  assert.match(fleet.finalCalls()[0].system, /THIN/);
  assert.match(fleet.critiqueCalls()[0].message, /DECISION DEFICIT/);

  assert.equal(out.decision.applicable, true);
  assert.equal(out.decision.verdict, 'NO_ACTION_OR_CONDITIONAL');
  assert.equal(out.decision.compliant, false);
});

test('max: an information question is not gated', async () => {
  const fleet = makeFleet({ finalAnswer: 'بیت‌کوین در داده زنده ۱۰۸٬۰۰۰ دلار است و سطح بعدی خوانده نشده؛ حدس نمی‌زنم.' });
  const out = await runCollaborativeAnalysis({
    message: 'قیمت BTC چنده؟',
    locale: 'fa',
    context: { market: { priceMap: { BTC: 108000 }, dataStatus: 'live' } },
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.decision, null);
  for (const c of fleet.calls) assert.equal(c.system.includes('DECISION GATE'), false);
});

test('balanced: no gate, no verdict, no block', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'الان بخرم یا نه؟',
    locale: 'fa',
    context: {},
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.decision, null);
  for (const c of fleet.calls) assert.equal(c.system.includes('DECISION GATE'), false);
});
