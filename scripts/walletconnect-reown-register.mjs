#!/usr/bin/env node
/**
 * REOWN CLOUD CHECKLIST — the domain allowlist, in clipboard-ready form.
 * ---------------------------------------------------------------------------
 * History: this script used to also write `/.well-known/walletconnect.txt`
 * from a dashboard-generated code, and then — after a 2025 blog post was read
 * as «no dashboard step is required any more» — it was rewritten to say the
 * allowlist no longer mattered. That conclusion is what kept «unverified
 * domain» alive through three pull requests.
 *
 * Read from the SDK instead (`@walletconnect/core` → controllers/verify.ts →
 * resolve()): a proposal is verified only when
 *
 *   1. an attestation JWT arrives from verify.walletconnect.org within 5s, AND
 *   2. that JWT's `isVerified` is true — set server-side from THIS project's
 *      domain registry (dashboard → Configuration → Domain → Allowlist), AND
 *   3. `metadata.url` equals the attested origin.
 *
 * Reown's current docs say the same in two steps (allowlist + metadata), and
 * add that only the domain in the metadata counts as the true one, and that
 * propagation takes up to five minutes.
 *
 * So step 1 below is a human click, and it is the step this app was missing:
 * the domains were allowlisted on the RETIRED project id while the code had
 * moved to the new one. See WALLET-UNVERIFIED-ROOT-CAUSE-2026-09-21.md.
 *
 * Nothing in this script can click it. What it does is print the exact values,
 * and (with --check) read the registry back from the public API and name the
 * gap — so the click takes seconds and the next report is a measurement.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';

import { predictVerifyVerdict, reownDashboardUrl } from '../src/lib/wc/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);

/* Read source instead of importing the bundle so the script runs on a fresh
 * clone before `npm install`. Each constant is a single string in config.js. */
const SRC_CONFIG = resolve(ROOT, 'src/lib/wc/config.js');
const readConst = (re) => {
  const src = readFileSync(SRC_CONFIG, 'utf8');
  const m = re.exec(src);
  if (!m) throw new Error(`constant not found in src/lib/wc/config.js: ${re}`);
  return m[1];
};
const PROJECT_ID = readConst(/export const WC_PROJECT_ID = '([^']+)'/m);
const APP_ID = readConst(/export const WC_ANDROID_APP_ID = '([^']+)'/m);
const ORIGINS = [
  ...readConst(/export const WC_ALLOWED_ORIGINS = Object\.freeze\(\[\s*([^\]]+)\s*\]\)/m)
    .matchAll(/'([^']+)'/g)
].map((m) => m[1]);

/* The origin WalletConnect actually has to verify: the public site. The APK
   WebView runs on https://localhost, which no wallet can verify — the spec
   has no mobile attestation yet — so it is listed, not verified. */
const VERIFIABLE_ORIGIN = 'https://fbtswap.ir';
const ICON_PATH = '/icon-512.png';
const DASHBOARD = reownDashboardUrl(PROJECT_ID);

/* HEAD-only so a misconfigured dashboard never becomes a build failure: the
 * answer goes to the support thread, not to a deploy hook. */
function probe(url, timeoutMs = 8_000) {
  return new Promise((resolve) => {
    const req = httpsRequest(
      url,
      { method: 'HEAD', timeout: timeoutMs },
      (res) => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode })
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ ok: false, error: String(err?.message || err) }));
    req.end();
  });
}

/** The registry Reown exposes publicly — the list `isVerified` is keyed off. */
function readRegistry(projectId, timeoutMs = 8_000) {
  return new Promise((resolve) => {
    const url = `https://api.web3modal.org/projects/v1/origins?projectId=${projectId}&st=appkit&sv=html-appkit-1.8.19`;
    const req = httpsRequest(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            list: Array.isArray(parsed?.allowedOrigins) ? parsed.allowedOrigins : null
          });
        } catch {
          resolve({ ok: false, status: res.statusCode, list: null, error: 'UNREADABLE_BODY' });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ ok: false, status: null, list: null, error: String(err?.message || err) }));
    req.end();
  });
}

const checklist = [
  {
    title: '1.  Allowlist the domain on THIS project (the step that was missing)',
    body: `${DASHBOARD}\n  → Configuration → Domain → “+ Domain” → ${VERIFIABLE_ORIGIN} → Allowlist\n\n` +
      `Add the value with the scheme and WITHOUT a trailing slash:\n\n` +
      `    ${VERIFIABLE_ORIGIN}        ← correct\n` +
      `    fbtswap.ir/                 ← wrong (no scheme, trailing slash)\n\n` +
      `Then (for the packaged app, which cannot be verified but must connect):\n\n` +
      `    https://localhost\n\n` +
      `Propagation takes up to 5 minutes. Until it lands, every wallet shows\n` +
      `“Unverified / Cannot verify” no matter how correct the metadata is.`
  },
  {
    title: '2.  Confirm the SDK ships the same origin in its metadata',
    body: `walletIdentityUrl() in src/lib/wc/config.js returns the page's own origin on\n` +
      `a public https page, and the canonical origin inside the APK. On the site it\n` +
      `is therefore:\n\n` +
      `    ${VERIFIABLE_ORIGIN}\n\n` +
      `If the metadata names a different host than the page runs on, the wallet\n` +
      `renders “Domain mismatch” (INVALID) instead of a match.`
  },
  {
    title: '3.  There is no file to upload and no DNS TXT',
    body: 'The `/.well-known/walletconnect.txt` proof-of-ownership flow is gone. The\n' +
      'attestation is issued by the enclave iframe the SDK itself loads. Do not add\n' +
      'a verification file, a DNS record, or a WALLETCONNECT_VERIFY_CODE env var —\n' +
      'nothing reads them. (The allowlist in step 1 is a different mechanism and\n' +
      'it IS required.)'
  },
  {
    title: '4.  Add the Android app id to App IDs (required for the APK)',
    body: `Dashboard → your project → App IDs:\n\n    ${APP_ID}\n\n` +
      `Without it, every session from the packaged app renders as a foreign app\n` +
      `using this project id.`
  },
  {
    title: '5.  Test in a real browser, on the allowlisted origin',
    body: `The enclave reads the origin of the page that opened it. A pairing started\n` +
      `inside the APK WebView (https://localhost) or on a preview host can never be\n` +
      `verified — that is a spec gap, not a bug.\n\n` +
      `Open ${VERIFIABLE_ORIGIN} in Chrome/Safari with Trust Wallet installed, delete\n` +
      `the old session in the wallet first, then connect and read the prompt.`
  }
];

function print() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' REOWN CLOUD CHECKLIST');
  console.log(` Project ID   : ${PROJECT_ID}`);
  console.log(` Dashboard    : ${DASHBOARD}`);
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('');
  for (const step of checklist) {
    console.log(step.title);
    for (const line of step.body.split('\n')) console.log('  ' + line);
    console.log('');
  }
}

async function check() {
  print();
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' LIVE PROBES (run this after every deploy)');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('');

  const registry = await readRegistry(PROJECT_ID);
  console.log(`Registry  ${registry.ok ? `HTTP ${registry.status}` : registry.error || 'FAILED'}`);
  if (!registry.ok) {
    console.log('  ⚠️  the registry could not be read from this host (network or project id)');
  } else if (!registry.list?.length) {
    console.log('  ❌ EMPTY — this project has no allowlisted domain, so no wallet can');
    console.log(`     verify it. Add ${VERIFIABLE_ORIGIN} per step 1 above.`);
  } else {
    for (const entry of registry.list) console.log(`  · ${entry}`);
  }
  console.log('');

  if (Array.isArray(registry.list)) {
    const verdict = predictVerifyVerdict({
      allowedOrigins: registry.list,
      declaredUrl: VERIFIABLE_ORIGIN,
      pageOrigin: VERIFIABLE_ORIGIN
    });
    console.log(`Verdict for ${VERIFIABLE_ORIGIN}: ${verdict.verdict}${verdict.reason !== 'OK' ? ` (${verdict.reason})` : ''}`);
    console.log(verdict.ok
      ? '  ✅ a wallet connecting from that origin will show “Domain match”.'
      : '  ❌ a wallet connecting from that origin will show “Unverified”.');
    console.log('');
  }

  for (const origin of ORIGINS) {
    const icon = await probe(`${origin}${ICON_PATH}`);
    console.log(`${icon.ok ? '✓' : '✗'} ${origin.padEnd(28)} icon=${icon.ok ? icon.status : icon.error || 'FAILED'}`);
  }

  console.log('');
  console.log('A green icon probe means the page is reachable from this host. It says');
  console.log('nothing about the registry — that is the row above it, and the row that');
  console.log('decides what the wallet prints.');
  console.log('');
}

if (has('help')) {
  console.log('node scripts/walletconnect-reown-register.mjs          print checklist');
  console.log('node scripts/walletconnect-reown-register.mjs --check  checklist + registry + live probes');
  console.log('node scripts/walletconnect-reown-register.mjs --copy   print the clipboard-ready lines');
} else if (has('copy')) {
  console.log(VERIFIABLE_ORIGIN);
  for (const origin of ORIGINS) if (origin !== VERIFIABLE_ORIGIN) console.log(origin);
  console.log(`App ID: ${APP_ID}`);
} else if (has('check')) {
  await check();
} else {
  print();
}
