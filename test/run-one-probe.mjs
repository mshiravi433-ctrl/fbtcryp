#!/usr/bin/env node
/** Ad-hoc runner for a single pre-bundled panel probe, mirroring run.mjs's installDom. */
import { JSDOM } from 'jsdom';

const probePath = process.argv[2];
if (!probePath) { console.error('usage: node run-one-probe.mjs <bundled-probe.js>'); process.exit(2); }

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

const dom = installDom();
const realError = console.error;
console.error = (...a) => {
  const s = String(a[0] ?? '');
  if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
  if (s.includes('Not implemented')) return;
  if (s.includes('ReactDOMTestUtils.act') || s.includes('is deprecated')) return;
  if (s.includes('React Router Future Flag')) return;
  realError(...a);
};

const { run } = await import(probePath);
const results = await run(dom.window.document.getElementById('r'));
const fails = results.filter((r) => !r[1]);
for (const [name, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
console.log(`\npassed ${results.length - fails.length}/${results.length}`);
process.exit(fails.length ? 1 : 0);
