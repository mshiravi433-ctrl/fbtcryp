#!/usr/bin/env node
/**
 * REOWN CLOUD ALLOWLIST CHECKLIST — Verify API reality check.
 * ---------------------------------------------------------------------------
 * History: this script used to also write `/.well-known/walletconnect.txt`
 * from a dashboard-generated code, because we believed the WalletConnect
 * Verify API worked that way. The 2025-08-27 Reown blog
 * (https://walletconnect.com/blog/protect-users-from-phishing-with-walletconnect-verify-api-for-web3-apps-and-wallets)
 * says otherwise: the Verify API "no longer requires manual domain listing
 * in the Cloud dashboard. Instead, it now automatically determines and
 * checks your app's domain when a wallet connects." There is no verification
 * code, no `walletconnect.txt`, and no DNS TXT — the Enclave reads origin
 * from `window.message` and matches it against `metadata.url`.
 *
 * What the dashboard still controls is the App IDs list, which is what
 * unlocks an Android packaged build (the WebView at `https://localhost`)
 * with the same project id. Without `ir.fbtswap.app` registered there, the
 * APK's sessions render as the project id was misused by a foreign app.
 *
 * So this script prints, in clipboard-ready form:
 *   · the three origins the SDK can ever be served from
 *   · the Android app id the dashboard MUST register
 * and (with `--check`) does a HEAD on each origin to confirm the page is
 * reachable from the host running the script — which is the only deploy
 * signal the script can read from a CI machine.
 *
 * Nothing in this script registers anything in the dashboard: the App IDs
 * UI is a manual click on dashboard.reown.com. The script prints the exact
 * values, so the click takes seconds.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';

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

const ICON_PATH = '/icon-512.png';
const DASHBOARD = `https://dashboard.reown.com/project/${PROJECT_ID}`;

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

const checklist = [
  {
    title: '1.  Confirm the SDK ships `metadata.url` = each of these origins',
    body: `walletIdentityUrl() in src/lib/wc/config.js returns one of these based on the running origin:\n\n${ORIGINS.map((o) => `    ${o}`).join('\n')}\n\nIf the served origin is NOT one of these, the Verify Enclave cannot attest it and the wallet shows the verdict UNKNOWN.`
  },
  {
    title: '2.  Add the Android app id to App IDs (required for the APK)',
    body: `Dashboard → your project → App IDs:\n\n    ${APP_ID}\n\nWithout this entry, every session originating from the packaged APK renders the same UNKNOWN verdict, regardless of how the Web origin is set up. The packaged WebView is served at https://localhost, which is on the SDK's allowed list above, but the App ID is what binds the same project id to the package.`
  },
  {
    title: '3.  There is no file to upload — Verify API is attestation-only',
    body: 'Since 2025-08-27 the Reown Cloud dashboard no longer asks for a verification code, a `walletconnect.txt` upload, or a DNS TXT record. Skip straight to step 4.'
  },
  {
    title: '4.  Test the deployment in a real browser, not on localhost',
    body: `The Verify Enclave reads \`event.origin\` from a \`window.message\` posted by the Verify Client. APK WebViews and Node/CLI dApps never post that message, so a Trust Wallet connection opened from inside the APK WebView at \`https://localhost\` will always show UNKNOWN — that is a spec gap, not a bug.\n\nOpen https://fbtswap.ir in Chrome/Safari with Trust Wallet installed, tap the connection button, and confirm the prompt shows the verified domain.`
  }
];

function print() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' REOWN CLOUD ALLOWLIST CHECKLIST');
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

  for (const origin of ORIGINS) {
    const [icon] = await Promise.all([probe(`${origin}${ICON_PATH}`)]);
    const status = icon.ok ? '✓' : '✗';
    console.log(`${status} ${origin.padEnd(28)} icon=${icon.ok ? icon.status : icon.error || 'FAILED'}`);
  }

  console.log('');
  console.log('A green icon probe means the page is reachable from this host. The');
  console.log('Enclave then attests the origin it sees in `window.message` against');
  console.log('`metadata.url`; if they match, the wallet renders VALID.');
  console.log('');
}

if (has('help')) {
  console.log('node scripts/walletconnect-reown-register.mjs          print checklist');
  console.log('node scripts/walletconnect-reown-register.mjs --check  checklist + live probes');
  console.log('node scripts/walletconnect-reown-register.mjs --copy   print the clipboard-ready lines');
} else if (has('copy')) {
  for (const origin of ORIGINS) console.log(origin);
  console.log(`App ID: ${APP_ID}`);
} else if (has('check')) {
  await check();
} else {
  print();
}
