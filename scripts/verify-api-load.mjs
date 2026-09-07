#!/usr/bin/env node
/**
 * DIAGNOSTIC — reproduce Vercel's Serverless-function load inside the build.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *   Vercel's Node builder evaluates the serverless entry (api/index.js) while
 *   tracing the function graph with @vercel/nft, which EXECUTES all top-level
 *   module code. Here that same top-level code threw, env-conditional:
 *
 *       Error: Cannot mix BigInt and other types, use explicit conversions
 *
 *   ...and Vercel reported only the one-line message with no stack, so the
 *   offending file:line was invisible. Every local reproduction with a blank
 *   or example env imported cleanly, which means the throw depends on a real
 *   production env value this script cannot invent.
 *
 *   This script does the ONE thing Vercel's builder does that the normal
 *   frontend build does not: import the api entry (which drags in server/app.js
 *   and its whole module graph) and let any top-level throw surface WITH its
 *   full stack. It runs as the last step of `build:full`, so on the next
 *   Vercel build the printed stack names the exact crashing line.
 *
 * WHY IT EXITS 0
 *   The static frontend build is healthy and must keep shipping. A diagnostic
 *   must never be able to fail a deploy, so every path below exits 0 — it only
 *   prints. This mirrors the convention already used by submit-indexnow.mjs.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_ENTRY = resolve(ROOT, 'api/index.js');

console.log('▸ api-function load diagnostic (mirrors Vercel @vercel/nft trace)…');

// Report presence (never values) of numeric/bigint config vars that are read
// at module load, so a clean-load here can still be correlated with the real
// function-phase crash. Names only — no secrets, no values.
const NUMERIC_CONFIG_VARS = [
  'FBT_INSURANCE_FEE_BPS',
  'FBT_INSURANCE_FLAT_FEE_MICRO',
  'FBT_PROVIDER_COMMISSION_BPS',
  'NEXUS_PREMIUM_SLIPPAGE_BPS',
  'NEXUS_COMMISSION_RATIO_BPS',
  'EVM_CONFIRMATIONS',
  'INSURANCE_PROVIDER_TIMEOUT_MS',
  'INSURANCE_FRESHNESS_TTL_MS',
  'RATE_LIMIT',
  'AI_TIMEOUT_MS',
  'AI_COLLAB_DEADLINE_MS'
];
const present = NUMERIC_CONFIG_VARS.filter((k) => {
  const v = process.env[k];
  return v !== undefined && v !== null && String(v).trim() !== '';
});
console.log(present.length
  ? `  numeric env vars present: ${present.join(', ')}`
  : '  (no numeric config env vars present)');

try {
  const mod = await import(API_ENTRY);
  const ok = typeof mod?.default === 'function' || mod?.default;
  console.log(ok
    ? '✓ api/index.js loaded cleanly under this environment.'
    : '⚠ api/index.js loaded but exported nothing usable — check the default export.');
} catch (err) {
  // NEVER block the deploy — the static site is already built and is fine.
  console.error('\n╔══════════════════════════════════════════════════════════════╗');
  console.error('║ API-FUNCTION LOAD FAILED — full stack below (non-fatal)      ║');
  console.error('╚══════════════════════════════════════════════════════════════╝');
  console.error(`message: ${err && err.message ? err.message : err}`);
  if (err && err.stack) console.error(err.stack);
  else console.error(err);
  console.error('\n(reported above only — the static build has already succeeded and');
  console.error(' this diagnostic exits 0 so it cannot fail the deployment.)');
}

process.exit(0);
