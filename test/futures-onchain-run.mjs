#!/usr/bin/env node
/**
 * Standalone driver for the Futures → On-Chain (Velocity · Solana) UI probe —
 * the same suite test/run.mjs mounts, runnable on its own:
 *
 *   npm run test:futures-onchain
 *
 * It builds the probe bundle with the same vite config run.mjs uses and drives
 * the REAL /perp page in jsdom against a stubbed futures BFF.
 */
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const env = { ...process.env };
delete env.NODE_ENV; // vite must build a production React bundle, like Vercel does

execFileSync('npx', ['vite', 'build', '-c', 'test/vite.futures.mjs', '--logLevel', 'error'], { stdio: ['ignore', 'pipe', 'pipe'], env });

const dom = new JSDOM('<!doctype html><html><body><div id="r"></div></body></html>', { url: 'https://localhost/', pretendToBeVisual: true });
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

const realError = console.error;
console.error = (...a) => {
  const s = String(a[0] ?? '');
  if (s.includes('useLayoutEffect') || s.includes('act(')) return;
  realError(...a);
};

const { run } = await import('./.out/futures/futures-onchain-probe.js');
const rows = await run(document.getElementById('r'));
const failed = rows.filter((r) => !(Array.isArray(r) ? r[1] : r?.ok));
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);
