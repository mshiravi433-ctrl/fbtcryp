#!/usr/bin/env node
/**
 * /.well-known/assetlinks.json — the file that makes the APK's identity checkable.
 * ---------------------------------------------------------------------------
 * «سایت ما را فانتوم مخرب شناخته» is three different warnings, and this file is
 * the whole fix for one of them.
 *
 * Phantom verifies a native Android dApp by fetching
 *
 *     https://<the domain the app claims>/.well-known/assetlinks.json
 *
 * and matching our package name and the SHA-256 of our SIGNING certificate
 * against the statements in it (docs.phantom.com → «Domain and transaction
 * warnings»; the format is Android's Digital Asset Links, and the same file is
 * what Mobile Wallet Adapter's dapp-identity spec reads). When the file is
 * missing — as it was — Phantom cannot verify us and renders
 *
 *     «This app's identity could not be verified. It may be impersonating
 *      another app.»
 *
 * ─── WHY THE FINGERPRINT CANNOT BE COMMITTED BLIND ──────────────────────────
 * The value has to be the fingerprint of the certificate the shipped APK is
 * actually signed with. Guessing it, or committing a debug-keystore
 * fingerprint, produces a file that verifies nothing while looking like it
 * does — worse than no file, because the next person believes the step is
 * done. So this script takes the fingerprint from the keystore itself and
 * refuses to write a placeholder.
 *
 * ─── USAGE ──────────────────────────────────────────────────────────────────
 *   # from the release keystore (the same one CI signs with):
 *   node scripts/assetlinks.mjs \
 *     --keystore=/secrets/release.jks --storepass=… --alias=… [--keypass=…]
 *
 *   # or from a fingerprint you already have (Play Console → Play app signing):
 *   node scripts/assetlinks.mjs --fingerprint=AA:BB:CC:…
 *   FBT_ANDROID_SHA256=AA:BB:… node scripts/assetlinks.mjs
 *
 *   # verify what is committed / deployed:
 *   node scripts/assetlinks.mjs --check
 *
 * With Play App Signing, use the **app signing key** certificate from the Play
 * Console (Protected with Play → Manage Play app signing), not the upload key —
 * a mismatched fingerprint is the single most common reason this verification
 * fails, per Phantom's own documentation.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/.well-known/assetlinks.json');
const SHA_RE = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/;

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const has = (name) => process.argv.includes(`--${name}`);

/** The package name the APK is built with — read, not retyped. */
function packageName() {
  const fromManifest = arg('package');
  if (fromManifest) return fromManifest;
  try {
    const cfg = JSON.parse(readFileSync(resolve(ROOT, 'capacitor.config.json'), 'utf8'));
    if (cfg.appId) return cfg.appId;
  } catch {
    /* fall through to the error below */
  }
  throw new Error('no appId in capacitor.config.json and no --package given');
}

function normalise(raw) {
  const value = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
  return SHA_RE.test(value) ? value : null;
}

/** Every SHA-256 certificate fingerprint `keytool` reports for a keystore. */
function fingerprintsFromKeystore(path, storepass, alias, keypass) {
  const args = ['keytool', ['-list', '-v', `-keystore`, path, `-storepass`, storepass]];
  if (alias) args[1].push('-alias', alias);
  if (keypass) args[1].push('-keypass', keypass);
  const res = spawnSync(args[0], args[1], { encoding: 'utf8' });
  if (res.error) throw new Error(`keytool could not run: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`keytool failed (${res.status}): ${String(res.stderr || res.stdout).trim().split('\n')[0]}`);
  }
  const out = [...res.stdout.matchAll(/SHA256:\s*([0-9A-Fa-f:]{95})/g)].map((m) => normalise(m[1]));
  const unique = [...new Set(out.filter(Boolean))];
  if (!unique.length) throw new Error('keytool reported no SHA256 fingerprint for that keystore');
  return unique;
}

function collect() {
  const keystore = arg('keystore');
  if (keystore) {
    const storepass = arg('storepass') ?? process.env.ANDROID_KEYSTORE_PASSWORD;
    if (!storepass) throw new Error('--keystore needs --storepass (or ANDROID_KEYSTORE_PASSWORD)');
    return fingerprintsFromKeystore(keystore, storepass, arg('alias') ?? process.env.ANDROID_KEYSTORE_ALIAS, arg('keypass'));
  }
  const raw = [
    ...process.argv.filter((a) => a.startsWith('--fingerprint=')).map((a) => a.slice('--fingerprint='.length)),
    ...(process.env.FBT_ANDROID_SHA256 ? process.env.FBT_ANDROID_SHA256.split(/[,\s]+/) : [])
  ];
  const list = raw.map(normalise);
  const bad = list.find((v) => v === null);
  if (bad !== undefined) {
    throw new Error('a fingerprint must be 32 hex pairs, e.g. AA:BB:CC:… (31 colons)');
  }
  const unique = [...new Set(list)];
  if (!unique.length) {
    throw new Error('nothing to write: pass --keystore, --fingerprint=…, or set FBT_ANDROID_SHA256');
  }
  return unique;
}

const document = (pkg, fingerprints) => [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: pkg,
      sha256_cert_fingerprints: fingerprints
    }
  }
];

/* ── --check: is what is on disk (and therefore on the domain) correct? ──── */
if (has('check')) {
  if (!existsSync(OUT)) {
    console.error(`✗ ${OUT} does not exist.`);
    console.error('  Phantom will answer «this app\u2019s identity could not be verified».');
    console.error('  Fix: npm run assetlinks -- --keystore=<release.jks> --storepass=… --alias=…');
    process.exit(1);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch (error) {
    console.error(`✗ ${OUT} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  const problems = [];
  if (!Array.isArray(parsed)) problems.push('the file must be a JSON array');
  const pkg = packageName();
  const entries = Array.isArray(parsed) ? parsed : [];
  if (!entries.length) problems.push('the array is empty');
  for (const [i, entry] of entries.entries()) {
    const t = entry?.target ?? {};
    if (t.namespace !== 'android_app') problems.push(`[${i}] target.namespace must be "android_app"`);
    if (t.package_name !== pkg) problems.push(`[${i}] package_name is ${t.package_name}, expected ${pkg}`);
    const fps = t.sha256_cert_fingerprints;
    if (!Array.isArray(fps) || !fps.length) problems.push(`[${i}] no sha256_cert_fingerprints`);
    else for (const fp of fps) if (!normalise(fp)) problems.push(`[${i}] ${fp} is not a SHA-256 fingerprint`);
    if (!Array.isArray(entry?.relation) || !entry.relation.includes('delegate_permission/common.handle_all_urls')) {
      problems.push(`[${i}] relation must include delegate_permission/common.handle_all_urls`);
    }
  }
  if (problems.length) {
    console.error(`✗ ${OUT} is present but wrong:`);
    for (const problem of problems) console.error(`  · ${problem}`);
    process.exit(1);
  }
  console.log(`✓ ${OUT}`);
  console.log(`  package ${pkg} · ${entries[0].target.sha256_cert_fingerprints.length} fingerprint(s)`);
  console.log('  Deploy it, then confirm: curl --fail https://fbtswap.ir/.well-known/assetlinks.json');
  process.exit(0);
}

/* ── write ─────────────────────────────────────────────────────────────────── */
let pkg = null;
let fingerprints = null;
try {
  pkg = packageName();
  fingerprints = collect();
} catch (error) {
  /* A usage error is a sentence, not a stack trace: this script is run by
     whoever is holding the keystore, and the fix is in the message. */
  console.error(`✗ ${error.message}`);
  console.error('  See the header of this file for the three ways to supply a fingerprint.');
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(document(pkg, fingerprints), null, 2)}\n`);
console.log(`✓ wrote ${OUT}`);
console.log(`  package   ${pkg}`);
for (const fp of fingerprints) console.log(`  sha256    ${fp}`);
console.log('\nNext: commit and deploy it, then check the live copy —');
console.log('  node scripts/assetlinks.mjs --check');
console.log('  curl --fail https://fbtswap.ir/.well-known/assetlinks.json | jq -e \'type == "array"\'');
console.log('\nPhantom re-verifies on the next connection; no submission is needed.');
