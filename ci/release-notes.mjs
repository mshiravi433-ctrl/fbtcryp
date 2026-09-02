#!/usr/bin/env node
/**
 * Stamp the rolling `latest` release with what was ACTUALLY built.
 *
 * Why this exists: the `latest` release is where a person on a phone goes to
 * download the APK, and its notes are written by hand only when a version tag is
 * cut. So the assets are three weeks newer than the prose — the page said
 * "v1.28.1 · versionCode 57" while serving a 1.39.0 / versionCode 62 build. On a
 * page whose entire job is "is this the file I want, and can I trust it", a stale
 * version is worse than no version: it reads like the pipeline stopped.
 *
 * So this script writes one machine-owned block into the body, generated from the
 * files on disk and android/app/build.gradle, between two HTML markers so that
 * (a) the human-written notes below it are never destroyed, and (b) running it
 * every build replaces the block instead of stacking a hundred copies.
 *
 * Deliberately non-fatal: an artifact that is built, signed and uploaded must
 * never fail to publish because a cosmetic PATCH to the release description hit a
 * rate limit. Every error path ends in `process.exitCode = 0` and a warning.
 *
 * Run locally with FBT_NOTES_DRY=1 to print what would be written.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPEN = '<!-- fbt:latest-build -->';
const CLOSE = '<!-- /fbt:latest-build -->';
const DRY = process.env.FBT_NOTES_DRY === '1';
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'mshiravi433-ctrl/fbtcryp';
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');

const warn = (msg) => {
  console.log(`  (release notes: ${msg})`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    console.log(`::warning title=Release notes::${msg}`);
  }
};

/** "12.6 MB" from bytes — a phone has no use for a byte count it must divide. */
const human = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Read the version out of the Gradle file rather than the workflow variable.
 * They are the same only when the override is set; the point of this line is to
 * be trustworthy before someone uploads to Play, and Play's rule (a re-upload
 * with an unchanged versionCode is rejected) makes the compiled-in number the
 * only one worth quoting.
 */
function gradleVersion() {
  let text = '';
  try {
    text = readFileSync(join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
  } catch {
    return { code: '?', name: '?', id: '?' };
  }
  const pick = (key) => {
    const m = new RegExp(`^\\s*${key}\\s+(\\S+)`, 'm').exec(text);
    return m ? m[1].replace(/["']/g, '') : '?';
  };
  return { code: pick('versionCode'), name: pick('versionName'), id: pick('applicationId') };
}

const CANDIDATES = [
  { file: 'out/FBT-Swap-full.apk', use: 'نصب مستقیم — نسخهٔ کامل (همهٔ ماژول‌ها)' },
  { file: 'out/FBT-Swap-full-unsigned.apk', use: 'نسخهٔ کاملِ بدون امضا — فقط تست، در فروشگاه نصب نمی‌شود' },
  { file: 'out/app-release.apk', use: 'بازار، مایکت و بقیهٔ فروشگاه‌ها — بدون صفحات قمار' },
  { file: 'out/app-release.aab', use: 'فقط Google Play' },
];

const present = CANDIDATES.filter((c) => existsSync(join(ROOT, c.file)));
if (!present.length) {
  warn('no artifacts under out/ — nothing to describe');
  process.exit(0);
}

const v = gradleVersion();
const refName = process.env.GITHUB_REF_NAME || 'main';
// GITHUB_SHA is authoritative in CI. Off CI, resolve the checked-out commit with
// git rather than reading .git/HEAD, which on a normal branch is the text
// "ref: refs/heads/main" — slicing that produced a "commit" of `ref: re`, a value
// that is wrong in a way nobody notices until someone tries to check it out.
let commit = (process.env.GITHUB_SHA || '').slice(0, 7);
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    commit = 'unknown';
  }
}

const signed = present.some((c) => c.file === 'out/app-release.apk' || c.file === 'out/app-release.aab');
const lines = [];
lines.push('### آخرین ساخت خودکار (GitHub Actions)');
lines.push('');
lines.push(`**versionName \`${v.name}\` · versionCode \`${v.code}\` · بستهٔ \`${v.id}\`**`);
// One bold span per line: nested `**` renders as literal asterisks, and a
// security-relevant line is the last place to accept garbled formatting.
lines.push('');
lines.push(signed ? '✅ **امضاشده** — قابل نصب مستقیم و قابل انتشار در فروشگاه‌ها.' : '⚠️ **بدون امضا (debug)** — فقط برای تست؛ گوگل‌پلی و بازار این را نمی‌پذیرند.');
lines.push('');
lines.push('| فایل | برای چه کسی | حجم | SHA‑256 |');
lines.push('|---|---|---|---|');
for (const c of present) {
  const path = join(ROOT, c.file);
  const name = c.file.split('/').pop();
  let digest = '—';
  try {
    digest = `\`${sha256(path).replace(/^(.{8}).*(.{4})$/, '$1…$2')}\``;
  } catch {
    /* a file that vanished mid-run is not worth failing over */
  }
  lines.push(`| \`${name}\` | ${c.use} | ${human(statSync(path).size)} | ${digest} |`);
}
lines.push('');
lines.push(
  `ساخته‌شده در ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC `
  + `از \`${refName}@${commit}\`.`
);
lines.push('');
lines.push('قبل از نصب، خلاصهٔ فایل را مقایسه کنید — اگر فرق داشت، نصب نکنید:');
lines.push('');
lines.push('```sh');
lines.push('sha256sum FBT-Swap-full.apk');
lines.push('```');
lines.push('');
lines.push('_این بلوک را خودِ پایپ‌لاین می‌نویسد و هر ساخت جایگزین می‌شود؛ یادداشت‌های دستی پایین‌تر دست‌نخورده می‌ماند._');

const block = `${OPEN}\n${lines.join('\n')}\n${CLOSE}`;

if (DRY) {
  console.log(block);
  process.exit(0);
}

// The block is useful even when nothing can PATCH it: it is also written to the
// step summary and to out/RELEASE-NOTES.md, so the version and digests are
// reachable from the run page. Only the release *body* needs a token, and the
// runner hands one to a script only if the workflow maps it — so say exactly
// that, instead of the shrug "no token".
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${block}\n`);
  } catch {
    /* summary writes are best-effort */
  }
}
try {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  writeFileSync(join(ROOT, 'out', 'RELEASE-NOTES.md'), `${lines.join('\n')}\n`);
} catch {
  /* nothing upstream depends on this file */
}

if (!TOKEN) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    warn(
      'this step has no GITHUB_TOKEN, so the release page was not stamped. '
      + 'Add `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to the build step env in '
      + '.github/workflows/build-apk.yml (the copy in ci/WORKFLOW-FIXED.yml already has it). '
      + 'The same block is on the run summary page and in out/RELEASE-NOTES.md.'
    );
  } else {
    warn('not running on GitHub Actions — body left as-is; block written to out/RELEASE-NOTES.md');
  }
  process.exit(0);
}

try {
  const rel = await fetch(`${API}/repos/${REPO}/releases/tags/latest`, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (!rel.ok) throw new Error(`read release: HTTP ${rel.status}`);
  const release = await rel.json();
  const old = String(release.body || '');
  const i = old.indexOf(OPEN);
  const j = old.indexOf(CLOSE);
  // Replace only our own block, keeping everything a human wrote.
  const body = i >= 0 && j > i ? `${old.slice(0, i)}${block}${old.slice(j + CLOSE.length)}` : `${block}\n\n${old}`;
  const res = await fetch(`${API}/repos/${REPO}/releases/${release.id}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`PATCH release: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  console.log(`✓ release notes: ${present.length} artifact${present.length === 1 ? '' : 's'} described (v${v.name}/vc${v.code})`);
} catch (err) {
  warn(`${err && err.message ? err.message : String(err)}`);
}
