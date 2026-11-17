/**
 * ─── A GUARD COMPUTED OVER THE WHOLE SENTENCE MUST NOT SILENCE A CLAUSE THAT
 *     NEVER CONTAINED ITS TRIGGER ───────────────────────────────────────────
 *
 * The classifier has two owner-guards. A DISTRESSED owner («همه پولمو بفروشم»)
 * and a DISCOVERING owner («چی خوبه بخرم؟») are asking about themselves, not
 * issuing an order, so `scoreClaim` skips the EXECUTE_SWAP rule for them and
 * answers with the market view instead. That is the right call and it is the
 * safe direction for money.
 *
 * Both guards were computed from the WHOLE SENTENCE and then applied to every
 * part of it. A sentence can be two claims. Measured before this gate existed:
 *
 *   «اتریوم را بفروش»                        → EXECUTE_SWAP   (perm EXECUTE)
 *   «اتریوم را بفروش و ییلد خوب پیشنهاد بده»   → YIELD_OPPORTUNITY (perm READ)
 *                                                evidence: no EXECUTE_SWAP at all
 *
 * The advice words in the SECOND clause set `isDiscovery` for the sentence, and
 * the guard then silenced the order in the FIRST clause — a clause that contains
 * no advice word whatsoever. Of four order+advice sentences, one kept the money
 * instruction. Nothing in the output said a second question had been asked, so
 * the user's sell instruction did not get refused; it was never collected.
 *
 * The fix is one rule, applied where the evidence is: the guard fires when a
 * clause contains BOTH an execution verb and a guard trigger. The verb list is
 * the EXECUTE_SWAP rule's own pattern read out of `RULES`, so the guard cannot
 * drift from the rule it guards. A single clause behaves exactly as before, and
 * a panic sell written across two clauses still fires because one of its clauses
 * holds both.
 *
 * Three properties are gated here, and the second one is the reason this file
 * exists rather than a line in another test: the win must not come from
 * weakening the guard. Every sentence that was guarded before is asserted to
 * still be guarded.
 *
 *   node --test test/intent-ai/compound-clause-guard-runtime.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, createIntent } from '../../src/lib/central/intent.js';

const legsOf = (c) => (c && Array.isArray(c.compound) ? c.compound : []);
const legIntents = (c) => legsOf(c).map((l) => l && l.intent).filter(Boolean);
/** The money instruction is kept if the turn OR any of its legs is an execution. */
const keepsOrder = (c) => c.type === 'EXECUTE_SWAP' || legIntents(c).some((i) => /^EXECUTE_/.test(i));
const anyExecution = (c) => /^EXECUTE_/.test(c.type) || legIntents(c).some((i) => /^EXECUTE_/.test(i));

test('an order in one clause survives an advice question in the other', () => {
  const sentences = [
    'اتریوم را بفروش و بعد ییلد خوب پیشنهاد بده',
    'اتریوم را بفروش و ییلد خوب پیشنهاد بده',
    'بیت کوین را بفروش و بهترین ارز را معرفی کن',
    '۱۰۰ دلار اتریوم بخر و وضعیت بازار را هم بگو',
  ];
  const lost = [];
  for (const text of sentences) {
    const c = classify(text, {});
    if (!keepsOrder(c)) lost.push(`${text} → ${c.type} legs=[${legIntents(c).join(',')}]`);
    /* The trail must show it too: a leg that exists only inside the planner
       cannot be attributed to anything in the reply. */
    const named = (c.evidence || []).some((e) => /EXECUTE_/.test(String(e)));
    if (!named) lost.push(`${text} → EXECUTE_SWAP is not in evidence: ${JSON.stringify(c.evidence)}`);
  }
  assert.deepEqual(lost, [], 'a money instruction must not be silenced by a different clause');
});

test('every guard trigger is really a trigger, and none of them silences the other clause', () => {
  /*
   * This loop is self-validating on purpose. A test that says "the order
   * survives when the advice phrase is in the other clause" passes vacuously if
   * the phrase is not actually a guard trigger — the guard would not have fired
   * either way. So each phrase is first proven to set the flag it is claimed to
   * set, and only then paired with an order.
   */
  const triggers = ['پیشنهاد بده', 'معرفی کن', 'چی خوبه بخرم', 'کدوم ارز رو بخرم', 'بهترین ارز را معرفی کن'];
  for (const phrase of triggers) {
    const alone = classify(phrase, {});
    assert.equal(
      alone.entities?.isDiscovery, true,
      `«${phrase}» must be a discovery trigger, or this row proves nothing (got ${alone.type}, isDiscovery=${alone.entities?.isDiscovery})`
    );
    assert.equal(anyExecution(alone), false, `«${phrase}» alone is advice, not an order`);

    const paired = classify(`اتریوم را بفروش و ${phrase}`, {});
    assert.equal(
      keepsOrder(paired), true,
      `«اتریوم را بفروش و ${phrase}» lost the order: type=${paired.type} legs=[${legIntents(paired).join(',')}]`
    );
  }
});

test('a panic sell is still not an order — in one clause and across two', () => {
  /*
   * The half of this gate that matters. The fix above could have been bought by
   * simply deleting the guard, and every "order survives" assertion would still
   * have passed. These are the sentences the guard exists for, and the second
   * one is the hard case: its trigger and its verb are in DIFFERENT clauses of a
   * two-clause sentence, and it must still be guarded, because the clause that
   * holds the verb («همه پولمو بفروشم») holds the panic words too.
   */
  const rows = [
    ['همه پولمو بفروشم', 'MARKET_OVERVIEW'],
    ['حالم بده و همه پولمو بفروشم', 'MARKET_OVERVIEW'],
    ['همشو بفروشم و ضررم رو کم کنم', 'MARKET_OVERVIEW'],
    ['کل سرمایه‌ام را بفروشم و حالم بده', 'MARKET_OVERVIEW'],
  ];
  for (const [text, expected] of rows) {
    const c = classify(text, {});
    assert.equal(anyExecution(c), false,
      `«${text}» must not become an execution: got ${c.type} legs=[${legIntents(c).join(',')}]`);
    assert.equal(c.type, expected, `«${text}» should answer as the owner question it is`);
  }
});

test('a discovery question is still a market question', () => {
  for (const text of ['چی خوبه بخرم؟', 'کدوم ارز رو بخرم', 'بهترین گزینه برای خرید کدام ارز است']) {
    const c = classify(text, {});
    assert.equal(anyExecution(c), false, `«${text}» is asking for advice, not ordering`);
    assert.equal(c.type, 'MARKET_OVERVIEW', `«${text}» → ${c.type}`);
  }
});

test('a leg is judged by its own words, in both directions', () => {
  /*
   * Direction one: an amount in the FIRST clause used to disable the discovery
   * flag for the whole sentence, which meant the second clause — a genuine
   * advice question — produced no hits at all and was dropped from the split.
   * Measured before: legs=[—]. The digit rule is about whether a clause names an
   * amount, and a clause is where that question can be answered.
   */
  const withDigits = classify('۱۰۰ دلار اتریوم بخر و بهترین ارز را معرفی کن', {});
  assert.deepEqual(legIntents(withDigits).sort(), ['EXECUTE_SWAP', 'MARKET_OVERVIEW'].sort(),
    `the advice clause must become its own leg, got [${legIntents(withDigits).join(',')}]`);

  /*
   * Direction two: a panic word in one clause must not colour a plain question
   * in the other. The price question keeps its own subject.
   */
  const withPanic = classify('همه پولمو بفروشم و قیمت بیت کوین چنده', {});
  assert.deepEqual(legIntents(withPanic), ['MARKET_OVERVIEW', 'ASSET_ANALYSIS'],
    `each half keeps its own meaning, got [${legIntents(withPanic).join(',')}]`);
});

test('the permission label is the union of the legs, because the plan is', () => {
  /*
   * `buildPlan` merges every leg's template into ONE plan, so a turn whose
   * headline is a read and whose second leg is a swap has a money step in it.
   * These three flags were derived from the top intent alone, so that turn
   * carried `confirmationRequired: false`. `pipeline` recomputes the flag from
   * the plan and `brain` re-derives its money steps from step permissions, which
   * is why nothing moved — but `brain` also reads the label to decide which step
   * operations count as money steps, so a wrong label was being read somewhere.
   */
  const readHeadlineWithSwapLeg = classify('اتریوم را بفروش و بعد ییلد خوب پیشنهاد بده', {});
  assert.equal(readHeadlineWithSwapLeg.definition?.permission, 'READ',
    'this case only means something while the headline is a read');
  assert.ok(legIntents(readHeadlineWithSwapLeg).includes('EXECUTE_SWAP'),
    '…and one of its legs is the swap');
  const intent = createIntent({
    message: 'اتریوم را بفروش و بعد ییلد خوب پیشنهاد بده',
    classification: readHeadlineWithSwapLeg,
    context: {}, requestId: 'r-clause-guard', sessionId: 's-clause-guard'
  });
  assert.equal(intent.confirmationRequired, true, 'a plan with a money step asks first');
  assert.equal(intent.executionRequired, true);
  assert.equal(intent.verificationRequired, true);

  const readOnly = classify('بازار و ییلد', {});
  const readIntent = createIntent({
    message: 'بازار و ییلد', classification: readOnly,
    context: {}, requestId: 'r-read', sessionId: 's-read'
  });
  assert.equal(readIntent.confirmationRequired, false, 'a compound read confirms nothing');
  assert.equal(readIntent.executionRequired, false);
});

test('a compound READ never gains an execution leg from this', () => {
  /* The fix widens what the splitter can see. This is the boundary it must not
     cross: two reads stay two reads, and the pairs that were measured before are
     still the pairs that come out. */
  const rows = [
    ['بازار و ییلد', ['MARKET_OVERVIEW', 'YIELD_OPPORTUNITY']],
    ['ریسک و بازده', ['RISK_OVERVIEW', 'YIELD_OPPORTUNITY']],
    ['قیمت بیت کوین و موجودی کیف پول', ['ASSET_ANALYSIS', 'BALANCE_QUERY']],
    ['بازار را نشان بده و بعد ییلد خوب پیشنهاد بده', ['MARKET_OVERVIEW', 'YIELD_OPPORTUNITY']],
  ];
  for (const [text, expected] of rows) {
    const c = classify(text, {});
    assert.deepEqual(legIntents(c), expected, `«${text}» → [${legIntents(c).join(',')}]`);
    assert.equal(anyExecution(c), false, `«${text}» is a read and must stay one`);
    assert.equal(c.definition?.permission, 'READ');
  }
});

test('a single-clause sentence behaves exactly as it did before', () => {
  /* Nothing about this change is allowed to be visible in a one-clause sentence:
     the clause-scoped guard returns "fires" when there is only one clause. */
  const rows = [
    ['اتریوم را بفروش', 'EXECUTE_SWAP', 'EXECUTE'],
    ['همه پولمو بفروشم', 'MARKET_OVERVIEW', 'READ'],
    ['چی خوبه بخرم؟', 'MARKET_OVERVIEW', 'READ'],
    ['قیمت بیت کوین چنده', 'ASSET_ANALYSIS', 'READ'],
  ];
  for (const [text, type, permission] of rows) {
    const c = classify(text, {});
    assert.equal(c.type, type, `«${text}» → ${c.type}`);
    assert.equal(c.definition?.permission, permission, `«${text}» permission`);
  }
});
