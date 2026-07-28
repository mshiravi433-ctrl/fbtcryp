#!/usr/bin/env node
/**
 * Test runner:  npm test
 *
 * Three suites, all against the real source (no mocks of our own code):
 *
 *   1. boot      — builds the app as one classic script and boots it in jsdom
 *                  with every external host black-holed. This is the exact
 *                  condition that produced "it just spins forever".
 *   2. gate      — the four-part guide really does refuse to finish until all
 *                  four sections have been opened.
 *   3. flow      — first-launch order: onboarding → guide → app shell, plus
 *                  the replay path from Help.
 *
 * jsdom cannot execute ES modules, which is why each suite is pre-bundled with
 * Vite into a classic/SSR bundle first.
 */
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';

const npx = (args) => execFileSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });

/** jsdom lacks a handful of globals React and framer-motion expect. */
function installDom(html = '<!doctype html><html><body><div id="r"></div></body></html>') {
  const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  global.window = w;
  global.document = w.document;
  for (const k of ['HTMLElement', 'Element', 'localStorage', 'CustomEvent', 'Node', 'SVGElement', 'Event', 'MutationObserver']) {
    if (w[k]) global[k] = w[k];
  }
  for (const k of ['requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
    if (w[k]) global[k] = w[k].bind(w);
  }
  global.matchMedia = w.matchMedia
    ? w.matchMedia.bind(w)
    : () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  Object.defineProperty(global, 'navigator', { value: w.navigator, configurable: true });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

let failed = 0;
const report = (suite, rows) => {
  console.log(`\n── ${suite} ─────────────────────────────`);
  for (const [name, ok] of rows) {
    if (!ok) failed += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
};

// Silence React's act() advice and framer-motion's SSR useLayoutEffect notice;
// neither indicates a problem and both drown out real output.
const realError = console.error;
console.error = (...a) => {
  const s = String(a[0] ?? '');
  if (s.includes('useLayoutEffect') || s.includes('act(')) return;
  realError(...a);
};

/* ------------------------------ 0. units -------------------------------- */
/* Pure logic first: it is the fastest suite and the one whose failures point
   most precisely at a cause. Bundled with Vite so extensionless imports and
   `import.meta.env` resolve exactly as they do in the app. */
console.log('▸ building unit suite…');
npx(['vite', 'build', '-c', 'test/vite.units.mjs', '--logLevel', 'error']);
installDom();
const { default: runUnits } = await import('./.out/units/units.js');
report('units (tokens · payout · faq · news)', runUnits());

/* ------------------------------- 1. boot -------------------------------- */
console.log('▸ building app as a classic script for jsdom…');
npx(['vite', 'build', '-c', 'test/vite.iife.mjs', '--logLevel', 'error']);
console.log('▸ running boot test with all external hosts unreachable…');
const bootRows = (await import('./boot-e2e.mjs')).default;
report('boot under a dead network', bootRows);

/* ------------------------------- 2. gate -------------------------------- */
console.log('\n▸ building guide-gate suite…');
npx(['vite', 'build', '-c', 'test/vite.gate.mjs', '--logLevel', 'error']);
installDom();
const { run: runGate } = await import('./.out/gate/guide-gate.js');
report('guide gate', await runGate(document.getElementById('r')));

/* ------------------------------- 3. flow -------------------------------- */
console.log('\n▸ building first-launch-flow suite…');
npx(['vite', 'build', '-c', 'test/vite.flow.mjs', '--logLevel', 'error']);
installDom();
const { run: runFlow } = await import('./.out/flow/first-launch-flow.js');
report('first-launch flow', await runFlow(document.getElementById('r')));

console.log(failed ? `\n${failed} FAILED\n` : '\nAll suites passed.\n');
process.exit(failed ? 1 : 0);
