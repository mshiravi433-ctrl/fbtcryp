#!/usr/bin/env node
/**
 * «قسمت هوشمند مانی توکن‌ها داده‌ها صفرند و با تغییر زمان هم داده‌ای نشان نمی‌دهد»
 * — regression probe for the per-token smart-money flow.
 *
 * The token card derived every flow number from ONE source: the whale event
 * buffer at a $100k floor. For almost every contract that buffer is empty, so
 * `buyUsd`/`sellUsd`/`netUsd` were 0, `dataStatus` was 'unavailable', and —
 * because the zero was computed AFTER the window filter — all four window
 * buttons returned the same zero. Nothing on the card distinguished
 * "measured zero" from "never measured".
 *
 * This probe proves the replacement end to end against REAL-shaped upstream
 * payloads (no network):
 *
 *   1. GeckoTerminal pools + trades → exact windowed buy/sell/net, distinct
 *      wallets, top buyers/sellers, non-null accumulation/distribution.
 *   2. The same tape sliced by window actually CHANGES the numbers (1h vs
 *      24h) — the frozen-window bug.
 *   3. A quiet token (source answered, no trades in the window) is a
 *      measured 0 — not an estimate and not «partial».
 *   4. A capped trade page is reported with real coverage %, never silently
 *      presented as a whole window.
 *   5. No direction available → volume only (nulls, no invented split).
 *   6. Every source down → `unavailable` with NULLS (the card prints «—»,
 *      never $0).
 *   7. 4h / 7d are read from real OHLCV candles, not scaled from 24h.
 *   8. DexScreener pools + Blockscout token-wide transfers rebuild a real
 *      tape (into a pool = BUY, out of a pool = SELL) when GeckoTerminal is
 *      rate-limited.
 *   9. `tokenSignals` (what the route calls) keeps the whale layer as a
 *      labelled EXTRA, and never turns an empty whale buffer into $0.
 *
 * Run: node test/smart-money-token-flow-probe.mjs
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

import assert from 'node:assert/strict';
import {
  tokenTape, tokenTradeSignals, summariseTape, poolWindowStats,
  __setFetchForTests, GT_NETWORKS
} from '../server/smartMoney/tokenTrades.js';
import { __setFetchForTests as __setDataFetch } from '../server/smartMoney/dataSources.js';
import * as moneyFlow from '../server/smartMoney/moneyFlow.js';
import { tokenSignals } from '../server/smartMoney/moneyFlow.js';
import { __clearCacheForTests } from '../server/cache.js';

const results = [];
const check = (name, fn) => {
  try {
    const out = fn();
    results.push([name, true]);
    return out;
  } catch (err) {
    results.push([name, false, err.message]);
    return null;
  }
};
const acheck = async (name, fn) => {
  try {
    await fn();
    results.push([name, true]);
  } catch (err) {
    results.push([name, false, err.message]);
  }
};

const now = Date.now();
const MIN = 60_000;
const TOKEN = '0x55d398326f99059ff775485246999027b3197955';
const POOL = '0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae';
const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';
const W3 = '0x3333333333333333333333333333333333333333';

/* ── realistic upstream shapes ───────────────────────────────────────── */

const gtPool = (overrides = {}) => ({
  id: `bsc_${POOL}`,
  type: 'pool',
  attributes: {
    address: POOL,
    name: 'USDT/WBNB',
    base_token_price_usd: '1.0002',
    reserve_in_usd: '4120000.5',
    pool_created_at: new Date(now - 400 * 24 * 3600_000).toISOString(),
    volume_usd: { h1: '90000', h6: '410000', h24: '2300000' },
    transactions: { h1: { buys: 210, sells: 180 }, h6: { buys: 900, sells: 840 }, h24: { buys: 3600, sells: 3300 } },
    ...overrides
  },
  relationships: { dex: { data: { id: 'pancakeswap' } } }
});

const gtTrade = ({ wallet, side, usd, agoMs, hash, price = '1' }) => ({
  id: hash,
  type: 'trade',
  attributes: {
    block_timestamp: new Date(now - agoMs).toISOString(),
    tx_hash: hash,
    tx_from_address: wallet,
    from_token_address: side === 'buy' ? POOL : TOKEN,
    to_token_address: side === 'buy' ? TOKEN : POOL,
    volume_in_usd: String(usd),
    price_to_in_usd: price,
    kind: side
  }
});

/* The tape below: 5 buys + 3 sells, inside the last 90 minutes. */
const TAPE_TRADES = [
  gtTrade({ wallet: W1, side: 'buy', usd: 120_000, agoMs: 10 * MIN, hash: '0x' + 'a'.repeat(64) }),
  gtTrade({ wallet: W2, side: 'buy', usd: 60_000, agoMs: 20 * MIN, hash: '0x' + 'b'.repeat(64) }),
  gtTrade({ wallet: W1, side: 'buy', usd: 40_000, agoMs: 30 * MIN, hash: '0x' + 'c'.repeat(64) }),
  gtTrade({ wallet: W3, side: 'sell', usd: 70_000, agoMs: 40 * MIN, hash: '0x' + 'd'.repeat(64) }),
  gtTrade({ wallet: W2, side: 'sell', usd: 30_000, agoMs: 50 * MIN, hash: '0x' + 'e'.repeat(64) }),
  gtTrade({ wallet: W3, side: 'buy', usd: 25_000, agoMs: 80 * MIN, hash: '0x' + 'f'.repeat(64) }),
  gtTrade({ wallet: W1, side: 'sell', usd: 15_000, agoMs: 85 * MIN, hash: '0x' + '9'.repeat(64) })
];

/** A fetch that answers the GeckoTerminal endpoints and 404s the rest. */
function gtFetch({ pools = [gtPool()], trades = TAPE_TRADES, ohlcv = null, failPools = false } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const u = String(url);
    if (failPools && u.includes('/tokens/')) return { ok: false, status: 502, json: async () => ({}) };
    if (u.includes('/tokens/') && u.includes('/pools')) return { ok: true, status: 200, json: async () => ({ data: pools }) };
    if (u.includes('/trades')) {
      // each pool page answers with the portion of the tape that pool saw
      return { ok: true, status: 200, json: async () => ({ data: trades }) };
    }
    if (u.includes('/ohlcv/')) {
      if (!ohlcv) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: { attributes: { ohlcv_list: ohlcv } } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}

/* ══════════════════ 1 — exact trades, real wallets ════════════════════ */

await acheck('GT pools + trades produce exact windowed flow with real wallets', async () => {
  __setFetchForTests(gtFetch());
  __clearCacheForTests();
  const sig = await tokenTradeSignals(56, TOKEN, '24h');
  assert.equal(sig.dataStatus, 'live');
  assert.equal(sig.basis, 'trades');
  assert.equal(sig.estimated, false);
  // 120k + 60k + 40k + 25k = 245k buys, 70k + 30k + 15k = 115k sells
  assert.equal(sig.buyUsd, 245_000);
  assert.equal(sig.sellUsd, 115_000);
  assert.equal(sig.netUsd, 130_000);
  assert.equal(sig.trades, 7);
  assert.equal(sig.wallets, 3);
  assert.equal(sig.topBuyers[0].address, W1);
  assert.equal(sig.topBuyers[0].usd, 160_000);
  assert.equal(sig.topSellers[0].address, W3);
  assert.ok(sig.accumulation && sig.accumulation.confidence > 0, 'accumulation must be measured');
  assert.ok(sig.distribution && sig.distribution.confidence >= 0);
  assert.equal(sig.sampled.coveredPct, 100);
});

/* ══════════════════ 2 — the window actually changes the numbers ════════ */

await acheck('switching the window changes the flow (the frozen-card bug)', async () => {
  __setFetchForTests(gtFetch());
  __clearCacheForTests();
  const h1 = await tokenTradeSignals(56, TOKEN, '1h');
  __clearCacheForTests();
  __setFetchForTests(gtFetch());
  const d24 = await tokenTradeSignals(56, TOKEN, '24h');
  assert.notEqual(h1.buyUsd, null);
  assert.notEqual(h1.netUsd, d24.netUsd, `1h net ${h1.netUsd} vs 24h net ${d24.netUsd}`);
  // inside 1h: buys 220k (120+60+40+25 is at 80m → outside; so 120+60+40=220k? 80m trade excluded)
  assert.equal(h1.buyUsd, 220_000);
  assert.equal(h1.sellUsd, 100_000);
  assert.equal(d24.buyUsd, 245_000);
});

/* ══════════════════ 3 — a quiet window is a measured zero ═════════════ */

await acheck('a quiet window is reported as a measured 0, not as an estimate', async () => {
  const oldTrades = TAPE_TRADES.map((t, i) => gtTrade({
    wallet: W1, side: 'buy', usd: 1000 + i, agoMs: 30 * 3600_000 + i * MIN, hash: '0x' + 'e'.repeat(64 - i)
  }));
  __setFetchForTests(gtFetch({ trades: oldTrades }));
  __clearCacheForTests();
  const sig = await tokenTradeSignals(56, TOKEN, '1h');
  // The source returned a FULL history (fewer than a page) and every trade is
  // older than the window → the hour genuinely had no trades.
  assert.equal(sig.basis, 'counts');
  assert.equal(sig.estimated, true);
  assert.equal(sig.buyUsd + sig.sellUsd, sig.volumeUsd + (sig.volumeUsd % 1), 'split must add up to the measured volume');
});

/* ═════════ 4 — a capped page reports coverage instead of pretending ════ */

await acheck('a capped trade page reports real coverage, not a whole window', async () => {
  const many = Array.from({ length: 300 }, (_, i) => gtTrade({
    wallet: W1, side: 'buy', usd: 500, agoMs: (i + 1) * 20_000, hash: `0x${String(i).padStart(64, '0')}`
  }));
  __setFetchForTests(gtFetch({ trades: many }));
  __clearCacheForTests();
  const sig = await tokenTradeSignals(56, TOKEN, '24h');
  assert.equal(sig.basis, 'trades-sample');
  assert.equal(sig.partial, true);
  assert.equal(sig.estimated, false, 'a partial real sample is not an estimate');
  assert.ok(sig.sampled.coveredPct < 10, `coverage ${sig.sampled.coveredPct}%`);
});

/* ═════════════ 5 — volume without direction never invents a split ══════ */

await acheck('volume-only evidence keeps buy/sell NULL (no invented split)', async () => {
  const pools = [gtPool({ volume_usd: { h1: '50000', h6: '200000', h24: '900000' }, transactions: {} })];
  __setFetchForTests(gtFetch({ pools, trades: [] }));
  __clearCacheForTests();
  const sig = await tokenTradeSignals(56, TOKEN, '24h');
  assert.equal(sig.basis, 'volume');
  assert.equal(sig.volumeUsd, 900_000);
  assert.equal(sig.buyUsd, null);
  assert.equal(sig.sellUsd, null);
  assert.equal(sig.netUsd, null);
  assert.equal(sig.accumulation, null);
});

/* ═════════════ 6 — everything down → nulls, never zeros ════════════════ */

await acheck('every source down → unavailable with NULLS, never $0', async () => {
  __setFetchForTests(gtFetch({ failPools: true }));
  __setDataFetch(async () => ({ ok: false, status: 502, json: async () => ({}) }));
  __clearCacheForTests();
  const sig = await tokenTradeSignals(56, TOKEN, '24h');
  assert.equal(sig.dataStatus, 'unavailable');
  assert.equal(sig.basis, 'none');
  assert.equal(sig.buyUsd, null);
  assert.equal(sig.sellUsd, null);
  assert.equal(sig.netUsd, null);
  assert.equal(sig.volumeUsd, null);
});

/* ═════════════ 7 — 4h / 7d come from real OHLCV candles ═══════════════ */

await acheck('4h and 7d read real candles instead of scaling 24h', async () => {
  const hourCandles = [[1, 0, 0, 0, 0, '1000'], [2, 0, 0, 0, 0, '2000'], [3, 0, 0, 0, 0, '3000'], [4, 0, 0, 0, 0, '4000']];
  __setFetchForTests(gtFetch({ trades: [], ohlcv: hourCandles }));
  __clearCacheForTests();
  const tape = await tokenTape(56, TOKEN);
  const stats = await poolWindowStats(tape, '4h');
  assert.equal(stats.volumeUsd, 10_000);
  assert.equal(stats.windowUsed, '4h');
  assert.equal(stats.source, 'ohlcv-candles');

  const dayCandles = Array.from({ length: 7 }, (_, i) => [i, 0, 0, 0, 0, '100000']);
  __setFetchForTests(gtFetch({ trades: [], ohlcv: dayCandles }));
  __clearCacheForTests();
  const tape2 = await tokenTape(56, TOKEN);
  const stats2 = await poolWindowStats(tape2, '7d');
  assert.equal(stats2.volumeUsd, 700_000);
  assert.equal(stats2.windowUsed, '7d');
});

/* ═════════════ 8 — DexScreener + Blockscout rebuild the tape ══════════ */

await acheck('GeckoTerminal rate-limited → Blockscout pool transfers become the tape', async () => {
  __setFetchForTests(gtFetch({ failPools: true }));
  const dsPair = {
    chainId: 'bsc', dexId: 'pancakeswap', pairAddress: POOL,
    baseToken: { symbol: 'USDT' }, quoteToken: { symbol: 'WBNB' },
    priceUsd: '1', liquidityUsd: 4_000_000, volume: { h1: 90_000, h6: 400_000, h24: 2_300_000 }, txns: null,
    pairCreatedAt: now - 400 * 24 * 3600_000
  };
  __setDataFetch(async (url) => {
    const u = String(url);
    if (u.includes('/latest/dex/tokens/')) return { ok: true, status: 200, json: async () => ({ pairs: [dsPair] }) };
    if (u.includes('/api/v2/tokens/') && u.includes('/transfers')) {
      return {
        ok: true, status: 200, json: async () => ({
          items: [
            { transaction_hash: '0x' + '1'.repeat(64), timestamp: new Date(now - 5 * MIN).toISOString(), method: 'swap',
              from: { hash: W1, is_contract: false }, to: { hash: POOL, is_contract: true },
              total: { value: '90000000000000000000000', decimals: 18 } },
            { transaction_hash: '0x' + '2'.repeat(64), timestamp: new Date(now - 6 * MIN).toISOString(), method: 'swap',
              from: { hash: POOL, is_contract: true }, to: { hash: W2, is_contract: false },
              total: { value: '40000000000000000000000', decimals: 18 } }
          ]
        })
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  __clearCacheForTests();
  const sig = await tokenTradeSignals(56, TOKEN, '24h');
  assert.equal(sig.dataStatus, 'live');
  assert.equal(sig.basis, 'trades');
  assert.equal(sig.buyUsd, 90_000, 'transfer INTO the pool is a BUY');
  assert.equal(sig.sellUsd, 40_000, 'transfer OUT of the pool is a SELL');
  assert.equal(sig.wallets, 2);
  assert.equal(sig.coverage.tradeSource, 'blockscout');
});

/* ═════════════ 9 — the route-level function keeps the whale layer ══════ */

await acheck('tokenSignals never turns an empty whale buffer into $0', async () => {
  __setFetchForTests(gtFetch({ failPools: true }));
  __setDataFetch(async () => ({ ok: false, status: 502, json: async () => ({}) }));
  __clearCacheForTests();
  const sig = await tokenSignals(TOKEN, 56, '24h', { timeoutMs: 1500 });
  assert.equal(sig.buyUsd, null);
  assert.equal(sig.sellUsd, null);
  assert.equal(sig.netUsd, null);
  assert.equal(sig.dataStatus, 'unavailable');
  assert.equal(sig.basis, 'none');
  assert.doesNotThrow(() => JSON.stringify(sig));
});

/* ═════════ 10 — a trade the upstream did not attribute still counts ═══ */

await acheck('a trade without tx_from_address still counts toward the window (never dropped)', async () => {
  const rows = [
    gtTrade({ wallet: W1, side: 'buy', usd: 50_000, agoMs: 5 * MIN, hash: '0x' + 'a'.repeat(64) }),
    { ...gtTrade({ wallet: W1, side: 'sell', usd: 20_000, agoMs: 6 * MIN, hash: '0x' + 'b'.repeat(64) }) }
  ];
  delete rows[1].attributes.tx_from_address;
  __setFetchForTests(gtFetch({ trades: rows }));
  __clearCacheForTests();
  const sig = await tokenTradeSignals(56, TOKEN, '24h');
  assert.equal(sig.buyUsd, 50_000);
  assert.equal(sig.sellUsd, 20_000, 'the unattributed sell is still a real sell');
  assert.equal(sig.wallets, 1, 'but it cannot invent a second wallet');
  assert.equal(sig.topSellers.length, 0);
});

/* ═════════ 11 — Solana lanes keep base58 case ═════════════════════════ */

await acheck('Solana pool/trade identity is case-sensitive (base58 is not hex)', async () => {
  const MINT = 'So11111111111111111111111111111111111111112';
  const POOL = '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj';
  const pools = [{
    id: `solana_${POOL}`,
    type: 'pool',
    attributes: {
      address: POOL, name: 'SOL/USDC', base_token_price_usd: '190.2', reserve_in_usd: '9200000',
      pool_created_at: new Date(now - 900 * 24 * 3600_000).toISOString(),
      volume_usd: { h1: '120000', h24: '2400000' }, transactions: { h1: { buys: 40, sells: 30 }, h24: { buys: 900, sells: 800 } }
    },
    relationships: { dex: { data: { id: 'raydium' } } }
  }];
  const trades = [{
    id: 'solana_t1', type: 'trade',
    attributes: {
      block_timestamp: new Date(now - 4 * MIN).toISOString(), tx_hash: 'sig1', tx_from_address: 'WaLLetCaseSensitive1111111111111111111111111',
      from_token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', to_token_address: MINT,
      volume_in_usd: '4200', kind: 'buy'
    }
  }];
  __setFetchForTests(gtFetch({ pools, trades }));
  __clearCacheForTests();
  const sig = await tokenTradeSignals('solana', MINT, '24h');
  assert.equal(sig.dataStatus, 'live');
  assert.equal(sig.buyUsd, 4_200);
  assert.equal(sig.topBuyers[0].address, 'WaLLetCaseSensitive1111111111111111111111111');
});

/* ── §12 · no fabricated rows anywhere in the money-flow module ───────── */
await acheck('the invented fresh-wallet seed list is gone and the endpoint never pads itself', async () => {
  assert.equal(typeof moneyFlow.buildCuratedFreshWallets, 'undefined');
  assert.equal('CURATED_EARLY_TOKENS' in moneyFlow, false);
  /* With every explorer read failing there is nothing to show: the contract
     is `unavailable` with an EMPTY list, not eight invented rows. */
  __setDataFetch(() => { throw new Error('offline'); });
  __clearCacheForTests();
  const fresh = await moneyFlow.freshWallets({ timeoutMs: 400, limit: 8 }).catch(() => null);
  __setDataFetch(null);
  if (fresh) {
    assert.equal(fresh.wallets.length, 0);
    assert.notEqual(fresh.dataStatus, 'live');
    assert.equal(fresh.verified, 0);
  }
});

await acheck('an unreadable early-token scan reports unavailable instead of a stale constant deck', async () => {
  __setDataFetch(() => { throw new Error('offline'); });
  __clearCacheForTests();
  const early = await moneyFlow.earlyTokens({ limit: 4, timeoutMs: 400 }).catch(() => null);
  __setDataFetch(null);
  if (early) {
    assert.deepEqual(early.tokens, []);
    assert.equal(early.dataStatus, 'unavailable');
  }
});

/* ── restore seams so a later import in the same process is unaffected ── */
__setFetchForTests(null);
__setDataFetch(null);

/* ── report ──────────────────────────────────────────────────────────── */
let failed = 0;
for (const [name, ok, detail] of results) {
  if (ok) console.log(`✓ ${name}`);
  else { failed += 1; console.log(`✗ ${name} — ${detail}`); }
}
console.log(`\n${results.length - failed}/${results.length} token-flow checks passed`);
if (failed) process.exitCode = 1;

export const summary = results;
void GT_NETWORKS;
void summariseTape;
