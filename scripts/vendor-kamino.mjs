/*
 * Build the Kamino web3.js SDK as an isolated browser module. Vite already
 * sits close to the memory limit for this app; feeding Kamino's optional farms,
 * scope and oracle graph through Rollup makes production builds OOM. The app
 * imports this generated file at runtime, while this script runs in prebuild.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'public/vendor/kamino-klend-sdk.js');
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
  "export { KaminoMarket } from '@kamino-finance/klend-sdk/dist/classes/market.js';",
  "export { KaminoAction } from '@kamino-finance/klend-sdk/dist/classes/action.js';",
  "export { VanillaObligation } from '@kamino-finance/klend-sdk/dist/utils/ObligationType.js';",
  "export { PROGRAM_ID } from '@kamino-finance/klend-sdk/dist/idl_codegen/programId.js';",
].join('\n'));
mkdirSync(dirname(outfile), { recursive: true });
await build({
  entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser',
  target: ['es2020'], minify: true, legalComments: 'none', sourcemap: false,
  plugins: [aliasPlugin], logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  banner: { js: 'if (!globalThis.process) globalThis.process = { env: { NODE_ENV: "production" }, browser: true, nextTick: f => Promise.resolve().then(f) };' }
});
console.log('✓ Kamino KLend vendor bundle written to public/vendor/kamino-klend-sdk.js');
