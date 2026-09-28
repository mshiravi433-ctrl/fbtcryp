#!/usr/bin/env node
/**
 * «هوش تأییدشده اصلاً به داده‌های واقعی وصل نیست» — regression probe.
 *
 * Production served `indexedAt: null` forever. This proves each link of the
 * repaired chain without network access:
 *   1. a REAL-shaped wallet (paginated explorer page, no young pool, no
 *      curated CoinGecko id) can now qualify — it mathematically could not;
 *   2. such wallets can vote in consensus (coverage 0.63 ≥ 0.6);
 *   3. unqualified analysed wallets still surface as an honest observed layer
 *      (flow / receipts / candidates) and never as consensus;
 *   4. live discovery parses the real Blockscout token-transfer shape and
 *      keeps only plain wallets trading against a DEX;
 *   5. the cycle records every attempt (lastCycle), success or failure;
 *   6. a read on an empty index self-heals (on-demand cycle), a fresh index
 *      does not re-trigger, and `refresh:'never'` stays read-only.
 * Run: node test/smart-money-live-index-probe.mjs
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

import assert from 'node:assert/strict';
import { analyzePerformance } from '../server/smartMoney/performance.js';
import { buildConsensus } from '../server/smartMoney/consensus.js';
import { bsRecentStableSwappers, __setFetchForTests } from '../server/smartMoney/dataSources.js';
import { runIntelligenceCycle, getVerifiedIntelligence, readVerifiedIndex, discoverLiveTraders,
  __resetRefreshForTests } from '../server/smartMoney/intelligence.js';
import { storeSet } from '../server/store.js';
import { walletReceipts, TOKEN } from './fixtures/verifiedSmartMoney.mjs';

const now = Date.now();
const DAY = 86_400_000;
const results = [];
const check = (name, fn) => {
  try { fn(); results.push([name, true]); }
  catch (err) { results.push([name, false, err.message]); }
};

/* 1 — a realistic wallet: paginated history, pool far older than the trades
       (no early-entry factor), no exit-timing ids. */
const realistic = (wallet, opts = {}) => {
  const r = walletReceipts(wallet, { now, ...opts });
  return { ...r, historyTruncated: true, prices: new Map([[TOKEN, { pairCreatedAt: now - 900 * DAY }]]) };
};
const w1 = `0x${'a'.repeat(40)}`;
const perf = analyzePerformance(realistic(w1));
check('real paginated wallet reaches a score (was null: 0.70×0.9 < 0.70)', () => {
  assert.equal(perf.smartMoney.status, 'SCORED');
  assert.ok(perf.smartMoney.score >= 70, `score ${perf.smartMoney.score}`);
});
check('real paginated wallet can qualify (was impossible: needed ≥0.75 → optional factor)', () => {
  assert.equal(perf.smartMoney.qualified, true);
  assert.equal(perf.smartMoney.coverage, 0.63);
  assert.equal(perf.smartMoney.measuredCoverage, 0.7);
});
check('fewer than 5 closes still never qualifies', () => {
  const thin = realistic(w1);
  const few = analyzePerformance({ ...thin, transfers: thin.transfers.slice(0, 6) });
  assert.equal(few.smartMoney.score, null);
  assert.equal(few.smartMoney.qualified, false);
});
check('a losing wallet does not qualify', () => {
  const r = realistic(w1);
  // Invert every sell to a loss: proceeds below cost.
  const losing = { ...r, transfers: r.transfers.map((t) => (t.direction === 'in' && t.token.symbol === 'USDC') ? { ...t, amount: t.amount * 0.5 } : t) };
  assert.equal(analyzePerformance(losing).smartMoney.qualified, false);
});

/* 2 — three such wallets vote. */
const profiles = []; const swaps = [];
for (const ch of ['b', 'c', 'd']) {
  const wallet = `0x${ch.repeat(40)}`;
  const p = analyzePerformance(realistic(wallet, { buyRecently: true }));
  profiles.push({ chain: 1, address: wallet, score: p.smartMoney.score, coverage: p.smartMoney.coverage,
    closedTrades: p.performance.closedTrades, realizedUsd: p.pnl.realizedUsd, winRate: p.pnl.winRate,
    qualified: p.smartMoney.qualified, status: p.smartMoney.status, updatedAt: now - 30 * 3_600_000 });
  swaps.push(...p.swaps);
}
const voted = buildConsensus({ profiles, swaps, now, indexedAt: now - 1000, window: '24h', durable: true });
check('three real-shaped qualified wallets form ACCUMULATION', () => {
  assert.equal(voted.dataStatus, 'observed');
  assert.equal(voted.consensus[0]?.signal, 'ACCUMULATION');
  assert.equal(voted.consensus[0]?.independentBuyers, 3);
});
check('a 30-hour-old measurement still counts (36 h cap removed → 7 d)', () => {
  assert.equal(voted.coverage.classifiedWallets, 3);
});
check('an 8-day-old measurement is excluded', () => {
  const old = buildConsensus({ profiles: profiles.map((p) => ({ ...p, updatedAt: now - 8 * DAY })), swaps, now, window: '24h' });
  assert.equal(old.coverage.classifiedWallets, 0);
  assert.equal(old.observed.candidates.length, 0);
});

/* 3 — unqualified wallets: observed layer only, never consensus. */
const unq = profiles.map((p) => ({ ...p, qualified: false, score: null, status: 'INSUFFICIENT_EVIDENCE' }));
const layer = buildConsensus({ profiles: unq, swaps, now, window: '24h' });
check('unqualified sample: consensus empty, observed layer populated', () => {
  assert.equal(layer.dataStatus, 'insufficient-evidence');
  assert.equal(layer.consensus.length, 0);
  assert.equal(layer.leaderboard.length, 0);
  assert.equal(layer.observedStatus, 'sampled');
  assert.equal(layer.coverage.analyzedWallets, 3);
  assert.ok(layer.observed.flow.length >= 1);
  assert.equal(layer.observed.flow[0].qualifiedWallets, 0);
  assert.equal(layer.observed.flow[0].basis, 'all-analysed-wallets');
  assert.ok(layer.observed.recentSwaps.every((s) => s.qualified === false && /^0x[a-f0-9]{64}$/.test(s.hash)));
  assert.ok(layer.observed.candidates.every((c) => c.qualified === false));
});
check('observed flow carries no signal / confidence words', () => {
  for (const row of layer.observed.flow) {
    assert.equal(row.signal, undefined);
    assert.equal(row.confidence, undefined);
  }
});
check('qualified sample marks receipts/candidates as qualified', () => {
  assert.ok(voted.observed.recentSwaps.some((s) => s.qualified));
  assert.ok(voted.observed.candidates.every((c) => c.qualified));
});

/* 4 — live discovery against the real Blockscout response shape. */
const EOA = '0x' + '5'.repeat(40);
const TAGGED = '0x' + '6'.repeat(40);
const POOL = '0xe0554a476a092703abdb3ef35c80e0d76d32939f';
const SETTLER = '0x666fedd4cdd4e890a5ad20e7b60975409435a64a';
const EOA2 = '0x' + 'a'.repeat(40);
const EOA3 = '0x' + 'b'.repeat(40);
const EOA4 = '0x' + 'c'.repeat(40);
const EOA5 = '0x' + 'e'.repeat(40);
const party = (hash, { contract = false, tags = [] } = {}) => ({ hash, is_contract: contract, is_scam: false,
  metadata: tags.length ? { tags } : null, name: contract ? 'UniswapV3Pool' : null });
const item = (from, to, usd, method = 'execute', h = '1') => ({ from, to, method, timestamp: new Date(now).toISOString(),
  total: { decimals: '6', value: String(usd * 1e6) }, token: { decimals: '6', symbol: 'USDC' },
  transaction_hash: '0x' + h.repeat(64) });
__setFetchForTests(async (url) => {
  assert.match(url, /\/api\/v2\/tokens\/0x[a-f0-9]{40}\/transfers$/);
  return { ok: true, json: async () => ({ items: [
    item(party(EOA), party(POOL, { contract: true, tags: [{ tagType: 'generic', slug: 'liquidity-pool', name: 'Liquidity Pool' }] }), 25_000, '0x3593564c', 'a'),
    item(party(TAGGED, { tags: [{ tagType: 'name', name: 'Relay: Solver' }, { tagType: 'generic', slug: 'bridge' }] }), party(POOL, { contract: true }), 90_000, 'swap', 'b'),
    item(party(POOL, { contract: true }), party(POOL, { contract: true }), 50_000, 'swap', 'c'),
    item(party('0x' + '7'.repeat(40)), party(POOL, { contract: true }), 120, 'swap', 'd'),
    // Aggregator settlement (0x Settler): untagged contract, no decoded method,
    // but an explicit verified contract name → still a DEX counterparty.
    item({ ...party(SETTLER, { contract: true }), name: 'MainnetSettler' }, party(EOA2), 4_000, null, 'f'),
    // EIP-7702 delegated EOA (is_contract:true, proxy_type eip7702) is a wallet.
    item({ ...party(EOA4), is_contract: true, proxy_type: 'eip7702' }, party(POOL, { contract: true }), 2_000, '0x3593564c', '2'),
    // …and is never mistaken for the DEX counterparty.
    item(party(EOA5), { ...party(EOA4), is_contract: true, proxy_type: 'eip7702', name: 'Simple7702Account' }, 3_000, 'swap', '3'),
    // A plain contract with no DEX name/tag/method (e.g. a lending deposit) is not.
    item(party(EOA3), { ...party('0x' + 'd'.repeat(40), { contract: true }), name: 'Pool' }, 9_000, null, '1'),
    item(party('0x' + '8'.repeat(40)), party('0x' + '9'.repeat(40)), 40_000, 'transfer', 'e')
  ] }) };
});
const live = await bsRecentStableSwappers(1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
check('discovery keeps the untagged EOA that swapped via a pool', () => {
  assert.equal(live.dataStatus, 'live');
  assert.deepEqual(live.rows.map((r) => r.address), [EOA, EOA2, EOA4]);
  assert.equal(live.rows[0].basis, 'live-stablecoin-dex-transfer');
});
check('discovery skips solvers/bridges, contract↔contract, dust and plain transfers', () => {
  assert.ok(!live.rows.some((r) => r.address === TAGGED || r.address === EOA3 || r.address === EOA5 || r.address === '0x' + '7'.repeat(40)));
});
__setFetchForTests(async () => { throw new Error('down'); });
const down = await bsRecentStableSwappers(1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
check('outage → unavailable, zero rows', () => { assert.equal(down.dataStatus, 'unavailable'); assert.equal(down.rows.length, 0); });
const rotated = await discoverLiveTraders({ now, source: async (chain) => ({ rows: [{ chain, address: '0x' + String(chain % 10).repeat(40), basis: 'live-stablecoin-dex-transfer' }] }) });
check('discovery rotates across several chains per cycle', () => { assert.ok(new Set(rotated.map((r) => r.chain)).size >= 2); });
const later = await discoverLiveTraders({ now: now + 15 * 60_000, source: async (chain) => ({ rows: [{ chain, address: '0x' + String(chain % 10).repeat(40), basis: 'x' }] }) });
check('Ethereum anchors every cycle while the L2 slots rotate', () => {
  assert.ok(rotated.some((r) => r.chain === 1) && later.some((r) => r.chain === 1));
  assert.notDeepEqual(rotated.map((r) => r.chain).sort(), later.map((r) => r.chain).sort());
});
const quotesRead = [];
await discoverLiveTraders({ now, chains: 1, source: async (chain, quote) => { quotesRead.push(quote); return { rows: [{ chain, address: EOA, basis: 'x' }] }; } });
check('discovery reads two USD stablecoins per chain, de-duplicated wallets', () => { assert.equal(new Set(quotesRead).size, 2); });
__setFetchForTests(null);

/* 5 — cycle records every attempt; live discovery feeds analysis. */
await storeSet('smart-money:verified-index:v1', null);
const analysed = [];
const failing = await runIntelligenceCycle({ now, stream: { events: [] },
  discover: async () => [{ chain: 1, address: EOA, basis: 'live-stablecoin-dex-transfer' }],
  analyze: async () => { throw new Error('HTTP 503'); } });
check('failed cycle is recorded (was: silently nothing)', () => {
  assert.equal(failing.status, 'upstreams-unavailable');
});
const afterFail = await readVerifiedIndex();
check('lastCycle persisted even when every upstream failed', () => {
  assert.equal(afterFail.lastCycle?.status, 'upstreams-unavailable');
  assert.equal(afterFail.indexedAt, null);
});
const history = realistic(EOA);
const good = await runIntelligenceCycle({ now, stream: { events: [] },
  discover: async () => [{ chain: 1, address: EOA, basis: 'live-stablecoin-dex-transfer' }],
  analyze: async (address, chain) => {
    analysed.push(address);
    const p = analyzePerformance({ ...history, address });
    return { address, chain, sources: { history: 'live' }, smartMoney: p.smartMoney, performance: p.performance,
      verifiedSwaps: p.swaps.map((s) => ({ ...s, wallet: address.toLowerCase() })), closedTrades: p.closed };
  } });
const idx = await readVerifiedIndex();
check('live-discovered wallet is analysed and indexed with real receipts', () => {
  assert.deepEqual(analysed, [EOA]);
  assert.equal(good.status, 'sampled');
  assert.equal(good.qualified, 1);
  assert.ok(idx.indexedAt >= now);
  assert.equal(idx.profiles[0].discovery, 'live-stablecoin-dex-transfer');
  assert.ok(idx.swaps.length > 0);
});
const skipDown = await runIntelligenceCycle({ now: now + 1, stream: { events: [] }, discover: async () => [],
  candidates: [{ chain: 1, address: '0x' + 'e'.repeat(40) }],
  analyze: async (address, chain) => ({ address, chain, sources: { history: 'unavailable' }, smartMoney: {}, performance: {} }) });
check('an indexer outage is not stored as a measured profile', () => {
  assert.equal(skipDown.status, 'upstreams-unavailable');
});

/* 6 — self-healing reads. */
const priorOnDemand = process.env.SM_ONDEMAND_INDEX;
process.env.SM_ONDEMAND_INDEX = '1';
await storeSet('smart-money:verified-index:v1', null);
__resetRefreshForTests();
let cycles = 0;
const healed = await getVerifiedIntelligence({ window: '7d', events: { events: [] }, refreshFn: async () => {
  cycles++;
  await storeSet('smart-money:verified-index:v1', { indexedAt: Date.now(), profiles: [{ ...idx.profiles[0], updatedAt: Date.now() }],
    swaps: idx.swaps, lastCycle: { at: Date.now(), status: 'sampled' } });
  return { status: 'sampled' };
} });
check('empty index → first reader triggers ONE cycle and gets real data', () => {
  assert.equal(cycles, 1);
  assert.equal(healed.refresh.status, 'refreshed');
  assert.ok(healed.indexedAt);
  assert.equal(healed.coverage.analyzedWallets, 1);
  assert.ok(healed.observed.recentSwaps.length > 0);
});
const fresh = await getVerifiedIntelligence({ window: '7d', events: { events: [] }, refreshFn: async () => { cycles++; return {}; } });
check('fresh index does not re-trigger', () => { assert.equal(cycles, 1); assert.equal(fresh.refresh.status, 'idle'); });
await storeSet('smart-money:verified-index:v1', null);
__resetRefreshForTests();
const ro = await getVerifiedIntelligence({ window: '7d', events: { events: [] }, refresh: 'never', refreshFn: async () => { cycles++; return {}; } });
check("refresh:'never' is read-only", () => { assert.equal(cycles, 1); assert.equal(ro.refresh.status, 'disabled'); });
const bg = await getVerifiedIntelligence({ window: '7d', events: { events: [] }, refresh: 'background',
  refreshFn: () => { cycles++; return new Promise(() => {}); } });
check("refresh:'background' never blocks the caller", () => { assert.equal(cycles, 2); assert.equal(bg.refresh.status, 'refreshing'); });
if (priorOnDemand === undefined) delete process.env.SM_ONDEMAND_INDEX; else process.env.SM_ONDEMAND_INDEX = priorOnDemand;
__resetRefreshForTests(); // drop the never-settling background job

const failed = results.filter((r) => !r[1]);
for (const [name, ok, msg] of results) console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${msg}`}`);
if (failed.length) { console.error(`\n${failed.length} check(s) failed`); process.exit(1); }
console.log(`\nVerified Intelligence live-index probe: all ${results.length} checks passed`);
process.exit(0);
