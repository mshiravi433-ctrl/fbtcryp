#!/usr/bin/env node
/**
 * WALLETCONNECT VERIFY READINESS — the registry, measured, and ONE verdict.
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
 *  · Then it printed facts and a prediction, which was better — but it ignored
 *    the `--check` flag `npm run walletconnect:check` passes it, so the gate
 *    this repository documents always exited 0. A diagnostic that cannot fail
 *    is a diagnostic that says «healthy» about a broken deployment.
 *
 * What it does now: measures, then hands every measurement to the one engine
 * the app itself uses (`src/lib/wc/diagnostics.js`) and prints ITS verdict —
 * one of OK, ORIGIN_MISMATCH, DOMAIN_NOT_REGISTERED, VERIFY_SERVICE_UNREACHABLE,
 * PROJECT_ID_MISMATCH, METADATA_MISMATCH, RELAY_UNREACHABLE,
 * SDK_CONFIGURATION_ERROR — together with CODE STATUS and DASHBOARD STATUS, so
 * «the code is right and the dashboard is not» can never be read as «the code
 * is wrong».
 *
 * ─── FLAGS ──────────────────────────────────────────────────────────────────
 *   --check              exit non-zero unless the verdict is OK (this is what
 *                        `npm run walletconnect:check` runs)
 *   --strict             alias of --check
 *   --origin=<url>       the origin under test (default https://fbtswap.ir)
 *   --packaged           treat the origin as the Capacitor WebView
 *                        (https://localhost), which declares the canonical
 *                        public origin instead of its own
 *   --json               print the raw report instead of the lines
 *   --timeout=<ms>       per-probe bound (default 8000)
 *
 * A browser is not required and is not simulated: the attestation probe needs a
 * document to hang the SDK's iframe on, so outside a browser the report says
 * `attestation not measured` and the verdict is derived from the registry, the
 * relay and the enclave — which is exactly what CI can measure.
 */

import { WC_PROJECT_ID, WC_ALLOWED_ORIGINS } from '../src/lib/wc/config.js';
import { reownDashboardUrl, VERIFY_SERVER, VERIFY_SERVER_V3 } from '../src/lib/wc/verify.js';
import { collectWalletConnectDiagnosis, diagnosisLines } from '../src/lib/wc/diagnostics.js';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const isGate = has('check') || has('strict');
const asJson = has('json');
const ORIGIN = value('origin') || 'https://fbtswap.ir';
const TIMEOUT = Number(value('timeout')) || 8_000;

/*
 * THE VIEW THE ORIGIN WOULD HAVE IN A BROWSER.
 *
 * `metadata.url` is derived from `window.location.origin`, so a run that passes
 * only an origin would compare the browser's answer against the canonical
 * constant — and then report ORIGIN_MISMATCH for a page that is behaving
 * perfectly. `--origin=https://www.fbtswap.ir` means «as if the page were served
 * there», so the view is built to match. `--packaged` is the one case where the
 * page origin is deliberately NOT the declared identity.
 */
const view = {
  location: { origin: ORIGIN },
  Capacitor: { isNativePlatform: () => has('packaged') }
};

const report = await collectWalletConnectDiagnosis({
  origin: ORIGIN,
  projectId: WC_PROJECT_ID,
  timeoutMs: TIMEOUT,
  win: view,
  /* No document exists here (this is Node), so the attestation half is reported
     as not measured rather than as a failure. */
  includeAttestation: false
});

const verdict = report.diagnosis ?? { code: 'NOT_MEASURED', owner: 'UNKNOWN' };

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('WalletConnect Verify readiness');
  console.log('------------------------------');
  console.log(`Dashboard         : ${reownDashboardUrl(WC_PROJECT_ID)}`);
  console.log(`Origin under test : ${ORIGIN}`);
  console.log(`Enclave           : ${VERIFY_SERVER_V3} (SDK host: ${VERIFY_SERVER})`);
  console.log(`Relay hosts       : ${(report.relay?.urls ?? []).join(', ')}`);
  console.log('');
  console.log('Registry (project domain allowlist)');
  if (!report.registry?.readable) {
    console.log(`  ⚠️  unreadable${report.registry?.status ? ` — HTTP ${report.registry.status}` : ''}${report.registry?.error ? ` — ${report.registry.error}` : ''}`);
  } else if (!report.registry.list?.length) {
    console.log('  ❌ EMPTY — no domain is allowlisted on this project.');
  } else {
    for (const entry of report.registry.list) {
      console.log(`  · ${entry}${report.allowedOrigins?.originAllowed ? '   ← covers the origin under test' : ''}`);
    }
  }
  console.log('');
  console.log('Metadata the wallet receives');
  console.log(`  url       = ${report.metadata?.url ?? '—'}`);
  console.log(`  verifyUrl = ${report.metadata?.verifyUrl || '—'}`);
  console.log(`  icons[0]  = ${report.metadata?.icons?.[0] || '—'}`);
  console.log('');
  console.log('Measured facts');
  for (const line of diagnosisLines(report)) console.log(`  ${line}`);
  console.log('');
  console.log(`Verdict: ${verdict.code}`);
  console.log(`  owner: ${verdict.owner}`);
  console.log(`  ${verdict.sentence ?? ''}`);
  if (verdict.problems?.length) console.log(`  problems: ${verdict.problems.join(', ')}`);
  console.log('');
  console.log('Expected on this project (from src/lib/wc/config.js):');
  for (const origin of WC_ALLOWED_ORIGINS) console.log(`  · ${origin}`);
  console.log('');

  if (verdict.code !== 'OK' && verdict.owner === 'DASHBOARD') {
    console.log('Fix (a human click — no code can do it):');
    console.log(`  1. ${reownDashboardUrl(WC_PROJECT_ID)}`);
    console.log('  2. Configuration → Domain → “+ Domain”');
    console.log(`  3. ${ORIGIN}  (with the scheme, no trailing slash) → Allowlist`);
    console.log('  4. Wait up to 5 minutes, clear the old session in the wallet, reconnect.');
    console.log('');
  }
  if (verdict.owner === 'CODE' || verdict.owner === 'CODE_OR_CONFIG') {
    console.log('Fix (this one IS in the repository — see src/lib/wc/config.js):');
    console.log('  · metadata.url must equal the origin the page is served from');
    console.log('  · the project id must be the project the Reown API knows');
    console.log('  · run this script in a browser page context for the attestation half');
    console.log('');
  }
}

process.exitCode = isGate ? (verdict.code === 'OK' ? 0 : 1) : 0;
