#!/usr/bin/env node
/**
 * Run the four operational drills and print their digests.
 *
 *   node scripts/run-ops-drills.mjs
 *
 * Nothing here invents a digest. A failed drill is reported with its code
 * and no evidence record.
 */

import { runAllOperationalDrills } from '../server/intentOperationalDrills.js';
import { runStage3Digest } from '../server/intentStage3Probe.js';

const now = Date.now();
const drills = await runAllOperationalDrills({ now });
const stage3 = await runStage3Digest({ now });

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

console.log('─'.repeat(72));
console.log(`drills  ${drills.earnedCount}/${drills.totalKinds}   stage-3  ${stage3.earnedCount}/${stage3.totalKinds}`);

process.exit(drills.earnedCount === drills.totalKinds ? 0 : 1);
