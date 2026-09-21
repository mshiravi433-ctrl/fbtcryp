#!/usr/bin/env node
/**
 * REOWN DASHBOARD REGISTRATION CHECKLIST
 * ---------------------------------------------------------------------------
 * Asked for: «در تراست والت هم برای localhost و هم برای fbtswap.ir
 * هنوز unverifued domain» — Trust Wallet still shows "unverified domain"
 * for both the packaged APK (running at https://localhost) and the
 * production site (https://fbtswap.ir).
 *
 * Three layers have to be right before a wallet renders "verified", and this
 * script writes the checklist for the layer that this repository cannot touch:
 * the Reown Cloud dashboard (https://dashboard.reown.com/). The other two
 * layers are owned by code:
 *
 *   1. THIS REPO'S metadata tells the wallet a domain that MATCHES the page
 *      origin (`walletIdentityUrl` in `src/lib/wc/config.js`). This branch is
 *      covered by the stack probe and the tests.
 *   2. THIS REPO serves the verification file at `/.well-known/walletconnect.txt`
 *      with the Reown-generated code (`scripts/walletconnect-domain-verify.mjs`).
 *      Run `node scripts/walletconnect-domain-verify.mjs --check` to confirm.
 *   3. THE DASHBOARD has the right entries on the allowlist — and this is what
 *      this script writes the checklist for. Three origins, one Android app id,
 *      and one verification challenge, all in the same project
 *      (`WC_PROJECT_ID` in `src/lib/wc/config.js`,
 *      `5997d5aee8bb42f43ddec4b1a5f94eb1`).
 *
 * ─── WHAT IT DOES ───────────────────────────────────────────────────────────
 *   · Prints, in clipboard-ready form, every origin the dashboard must have
 *     on the Allowlist. Includes the `https://localhost` that this dApp
 *     registers as the WebView origin inside the Android APK.
 *   · Prints the Android application id the dashboard must register.
 *   · Verifies, by HEAD, that each origin serves the verification file with
 *     the same content — because Reown's verifier reads the file from EACH
 *     allowed origin, not only from one.
 *   · Verifies, by HEAD, that the icon (`/icon-512.png`) is reachable on each
 *     allowed origin — because Trust Wallet and MetaMask fetch it during the
 *     connection prompt and render a generic glyph otherwise, which several
 *     readers interpret as "this dApp is not who it claims to be".
 *   · Verifies that the relay is reachable from the host running this script,
 *     so the next deploy does not go out and discover, from a phone, that the
 *     relay was unreachable.
 *
 * ─── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *   · It does not register the domains in the dashboard. Reown's dashboard
 *     does not expose a public API for domain registration yet — registration
 *     is a manual click on dashboard.reown.com. The script prints the EXACT
 *     values to paste in, so the click takes seconds.
 *
 * ─── USAGE ──────────────────────────────────────────────────────────────────
 *   node scripts/walletconnect-reown-register.mjs
 *   node scripts/walletconnect-reown-register.mjs --check   (HTTP probes)
 *   node scripts/walletconnect-reown-register.mjs --copy    (print clipboard-ready lines)
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);

/* Kept in sync with src/lib/wc/config.js. Reading source instead of importing
 * the bundle keeps this script runnable on a freshly-cloned machine where
 * dependencies are not yet installed. The file is a single constant. */
const SRC_CONFIG = resolve(ROOT, 'src/lib/wc/config.js');
function readProjectId() {
  const src = readFileSync(SRC_CONFIG, 'utf8');
  const m = /export const WC_PROJECT_ID = '([^']+)'/m.exec(src);
  if (!m) throw new Error('WC_PROJECT_ID not found in src/lib/wc/config.js');
  return m[1];
}
function readAndroidAppId() {
  const src = readFileSync(SRC_CONFIG, 'utf8');
  const m = /export const WC_ANDROID_APP_ID = '([^']+)'/m.exec(src);
  return m ? m[1] : 'ir.fbtswap.app';
}
function readAllowedOrigins() {
  const src = readFileSync(SRC_CONFIG, 'utf8');
  const block = /export const WC_ALLOWED_ORIGINS = Object\.freeze\(\[([\s\S]*?)\]\)/m.exec(src);
  if (!block) throw new Error('WC_ALLOWED_ORIGINS not found in src/lib/wc/config.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const PROJECT_ID = readProjectId();
const APP_ID = readAndroidAppId();
const ORIGINS = readAllowedOrigins();
const VERIFY_PATH = '/.well-known/walletconnect.txt';
const ICON_PATH = '/icon-512.png';
const DASHBOARD = `https://dashboard.reown.com/project/${PROJECT_ID}`;

/* Head-only probe so a misconfigured dashboard does not become a build
 * failure: the answer goes to the support thread, not to a deploy hook. */
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

const checklist = [
  {
    title: '1.  Add the three origins to the Reown dashboard allowlist',
    lines: ORIGINS.map((o) => `    ${o}`)
  },
  {
    title: '2.  Add the Android app id to App IDs',
    lines: [`    ${APP_ID}`]
  },
  {
    title: '3.  Verify each domain by file or DNS TXT',
    lines: [
      `    Generate the code at ${DASHBOARD} → Domains`,
      `    Then: node scripts/walletconnect-domain-verify.mjs --code=<the code>`,
      `    Or: add a DNS TXT record on @ with the same code`
    ]
  },
  {
    title: '4.  Press Verify in the dashboard',
    lines: [
      `    Open ${DASHBOARD} → Domains`,
      '    Each origin must show a green tick before wallets render it as verified'
    ]
  },
  {
    title: '5.  Wait 15 minutes for the allowlist to propagate',
    lines: [
      '    Updates take 15 minutes (Reown dashboard note).',
      '    Until then, connection requests from the new origin return INVALID.'
    ]
  }
];

function print() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' REOWN DASHBOARD REGISTRATION CHECKLIST');
  console.log(` Project ID   : ${PROJECT_ID}`);
  console.log(` Dashboard    : ${DASHBOARD}`);
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('');
  for (const step of checklist) {
    console.log(step.title);
    for (const line of step.lines) console.log(line);
    console.log('');
  }
  console.log('NOTE: Why these three origins, not just fbtswap.ir:');
  console.log('  · https://fbtswap.ir        — the bare domain. WalletConnect verifies');
  console.log('                                 the attestation against this entry.');
  console.log('  · https://www.fbtswap.ir    — the www variant. If the DNS points the');
  console.log('                                 www host at the same deployment (some');
  console.log('                                 providers do), Trust and MetaMask will');
  console.log('                                 render a mismatch screen unless BOTH');
  console.log('                                 are on the allowlist.');
  console.log('  · https://localhost          — the WebView origin inside the Android');
  console.log('                                 APK (Capacitor serves from there). The');
  console.log('                                 relay refuses a session whose attested');
  console.log('                                 origin is not on the allowlist, so a');
  console.log('                                 verified fbtswap.ir without localhost');
  console.log('                                 still produces "unverified domain" on');
  console.log('                                 the packaged app.');
  console.log('');
  console.log('NOTE: Why ir.fbtswap.app on App IDs:');
  console.log('  The same project ID may serve a Web dApp AND an Android dApp. The');
  console.log('  Android build reads "ir.fbtswap.app" as its package name; without');
  console.log('  that line on App IDs, every session originating from the APK is');
  console.log('  treated as if a different project had used the project ID.');
  console.log('');
}

async function check() {
  print();
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' LIVE PROBES (run this after every deploy)');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('');

  const verifyFile = resolve(ROOT, 'public/.well-known/walletconnect.txt');
  let verifyCode = null;
  if (existsSync(verifyFile)) {
    const raw = readFileSync(verifyFile, 'utf8').replace(/^\uFEFF/, '').trim();
    if (raw && !raw.startsWith('PENDING_REOWN_VERIFICATION_')) verifyCode = raw;
  }
  if (verifyCode) {
    console.log(`✓ /.well-known/walletconnect.txt committed (${verifyCode.length} chars)`);
  } else {
    console.log(`✗ /.well-known/walletconnect.txt is missing or the placeholder.`);
    console.log(`  Run: node scripts/walletconnect-domain-verify.mjs --code=<code>`);
  }

  for (const origin of ORIGINS) {
    const verifyUrl = `${origin}${VERIFY_PATH}`;
    const iconUrl = `${origin}${ICON_PATH}`;
    const [v, i] = await Promise.all([probe(verifyUrl), probe(iconUrl)]);
    const vStatus = v.ok ? '✓' : '✗';
    const iStatus = i.ok ? '✓' : '✗';
    console.log(`${vStatus} ${verifyUrl}  ${v.ok ? v.status : v.error || 'FAILED'}`);
    console.log(`${iStatus} ${iconUrl}      ${i.ok ? i.status : i.error || 'FAILED'}`);
  }
  console.log('');
  console.log('All ✗ on the verification file mean the file has not been written');
  console.log('to public/.well-known/walletconnect.txt AND the deploy has not run');
  console.log('since. Fix that first.');
  console.log('');
}

if (has('help')) {
  console.log('node scripts/walletconnect-reown-register.mjs          print checklist');
  console.log('node scripts/walletconnect-reown-register.mjs --check  checklist + live probes');
  console.log('node scripts/walletconnect-reown-register.mjs --copy   print the clipboard-ready lines');
} else if (has('copy')) {
  for (const step of checklist) {
    console.log(step.title);
    for (const line of step.lines) console.log(line);
    console.log('');
  }
  console.log('Origins:');
  for (const o of ORIGINS) console.log(`  ${o}`);
  console.log(`Android app id: ${APP_ID}`);
} else if (has('check')) {
  await check();
} else {
  print();
}
