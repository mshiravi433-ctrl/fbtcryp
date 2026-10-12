/**
 * CONTRACT → PRICE — the quotes behind the tokenized-stock board on /stocks.
 *
 * Asked for as «تب سهام توکنیزه ۲۰۰ توکن جدید، بدون قیمت خورده». The board listed
 * ~200 real contracts and priced almost none of them, because its only quote was
 * the company's SHARE price matched by TICKER against a ~40-name feed. This
 * suite pins the layer that replaces that, on both sides of the wire:
 *
 *   · the server resolves the price BY CONTRACT (address → CoinGecko id → price)
 *     and never by symbol — the same impersonation rule server/coinIndex.js and
 *     lib/coinId.js already enforce. A contract that resolves to nothing gets
 *     null, not a neighbour's price;
 *   · 0, NaN and a missing field are all "we did not read a price". Printing
 *     $0.00 would read as a collapsed asset;
 *   · a batch that fails leaves the tokens it could not price as nulls and
 *     reports `upstreamError`, so the client can tell "not listed" from "feed
 *     down" — those two deserve different screens;
 *   · prices are cached by id for seconds, so a second screen (or a second
 *     request in the same second) does not re-ask the upstream;
 *   · the CLIENT falls back to CoinGecko directly when our backend is down, and
 *     returns an empty map — never a throw — when both fail.
 *
 * No network: every upstream is stubbed, which is also how the failure paths get
 * exercised at all.
 *
 * Run with:  node --test test/stock-prices.test.mjs
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ID_BATCH,
  MAX_ADDRESSES,
  _resetStockPriceCache,
  chunk,
  normalizeAddresses,
  priceTokensByAddress,
  readPrice,
  shapePrices
} from '../server/stockPrices.js';
import { PLATFORM_SLUGS, _resetIndex } from '../server/coinIndex.js';
import {
  addressesOf,
  clearStockTokenPrices,
  clearStockTokenPricesFor,
  loadStockTokenPrices
} from '../src/lib/stockPrices.js';

/* Two real Robinhood Chain contracts, verbatim from test/stock-tokens.test.mjs. */
const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec';
const TSLA = '0x322f0929c4625ed5bad873c95208d54e1c003b2d';

const LIST = [
  { id: 'nvidia-token', platforms: { robinhood: NVDA } },
  { id: 'tesla-token', platforms: { robinhood: TSLA } },
  /* Another chain's contract must never answer for this one. */
  { id: 'nvidia-eth', platforms: { ethereum: NVDA } }
];

/** Install a fetch that answers the two upstreams this feature reads. */
function stubFetch({ prices = {}, listRows = LIST, failList = false, failPrices = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/coins/list')) {
      if (failList) throw new Error('list down');
      return { ok: true, status: 200, json: async () => listRows };
    }
    if (u.includes('/simple/price')) {
      if (failPrices) throw new Error('prices down');
      return { ok: true, status: 200, json: async () => prices };
    }
    if (u.includes('/stock-prices')) {
      const q = new URL(u, 'https://x.test');
      const addrs = String(q.searchParams.get('addresses') || '').split(',').filter(Boolean);
      const out = { chainId: 4663, prices: {} };
      for (const a of addrs) out.prices[a] = a === NVDA ? { id: 'nvidia-token', price: 187.43, change24h: 1.8, usd: 187.43, usd_24h_change: 1.8 } : null;
      return { ok: true, status: 200, json: async () => out };
    }
    if (u.includes('/simple/token_price/')) {
      return { ok: true, status: 200, json: async () => ({ [NVDA]: { usd: 180, usd_24h_change: -0.5 } }) };
    }
    throw new Error(`unstubbed URL: ${u}`);
  };
  return calls;
}

const realFetch = globalThis.fetch;
const restore = () => { globalThis.fetch = realFetch; };

describe('the price layer — pure rules', () => {
  it('normalises addresses, drops what it cannot parse and never guesses', () => {
    assert.deepEqual(normalizeAddresses([`0x${'A'.repeat(40)}`, 'nope', '/', null, `0x${'a'.repeat(40)}`]), [`0x${'a'.repeat(40)}`]);
    assert.deepEqual(normalizeAddresses(','), []);
    assert.deepEqual(normalizeAddresses(undefined), []);
    /* A comma-joined query string reads the same as an array. */
    assert.equal(normalizeAddresses(`${NVDA},${TSLA}`).length, 2);
    /* Capped, so one caller cannot turn this into a bulk scraper. */
    const many = Array.from({ length: MAX_ADDRESSES + 40 }, (_, i) => `0x${String(i).padStart(40, '0')}`);
    assert.equal(normalizeAddresses(many).length, MAX_ADDRESSES);
  });

  it('slices into fixed batches and drops nothing', () => {
    const list = Array.from({ length: 105 }, (_, i) => i);
    const groups = chunk(list, ID_BATCH);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].length, ID_BATCH);
    assert.equal(groups.at(-1).length, 105 - ID_BATCH * 2);
    assert.deepEqual(groups.flat(), list);
    assert.deepEqual(chunk([], 10), []);
  });

  it('a price of 0, a missing field or a NaN is NOT a price', () => {
    assert.deepEqual(readPrice({ usd: 187.43, usd_24h_change: 1.8 }), { price: 187.43, change24h: 1.8 });
    /* A missing 24h change is null — the chip is not drawn — but the price stands. */
    assert.deepEqual(readPrice({ usd: 12 }), { price: 12, change24h: null });
    assert.equal(readPrice({ usd: 0 }), null);
    assert.equal(readPrice({ usd: 'NaN' }), null);
    assert.equal(readPrice({ usd: null }), null);
    assert.equal(readPrice({}), null);
    assert.equal(readPrice(undefined), null);
    /* A negative "price" is not a price either. */
    assert.equal(readPrice({ usd: -4 }), null);
  });

  it('every requested contract appears in the answer, priced or null', () => {
    const ids = { [NVDA]: 'nvidia-token', [TSLA]: null, [`0x${'b'.repeat(40)}`]: 'ghost' };
    const out = shapePrices(ids, { 'nvidia-token': { usd: 187.43, usd_24h_change: 1.8 } });
    assert.deepEqual(Object.keys(out).sort(), Object.keys(ids).sort());
    assert.equal(out[NVDA].price, 187.43);
    assert.equal(out[TSLA], null);
    /* An id with no row is a null, not an absent key: the card prints «—» for
       one and the other would be indistinguishable from a bug on our side. */
    assert.equal(out[`0x${'b'.repeat(40)}`], null);
    assert.deepEqual(shapePrices({}, {}), {});
  });
});

describe('the price layer — the live path', () => {
  beforeEach(() => {
    _resetIndex();
    _resetStockPriceCache();
  });

  it('prices a real contract by ADDRESS, and leaves the unpriced ones null', async () => {
    stubFetch({ prices: { 'nvidia-token': { usd: 187.43, usd_24h_change: 1.8 } } });
    try {
      const unknown = `0x${'c'.repeat(40)}`;
      const out = await priceTokensByAddress(4663, [NVDA, TSLA, unknown]);
      assert.equal(out.chainId, 4663);
      assert.equal(out.prices[NVDA].price, 187.43);
      assert.equal(out.prices[NVDA].change24h, 1.8);
      /* TSLA resolved to a coin id CoinGecko has no price for; the unknown
         contract resolved to nothing at all. Both are null, and the counters
         tell the two apart. */
      assert.equal(out.prices[TSLA], null);
      assert.equal(out.prices[unknown], null);
      assert.equal(out.priced, 1);
      assert.equal(out.unpriced, 1);
      assert.equal(out.upstreamError, null);
      assert.equal(PLATFORM_SLUGS[4663], 'robinhood');
    } finally {
      restore();
    }
  });

  it('never prices a contract from another chain off this chain\'s list', async () => {
    /* The same address exists on Ethereum in the fixture. Only the robinhood
       platform entry may answer for chain 4663. */
    stubFetch({ prices: { 'nvidia-token': { usd: 187.43 } } });
    try {
      const out = await priceTokensByAddress(4663, [NVDA]);
      assert.equal(out.prices[NVDA].id, 'nvidia-token');
      assert.equal(out.indexedOnChain, 2);
    } finally {
      restore();
    }
  });

  it('reuses a price for a few seconds instead of re-asking upstream', async () => {
    const calls = stubFetch({ prices: { 'nvidia-token': { usd: 187.43 } } });
    try {
      await priceTokensByAddress(4663, [NVDA]);
      const afterFirst = calls.filter((u) => u.includes('/simple/price')).length;
      await priceTokensByAddress(4663, [NVDA]);
      const afterSecond = calls.filter((u) => u.includes('/simple/price')).length;
      assert.equal(afterFirst, 1);
      assert.equal(afterSecond, 1, 'the second call must be served from the price cache');
      /* And past the TTL it asks again. */
      await priceTokensByAddress(4663, [NVDA], { now: Date.now() + 10 * 60_000 });
      assert.equal(calls.filter((u) => u.includes('/simple/price')).length, 2);
    } finally {
      restore();
    }
  });

  it('a dead price feed is reported, not silently turned into a wrong number', async () => {
    stubFetch({ failPrices: true });
    try {
      const out = await priceTokensByAddress(4663, [NVDA, TSLA]);
      assert.equal(out.prices[NVDA], null);
      assert.equal(out.prices[TSLA], null);
      assert.ok(out.upstreamError, 'the caller must be able to tell the feed failed');
      assert.equal(out.priced, 0);
    } finally {
      restore();
    }
  });

  it('refuses a chain it has no platform slug for, and an empty request', async () => {
    try {
      stubFetch();
      assert.deepEqual(await priceTokensByAddress(999999, [NVDA]), { error: 'UNSUPPORTED_CHAIN' });
      assert.deepEqual(await priceTokensByAddress(4663, []), { error: 'NO_ADDRESSES' });
      assert.deepEqual(await priceTokensByAddress(4663, ['not-an-address']), { error: 'NO_ADDRESSES' });
    } finally {
      restore();
    }
  });

  it('an unreachable id index throws, so the route can answer 502 and the client can fall back', async () => {
    stubFetch({ failList: true });
    try {
      await assert.rejects(() => priceTokensByAddress(4663, [NVDA]));
    } finally {
      restore();
    }
  });
});

describe('the price layer — the client', () => {
  beforeEach(() => {
    clearStockTokenPrices();
  });

  it('reads prices for token objects and bare addresses alike', () => {
    assert.deepEqual(addressesOf([{ address: NVDA }, TSLA, 'junk']), [NVDA, TSLA]);
    assert.deepEqual(addressesOf([]), []);
    assert.deepEqual(addressesOf(undefined), []);
  });

  it('asks our backend first and returns prices keyed by contract', async () => {
    const calls = stubFetch();
    try {
      const out = await loadStockTokenPrices([{ address: NVDA }, { address: TSLA }]);
      assert.equal(out[NVDA].price, 187.43);
      assert.equal(out[NVDA].source, 'market');
      /* The card only cares that TSLA has no price: the key is simply absent. */
      assert.equal(out[TSLA], undefined);
      assert.ok(calls.some((u) => u.includes('/stock-prices')));
      assert.ok(!calls.some((u) => u.includes('simple/token_price')));
    } finally {
      restore();
    }
  });

  it('falls back to the public feed when the backend is unreachable', async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/stock-prices') || u.includes('/simple/price')) throw new Error('backend down');
      return { ok: true, status: 200, json: async () => ({ [NVDA]: { usd: 180, usd_24h_change: -0.5 } }) };
    };
    try {
      const out = await loadStockTokenPrices([NVDA]);
      assert.ok(calls.some((u) => u.includes('simple/token_price/robinhood')));
      assert.equal(out[NVDA].price, 180);
      assert.equal(out[NVDA].change24h, -0.5);
    } finally {
      restore();
    }
  });

  it('never throws when both sources fail — the board keeps its reference prices', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    try {
      assert.deepEqual(await loadStockTokenPrices([NVDA, TSLA]), {});
      assert.deepEqual(await loadStockTokenPrices([]), {});
      assert.deepEqual(await loadStockTokenPrices(['nonsense']), {});
    } finally {
      restore();
    }
  });

  it('reuses what it already read, and can be told to forget it', async () => {
    const calls = stubFetch();
    try {
      await loadStockTokenPrices([NVDA]);
      const first = calls.length;
      await loadStockTokenPrices([NVDA]);
      assert.equal(calls.length, first, 'a second read inside the TTL must not hit the network');
      clearStockTokenPricesFor(4663);
      await loadStockTokenPrices([NVDA]);
      assert.ok(calls.length > first);
    } finally {
      restore();
    }
  });
});
