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

/*
 * server/app.js reads its rate budgets at module load, and the FIRST probe
 * to import it wins for the whole process. Pin both here so the learning
 * probe can exercise its own dedicated limiter (a small budget that trips
 * fast) without the broad /api limiter 429ing the rest of the HTTP suites.
 */
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.LEARNING_EVENT_RATE_LIMIT = process.env.LEARNING_EVENT_RATE_LIMIT || '3';
/*
 * The same trap, one budget over: the intent probe walks the full
 * claim/dispute/adjudication/cross-chain lifecycle and exceeds the
 * production settlement budget of 20/min — which it raises to 100 BEFORE
 * importing server/app.js. Now that the calm probe (0d) boots the shared
 * app earlier in the process, the budget must be pinned HERE or whichever
 * probe imports app.js first decides it for everyone.
 */
process.env.INTENT_SETTLEMENT_RATE_LIMIT = process.env.INTENT_SETTLEMENT_RATE_LIMIT || '100';

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

/* ------------------------------ 0. intent OS client logic ------------------- */
/* Pure logic suite first: the intent compiler, normalizer, memory store and
   solver capabilities. Fast to run, no bundler or DOM needed. */
console.log('▸ probing the intent compiler (pure logic, no DOM)…');
{
  const { default: runIntent } = await import('./intent-probe.mjs');
  report('intent compiler', await runIntent());
}

/* --------------------- 0a. intent execution core v2 ------------------------ */
/* Pure logic, no DOM and no network: the lifecycle state machine, the exact
   RPC preflight (against a mock provider), the deterministic route policy and
   the recovery table. These are the modules that stand between "the user
   approved this" and "the wallet signed that", so they run early and fast. */
console.log('▸ probing the intent lifecycle state machine…');
{
  const { default: runLifecycle } = await import('./intent-lifecycle-probe.mjs');
  report('intent lifecycle', await runLifecycle());
}

console.log('▸ probing the exact RPC preflight simulation (mock provider, no network)…');
{
  const { default: runSimulation } = await import('./intent-simulation-probe.mjs');
  report('intent simulation', await runSimulation());
}

console.log('▸ probing deterministic route scoring v2…');
{
  const { default: runRoutePolicy } = await import('./intent-route-policy-probe.mjs');
  report('intent route policy', await runRoutePolicy());
}

console.log('▸ probing the recovery engine…');
{
  const { default: runRecovery } = await import('./intent-recovery-probe.mjs');
  report('intent recovery', await runRecovery());
}

console.log('▸ probing actual output extraction from receipt logs…');
{
  const { default: runReceipt } = await import('./intent-receipt-probe.mjs');
  report('intent receipt output', await runReceipt());
}

console.log('▸ probing replaced-transaction tracking…');
{
  const { default: runReplacement } = await import('./intent-replacement-probe.mjs');
  report('intent replacement tracking', await runReplacement());
}

/* --------------------- 0a-2. wallet risk / verification helpers ----------- */
/* Pure logic, no DOM and no network: recipient risk classification, gas
   estimates that return null (never zero) when the fee feed is missing, the
   WC-style chain gate, cross-chain asset grouping and the security score. */
console.log('▸ probing the wallet risk / verification helpers…');
{
  const { default: runRisk } = await import('./wallet-risk-probe.mjs');
  report('wallet risk helpers', await runRisk());
}

/* ------------------------------ 0b. WalletConnect wiring -------------------- */
/* Static analysis of WalletContext.jsx for the two historical bugs (localhost
   origin, icon 404) and the project-id single-source-of-truth rule. */
console.log('▸ checking WalletConnect wiring (no bundler, no DOM)…');
{
  const { default: runWcWiring } = await import('./walletconnect-wiring.mjs');
  report('WalletConnect wiring', runWcWiring());
}

/* ------------------------------ 0c. WalletConnect behavior ------------------ */
/* Structural tests of the connect/disconnect guards in WalletContext.jsx. */
console.log('▸ checking WalletConnect behavior guards…');
{
  const { default: runWcConnect } = await import('./wc-connect-probe.mjs');
  report('WalletConnect behavior', runWcConnect());
}

/* ------------------------------ 0c-2. WC "spins forever" regression --------- */
/* Runtime probe (not a grep): proves a blocked-relay connect attempt is
   bounded by a real timeout instead of spinning for 60-90+ seconds. */
console.log('▸ probing the WalletConnect connect timeout (the "spins forever" fix)…');
{
  const { default: runWcTimeout } = await import('./wc-timeout-probe.mjs');
  report('WalletConnect connect timeout', await runWcTimeout());
}

/* ------------------------------ 0c-3. WC storage hygiene ------------------- */
/* Runtime probe: purgeWcStorage removes exactly the SDK/AppKit connection
   artifacts — the stale deep-link choice and persisted session that made the
   next connect skip the modal and open a wallet app with a dead pairing. */
console.log('▸ probing WalletConnect storage hygiene (stale deep-link/session cleanup)…');
{
  const { default: runWcStorage } = await import('./wc-storage-probe.mjs');
  report('WalletConnect storage hygiene', runWcStorage());
}

/* ------------------------------ 0c-4. WC chain resolution ------------------ */
/* Runtime probe: the connected chain must come from the session the wallet
   approved, not the SDK's required-chain default — the difference between
   showing the user's real tokens and hiding them on the wrong network. */
console.log('▸ probing WalletConnect chain resolution (Trust-on-Ethereum reports 56)…');
{
  const { default: runWcChain } = await import('./wc-chain-probe.mjs');
  report('WalletConnect chain resolution', runWcChain());
}

/* ------------------------------ 0d. calm music (HTTP + filters) ------------ */
/* Real HTTP against the real route with a stubbed archive.org: the bug was
   an empty catalogue being cached for six hours while the panel rendered
   nothing. Locks both ends of that failure. */
console.log('▸ probing the calm music endpoint and filters…');
{
  const { default: calmRows } = await import('./calm-probe.mjs');
  report('calm music', calmRows);
}

/* ------------------------------ 0e. safe refresh ---------------------------- */
/* The refresh contract: single-flight, guard-respecting, storage-untouching. */
console.log('▸ probing the safe-refresh contract…');
{
  const { default: refreshRows } = await import('./refresh-probe.mjs');
  report('safe refresh', refreshRows);
}

/* ------------------------------ 1. units -------------------------------- */
/* Pure logic first: it is the fastest suite and the one whose failures point
   most precisely at a cause. Bundled with Vite so extensionless imports and
   `import.meta.env` resolve exactly as they do in the app. */
console.log('▸ building unit suite…');
npx(['vite', 'build', '-c', 'test/vite.units.mjs', '--logLevel', 'error']);
installDom();
const { default: runUnits } = await import('./.out/units/units.js');
report('units (tokens · payout · faq · news)', await runUnits());

/* ------------------------------- 1. boot -------------------------------- */
/* The repository intentionally does not track dist/. Build the shipped static
   bundle here so `npm test` is self-contained in a fresh clone rather than
   depending on somebody having run `npm run build` first. */
console.log('▸ building shipped static bundle for boot checks…');
npx(['vite', 'build', '--logLevel', 'error']);
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

/* --------------------- 4b. coin detail under real data -------------------- */
/*
 * The screen suite mounts `<CoinDetail />` with NO id, which takes the
 * not-found branch and exercises almost nothing — analyze(), VerdictPanel,
 * HistoryPanel and CandleChart are all skipped.
 *
 * That gap is why «بعضی اوقات ... کرش میکنه» could be reported while the suite
 * stayed green. This mounts the page against sixteen real response shapes in
 * both chart modes, and asserts the route boundary recovers from the actual
 * cause: a lazy chunk that fails to load after a deploy.
 */
console.log('\n▸ building coin-detail data suite…');
npx(['vite', 'build', '-c', 'test/vite.coindetail.mjs', '--logLevel', 'error']);
installDom();
const { run: runCoinDetail } = await import('./.out/coindetail/coindetail-probe.js');
report('coin detail (real data shapes · chunk recovery)', await runCoinDetail(document.getElementById('r')));

/* --------------------------- 5. store-safe build -------------------------- */
/*
 * Two separate guarantees are checked here, and they are not the same thing:
 *
 *   A. THE ARCADE IS GONE FROM EVERY BUILD. It used to be a flag
 *      (VITE_ENABLE_GAMES) that store builds left off and the website turned
 *      on. It is now deleted from the repository, so the correct assertion is
 *      no longer "the default build excludes it" — it is "no build can
 *      include it, because there is nothing to include". A flag check would
 *      pass forever while someone re-added a Play route.
 *
 *   B. THE SPECULATION SCREENS ARE STILL A WORKING FLAG. Off for stores, on
 *      for the website. A flag nobody can turn on is a deletion with extra
 *      steps, so the opt-in is asserted to really emit its chunks.
 *
 * Asserting on the EMITTED FILENAMES rather than on the source is what caught
 * the original bug: reading the flag from import.meta.env left Rollup unable
 * to prove the lazy import was dead, so a 22KB Play chunk shipped even with
 * games "disabled".
 */
console.log('\n▸ verifying the arcade is absent and the speculation flag works…');
{
  const { readdirSync, rmSync, existsSync, readFileSync } = await import('node:fs');
  const rows = [];
  const gameChunk = /^(Play|Crash|Dice|Mines|Wheel|CoinFlip)/i;
  const specChunk = /^(Predict|Perp|Invest)/i;

  /* ---- A. deleted, not flagged ---- */
  for (const gone of [
    'src/pages/Play.jsx',
    'src/games',
    'src/lib/fairness.js',
    'src/hooks/useFairSession.js'
  ]) {
    rows.push([`${gone} is deleted from the repo`, !existsSync(gone)]);
  }

  rmSync('dist', { recursive: true, force: true });
  npx(['vite', 'build', '--logLevel', 'error']);
  const defaultAssets = existsSync('dist/assets') ? readdirSync('dist/assets') : [];
  rows.push(['store build emits no arcade chunk', !defaultAssets.some((f) => gameChunk.test(f))]);
  rows.push(['store build emits no speculation chunk', !defaultAssets.some((f) => specChunk.test(f))]);
  rows.push(['store build still produced a bundle', defaultAssets.length > 5]);

  /* ---- B. the speculation opt-in still works, and still has no games ---- */
  rmSync('dist', { recursive: true, force: true });
  execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_ENABLE_SPECULATION: 'true' }
  });
  const fullAssets = existsSync('dist/assets') ? readdirSync('dist/assets') : [];
  rows.push([
    'VITE_ENABLE_SPECULATION=true does emit those screens',
    fullAssets.some((f) => specChunk.test(f))
  ]);
  /*
   * The point the owner made: the website build is the one a first-time user
   * and Google both see. Whatever else it turns on, it must never bring the
   * arcade back.
   */
  rows.push(['the full build STILL has no arcade chunk', !fullAssets.some((f) => gameChunk.test(f))]);

  /*
   * And the arcade VOCABULARY must be gone from the full build too, not just
   * its chunks — the locale JSON is inlined by Rollup, which is exactly how
   * "removed" screens kept shipping their words last time.
   */
  {
    const text = fullAssets
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(`dist/assets/${f}`, 'utf8'))
      .join('\n');
    const arcadeWords = ['gambling-style', 'house edge', 'Provably fair', 'قمار'];
    const found = arcadeWords.filter((w) => text.includes(w));
    rows.push([
      `the full build ships no arcade vocabulary${found.length ? ` — found: ${found.join(', ')}` : ''}`,
      found.length === 0
    ]);
    rows.push(['there was actually a full bundle to scan', text.length > 100000]);
  }

  // Leave the tree in the store-safe state.
  rmSync('dist', { recursive: true, force: true });
  npx(['vite', 'build', '--logLevel', 'error']);

  /*
   * ─── THE VOCABULARY A CONTENT FILTER ACTUALLY SEES ────────────────────────
   * APKPure rejected ir.fbt.swap with "Not involve illegal sensitive words."
   *
   * Removing the ROUTES was not enough, and finding that out the slow way is
   * the reason this check exists. The speculation screens were gated and no
   * Predict/Perp/Invest chunk was emitted — but the WORDS were still in the
   * bundle, because the locale files are static imports and Rollup inlines
   * the whole JSON. A runtime `delete` cannot touch them.
   *
   * A filter scans strings, not call graphs. So this greps the BUILT OUTPUT,
   * in every language, for the vocabulary that gets a crypto app rejected.
   * Checking the source would miss exactly the case that bit us.
   */
  {
    const banned = [
      // English
      'Price prediction', 'Call the next candle', 'Perpetuals',
      'Leveraged futures', 'fixed-term yield', 'gambling-style', 'house edge',
      // Persian and Arabic equivalents — a filter reads these too, and the
      // Persian chunk was the last one still dirty after everything else
      // looked clean.
      'پیش‌بینی قیمت', 'قمار', 'اهرم', 'المضاربة'
    ];

    const assetDir = 'dist/assets';
    const files = existsSync(assetDir) ? readdirSync(assetDir) : [];
    const text = files
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(`${assetDir}/${f}`, 'utf8'))
      .join('\n');

    const found = banned.filter((w) => text.includes(w));
    rows.push([
      `the store build ships none of the flagged vocabulary${found.length ? ` — found: ${found.join(', ')}` : ''}`,
      found.length === 0
    ]);
    // If the bundle were empty this would pass vacuously.
    rows.push(['there was actually a bundle to scan', text.length > 100000]);
  }

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

/* Real HTTP coverage for registry discovery, signature authentication,
   immutable nonce admission, and public inclusion evidence. */
console.log('\n▸ probing the signed solver commitment API…');
{
  const intentApiRows = (await import('./intent-api-probe.mjs')).default;
  report('intent commitment API', intentApiRows);
}

/* Real HTTP + strict-validation coverage for privacy-safe execution
   observation: opt-in enforcement, unknown/address/tx-hash/free-text
   rejection, fail-closed storage, and the honest capabilities block. */
console.log('\n▸ probing privacy-safe intent execution observation…');
{
  const observationRows = (await import('./intent-observation-probe.mjs')).default;
  report('intent execution observation', observationRows);
}

console.log('\n▸ probing the execution-observation empirical trainer…');
{
  const execObsRows = (await import('./exec-observation-model-probe.mjs')).default;
  report('execution-observation model', execObsRows);
}

/* Real HTTP coverage for the learning core: opt-in enforcement (401), the
   dedicated event rate limiter (429), the in-memory params hot path (<1 ms),
   and the honest not-configured shapes when Blob is off. */
console.log('\n▸ probing the learning telemetry API…');
{
  const learningApiRows = (await import('./learning-api-probe.mjs')).default;
  report('learning telemetry API', learningApiRows);
}

/*
 * Native notification probe — runs the REAL notify.js with `Notification`
 * deleted and Capacitor injected, which is the one environment shape that
 * exists on the APK and can never occur in jsdom or a browser. This is the
 * suite that catches "Settings crashes on the phone but not on the web".
 *
 * It installs its own DOM per case, so it must run before anything that
 * depends on the shared jsdom set up by installDom().
 */
console.log('\n▸ probing notifications with no web Notification API…');
{
  const { default: runNative } = await import('./native-notify-probe.mjs');
  report('native notifications', await runNative());
}

/*
 * ORDER-WATCH → PUSH DELIVERY PROBE.
 *
 * The server-side watcher that fires auto-order alerts with the app closed.
 * Real bug: the daily cron ran runWatchCycle() with NO send callback, so a
 * triggered order hit `send(...)` where send was undefined, threw, was
 * caught, and the alert was silently dropped. This runs the real watch.js
 * against a stubbed price feed and asserts delivery only happens when a send
 * callback is wired, so the fix (and the wiring.mjs check) cannot regress.
 */
console.log('\n▸ probing order-watch push delivery…');
{
  const { default: runWatchPush } = await import('./watch-push-probe.mjs');
  report('order-watch → push', await runWatchPush());
}

/*
 * QR CAMERA LIFECYCLE.
 *
 * Wiring check #32 proves the dependency array was written correctly. It
 * cannot prove the camera stays alive across a re-render — that is a runtime
 * property. This drives the real component with an instrumented getUserMedia
 * and counts opens and stops.
 */
/*
 * The bottom nav's geometry. The raised centre button must sit BETWEEN the
 * second and third tab; a refactor that moves it out of the map would leave
 * it rendering correctly at the wrong end of the row.
 */
/*
 * Multi-aggregator quoting must not be slower than single-aggregator quoting.
 * Measured, not assumed — see the probe's header.
 */
console.log('\n▸ timing the multi-aggregator quote race…');
{
  const { default: runRace } = await import('./quote-race-probe.mjs');
  report('quote race', await runRace());
}

/*
 * The wallet panel. Its geometry broke twice from class-cascade conflicts, so
 * the structure is now asserted rather than assumed.
 */
/*
 * The Start screen's backdrop. Its sizing broke in a way that only shows on a
 * real viewport, so the probe asserts what jsdom CAN see: the elements exist,
 * and the twinkle is desynchronised per star.
 */
console.log('\n▸ checking the start screen backdrop…');
{
  npx(['vite', 'build', '-c', 'test/vite.splash.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runSplash } = await import('./.out/splash/splash-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('start screen', await runSplash(host));
}

console.log('\n▸ checking the wallet panel…');
{
  npx(['vite', 'build', '-c', 'test/vite.wallet.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runWallet } = await import('./.out/wallet/wallet-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('wallet panel', await runWallet(host));
}

/*
 * The wallet command center (Smart Wallet 2.0) renders only after a wallet is
 * CONNECTED, which the wallet panel probe above cannot reach — it mounts the
 * page in the disconnected empty state. This drives each new component
 * directly with representative props and asserts the honest states.
 */
console.log('\n▸ checking the wallet command center components…');
{
  npx(['vite', 'build', '-c', 'test/vite.wcc.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runWcc } = await import('./.out/wcc/wallet-command-center-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('wallet command center', await runWcc(host));
}

console.log('\n▸ checking the bottom nav layout…');
{
  npx(['vite', 'build', '-c', 'test/vite.nav.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runNav } = await import('./.out/nav/nav-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('bottom nav', await runNav(host));
}

console.log('\n▸ checking the QR camera survives re-renders…');
{
  npx(['vite', 'build', '-c', 'test/vite.qr.mjs', '--logLevel', 'error']);
  installDom();
  const { run: runQr } = await import('./.out/qr/qr-camera-probe.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  report('qr camera', await runQr(host));
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
