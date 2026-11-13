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
 *     indistinguishable from an engine that was never called.
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
