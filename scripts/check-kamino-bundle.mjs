/*
 * Browser-simulation load check for the vendored Kamino KLend bundle.
 *
 * ─── WHY THIS IS NOT ALLOWED TO BE "JUST AN IMPORT()" (2026-09-22) ──────────
 * This script used to import the built file under Node with a fake `process`
 * and call it a browser simulation. It passed — while EVERY real browser threw
 * on the same bytes:
 *
 *     ReferenceError: Buffer is not defined
 *
 * `Buffer` is a Node global; the klend graph reads it in its module bodies.
 * Running under Node therefore could not fail, and a bundle that cannot start
 * in a browser shipped behind a green check. The panel could only show its
 * generic KAMINO_SDK_FAILED («ماژول Kamino اجرا نشد»), which is exactly the
 * report this file now prevents from ever being reproducible.
 *
 * So the check must HIDE the Node-only globals before importing: no `Buffer`,
 * no `process.versions`, no `require`, and window/self present as a browser
 * has them. A bundle that needs Node must fail HERE, in the build, not on the
 * user's phone. The same bytes are additionally loadable in a real Chromium
 * (see the harness note at the bottom).
 *
 * Exit 0 = the bundle starts with browser globals only; exit 1 = broken.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] || 'public/vendor/kamino-klend-sdk.js');

/* ─── build the browser-shaped global environment ─────────────────────────── */
const fakeProcess = {
  env: { NODE_ENV: 'production' },
  browser: true,
  nextTick: (f) => Promise.resolve().then(f)
};
Object.defineProperty(globalThis, 'process', { value: fakeProcess, configurable: true });
globalThis.window = globalThis;
globalThis.self = globalThis;
/* The one that mattered. Keep it undefined even if a future Node re-exposes it
   as a configurable global — and assert below that the bundle installs its own. */
const hadBuffer = 'Buffer' in globalThis;
Object.defineProperty(globalThis, 'Buffer', { value: undefined, writable: true, configurable: true });
if (hadBuffer) globalThis.Buffer = undefined;

try {
  const mod = await import(pathToFileURL(target).href);
  const failures = [];
  for (const name of ['KaminoMarket', 'KaminoAction', 'VanillaObligation']) {
    if (typeof mod[name] !== 'function') failures.push(`${name} is ${typeof mod[name]}`);
  }
  /* The load-bearing methods — a version bump that renames them must fail
     here, with a name, instead of later as `… .load is not a function`. */
  if (typeof mod.KaminoMarket?.load !== 'function') failures.push('KaminoMarket.load missing');
  for (const builder of ['buildDepositTxns', 'buildBorrowTxns', 'buildWithdrawTxns', 'buildRepayTxns']) {
    if (typeof mod.KaminoAction?.[builder] !== 'function') failures.push(`KaminoAction.${builder} missing`);
  }
  if (String(mod.PROGRAM_ID || '').length < 32) failures.push('PROGRAM_ID missing');
  if (typeof mod.DEFAULT_RECENT_SLOT_DURATION_MS !== 'number') {
    failures.push('DEFAULT_RECENT_SLOT_DURATION_MS missing');
  }
  /* The bundle must bring its own Buffer for the browser — that is the fix
     this check exists to protect. */
  if (typeof globalThis.Buffer !== 'function' && typeof globalThis.Buffer?.from !== 'function') {
    failures.push('bundle did not install a browser Buffer');
  }
  if (failures.length) {
    console.error(`✗ kamino bundle exports incomplete: ${failures.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('✓ kamino bundle loads with browser globals only (no Node Buffer); all panel exports present.');
  }
} catch (error) {
  console.error(`✗ kamino bundle FAILED to initialize in browser-sim: ${String(error?.message || error).slice(0, 240)}`);
  process.exitCode = 1;
}

/*
 * The browser-sim above is necessary but not sufficient: it is Node's
 * module loader with globals hidden. When a Chromium is available the bytes
 * are also loaded over HTTP in a real engine (scripts/check-kamino-browser.mjs,
 * `npm run check:kamino-browser`) — that is what originally reproduced the
 * Buffer crash, and it is the check to run whenever this file changes.
 */
