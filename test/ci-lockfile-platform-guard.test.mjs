/**
 * Tests for ci/lock-platform-guard.mjs — the thing that keeps `npm ci` alive on
 * a Linux runner.
 *
 * Why these tests exist as a *script runner* rather than an import: the guard's
 * whole job is editing a lockfile's text without disturbing its formatting, so
 * the useful assertions are "what did the file look like before and after" and
 * "what did the exit code say". Both are only observable end-to-end.
 *
 * The background matters here: `package-lock.json` recorded `fsevents@2.3.2`,
 * nested under the shrinkwrapped `ganache` entry, as a *required* dependency with
 * `"os": ["darwin"]`. On macOS nothing notices; on Ubuntu — every APK build —
 * `npm ci` aborts with EBADPLATFORM about thirty seconds in, before Gradle has
 * run at all, and the run says only "Process completed with exit code 1". A
 * regression in this guard therefore looks like "the app stopped shipping", which
 * is the hardest possible thing to notice from a phone.
 *
 * Run:  node --test test/ci-lockfile-platform-guard.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const GUARD = join(ROOT, 'ci', 'lock-platform-guard.mjs');

/** Run the guard against a fixture lockfile. Returns { status, out, lock }. */
function run(args, lockText) {
  const dir = mkdtempSync(join(tmpdir(), 'fbt-lock-guard-'));
  const lock = join(dir, 'package-lock.json');
  const env = { ...process.env };
  if (lockText !== undefined) {
    writeFileSync(lock, lockText);
    // Only fixture runs redirect the target. Without a fixture the guard reads
    // the repository's own lockfile, which is what test 1 needs to assert on.
    env.FBT_LOCKFILE = lock;
  }
  const res = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', env });
  const out = lockText === undefined ? null : readFileSync(lock, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, text: `${res.stdout}${res.stderr}`, lock: out };
}

/**
 * A dependency the platform cannot provide, recorded as mandatory — the exact
 * shape that killed CI. Written as text rather than JSON.stringify because the
 * layout *is* the subject: lockfile v3 indents an entry key with four spaces and
 * its fields with six, and the guard matches on that. The `os` list is the
 * multi-line form npm emits for shrinkwrapped subtrees, which is the case a
 * line-by-line reader would silently miss.
 */
const REQUIRED_FOREIGN = `{
  "name": "fixture",
  "lockfileVersion": 3,
  "packages": {
    "": { "name": "fixture" },
    "node_modules/ganache": {
      "version": "7.9.2",
      "hasShrinkwrap": true,
      "optional": false,
      "dependencies": { "fsevents": "2.3.2" }
    },
    "node_modules/ganache/node_modules/fsevents": {
      "version": "2.3.2",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz",
      "os": [
        "darwin"
      ],
      "engines": { "node": "^8.16.0 || ^10.6.0 || >=11.0.0" }
    }
  }
}
`;
const FSEVENTS = 'node_modules/ganache/node_modules/fsevents';

test('the repository lockfile passes the check mode (the fix is in place)', () => {
  const r = run(['--check']);
  assert.equal(r.status, 0, `verify:apk-lock must pass on main:\n${r.text}`);
  assert.match(r.text, /no platform-locked required dependency/);
});

test('check mode fails a lockfile that requires a foreign-platform package', () => {
  const r = run(['--check'], REQUIRED_FOREIGN);
  assert.equal(r.status, 1, 'a required darwin-only entry must fail the check');
  assert.match(r.text, /node_modules\/ganache\/node_modules\/fsevents/);
  assert.match(r.text, /darwin/);
  // The point of --check is that the message is actionable without opening a log.
  assert.match(r.text, /ci\/lock-platform-guard\.mjs/);
  assert.match(r.text, /EBADPLATFORM/);
});

test('fix mode adds "optional": true and nothing else', () => {
  const r = run([], REQUIRED_FOREIGN);
  assert.equal(r.status, 0, r.text);
  const parsed = JSON.parse(r.lock);
  const entry = parsed.packages[FSEVENTS];
  assert.equal(entry.optional, true, 'the entry must become optional so npm skips it');
  // Everything the fix must NOT touch.
  assert.deepEqual(entry.os, ['darwin'], 'the platform list itself stays');
  assert.equal(entry.resolved, 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz');
  assert.equal(parsed.packages['node_modules/ganache'].version, '7.9.2');
  // Formatting is preserved on purpose: rewriting via JSON.stringify would turn
  // the next dependency bump into a 25k-line unreadable diff.
  assert.match(r.lock, /^    "node_modules\/ganache": \{$/m, 'entry keys keep four spaces');
  assert.match(r.lock, /^      "os": \[$/m, 'field lines keep six spaces');
  assert.ok(!/^ {2}"node_modules/m.test(r.lock), 'no reindentation of the whole file');
});

test('running the guard twice is a no-op the second time', () => {
  const first = run([], REQUIRED_FOREIGN);
  assert.equal(first.status, 0, first.text);
  const second = run([], first.lock);
  assert.equal(second.status, 0, second.text);
  assert.match(second.text, /no platform-locked required dependency/);
  assert.equal(second.lock, first.lock, 'an idempotent fix must not drift the file');
});

test('an already-optional foreign package is not reported', () => {
  const text = REQUIRED_FOREIGN.replace('"os": [', '"optional": true,\n      "os": [');
  const r = run(['--check'], text);
  assert.equal(r.status, 0, `optional entries are npm's problem to skip:\n${r.text}`);
});

test('an exclusion list is left alone — rewriting it would invert its meaning', () => {
  // "everything but Windows" — an allowlist by exclusion, valid on this machine.
  const text = REQUIRED_FOREIGN.replace('"os": [\n        "darwin"\n      ]', '"os": [\n        "!win32"\n      ]');
  const check = run(['--check'], text);
  assert.equal(check.status, 0, `an exclusion list is not an allowlist:\n${check.text}`);
  const fix = run([], text);
  assert.equal(fix.status, 0, fix.text);
  assert.equal(fix.lock, text, 'nothing should be rewritten');
});
