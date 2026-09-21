#!/usr/bin/env node
/**
 * WRITE THE WALLETCONNECT VERIFICATION FILE FROM AN ENV VAR.
 * ---------------------------------------------------------------------------
 * Reown's dashboard issues a verification code when a domain is added to the
 * project's allowlist; the verifier reads `/.well-known/walletconnect.txt`
 * from each allowlisted origin and compares its bytes to that code. Wrong
 * file = "Unverified" in every wallet.
 *
 * As of 2026 WalletConnect dropped DNS TXT support, so the file method is
 * the ONLY one. This script is the CI step that writes the file from an env
 * var (Vercel env, GitHub Actions secret, GitLab CI variable …) so the code
 * never has to live in git and the file is correct on every deploy.
 *
 * Two env vars are honoured, in order:
 *   WALLETCONNECT_VERIFY_CODE   raw code from dashboard.reown.com → Domains
 *   WALLETCONNECT_VERIFY_FILE   path to a file whose contents are the code
 * The file form is the GitHub-Actions-friendly variant: encode the code as
 * a base64 single-line secret and let the workflow decode it on the runner.
 *
 * Without either var the build proceeds; the placeholder ships with the
 * source so `npm run build` produces a working artefact (just not a
 * verified one). That is the right default for local development.
 *
 * Exit codes:
 *   0   file written, or skipped (no var)
 *   1   var present but malformed (the build SHOULD fail here)
 *   2   could not write to `public/.well-known/walletconnect.txt`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FILE = resolve(ROOT, 'public', '.well-known', 'walletconnect.txt');

/* Same shape as `scripts/walletconnect-domain-verify.mjs` so the build-time
 * guard and the runtime check cannot disagree. */
const LOOKS_LIKE_CODE = /^[A-Za-z0-9._~-]{16,512}$/;

function readCode() {
  const raw = (process.env.WALLETCONNECT_VERIFY_CODE || '').trim();
  if (raw) return raw;
  const file = (process.env.WALLETCONNECT_VERIFY_FILE || '').trim();
  if (file && existsSync(file)) {
    return readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  }
  return '';
}

function main() {
  let raw = readCode();
  if (!raw) {
    /* Quietly allow builds without a code: local dev, preview deployments
     * that do not need Verify, and the placeholder-pipeline case where the
     * file is going to be overwritten on first production deploy. */
    console.log('[walletconnect-verify] no WALLETCONNECT_VERIFY_CODE; shipping placeholder.');
    return 0;
  }

  /* Strip prefixes the dashboard sometimes appends when the value is copied
   * through copy-to-clipboard ("verify code: …") or the docs prefix the value
   * with "wc-verify:". A trailing " (foo)" annotation is also stripped —
   * the verifier only reads the first line. */
  raw = raw.split(/\r?\n/)[0].trim();
  raw = raw.replace(/^verify\s*code\s*[:：]\s*/i, '').replace(/^wc-verify:\s*/i, '').trim();

  if (process.env.WALLETCONNECT_VERIFY_VALIDATE !== 'false' && !LOOKS_LIKE_CODE.test(raw)) {
    console.error(`[walletconnect-verify] WALLETCONNECT_VERIFY_CODE does not look like a Reown code (length=${raw.length}).`);
    console.error('  Copy the whole value from dashboard.reown.com → Domains → verify, not the row label.');
    return 1;
  }

  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, `${raw}\n`, 'utf8');
    console.log(`[walletconnect-verify] wrote ${FILE} (${raw.length} chars)`);
    return 0;
  } catch (error) {
    console.error(`[walletconnect-verify] failed to write ${FILE}:`, error?.message || error);
    return 2;
  }
}

process.exit(main());
