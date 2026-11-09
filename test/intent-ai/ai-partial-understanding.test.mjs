/**
 * «اگر درخواست یا کلمات ناقص بود، منظور را بفهم» — and think deeply about it.
 * ---------------------------------------------------------------------------
 * «بیتکوین؟» is not small talk. «استراتژی من با ۲۰۰۰۰» is a sentence that was
 * never finished. «fovl» is «بخرم» typed with the keyboard on the wrong
 * language. A layer that waits for a well-formed question answers all three
 * badly, and a layer that guesses silently answers a question nobody asked with
 * numbers nobody gave.
 *
 * `src/lib/intent-ai/os/conversation/partialInput.js` repairs what is
 * recoverable, infers the most likely reading with a labelled assumption, allows
 * exactly one question, and raises the depth of an incomplete turn so the
 * reading is never done on the one-line path.
 *
 * Every test here is offline: no provider, no network, no key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PARTIAL_INPUT_SCHEMA,
  foldInput,
  repairInput,
  resolveWord,
  readPartialInput,
  renderPartialContract,
  checkPartialAnswer,
  renderPartialDeficit,
  deepThinkFloor
} from '../../src/lib/intent-ai/os/conversation/partialInput.js';
import { planCollaboration } from '../../src/lib/intent-ai/os/collaborationRouter.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

const read = (message, extra = {}) => readPartialInput({ message, ...extra });

/* -------------------------------------------------------------------------- */
/*  A. REPAIR                                                                 */
/* -------------------------------------------------------------------------- */

test('a line typed on the wrong keyboard layout is read back', () => {
  /* «fovl» is ب-خ-ر-م on the Persian layout. */
  const repair = repairInput('fovl');
  assert.equal(repair.layoutFixed, true);
  assert.ok(repair.repairs.some((r) => r.how === 'layout' && r.to === 'بخرم'));
  assert.equal(repairInput('بخرم').layoutFixed, false, 'a correct word is not "repaired"');
});

test('Arabic yeh/kaf and Persian digits are folded', () => {
  assert.equal(foldInput('كتاب'), 'کتاب');
  assert.equal(foldInput('٢۵٠ دلار'), '250 دلار');
  assert.equal(foldInput('می‌خواهم'), 'می خواهم');
});

test('a near-miss spelling is snapped to the real word', () => {
  assert.equal(resolveWord('بیتکاین')?.word, 'بیتکوین');
  assert.equal(resolveWord('استراتزی')?.word, 'استراتژی');
  assert.equal(resolveWord('بیتکاین')?.how, 'typo');
});

test('a word that was cut mid-typing is finished — and a real word is not', () => {
  assert.equal(resolveWord('استرات', { allowPrefix: true })?.how, 'prefix');
  assert.equal(resolveWord('استرات', { allowPrefix: true })?.word, 'استراتژی');
  /* «چقدر» is a real word, not a typo of «چقدره». */
  assert.equal(resolveWord('چقدر')?.how, 'exact');
  assert.equal(read('سبد من چقدر سود کرده؟').completeness, 'complete');
});

/* -------------------------------------------------------------------------- */
/*  B. WHAT KIND OF INCOMPLETE                                                */
/* -------------------------------------------------------------------------- */

test('each kind of incomplete input is named', () => {
  assert.equal(read('بیتکوین؟').completeness, 'fragment');
  assert.equal(read('۲۵۰ دلار سولانا').completeness, 'fragment');
  assert.equal(read('استراتژی من با ۲۰۰۰۰').completeness, 'truncated');
  assert.equal(read('سولانا بخرم یا').completeness, 'truncated');
  assert.equal(read('fovl').completeness, 'garbled');
  assert.equal(read('بخرم؟').completeness, 'ambiguous');
  assert.equal(read('قیمت بیتکوین چنده؟').completeness, 'complete');
  assert.equal(read('سبد من چقدر سود کرده؟').completeness, 'complete');
  assert.equal(read('').completeness, 'empty');
});

test('small talk is named as small talk, never as a broken request', () => {
  for (const message of ['سلام', 'سلام، چطوری؟', 'ممنون، لطف کردی', 'خوبی؟']) {
    const r = read(message);
    assert.equal(r.completeness, 'small-talk', message);
    assert.equal(r.questionBudget, 0, message);
    assert.equal(renderPartialContract(r), '', message);
  }
});

test('a definition question is complete, whatever its length', () => {
  for (const message of ['what is BTC?', 'تتر یعنی چی', 'دیفای یعنی چه', 'gas fee یعنی چی']) {
    const r = read(message);
    assert.equal(r.completeness, 'complete', message);
    assert.equal(deepThinkFloor({ read: r }).floor, 0, message);
  }
});

test('a cut-off sentence is reported as cut off, not as a topic', () => {
  const r = read('سولانا بخرم یا');
  assert.equal(r.signals.dangling, true);
  assert.equal(r.inferred.assets.includes('SOL'), true);
  assert.match(renderPartialContract(r), /stops mid-thought/);
});

/* -------------------------------------------------------------------------- */
/*  C. WHAT IT PROBABLY MEANS                                                 */
/* -------------------------------------------------------------------------- */

test('a bare asset name is read as a state question, and says so', () => {
  const r = read('بیتکوین؟');
  assert.equal(r.inferred.assets.includes('BTC'), true);
  const assumption = r.assumptions.find((a) => a.slot === 'act');
  assert.equal(assumption.value, 'analysis');
  assert.equal(assumption.basis, 'bare-asset-fragment');
});

test('amount plus asset with no verb is read as a buy — and labelled', () => {
  const r = read('۲۵۰ دلار سولانا');
  const assumption = r.assumptions.find((a) => a.slot === 'act');
  assert.equal(assumption.value, 'buy');
  assert.equal(assumption.basis, 'amount-and-asset-without-verb');
  assert.equal(r.inferred.amount.value, 250);
});

test('the previous turn’s asset is carried over, with its basis named', () => {
  const r = read('بیشتر توضیح بده', { context: { lastAssets: ['ETH'] } });
  const carried = r.assumptions.find((a) => a.slot === 'asset');
  assert.equal(carried.value, 'ETH');
  assert.equal(carried.basis, 'previous-turn');
  assert.equal(r.inferred.assetSource, 'previous-turn');
  /* A follow-up that carries an asset is not a "bare asset fragment". */
  assert.equal(r.assumptions.some((a) => a.basis === 'bare-asset-fragment'), false);
});

test('one question, chosen by what the answer cannot do without', () => {
  const noAsset = read('بخرم؟');
  assert.equal(noAsset.questionBudget, 1);
  assert.equal(noAsset.question.slot, 'asset');
  assert.deepEqual(noAsset.missing.map((m) => m.slot), ['asset', 'amount']);

  const noAmount = read('سولانا بخرم؟');
  assert.equal(noAmount.questionBudget, 1);
  assert.equal(noAmount.question.slot, 'amount');

  /* Nothing is missing, so nothing is interrogated. */
  assert.equal(read('قیمت بیتکوین چنده؟').questionBudget, 0);
  assert.equal(read('بیتکوین؟').questionBudget, 0);
});

test('confidence is honest: a fragment is not a complete question', () => {
  assert.ok(read('قیمت بیتکوین چنده؟').confidence > read('بیتکوین؟').confidence);
  assert.ok(read('بیتکوین؟').confidence > read('بخرم؟').confidence);
  assert.ok(read('سلام').confidence > read('قیمت بیتکوین چنده؟').confidence);
});

/* -------------------------------------------------------------------------- */
/*  D. THE CONTRACT                                                           */
/* -------------------------------------------------------------------------- */

test('the brief says what was assumed, what is missing and the budget', () => {
  const text = renderPartialContract(read('سولانا بخرم یا'));
  assert.match(text, /PARTIAL INPUT/);
  assert.match(text, /CUT OFF mid-thought/);
  assert.match(text, /most likely reading: buy · SOL/);
  assert.match(text, /genuinely missing: amount/);
  assert.match(text, /question budget: ONE/);
  assert.match(text, /answer the most likely reading usefully FIRST/);
});

test('a complete message costs nothing — no brief at all', () => {
  assert.equal(renderPartialContract(read('قیمت بیتکوین چنده؟')), '');
  assert.equal(renderPartialContract(read('سلام')), '');
  assert.equal(renderPartialContract(read('')), '');
  assert.equal(renderPartialContract(null), '');
});

test('a silent assumption is caught; a named one is not', () => {
  const r = read('بیتکوین؟');
  const silent = checkPartialAnswer({ read: r, answer: 'بیت‌کوین ۶۸ هزار دلار است و روند نزولی کوتاه‌مدت دارد.' });
  assert.ok(silent.issues.some((i) => i.id === 'ASSUMED_SPEC_UNDISCLOSED'));

  const named = checkPartialAnswer({ read: r, answer: 'اگر منظورت وضعیت بیت‌کوین است: ۶۸ هزار دلار و روند نزولی کوتاه‌مدت.' });
  assert.deepEqual(named.issues, []);
  assert.match(renderPartialDeficit(silent), /PARTIAL-INPUT VIOLATIONS/);
  assert.equal(renderPartialDeficit(named), '');
});

test('a plan built on an amount the user never gave is HIGH — Persian digits too', () => {
  const r = read('بخرم؟');
  const bad = checkPartialAnswer({ read: r, answer: 'با ۱۰۰۰ دلار بخر و حد ضرر ۸ درصد بگذار.' });
  assert.ok(bad.issues.some((i) => i.id === 'INVENTED_AMOUNT'));
  assert.equal(bad.compliant, false);

  const labelled = checkPartialAnswer({ read: r, answer: 'فرض می‌کنم منظورت خرید است؛ با ۱۰۰۰ دلار، حد ضرر ۸ درصد یعنی ۸۰ دلار ریسک.' });
  assert.equal(labelled.issues.some((i) => i.id === 'INVENTED_AMOUNT'), false);
});

test('an interrogation instead of one question is caught', () => {
  const r = read('بخرم؟');
  const bad = checkPartialAnswer({ read: r, answer: 'چه ارزی؟ چه مبلغی؟ چه افقی؟' });
  assert.ok(bad.issues.some((i) => i.id === 'QUESTION_BUDGET_EXCEEDED'));

  const good = checkPartialAnswer({ read: r, answer: 'اگر منظورت خرید است، بگو کدام دارایی تا برنامه را روی همان ببندم؟' });
  assert.equal(good.issues.some((i) => i.id === 'QUESTION_BUDGET_EXCEEDED'), false);
});

test('a complete exchange is never policed', () => {
  const check = checkPartialAnswer({ read: read('قیمت بیتکوین چنده؟'), answer: '۶۸ هزار؟ بله، حدود همین است؟' });
  assert.equal(check.applicable, false);
  assert.equal(check.compliant, true);
  assert.equal(checkPartialAnswer({ read: null, answer: 'هر متنی' }).applicable, false);
});

/* -------------------------------------------------------------------------- */
/*  E. DEEP THINKING                                                          */
/* -------------------------------------------------------------------------- */

test('an incomplete message never runs on the one-line path', () => {
  assert.equal(deepThinkFloor({ read: read('بیتکوین؟') }).floor, 3);
  for (const message of ['بخرم؟', 'استراتژی من با ۲۰۰۰۰', 'fovl', 'سولانا بخرم یا']) {
    assert.equal(deepThinkFloor({ read: read(message) }).floor, 3, message);
  }
  assert.equal(deepThinkFloor({ read: read('قیمت بیتکوین چنده؟') }).floor, 0);
  assert.equal(deepThinkFloor({ read: read('سلام') }).reason, 'small-talk');
});

test('the plan publishes the reading and how deep it forced the turn', () => {
  const plan = planCollaboration({ message: 'بفروشم', deepThink: true });
  assert.equal(plan.partial.completeness, 'ambiguous');
  assert.equal(plan.deepThink.enabled, true);
  assert.equal(plan.deepThink.understanding, 'deep');
  assert.equal(plan.deepThink.applied, true);
  assert.ok(plan.level >= 3);

  const shallow = planCollaboration({ message: 'بفروشم', deepThink: false });
  assert.ok(plan.level > shallow.level, 'deep think did not raise the level');
  assert.equal(shallow.deepThink.reason, 'disabled');
});

test('small talk stays level 1 even with deep thinking on', () => {
  for (const message of ['سلام', 'ممنون، لطف کردی', 'چخبر']) {
    const plan = planCollaboration({ message, intelligence: 'max', intelligenceFloor: 4, intelligenceCeiling: 5 });
    assert.equal(plan.level, 1, message);
    assert.equal(plan.deepThink.applied, false, message);
  }
});

/* -------------------------------------------------------------------------- */
/*  F. WIRING                                                                 */
/* -------------------------------------------------------------------------- */

function makeFleet({ finalAnswer = 'اگر منظورت وضعیت بیت‌کوین است: محدودهٔ ۶۴ تا ۶۸ هزار مهم است. ' } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: محدودهٔ ۶۴ تا ۶۸ هزار.', claims: [], uncertainty: '' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer')),
    partialCalls: () => calls.filter((c) => c.system.includes('PARTIAL INPUT'))
  };
}

test('max: the partial brief reaches the roles and the reply publishes the reading', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'بیتکوین؟',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.partialCalls().length >= 2, 'the reading did not reach the specialists');
  assert.match(fleet.finalCalls()[0].system, /PARTIAL INPUT/);
  assert.match(fleet.finalCalls()[0].system, /ASSUMPTION you must state/);

  assert.equal(out.partial.schema, PARTIAL_INPUT_SCHEMA);
  assert.equal(out.partial.completeness, 'fragment');
  assert.deepEqual(out.partial.assumptions, ['act']);
  assert.equal(out.partial.compliant, true);
});

test('understanding is deep in every mode: balanced gets the brief too', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'سولانا بخرم یا',
    locale: 'fa',
    context: {},
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.ok(fleet.partialCalls().length >= 1);
  assert.equal(out.partial.completeness, 'truncated');
  assert.deepEqual(out.partial.missing, ['amount']);
  assert.equal(out.partial.questionBudget, 1);
});

test('a complete message keeps the balanced prompt byte-identical', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: 'قیمت بیتکوین چنده؟',
    locale: 'fa',
    context: {},
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.partial.completeness, 'complete');
  for (const call of fleet.calls) {
    assert.equal(call.system.includes('PARTIAL INPUT'), false);
  }
});

test('max: a draft that silently assumes is sent back to the reviewer', async () => {
  const fleet = makeFleet({
    finalAnswer: 'بیت‌کوین در محدودهٔ ۶۴ تا ۶۸ هزار دلار است. '
      + 'مقاومت اصلی ۶۸ هزار و حمایت ۶۴ هزار است. '
      + 'برای خرید پله‌ای عمل کن و حد ضرر ۸ درصد بگذار. '
      + 'حجم معاملات هم پایین است، پس عجله نکن.'
  });
  const out = await runCollaborativeAnalysis({
    message: 'بیتکوین؟',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 20000
  });

  assert.ok(fleet.critiqueCalls().length >= 1, 'no reviewer ran');
  assert.match(fleet.critiqueCalls()[0].message, /PARTIAL-INPUT VIOLATIONS/);
  assert.match(fleet.critiqueCalls()[0].message, /ASSUMED_SPEC_UNDISCLOSED/);
  assert.equal(out.partial.compliant, false);
  assert.ok(out.partial.violations.includes('ASSUMED_SPEC_UNDISCLOSED'));
});

test('max: a draft that names its assumption passes clean', async () => {
  const fleet = makeFleet({
    finalAnswer: 'اگر منظورت وضعیت بیت‌کوین است: محدودهٔ ۶۴ تا ۶۸ هزار دلار. '
      + 'مقاومت ۶۸ و حمایت ۶۴ هزار است. '
      + 'روند کوتاه‌مدت نزولی است. '
      + 'برای تصمیم دقیق‌تر به افق زمانی نیاز دارم.'
  });
  const out = await runCollaborativeAnalysis({
    message: 'بیتکوین؟',
    locale: 'fa',
    context: {},
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 20000
  });
  assert.equal(out.partial.compliant, true);
  assert.deepEqual(out.partial.violations, []);
});
