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
 *     worth a build failing over.
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

test('every intent reaches the answer, and every sentence reaches its intent', () => {
  const out = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'probe-engine-reach.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024
  });
  assert.equal(out.status, 0, `the probe failed:\n${out.stderr?.slice(0, 600)}`);

  let parsed;
  try {
    parsed = JSON.parse(out.stdout);
  } catch {
    assert.fail(`the probe did not print JSON:\n${out.stdout?.slice(0, 600)}`);
  }

  const { rows, summary } = parsed;

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
