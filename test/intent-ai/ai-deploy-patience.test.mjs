/**
 * «خیلی اوقات تغییرات دیگه هم نمیاد» — the build that never had to fail.
 * ---------------------------------------------------------------------
 * `vercel.json` runs `node scripts/fetch-kronos-model.mjs --required` before
 * every build, so the 33 MB forecast model must arrive from the published
 * branch. Under `--required` ONE failed curl — a reset, a 502, a slow minute —
 * aborts the whole production build, and Vercel just keeps serving the previous
 * deployment. The merge is on `main`, the site is old, and nothing says so.
 * Deployment dpl_5SLJTjDqqjGVwJcHcf3R4EihJ2Yt on main died exactly here.
 *
 * The fix is patience with a bound: curl retries the request, the script retries
 * the process (2s / 6s), and what is ACCEPTED is unchanged — the bytes are still
 * checked against the manifest's size and SHA-256.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../../scripts/fetch-kronos-model.mjs', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('P1 · the build command still requires the model (nothing weakened)', () => {
  assert.match(String(vercel.buildCommand || ''), /fetch-kronos-model\.mjs --required/);
});

test('P2 · curl retries the request itself', () => {
  assert.match(script, /--retry-connrefused/);
  assert.match(script, /'--retry', '3'/);
});

test('P3 · a failed attempt is retried with backoff, a bounded number of times', () => {
  assert.match(script, /CURL_RETRY_ATTEMPTS = 3/);
  assert.match(script, /CURL_RETRY_DELAYS_MS = \[2000, 6000\]/);
});

test('P4 · both network readers go through the retrying helper', () => {
  /* The readers used to call curl directly; only the wrapper may do that now. */
  assert.doesNotMatch(script, /const res = spawnSync\('curl'/);
  assert.equal((script.match(/= curl\(\['-fsSL'/g) || []).length, 2);
  assert.match(script, /function curl\(args/);
});

test('P5 · verification is untouched by the retries', () => {
  assert.match(script, /sha256/);
  assert.match(script, /manifest/);
});
