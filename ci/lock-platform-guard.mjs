#!/usr/bin/env node
/**
 * LOCKFILE PLATFORM GUARD
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * `npm ci` on Linux has been dying about thirty seconds into every CI run —
 * before Vite, before Gradle, before anything that could produce an APK:
 *
 *   npm error code EBADPLATFORM
 *   npm error notsup Unsupported platform for fsevents@2.3.2:
 *         wanted {"os":"darwin"} (current: {"os":"linux"})
 *
 * The package is a macOS-only file watcher nested inside `ganache` (a
 * devDependency used by the atomic-swap tests). npm marks the *top-level*
 * fsevents entry `"optional": true`, which is why ordinary installs skip it — but
 * `ganache` ships its own shrinkwrapped lockfile (`"hasShrinkwrap": true`), and
 * entries copied out of a shrinkwrap arrive as plain required dependencies. A
 * required dependency that cannot exist on the installing platform is a hard
 * error, and a hard error thirty seconds into a build that must run on a Linux
 * runner is an APK that never gets built.
 *
 * WHAT IT DOES
 * Any lockfile entry whose declared `os` / `cpu` list excludes the platform doing
 * the install gets `"optional": true` — exactly the flag npm's own resolver sets
 * for a platform-specific dependency that is not shrinkwrapped. Nothing is
 * removed, no version changes, macOS installs are unaffected, and a machine that
 * CAN build the native module still does.
 *
 * It edits text rather than re-serialising JSON on purpose: `JSON.parse` →
 * `JSON.stringify` would rewrite ~25k lines of formatting and turn the next
 * dependency bump into an unreadable diff. Only the one missing flag is added.
 *
 * Idempotent, and run from `ci/build-apk.sh` before `npm ci`, so a future
 * `npm install` that regenerates the lockfile cannot silently re-break CI.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = process.env.FBT_LOCKFILE || join(ROOT, 'package-lock.json');
const PLATFORM = process.platform;
const ARCH = process.arch;
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
/* `--check` is the CI/`npm test` mode: report and exit non-zero instead of
   editing, so a lockfile that has drifted back to a required macOS-only package
   fails a check that names the fix, rather than failing forty seconds into a
   build that has no way to say what happened. */
const CHECK = argv.includes('--check');

const raw = readFileSync(LOCK, 'utf8');
const lines = raw.split('\n');

/** Lockfile v3 puts every `packages` entry at four spaces of indent. */
const ENTRY_OPEN = /^ {4}"(node_modules\/[^"]+)": \{$/;
const ENTRY_CLOSE = /^ {4}\},?$/;

/**
 * `"os": ["darwin"]` is inline for most packages and multi-line for others (the
 * ganache entry is multi-line). Reading it line-by-line would silently see
 * `undefined` and "fix" nothing, so each entry block is wrapped in braces and
 * parsed as JSON. Blocks are small; a parse failure means the block is skipped,
 * never guessed at.
 */
function parseEntry(block) {
  try {
    const wrapped = `{${block.replace(/,\s*$/, '')}}`;
    const value = Object.values(JSON.parse(wrapped))[0];
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

const excludes = (list, current) => Array.isArray(list) && list.length > 0
  // `"os": ["!win32"]` is an exclusion list, not an allowlist — npm already
  // knows how to honour those, and rewriting them would invert their meaning.
  && !list.some((v) => String(v).startsWith('!'))
  && !list.includes(current);

const found = [];
for (let i = 0; i < lines.length; i += 1) {
  const open = ENTRY_OPEN.exec(lines[i]);
  if (!open) continue;
  let end = i + 1;
  while (end < lines.length && !ENTRY_CLOSE.test(lines[end])) end += 1;
  if (end >= lines.length) continue;
  const entry = parseEntry(lines.slice(i, end + 1).join('\n'));
  if (!entry) continue;
  const badOs = excludes(entry.os, PLATFORM);
  const badCpu = excludes(entry.cpu, ARCH);
  if (!badOs && !badCpu) continue;
  if (entry.optional === true) continue;
  found.push({
    name: open[1],
    reason: badOs ? `os=${JSON.stringify(entry.os)} has no ${PLATFORM}` : `cpu=${JSON.stringify(entry.cpu)} has no ${ARCH}`,
    extraneous: entry.extraneous === true
  });
  if (DRY || CHECK) continue;
  const indent = /^(\s*)/.exec(lines[i + 1] || '      ')[1];
  lines.splice(i + 1, 0, `${indent}"optional": true,`);
}

const label = found.map((f) => `  • ${f.name} — ${f.reason}${f.extraneous ? ' (extraneous)' : ''}`).join('\n');

if (!found.length) {
  console.log(`✓ lockfile: no platform-locked required dependency for ${PLATFORM}/${ARCH}`);
} else if (CHECK) {
  console.log(`✗ ${found.length} lockfile entr${found.length === 1 ? 'y is' : 'ies are'} required but cannot install on ${PLATFORM}/${ARCH}:\n${label}`);
  console.log('  Fix: run `node ci/lock-platform-guard.mjs` (adds "optional": true) and commit package-lock.json,');
  console.log('  or `npm install --force` locally. Without it, `npm ci` fails with EBADPLATFORM on every Linux runner.');
  process.exitCode = 1;
} else if (DRY) {
  console.log(`would mark ${found.length} entr${found.length === 1 ? 'y' : 'ies'} optional for ${PLATFORM}:\n${label}`);
} else {
  const next = lines.join('\n');
  const tmp = `${LOCK}.platform-guard.tmp`;
  writeFileSync(tmp, next.endsWith('\n') ? next : `${next}\n`);
  renameSync(tmp, LOCK);
  console.log(`✓ marked ${found.length} platform-locked entr${found.length === 1 ? 'y' : 'ies'} optional for ${PLATFORM}/${ARCH}:\n${label}`);
  console.log('  npm treats an optional dependency with a platform mismatch as "skip", not "fail" — that is the whole fix.');
}
