/**
 * PUT ONNX RUNTIME'S ENGINE FILES WHERE THE BROWSER CAN FIND THEM BY NAME
 * ======================================================================
 *
 * ORT Web's browser bundle is only the JS front end. The engine is a pair of
 * files per backend, requested BY ORIGINAL NAME relative to `env.wasm.wasmPaths`
 * (or, when that is unset, relative to the bundle's own URL):
 *
 *     WASM   (every device)   ort-wasm-simd-threaded.mjs          + .wasm
 *     WebGPU (when present)   ort-wasm-simd-threaded.asyncify.mjs + .wasm
 *
 * Vite copies the `.wasm` (under a hashed name) but NEVER emits the `.mjs` glue
 * — nothing imports it statically — so a default build requested
 * `/assets/ort-wasm-simd-threaded.mjs`, got a 404, and the on-device forecast
 * died with SESSION_FAILED on every phone and laptop. See
 * docs/kronos-local-browser.md.
 *
 * This copies the four files, verbatim and under their own names, into
 * `public/kronos-ort/` (gitignored: 37 MB of binaries stay out of history), and
 * `ORT_ASSET_PATH` (src/lib/kronosLocal/config.js) points `wasmPaths` there.
 *
 * Safe to run on every build:
 *   • source = node_modules/onnxruntime-web/dist of the INSTALLED version, so
 *     the engine always matches the JS front end that is bundled;
 *   • every file is compared by SHA-256 and rewritten only if it differs → a
 *     no-op when already vendored;
 *   • a missing source file is an error (exit 1): shipping a build without the
 *     engine is exactly the bug this fixes, so it must not pass silently.
 *
 * (No shebang on purpose: vite.config.js imports this file and esbuild cannot inline one.)
 *
 *   node scripts/vendor-kronos-ort.mjs           # copy + verify
 *   node scripts/vendor-kronos-ort.mjs --check   # verify only, never write
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const ORT_OUT_DIR = join(ROOT, 'public', 'kronos-ort');
const ORT_SRC_DIR = join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');

/** WASM path first (all devices), then the WebGPU (asyncify) pair. */
export const ORT_ENGINE_FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm'
];

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * @returns {{ ok: boolean, copied: string[], unchanged: string[], problems: string[] }}
 */
export function vendorKronosOrt({ checkOnly = false, log = () => {} } = {}) {
  const result = { ok: true, copied: [], unchanged: [], problems: [] };
  for (const name of ORT_ENGINE_FILES) {
    const src = join(ORT_SRC_DIR, name);
    const dest = join(ORT_OUT_DIR, name);
    if (!existsSync(src)) {
      result.problems.push(`${name}: not in node_modules/onnxruntime-web/dist (is onnxruntime-web installed, and the same version the app was written for?)`);
      continue;
    }
    const want = sha256(src);
    if (existsSync(dest) && statSync(dest).size === statSync(src).size && sha256(dest) === want) {
      result.unchanged.push(name);
      continue;
    }
    if (checkOnly) {
      result.problems.push(`${name}: ${existsSync(dest) ? 'differs from' : 'missing next to'} the installed onnxruntime-web copy`);
      continue;
    }
    mkdirSync(ORT_OUT_DIR, { recursive: true });
    copyFileSync(src, dest);
    if (sha256(dest) !== want) {
      result.problems.push(`${name}: copy does not hash like its source`);
      continue;
    }
    result.copied.push(name);
    log(`  ✓ ${name} ${(statSync(dest).size / 1e6).toFixed(2)} MB ${want.slice(0, 12)}…`);
  }
  result.ok = result.problems.length === 0;
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const say = (msg) => console.log(`[kronos-ort] ${msg}`);
  const checkOnly = process.argv.includes('--check');
  const result = vendorKronosOrt({ checkOnly, log: say });
  for (const problem of result.problems) say(`PROBLEM ${problem}`);
  if (!result.ok) process.exit(1);
  say(result.copied.length
    ? `done: wrote ${result.copied.length} file(s) to public/kronos-ort/, ${result.unchanged.length} already verified`
    : `already vendored and verified: ${result.unchanged.length} files in public/kronos-ort/`);
}
