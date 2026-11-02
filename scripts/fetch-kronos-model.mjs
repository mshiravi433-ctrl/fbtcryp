#!/usr/bin/env node
/**
 * PUT THE WEIGHTS WHERE THE APP CAN SERVE THEM ITSELF
 * ===================================================
 *
 * The forecast needs four ONNX graphs + a manifest (33.4 MB) at a URL the
 * browser can GET. Two problems with making that someone's manual step:
 *
 *   1. A deployment that is missing them is not broken — it is *dishonest in a
 *      way that looks broken*. The button says «فایل‌های مدل هنوز منتشر
 *      نشده‌اند» for a feature that works everywhere else. That is exactly the
 *      state the forecast shipped in.
 *   2. An external host adds a second thing that can be down, unfunded or
 *      misconfigured, and a cross-origin fetch that can fail for reasons the
 *      app cannot fix.
 *
 * So the build fetches the published bytes from the orphan branch *once* and
 * writes them into `public/kronos-local/`, which Vite copies into the
 * deployment. The files are then same-origin: no CORS, no third-party host, and
 * `modelBaseUrl()` needs no configuration at all.
 *
 * ─── WHY THIS IS SAFE TO RUN ON EVERY BUILD ─────────────────────────────────
 * • The bytes are published per commit, not per request: the ref is
 *   `kronos-model`, so a build always gets one consistent set.
 * • Every file is verified against the manifest's size AND SHA-256 — the same
 *   check the browser does — before it is written. A mismatch aborts the build
 *   rather than shipping a corrupt model.
 * • If anything is unavailable (offline build, restricted network), the script
 *   exits 0 and says so: `VITE_KRONOS_MODEL_BASE_URL` is the fallback, and the
 *   UI then reports the truth. It never fabricates bytes and never writes a
 *   partial file set.
 * • It is a no-op when the files are already present and verified, so local
 *   work and CI do not re-download 33 MB.
 *
 *   node scripts/fetch-kronos-model.mjs
 *   node scripts/fetch-kronos-model.mjs --ref kronos-model --repo owner/repo
 *   node scripts/fetch-kronos-model.mjs --check      # verify only, never write
 *   KRONOS_MODEL_REF=... KRONOS_MODEL_REPO=... node scripts/fetch-kronos-model.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'public', 'kronos-local');

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const REPO = argOf('--repo', process.env.KRONOS_MODEL_REPO || 'mshiravi433-ctrl/fbtcryp');
const REF = argOf('--ref', process.env.KRONOS_MODEL_REF || 'kronos-model');
const checkOnly = process.argv.includes('--check');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const say = (msg) => console.log(`[kronos-model] ${msg}`);

/** Read the manifest from the published branch. Returns null if unreachable. */
function readPublishedManifest() {
  const api = `https://api.github.com/repos/${REPO}/contents/model-manifest.json?ref=${encodeURIComponent(REF)}`;
  const res = spawnSync('curl', ['-fsSL', '--max-time', '60', '-H', 'Accept: application/vnd.github.raw', api], {
    encoding: 'utf8', maxBuffer: 8 << 20
  });
  if (res.status !== 0 || !res.stdout) {
    say(`manifest not readable from ${REPO}@${REF} (${(res.stderr || '').trim().split('\n').pop() || `curl exit ${res.status}`})`);
    return null;
  }
  try {
    return JSON.parse(res.stdout);
  } catch (error) {
    say(`manifest at ${REPO}@${REF} is not JSON: ${error.message}`);
    return null;
  }
}

/** Read one published file as bytes. Returns null on any failure. */
function readPublishedFile(name) {
  const api = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(name)}?ref=${encodeURIComponent(REF)}`;
  const res = spawnSync('curl', ['-fsSL', '--max-time', '300', '-H', 'Accept: application/vnd.github.raw', api], {
    maxBuffer: 64 << 20
  });
  if (res.status !== 0 || !res.stdout) {
    say(`${name} not readable (${(res.stderr || '').toString().trim().split('\n').pop() || `curl exit ${res.status}`})`);
    return null;
  }
  return res.stdout;
}

/** Is what is already on disk exactly the set the manifest describes? */
function localState(manifest) {
  if (!manifest || !Array.isArray(manifest.files)) return { complete: false };
  for (const file of manifest.files) {
    const path = join(OUT, file.name);
    if (!existsSync(path)) return { complete: false, missing: file.name };
    const buf = readFileSync(path);
    if (buf.byteLength !== file.bytes) return { complete: false, wrongSize: file.name };
  }
  const manifestPath = join(OUT, 'model-manifest.json');
  if (!existsSync(manifestPath)) return { complete: false, missing: 'model-manifest.json' };
  return { complete: true };
}

const manifest = readPublishedManifest();
if (!manifest) {
  say(checkOnly
    ? 'check: cannot confirm the published model — leaving whatever is on disk untouched.'
    : 'skipping: the published model is unreachable, so nothing is vendored. ' +
      'Set VITE_KRONOS_MODEL_BASE_URL to a host that serves it, or run this with network access.');
  process.exit(0);
}
if (manifest.schema !== 'fbt.kronos.browser.v1' || !Array.isArray(manifest.files)) {
  say(`refusing: schema ${manifest.schema} is not one this app can run`);
  process.exit(0);
}

const state = localState(manifest);
if (state.complete) {
  say(`already vendored and verified: ${manifest.files.length} files, ${(manifest.totalBytes / 1e6).toFixed(2)} MB`);
  process.exit(0);
}
if (checkOnly) {
  say(`check: not vendored (${state.missing || state.wrongSize || 'incomplete'})`);
  process.exit(1);
}

say(`vendoring ${manifest.files.length} files (${(manifest.totalBytes / 1e6).toFixed(2)} MB) from ${REPO}@${REF}`);
mkdirSync(OUT, { recursive: true });
const written = [];
for (const file of manifest.files) {
  const buf = readPublishedFile(file.name);
  if (!buf) {
    say('aborting: a file could not be read. Nothing is left half-written.');
    for (const w of written) rmSync(join(OUT, w), { force: true });
    process.exit(0);
  }
  if (buf.byteLength !== file.bytes) {
    say(`aborting: ${file.name} is ${buf.byteLength} bytes, the manifest says ${file.bytes}`);
    for (const w of written) rmSync(join(OUT, w), { force: true });
    process.exit(0);
  }
  const digest = sha256(buf);
  if (digest !== file.sha256) {
    say(`aborting: ${file.name} hashes to ${digest.slice(0, 12)}…, the manifest says ${String(file.sha256).slice(0, 12)}…`);
    for (const w of written) rmSync(join(OUT, w), { force: true });
    process.exit(0);
  }
  writeFileSync(join(OUT, file.name), buf);
  written.push(file.name);
  say(`  ✓ ${file.name} ${(buf.byteLength / 1e6).toFixed(2)} MB ${digest.slice(0, 12)}…`);
}
writeFileSync(join(OUT, 'model-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
say(`done: ${(manifest.totalBytes / 1e6).toFixed(2)} MB verified and written to public/kronos-local/`);
