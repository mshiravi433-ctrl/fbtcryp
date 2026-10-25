#!/usr/bin/env node
/**
 * Smart Money upgrade (2026-10-25) — regression probe.
 *
 * Proves, without network access:
 *   1. the FABRICATED seed is gone — an empty verified index answers
 *      `insufficient-evidence` with zero profiles, and the server source no
 *      longer carries invented people, invented prices or the ×1.35 gain;
 *   2. momentum is computed ONLY from the same qualified paired swaps:
 *      REVERSING when the previous equal window points the other way, NEW
 *      when the previous window was sampled but held none of the token, and
 *      null (unknown, never "zero") when nothing in the index predates the
 *      current window;
 *   3. flowBuckets slice the SAME window — they sum to the row's net flow;
 *   4. breadth tallies every verified row (counts + totals are consistent);
 *   5. the deterministic narration cites the trend only when it is proven.
 *
 * Run: node test/smart-money-upgrade-probe.mjs
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildConsensus } from '../server/smartMoney/consensus.js';
import { getVerifiedIntelligence } from '../server/smartMoney/intelligence.js';
import { narrateIntelligence } from '../server/smartMoney/narration.js';
import { verifiedFixture, TOKEN } from './fixtures/verifiedSmartMoney.mjs';

const now = Date.now();
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`✓ ${name}`); }
  catch (err) { results.push(`✗ ${name} — ${err.message}`); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (err) { results.push(`✗ ${name} — ${err.message}`); }
};

/* 1 — the fabricated seed must never come back. */
const intelSrc = readFileSync(new URL('../server/smartMoney/intelligence.js', import.meta.url), 'utf8');
check('server source carries no fabricated people/prices/gains', () => {
  assert.ok(!intelSrc.includes('function seedVerifiedSnapshot'), 'seed function returned');
  assert.ok(!intelSrc.includes("'Arthur Hayes (Maelstrom)', 'FUND'"), 'invented named profiles returned');
  assert.ok(!intelSrc.includes('* 1.35'), 'invented +35% price fallback returned');
  assert.ok(!intelSrc.includes("'0x6982508145454ce325ddbe47a25d4ec3d2311933': 0.0000108"), 'hardcoded price table returned');
});
await checkAsync('empty index stays honestly empty (no seed substitution)', async () => {
  const out = await getVerifiedIntelligence({ window: '24h', refresh: 'never' });
  assert.equal(out.dataStatus, 'insufficient-evidence');
  assert.equal((out.leaderboard || []).length, 0);
  assert.equal(out.consensus.length, 0);
  assert.equal(out.coverage.analyzedWallets, 0);
});

/* 2 — momentum from the previous equal window, same receipts only. */
const sell = verifiedFixture({ now }); // BUY 1.0M @ now-2d, SELL 1.2M @ now (×3 wallets)
check('previous window bought, this window sells → REVERSING with real numbers', () => {
  const row = sell.snapshot.consensus.find((r) => r.token === TOKEN);
  assert.ok(row, 'consensus row exists');
  assert.equal(row.signal, 'DISTRIBUTION');
  assert.ok(row.momentum, 'momentum present');
  assert.equal(row.momentum.trend, 'REVERSING');
  assert.equal(row.momentum.prevNetFlowUsd, 3_000_000);
  assert.equal(row.momentum.deltaUsd, -6_600_000);
  assert.equal(row.momentum.basis, 'qualified-paired-swaps-previous-window');
});
const buy = verifiedFixture({ now, buyRecently: true }); // recent BUY only; older sample exists (closed trades weeks ago)
check('previous window sampled, none of this token → NEW', () => {
  const row = buy.snapshot.consensus.find((r) => r.token === TOKEN);
  assert.equal(row.signal, 'ACCUMULATION');
  assert.equal(row.momentum?.trend, 'NEW');
  assert.equal(row.momentum?.prevNetFlowUsd, null);
});
check('nothing predates the window → momentum null, not a fake zero past', () => {
  const cutoff = now - 24 * 3600_000;
  const recentOnly = buildConsensus({
    profiles: buy.profiles,
    swaps: buy.swaps.filter((s) => s.timestamp >= cutoff),
    now, window: '24h', indexedAt: now - 1_000
  });
  const row = recentOnly.consensus.find((r) => r.token === TOKEN);
  assert.ok(row, 'row exists');
  assert.equal(row.momentum, null);
  assert.equal(recentOnly.breadth.momentumSampled, false);
});

/* 3 — buckets are the same window, sliced. */
check('flowBuckets (12) sum to the row net flow', () => {
  const row = sell.snapshot.consensus.find((r) => r.token === TOKEN);
  assert.equal(row.flowBuckets.length, 12);
  const sum = row.flowBuckets.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - row.netFlowUsd) < 0.5, `buckets ${sum} vs net ${row.netFlowUsd}`);
});

/* 4 — breadth is internally consistent with the rows it tallies. */
check('breadth counts and totals match the verified sample', () => {
  const b = sell.snapshot.breadth;
  assert.ok(b, 'breadth present');
  assert.equal(b.accumulation + b.distribution + b.insufficient, b.tokensObserved);
  assert.equal(b.distribution, 1);
  assert.equal(Math.round(b.netUsd), Math.round(b.buyUsd - b.sellUsd));
  assert.equal(b.qualifiedWalletsActive, 3);
  assert.equal(b.swaps, 3);
  assert.equal(b.basis, 'qualified-paired-swaps');
});

/* 5 — narration cites momentum only when proven. */
check('narration cites the reversal (fa + en)', () => {
  const fa = narrateIntelligence(sell.snapshot, { message: 'smart money?', lang: 'fa' });
  const en = narrateIntelligence(sell.snapshot, { message: 'smart money?', lang: 'en' });
  assert.match(fa.text, /چرخش جهت/);
  assert.match(en.text, /direction reversed/);
  assert.equal(fa.dataStatus, 'observed');
});
check('narration invents no trend when momentum is null', () => {
  const stripped = {
    ...sell.snapshot,
    consensus: sell.snapshot.consensus.map((r) => ({ ...r, momentum: null }))
  };
  const en = narrateIntelligence(stripped, { message: 'smart money?', lang: 'en' });
  assert.ok(!/reversed|strengthening|weakening/.test(en.text), en.text);
});

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith('✗'));
console.log(`\nSmart Money upgrade probe: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
