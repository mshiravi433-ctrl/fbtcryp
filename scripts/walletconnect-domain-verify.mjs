#!/usr/bin/env node
/**
 * PROBE WalletConnect Verify API readiness — domain-verify check, replaced.
 * ---------------------------------------------------------------------------
 * Historical context: this script used to write `/.well-known/walletconnect.txt`
 * from an env var because we believed the Reown dashboard issued a verification
 * code per project. The official blog post dated 2025-08-27
 * (https://walletconnect.com/blog/protect-users-from-phishing-with-walletconnect-verify-api-for-web3-apps-and-wallets)
 * says otherwise:
 *
 *   "WalletConnect's Verify API no longer requires manual domain listing in
 *    the Cloud dashboard. Instead, it now automatically determines and checks
 *    your app's domain when a wallet connects."
 *
 * Two checks happen on every session proposal: a Domain Match (the attested
 * origin vs. `metadata.url`) and a Scam Check (the Data Lake feed). Both are
 * performed server-side by the Verify Enclave at `verify.walletconnect.org`,
 * which reads `event.origin` from a `window.message` posted by the Verify
 * Client. There is no file to fetch from the dApp, no env var to set, and
 * no code to ship — only the project's `metadata.url` must name the origin
 * the page is actually served from (handled by `walletIdentityUrl()` in
 * `src/lib/wc/config.js`), and the project id must be in the AppKit config.
 *
 * This script is therefore a sanity check: it asks the Enclave whether it is
 * reachable from this network, prints the result, and exits 0 either way. A
 * missing code path, a 404 on the Enclave, or a missing file does NOT block
 * a build — the build never depended on it.
 *
 * `--strict` flips the exit code so CI can choose to make it a gate, but the
 * script itself never fails a deploy.
 */

import { WC_ALLOWED_ORIGINS, WC_PROJECT_ID, wcMetadata } from '../src/lib/wc/config.js';

const FILE_LEGACY = 'public/.well-known/walletconnect.txt';
const ENCLAVE_URL = 'https://verify.walletconnect.org/';
const TIMEOUT_MS = 8000;

const args = process.argv.slice(2);
const isStrict = args.includes('--strict');
const wantsCheck = args.includes('--check') || args.length === 0;

async function probeEnclave() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENCLAVE_URL, { method: 'HEAD', signal: controller.signal, cache: 'no-store' });
    return { ok: res.ok, status: res.status, error: null };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeMetadata() {
  const md = wcMetadata();
  return {
    name: md.name,
    url: md.url,
    verifyUrl: md.verifyUrl,
    icons: Array.isArray(md.icons) ? md.icons : []
  };
}

async function main() {
  console.log('WalletConnect Verify readiness probe');
  console.log('----------------------------------');
  console.log(`Project id:          ${WC_PROJECT_ID}`);
  console.log(`Allowlist (project): ${WC_ALLOWED_ORIGINS.join(', ')}`);
  console.log(`Metadata shipped to the wallet:`);
  const md = describeMetadata();
  console.log(`  name       = ${md.name}`);
  console.log(`  url        = ${md.url}`);
  console.log(`  verifyUrl  = ${md.verifyUrl}`);
  console.log(`  icons[0]   = ${md.icons[0]}`);

  const enclave = await probeEnclave();
  console.log(`\nVerify Enclave (${ENCLAVE_URL}):`);
  if (enclave.ok) {
    console.log(`  ✅ reachable (HTTP ${enclave.status})`);
  } else {
    console.log(`  ⚠️  not reachable${enclave.status ? ` (HTTP ${enclave.status})` : ''}${enclave.error ? ` — ${enclave.error}` : ''}`);
  }

  // Legacy `walletconnect.txt` is gone — the file is not part of the Verify API.
  // Mention it once so the deploy log explains the empty `public/.well-known/` dir.
  console.log('\nNotes:');
  console.log('  · `/.well-known/walletconnect.txt` is no longer part of the Verify API');
  console.log('    (it was the DNS-TXT-era proof-of-ownership artefact). The Verify');
  console.log('    Enclave attests origin via `window.message`; there is nothing to ship.');
  console.log(`  · Any leftover ${FILE_LEGACY} from a previous build is harmless: Vite`);
  console.log('    copies it but the verifier never reads it. Delete it if you want a');
  console.log('    clean deploy artefact (`git rm` it).');

  if (!wantsCheck) return;
  if (isStrict && !enclave.ok) {
    console.error('\n--strict set and Verify Enclave not reachable. Failing.');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
