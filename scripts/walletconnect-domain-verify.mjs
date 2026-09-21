#!/usr/bin/env node
/**
 * WALLETCONNECT VERIFY READINESS — the registry, measured.
 * ---------------------------------------------------------------------------
 * History, because this script is the record of a wrong conclusion:
 *
 *  · Once it wrote `/.well-known/walletconnect.txt` from an env var, on the
 *    belief that the Reown dashboard issued a verification code per project.
 *    That flow is gone and is not coming back — no file, no DNS TXT.
 *  · Then it was rewritten into a HEAD probe of `verify.walletconnect.org`,
 *    on the belief (from a 2025 blog post) that «the Verify API no longer
 *    requires manual domain listing in the Cloud dashboard». That belief was
 *    the reason «unverified domain» survived three pull requests: the SDK
 *    still reads `isVerified` from the server, and the server keys it off the
 *    project's domain registry. See WALLET-UNVERIFIED-ROOT-CAUSE-2026-09-21.md.
 *
 * What this script measures now, with nothing but the public API:
 *
 *   1. Is the project known at all?        (403 = unknown/retired project id)
 *   2. Which origins are in its registry?  (GET /projects/v1/origins)
 *   3. What verdict do those facts imply?  (predictVerifyVerdict, from src)
 *
 * That third answer is the one a wallet renders, and it is exactly what was
 * never measured: on 2026-09-21 the code's project returned an EMPTY registry
 * while the retired project still carried `fbtswap.ir`.
 *
 * `--strict` fails the run when the verdict is not VALID, so CI can gate on it
 * once the allowlist is done. The script never registers anything: the
 * dashboard step is a human click, and this script's job is to print the exact
 * value to click with.
 */

import { WC_ALLOWED_ORIGINS, WC_PROJECT_ID, wcMetadata } from '../src/lib/wc/config.js';
import { originsProbeUrl, isOriginAllowed } from '../src/lib/wc/health.js';
import { predictVerifyVerdict as predict, reownDashboardUrl, VERIFY_SERVER, VERIFY_SERVER_V3 } from '../src/lib/wc/verify.js';

const args = process.argv.slice(2);
const isStrict = args.includes('--strict');
const originArg = args.find((a) => a.startsWith('--origin='));
const ORIGIN = originArg ? originArg.slice('--origin='.length) : 'https://fbtswap.ir';

const REASONS = {
  NO_DOMAIN_REGISTERED: '❌ this project has NO domain in its registry — every wallet shows «Cannot verify»',
  ORIGIN_NOT_REGISTERED: '❌ this origin is not in the project registry',
  METADATA_MISMATCH: '❌ metadata.url is not the origin this page runs on (wallets show «Domain mismatch»)',
  NO_LIST: '⚠️  the registry could not be read (network or project id)',
  OK: '✅ Domain match'
};

async function readRegistry(projectId) {
  const url = originsProbeUrl(projectId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return { ok: false, status: res.status, list: null, url };
    const body = await res.json();
    return { ok: true, status: res.status, list: Array.isArray(body?.allowedOrigins) ? body.allowedOrigins : null, url };
  } catch (error) {
    return { ok: false, status: null, error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error), list: null, url };
  } finally {
    clearTimeout(timer);
  }
}

const metadata = wcMetadata();
const registry = await readRegistry(WC_PROJECT_ID);
const verdict = predict({
  allowedOrigins: registry.list,
  declaredUrl: metadata.url,
  pageOrigin: ORIGIN
});

console.log('WalletConnect Verify readiness');
console.log('------------------------------');
console.log(`Project id        : ${WC_PROJECT_ID}`);
console.log(`Dashboard         : ${reownDashboardUrl(WC_PROJECT_ID)}`);
console.log(`Origin under test : ${ORIGIN}`);
console.log(`Enclave           : ${VERIFY_SERVER_V3} (SDK host: ${VERIFY_SERVER})`);
console.log('');
console.log(`Registry (${registry.url})`);
if (!registry.ok) {
  console.log(`  ⚠️  unreadable${registry.status ? ` — HTTP ${registry.status}` : ''}${registry.error ? ` — ${registry.error}` : ''}`);
} else if (!registry.list?.length) {
  console.log('  ❌ EMPTY — no domain is allowlisted on this project.');
} else {
  for (const entry of registry.list) {
    console.log(`  · ${entry}${isOriginAllowed(ORIGIN, registry.list) && (entry === ORIGIN || ORIGIN.endsWith(entry)) ? '   ← covers this origin' : ''}`);
  }
}
console.log('');
console.log('Metadata the wallet receives');
console.log(`  url       = ${metadata.url}`);
console.log(`  verifyUrl = ${metadata.verifyUrl || '—'}`);
console.log(`  icons[0]  = ${metadata.icons?.[0] || '—'}`);
console.log('');
console.log(`Verdict: ${verdict.verdict}${verdict.verdict === 'VALID' ? '' : ` (${verdict.reason})`}`);
console.log(`  ${REASONS[verdict.reason] ?? '—'}`);
console.log('');
console.log('Expected on this project (from src/lib/wc/config.js):');
for (const origin of WC_ALLOWED_ORIGINS) console.log(`  · ${origin}`);
console.log('');

if (verdict.verdict !== 'VALID') {
  console.log('Fix (a human click — no code can do it):');
  console.log(`  1. ${reownDashboardUrl(WC_PROJECT_ID)}`);
  console.log('  2. Configuration → Domain → “+ Domain”');
  console.log(`  3. ${ORIGIN}  (with the scheme, no trailing slash) → Allowlist`);
  console.log('  4. Wait up to 5 minutes, clear the old session in the wallet, reconnect.');
  console.log('');
}

if (isStrict && verdict.verdict !== 'VALID') {
  console.error('--strict set and the verdict is not VALID. Failing.');
  process.exit(1);
}
process.exit(0);
