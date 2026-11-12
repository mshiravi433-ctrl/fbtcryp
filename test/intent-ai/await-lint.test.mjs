/* The missing-await lint itself.
 *
 * The lazy-import refactor turned a set of synchronous helpers into
 * asynchronous ones. The production call sites were updated, but a handful
 * of TEST call sites were not — and a test that calls an async function
 * without `await` does not crash: it receives a Promise, reads `.status`
 * off it, and reports `undefined`. Three suites failed that way before
 * this lint existed.
 *
 * So the lint has to be tested, or it will rot.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SCRIPT = join(ROOT, 'scripts', 'find-missing-awaits.mjs');

function runLint() {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout || '') + String(err.stderr || '') };
  }
}

test('no call site of a changed-to-async export is missing its await', () => {
  const { out } = runLint();
  assert.match(out, /OK — every call to an exported async function is awaited\./,
    `the lint found missing awaits:\n${out}`);
});

test('the lint finds a missing await when there is one', () => {
  /* The lint must be able to FAIL, or it proves nothing. A temporary file
     with a deliberate missing await has to be reported — so the probe file
     is named WITHOUT the `__` prefix the lint skips, and it is removed
     again in the `finally`. */
  const probe = join(ROOT, 'test', 'intent-ai', 'await-lint-probe.tmp.mjs');
  writeFileSync(probe, [
    "import { buildAnchorCalldata } from '../../server/intentAnchors.js';",
    "export function probe() {",
    "  return buildAnchorCalldata({}, 1, {});",
    "}",
    ""
  ].join('\n'));
  try {
    const { out } = runLint();
    assert.doesNotMatch(out, /OK — every call/,
      'the lint must report the deliberate missing await');
    assert.match(out, /buildAnchorCalldata/);
  } finally {
    unlinkSync(probe);
  }
});
