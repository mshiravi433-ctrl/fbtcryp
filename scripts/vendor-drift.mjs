/**
 * Pre-bundle the Drift + Solana SDK stack into ONE browser-ready ESM file
 * (public/vendor/drift-sdk.js) with esbuild.
 *
 * Why: feeding @drift-labs/sdk (~2700 CJS modules with anchor/coral/solana
 * transitive deps) through Rollup's production build exhausts a 4GB machine.
 * esbuild bundles the same graph in seconds with a fraction of the memory;
 * the app loads the result at runtime via a dynamic `import('/vendor/...')`,
 * so Rollup never sees those modules.
 *
 * Runs automatically before `vite build` (package.json "prebuild") and can be
 * run directly: `node scripts/vendor-drift.mjs`.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'public/vendor/drift-sdk.js');

/** Node built-in stubs — same browser noops as src/shims, inlined for esbuild. */
const stub = (body) => resolve(root, 'node_modules/.cache-drift-stub.mjs');
const fsStub = stub('fs');
const cryptoStub = stub('crypto');
const miscStub = stub('misc');
writeFileSync(fsStub, `
export const existsSync = () => false;
export const readFileSync = () => { throw new Error('fs not available in browser'); };
export const writeFileSync = () => {};
export const readdirSync = () => [];
export const mkdirSync = () => {};
export default { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync };
`);
writeFileSync(cryptoStub, `
const web = typeof globalThis !== 'undefined' && globalThis.crypto ? globalThis.crypto : null;
export const createHash = () => { throw new Error('node crypto.createHash not used in browser'); };
export const randomBytes = (n) => { const b = new Uint8Array(n || 16); if (web && web.getRandomValues) web.getRandomValues(b); return b; };
export const subtle = (web && web.subtle) || {};
export const webcrypto = web || {};
export default { createHash, randomBytes, subtle, webcrypto };
`);
writeFileSync(miscStub, `
/* Minimal EventEmitter — the anchor/solana stack subclasses it. */
class EventEmitter {
  constructor() { this._h = Object.create(null); }
  on(e, f) { (this._h[e] = this._h[e] || []).push(f); return this; }
  once(e, f) { const w = (...a) => { this.off(e, w); return f(...a); }; return this.on(e, w); }
  off(e, f) { if (this._h[e]) this._h[e] = this._h[e].filter((x) => x !== f); return this; }
  addListener(e, f) { return this.on(e, f); }
  removeListener(e, f) { return this.off(e, f); }
  emit(e, ...a) { (this._h[e] || []).slice().forEach((f) => { try { f(...a); } catch (_) {} }); return true; }
  removeAllListeners() { this._h = Object.create(null); return this; }
  listeners(e) { return this._h[e] || []; }
}
class Readable extends EventEmitter {}
class Writable extends EventEmitter {}
class Duplex extends EventEmitter {}
export { EventEmitter, Readable, Writable, Duplex };
export default { EventEmitter, Readable, Writable, Duplex, resolve: (...p) => p.join('/'), join: (...p) => p.join('/') };
export const resolve = (...p) => p.join('/');
export const join = (...p) => p.join('/');
export const dirname = (p) => String(p).replace(/[/][^/]*$/, '') || '.';
export const basename = (p) => String(p).split('/').pop();
export const homedir = () => '/';
export const platform = 'browser';
export const env = {};
export const cwd = () => '/';
export const nextTick = (fn) => Promise.resolve().then(fn);
export const request = () => { throw new Error('http not available in browser'); };
export const get = request;
export const createHash = () => { throw new Error('node crypto not available in browser'); };
`);

const aliasPlugin = {
  name: 'node-builtin-stubs',
  setup(b) {
    const alias = { fs: fsStub, 'node:fs': fsStub, crypto: cryptoStub, 'node:crypto': cryptoStub };
    for (const [k, v] of Object.entries(alias)) {
      b.onResolve({ filter: new RegExp(`^${k.replace(':', '\\:')}$`) }, () => ({ path: v }));
    }
    for (const mod of ['path', 'node:path', 'os', 'node:os', 'process', 'node:process', 'http', 'https', 'net', 'tls', 'zlib', 'stream', 'events', 'url', 'util']) {
      b.onResolve({ filter: new RegExp(`^${mod.replace(':', '\\:')}$`) }, () => ({ path: miscStub }));
    }
  }
};

mkdirSync(dirname(outfile), { recursive: true });

/* The SDK is tslib-compiled CJS (`__exportStar(require(...), exports)`), which
   esbuild does NOT trace for `export *` — the bundle came out with 3 exports.
   Generate an entry that explicitly re-exports every named binding, built at
   bundle time so new SDK exports are picked up automatically. */
const sdkModule = await import('@drift-labs/sdk');
const web3Module = await import('@solana/web3.js');
const names = Object.keys(sdkModule).filter((k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
/* web3.js classes the trade path needs that the SDK does not re-export. */
const web3Names = ['VersionedTransaction', 'TransactionMessage', 'ComputeBudgetProgram', 'Connection', 'PublicKey']
  .filter((k) => typeof web3Module[k] !== 'undefined' && !names.includes(k));
const entryFile = resolve(root, 'scripts/.vendor-drift-entry.generated.mjs');
writeFileSync(entryFile, [
  '/* AUTO-GENERATED by scripts/vendor-drift.mjs — do not edit. */',
  `export { ${names.join(', ')} } from '@drift-labs/sdk';`,
  web3Names.length ? `export { ${web3Names.join(', ')} } from '@solana/web3.js';` : '',
  "export { getAssociatedTokenAddressSync } from '@solana/spl-token';"
].filter(Boolean).join('\n'));

await build({
  entryPoints: [entryFile],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  plugins: [aliasPlugin],
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.DRIFT_RUST_LOG': '""',
    /* js-sha256 probes for a Node Buffer at module init; force its browser
       branch (TextEncoder-based) so it never reads process.binding. */
    'process.versions': '{}',
    global: 'globalThis'
  },
  /* The Solana/Anchor stack reaches for Node's `process` and `Buffer`
     globals. In the app, Vite injects compatible shims; the standalone vendor
     bundle must bring its own tiny polyfills so it also loads in plain
     browsers/webviews without a bundler. */
  banner: {
    js: [
      'if (typeof globalThis.process === "undefined") { globalThis.process = { env: { NODE_ENV: "production" }, browser: true, version: "", nextTick: (f) => Promise.resolve().then(f) }; }',
      '/* minimal Buffer shim: the js-sha256 / anchor stack only needs from()/alloc() on Uint8Array */',
      'if (typeof globalThis.Buffer === "undefined") {',
      '  class B extends Uint8Array {',
      '    static from(d, e) { const u = typeof d === "string" ? new TextEncoder().encode(d) : new Uint8Array(d); return new B(u); }',
      '    static alloc(n) { return new B(n); }',
      '    static isBuffer(o) { return o instanceof B; }',
      '    toString() { return new TextDecoder().decode(this); }',
      '  }',
      '  globalThis.Buffer = B;',
      '}'
    ].join('\n')
  }
});

console.log('✓ Drift vendor bundle written to public/vendor/drift-sdk.js');
