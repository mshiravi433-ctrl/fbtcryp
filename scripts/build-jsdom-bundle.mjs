/**
 * Build the jsdom boot bundle.
 *
 * ─── WHY THIS IS NOT test/vite.iife.mjs ──────────────────────────────────────
 *
 * `test/boot-e2e.mjs` part B executes the REAL app inside jsdom to prove it
 * paints with every external host black-holed. jsdom has no ES-module support,
 * so the app has to arrive as one classic script — which is what the old
 * `test/vite.iife.mjs` tried to produce with a Rollup `lib: { formats: ['iife'] }`
 * build of the whole application.
 *
 * That build could not work, for three separate reasons, and nobody saw any of
 * them because `test/run.mjs` used to die earlier (a probe called
 * `process.exit(0)` on success, so every suite below it was skipped):
 *
 *   1. `src/lib/kronosLocal/client.js` registers its worker with
 *      `new Worker(new URL('./kronos.worker.js', import.meta.url))`. Vite emits
 *      a separate ES chunk for that, and Rollup refuses: "UMD and IIFE output
 *      formats are not supported for code-splitting builds". The worker itself
 *      also imports `onnxruntime-web` dynamically, so it always code-splits.
 *   2. Even with the worker stubbed, Rollup's single-chunk render of 6,749
 *      modules of this app needs more heap than a 4 GB CI box has. It was
 *      killed at the render stage on every attempt (status 137 / V8 OOM),
 *      regardless of `--max-old-space-size`.
 *   3. Stubbing the runtime as an alias and dropping `publicDir` fixed (1) and
 *      the copying of 78 MB of unused assets, but not (2).
 *
 * esbuild does the same job in ~3 s at a small fraction of the memory, because
 * it streams rather than holding the whole module graph in a Rollup Bundle.
 *
 * ─── WHAT IS DELIBERATELY DIFFERENT FROM THE SHIPPED BUILD ───────────────────
 *
 * This bundle is only ever executed by jsdom, never shipped, and the boot test
 * asks exactly one question: does React paint with no network? So:
 *
 *   • CSS is emptied. boot-e2e strips every stylesheet from the page anyway,
 *     and parsing 200+ stylesheets with public/ url() references buys nothing.
 *   • Images/fonts become `empty`, not data URLs. Inlining them produced a
 *     36 MB script; the paint test never reads a pixel.
 *   • The Kronos worker is not bundled: the client only instantiates it when an
 *     on-device inference is requested, which the boot test never does.
 *   • Node built-ins are external. Some wallet SDKs import `crypto`/`http` in
 *     branches that are unreachable in a browser; Rollup externalized them too.
 *
 * The SHIPPED bundle is built by `vite build` alone — `npm run build`. Nothing
 * here changes what users download.
 */
import * as esbuild from 'esbuild';
import { rmSync, mkdirSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'test/.out/iife/app.js');

const NODE_BUILTINS = [
  'crypto', 'http', 'https', 'net', 'tls', 'url', 'stream', 'zlib', 'path',
  'fs', 'os', 'buffer', 'util', 'events', 'assert', 'dns', 'child_process'
];

const dropCss = {
  name: 'drop-css',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  }
};

/**
 * `import.meta.glob` is a VITE transform, and esbuild does not implement it.
 *
 * The app uses it exactly once — src/i18n/index.js builds its per-language
 * dynamic-import map with `import.meta.glob('./locales/*.json')`, deliberately,
 * so Vite emits one chunk per locale instead of bundling all twelve. Without a
 * transform esbuild leaves the call as written, `import.meta.glob` is undefined
 * at runtime, and the app dies inside the i18n module before React mounts (the
 * boot test caught exactly that: `TypeError: …glob is not a function`).
 *
 * So the glob is resolved the way Vite resolves it: a lazy `() => import(path)`
 * per matching file. That preserves the whole point of the original code — one
 * chunk per locale, English still synchronous — and it is the same object shape
 * src/i18n/index.js indexes into.
 */
const LOCALES = readdirSync(resolve(root, 'src/i18n/locales'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => f.replace(/\.json$/, ''));

const globLocales = {
  name: 'import-meta-glob-locales',
  setup(build) {
    build.onLoad({ filter: /src\/i18n\/index\.js$/ }, async (args) => {
      const source = readFileSync(args.path, 'utf8');
      const entries = LOCALES
        .map((code) => `  './locales/${code}.json': () => import('./locales/${code}.json')`)
        .join(',\n');
      const patched = source.replace(
        /import\.meta\.glob\(\s*'\.\/locales\/\*\.json'\s*\)/,
        `{\n${entries}\n}`
      );
      if (patched === source) throw new Error('import.meta.glob for locales not found — did src/i18n/index.js change shape?');
      return { contents: patched, loader: 'js', resolveDir: dirname(args.path) };
    });
  }
};

rmSync(resolve(root, 'test/.out/iife'), { recursive: true, force: true });
mkdirSync(dirname(outfile), { recursive: true });

const started = Date.now();
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['src/main.jsx'],
  outfile,
  bundle: true,
  format: 'iife',
  globalName: 'FBTApp',
  jsx: 'automatic',
  plugins: [dropCss, globLocales],
  /* Never read by the boot test; keeps the script small and the build cheap. */
  loader: {
    '.png': 'empty', '.jpg': 'empty', '.jpeg': 'empty', '.webp': 'empty',
    '.gif': 'empty', '.svg': 'empty', '.woff': 'empty', '.woff2': 'empty',
    '.ttf': 'empty', '.otf': 'empty', '.mp3': 'empty'
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    __SPECULATION_ENABLED__: 'false',
    __AAVE_BASE_SUPPLY_ENABLED__: 'false',
    'import.meta.env.MODE': '"production"',
    'import.meta.env.PROD': 'true',
    'import.meta.env.DEV': 'false',
    'import.meta.env.BASE_URL': '"/"'
  },
  external: NODE_BUILTINS,
  logLevel: 'error',
  minify: true,
  target: 'es2020'
});

const size = statSync(outfile).size;
console.log(`▸ jsdom bundle: ${(size / 1048576).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`);
