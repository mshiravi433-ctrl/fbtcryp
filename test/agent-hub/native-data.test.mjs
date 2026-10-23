#!/usr/bin/env node
/** Native public-data readers: bounded fallback, real daily closes and deadlines. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKTEST_DEADLINE_MS,
  createDataAccess,
  READ_DEADLINE_MS,
  resolveCoin
} from '../../server/agentHub/native/data.js';
import { dailyCloseBarsFromChart, fetchCoinDetail } from '../../server/providers.js';
import { fetchYields } from '../../server/yields.js';
import { protocolDetail as readProtocolDetail } from '../../server/explorerData.js';
import { tokenMarkets, historicalPriceFn } from '../../server/smartMoney/pricing.js';
import { analyzeWallet } from '../../server/smartMoney/walletIntel.js';
import { analyzeToken } from '../../server/smartMoney/tokenIntel.js';
import { __setFetchForTests as setSmartMoneyFetchForTests } from '../../server/smartMoney/dataSources.js';
import { fetchWhales } from '../../server/whales.js';
import { earlyTokens, liquidityEvents } from '../../server/smartMoney/moneyFlow.js';
import { nativeAgentCatalog, runNativeAgent } from '../../server/agentHub/native/agents.js';

const day = (n) => Date.parse(`2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`);

describe('native provider data access', () => {
  it('discloses every external data source and the intent-only local path', () => {
    const catalog = nativeAgentCatalog();
    assert.ok(catalog.length >= 10);
    for (const agent of catalog) {
      assert.ok(Array.isArray(agent.dataDisclosure) && agent.dataDisclosure.length > 0, agent.slug);
      const disclosedSources = agent.dataDisclosure.map((row) => row.source);
      if (agent.dataSources.length) assert.deepEqual(disclosedSources, agent.dataSources, agent.slug);
      else assert.ok(disclosedSources.includes('Local intent only'), agent.slug);
      for (const row of agent.dataDisclosure) {
        assert.ok(row.en.length > 20 && row.fa.length > 20, `${agent.slug}:${row.source}`);
      }
    }
  });

  it('turns chat swap requests into a local draft without calling a provider', async () => {
    const forbiddenData = new Proxy({}, { get() { throw new Error('provider access is forbidden for a local swap draft'); } });
    const result = await runNativeAgent(
      'cross-chain-swap-assistant',
      { text: 'Swap 100 USDC from Arbitrum to Base' },
      forbiddenData,
      { now: () => 1234 }
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.dataStatus, 'intent');
    assert.deepEqual(result.data.chatAction, {
      type: 'cross_chain_swap',
      fromChain: 42161,
      toChain: 8453,
      fromToken: 'USDC',
      toToken: 'USDC',
      amount: '100',
      assumedDestinationToken: true
    });
    assert.match(result.text, /Nothing has been sent to LI\.FI/);
  });

  it('uses one real close per UTC day and never invents OHLC values', () => {
    const bars = dailyCloseBarsFromChart({
      prices: [
        [day(2) + 5_000, 12],
        [day(1) + 10_000, 10],
        [day(1) + 20_000, 11],
        [day(3) + 2_000, 0]
      ]
    });
    assert.deepEqual(bars, [
      { t: day(1), c: 11 },
      { t: day(2), c: 12 }
    ]);
  });

  it('uses a bounded, single-shot CoinGecko detail read and never adds an undisclosed CoinLore fallback', async () => {
    let received;
    const data = createDataAccess({}, {
      providerLoader: async () => ({
        async fetchCoinDetail(...args) { received = args; return { id: 'bitcoin', price: 1 }; }
      })
    });
    await data.coinDetail('bitcoin');
    assert.equal(received[0], 'bitcoin');
    assert.equal(received[1], 'usd');
    assert.ok(received[2].timeoutMs <= READ_DEADLINE_MS);
    assert.equal(received[2].retry, false);
    assert.equal(received[2].allowCoinLoreFallback, false);
  });

  it('aborts a timed-out CoinGecko detail request without continuing a retry or undisclosed provider fallback', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    const signals = [];
    globalThis.fetch = (url, { signal } = {}) => new Promise((_, reject) => {
      calls.push(String(url));
      signals.push(signal);
      const fail = () => reject(Object.assign(new Error('aborted upstream request'), { name: 'AbortError' }));
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail, { once: true });
    });
    try {
      await assert.rejects(fetchCoinDetail('bitcoin', 'usd', {
        timeoutMs: 300, retry: false, allowCoinLoreFallback: false
      }));
      assert.equal(calls.length, 1);
      assert.match(calls[0], /api\.coingecko\.com/);
      assert.equal(signals[0].aborted, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back from empty daily OHLC to market-chart daily closes inside one 14s read budget', async () => {
    const calls = [];
    const data = createDataAccess({}, {
      providerLoader: async () => ({
        async fetchOhlc(id, days, vs, options) {
          calls.push({ type: 'ohlc', id, days, vs, options });
          return [];
        },
        async fetchDailyCloses(id, days, vs, options) {
          calls.push({ type: 'closes', id, days, vs, options });
          return Array.from({ length: 365 }, (_, index) => ({ t: index, c: 100 + index }));
        }
      })
    });

    const bars = await data.candles('bitcoin', 365);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].type, 'ohlc');
    assert.equal(calls[0].options.retry, false);
    assert.ok(calls[0].options.timeoutMs <= 8_000);
    assert.equal(calls[1].type, 'closes');
    assert.ok(calls[1].options.timeoutMs <= READ_DEADLINE_MS);
    assert.equal(bars.length, 365);
    assert.deepEqual(bars[0], { t: 0, c: 100 });
  });

  it('falls back after a fast OHLC provider error without retrying the failed endpoint', async () => {
    const calls = [];
    const data = createDataAccess({}, {
      providerLoader: async () => ({
        async fetchOhlc(_id, _days, _vs, options) {
          calls.push(['ohlc', options]);
          const error = new Error('upstream unavailable');
          error.status = 503;
          throw error;
        },
        async fetchDailyCloses(_id, _days, _vs, options) {
          calls.push(['closes', options]);
          return [{ t: 1, c: 123 }];
        }
      })
    });
    const bars = await data.candles('ethereum', 90);
    assert.equal(bars.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][1].retry, false);
    assert.ok(calls[1][1].timeoutMs >= 250);
  });

  it('passes the shared 14s read cap to DefiLlama and bounds all Explorer feed reads', async () => {
    const yieldOptions = [];
    const feedCalls = [];
    const data = createDataAccess({}, {
      yieldsLoader: async () => ({
        async fetchYields(options) { yieldOptions.push(options); return { pools: [] }; }
      }),
      explorerLoader: async () => ({
        async llamaProtocols(options) { feedCalls.push(['protocols', options]); return { data: { protocols: [] } }; },
        async protocolDetail(slug, options) { feedCalls.push(['detail', slug, options]); return { data: { slug } }; },
        async hacksIndex(options) { feedCalls.push(['incidents', options]); return { data: { incidents: [] } }; }
      })
    });

    await data.yields();
    await data.yields({ timeoutMs: 12_000 });
    await data.protocols();
    await data.protocolDetail('aave-v3');
    await data.incidents();
    assert.deepEqual(yieldOptions, [
      { timeoutMs: READ_DEADLINE_MS },
      { timeoutMs: 12_000 }
    ]);
    assert.deepEqual(feedCalls, [
      ['protocols', { timeout: 8_500 }],
      ['detail', 'aave-v3', { timeout: 12_000 }],
      ['incidents', { timeout: 8_500 }]
    ]);
    const boundedTimeouts = [feedCalls[0][1].timeout, feedCalls[1][2].timeout, feedCalls[2][1].timeout];
    assert.ok(boundedTimeouts.every((timeout) => timeout <= READ_DEADLINE_MS));
  });

  it('forwards bounded deadlines to native Smart Money token and overview reads', async () => {
    const calls = [];
    const data = createDataAccess({}, {
      smartMoneyLoader: async () => ({
        async analyzeToken(...args) { calls.push(['token', ...args]); return { dataStatus: 'unavailable' }; },
        async getOverview(options) { calls.push(['overview', options]); return { dataStatus: 'unavailable' }; }
      })
    });
    await data.tokenIntel('0x0000000000000000000000000000000000000002', 1, { timeoutMs: 25_000 });
    await data.smartMoneyOverview('7d', { timeoutMs: 25_000 });
    assert.deepEqual(calls[0][3], { timeoutMs: READ_DEADLINE_MS });
    assert.deepEqual(calls[1][1], { window: '7d', timeoutMs: READ_DEADLINE_MS });
  });

  it('bounds Smart Money wallet token pricing and fans quote-side fallbacks out in parallel', async () => {
    const addresses = Array.from({ length: 5 }, (_, index) => `0x${String(index + 1).padStart(40, '0')}`);
    let active = 0;
    let peak = 0;
    const urls = [];
    setSmartMoneyFetchForTests(async (url) => {
      urls.push(String(url));
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      const query = new URL(String(url)).pathname.split('/').at(-1).split(',');
      const token = query.length > 1 ? addresses[0] : query[0];
      return {
        ok: true,
        async json() {
          return {
            pairs: [{
              pairAddress: `0x${'a'.repeat(40)}`,
              chainId: 'base',
              dexId: 'probe-dex',
              baseToken: { address: token, symbol: 'TOK', name: 'Probe Token' },
              quoteToken: { address: `0x${'b'.repeat(40)}`, symbol: 'USD', name: 'Probe USD' },
              priceUsd: '1.25',
              liquidity: { usd: 100_000 },
              volume: { h24: 10_000 },
              txns: { h24: { buys: 3, sells: 2 } },
              pairCreatedAt: Date.now() - 86_400_000
            }]
          };
        }
      };
    });
    try {
      const priced = await tokenMarkets(addresses, { chain: 'base', timeoutMs: 1_000, maxFallbacks: 6 });
      assert.equal(priced.size, addresses.length);
      assert.equal(urls.length, addresses.length);
      assert.ok(peak > 1, 'per-token fallback calls should run concurrently, not serially');
    } finally {
      setSmartMoneyFetchForTests(null);
    }
  });

  it('passes the same bounded read budget through Solana wallet RPC calls', async () => {
    const signals = [];
    setSmartMoneyFetchForTests(async (_url, options = {}) => {
      signals.push(options.signal);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('mock Solana RPC aborted'));
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    try {
      const result = await analyzeWallet('11111111111111111111111111111111', 'solana', { timeoutMs: 300 });
      assert.equal(result.chain, 'solana');
      assert.equal(signals.length, 3);
      assert.ok(signals.every((signal) => signal.aborted));
    } finally {
      setSmartMoneyFetchForTests(null);
    }
  });

  it('passes one read deadline to token pairs and holder enrichment', async () => {
    const signals = [];
    setSmartMoneyFetchForTests(async (_url, options = {}) => {
      signals.push(options.signal);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('mock token intel source aborted'));
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    try {
      const result = await analyzeToken('0x0000000000000000000000000000000000000091', 1, { timeoutMs: 300 });
      assert.equal(result.chainId, 1);
      assert.equal(signals.length, 3, 'one pair lookup and two Blockscout holder reads should start in parallel');
      assert.ok(signals.every((signal) => signal.aborted));
    } finally {
      setSmartMoneyFetchForTests(null);
    }
  });

  it('awaits every Solana holder request through abort before returning', async () => {
    const signals = [];
    setSmartMoneyFetchForTests(async (_url, options = {}) => {
      signals.push(options.signal);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('mock Solana holder read aborted'));
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    try {
      const result = await analyzeToken('11111111111111111111111111111111', 'solana', { timeoutMs: 300 });
      assert.equal(result.chainId, 'solana');
      assert.equal(signals.length, 3, 'DexScreener and both Solana holder calls should start in parallel');
      assert.ok(signals.every((signal) => signal.aborted));
    } finally {
      setSmartMoneyFetchForTests(null);
    }
  });

  it('aborts optional daily price history without poisoning later retries', async () => {
    const originalFetch = globalThis.fetch;
    let signal;
    globalThis.fetch = async (_url, options = {}) => {
      signal = options.signal;
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('mock history aborted'));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    };
    try {
      const probeId = `timeout-probe-${Date.now()}`;
      const priceAt = await historicalPriceFn(probeId, 90, { timeoutMs: 300 });
      assert.equal(priceAt(Date.now()), null);
      assert.equal(signal.aborted, true);
      globalThis.fetch = async () => ({ ok: true, async json() { return { prices: [[Date.now(), 5]] }; } });
      const recovered = await historicalPriceFn(probeId, 90, { timeoutMs: 300 });
      assert.equal(recovered(Date.now()), 5, 'an aborted read should not cache an unavailable result');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts whale RPC reads at the shared budget instead of continuing RPC fallbacks', async () => {
    const originalFetch = globalThis.fetch;
    const keyNames = [
      'ETHERSCAN_API_KEY', 'BSCSCAN_API_KEY', 'POLYGONSCAN_API_KEY',
      'ARBISCAN_API_KEY', 'BASESCAN_API_KEY', 'OPTIMISTIC_ETHERSCAN_API_KEY', 'SNOWTRACE_API_KEY'
    ];
    const oldKeys = Object.fromEntries(keyNames.map((key) => [key, process.env[key]]));
    for (const key of keyNames) delete process.env[key];
    const rpcRequests = [];
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes('/simple/price')) {
        return { ok: true, async json() { return { ethereum: { usd: 2000 } }; } };
      }
      rpcRequests.push(options);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('mock RPC aborted'));
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    };
    const startedAt = Date.now();
    try {
      const result = await fetchWhales({ chains: ['1'], timeoutMs: 750, limit: 1 });
      assert.ok(Date.now() - startedAt < 1500, 'the shared read budget should cap the full provider/RPC chain');
      assert.equal(rpcRequests.length, 1, 'do not try another RPC endpoint after the budget expires');
      assert.equal(rpcRequests[0].signal.aborted, true, 'the in-flight RPC request must be aborted');
      assert.equal(result.failedChains.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of keyNames) {
        if (oldKeys[key] === undefined) delete process.env[key];
        else process.env[key] = oldKeys[key];
      }
    }
  });

  it('aborts liquidity RPC scans within their shared read budget', async () => {
    const originalFetch = globalThis.fetch;
    const rpcRequests = [];
    globalThis.fetch = async (_url, options = {}) => {
      rpcRequests.push(options);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('mock liquidity RPC aborted'));
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    };
    const startedAt = Date.now();
    try {
      const result = await liquidityEvents({ timeoutMs: 750, windowBlocks: 8 });
      assert.ok(Date.now() - startedAt < 1500);
      assert.equal(result.events.length, 0);
      assert.ok(rpcRequests.length > 0 && rpcRequests.length <= 16,
        'each chain should try at most its first RPC after the shared deadline is nearly spent');
      assert.ok(rpcRequests.every((request) => request.signal.aborted));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts both early-token seed reads at their supplied timeout', async () => {
    const originalFetch = globalThis.fetch;
    const signals = [];
    globalThis.fetch = async (_url, options = {}) => {
      signals.push(options.signal);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('mock token seed aborted'));
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    };
    try {
      await earlyTokens({ limit: 1, timeoutMs: 300 });
      assert.equal(signals.length, 2);
      assert.ok(signals.every((signal) => signal.aborted));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shares one deadline between a protocol detail and its catalog lookup', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    let catalogSignal;
    globalThis.fetch = (url, { signal } = {}) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.startsWith('/protocol/') && path !== '/protocols') {
        return new Promise((resolve) => setTimeout(() => resolve({
          ok: true,
          async json() { return { name: 'Budget Probe', tvl: [] }; }
        }), 150));
      }
      catalogSignal = signal;
      return new Promise((_, reject) => {
        const fail = () => reject(Object.assign(new Error('catalog deadline reached'), { name: 'AbortError' }));
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail, { once: true });
      });
    };
    try {
      const startedAt = Date.now();
      const result = await readProtocolDetail(`native-budget-probe-${Date.now()}`, { timeout: 800 });
      const elapsed = Date.now() - startedAt;
      assert.equal(result.data.name, 'Budget Probe');
      assert.deepEqual(calls.map((path) => path === '/protocols' ? 'catalog' : 'detail'), ['detail', 'catalog']);
      assert.equal(catalogSignal.aborted, true);
      assert.ok(elapsed < 1_300, `shared read exceeded its deadline: ${elapsed}ms`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts a stalled DefiLlama request at its requested timeout', async () => {
    const originalFetch = globalThis.fetch;
    let signal;
    globalThis.fetch = (_url, options = {}) => new Promise((_, reject) => {
      signal = options.signal;
      const fail = () => reject(Object.assign(new Error('aborted upstream request'), { name: 'AbortError' }));
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail, { once: true });
    });
    try {
      await assert.rejects(fetchYields({ timeoutMs: 300 }), { name: 'AbortError' });
      assert.equal(signal.aborted, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses canonical major-coin IDs before searching and bounds unknown-coin search', async () => {
    let searches = 0;
    const local = await resolveCoin({
      async searchCoins() { searches += 1; return []; }
    }, { symbol: 'BTC', symbolCandidates: ['BTC'] });
    assert.equal(local.ok, true);
    assert.equal(local.coin.id, 'bitcoin');
    assert.equal(searches, 0);

    let seenOptions;
    const data = createDataAccess({}, {
      providerLoader: async () => ({
        async fetchSearch(_query, options) { seenOptions = options; return []; }
      })
    });
    const unknown = await resolveCoin(data, { symbol: 'ZZZCOIN', symbolCandidates: ['ZZZCOIN'] });
    assert.equal(unknown.ok, false);
    assert.deepEqual(seenOptions, { timeoutMs: 5_000, retry: false });
  });

  it('pins the public read and outer backtest budgets to 14s and 25s', () => {
    assert.equal(READ_DEADLINE_MS, 14_000);
    assert.equal(BACKTEST_DEADLINE_MS, 25_000);
  });
});
