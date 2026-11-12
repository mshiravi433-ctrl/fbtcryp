#!/usr/bin/env node
/**
 * Find call sites that were left behind when a function became `async`.
 *
 * The lazy-import refactor (commit 642d807 and its follow-ups) turned a set
 * of synchronous helpers into asynchronous ones — `Interface` became a lazy
 * accessor, so every encoder that used it became `async`. The production
 * call sites were updated, but a handful of TEST call sites were not, and a
 * test that calls an async function without `await` does not fail loudly:
 * it receives a Promise, reads `.status` off it, and reports `undefined`.
 *
 * That is exactly the failure mode this script exists to prevent. It
 * re-derives the set of exported async functions in the server tree and
 * then looks for a call to one of them that is NOT inside an `await`.
 *
 * It is a lint, not a proof: it reports candidates, and a human reads them.
 * But it is how the next one gets caught before CI does.
 *
 *   node scripts/find-missing-awaits.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['server', 'src', 'test', 'scripts'];

/** Every exported async function / async const arrow in the tree. */
function collectAsyncExports(dir, out = new Map()) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { collectAsyncExports(full, out); continue; }
    if (!/\.(m?js)$/.test(entry)) continue;
    const src = readFileSync(full, 'utf8');
    const re = /export\s+(?:async\s+function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*async\b)/g;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1] || m[2];
      if (name) out.set(name, relative(ROOT, full));
    }
  }
  return out;
}

const asyncExports = new Map();
for (const d of SCAN_DIRS) {
  try { collectAsyncExports(join(ROOT, d), asyncExports); } catch { /* missing dir */ }
}

/*
 * SCOPE. A name like `run` or `withDeadline` is a method on an object in
 * a hundred files, and "is this awaited" depends on the receiver, not the
 * spelling. Chasing those produces noise, not findings.
 *
 * So this lint watches exactly the functions whose SIGNATURE CHANGED in
 * this branch — the ones that were synchronous on `origin/main` and are
 * asynchronous here. Those are the ones where a forgotten `await` is a
 * silent bug rather than an obvious crash: the caller receives a Promise,
 * reads a property off it, and gets `undefined`.
 *
 * The set is derived from the diff itself, so it cannot drift.
 */
const BASE_REF = process.env.AWAIT_LINT_BASE || 'origin/main';
const CHANGED_TO_ASYNC = (() => {
  const names = new Set();
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', `${BASE_REF}..HEAD`, '--', 'server', 'src'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
    });
  } catch { return names; }
  const re = /^[+-]\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  const added = new Set();
  const removed = new Set();
  while ((m = re.exec(diff))) {
    const sign = diff[m.index] === '+' ? added : removed;
    sign.add(m[1]);
  }
  for (const name of added) {
    /* It became async here: it was exported as a sync function before and
       is exported as an async one now. */
    if (!removed.has(name)) continue;
    names.add(name);
  }
  return names;
})();

/*
 * A name that is exported async from more than one module is ambiguous —
 * `run`, `set`, `load` and friends are everywhere — and a lint that
 * cries wolf gets ignored. Only names whose NAME appears in exactly one
 * file are checked.
 */
const filesByName = new Map();
for (const [name, file] of asyncExports) {
  if (!filesByName.has(name)) filesByName.set(name, new Set());
  filesByName.get(name).add(file);
}
const uniqueAsyncExports = new Map();
for (const [name, file] of asyncExports) {
  if (filesByName.get(name).size !== 1) continue;
  if (CHANGED_TO_ASYNC.size && !CHANGED_TO_ASYNC.has(name)) continue;
  uniqueAsyncExports.set(name, file);
}

/** Every file that might call one of them. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    if (entry.startsWith('__')) continue;
    /* This lint's own test contains a DELIBERATE missing await, as a
       string literal. It cannot be evidence about the codebase. */
    if (entry === 'await-lint.test.mjs') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full, out); continue; }
    if (/\.(m?js)$/.test(entry)) out.push(full);
  }
  return out;
}

/* One regex for every unique async export, so a line is tested ONCE. */
const UNIQUE_NAMES = [...uniqueAsyncExports.keys()];
const ALL_CALLS = UNIQUE_NAMES.length
  ? new RegExp(`(?<![\\w$.'"\`])(?:${UNIQUE_NAMES.join('|')})\\s*\\(`)
  : /$^/;
const CALLABLE = ALL_CALLS;

const findings = [];
for (const d of SCAN_DIRS) {
  let files = [];
  try { files = walk(join(ROOT, d)); } catch { continue; }
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
      const hits = ALL_CALLS.exec(line);
      if (!hits) return;
      for (const match of hits[0].match(/[A-Za-z_$][\w$]*/g) || []) {
        const definedIn = uniqueAsyncExports.get(match);
        if (!definedIn) continue;
        /* Skip the definition line itself — `export async function foo(`. */
        if (new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${match}\\s*\\(`).test(line)) continue;
        /* Already awaited on this line? */
        const at = line.indexOf(match);
        const before = line.slice(Math.max(0, at - 40), at);
        if (/await\s+$/.test(before)) continue;
        findings.push({
          file: relative(ROOT, file),
          line: i + 1,
          name: match,
          definedIn,
          code: line.trim().slice(0, 120)
        });
      }
    });
  }
}

if (!findings.length) {
  console.log('OK — every call to an exported async function is awaited.');
  process.exit(0);
}

console.log(`${findings.length} call site(s) may be missing an await:\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  ${f.name}  (defined in ${f.definedIn})`);
  console.log(`      ${f.code}`);
}
process.exit(0);
