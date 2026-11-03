/**
 * KHRONOS LOCAL — where the model files live and what the runtime costs.
 * =====================================================================
 *
 * The model is NOT bundled with the app: 33 MB of ONNX weights inside the JS
 * bundle would be paid for by every visitor — including the 99% who never open
 * the forecast. It is fetched from a static host, once, on an explicit user
 * action, and kept in Cache Storage.
 *
 * Resolution order (first non-empty wins):
 *   1. `window.__FBT_KRONOS_MODEL_BASE__` — lets operations move the files
 *      (CDN, R2 bucket, GitHub release) without rebuilding the app.
 *   2. `VITE_KRONOS_MODEL_BASE_URL` — build-time override.
 *   3. `<origin><base>/kronos-local/` — the self-hosted default: whatever
 *      `public/kronos-local/` contains at build time lands next to the app.
 *
 * No credential ever goes in here. These are public static files: there is
 * nothing secret about a published model, and the browser needs to read them
 * with a plain GET.
 */

/** Files the runtime needs, relative to the base URL. */
export const MANIFEST_FILE = 'model-manifest.json';

/** Approximate transfer sizes of the ONNX Runtime Web engines. The wasm build
 *  is what every non-WebGPU device (iPhone Safari, Firefox, older Android)
 *  loads; the jsep build is the WebGPU one. They are separate downloads
 *  because loading the 23.7 MB GPU engine on a phone without WebGPU would be
 *  pure waste. Numbers are measured from onnxruntime-web 1.23.0. */
export const RUNTIME_BYTES = {
  /* The .wasm files served from `public/kronos-ort/` (see ORT_ASSET_PATH),
   * byte-identical to node_modules/onnxruntime-web/dist — the vendoring script
   * verifies that. Sizes are the plain, uncompressed file sizes. */
  wasm: 11_815_498,
  webgpu: 25_372_571
};

/**
 * Folder holding ONNX Runtime's engine files, under their ORIGINAL names.
 *
 * ─── WHY THIS IS NOT `null` ANY MORE ────────────────────────────────────────
 * ORT's browser bundle does not contain its engine: it `import()`s a glue
 * module (`ort-wasm-simd-threaded.mjs`, or `….asyncify.mjs` for WebGPU) and
 * fetches the matching `.wasm`, both by NAME, relative to `wasmPaths` — or, if
 * that is unset, relative to the bundle's own URL (`/assets/`). Vite never
 * emits those glue modules, so with `null` here the production app asked for
 * `/assets/ort-wasm-simd-threaded.mjs`, got a 404, and every user who finished
 * the 33 MB download saw «موتور محلی روی این دستگاه بالا نیامد» (SESSION_FAILED).
 * It built green and `test:kronos-local` passed because that test runs ORT's
 * NODE build from node_modules, which never touches this path.
 *
 * So the engine files are vendored verbatim into `public/kronos-ort/` at build
 * time (scripts/vendor-kronos-ort.mjs, also run by the Vite config) and this
 * points at them. Same origin: no CORS, no third party, no secret.
 *
 * Evaluated inside the worker, where there is no `window` — hence `globalThis`.
 * Never empty: an empty value would silently restore the bug.
 */
export function ortAssetPath() {
  const base = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/')
    .replace(/\/$/, '');
  const path = `${base}/${ORT_ASSET_DIR}/`;
  const origin = globalThis.location && globalThis.location.origin;
  if (!origin || origin === 'null') return path;
  return new URL(path, origin).toString();
}

/** Folder name under `public/` — shared with scripts/vendor-kronos-ort.mjs and the dist test. */
export const ORT_ASSET_DIR = 'kronos-ort';

export const ORT_ASSET_PATH = ortAssetPath();

/** The app's own copy, next to index.html. Always a valid answer. */
export function sameOriginBaseUrl() {
  if (typeof window === 'undefined' || !window.location) return '';
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  return withSlash(new URL(`${base.replace(/\/$/, '')}/kronos-local/`, window.location.origin).toString());
}

/**
 * Where the model files are.
 *
 * Order: an operator override injected at runtime, then the build-time host,
 * then the app's own origin. That last one is not a theoretical default any
 * more — the build vendors the published bytes into `public/kronos-local/`
 * (scripts/fetch-kronos-model.mjs), so the same-origin copy is real on any
 * deployment that was built with network access.
 *
 * Which is why a failed download retries the OTHER base before giving up: a
 * deployment can legitimately have one host configured and the files served
 * from the other, and a single cross-origin 404 would otherwise present as
 * «مدل منتشر نشده» while 33 MB sit next to index.html.
 */
export function modelBaseUrl() {
  const injected = typeof window !== 'undefined' ? window.__FBT_KRONOS_MODEL_BASE__ : '';
  if (typeof injected === 'string' && injected.trim()) return withSlash(injected.trim());
  const fromEnv = typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_KRONOS_MODEL_BASE_URL
    : '';
  if (typeof fromEnv === 'string' && fromEnv.trim()) return withSlash(fromEnv.trim());
  return sameOriginBaseUrl();
}

/**
 * Published graphs on the orphan branch, as a last resort when the configured
 * host is dead and this deployment did not vendor `public/kronos-local/`.
 * GitHub Pages at `mshiravi433-ctrl.github.io/fbtcryp` is not a site, so a
 * build that baked that URL cannot be the only place we look.
 * raw.githubusercontent.com sends CORS `*`. jsDelivr is the same bytes.
 */
export const RAW_MODEL_BASE = 'https://raw.githubusercontent.com/mshiravi433-ctrl/fbtcryp/kronos-model/';
export const CDN_MODEL_BASE = 'https://cdn.jsdelivr.net/gh/mshiravi433-ctrl/fbtcryp@kronos-model/';

/** Every place worth trying, in order, without duplicates. */
export function modelBaseCandidates() {
  const primary = modelBaseUrl();
  const own = sameOriginBaseUrl();
  const out = [];
  for (const url of [primary, own, RAW_MODEL_BASE, CDN_MODEL_BASE]) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

/** Cache Storage bucket. Versioned by schema + model so a model upgrade can
 *  never be silently mixed with the previous one. */
export function cacheName(manifest) {
  const id = manifest?.model?.id || 'unknown';
  const schema = manifest?.schema || 'v0';
  /* Keep immutable model revisions in separate buckets. The schema/model name
     alone is not a version: a refreshed export can have the same two values,
     and a previous (or partially corrupt) cache must not satisfy its new
     manifest. The manifest's published SHA-256 values are the cache identity;
     readModelFile still verifies the full digest before inference. */
  const revision = Array.isArray(manifest?.files)
    ? manifest.files.map((file) => String(file?.sha256 || 'missing').slice(0, 12)).join('-')
    : 'unversioned';
  return `fbt-kronos-${schema}-${id.split('/').pop()}-${revision}`;
}

/** Result cache bucket (IndexedDB via the app's storage helper). */
export const RESULT_CACHE_PREFIX = 'fbt.kronos.forecast.';
export const RESULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const RESULT_CACHE_MAX = 24;
