/** Deployment contract: a green production build must contain the model and
 * prove the emitted browser bundle can start its WASM sessions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const fetchScript = readFileSync(new URL('../scripts/fetch-kronos-model.mjs', import.meta.url), 'utf8');

test('production deployment fails closed when model files cannot be fetched or verified', () => {
  assert.match(vercel.buildCommand, /fetch-kronos-model\.mjs --required/);
  assert.match(fetchScript, /const required = process\.argv\.includes\('--required'\)/);
  assert.match(fetchScript, /process\.exit\(required \? 1 : 0\)/);
});

test('production build exercises the emitted ORT bundle against shipped model assets', () => {
  assert.match(pkg.scripts['build:full'], /vite build && npm run test:kronos-dist &&/);
  assert.match(pkg.scripts['test:kronos-dist'], /KRONOS_DIST_REQUIRED=1/);
});
