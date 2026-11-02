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
  /* Emitted by the bundler into /assets with a content hash; measured from the
   * production build, not from node_modules (the shipped file is not the same
   * size as the one in the package). */
  wasm: 11_815_498,
  webgpu: 25_372_571
};

/**
 * Leave ONNX Runtime to resolve its own engine file.
 *
 * The worker is bundled (`new Worker(new URL(...), {type:'module'})`), so Vite
 * sees ORT's `new URL('ort-wasm-simd-threaded…wasm', import.meta.url)`, copies
 * the engine into /assets under a content hash and rewrites the URL. Forcing
 * `wasmPaths` to a hand-copied folder would (a) ship a SECOND copy of a 12–25
 * MB binary in every deployment and (b) mean the engine is the one file in the
 * app without cache-busting. `null` = keep the bundler's URL.
 */
export const ORT_ASSET_PATH = null;

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

/** Every place worth trying, in order, without duplicates. */
export function modelBaseCandidates() {
  const primary = modelBaseUrl();
  const own = sameOriginBaseUrl();
  return [primary, own].filter((url, i, all) => Boolean(url) && all.indexOf(url) === i);
}

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

/** Cache Storage bucket. Versioned by schema + model so a model upgrade can
 *  never be silently mixed with the previous one. */
export function cacheName(manifest) {
  const id = manifest?.model?.id || 'unknown';
  const schema = manifest?.schema || 'v0';
  return `fbt-kronos-${schema}-${id.split('/').pop()}`;
}

/** Result cache bucket (IndexedDB via the app's storage helper). */
export const RESULT_CACHE_PREFIX = 'fbt.kronos.forecast.';
export const RESULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const RESULT_CACHE_MAX = 24;
