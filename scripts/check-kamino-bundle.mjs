/*
 * Browser-simulation load check for the vendored Kamino KLend bundle
 * (2026-09-22). The bundle targets browsers: no real `process`, no Node
 * `require`. A single-file esbuild CJS-interop build previously crashed at
 * module init in every browser (`Fraction.MAX_F_BN` read on a partially
 * initialized circular require) while Node's own require() order worked.
 * This script reproduces the browser condition — a fake process WITHOUT
 * versions.node, window/self globals, and no require — then imports the
 * built file and asserts the exports the Solana lending panel consumes.
 * Exit 0 = bundle loads; exit 1 = broken, do not ship.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] || 'public/vendor/kamino-klend-sdk.js');

const fakeProcess = {
  env: { NODE_ENV: 'production' },
  browser: true,
  nextTick: (f) => Promise.resolve().then(f)
};
Object.defineProperty(globalThis, 'process', { value: fakeProcess, configurable: true });
globalThis.window = globalThis;
globalThis.self = globalThis;

try {
  const mod = await import(pathToFileURL(target).href);
  const failures = [];
  for (const name of ['KaminoMarket', 'KaminoAction', 'VanillaObligation']) {
    if (typeof mod[name] !== 'function') failures.push(`${name} is ${typeof mod[name]}`);
  }
  if (String(mod.PROGRAM_ID || '').length < 32) failures.push('PROGRAM_ID missing');
  if (typeof mod.DEFAULT_RECENT_SLOT_DURATION_MS !== 'number') {
    failures.push('DEFAULT_RECENT_SLOT_DURATION_MS missing');
  }
  if (failures.length) {
    console.error(`✗ kamino bundle exports incomplete: ${failures.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('✓ kamino bundle loads under browser-sim conditions; all panel exports present.');
  }
} catch (error) {
  console.error(`✗ kamino bundle FAILED to initialize in browser-sim: ${String(error?.message || error).slice(0, 240)}`);
  process.exitCode = 1;
}
