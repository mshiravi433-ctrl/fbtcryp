#!/usr/bin/env node
/**
 * TEST THE FIREBASE CREDENTIALS — offline first, then live.
 *
 *   node scripts/test-fcm.mjs
 *
 * Reads FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 * from the environment (or a local .env) and checks them in stages, so a
 * failure tells you WHICH value is wrong instead of one opaque error.
 *
 * Stages:
 *   1. present?          — is each variable set at all
 *   2. well-formed?      — PEM markers, the \n problem, e-mail/project shape
 *   3. can it sign?      — RS256 with the actual key, locally, no network
 *   4. does Google accept it? — exchanges the JWT for an access token
 *
 * Stage 3 is the important one. It catches the single most common mistake —
 * a private key whose "\n" sequences were stripped or converted — without
 * needing any network access, and it cannot be confused with a firewall
 * problem.
 */

import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

/* Load .env if present, without adding a dependency. */
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';
const RAW_KEY = process.env.FIREBASE_PRIVATE_KEY || '';
const KEY = RAW_KEY.replace(/\\n/g, '\n');

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

let failed = false;
const fail = (m, hint) => {
  failed = true;
  bad(m);
  if (hint) info(`→ ${hint}`);
};

console.log('\n── 1. variables present ──────────────────────────');

if (!PROJECT_ID) fail('FIREBASE_PROJECT_ID is not set');
else ok(`FIREBASE_PROJECT_ID = ${PROJECT_ID}`);

if (!CLIENT_EMAIL) fail('FIREBASE_CLIENT_EMAIL is not set');
else ok(`FIREBASE_CLIENT_EMAIL = ${CLIENT_EMAIL}`);

// Never print the key. Length alone is enough to diagnose.
if (!RAW_KEY) fail('FIREBASE_PRIVATE_KEY is not set');
else ok(`FIREBASE_PRIVATE_KEY is set (${RAW_KEY.length} characters)`);

if (failed) {
  console.log('\nSet the missing values and run again.\n');
  process.exit(1);
}

console.log('\n── 2. shape ──────────────────────────────────────');

if (!CLIENT_EMAIL.endsWith('.iam.gserviceaccount.com')) {
  fail(
    'CLIENT_EMAIL does not look like a service account',
    'It should end with .iam.gserviceaccount.com — you may have used your own Google address.'
  );
} else ok('client email looks like a service account');

if (CLIENT_EMAIL.includes('@') && !CLIENT_EMAIL.includes(PROJECT_ID)) {
  fail(
    'CLIENT_EMAIL does not mention PROJECT_ID',
    'These two are probably from different Firebase projects.'
  );
} else ok('client email matches the project id');

if (!KEY.includes('-----BEGIN PRIVATE KEY-----')) {
  fail(
    'private key has no BEGIN marker',
    'Copy the whole private_key value from the JSON, including the -----BEGIN/END----- lines. Do not include the surrounding quotes.'
  );
} else ok('private key has BEGIN/END markers');

/*
 * THE CLASSIC FAILURE.
 * Dashboards cannot hold a real newline in a single-line field, so the key is
 * stored with literal "\n". If those get stripped the key becomes one long
 * line, still looks plausible, and fails later with "invalid_grant" — which
 * says nothing about newlines.
 */
const realNewlines = (KEY.match(/\n/g) || []).length;
if (realNewlines < 3) {
  fail(
    `private key has only ${realNewlines} line breaks — it is malformed`,
    'The \\n sequences were removed. Re-copy the value from the JSON exactly as it appears, leaving every \\n in place.'
  );
} else ok(`private key has ${realNewlines} line breaks`);

console.log('\n── 3. can it sign? (local, no network) ───────────');

let keyObject = null;
try {
  keyObject = crypto.createPrivateKey(KEY);
  ok(`key parsed — ${keyObject.asymmetricKeyType.toUpperCase()} ${keyObject.asymmetricKeyDetails?.modulusLength || ''} bit`);
} catch (e) {
  fail(`key could not be parsed: ${e.message}`, 'The key is corrupt or truncated. Generate a fresh JSON key in Google Cloud console.');
}

if (keyObject) {
  try {
    const s = crypto.createSign('RSA-SHA256');
    s.update('test');
    const sig = s.sign(keyObject, 'base64');
    ok(`RS256 signature produced (${sig.length} chars) — the key WORKS`);
  } catch (e) {
    fail(`signing failed: ${e.message}`);
  }
}

if (failed) {
  console.log('\nFix the above before testing against Google.\n');
  process.exit(1);
}

console.log('\n── 4. does Google accept it? (live) ──────────────');

const b64url = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

try {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(KEY, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${sig}`
    })
  });

  const body = await res.json().catch(() => ({}));

  if (res.ok && body.access_token) {
    ok('Google issued an access token — the credentials are VALID');
    info(`token expires in ${body.expires_in}s`);
    console.log('\n\x1b[32mAll checks passed. FCM is ready.\x1b[0m\n');
  } else {
    const err = body.error || `HTTP ${res.status}`;
    const desc = body.error_description || '';
    bad(`Google rejected the credentials: ${err}`);
    if (desc) info(desc);

    // Map Google's terse errors onto the thing that is actually wrong.
    if (err === 'invalid_grant') {
      info('→ Usually one of:');
      info('   • the key was deleted in Google Cloud console');
      info('   • the \\n sequences were altered (see stage 2)');
      info('   • the device clock is wrong by more than a few minutes');
    } else if (err === 'invalid_client') {
      info('→ CLIENT_EMAIL does not match a service account on this project.');
    } else if (String(res.status) === '403') {
      info('→ Enable the Firebase Cloud Messaging API for this project.');
    }
    console.log('');
    process.exit(1);
  }
} catch (e) {
  bad(`could not reach Google: ${e.message}`);
  info('→ This is a network problem, not a credentials problem.');
  info('   Stages 1-3 already passed, so the key itself is well-formed.');
  console.log('');
  process.exit(1);
}
