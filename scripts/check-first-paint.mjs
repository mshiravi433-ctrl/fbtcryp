#!/usr/bin/env node
/** Byte budget for the same direct JS/CSS assets audited by test/wiring.mjs.
 * Unlike the legacy audit, use bytes, not UTF-16 string length, and fail if
 * the build or a referenced asset is missing.
 *
 * Keep a small amount of headroom for the production toolchain: Vercel's
 * Node/npm/esbuild combination can emit a few KiB more than a local build
 * from the same lockfile. The hard ceiling is still deliberately close to
 * the measured 1.7 MiB first-paint payload.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const FIRST_PAINT_BUDGET_KB = 1725;
const root = resolve('dist');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const refs = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
if (!refs.length) throw new Error('No first-paint assets found; build before measuring');
const assets = refs.map((ref) => {
  const path = resolve(root, `.${ref}`);
  if (!path.startsWith(`${root}/assets/`)) throw new Error(`Invalid asset: ${ref}`);
  return { ref, bytes: statSync(path).size };
});
const bytes = assets.reduce((sum, a) => sum + a.bytes, 0);
const kb = bytes / 1024;
console.log(JSON.stringify({ budgetKB: FIRST_PAINT_BUDGET_KB, bytes, kb: Number(kb.toFixed(2)), assets }, null, 2));
if (kb >= FIRST_PAINT_BUDGET_KB) process.exitCode = 1;
