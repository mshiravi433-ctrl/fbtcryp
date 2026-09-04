/**
 * FBT INTENT AI — UPGRADE 6: LAZY-ROUTE NAVIGATION FREEZE REGRESSION
 *
 * User report (Request 2):
 *   «وقتی میخاییم بریم لینکی مثلا والت و نمیره ... لینک داخل کروم تغییر کرده
 *    اما همون هوش مصنوعی را نشان میدهد ... فریز»
 *
 * Root shape: `HashRouter future={{ v7_startTransition: true }}` turns every
 * navigation into a React transition, and every route is a `lazyRetry(() =>
 * import(...))` chunk. When the destination suspends while its chunk loads,
 * React keeps the PREVIOUS page visible instead of showing the Suspense
 * fallback. The address bar updates immediately, so the user sees "the link
 * changed" while sitting on the frozen old page. If the chunk request hangs
 * (offline / flaky network) the old page never goes away — the freeze.
 *
 * The guard is a source-level contract: the router must NOT be transitioned
 * for lazy-route navigation, so the `<Suspense fallback={<Loader />}>` boundary
 * can render feedback and `RouteBoundary` can recover.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let total = 0;
let passed = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

const rawAppSource = readFileSync(fileURLToPath(new URL('../../src/App.jsx', import.meta.url)), 'utf8');

// Remove comments before matching config so the explanatory note about the
// removed flag cannot be mistaken for the flag itself.
const appSource = rawAppSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

test('HashRouter does NOT use v7_startTransition (no keep-old-page freeze)', () => {
  assert.equal(
    /v7_startTransition\s*:\s*true/.test(appSource),
    false,
    'v7_startTransition:true keeps the old page visible while a lazy route suspends'
  );
});

test('HashRouter still enables the relative splat future flag', () => {
  assert.equal(/v7_relativeSplatPath\s*:\s*true/.test(appSource), true);
});

test('the route tree is Suspense-wrapped with a fallback (feedback is immediate)', () => {
  assert.equal(/<Suspense fallback=\{<Loader \/>\}>/.test(appSource), true);
  assert.equal(/<RouteBoundary key=\{location\.pathname\}/.test(appSource), true);
});

test('routes are lazy chunks (the condition this guard exists for)', () => {
  const lazyDecls = (appSource.match(/= lazyRetry\(\(\) => import\(/g) || []).length;
  assert.ok(lazyDecls >= 20, `expected many lazyRetry routes, found ${lazyDecls}`);
});

console.log(`\n=== UPGRADE 6 LAZY NAVIGATION FREEZE PROBE: ${passed}/${total} passed ===\n`);
if (passed !== total) process.exit(1);
