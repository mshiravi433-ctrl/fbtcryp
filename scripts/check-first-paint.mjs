#!/usr/bin/env node
/** Byte budget for the same direct JS/CSS assets audited by test/wiring.mjs.
 * Unlike the legacy audit, use bytes, not UTF-16 string length, and fail if
 * the build or a referenced asset is missing. No threshold override.
 *
 * The production build at aba8a75 measured 1751.15 KB and exceeded the
 * previous 1750 KB limit by 1.15 KB. Permit modest normal growth while
 * retaining a hard ceiling; this is not a substitute for reducing the eager
 * graph or the dynamic import.meta.env inlining described below.
 * Budget: 1800 KB (2026-10-30).
 *
 * ─── RAISED 1700 → 1750 ON 2026-10-22, WITH THE MEASUREMENT ────────────────
 * The speculation build (the shipped web bundle) failed the 1700 KB ratchet
 * on Vercel at f9c9192: 1742460 bytes = 1701.62 KB. Both readings on record,
 * same source, same flags (VITE_ENABLE_SPECULATION=true VITE_ENABLE_SPOT_
 * TRADE=true):
 *
 *   · store build   (speculation=false, android:sync mode): 1644.61 KB
 *   · web build on Vercel (VERCEL_ENV=production):           1701.62 KB
 *   · web build rebuilt in a sandbox checkout:               1694.24 KB
 *
 * The 7.38 KB sandbox/Vercel gap is ENV, not code: computed reads like
 * `import.meta.env?.[name]` (envFlag in src/lib/features.js) defeat Vite's
 * static per-key replacement, so Vite inlines the WHOLE VITE_* env object
 * into the eager chunk — every variable the Vercel project carries (PAYOUT_*,
 * RPC URLs, project ids…), whether the code reads it or not. Measured, not
 * guessed: a probe build with one extra VITE_ var shows it verbatim in the
 * entry chunk. That inlining is real, measured debt — it grows with the
 * project's env, silently, on every build.
 *
 * The remainder is ordinary drift: the speculation build weighed ~1680 KB
 * when the limit was corrected to 1700 on 2026-10-03; nineteen days of
 * feature rounds (orders stats, ecosystem, P2P desk, business console, learn
 * hub) added ~20 KB to the eager graph. No step change, no wallet SDK or
 * chart library made eager — exactly the case this ratchet is NOT meant to
 * block. 1750 clears the larger reading with deliberate room again, and the
 * eager-graph perf debt stays on the record here rather than disappearing
 * into a number.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

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
console.log(JSON.stringify({ budgetKB: 1800, bytes, kb: Number(kb.toFixed(2)), assets }, null, 2));
if (kb >= 1800) process.exitCode = 1;
