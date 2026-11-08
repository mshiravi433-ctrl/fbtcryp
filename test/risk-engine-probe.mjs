/**
 * AI RISK ENGINE — the runner entry point.
 * ---------------------------------------------------------------------------
 * «فقط درصد ریسک نباشد؛ قبل، حین و بعد از تصمیم خطرات را تشخیص بدهد.»
 *
 * Two suites, one import:
 *
 *   risk-engine.test.mjs        the arithmetic — ten families, the green gate,
 *                               the seeded Monte-Carlo, the stress scenarios,
 *                               the pre-trade gate, the book snapshot.
 *   risk-engine-page.test.jsx   the screen — /risk mounted against a mocked
 *                               wallet + feed: an unmeasured cell is a DOT and
 *                               not a zero, every alert carries its cause, the
 *                               monitor refuses to invent a trend, and no copy
 *                               key or NaN reaches the DOM.
 *
 * ─── WHY A CHILD PROCESS AND NOT AN IMPORT ─────────────────────────────────
 * `risk-engine.test.mjs` is written to be runnable on its own (`node
 * test/risk-engine.test.mjs`), which is how it is debugged. Importing it would
 * call its `process.exit`, so both are run as child processes — the same shape
 * the fee-router and shop-revenue probes use.
 *
 * It is imported from run.mjs BEFORE `business-locales-probe.mjs`, which ends
 * the whole process at import time on success (see the NOTE ON ORDER there).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const tail = (err, n) => String(err?.stdout || err?.stderr || '')
  .split('\n').filter(Boolean).slice(-n).join('\n');

/* ── 1. the arithmetic ──────────────────────────────────────────────────── */
console.log('▸ AI risk engine — arithmetic…');
try {
  execFileSync(process.execPath, ['test/risk-engine.test.mjs'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe']
  });
  check('the ten families, their weights and their questions hold', true);
  check('a low score with low coverage is never painted "safe"', true);
  check('the unmeasured is null and NAMED, never 0', true);
  check('the Monte-Carlo is seeded and reproducible', true);
  check('the stress scenarios agree with their own arithmetic', true);
  check('a depeg is not charged to a leg that already fell', true);
  check('the pre-trade gate blocks what it should and certifies nothing it cannot', true);
  check('the book snapshot refuses to be used once it is stale', true);
  check('the two copy dictionaries carry the same keys', true);
} catch (err) {
  const out = tail(err, 14);
  if (out) console.log(out);
  check('AI risk engine arithmetic suite FAILED (see output above)', false);
}

/* ── 2. the screen ──────────────────────────────────────────────────────── */
console.log('\n▸ AI risk engine — the page…');
try {
  execFileSync('npx', ['vitest', 'run', 'test/risk-engine-page.test.jsx'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe']
  });
  check('/risk mounts with six rooms and a real tablist', true);
  check('the score, its band and its coverage come from the engine', true);
  check('an unmeasured heat-map cell is a dot, never a zero', true);
  check('every alert explains its cause with the numbers that produced it', true);
  check('the monitor says "no change yet" instead of drawing a line', true);
  check('every stress scenario prints its assumptions', true);
  check('recommendations carry a measured impact, or say they do not', true);
  check('no raw copy key, NaN or Infinity reaches the DOM', true);
} catch (err) {
  const out = tail(err, 18);
  if (out) console.log(out);
  check('AI risk engine page suite FAILED (see output above)', false);
}

/* ── report ─────────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`);
console.log(failed.length
  ? `\nAI risk engine probe: ${failed.length} FAILED\n`
  : '\nAI risk engine probe: all checks passed\n');

if (failed.length) process.exitCode = 1;
