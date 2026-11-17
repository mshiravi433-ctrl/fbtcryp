/*
 * DOES THE SYSTEM LEARN WHO THE USER IS? (2026-11-13)
 * ==========================================================================
 *
 * `server/fios/behavior.js` categorises what a user DOES — fourteen signals,
 * each needing three verified samples, each mapped to the preference it should
 * write. `server/fios/personalProfile.js` assembles those into the profile the
 * fit engine scores against. Both were complete, and both were dark, for two
 * separate reasons:
 *
 *   1. NOTHING REPORTED. `behavior.ingest` was reachable only from
 *      `learning.learn`, which only an HTTP POST to `/learning` and the
 *      evaluation engine called. A user confirming or cancelling an execution
 *      through the brain — the single most informative thing a user does — fed
 *      no model at all.
 *   2. NOTHING APPLIED THE RESULT. `memoryKey` and `memoryValue` appeared
 *      nowhere outside `behavior.js`: REJECTS_HIGH_RISK_PROTOCOLS said "write
 *      riskTolerance = CONSERVATIVE" and no code ever wrote it, even though
 *      MEMORY_PROVENANCE reserves USER_BEHAVIOR (rank 2, confidence 0.7, a
 *      180-day TTL) for exactly that.
 *
 * The visible symptom was a headline: «۵ گزینه با پروفایل ریسک خوانده‌نشده
 * سنجیده شد» — an engine scoring five opportunities against a profile it could
 * not read. After the fix, the same owner who rejected three risky proposals
 * gets «۵ گزینه با پروفایل ریسک محافظه‌کار سنجیده شد».
 *
 * THE SAFETY PROPERTY, which matters more than the feature: §8 says learning is
 * not authority, and the memory store enforces it — a USER_BEHAVIOR record can
 * never downgrade a USER_SAID one. A user who said "I am aggressive" stays
 * aggressive no matter what their clicks suggest. That is asserted here in both
 * directions, because a personalisation feature that can overrule the user is
 * worse than no personalisation.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportBehavior, readBehaviorSignals, hasBehaviorReporter, BEHAVIOR_EVENT_KINDS } from '../../server/ci/learningBridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let cached = null;
function runProbe() {
  if (cached) return cached;
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'probe-behavior.mjs'), '--json'], {
    encoding: 'utf8', cwd: ROOT, timeout: 600_000, maxBuffer: 32 * 1024 * 1024
  });
  assert.equal(res.status, 0, `the probe must exit 0; stderr: ${String(res.stderr || '').slice(0, 500)}`);
  const text = String(res.stdout || '').trim();
  assert.equal(text.indexOf('{'), 0, `the probe must emit JSON only: ${text.slice(0, 140)}`);
  cached = JSON.parse(text);
  return cached;
}

/* ─── the chain, end to end, over real turns and real confirmations ────────── */

test('a decision reaches the behaviour model, and three of them produce a signal', () => {
  const { rows, summary } = runProbe();
  const failed = rows.filter((r) => r.ok === false);
  assert.deepEqual(
    failed.map((r) => `${r.name}: ${r.value} (${r.note})`),
    [],
    'every link in the chain must hold'
  );
  assert.equal(summary.mounted, true, 'the composition root must wire the reporter');
  assert.ok(summary.signalsAfterThreeRejections >= 2,
    `three rejections must categorise REJECTS_HIGH_RISK_PROTOCOLS and CANCELS_AT_CONFIRMATION, got ${summary.signalsAfterThreeRejections}`);
});

test('the signal becomes a PREFERENCE — the link that never existed', () => {
  const { summary } = runProbe();
  assert.equal(summary.riskToleranceLearned, 'CONSERVATIVE',
    'a user who rejects three high-risk proposals is conservative, and the model must say so');
  assert.ok(summary.behaviorDerivedPreferences >= 1,
    'the preference must carry a USER_BEHAVIOR origin, so its provenance is visible');
});

test('the fit engine can finally read a profile', () => {
  /* The whole point: the behaviour model is not an audit trail, it is what makes
     personalisation possible. A fit that scores against an unreadable profile is
     a ranking of nothing in particular. */
  const { summary } = runProbe();
  assert.equal(summary.fitCanReadProfile, true,
    'the fit engine must read the risk tolerance the behaviour model wrote');
  assert.ok(summary.fitRanked >= 1, `the fit engine must still rank opportunities, got ${summary.fitRanked}`);
});

test('a DESCRIPTIVE signal writes no preference', () => {
  /* PREFERS_MAJOR_ASSETS carries no memoryKey, and that absence is deliberate:
     it describes what the user trades, it does not claim to know a preference
     they never expressed. A signal that wrote one would be an inference dressed
     as a setting. */
  const { summary } = runProbe();
  assert.equal(summary.descriptiveSignalWroteNothing, true,
    'only signals that name a memoryKey may write one');
});

test('§8 — what the user SAID outranks what the user DID', () => {
  const { summary } = runProbe();
  assert.equal(summary.saidSurvived, true,
    'a USER_BEHAVIOR record must never downgrade a USER_SAID one; learning fills gaps, it does not overrule');
});

test('learning the user costs nothing measurable on the confirmation path', () => {
  const { summary } = runProbe();
  assert.ok(summary.meanDecisionMs === null || summary.meanDecisionMs < 250,
    `a decision turn must not become slow because it is also being recorded; mean ${summary.meanDecisionMs} ms`);
});

/* ─── the bridge on its own ────────────────────────────────────────────────── */

test('the bridge refuses honestly when the model is not mounted', () => {
  /* An unmounted composition root is the normal state of a unit test, and the
     bridge must name that rather than throw or pretend. */
  if (hasBehaviorReporter()) return; // the probe above mounted it in its own process only
  return reportBehavior('nobody', { kind: 'EXECUTION_CONFIRMED' }).then((out) => {
    assert.equal(out.ok, false);
    assert.equal(out.code, 'BEHAVIOR_PROVIDER_NOT_WIRED');
  });
});

test('an event the model does not score is refused by name', async () => {
  const out = await reportBehavior('nobody', { kind: 'USER_WAS_HAPPY' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'UNKNOWN_BEHAVIOR_EVENT');
  assert.deepEqual(out.allowed, [...BEHAVIOR_EVENT_KINDS],
    'the refusal must say what IS allowed, so the next caller does not guess');
});

test('behaviour belongs to one person — no owner, no report', async () => {
  const out = await reportBehavior(null, { kind: 'EXECUTION_CONFIRMED' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'NO_OWNER');
});

test('the reader never throws and always returns a signal object', async () => {
  const out = await readBehaviorSignals('nobody');
  assert.equal(typeof out, 'object');
  assert.equal(typeof out.signals, 'object', 'an unwired reader must still return an empty signal set, not undefined');
});
