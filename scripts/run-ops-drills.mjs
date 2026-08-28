#!/usr/bin/env node
/**
 * Run the four operational drills and print their digests.
 *
 *   node scripts/run-ops-drills.mjs
 *   node scripts/run-ops-drills.mjs --out docs/operational-drill-digest.json --md docs/OPERATIONAL-DRILL-DIGEST-FA.md
 *
 * Nothing here invents a digest. A failed drill is reported with its code
 * and no evidence record. --out/--md write whatever actually ran.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runAllOperationalDrills } from '../server/intentOperationalDrills.js';
import { runStage3Digest } from '../server/intentStage3Probe.js';
import { runLaterPhaseProbe } from '../server/intentLaterPhaseProbe.js';

function parseArgs(argv) {
  const out = { out: null, md: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.out = argv[++i] || null;
    else if (argv[i] === '--md') out.md = argv[++i] || null;
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
const drills = await runAllOperationalDrills({ now });
const stage3 = await runStage3Digest({ now });
const later = await runLaterPhaseProbe({ now });

const line = (ok, label, extra) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (extra) console.log(`    ${extra}`);
};

console.log('\nFBT operational drills');
console.log('─'.repeat(72));
for (const kind of ['backup-restore-drill', 'rollback-drill', 'sandbox-operator', 'policy-contract']) {
  const row = drills.byKind[kind];
  if (row.ok) {
    line(true, kind, `providerId ${row.evidence.providerId}\n    digest     ${row.evidence.digest}`);
  } else {
    line(false, kind, `code       ${row.code}`);
  }
}

console.log('\nFBT stage-3 (live work; independent-security-review is never self-issued)');
console.log('─'.repeat(72));
console.log(`    reviewPackage  ${stage3.digests.reviewPackage}`);
console.log(`    kmsAdapter     ${stage3.digests.productionSignerAdapter}`);
console.log(`    smartWallet    ${stage3.digests.smartWalletPolicy}`);
console.log(`    brokerAdapter  ${stage3.digests.brokerAdapter}`);
for (const row of stage3.missing) {
  line(false, row.kind, `code ${row.code}${row.hint ? `\n    why  ${row.hint}` : ''}`);
}
for (const row of stage3.earned) {
  line(true, row.kind, `providerId ${row.providerId}\n    digest     ${row.digest}`);
}

console.log('\nFBT later-phase (31–100 in-process; third-party stays missing)');
console.log('─'.repeat(72));
console.log(`    proven   ${later.provenCount}/${later.totalChecks}`);
console.log(`    launchAllowed ${later.launchAllowed}   live ${later.live}`);
for (const row of later.missing.filter((m) => m.thirdParty)) {
  line(false, row.id, `code ${row.code}`);
}

console.log('─'.repeat(72));
console.log(`drills  ${drills.earnedCount}/${drills.totalKinds}   stage-3  ${stage3.earnedCount}/${stage3.totalKinds}   later-phase  ${later.provenCount}/${later.totalChecks}`);

const digest = {
  schema: 'fbt.operational-drill-digest.v1',
  generatedAt: new Date(now).toISOString(),
  drills: {
    earnedCount: drills.earnedCount,
    totalKinds: drills.totalKinds,
    earned: drills.earned,
    missing: drills.missing,
    byKind: Object.fromEntries(
      Object.entries(drills.byKind).map(([kind, row]) => [kind, {
        ok: row.ok,
        code: row.code || null,
        providerId: row.evidence?.providerId || null,
        digest: row.evidence?.digest || null
      }])
    )
  },
  stage3: {
    earnedCount: stage3.earnedCount,
    totalKinds: stage3.totalKinds,
    earned: stage3.earned,
    missing: stage3.missing
  },
  laterPhase: {
    schema: later.schema,
    provenCount: later.provenCount,
    missingCount: later.missingCount,
    totalChecks: later.totalChecks,
    launchAllowed: false,
    live: false,
    proven: later.proven,
    missing: later.missing
  }
};

const md = [
  '# FBT INTENT AI — digest دریل عملیاتی',
  '',
  `تاریخ: ${new Date(now).toISOString().slice(0, 10)}`,
  '',
  'چهار دریل Wave 2 واقعاً اجرا می‌شوند. مرحلهٔ ۳ کار زنده است و',
  '`independent-security-review` خودگواهی نمی‌شود. فازهای ۳۱–۱۰۰ داخل فرآیند',
  'اثبات می‌شوند و هیچ kind جدیدی به برد ۲۱/۲۱ اضافه نمی‌کنند.',
  '',
  `دریل‌ها: **${drills.earnedCount}/${drills.totalKinds}**`,
  `مرحلهٔ ۳: **${stage3.earnedCount}/${stage3.totalKinds}**`,
  `فازهای بعدی: **${later.provenCount}/${later.totalChecks}** اثبات‌شده — \`launchAllowed: false\``,
  '',
  '## دریل‌ها',
  '',
  '| شاهد | وضعیت | digest |',
  '|------|--------|--------|',
  ...['backup-restore-drill', 'rollback-drill', 'sandbox-operator', 'policy-contract'].map((kind) => {
    const row = drills.byKind[kind];
    return row.ok
      ? `| \`${kind}\` | کسب‌شده (${row.evidence.providerId}) | \`${row.evidence.digest}\` |`
      : `| \`${kind}\` | نیست — \`${row.code}\` | — |`;
  }),
  '',
  '## فازهای بعدی که هنوز شخص ثالث می‌خواهند',
  '',
  ...later.missing.filter((m) => m.thirdParty).map((m) => `- \`${m.id}\` — \`${m.code}\``),
  '',
  'این فایل را `npm run ops:drill -- --out … --md …` می‌نویسد.',
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

process.exit(drills.earnedCount === drills.totalKinds ? 0 : 1);
