#!/usr/bin/env node
/** Standalone driver for the futures BFF probe (also mounted in test/run.mjs). */
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
const rows = (await import('./futures-bff-probe.mjs')).default;
const failed = rows.filter(([, ok]) => !ok);
for (const [name, ok] of rows) console.log(`${ok ? '✓' : '✗'} ${name}`);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);
