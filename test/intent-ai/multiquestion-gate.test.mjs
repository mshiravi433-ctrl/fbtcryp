/*
 * THE TWO-PART QUESTION GATE (2026-11-13)
 * ==========================================================================
 *
 * A person asks two things when they say two things.
 *
 * «قیمت بیت‌کوین چقدره و موجودی من چقدره» is a price question AND a
 * balance question. The brain used to answer ONE of them — cleanly,
 * confidently, with a headline, a reason, data and a confidence — and
 * the other half vanished without a word.
 *
 * The measurement is over the REPLY, not the classification. The
 * classification was never wrong: the brain can hold one intent at a
 * time, and classifying «قیمت… و موجودی…» as a BALANCE_QUERY is a
 * defensible reading of a two-part sentence. What was wrong is that
 * the OTHER HALF OF THE ANSWER never arrived.
 *
 * Measured before the fix: **6 of 12 parts answered (41.7%)**.
 * After: **12 of 12 (100%)**.
 *
 * SIX PROPERTIES ARE GUARANTEED HERE, not just measured:
 *
 *   1. EVERY PART IS ANSWERED. The reply must carry each half of the
 *      question, not one half plus a confident paragraph.
 *   2. NO LEG IS AN EXECUTION. A question is not a permission. If
 *      «قیمت… و موجودی…» ever became EXECUTE_SWAP, the brain would be
 *      moving money the user never asked to move — the worst possible
 *      failure of an intelligent system.
 *   3. NO PLAN CARRIES A MONEY STEP. The same guarantee at the plan
 *      level: a compound READ reads.
 *   4. THE ANSWER IS A SECTION, IN ANSWER MODE. A part that is
 *      "answered" must be answered in the reply's `result` section —
 *      not merely mentioned somewhere in it.
 *   5. A QUESTION NEVER ERASES AN ANSWER. The conversation machinery
 *      may ask for one more field, and when it does the answer it sits
 *      beside still arrives.
 *   6. A PERSIAN REPLY SPEAKS PERSIAN. The reason and the qualifier are
 *      the parts the user most needs, so they are the parts that must not
 *      arrive in a second language.
 *
 * The gate runs the REAL brain with the in-process fakes — the brain,
 * the registry, the policy and the state store stay real, only the
 * external sources are faked.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const run = () => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'probe-multiquestion.mjs'), '--json'], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 600_000
  });
  assert.equal(res.status, 0, `the probe must exit 0; stderr: ${String(res.stderr || '').slice(0, 400)}`);
  /* The JSON mode must emit ONLY JSON — a table before it breaks the
     parse, and a silent break here would make this gate vacuous. */
  const text = String(res.stdout || '').trim();
  const start = text.indexOf('{');
  assert.ok(start >= 0, `the probe emitted no JSON: ${text.slice(0, 300)}`);
  assert.equal(start, 0, `the probe must emit JSON only: ${text.slice(0, 120)}`);
  return JSON.parse(text);
};

const probe = run();

test('every two-part question gets BOTH parts answered', () => {
  const { rows, summary } = probe;
  assert.ok(rows.length >= 6, `the probe must cover at least six two-part questions, got ${rows.length}`);
  const missed = rows.filter((r) => r.missed.length);
  assert.deepEqual(
    missed.map((r) => `${r.intent}: ${r.missed.join(', ')}`),
    [],
    'a two-part question must get both halves answered — over the REPLY, not the classification'
  );
  assert.equal(summary.missed, 0, `no part may be dropped; ${summary.missed} were`);
  assert.equal(summary.coveragePct, 100, `coverage must be 100%, got ${summary.coveragePct}%`);
});

test('a half with no vocabulary of its own is still answered, about its own subject', () => {
  /*
   * THE SHAPE THE OTHER SIX PROBES DO NOT COVER.
   *
   * Every other probe is two different capabilities, so each half carries the
   * words that name it. «قیمت بیت کوین چنده و اتریوم چطور» is one question
   * asked about two assets, and its second clause matches no rule in the table:
   * it carries only its SUBJECT. Measured before the fix, that clause scored
   * nothing, the splitter dropped it, and the reply answered BTC only —
   * `legs: []`, coverage 92.9%, one part missed — while `extractEntities` on the
   * same sentence already reported `assets: [BTC, ETH]`.
   *
   * The subject counter is what keeps the words check honest. A reply that
   * mentioned the ETH price twice and the BTC price never would still satisfy a
   * keyword matcher; two legs about two DIFFERENT subjects is the property that
   * makes them two answers.
   */
  const { rows, summary } = probe;
  assert.equal(summary.badSubjects, 0,
    'every leg must be about the subject the user named, not the first one the sentence happened to mention');
  const row = rows.find((r) => r.intent === 'PRICE + ELLIPSIS');
  assert.ok(row, 'the elliptical two-part probe must be in the corpus');
  assert.deepEqual(row.subjects, ['BTC', 'ETH'],
    `the two halves are about two assets, got [${(row.subjects || []).join(', ')}]`);
  assert.equal(row.legs.length, 2, `two questions, two legs, got ${row.legs.length}`);
  assert.deepEqual(row.missed, [], `no half may be dropped, missed: ${row.missed.join(', ')}`);
  assert.equal(row.mode, 'ANSWER', 'both halves answered means the turn is an answer, not a question');
  assert.equal(row.hasResultSection, true, 'and the answer arrives as a section');
  assert.deepEqual(row.executionLegs, [],
    'an elliptical clause inherits a READ; a money instruction has to be said, never inferred');
});

test('a compound question NEVER becomes an execution', () => {
  /* The acceptance criterion that matters most: answering half the
     question is a defect; turning the question into a TRANSACTION is
     a catastrophe. Both are checked here, over every probe. */
  const offenders = probe.rows.filter((r) => r.executionLegs.length || r.planHasMoneyStep);
  assert.deepEqual(
    offenders.map((r) => `${r.intent}: legs=${r.legs.join('+')} moneyStep=${r.planHasMoneyStep}`),
    [],
    'a two-part QUESTION must never gain an execution leg or a money-moving step'
  );
  assert.equal(probe.summary.executionLegs, 0, 'no leg of a question may be an execution intent');
  assert.equal(probe.summary.moneyPlans, 0, 'no plan of a question may carry a money step');
});

test('the answer arrives as a SECTION, in ANSWER mode — not as words in a question', () => {
  /*
   * THE COVERAGE NUMBER WAS ONCE INFLATED BY THE PROBE'S OWN LABELS.
   *
   * The matcher used to scan `section.label` as well as `section.value`,
   * and `PART_LABEL_FA.GOAL_PLAN` is «هدف و برنامه» — which contains the
   * very keywords the goal part was looking for. So a turn whose answer
   * had been REPLACED by a question still counted as answered, and the
   * probe reported 100% over a reply that said
   * «برای ادامه لازم است: این پول برای چیست».
   *
   * The matcher now scans only what the machine SAID — section values and
   * finding details — never the name of the box it said it in. These two
   * counters are what keep that honest: a part that is "answered" must be
   * answered in a `result` section, and a question from the conversation
   * machinery must never erase the answer it sits beside.
   */
  const { rows, summary } = probe;
  assert.equal(
    summary.answeredWithoutResultSection, 0,
    'a fully answered turn must carry its answer in a `result` section, not only as words somewhere in the reply'
  );
  assert.equal(
    summary.answersErasedByQuestion, 0,
    'the conversation machinery\'s question must ride ALONGSIDE the answer, never instead of it'
  );
  const questioned = rows.filter((r) => r.mode === 'QUESTION');
  assert.deepEqual(
    questioned.map((r) => `${r.intent} (mode=${r.mode})`),
    [],
    'a two-part READ question that was answered must not come back in QUESTION mode'
  );
  for (const row of rows) {
    assert.ok(row.hasResultSection, `${row.intent}: the reply has no result section`);
  }
});

test('a Persian reply carries no English prose', () => {
  /*
   * THE REASON IS THE PART THE USER MOST NEEDS.
   *
   * A two-part answer used to read «ریسک کلی HIGH است — BTC is 100% of risk
   * capital (2 valued holdings, HHI 1) (4 عامل).» One sentence, two languages,
   * and the English clause was the qualification that keeps a number honest:
   * «no pool carries an impermanent-loss flag, and the APRs are still trailing
   * figures» is the sentence that stops a 40% APR reading as a free return.
   *
   * Tokens are fine — «BTC», «USDC», «wallet-service», «APR» are names, not
   * prose. What is measured here is a RUN OF ENGLISH WORDS inside a section
   * VALUE: a clause the user has to parse in a second language in the middle
   * of a reply that is otherwise in theirs.
   */
  const offenders = probe.rows.filter((r) => r.englishInReply.length);
  assert.deepEqual(
    offenders.map((r) => `${r.intent}: ${r.englishInReply.slice(0, 2).join(' | ')}`),
    [],
    'every rendered clause of a Persian reply must be Persian'
  );
  assert.equal(probe.summary.englishClausesInReply, 0, 'no English clause may reach a Persian reply');
});

test('the two halves are two intents, not one', () => {
  /* The mechanism the coverage rests on: the sentence is SPLIT and each
     half is classified on its own. A probe whose two halves classify
     to the same intent is a legitimate exception — «هدفت چیست و برای
     رسیدن به آن چه برنامه‌ای دارم» is one question about one goal —
     and it still has to be answered in full. */
  const split = probe.rows.filter((r) => r.legs.length > 1);
  assert.ok(split.length >= 5, `at least five probes must split into two legs, got ${split.length}`);
  for (const row of probe.rows) {
    assert.ok(row.legsOk, `${row.intent}: the expected legs are missing`);
  }
});
