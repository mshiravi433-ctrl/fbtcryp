#!/usr/bin/env node
/**
 * THE WIRING AUDIT, RUNNABLE ON ITS OWN
 * =====================================
 *
 * `test/wiring.mjs` exports a single function that returns ~3,000
 * [name, ok] rows. It is meant to be called from `test/run.mjs` — but that
 * runner never reaches it: `test/business-locales-probe.mjs` (imported earlier)
 * ends the whole process at import time, a pre-existing quirk documented in
 * test/run.mjs itself. The effect is that the audit's result has been reported
 * as "N pre-existing failures" for months without anyone being able to run it
 * on its own.
 *
 * This script is that missing entry point. It is deliberately dumb: run the
 * audit, print every failure, print the count, exit non-zero if the count is
 * ABOVE the accepted ceiling.
 *
 *   node scripts/run-wiring-audit.mjs
 *   node scripts/run-wiring-audit.mjs --max 64     # accept 64 known failures
 *   node scripts/run-wiring-audit.mjs --list       # failures only
 *
 * The ceiling is a ratchet: it exists so this suite cannot get quietly worse
 * while `main` stays red for unrelated reasons. Lower it when you fix rows; do
 * not raise it to make a change pass.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);

const args = process.argv.slice(2);
const maxIndex = args.indexOf('--max');
const ceiling = maxIndex >= 0 ? Number(args[maxIndex + 1]) : 64;
const listOnly = args.includes('--list');

const { default: runWiring } = await import(join(ROOT, 'test', 'wiring.mjs'));
const rows = runWiring();
const failures = rows.filter(([, ok]) => !ok);

if (!listOnly) {
  console.log(`wiring audit: ${rows.length} assertions, ${failures.length} failing`);
}
for (const [name] of failures) console.log(`✗ ${name}`);

if (!Number.isFinite(ceiling)) {
  console.error('\n--max needs a number');
  process.exit(2);
}
if (failures.length > ceiling) {
  console.error(`\n${failures.length} failures, above the accepted ceiling of ${ceiling}.`);
  process.exit(1);
}
console.log(`\nwithin the accepted ceiling (${failures.length} ≤ ${ceiling}); nothing new broke.`);
