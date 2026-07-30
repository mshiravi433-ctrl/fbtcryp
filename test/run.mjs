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

/* ------------------------------ 4. screens ------------------------------- */
/* Lazy routes fail silently: a broken import in News or Swap does not break
   the build and does not break the boot test either — it breaks for whoever
   taps that tab. Mount each one directly. */
console.log('\n▸ building screen smoke suite…');
npx(['vite', 'build', '-c', 'test/vite.screens.mjs', '--logLevel', 'error']);
installDom();
const { run: runScreens } = await import('./.out/screens/screens.js');
report('screen smoke (all 12 languages)', await runScreens(document.getElementById('r')));

/* --------------------------- 5. store-safe build -------------------------- */
/*
 * The arcade flag is a STORE COMPLIANCE control, not a UI toggle: Google Play
 * and the Iranian stores reject gambling-styled content, and "route hidden but
 * code still in the APK" does not satisfy that — a reviewer can unzip it.
 *
 * This caught a real bug: reading the flag from import.meta.env left Rollup
 * unable to prove the lazy import was dead, so a 22KB Play chunk shipped even
 * with games disabled. Asserting on the emitted files is the only check that
 * would have noticed.
 */
console.log('\n▸ verifying the default build excludes the arcade…');
{
  const { readdirSync, rmSync, existsSync } = await import('node:fs');
  const rows = [];
  const gameChunk = /^(Play|Crash|Dice|Mines|Wheel|CoinFlip)/i;

  rmSync('dist', { recursive: true, force: true });
  npx(['vite', 'build', '--logLevel', 'error']);
  const defaultAssets = existsSync('dist/assets') ? readdirSync('dist/assets') : [];
  rows.push(['default build emits no arcade chunk', !defaultAssets.some((f) => gameChunk.test(f))]);
  rows.push(['default build still produced a bundle', defaultAssets.length > 5]);

  // And the opt-in must still work, or the flag is just broken rather than safe.
  rmSync('dist', { recursive: true, force: true });
  execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_ENABLE_GAMES: 'true' }
  });
  const optInAssets = existsSync('dist/assets') ? readdirSync('dist/assets') : [];
  rows.push(['VITE_ENABLE_GAMES=true does emit the arcade', optInAssets.some((f) => gameChunk.test(f))]);

  // Leave the tree in the store-safe state.
  rmSync('dist', { recursive: true, force: true });
  npx(['vite', 'build', '--logLevel', 'error']);

  report('store-safe build', rows);
}

/*
 * STACKING ORDER — a modal must never open behind the thing that opened it.
 *
 * Real bug this catches: the onboarding stage is `position: fixed; z-index:
 * 95`, while the Sheet backdrop was 60 and the sheet 61. So tapping "Terms of
 * Service" on the onboarding terms step mounted the dialog UNDERNEATH the
 * onboarding screen. It rendered, it locked body scroll, it was simply
 * invisible — indistinguishable from a dead button, and invisible to a test
 * that only asserts the element exists.
 *
 * jsdom does not composite, so no render test can catch this. Reading the
 * declared z-index out of the stylesheet can.
 */
/*
 * LAZY LOCALES.
 *
 * All twelve locale files (508 KB) used to be static imports in
 * src/i18n/index.js, so every one of them shipped in the entry chunk and a
 * Persian user downloaded eleven languages they will never see before the
 * first frame could paint. They are dynamic now — which introduces a new way
 * to break: a language that fails to load silently, leaving raw keys or the
 * wrong language on screen. This asserts the switch really works.
 */
/*
 * BODY SCROLL LOCK.
 *
 * The old implementation snapshotted body.style.overflow on lock and restored
 * that snapshot on unlock. With two overlapping modals (SendSheet opening
 * QrScanner) the inner lock snapshots 'hidden', so if the unlocks run in any
 * order other than strict reverse the last one restores 'hidden' and the page
 * can never scroll again until reload. React does not guarantee sibling
 * unmount order, so that ordering could not be relied on.
 */
console.log('\n▸ checking body scroll lock…');
{
  npx(['vite', 'build', '-c', 'test/vite.scrolllock.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runLock } = await import('./.out/scrolllock/scrolllock-probe.js');
  report('scroll lock', await runLock());
}

/*
 * Wiring audit — pure file analysis, no bundler or DOM needed, so it runs
 * first and fails fast. Catches the class of bug where everything renders and
 * the build is green but a button does nothing or shows a raw key.
 */
console.log('\n▸ auditing wiring (keys · routes · dead files)…');
{
  const { default: runWiring } = await import('./wiring.mjs');
  report('wiring', runWiring());
}

console.log('\n▸ checking lazy locale loading…');
{
  npx(['vite', 'build', '-c', 'test/vite.i18n.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runI18n } = await import('./.out/i18n/i18n-probe.js');
  report('lazy locales', await runI18n());
}

console.log('\n▸ checking modal stacking order…');
{
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/index.css', 'utf8');

  // Last declaration wins in CSS, so take the final value for each selector.
  const zOf = (selector) => {
    const re = new RegExp(`\\${selector}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
    let m, last = null;
    while ((m = re.exec(css))) {
      const z = /z-index:\s*(-?\d+)/.exec(m[1]);
      if (z) last = Number(z[1]);
    }
    return last;
  };

  const sheetLayer = zOf('.sheet-layer');
  const sheetBackdrop = zOf('.sheet-backdrop');
  const moreLayer = zOf('.more-layer');
  const onb = zOf('.onb-stage');
  const guide = zOf('.guide-stage');
  const welcome = zOf('.welcome-stage') ?? onb;

  const topStage = Math.max(onb ?? 0, guide ?? 0, welcome ?? 0);

  report('modal stacking', [
    ['every z-index was found', [sheetLayer, sheetBackdrop, moreLayer, onb, guide].every((v) => typeof v === 'number')],
    [`sheet backdrop (${sheetBackdrop}) is above the top stage (${topStage})`, sheetBackdrop > topStage],
    [`sheet layer (${sheetLayer}) is above the top stage (${topStage})`, sheetLayer > topStage],
    ['sheet panel sits above its own backdrop', sheetLayer > sheetBackdrop],
    [`more drawer (${moreLayer}) is above the top stage (${topStage})`, moreLayer > topStage],
    ['more drawer sits above the shared backdrop', moreLayer > sheetBackdrop]
  ]);
}

/*
 * LIGHT-THEME CONTRAST.
 *
 * Real bug: the palette is neon, designed to glow against black. On a white
 * card the same colours measured 1.33-1.79:1 against their own background,
 * where WCAG AA wants 4.5:1 for text — so promo banners rendered as
 * near-invisible text on near-white. Nothing was broken structurally, which
 * is why it survived: only a colour measurement catches it.
 */
console.log('\n▸ measuring light-theme contrast…');
{
  const { readFileSync } = await import('node:fs');
  const ad = readFileSync('src/components/AdBanner.jsx', 'utf8');

  const relLum = (hex) => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [la, lb] = [relLum(a), relLum(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  // Pull every `inks: [...]` pair out of the slot table.
  const inks = [...ad.matchAll(/inks:\s*\['(#[0-9a-fA-F]{6})',\s*'(#[0-9a-fA-F]{6})'\]/g)];
  const rows = [];
  rows.push(['every slot defines a readable ink pair', inks.length === 5]);

  for (const [, a] of inks) {
    const r = ratio(a, '#ffffff');
    rows.push([`ink ${a} reaches AA on white (${r.toFixed(2)}:1)`, r >= 4.5]);
  }

  // And the neon originals must still be the ones used for the dark theme,
  // otherwise we have "fixed" light mode by dulling both.
  const hues = [...ad.matchAll(/hues:\s*\['(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
  rows.push(['dark theme keeps the neon hues', hues.includes('#00e5ff') && hues.includes('#00ff9d')]);

  report('light-theme contrast', rows);
}

console.log(failed ? `\n${failed} FAILED\n` : '\nAll suites passed.\n');
process.exit(failed ? 1 : 0);
