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
 * THREE PROPERTIES ARE GUARANTEED HERE, not just measured:
 *
 *   1. EVERY PART IS ANSWERED. The reply must carry each half of the
 *      question, not one half plus a confident paragraph.
 *   2. NO LEG IS AN EXECUTION. A question is not a permission. If
 *      «قیمت… و موجودی…» ever became EXECUTE_SWAP, the brain would be
 *      moving money the user never asked to move — the worst possible
 *      failure of an intelligent system.
 *   3. NO PLAN CARRIES A MONEY STEP. The same guarantee at the plan
 *      level: a compound READ reads.
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
