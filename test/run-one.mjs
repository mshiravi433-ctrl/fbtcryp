/**
 * Standalone driver for ONE mounted probe suite, so a single screen can be
 * iterated on in seconds instead of re-running the whole test file.
 *
 *   node test/run-one.mjs test/vite.intentos.mjs .out/intentos/intentos-wiring-probe.js
 *
 * It is a thin copy of run.mjs's builder + installDom(); run.mjs stays the
 * authority for what CI runs.
 */
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';

const [, , config, entry] = process.argv;
if (!config || !entry) {
  console.error('usage: node test/run-one.mjs <vite config> <built entry relative to test/>');
  process.exit(2);
}

execFileSync('npx', ['vite', 'build', '-c', config, '--logLevel', 'error'], { stdio: ['ignore', 'inherit', 'inherit'] });

function installDom(html = '<!doctype html><html><body><div id="r"></div></body></html>') {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true, virtualConsole });
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

installDom();
const { run } = await import(`./${entry}`);
const rows = await run(document.getElementById('r'));
let failed = 0;
for (const row of rows) {
  const [name, ok] = Array.isArray(row) ? row : [row?.name, row?.ok];
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall green');
process.exitCode = failed ? 1 : 0;
