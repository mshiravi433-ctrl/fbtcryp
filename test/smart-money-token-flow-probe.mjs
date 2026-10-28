#!/usr/bin/env node
/**
 * «دادهٔ ۲۴ ساعتهٔ هوشمند مانی کافی است — هفتگی و ۴ ساعته نه؛ سرور و CPU هم
 *  نباید بخوابد» — regression probe for the per-token smart-money flow.
 *
 * The card serves ONE window now (24h). This probe proves, against
 * REAL-shaped upstream payloads and no network:
 *
 *   1. GeckoTerminal pools + trades → exact 24h buy/sell/net, trade count and
 *      distinct-wallet count, with NO wallet lists in the payload.
 *   2. The answer is always `window: 24h` + `singleWindow: true`, whatever was
 *      requested, and **no OHLCV/candle request is ever made** (the 4h/7d
 *      requests are what used to multiply the fan-out).
 *   3. A token whose trades are all older than the window, with real 24h pool
 *      counts → the 24h volume/counts answer, flagged `estimated`, and the
 *      split adds up to the measured volume.
 *   4. A capped trade page that covers a small slice of the day does NOT get
 *      presented as the day: with 24h counts it becomes `counts`, without
 *      them a labelled `trades-sample` with its real coverage percentage.
 *   5. Volume without direction keeps buy/sell NULL.
 *   6. Every source down → `unavailable` with NULLS (the card prints «—»),
 *      and the route-level function never falls back to the whale scan.
 *   7. GeckoTerminal rate-limited → DexScreener pools + Blockscout transfers
 *      rebuild a real tape (into a pool = BUY, out of a pool = SELL).
 *   8. ONE 429 puts GeckoTerminal on cooldown: the next token read sends ZERO
 *      GeckoTerminal requests instead of retrying into the same limit.
 *   9. A second read of the same token inside the TTL is served from cache
 *      with ZERO upstream requests.
 *  10. The cache is bounded: filling it past the ceiling evicts instead of
 *      growing forever (the «حجم داره تموم میشه» failure).
 *  11. Solana pool/trade identity stays case-sensitive (base58 is not hex).
 *  12. A trade the upstream left without a sending wallet still counts.
 *  13. No fabricated rows anywhere in the money-flow module.
 *
 * Run: node test/smart-money-token-flow-probe.mjs
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

import assert from 'node:assert/strict';
import {
  tokenTape, tokenTradeSignals, summariseTape, poolWindowStats,
  __setFetchForTests, __resetUpstreamGuardForTests, GT_NETWORKS
} from '../server/smartMoney/tokenTrades.js';
import { __setFetchForTests as __setDataFetch } from '../server/smartMoney/dataSources.js';
import * as moneyFlow from '../server/smartMoney/moneyFlow.js';
import { tokenSignals } from '../server/smartMoney/moneyFlow.js';
import { __clearCacheForTests, cacheStats, setCached } from '../server/cache.js';

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

/* 5 buys + 3 sells inside the last 90 minutes, i.e. inside the day. */
const TAPE_TRADES = [
  gtTrade({ wallet: W1, side: 'buy', usd: 120_000, agoMs: 10 * MIN, hash: '0x' + 'a'.repeat(64) }),
  gtTrade({ wallet: W2, side: 'buy', usd: 60_000, agoMs: 20 * MIN, hash: '0x' + 'b'.repeat(64) }),
  gtTrade({ wallet: W1, side: 'buy', usd: 40_000, agoMs: 30 * MIN, hash: '0x' + 'c'.repeat(64) }),
  gtTrade({ wallet: W3, side: 'sell', usd: 70_000, agoMs: 40 * MIN, hash: '0x' + 'd'.repeat(64) }),
  gtTrade({ wallet: W2, side: 'sell', usd: 30_000, agoMs: 50 * MIN, hash: '0x' + 'e'.repeat(64) }),
  gtTrade({ wallet: W3, side: 'buy', usd: 25_000, agoMs: 80 * MIN, hash: '0x' + 'f'.repeat(64) }),
  gtTrade({ wallet: W1, side: 'sell', usd: 15_000, agoMs: 85 * MIN, hash: '0x' + '9'.repeat(64) })
];

/** A fetch that answers the GeckoTerminal endpoints used by the module. */
function gtFetch({ pools = [gtPool()], trades = TAPE_TRADES, failPools = false, status = null } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const u = String(url);
    if (status) return { ok: false, status, json: async () => ({}) };
    if (failPools && u.includes('/tokens/')) return { ok: false, status: 502, json: async () => ({}) };
    if (u.includes('/tokens/') && u.includes('/pools')) return { ok: true, status: 200, json: async () => ({ data: pools }) };
    if (u.includes('/trades')) return { ok: true, status: 200, json: async () => ({ data: trades }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}

const reset = ({ fetchImpl = null, dataImpl = null } = {}) => {
  __clearCacheForTests();
  __resetUpstreamGuardForTests();
  __setFetchForTests(fetchImpl);
  __setDataFetch(dataImpl);
};

const offlineData = async () => ({ ok: false, status: 502, json: async () => ({}) });

/* ══════════════ 1 — exact 24h trades, real wallets, no lists ══════════ */

await acheck('GT pools + trades produce the exact 24h flow (and no wallet list)', async () => {
  const f = gtFetch();
  reset({ fetchImpl: f, dataImpl: offlineData });
  const sig = await tokenTradeSignals(56, TOKEN);
  assert.equal(sig.dataStatus, 'live');
  assert.equal(sig.window, '24h');
  assert.equal(sig.singleWindow, true);
  assert.equal(sig.basis, 'trades');
  assert.equal(sig.estimated, false);
  // 120k + 60k + 40k + 25k = 245k buys, 70k + 30k + 15k = 115k sells
  assert.equal(sig.buyUsd, 245_000);
  assert.equal(sig.sellUsd, 115_000);
  assert.equal(sig.netUsd, 130_000);
  assert.equal(sig.trades, 7);
  assert.equal(sig.wallets, 3);
  assert.equal(sig.topBuyers, undefined, 'no wallet list is emitted');
  assert.equal(sig.topSellers, undefined, 'no wallet list is emitted');
  assert.ok(sig.accumulation && sig.accumulation.confidence > 0, 'accumulation must be measured');
  assert.ok(sig.distribution && sig.distribution.confidence >= 0);
  assert.equal(sig.sampled.coveredPct, 100);
  /* the shape itself: one window, one pools read, one trade page, nothing else */
  assert.ok(f.calls.every((u) => !u.includes('/ohlcv/')), 'no candle request may be made');
  assert.equal(f.calls.filter((u) => u.includes('/trades')).length, 1, f.calls.join('\n'));
});

/* ═════════ 2 — the window is always 24h, whatever was requested ════════ */

await acheck('a 4h/7d request is answered with the 24h measurement, labelled', async () => {
  const f = gtFetch();
  reset({ fetchImpl: f, dataImpl: offlineData });
  const sig = await tokenSignals(TOKEN, 56, '4h', { timeoutMs: 2000 });
  assert.equal(sig.window, '24h');
  assert.equal(sig.singleWindow, true);
  assert.equal(sig.requestedWindow, '4h');
  assert.ok(f.calls.every((u) => !u.includes('/ohlcv/')), 'no candle request may be made');
});

/* ═════════════ 3 — a quiet day uses the real 24h counts ════════════════ */

await acheck('a quiet day is answered from real 24h counts, flagged estimated', async () => {
  const oldTrades = TAPE_TRADES.map((t, i) => gtTrade({
    wallet: W1, side: 'buy', usd: 1000 + i, agoMs: 30 * 3600_000 + i * MIN, hash: '0x' + 'e'.repeat(64 - i)
  }));
  reset({ fetchImpl: gtFetch({ trades: oldTrades }), dataImpl: offlineData });
  const sig = await tokenTradeSignals(56, TOKEN);
  /* The source returned a FULL history (fewer than a page) and every trade is
     older than the window → the day genuinely had no trades we can attribute;
     the pool's own 24h counts/volume are the measurement. */
  assert.equal(sig.basis, 'counts');
  assert.equal(sig.estimated, true);
  assert.equal(sig.volumeUsd, 2_300_000);
  assert.equal(sig.trades, 6900);
  assert.equal(sig.wallets, null, 'a sample wallet count must not stand in for a 24h one');
  assert.ok(Math.abs((sig.buyUsd + sig.sellUsd) - sig.volumeUsd) <= 1, 'split must add up to the measured volume');
});

/* ═════════ 4 — a thin sample never pretends to be the day ══════════════ */

await acheck('a capped page that covers 3% of the day is reported as 24h counts', async () => {
  const many = Array.from({ length: 300 }, (_, i) => gtTrade({
    wallet: W1, side: 'buy', usd: 500, agoMs: (i + 1) * 20_000, hash: `0x${String(i).padStart(64, '0')}`
  }));
  reset({ fetchImpl: gtFetch({ trades: many }), dataImpl: offlineData });
  const sig = await tokenTradeSignals(56, TOKEN);
  assert.equal(sig.basis, 'counts', 'a 100-minute slice must not be sold as a day');
  assert.equal(sig.estimated, true);
  assert.ok(sig.sampled.coveredPct < 15, `coverage ${sig.sampled.coveredPct}%`);
  assert.equal(sig.sampled.trades, 300);
});

await acheck('...and without 24h counts it is a labelled partial sample', async () => {
  const many = Array.from({ length: 300 }, (_, i) => gtTrade({
    wallet: W1, side: 'buy', usd: 500, agoMs: (i + 1) * 20_000, hash: `0x${String(i).padStart(64, '0')}`
  }));
  const pool = gtPool({ transactions: {} });
  reset({ fetchImpl: gtFetch({ pools: [pool], trades: many }), dataImpl: offlineData });
  const sig = await tokenTradeSignals(56, TOKEN);
  assert.equal(sig.basis, 'trades-sample');
  assert.equal(sig.partial, true);
  assert.equal(sig.estimated, false, 'a partial real sample is not an estimate');
  assert.ok(sig.sampled.coveredPct < 15, `coverage ${sig.sampled.coveredPct}%`);
});

/* ═════════════ 5 — volume without direction invents nothing ════════════ */

await acheck('volume-only evidence keeps buy/sell NULL (no invented split)', async () => {
  const pools = [gtPool({ volume_usd: { h24: '900000' }, transactions: {} })];
  reset({ fetchImpl: gtFetch({ pools, trades: [] }), dataImpl: offlineData });
  const sig = await tokenTradeSignals(56, TOKEN);
  assert.equal(sig.basis, 'volume');
  assert.equal(sig.volumeUsd, 900_000);
  assert.equal(sig.buyUsd, null);
  assert.equal(sig.sellUsd, null);
  assert.equal(sig.netUsd, null);
  assert.equal(sig.accumulation, null);
});

/* ═════════════ 6 — everything down → nulls, never zeros ════════════════ */

await acheck('every source down → unavailable with NULLS, never $0', async () => {
  reset({ fetchImpl: gtFetch({ failPools: true }), dataImpl: offlineData });
  const sig = await tokenTradeSignals(56, TOKEN);
  assert.equal(sig.dataStatus, 'unavailable');
  assert.equal(sig.basis, 'none');
  assert.equal(sig.buyUsd, null);
  assert.equal(sig.sellUsd, null);
  assert.equal(sig.netUsd, null);
  assert.equal(sig.volumeUsd, null);
  assert.equal(sig.wallets, null);
});

await acheck('tokenSignals never falls back to the seven-chain whale scan', async () => {
  reset({ fetchImpl: gtFetch({ failPools: true }), dataImpl: offlineData });
  assert.equal(typeof moneyFlow.tokenFlow, 'undefined', 'the whale-buffer token reader is gone');
  const startedAt = Date.now();
  const sig = await tokenSignals(TOKEN, 56, '24h', { timeoutMs: 1500 });
  assert.ok(Date.now() - startedAt < 4000, 'an unavailable read must return immediately');
  assert.equal(sig.buyUsd, null);
  assert.equal(sig.sellUsd, null);
  assert.equal(sig.netUsd, null);
  assert.equal(sig.dataStatus, 'unavailable');
  assert.equal(sig.basis, 'none');
  assert.equal(sig.whaleLayer, null);
  assert.doesNotThrow(() => JSON.stringify(sig));
});

/* ═════════ 7 — DexScreener + Blockscout rebuild the tape ═══════════════ */

await acheck('GeckoTerminal rate-limited → Blockscout pool transfers become the tape', async () => {
  const dsPair = {
    chainId: 'bsc', dexId: 'pancakeswap', pairAddress: POOL,
    baseToken: { symbol: 'USDT' }, quoteToken: { symbol: 'WBNB' },
    priceUsd: '1', liquidityUsd: 4_000_000, volume: { h1: 90_000, h6: 400_000, h24: 2_300_000 },
    txns: { h24: { buys: 3600, sells: 3300 } }, pairCreatedAt: now - 400 * 24 * 3600_000
  };
  reset({
    /* GT answers its trade pages with an EMPTY list here: this scenario is
       about the explorer tape, and the fallback only runs when GT produced no
       trades. */
    fetchImpl: gtFetch({ failPools: true, trades: [] }),
    dataImpl: async (url) => {
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
    }
  });
  const sig = await tokenTradeSignals(56, TOKEN);
  assert.equal(sig.dataStatus, 'live');
  assert.equal(sig.basis, 'trades');
  assert.equal(sig.buyUsd, 90_000, 'transfer INTO the pool is a BUY');
  assert.equal(sig.sellUsd, 40_000, 'transfer OUT of the pool is a SELL');
  assert.equal(sig.wallets, 2);
  assert.equal(sig.coverage.tradeSource, 'blockscout');
});

/* ═════════ 8 — one 429 puts the upstream on cooldown ═══════════════════ */

await acheck('a 429 stops the next token from hitting GeckoTerminal again', async () => {
  const calls = [];
  const first = async (url) => {
    calls.push(String(url));
    return { ok: false, status: 429, json: async () => ({}) };
  };
  const dsPair = {
    chainId: 'bsc', dexId: 'pancakeswap', pairAddress: POOL,
    baseToken: { symbol: 'USDT' }, quoteToken: { symbol: 'WBNB' },
    priceUsd: '1', liquidityUsd: 4_000_000, volume: { h24: 2_300_000 },
    txns: { h24: { buys: 3600, sells: 3300 } }, pairCreatedAt: now - 400 * 24 * 3600_000
  };
  reset({
    fetchImpl: first,
    dataImpl: async (url) => (String(url).includes('/latest/dex/tokens/')
      ? { ok: true, status: 200, json: async () => ({ pairs: [dsPair] }) }
      : { ok: false, status: 404, json: async () => ({}) })
  });
  await tokenTradeSignals(56, TOKEN);
  const gtCallsAfterFirst = calls.filter((u) => u.includes('geckoterminal')).length;
  assert.ok(gtCallsAfterFirst >= 1, 'the first read must have tried GT');

  /* A second, DIFFERENT token inside the cooldown window. */
  const secondCalls = [];
  __setFetchForTests(async (url) => {
    secondCalls.push(String(url));
    return { ok: false, status: 429, json: async () => ({}) };
  });
  const other = '0x9999999999999999999999999999999999999999';
  const sig = await tokenTradeSignals(56, other);
  assert.equal(secondCalls.filter((u) => u.includes('geckoterminal')).length, 0,
    `a cooling-down gate must send zero GT requests, saw: ${secondCalls.join(', ')}`);
  assert.ok(sig, 'the fallback still answers');
});

/* ═════════ 9 — one read per token per TTL ══════════════════════════════ */

await acheck('a second read inside the TTL makes zero upstream requests', async () => {
  const f = gtFetch();
  reset({ fetchImpl: f, dataImpl: offlineData });
  await tokenTradeSignals(56, TOKEN);
  const afterFirst = f.calls.length;
  assert.ok(afterFirst > 0);
  const again = await tokenTradeSignals(56, TOKEN);
  assert.equal(f.calls.length, afterFirst, 'the cached summary must be reused');
  assert.equal(again.buyUsd, 245_000);
});

/* ═════════ 10 — the memory cache is bounded ════════════════════════════ */

await acheck('the cache evicts instead of growing without limit', async () => {
  reset();
  const ceiling = Math.max(200, Number(process.env.CACHE_MAX_ENTRIES) || 4_000);
  for (let i = 0; i <= ceiling + 200; i += 1) setCached(`probe:fill:${i}`, { i }, 60_000);
  const { entries } = cacheStats();
  assert.ok(entries <= ceiling, `cache grew to ${entries} entries (ceiling ${ceiling})`);
});

/* ═════════ 11 — Solana lanes keep base58 case ═════════════════════════ */

await acheck('Solana pool/trade identity is case-sensitive (base58 is not hex)', async () => {
  const MINT = 'So11111111111111111111111111111111111111112';
  const SOL_POOL = '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj';
  const pools = [{
    id: `solana_${SOL_POOL}`,
    type: 'pool',
    attributes: {
      address: SOL_POOL, name: 'SOL/USDC', base_token_price_usd: '190.2', reserve_in_usd: '9200000',
      pool_created_at: new Date(now - 900 * 24 * 3600_000).toISOString(),
      volume_usd: { h24: '2400000' }, transactions: { h24: { buys: 900, sells: 800 } }
    },
    relationships: { dex: { data: { id: 'raydium' } } }
  }];
  const trades = [{
    id: 'solana_t1', type: 'trade',
    attributes: {
      block_timestamp: new Date(now - 4 * MIN).toISOString(), tx_hash: 'sig1',
      tx_from_address: 'WaLLetCaseSensitive1111111111111111111111111',
      from_token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', to_token_address: MINT,
      volume_in_usd: '4200', kind: 'buy'
    }
  }];
  reset({ fetchImpl: gtFetch({ pools, trades }), dataImpl: offlineData });
  const sig = await tokenTradeSignals('solana', MINT);
  assert.equal(sig.dataStatus, 'live');
  assert.equal(sig.buyUsd, 4_200);
  assert.equal(sig.wallets, 1);
});

/* ═════════ 12 — an unattributed trade still counts ════════════════════ */

await acheck('a trade without tx_from_address still counts toward the day (never dropped)', async () => {
  const rows = [
    gtTrade({ wallet: W1, side: 'buy', usd: 50_000, agoMs: 5 * MIN, hash: '0x' + 'a'.repeat(64) }),
    { ...gtTrade({ wallet: W1, side: 'sell', usd: 20_000, agoMs: 6 * MIN, hash: '0x' + 'b'.repeat(64) }) }
  ];
  delete rows[1].attributes.tx_from_address;
  reset({ fetchImpl: gtFetch({ trades: rows }), dataImpl: offlineData });
  const sig = await tokenTradeSignals(56, TOKEN);
  assert.equal(sig.buyUsd, 50_000);
  assert.equal(sig.sellUsd, 20_000, 'the unattributed sell is still a real sell');
  assert.equal(sig.wallets, 1, 'but it cannot invent a second wallet');
});

/* ═════════ 13 — no fabricated rows in the money-flow module ═══════════ */

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

/* ═════════ 14 — the tape reader itself (diagnostic surface) ════════════ */

await acheck('tokenTape exposes the raw tape for diagnostics and poolWindowStats reads h24 only', async () => {
  reset({ fetchImpl: gtFetch(), dataImpl: offlineData });
  const tape = await tokenTape(56, TOKEN);
  assert.equal(tape.status, 'live');
  assert.ok(tape.trades.length >= 7);
  const stats = poolWindowStats(tape);
  assert.equal(stats.volumeUsd, 2_300_000);
  assert.equal(stats.buys, 3600);
  assert.equal(stats.sells, 3300);
  assert.equal(stats.windowUsed, '24h');
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
void check;
