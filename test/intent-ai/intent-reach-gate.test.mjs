/*
 * EVERY INTENT, IN A REAL BRAIN TURN
 * ---------------------------------------------------------------------------
 *
 * `scripts/probe-engine-reach.mjs` asks the brain a sentence for every
 * INTENT and reports whether the engine's own output reaches the reply.
 *
 * This test is that probe, as a gate. It fails when:
 *
 *   · an intent has NO finding at all — the engine is dark;
 *   · a sentence does not reach the intent it was written for — which is
 *     either a hole in the language or a misclassification, and both are
 *     worth a build failing over;
 *   · a finding FAILED WITHOUT NAMING A REASON — a silent refusal is
 *     indistinguishable from an engine that was never called;
 *   · the HEADLINE is about a different question than the one asked — ten
 *     intents were reaching their engines and then answering with the
 *     portfolio's value, because a branch above the generic tail caught
 *     every intent that had no branch of its own.
 *
 * The second one is the stricter half, and it is the half that matters:
 * the intent list grew to thirty-six when the EXECUTION intents were
 * added, and the ten new ones found five real holes — a navigation
 * pattern that read a bridge as a page, a frozen array sorted in place,
 * an intent with no rule at all, two verbs nobody had written down, and
 * a possessive sitting between a noun and its verb.
 *
 * The probe runs the REAL brain, the REAL registry and the REAL state
 * store. Only the external sources are faked, in-process, the way the
 * turn probes do it — because the measurement is about the BRAIN's
 * wiring, and the brain's wiring does not need a blockchain to be
 * measured. A probe that measured the blockchain would measure the
 * network instead of the wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/*
 * ONE run of the probe, shared by every test in this file.
 *
 * The probe drives thirty-six real brain turns; running it once per assertion
 * would multiply the cost of the gate for no extra information, and a gate
 * that is slow is a gate that gets skipped. Everything below is asserted from
 * this single JSON.
 */
let cached = null;
function runReachProbe() {
  if (cached) return cached;
  const out = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'probe-engine-reach.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024
  });
  assert.equal(out.status, 0, `the probe failed:\n${out.stderr?.slice(0, 600)}`);
  try {
    cached = JSON.parse(out.stdout);
  } catch {
    assert.fail(`the probe did not print JSON:\n${out.stdout?.slice(0, 600)}`);
  }
  return cached;
}

test('every intent reaches the answer, and every sentence reaches its intent', () => {
  const { rows, summary } = runReachProbe();

  const dark = rows.filter((r) => r.ok === 0);
  assert.equal(
    dark.length,
    0,
    `these intents reached no engine output at all:\n${dark.map((r) => `  · ${r.intent} — ${r.reasons || r.error || 'no finding'}`).join('\n')}`
  );

  const misrouted = rows.filter((r) => !r.matched);
  assert.equal(
    misrouted.length,
    0,
    `these sentences did not reach the intent they were written for:\n${misrouted.map((r) => `  · ${r.intent} was read as ${r.classified || 'nothing'}`).join('\n')}\n\n` +
    'A sentence that is read as a different intent is a misclassification, and for an EXECUTE intent it is a transaction the user did not ask for.'
  );

  assert.ok(summary.probes >= 35, `expected the whole intent list, found ${summary.probes}`);
  assert.equal(summary.withNoFinding, 0);
});

test('every refusal NAMES itself — a silent failure is a dark engine', () => {
  /*
   * "Reached" was never enough, and neither is "answered".
   *
   * A probe counts an intent as reached when ONE of its findings is OK. That
   * is the right floor — an intent whose every finding failed is dark — but it
   * lets a turn through that answered half of what it read. Three of the
   * thirty-six do exactly that, and all three are CORRECT:
   *
   *   · INSTRUMENT_QUERY — the registry records `etf` as UNAVAILABLE, so the
   *     instrument finding refuses rather than inventing a ticker;
   *   · ROUTE_INTELLIGENCE — a route comparison needs a source chain, a
   *     destination and an amount, and the sentence carries no amount;
   *   · SIGNAL_READING — no asset was named, so nothing could be resolved.
   *
   * What makes those refusals acceptable is that each one SAYS SO. A finding
   * that failed with a named reason is an answer about a limit; a finding that
   * failed with no reason is indistinguishable from a finding that was never
   * attempted — and that is precisely what a dark engine looks like from the
   * outside. This is the property §5.21 was about, one level down: not "did it
   * answer" but "did it tell the truth about not answering".
   *
   * It is asserted per FINDING, not per probe, because one silent finding
   * inside an otherwise-answered turn is exactly the failure this gate exists
   * to make impossible.
   */
  const { rows, summary } = runReachProbe();
  const silent = rows.flatMap((r) => (r.failedReasons || [])
    .filter((f) => !f.reason)
    .map((f) => `${r.intent} → ${f.id}`));
  assert.deepEqual(
    silent,
    [],
    'every finding that failed must name a reason; a silent failure is indistinguishable from a dark engine'
  );
  assert.equal(summary.silentRefusals, 0, 'no refusal may be silent');
  assert.ok(summary.refusals >= 0, 'the probe must count its refusals');

  /* The refusals are also a record: if this number ever jumps, an engine that
     used to answer has started refusing, and the reason strings say which. */
  const refusing = rows.filter((r) => (r.failedReasons || []).length);
  for (const row of refusing) {
    assert.ok(row.ok > 0, `${row.intent}: every finding refused, so the intent is dark`);
  }
});

test('the headline is about the question that was actually asked', () => {
  /*
   * "REACHED WITH AN OK FINDING" IS NOT THE SAME AS "ANSWERED THE QUESTION".
   *
   * Ten of the thirty-six intents were reaching their engines perfectly — the
   * yield engine had found «aave-v3 USDC pays 4.1% APR», the fit engine had
   * ranked five opportunities, the smart-money engine had read five global
   * domains, the why engine had produced six reason lines and four falsifiers —
   * and every one of them then headlined:
   *
   *     «ارزش پرتفوی ۱۰٬۰۰۰ دلار، تمرکز اصلی روی BTC (۱۰۰٪)، اهرم ترکیبی ۱×»
   *
   * A true number, correctly sourced, confidently rendered, and not an answer
   * to the question. The cause was a branch in `makeHeadline` that fired on
   * `exposure && concentration` and sat above the generic tail, so it caught
   * every intent that had no branch of its own. It had already been moved below
   * the specific branches once, when it swallowed RISK_OVERVIEW — but "below the
   * specific branches" only helps the intents that HAVE one.
   *
   * This is the failure `human.js` warns about in its own comment: a real number
   * attached to the WRONG question is harder to notice than an empty reply,
   * because it looks like the system worked.
   */
  const all = runReachProbe().rows;
  /*
   * ONLY THE ROWS THE USER ACTUALLY READS.
   *
   * A headline is computed on every turn, including the ones that end in
   * QUESTION mode — where the reply leads with the question and the headline is
   * never rendered. Asserting over those would fail the gate on text nobody
   * sees, and a gate that cries wolf gets deleted. So the subject assertions
   * cover the ANSWER turns, and the QUESTION turns are held to the weaker and
   * still real rule below: the reply must say something.
   */
  const rows = all.filter((r) => r.mode === 'ANSWER');
  assert.ok(rows.length >= 20, `expected most of the intent list to answer, got ${rows.length} of ${all.length}`);

  /* The intents whose subject genuinely IS the portfolio's shape. For these the
     exposure + concentration sentence is the answer, not a substitute for one. */
  const PORTFOLIO_IS_THE_SUBJECT = new Set([
    'PORTFOLIO_ANALYSIS', 'CONCENTRATION_CHECK', 'CONFIRM_PENDING',
    'CANCEL_PENDING', 'EXECUTE_REBALANCE', 'CONDITIONAL_ALLOCATION'
  ]);

  /*
   * MATCH THE GENERIC SENTENCE, NOT THE WORDS "PORTFOLIO VALUE".
   *
   * This filter used to be `.includes('ارزش پرتفوی')`, and that is too blunt the
   * moment an intent has a headline of its own that is legitimately ABOUT the
   * portfolio's value. A scenario is exactly that: «با افت ۲۰٪، ارزش پرتفوی شما
   * از ۱۰٬۰۰۰ دلار به ۸٬۰۰۰ دلار می‌رسد» states a direction and two figures —
   * it is the answer to a what-if, while the generic sentence («ارزش پرتفوی …،
   * تمرکز اصلی روی …، اهرم ترکیبی …») is a substitute for an answer. Both
   * branches that produce the generic sentence start with «ارزش پرتفوی» and both
   * name the concentration and the leverage, so the narrower matcher loses no
   * coverage of the defect it was written for — and the positive assertion below
   * pins the row that this narrowing let through, so a regression back to the
   * generic sentence under a what-if still fails here.
   */
  const GENERIC_PORTFOLIO_HEADLINE = /^ارزش پرتفوی|تمرکز اصلی روی.*اهرم ترکیبی/;
  const wrongSubject = rows.filter(
    (r) => GENERIC_PORTFOLIO_HEADLINE.test(String(r.headline || '')) && !PORTFOLIO_IS_THE_SUBJECT.has(r.intent)
  );
  assert.deepEqual(
    wrongSubject.map((r) => `${r.intent} → ${r.headline.slice(0, 70)}`),
    [],
    'an intent that read its own engine must be answered from it, not from the portfolio'
  );

  /*
   * A SCENARIO MUST READ AS A SCENARIO.
   *
   * The what-if row only reaches this gate now: the turn used to end in QUESTION
   * mode (its own `lab.simulate` step was withheld as a money step that was
   * missing a destination asset), and the gate only asserts over ANSWER turns.
   * So the headline it produces is newly visible here, and it is pinned by shape
   * — a direction, and the value it moves FROM and TO — rather than by one
   * exact string, so the sentence can be reworded without the gate going blind.
   */
  const scenario = rows.find((r) => r.intent === 'WHATIF_SIMULATION');
  assert.ok(scenario, 'the what-if probe row must answer; a scenario that ends in a question was the defect');
  assert.match(
    String(scenario.headline || ''),
    /(رشد|افت)\s*[۰-۹٬٫]+٪.*از\s*[۰-۹٬٫]+\s*دلار\s*به\s*[۰-۹٬٫]+\s*دلار/,
    `a scenario headline must carry its direction and both figures: «${scenario.headline}»`
  );
  assert.match(
    String(scenario.headline || ''),
    /سناریو|پیش‌بینی/,
    `and it must say it is a scenario, not a forecast: «${scenario.headline}»`
  );

  /* The generic tail names a value with no subject. It is the last resort for a
     turn that read something the intent map does not know about — not an answer
     for an intent that has an engine behind it. */
  const generic = rows.filter((r) => String(r.headline || '').startsWith('نتیجهٔ خواندن وضعیت'));
  assert.deepEqual(
    generic.map((r) => `${r.intent} → ${r.headline.slice(0, 70)}`),
    [],
    'no intent may fall through to the generic tail; every one has a subject'
  );

  /* And the reply must say SOMETHING. An empty headline is legitimate for a turn
     in QUESTION mode — the question is the reply — but not for a turn that
     claims to have answered. */
  const silent = all.filter((r) => !String(r.headline || '').trim() && !r.text);
  assert.deepEqual(
    silent.map((r) => r.intent),
    [],
    'every turn must produce a headline or a question; silence is not an answer'
  );
  /* An ANSWER turn with no headline has nothing to lead with. */
  const headless = rows.filter((r) => !String(r.headline || '').trim());
  assert.deepEqual(
    headless.map((r) => r.intent),
    [],
    'a turn in ANSWER mode must have a headline'
  );
});

test('the intent list is covered — a new intent cannot be added without a probe', async () => {
  const { INTENT_TYPES } = await import('../../src/lib/central/intent.js');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'probe-engine-reach.mjs'), 'utf8');
  const probed = new Set([...src.matchAll(/\{ intent: '([A-Z_]+)'/g)].map((m) => m[1]));

  /*
   * `UNSUPPORTED` is the one intent with no engine behind it, and that is
   * what it IS: the brain's answer to a sentence it could not read. It
   * is not a dark engine — there is no engine it is supposed to reach.
   * Every OTHER intent must have a probe.
   */
  const NO_ENGINE = new Set(['UNSUPPORTED']);
  const missing = Object.keys(INTENT_TYPES).filter((k) => !probed.has(k) && !NO_ENGINE.has(k));
  assert.equal(
    missing.length,
    0,
    `these intents have no probe:\n${missing.map((k) => `  · ${k}`).join('\n')}\n\n` +
    'A new intent with no probe is a dark engine waiting to happen.'
  );

  const unsupportedProbed = probed.has('UNSUPPORTED');
  assert.equal(unsupportedProbed, false, 'UNSUPPORTED has no engine, so it needs no probe');
});
