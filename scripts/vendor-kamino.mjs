/*
 * Build the Kamino web3.js SDK as an isolated browser module. Vite already
 * sits close to the memory limit for this app; feeding Kamino's optional farms,
 * scope and oracle graph through Rollup makes production builds OOM. The app
 * imports this generated file at runtime, while this script runs in prebuild.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'public/vendor');
const outfile = resolve(root, 'public/vendor/kamino-klend-sdk.js');
const manifestFile = resolve(root, 'public/vendor/kamino-klend-sdk.manifest.json');
/* Kept in lockstep with KAMINO_VENDOR_REV in src/lib/solanaLending.js: the
   query string is the only cache-buster on this file, and the manifest lets
   the client tell a TRUNCATED download from a bundle that will not start. */
const VENDOR_REV = '3';
const stub = resolve(root, 'node_modules/.cache-kamino-stub.mjs');
writeFileSync(stub, `
export const existsSync = () => false;
export const readFileSync = () => { throw new Error('fs is not available in the browser'); };
export const writeFileSync = () => {};
export const mkdirSync = () => {};
export const readdirSync = () => [];
export const createHash = () => { throw new Error('node crypto is not available in the browser'); };
export const randomBytes = (n = 16) => { const b = new Uint8Array(n); globalThis.crypto?.getRandomValues?.(b); return b; };
export const resolve = (...p) => p.join('/');
export const join = (...p) => p.join('/');
export const dirname = (p) => String(p).replace(/[/][^/]*$/, '') || '.';
export const basename = (p) => String(p).split('/').pop();
export const platform = 'browser';
export const env = {};
export const cwd = () => '/';
export const nextTick = (fn) => Promise.resolve().then(fn);
class EventEmitter { constructor() { this._h = {}; } on(e, f) { (this._h[e] ||= []).push(f); return this; } once(e, f) { return this.on(e, (...a) => { this.off(e, f); f(...a); }); } off(e, f) { if (this._h[e]) this._h[e] = this._h[e].filter(x => x !== f); return this; } emit(e, ...a) { (this._h[e] || []).forEach(f => f(...a)); return true; } }
export { EventEmitter };
export default { EventEmitter };
`);
const aliasPlugin = {
  name: 'kamino-browser-stubs',
  setup(buildApi) {
    for (const name of ['fs', 'node:fs', 'crypto', 'node:crypto', 'path', 'node:path', 'os', 'node:os', 'process', 'node:process', 'stream', 'events', 'url', 'util', 'http', 'https', 'net', 'tls', 'zlib']) {
      buildApi.onResolve({ filter: new RegExp(`^${name.replace(':', '\\:')}$`) }, () => ({ path: stub }));
    }
  }
};
const entry = resolve(root, 'scripts/.vendor-kamino-entry.generated.mjs');
writeFileSync(entry, [
  /* 2026-09-22: pre-warm via the package index FIRST. The klend dist graph is
     CJS with circular requires (fraction.js <-> utils/obligationOrder chain);
     esbuild's deep-entry first-touch order left `Fraction.MAX_F_BN` undefined
     at module init, crashing the bundle in every browser. Importing the index
     replays Node's own require() order, which is proven to initialize cleanly,
     then the deep re-exports hit the warm cache. */
  "import '@kamino-finance/klend-sdk';",
  "export { KaminoMarket } from '@kamino-finance/klend-sdk/dist/classes/market.js';",
  "export { KaminoAction } from '@kamino-finance/klend-sdk/dist/classes/action.js';",
  "export { VanillaObligation } from '@kamino-finance/klend-sdk/dist/utils/ObligationType.js';",
  "export { PROGRAM_ID } from '@kamino-finance/klend-sdk/dist/idl_codegen/programId.js';",
  "export { DEFAULT_RECENT_SLOT_DURATION_MS } from '@kamino-finance/klend-sdk/dist/classes/reserve.js';",
].join('\n'));
/* ─── THE BUFFER SHIM IS LOAD-BEARING (2026-09-22) ─────────────────────────
 * Reported: «هنوز مشکل وام سولنا حل نشده … KAMINO_SDK_FAILED». Reproduced in a
 * real Chromium against the shipped bundle:
 *
 *     ReferenceError: Buffer is not defined
 *     at /vendor/kamino-klend-sdk.js  (module init)
 *
 * The klend distribution graph reads the NODE global `Buffer` in its module
 * bodies. Node HAS that global, so `scripts/check-kamino-bundle.mjs` — which
 * ran under Node — passed the broken bundle and the build shipped it for
 * weeks. Every real browser threw at import, the panel could only report the
 * generic KAMINO_SDK_FAILED, and no Solana loan could ever be built.
 *
 * The fix is a shim PREPENDED TO THE FILE (esbuild `banner`), not an import
 * inside the entry module: ESM imports are hoisted, so an assignment made in
 * the entry's own body would run AFTER the SDK graph had already initialized.
 * The banner is the first top-level statement of the emitted file, so it runs
 * before the first `init_*()` call. It installs the browser polyfill ONLY when
 * the page has no Buffer of its own (a wallet provider may ship one).
 */
async function bufferShimBanner() {
  const shimEntry = resolve(root, 'scripts/.vendor-kamino-buffer-shim.generated.mjs');
  writeFileSync(shimEntry, "import { Buffer } from 'buffer';\nif (!globalThis.Buffer) globalThis.Buffer = Buffer;\n");
  const shim = await build({
    entryPoints: [shimEntry], bundle: true, write: false, format: 'iife',
    platform: 'browser', target: ['es2020'], minify: true, legalComments: 'none'
  });
  return shim.outputFiles[0].text;
}

mkdirSync(outdir, { recursive: true });
try {
  const bufferShim = await bufferShimBanner();
  /* 2026-09-22: single-file CJS-interop output crashed at module init in
     browsers (circular `Fraction.MAX_F_BN` access inside the klend dist
     graph). Fixed by pre-warming the package index in the entry above (see
     scripts/check-kamino-bundle.mjs), which replays Node's require() order.
     splitting is enabled so any dynamic-import islands emitted in future SDK
     upgrades become sibling chunks instead of breaking the single-file
     entry; today esbuild typically emits just kamino-klend-sdk.js. */
  await build({
    entryPoints: [entry], outdir, bundle: true, splitting: true, format: 'esm', platform: 'browser',
    entryNames: 'kamino-klend-sdk', chunkNames: 'kamino-chunks/[name]-[hash]',
    target: ['es2020'], minify: true, legalComments: 'none', sourcemap: false,
    plugins: [aliasPlugin], logLevel: 'info',
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    banner: {
      js: [
        /* 1. the browser globals the klend graph reads at module init */
        bufferShim,
        /* 2. the process shim (kept: the graph also reads process.env/NODE_ENV) */
        'if (!globalThis.process) globalThis.process = { env: { NODE_ENV: "production" }, browser: true, nextTick: f => Promise.resolve().then(f) };'
      ].join('\n')
    }
  });
  /* A manifest of what was actually emitted. The client compares it against
     what it downloaded: a body shorter than `bytes` is a TRUNCATED transfer
     (the flaky-mobile-network failure), not a broken SDK — and the two had
     the same symptom in the panel before this existed. */
  const digest = createHash('sha256').update(readFileSync(outfile)).digest('hex');
  const bytes = statSync(outfile).size;
  writeFileSync(manifestFile, `${JSON.stringify({
    file: 'kamino-klend-sdk.js', rev: VENDOR_REV, bytes, sha256: digest, builtAt: new Date().toISOString()
  }, null, 2)}\n`);
  /* A bundle that builds but crashes at import time in a real browser is
     worse than no bundle: verify init works under browser-sim conditions. */
  execFileSync(process.execPath, [resolve(root, 'scripts/check-kamino-bundle.mjs'), outfile], { stdio: 'inherit' });
} catch (error) {
  /* `--soft` (predev): a dev machine without the klend-sdk installed (fresh
     clone before a full `npm ci`, offline) must still be able to start the
     dev server — the Solana panel then shows its honest KAMINO_SDK_UNAVAILABLE
     state instead of appearing "active". A production build (no flag) still
     fails hard: a build that cannot vendor the SDK must not ship. */
  if (process.argv.includes('--soft')) {
    console.warn(`⚠ Kamino KLend vendor bundle NOT generated (${String(error?.message || error).slice(0, 120)}). Solana lending will report KAMINO_SDK_UNAVAILABLE in this dev session.`);
    process.exitCode = 0;
  } else {
    throw error;
  }
  process.exit(process.exitCode);
}
console.log(`✓ Kamino KLend vendor bundle written to public/vendor/kamino-klend-sdk.js (rev ${VENDOR_REV}, ${statSync(outfile).size} bytes)`);
console.log('✓ integrity manifest written to public/vendor/kamino-klend-sdk.manifest.json');
