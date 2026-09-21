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
 *   # verify what is committed:
 *   node scripts/assetlinks.mjs --check
 *
 *   # verify what is DEPLOYED (the file a wallet actually fetches):
 *   node scripts/assetlinks.mjs --remote
 *   node scripts/assetlinks.mjs --remote --origin=https://www.fbtswap.ir
 *
 *   # build hook — writes the file from CI/Vercel env, never fails a build:
 *   node scripts/assetlinks.mjs --ensure       (FBT_ANDROID_SHA256 / FBT_ANDROID_SHA256_PLAY)
 *
 * ─── WHY --ensure EXISTS ────────────────────────────────────────────────────
 * The file was correct only when somebody remembered to run the generator and
 * commit the result, which is exactly the kind of step that is skipped. Vercel
 * and the APK workflow both know the signing certificate (or can be given it),
 * so the build now writes the REAL file when the fingerprint is available and
 * says so when it is not. It never invents a value and it never fails a build —
 * an unavailable secret must not turn into a red deployment.
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
import {
  ASSETLINKS_SENTENCE,
  assetLinksUrl,
  checkDeployedAssetLinks,
  normalizeFingerprint,
  validateAssetLinks
} from '../src/lib/solana/assetlinks.js';

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

/* ── --remote: is what is DEPLOYED the file a wallet will fetch? ─────────── */
if (has('remote')) {
  const origin = arg('origin') ?? process.env.FBT_ASSETLINKS_ORIGIN ?? 'https://fbtswap.ir';
  const wanted = [
    ...process.argv.filter((a) => a.startsWith('--fingerprint=')).map((a) => a.slice('--fingerprint='.length)),
    ...(process.env.FBT_ANDROID_SHA256 ? process.env.FBT_ANDROID_SHA256.split(/[,\s]+/) : []),
    ...(process.env.FBT_ANDROID_SHA256_PLAY ? process.env.FBT_ANDROID_SHA256_PLAY.split(/[,\s]+/) : [])
  ].map(normalizeFingerprint).filter(Boolean);

  const result = await checkDeployedAssetLinks({
    origin,
    packageName: packageName(),
    fingerprints: wanted
  });
  console.log(`assetlinks.json @ ${result.url ?? assetLinksUrl(origin)}`);
  console.log(`  package    ${packageName()}`);
  console.log(`  fingerprint(s) checked ${wanted.length ? wanted.join(', ') : '—'}`);
  console.log(`  result     ${result.code}${result.status ? ` (HTTP ${result.status})` : ''}`);
  console.log(`  ${ASSETLINKS_SENTENCE[result.code] ?? ''}`);
  for (const problem of result.problems ?? []) console.log(`  · ${problem}`);
  if (!result.ok) {
    console.error('');
    console.error('  A wallet cannot verify this app identity until this passes.');
    console.error('  With Play App Signing, the fingerprint to publish is the APP SIGNING key');
    console.error('  from Play Console → Protected with Play → Play app signing, not the upload key.');
  }
  process.exit(result.ok ? 0 : 1);
}

/* ── --ensure: the build hook. Never fails, never invents a value. ───────── */
if (has('ensure')) {
  const wanted = [
    ...process.argv.filter((a) => a.startsWith('--fingerprint=')).map((a) => a.slice('--fingerprint='.length)),
    ...(process.env.FBT_ANDROID_SHA256 ? process.env.FBT_ANDROID_SHA256.split(/[,\s]+/) : []),
    ...(process.env.FBT_ANDROID_SHA256_PLAY ? process.env.FBT_ANDROID_SHA256_PLAY.split(/[,\s]+/) : [])
  ].map(normalizeFingerprint).filter(Boolean);

  if (wanted.length === 0) {
    console.log('· assetlinks.json: no signing fingerprint available in this environment — nothing written.');
    console.log('  (A guessed fingerprint verifies nothing. Set FBT_ANDROID_SHA256 — Play App');
    console.log('   Signing key if Play distributes the APK — to have the build generate it.)');
    process.exit(0);
  }
  let document = [];
  try {
    document = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
    if (!Array.isArray(document)) document = [];
  } catch {
    document = [];
  }
  const pkg = packageName();
  const statement = {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: pkg,
      sha256_cert_fingerprints: wanted
    }
  };
  const merged = [
    statement,
    ...document.filter((entry) => entry?.target?.package_name !== pkg)
  ];
  const validation = validateAssetLinks(merged, { packageName: pkg, fingerprints: wanted });
  if (!validation.ok) {
    console.log(`· assetlinks.json: generated file did not validate (${validation.problems.join(', ')}) — NOT written.`);
    process.exit(0);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`✓ assetlinks.json generated for ${pkg} (${wanted.length} fingerprint(s)) — deploy it.`);
  process.exit(0);
}

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
  console.log('  Deploy it, then confirm the DEPLOYED copy (not this local one):');
  console.log('    node scripts/assetlinks.mjs --remote');
  console.log('    curl --fail https://fbtswap.ir/.well-known/assetlinks.json');
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
