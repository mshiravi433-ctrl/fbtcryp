#!/usr/bin/env node
/**
 * Is the model actually published, and can a BROWSER read it?
 * ==========================================================
 *
 * The on-device forecast downloads four ONNX graphs plus a manifest from a
 * static host. Three things have to be true before a phone can use them, and
 * all three fail in ways that look identical to a user ("the model did not
 * download"):
 *
 *   1. reachable — HTTP 200 for every file, with the size the manifest claims;
 *   2. CORS — `Access-Control-Allow-Origin` must permit the app's origin,
 *      otherwise fetch() in the page fails even though curl succeeds;
 *   3. intact — the bytes must hash to the manifest's SHA-256.
 *
 * This script checks all three, then prints the numbers to put in the release
 * notes (total bytes, per-file bytes). It never needs the app running.
 *
 *   node scripts/check-kronos-model-host.mjs
 *   node scripts/check-kronos-model-host.mjs https://cdn.example.com/kronos/
 *   VITE_KRONOS_MODEL_BASE_URL=... node scripts/check-kronos-model-host.mjs
 *
 * Exit code 1 if any file is missing, mis-sized, CORS-blocked or corrupt.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const base = (process.argv[2] || process.env.VITE_KRONOS_MODEL_BASE_URL || '').trim();
if (!base) {
  console.error('usage: node scripts/check-kronos-model-host.mjs <baseUrl>');
  console.error('  e.g. node scripts/check-kronos-model-host.mjs https://cdn.example.com/kronos/');
  process.exit(2);
}
const withSlash = base.endsWith('/') ? base : `${base}/`;

/** Origin the browser check should pretend to be. */
const ORIGIN = process.env.KRONOS_CHECK_ORIGIN || 'https://fbt.example';

/* Same-origin hosting (the app serving its own /kronos-local/) needs no CORS
 * header at all; a CDN or release-asset host does. Only the latter is a failure. */
const crossOrigin = (() => {
  try { return new URL(withSlash).origin !== new URL(ORIGIN).origin; } catch { return true; }
})();
if (!crossOrigin) console.log(`(base host equals ${ORIGIN} — CORS headers are not required)`);

let failures = 0;
const note = (ok, message) => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${message}`);
};

const manifestUrl = `${withSlash}model-manifest.json`;
let manifest;
try {
  const res = await fetch(manifestUrl, { headers: { origin: ORIGIN } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const allow = res.headers.get('access-control-allow-origin');
  note(Boolean(allow) || !crossOrigin, `manifest CORS: ${allow || (crossOrigin ? 'no Access-Control-Allow-Origin header' : 'same-origin, not needed')}`);
  if (allow && allow !== '*' && allow !== ORIGIN) {
    note(false, `manifest CORS allows "${allow}" but not ${ORIGIN}`);
  }
  manifest = await res.json();
} catch (error) {
  console.error(`✗ manifest unreachable at ${manifestUrl}: ${error.message}`);
  process.exit(1);
}

note(manifest.schema === 'fbt.kronos.browser.v1', `manifest schema: ${manifest.schema}`);
note(Array.isArray(manifest.files) && manifest.files.length > 0, `manifest lists ${manifest.files?.length ?? 0} file(s)`);
if (manifest.model?.id) console.log(`  model: ${manifest.model.id} (${manifest.model.params?.toLocaleString?.() ?? '?'} params, ${manifest.model.license || 'license?'})`);

let total = 0;
for (const file of manifest.files) {
  const url = `${withSlash}${file.name}`;
  try {
    const res = await fetch(url, { headers: { origin: ORIGIN } });
    if (!res.ok) { note(false, `${file.name} HTTP ${res.status}`); continue; }
    const allow = res.headers.get('access-control-allow-origin');
    note(Boolean(allow) || !crossOrigin,
      `${file.name} CORS: ${allow || (crossOrigin ? 'MISSING — a browser fetch will fail' : 'same-origin, not needed')}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    note(bytes.byteLength === file.bytes, `${file.name} size ${bytes.byteLength} (manifest ${file.bytes})`);
    note(digest === file.sha256, `${file.name} sha256 ${digest.slice(0, 12)}… (manifest ${String(file.sha256).slice(0, 12)}…)`);
    total += bytes.byteLength;
  } catch (error) {
    note(false, `${file.name} failed: ${error.message}`);
  }
}
note(total === manifest.totalBytes, `total ${(total / 1e6).toFixed(2)} MB (manifest ${(manifest.totalBytes / 1e6).toFixed(2)} MB)`);

/* The runtime engine sizes are what the download prompt adds on top. */
const RUNTIME = { wasm: 11_815_498, webgpu: 25_372_571 };
console.log('\nfirst-run download a reader will see:');
console.log(`  WebGPU device : ${((total + RUNTIME.webgpu) / 1e6).toFixed(1)} MB (model + GPU engine)`);
console.log(`  WASM device   : ${((total + RUNTIME.wasm) / 1e6).toFixed(1)} MB (model + CPU engine)`);

if (failures) {
  console.error(`\n${failures} problem(s) — the browser will not be able to run this model from ${withSlash}`);
  process.exit(1);
}
console.log(`\nAll checks passed — ${withSlash} can serve the on-device forecast.`);
