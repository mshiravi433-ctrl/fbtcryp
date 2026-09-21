#!/usr/bin/env node
/**
 * PROVE fbtswap.ir IS OURS TO REOWN — the file half of domain verification.
 * ---------------------------------------------------------------------------
 * Asked for: «والت می‌گوید این dApp به نظر می‌رسد کلاهبرداری باشد».
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * Every wallet that speaks WalletConnect renders one of four verdicts from the
 * Verify API:
 *
 *   Domain match (VALID)   the domain is registered to this dApp AND the
 *                          origin that opened the socket matches it
 *   Unverified (UNKNOWN)   nothing is registered for this origin
 *   Mismatch  (INVALID)    the app claims one domain and connects from another
 *   Threat     (isScam)    the domain is on a malicious-domain feed
 *
 * UNKNOWN is not an accusation, but it is the state a brand-new domain sits in
 * forever until somebody proves ownership, and several wallets turn it into a
 * caution screen the user reads as «این سایت ناشناس است» — the sentence in the
 * report. Registration happens in the Reown dashboard; the PROOF of ownership
 * is either a DNS TXT record or a file at a fixed path:
 *
 *     https://fbtswap.ir/.well-known/walletconnect.txt
 *
 * Vite copies `public/` verbatim, so a file written here ships with the next
 * build and deploys with the code that depends on it — which is the whole
 * reason this is a script and not a note in a document telling somebody to
 * paste a code into a build by hand.
 *
 * ─── HOW TO USE IT ──────────────────────────────────────────────────────────
 *   1. dashboard.reown.com → your project → Domains → add `https://fbtswap.ir`
 *      (protocol included, NO trailing slash) → choose the file method.
 *   2. Copy the verification code the dashboard generates.
 *   3. node scripts/walletconnect-domain-verify.mjs --code=<code>
 *   4. Deploy, then node scripts/walletconnect-domain-verify.mjs --check
 *   5. Back in the dashboard, press Verify.
 *
 * The DNS alternative, if the file route is unavailable: a TXT record on the
 * root (`@`) whose value is the same code. Either proof is accepted; do not do
 * both with different codes.
 *
 * This script never fails a build unless it is asked to: `--strict` turns the
 * check into an exit code, and nothing else does.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const FILE = 'public/.well-known/walletconnect.txt';
const PUBLIC_URL = 'https://fbtswap.ir/.well-known/walletconnect.txt';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}`) || args.find((a) => a.startsWith(`--${name}=`));
const valueOf = (name) => {
  const hit = flag(name);
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq === -1 ? '' : hit.slice(eq + 1).trim();
};

/** What Reown's codes look like. A paste that lost half its characters is the
 *  common failure, and it fails as "domain not verified" hours later, so it is
 *  caught here instead. */
const LOOKS_LIKE_CODE = (text) => /^[A-Za-z0-9._~-]{16,512}$/.test(text);

function writeCode(code) {
  if (!code) {
    console.error('✗ no code given. Usage: node scripts/walletconnect-domain-verify.mjs --code=<code>');
    process.exit(1);
  }
  if (!LOOKS_LIKE_CODE(code)) {
    console.error(`✗ that does not look like a Reown verification code (${code.length} chars).`);
    console.error('  Copy the whole value from dashboard.reown.com → Domains → verify.');
    process.exit(1);
  }
  mkdirSync(dirname(FILE), { recursive: true });
  // Exactly the code and one newline: the verifier compares the file's content,
  // and an editor that "helpfully" adds a second newline or an UTF-8 BOM makes
  // the comparison fail with no useful error.
  writeFileSync(FILE, `${code}\n`, 'utf8');
  console.log(`✓ wrote ${FILE} (${code.length} chars)`);
  console.log('  Next: deploy, then run --check, then press Verify in the dashboard.');
  // Tell the user, explicitly, which origins should be registered alongside
  // — every origin the dApp might run on must be on the allowlist, otherwise
  // a page served from one of them is reported as INVALID even though the
  // canonical host is verified.
  console.log('');
  console.log('  Reminder: the Reown dashboard must also contain these allowlist entries');
  console.log('  (otherwise the corresponding page reads as INVALID even after this file lands):');
  console.log('    https://fbtswap.ir');
  console.log('    https://www.fbtswap.ir');
  console.log('    https://localhost');
  console.log('    App IDs → ir.fbtswap.app');
  console.log('  See scripts/walletconnect-reown-register.mjs for the full checklist.');
}

function check() {
  if (!existsSync(FILE)) {
    console.log(`✗ ${FILE} does not exist.`);
    console.log('  Until a code is written here (or a DNS TXT record is set), wallets');
    console.log('  show this dApp as UNVERIFIED — which several of them render as a');
    console.log('  security caution. See docs/WALLET-SCAM-WARNING-FA.md.');
    return false;
  }
  const raw = readFileSync(FILE, 'utf8');
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (text.startsWith('PENDING_REOWN_VERIFICATION_')) {
    console.log(`✗ ${FILE} is the placeholder shipped by source.`);
    console.log('  Until the Reown-generated code is written here, wallets show');
    console.log('  this dApp as UNVERIFIED — which several render as a security caution.');
    console.log('  Run: node scripts/walletconnect-domain-verify.mjs --code=<code>');
    console.log('  (or set a DNS TXT record — same code, same dashboard check).');
    console.log(`  served at: ${PUBLIC_URL}`);
    return false;
  }
  const ok = LOOKS_LIKE_CODE(text);
  console.log(`${ok ? '✓' : '✗'} ${FILE}`);
  console.log(`  length: ${text.length}  trailing newlines: ${(raw.match(/\n+$/) || [''])[0].length || 0}`);
  if (!ok) {
    console.log('  The content does not look like a verification code — re-run --code=<code>.');
  }
  console.log(`  served at: ${PUBLIC_URL}`);
  console.log('  (a deployed site is the only proof that counts: the dashboard fetches this URL)');
  return ok;
}

if (flag('help') !== undefined) {
  console.log('node scripts/walletconnect-domain-verify.mjs --code=<code>   write the file');
  console.log('node scripts/walletconnect-domain-verify.mjs --check        inspect it');
  console.log('node scripts/walletconnect-domain-verify.mjs --check --strict  exit 1 when it is missing');
} else if (flag('code') !== undefined) {
  writeCode(valueOf('code'));
} else {
  // Default action: report. --strict turns the answer into an exit code, and
  // only --strict does — a missing verification file must never block a deploy.
  const ok = check();
  if (flag('strict') !== undefined && !ok) process.exit(1);
}
