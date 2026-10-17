import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _resetIndex } from '../server/coinIndex.js';
import {
  CHART_BATCH, _resetStockChartCache, chartTokensByAddress, readStockSparkline
} from '../server/stockCharts.js';
import {
  clearStockTokenCharts, loadStockTokenCharts, readStockChart
} from '../src/lib/stockCharts.js';

const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec';
const TSLA = '0x322f0929c4625ed5bad873c95208d54e1c003b2d';
const OTHER = `0x${'a'.repeat(40)}`;
const history = [101, 103, 102, 104, 106, 105, 109];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubServer({ failIndex = false, failMarket = false, rows = [
  // Deliberately in the OPPOSITE order of the list, with misleading symbols.
  { id: 'tesla-token', symbol: 'NVDA', sparkline_in_7d: { price: [50, 48, 46] } },
  { id: 'nvidia-token', symbol: 'TSLA', sparkline_in_7d: { price: history } },
  { id: 'other-chain', sparkline_in_7d: { price: [999, 999, 999] } }
] } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/coins/list')) {
      if (failIndex) throw new Error('index down');
      return { ok: true, json: async () => [
        { id: 'nvidia-token', platforms: { robinhood: NVDA } },
        { id: 'tesla-token', platforms: { robinhood: TSLA } },
        { id: 'other-chain', platforms: { ethereum: OTHER } }
      ] };
    }
    if (u.includes('/coins/markets')) {
      if (failMarket) throw new Error('markets down');
      return { ok: true, json: async () => rows };
    }
    throw new Error(`unexpected URL ${u}`);
  };
  return calls;
}

describe('contract-keyed token charts — server', () => {
  beforeEach(() => { _resetIndex(); _resetStockChartCache(); });

  it('refuses fabricated, broken or too-short market history', () => {
    assert.deepEqual(readStockSparkline({ sparkline_in_7d: { price: history } }), history);
    for (const series of [[], [1, 2], [1, 0, 3], [1, null, 3], [1, 'NaN', 3], [1, -4, 2]]) {
      assert.equal(readStockSparkline({ sparkline_in_7d: { price: series } }), null);
    }
    assert.equal(readStockSparkline({}), null);
    assert.equal(readStockSparkline({ sparkline_in_7d: { price: '101,103,105' } }), null);
    assert.equal(readStockSparkline({ sparkline_in_7d: { price: Array.from({ length: 200 }, (_, i) => i + 1) } }).length, 168);
  });

  it('binds the market row by id to a ROBINHOOD address, never by symbol/position/other chain', async () => {
    const calls = stubServer();
    const out = await chartTokensByAddress(4663, [NVDA.toUpperCase().replace('0X', '0x'), TSLA, OTHER]);
    assert.deepEqual(out.charts[NVDA], history);
    assert.deepEqual(out.charts[TSLA], [50, 48, 46]);
    assert.equal(out.charts[OTHER], null);
    assert.equal(out.charted, 2);
    assert.equal(out.days, 7);
    assert.equal(out.upstreamError, false);
    const market = calls.find((url) => url.includes('/coins/markets'));
    assert.ok(market.includes('sparkline=true'));
    assert.ok(market.includes('nvidia-token'));
    assert.ok(!market.includes('other-chain'));
  });

  it('caches a valid chart separately from a missing one; a feed outage does not revive an expired chart', async () => {
    const calls = stubServer({ rows: [{ id: 'nvidia-token', sparkline_in_7d: { price: history } }] });
    const now = Date.now();
    await chartTokensByAddress(4663, [NVDA, TSLA], { now });
    await chartTokensByAddress(4663, [NVDA, TSLA], { now: now + 5_000 });
    assert.equal(calls.filter((u) => u.includes('/coins/markets')).length, 1);
    await chartTokensByAddress(4663, [NVDA, TSLA], { now: now + 60_000 });
    assert.equal(calls.filter((u) => u.includes('/coins/markets')).length, 2, 'the missing chart retries sooner');
    // The successful chart expires at 10 minutes. This time the feed fails.
    stubServer({ failMarket: true });
    const out = await chartTokensByAddress(4663, [NVDA], { now: now + 11 * 60_000 });
    assert.equal(out.charts[NVDA], null);
    assert.equal(out.upstreamError, true);
  });

  it('fails closed on unsupported chains, malformed addresses and a dead index', async () => {
    stubServer({ failIndex: true });
    assert.deepEqual(await chartTokensByAddress(1, [NVDA]), { error: 'UNSUPPORTED_CHAIN' });
    assert.deepEqual(await chartTokensByAddress(4663, ['NVDA']), { error: 'NO_ADDRESSES' });
    await assert.rejects(() => chartTokensByAddress(4663, [NVDA]));
    assert.ok(CHART_BATCH <= 40);
  });
});

describe('contract-keyed token charts — browser', () => {
  beforeEach(() => clearStockTokenCharts());

  it('rejects corrupt data, rather than drawing a random or two-point line', () => {
    assert.deepEqual(readStockChart(history), history);
    assert.equal(readStockChart([1, 2]), null);
    assert.equal(readStockChart([1, Infinity, 3]), null);
    assert.equal(readStockChart([1, null, 3]), null);
    assert.equal(readStockChart(['1', 2, 3]), null);
  });

  it('reads only requested contracts and caches successful charts', async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ charts: { [NVDA]: history, [TSLA]: [0, 0, 0], [OTHER]: history } }) };
    };
    const tokens = [{ address: NVDA.toUpperCase().replace('0X', '0x') }, { address: TSLA }];
    const first = await loadStockTokenCharts(tokens);
    assert.deepEqual(first, { [NVDA]: history });
    assert.equal(first[TSLA], undefined);
    assert.equal(first[OTHER], undefined);
    assert.ok(calls[0].includes('chainId=4663'));
    await loadStockTokenCharts(tokens);
    assert.equal(calls.length, 1);
    clearStockTokenCharts();
    await loadStockTokenCharts([NVDA]);
    assert.equal(calls.length, 2);
  });

  it('never invents a chart when the backend fails or the chain is wrong', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await loadStockTokenCharts([NVDA]), {});
    assert.deepEqual(await loadStockTokenCharts([NVDA], { chainId: 1 }), {});
    assert.deepEqual(await loadStockTokenCharts(['not an address']), {});
  });
});
