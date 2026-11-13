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

function runLint(env = {}) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      env: { ...process.env, ...env },
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

test('the lint finds a missing await when there is one', (t) => {
  /* The lint must be able to FAIL, or it proves nothing. A temporary file
     with a deliberate missing await has to be reported — so the probe file
     is named WITHOUT the `__` prefix the lint skips, and it is removed
     again in the `finally`. */
  /*
   * This case only means something on a branch whose diff against the base
   * actually contains a function that became async — otherwise the lint has
   * nothing in scope and answers OK, correctly. Say so instead of failing on a
   * precondition the test does not control.
   */
  const scope = runLint();
  if (/nothing to check/.test(scope.out)) {
    t.skip(`the branch has no sync→async change against the base, so there is no scope to inject into: ${scope.out.split('\n')[1] || ''}`);
    return;
  }
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

test('an empty diff narrows the lint to nothing, and says so', () => {
  /*
   * `AWAIT_LINT_BASE=HEAD` makes the diff empty without touching the branch, so
   * this pins the behaviour deterministically on any checkout. The bug it guards
   * is an inversion: the scope filter reads `CHANGED_TO_ASYNC.size &&`, so an
   * empty diff used to turn a scoped lint into a whole-tree one and report 1952
   * candidates — correct code such as `return jsonRequest(...)` inside an async
   * function included. A commit touching only docs, a branch freshly cut from
   * main, or a workspace whose branch pointer was reset to its base all produce
   * an empty diff, and all three used to fail the suite for reasons that had
   * nothing to do with the change under review.
   */
  const { out } = runLint({ AWAIT_LINT_BASE: 'HEAD' });
  assert.match(out, /OK — every call to an exported async function is awaited\./,
    'an empty diff is a clean bill of health, not a reason to scan the tree');
  assert.match(out, /nothing to check/, '…and the narrowed scope must be announced, not silent');
  assert.doesNotMatch(out, /call site\(s\) may be missing an await/,
    'the whole-tree fallback must never run again');
});
