#!/usr/bin/env node
/**
 * Honest status of third-party providers Intent OS still needs.
 *
 *   node scripts/run-external-providers.mjs
 *   node scripts/run-external-providers.mjs --require-all --out docs/external-provider-digest.json --md docs/EXTERNAL-PROVIDER-DIGEST-FA.md
 *
 * --require-all exits 1 while any provider is missing. That is the point:
 * this process does not mint SSO, counsel, CA-beyond-TLS, escrow, or an
 * independent review.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runExternalProviderDigest } from '../server/intentLaterPhaseProbe.js';

function parseArgs(argv) {
  const out = { out: null, md: null, requireAll: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.out = argv[++i] || null;
    else if (argv[i] === '--md') out.md = argv[++i] || null;
    else if (argv[i] === '--require-all') out.requireAll = true;
  }
  return out;
}

function writeFile(target, body) {
  if (!target) return;
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, body);
}

const flags = parseArgs(process.argv.slice(2));
const now = Date.now();
const digest = await runExternalProviderDigest({ now });
const providers = digest.providers;
const present = providers.filter((p) => p.present);
const missing = digest.missing;

console.log('\nFBT external providers');
console.log('─'.repeat(72));
for (const row of providers) {
  console.log(`${row.present ? '✓' : '✗'} ${row.id}`);
  console.log(`    code     ${row.code}`);
  console.log(`    blocker  ${row.blocker}`);
}
console.log('─'.repeat(72));
console.log(`present ${present.length}/${providers.length}`);
console.log('independent-security-review is never self-issued by this process.');

digest.requireAll = flags.requireAll === true;

const md = [
  '# FBT INTENT AI — digest ارائه‌دهندگان خارجی',
  '',
  `تاریخ: ${new Date(now).toISOString().slice(0, 10)}`,
  '',
  'این فرآیند ارائه‌دهندهٔ شخص‌ثالث را جعل نمی‌کند. هر ردیف غایب یک کد واقعی است.',
  '',
  `| حاضر | ${present.length}/${providers.length} |`,
  '|------|------|',
  '',
  '| ارائه‌دهنده | وضعیت | کد | مانع |',
  '|-------------|--------|-----|------|',
  ...providers.map((p) => `| \`${p.id}\` | ${p.present ? 'حاضر' : 'غایب'} | \`${p.code}\` | ${p.blocker} |`),
  '',
  '`--require-all` تا وقتی حتی یکی غایب باشد با کد خروج ۱ تمام می‌شود.',
  ''
].join('\n');

if (flags.out) {
  writeFile(flags.out, `${JSON.stringify(digest, null, 2)}\n`);
  console.log(`wrote ${flags.out}`);
}
if (flags.md) {
  writeFile(flags.md, md);
  console.log(`wrote ${flags.md}`);
}

if (flags.requireAll && missing.length) process.exit(1);
process.exit(0);
