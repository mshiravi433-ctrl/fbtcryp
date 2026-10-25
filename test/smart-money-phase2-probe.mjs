#!/usr/bin/env node
/**
 * Smart Money phase 2 (2026-10-25) — regression probe.
 *
 * Proves, without network access:
 *   1. MOMENTUM_REVERSAL alerts fire on the TRANSITION into REVERSING on the
 *      24h verified sample — once, not on every re-observation (checked past
 *      the 6h cooldown), again only after the trend left REVERSING and a new
 *      reversal formed; a null momentum (previous window not provably
 *      sampled) neither fires nor moves the stored trend;
 *   2. capitalEfficiency is de-duplicated from profitability: same ROI,
 *      faster deployment scores higher, slower lower, and a 30-day average
 *      hold reproduces the OLD factor exactly (the anchor);
 *   3. index retention keeps QUALIFIED profiles (and their swaps) ahead of
 *      fresher unqualified ones when the cap binds.
 *
 * Run: node test/smart-money-phase2-probe.mjs
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

import assert from 'node:assert/strict';
import { analyzePerformance, USD_QUOTES } from '../server/smartMoney/performance.js';
import { buildConsensus } from '../server/smartMoney/consensus.js';
import { putWatchlist, runAlertCycle, readWatchlist } from '../server/smartMoney/watchlist.js';
import { pruneVerifiedIndex } from '../server/smartMoney/intelligence.js';
import { verifiedFixture, TOKEN } from './fixtures/verifiedSmartMoney.mjs';

const now = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`✓ ${name}`); }
  catch (err) { results.push(`✗ ${name} — ${err.message}`); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (err) { results.push(`✗ ${name} — ${err.message}`); }
};

/* ── 1. Momentum reversal alerts ─────────────────────────────────────── */
const sent = [];
const deliver = async (_id, _lang, payload) => { sent.push(payload); return true; };
const momentumAlertsFor = (identity) => sent.filter((p) => p.alert?.type === 'MOMENTUM_REVERSAL' && p.alert?.identity === identity).length;

const sellA = verifiedFixture({ now });                 // 24h: REVERSING (bought prior window, selling now)
const buyA = verifiedFixture({ now, buyRecently: true }); // 24h: NEW

/* Null-momentum guard first, with only this identity watching: a snapshot
 * whose index holds nothing older than the window must not fire and must
 * not record a trend. */
const idGuard = 'sm-phase2-guard-identity';
await putWatchlist(idGuard, [{ chain: 1, address: TOKEN, target: 'token', types: ['MOMENTUM_REVERSAL'] }]);
const recentOnly = buildConsensus({
  profiles: buyA.profiles,
  swaps: buyA.swaps.filter((s) => s.timestamp >= now - DAY),
  now, window: '24h', indexedAt: now - 1_000
});
await checkAsync('null momentum (unproven past) fires nothing and stores no trend', async () => {
  assert.equal(recentOnly.consensus.find((r) => r.token === TOKEN)?.momentum, null);
  const cycle = await runAlertCycle(deliver, { now, events: [], intelligence: recentOnly, intelligence24h: recentOnly });
  assert.equal(cycle.fired, 0);
  assert.equal(momentumAlertsFor(idGuard), 0);
  const rows = await readWatchlist();
  const mine = rows.find((r) => r.identity === idGuard);
  assert.ok(!mine.lastMomentumTrend, `stored trend should stay empty, got ${mine.lastMomentumTrend}`);
});

const idMain = 'sm-phase2-main-identity';
await putWatchlist(idMain, [{ chain: 1, address: TOKEN, target: 'token',
  types: ['MOMENTUM_REVERSAL'], condition: { minWallets: 3, confidence: 75 } }]);

await checkAsync('transition into REVERSING fires once, with evidence', async () => {
  const cycle = await runAlertCycle(deliver, { now, events: [], intelligence: sellA.snapshot, intelligence24h: sellA.snapshot });
  assert.equal(cycle.momentumStatus, 'observed');
  assert.equal(momentumAlertsFor(idMain), 1);
  const alert = sent.find((p) => p.alert?.identity === idMain)?.alert;
  assert.equal(alert.evidence.trend, 'REVERSING');
  assert.equal(alert.evidence.priorNetFlowUsd, 3_000_000);
  assert.equal(alert.evidence.window, '24h');
  assert.match(alert.message, /reversed direction/);
});
await checkAsync('still REVERSING 7h later (past cooldown) does NOT re-fire', async () => {
  const cycle = await runAlertCycle(deliver, { now: now + 7 * HOUR, events: [], intelligence: sellA.snapshot, intelligence24h: sellA.snapshot });
  assert.equal(momentumAlertsFor(idMain), 1, `expected still 1, cycle fired=${cycle.fired}`);
});
await checkAsync('trend leaving REVERSING is recorded silently', async () => {
  await runAlertCycle(deliver, { now: now + 8 * HOUR, events: [], intelligence: buyA.snapshot, intelligence24h: buyA.snapshot });
  assert.equal(momentumAlertsFor(idMain), 1);
  const rows = await readWatchlist();
  assert.equal(rows.find((r) => r.identity === idMain)?.lastMomentumTrend, 'NEW');
});
await checkAsync('a NEW reversal (fresh swaps) fires again', async () => {
  const later = now + 15 * HOUR;
  const sellB = verifiedFixture({ now: later });
  assert.equal(sellB.snapshot.consensus.find((r) => r.token === TOKEN)?.momentum?.trend, 'REVERSING');
  await runAlertCycle(deliver, { now: later, events: [], intelligence: sellB.snapshot, intelligence24h: sellB.snapshot });
  assert.equal(momentumAlertsFor(idMain), 2);
});

/* ── 2. capitalEfficiency de-duplication ─────────────────────────────── */
function historyWithHold(wallet, holdDays, { sellUsd = 120_000 } = {}) {
  const stable = USD_QUOTES[1][0];
  const transfers = []; const transactions = [];
  const trade = (i, time, side, usd) => {
    const hash = `0x${String(wallet).slice(2, 4).repeat(2)}${(i + 40).toString(16).padStart(60, '0')}`;
    const isBuy = side === 'BUY';
    transactions.push({ hash, success: true, method: 'swapExactTokensForTokens' });
    transfers.push({ hash, timestamp: time, direction: isBuy ? 'out' : 'in',
      from: isBuy ? wallet : undefined, to: isBuy ? undefined : wallet,
      token: { address: stable, symbol: 'USDC' }, amount: usd });
    transfers.push({ hash, timestamp: time, direction: isBuy ? 'in' : 'out',
      from: isBuy ? undefined : wallet, to: isBuy ? wallet : undefined,
      token: { address: TOKEN, symbol: 'TEST' }, amount: 1000 });
  };
  for (let i = 0; i < 6; i++) {
    const start = now - (200 - i * 10) * DAY;
    trade(i * 2, start, 'BUY', 100_000);
    trade(i * 2 + 1, start + holdDays * DAY, 'SELL', sellUsd);
  }
  return { chain: 1, address: wallet, transfers, transactions, now, prices: new Map(), historyLive: true };
}
const W = `0x${'e'.repeat(40)}`;
const fFast = analyzePerformance(historyWithHold(W, 0.5)).smartMoney.factors;
const fAnchor = analyzePerformance(historyWithHold(W, 30)).smartMoney.factors;
const fSlow = analyzePerformance(historyWithHold(W, 180)).smartMoney.factors;
const fLoseFast = analyzePerformance(historyWithHold(W, 0.5, { sellUsd: 80_000 })).smartMoney.factors;
check('same +20% ROI: faster deployment = higher capital efficiency', () => {
  assert.ok(fFast.capitalEfficiency > fAnchor.capitalEfficiency, `${fFast.capitalEfficiency} > ${fAnchor.capitalEfficiency}`);
  assert.ok(fAnchor.capitalEfficiency > fSlow.capitalEfficiency, `${fAnchor.capitalEfficiency} > ${fSlow.capitalEfficiency}`);
  assert.ok(fFast.capitalEfficiency >= 0.99, `fast ${fFast.capitalEfficiency}`);
});
check('30-day hold reproduces the OLD factor (anchor: 0.5+tanh(0.2)/2)', () => {
  assert.ok(Math.abs(fAnchor.capitalEfficiency - (0.5 + Math.tanh(0.2) / 2)) < 0.01,
    `anchor ${fAnchor.capitalEfficiency}`);
});
check('profitability is unchanged by holding time (the two factors now differ)', () => {
  assert.equal(fFast.profitability, fSlow.profitability);
  assert.notEqual(fFast.capitalEfficiency, fSlow.capitalEfficiency);
});
check('fast LOSSES are the least efficient, not churn-rewarded', () => {
  assert.ok(fLoseFast.capitalEfficiency <= 0.02, `losing fast ${fLoseFast.capitalEfficiency}`);
});

/* ── 3. Index retention under the cap ────────────────────────────────── */
check('qualified profiles and their swaps survive the cap ahead of fresh unqualified', () => {
  const qOld = { chain: 1, address: `0x${'1'.repeat(40)}`, qualified: true, updatedAt: now - 6 * DAY };
  const qNew = { chain: 1, address: `0x${'2'.repeat(40)}`, qualified: true, updatedAt: now - DAY };
  const fresh = [3, 4, 5].map((n) => ({ chain: 1, address: `0x${String(n).repeat(40)}`, qualified: false, updatedAt: now - n * 1000 }));
  const swaps = [
    { chain: 1, wallet: qOld.address, timestamp: now - 6 * DAY, id: 'q-old-swap' },
    ...fresh.map((p, i) => ({ chain: 1, wallet: p.address, timestamp: now - i * 1000, id: `fresh-${i}` }))
  ];
  const pruned = pruneVerifiedIndex({ profiles: [qOld, qNew, ...fresh], swaps, maxProfiles: 3, maxSwaps: 2 });
  assert.deepEqual(pruned.profiles.map((p) => p.address), [qNew.address, qOld.address, fresh[0].address]);
  assert.ok(pruned.swaps.some((s) => s.id === 'q-old-swap'), 'qualified wallet swap retained despite age');
  assert.equal(pruned.swaps.length, 2);
  assert.ok(pruned.swaps[0].timestamp >= pruned.swaps[1].timestamp, 'swaps stay newest-first after retention');
});
check('under the cap everything is kept', () => {
  const pruned = pruneVerifiedIndex({ profiles: [{ chain: 1, address: `0x${'9'.repeat(40)}`, qualified: false, updatedAt: now }],
    swaps: [{ chain: 1, wallet: `0x${'9'.repeat(40)}`, timestamp: now, id: 'only' }] });
  assert.equal(pruned.profiles.length, 1);
  assert.equal(pruned.swaps.length, 1);
});

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith('✗'));
console.log(`\nSmart Money phase-2 probe: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
