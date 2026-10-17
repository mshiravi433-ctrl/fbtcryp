/**
 * THE TOKENIZED-STOCK UNIVERSE — the Robinhood Chain rail on /stocks.
 *
 * Asked for as «تعداد توکنهای صفحه سهام — توکنهای توکنیزه و RWA — خیلی کمه …
 * اعداد را خیلی بیشتر کن». The rail that answers it reads ~200 contracts out of
 * Uniswap's own default token list (lib/stockTokens.js). That list is someone
 * else's file on someone else's CDN, so the parts that decide WHAT GETS SHOWN
 * and WHERE THE BUY BUTTON GOES are pinned here against real list rows rather
 * than re-discovered in production:
 *
 *   · a row from another chain, a malformed address, a missing symbol or a
 *     duplicated address is DROPPED — never repaired, never guessed at;
 *   · an equity gets a ticker logo from the parqet CDN the curated Robinhood
 *     rows already use, a chain-native token does not (its symbol is not a
 *     company);
 *   · the buy link is the SAME /swap?chain=4663&from=USDG&toAddress=… contract
 *     lib/rwaTokens.js builds, because «خرید» on this rail must land on the
 *     screen that prints the recipient contract before anything is signed;
 *   · the loader NEVER throws: an unreachable CDN is an empty section, not a
 *     fabricated row and not a crash on the tab the user is reading.
 *
 * No network, no browser. Run with:  node --test test/stock-tokens.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_NAME,
  ROBINHOOD_COUNTER,
  equityCount,
  isEquityToken,
  loadStockTokenUniverse,
  normalizeStockList,
  referencePriceFor,
  stockTokenSwapUrl
} from '../src/lib/stockTokens.js';

/*
 * REAL ROWS, verbatim from Uniswap's default token list — the same JSON
 * `normalizeStockList` consumes in production (`src/tokens/robinhood.json`,
 * fetched 2026-10-12; the CDN copy that tokens.uniswap.org serves is the same
 * shape). Three equities, one ETF, and three chain-native tokens whose symbols
 * must NOT be read as companies.
 */
const REAL_ROWS = [
  { chainId: 4663, address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', name: 'NVIDIA', symbol: 'NVDA', decimals: 18 },
  { chainId: 4663, address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', name: 'Tesla', symbol: 'TSLA', decimals: 18 },
  { chainId: 4663, address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', name: 'SPDR S&P 500 ETF Trust', symbol: 'SPY', decimals: 18 },
  {
    chainId: 4663,
    address: '0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4',
    name: 'Coinbase Wrapped BTC',
    symbol: 'cbBTC',
    decimals: 8,
    logoURI: 'https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp?1726136727'
  },
  {
    chainId: 4663,
    address: '0x39dBED3a2bd333467115dE45665cC57F813C4571',
    name: 'Pons',
    symbol: 'PONS',
    decimals: 18,
    logoURI: 'https://coin-images.coingecko.com/coins/images/102174571/large/pons.png'
  }
];

/** The file on the CDN is a tokenlists.org object; the repo file is a bare array. */
const payload = (rows) => ({ name: 'Uniswap Default List', tokens: rows });

describe('the Robinhood Chain stock universe', () => {
  it('reads the chain the app swaps on, and names it the same way', () => {
    assert.equal(ROBINHOOD_CHAIN_ID, 4663);
    assert.equal(ROBINHOOD_CHAIN_NAME, 'Robinhood Chain');
    /* The buy's counter leg must be the chain's own stable — the same one
       lib/rwaTokens.js pairs with every curated Robinhood row. */
    assert.equal(ROBINHOOD_COUNTER, 'USDG');
  });

  it('takes the equities out of a real list payload', () => {
    const tokens = normalizeStockList(payload(REAL_ROWS));
    assert.equal(tokens.length, REAL_ROWS.length);
    assert.equal(equityCount(tokens), 3);
    assert.deepEqual(tokens.filter((t) => t.equity).map((t) => t.symbol).sort(), ['NVDA', 'SPY', 'TSLA']);
  });

  it('never labels a chain-native token as an equity', () => {
    const tokens = normalizeStockList(payload(REAL_ROWS));
    const native = Object.fromEntries(tokens.map((t) => [t.symbol, t]));
    assert.equal(native.cbBTC.equity, false);
    assert.equal(native.PONS.equity, false);
    /* And the reverse rule: a chain token keeps whatever logo the list gave it
       and is never handed a COMPANY logo. cbBTC's symbol uppercased is CBBTC,
       which is on the exclusion list precisely so this cannot happen. */
    assert.equal(native.cbBTC.logoURI, 'https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp?1726136727');
    assert.ok(!String(native.PONS.logoURI).includes('parqet'));
  });

  it('gives every equity artwork that identifies the company', () => {
    const tokens = normalizeStockList(payload(REAL_ROWS));
    for (const symbol of ['NVDA', 'TSLA', 'SPY']) {
      const row = tokens.find((t) => t.symbol === symbol);
      assert.equal(row.logoURI, `https://assets.parqet.com/logos/symbol/${symbol}`);
    }
  });

  it('marks every row unverified and carries the source it came from', () => {
    const tokens = normalizeStockList(payload(REAL_ROWS));
    assert.ok(tokens.every((t) => t.verified === false));
    assert.ok(tokens.every((t) => t.source === 'uniswap-default-list'));
    assert.ok(tokens.every((t) => t.chainId === 4663 && t.chainName === 'Robinhood Chain'));
    /* A row with no symbol in it would render an empty ticker and be
       unsellable, so the id must be derived from something that is present. */
    assert.ok(tokens.every((t) => /^rh-[a-z0-9]+-[0-9a-f]{6}$/.test(t.id)));
  });

  it('drops a row from another chain instead of relabelling it', () => {
    const rows = [...REAL_ROWS, { chainId: 1, address: '0x' + 'a'.repeat(40), name: 'Fake NVDA', symbol: 'NVDA', decimals: 18 }];
    const tokens = normalizeStockList(payload(rows));
    assert.equal(tokens.length, REAL_ROWS.length);
    assert.equal(tokens.filter((t) => t.symbol === 'NVDA').length, 1);
  });

  it('drops a malformed address, an empty symbol and an empty name', () => {
    const rows = [
      { chainId: 4663, address: '0xnot-an-address', name: 'Bad', symbol: 'BAD', decimals: 18 },
      { chainId: 4663, address: '/', name: 'Bad', symbol: 'BAD', decimals: 18 },
      { chainId: 4663, address: '0x' + 'b'.repeat(40), name: 'No symbol', symbol: '   ', decimals: 18 },
      { chainId: 4663, address: '0x' + 'c'.repeat(40), name: '', symbol: 'NONAME', decimals: 18 },
      { chainId: 4663, address: '0x' + 'd'.repeat(40), name: 'Good', symbol: 'GOOD', decimals: 18 }
    ];
    const tokens = normalizeStockList(payload(rows));
    assert.deepEqual(tokens.map((t) => t.symbol), ['GOOD']);
  });

  it('keeps one row per contract address, whatever case it is written in', () => {
    const rows = [
      { chainId: 4663, address: '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01', name: 'First', symbol: 'AAA', decimals: 18 },
      { chainId: 4663, address: '0xabcdef0123456789abcdef0123456789abcdef01', name: 'Second', symbol: 'AAB', decimals: 18 }
    ];
    const tokens = normalizeStockList(payload(rows));
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].symbol, 'AAA');
  });

  it('falls back to 18 decimals rather than writing a wrong one', () => {
    const rows = [
      { chainId: 4663, address: '0x' + 'e'.repeat(40), name: 'Odd', symbol: 'ODD', decimals: 99 },
      { chainId: 4663, address: '0x' + 'f'.repeat(40), name: 'Text', symbol: 'TXT', decimals: 'eighteen' },
      { chainId: 4663, address: '0x' + '1'.repeat(40), name: 'Fine', symbol: 'FIN', decimals: 6 }
    ];
    const bySymbol = Object.fromEntries(normalizeStockList(payload(rows)).map((t) => [t.symbol, t]));
    assert.equal(bySymbol.ODD.decimals, 18);
    assert.equal(bySymbol.TXT.decimals, 18);
    assert.equal(bySymbol.FIN.decimals, 6);
  });

  it('refuses a non-https logo and never renders an empty image slot', () => {
    const rows = [
      { chainId: 4663, address: '0x' + '2'.repeat(40), name: 'Insecure', symbol: 'INS', decimals: 18, logoURI: 'http://cdn.example.test/ins.png' },
      { chainId: 4663, address: '0x' + '3'.repeat(40), name: 'Fine', symbol: 'FIN', decimals: 18, logoURI: 'https://cdn.example.test/fin.png' }
    ];
    const bySymbol = Object.fromEntries(normalizeStockList(payload(rows)).map((t) => [t.symbol, t]));
    /* An http:// image inside an https page is a mixed-content failure: the
       slot renders empty. The equity then gets its ticker logo instead. */
    assert.equal(bySymbol.INS.logoURI, 'https://assets.parqet.com/logos/symbol/INS');
    assert.equal(bySymbol.FIN.logoURI, 'https://cdn.example.test/fin.png');
  });

  it('lists equities first so the swap-ready rows are not buried', () => {
    const rows = [
      { chainId: 4663, address: '0x' + '4'.repeat(40), name: 'Zeta Coin', symbol: 'ZETA', decimals: 18 },
      { chainId: 4663, address: '0x' + '5'.repeat(40), name: 'Apple', symbol: 'AAPL', decimals: 18 },
      { chainId: 4663, address: '0x' + '6'.repeat(40), name: 'Cash Cat', symbol: 'CASHCAT', decimals: 18 }
    ];
    const tokens = normalizeStockList(payload(rows));
    assert.deepEqual(tokens.map((t) => t.symbol), ['AAPL', 'ZETA', 'CASHCAT']);
  });

  it('is pure: the payload it is handed is never written to', () => {
    const rows = JSON.parse(JSON.stringify(REAL_ROWS));
    const before = JSON.stringify(rows);
    normalizeStockList(payload(rows));
    normalizeStockList(rows);
    assert.equal(JSON.stringify(rows), before);
    /* Both shapes — the CDN object and the bare array — read the same. */
    assert.equal(normalizeStockList(payload(REAL_ROWS)).length, normalizeStockList(REAL_ROWS).length);
    /* Garbage in, empty out: it must not throw on a shape it cannot read. */
    assert.deepEqual(normalizeStockList(null), []);
    assert.deepEqual(normalizeStockList({ tokens: 'nope' }), []);
  });

  it('classifies tickers by shape, not by hope', () => {
    assert.equal(isEquityToken({ symbol: 'AAPL' }), true);
    assert.equal(isEquityToken({ symbol: 'aapl' }), true);
    assert.equal(isEquityToken({ symbol: 'BRK.B' }), true);
    assert.equal(isEquityToken({ symbol: 'SPY' }), true);
    /* Chain-native contracts: real tokens, wrong list. */
    for (const symbol of ['WETH', 'ETH', 'USDC', 'USDC.E', 'USDT', 'USDG', 'CBBTC', 'WBTC', 'WSOL', 'CASHCAT', 'PONS', 'WBT']) {
      assert.equal(isEquityToken({ symbol }), false, `${symbol} must not be called an equity`);
    }
    /* A 60-char meme symbol and a numeric one are not tickers. */
    assert.equal(isEquityToken({ symbol: 'TOOLONGSYMBOL' }), false);
    assert.equal(isEquityToken({ symbol: '123' }), false);
    assert.equal(isEquityToken({}), false);
    assert.equal(isEquityToken(null), false);
  });

  it('the buy link is the RWA row\'s own swap contract, address and all', () => {
    const nvda = normalizeStockList(payload(REAL_ROWS)).find((t) => t.symbol === 'NVDA');
    assert.equal(
      stockTokenSwapUrl(nvda, 1000),
      '/swap?chain=4663&from=USDG&to=NVDA&toAddress=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC&amount=1000'
    );
    /* No amount is no amount — not amount=0, not amount=NaN. */
    assert.equal(
      stockTokenSwapUrl(nvda),
      '/swap?chain=4663&from=USDG&to=NVDA&toAddress=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'
    );
    assert.ok(!stockTokenSwapUrl(nvda, 0).includes('amount='));
    assert.ok(!stockTokenSwapUrl(nvda, 'abc').includes('amount='));
    /* A contract we cannot read must not become a swap for a ticker some
       stranger deployed. No address, no destination: the plain swap screen. */
    assert.equal(stockTokenSwapUrl({ symbol: 'NVDA', address: 'nope' }), '/swap');
    assert.equal(stockTokenSwapUrl(null), '/swap');
    /* The address is hex and the symbol is encoded, so neither can inject a
       second parameter into the query string. */
    const hostile = stockTokenSwapUrl({ symbol: 'A&B=C', address: '0x' + '7'.repeat(40) });
    assert.ok(hostile.includes('to=A%26B%3DC'));
    assert.ok(hostile.includes(`toAddress=0x${'7'.repeat(40)}`));
  });

  it('a reference price is the SHARE quote the feed gave, or nothing at all', () => {
    const feed = [
      { symbol: 'NVDA', price: 187.43, change24h: 1.8, marketOpen: true },
      { symbol: 'SPY', price: 0, change24h: 0 },
      { symbol: 'QQQ', price: Number.NaN }
    ];
    const hit = referencePriceFor('nvda', feed);
    assert.deepEqual(hit, { price: 187.43, change24h: 1.8, marketOpen: true });
    assert.equal(referencePriceFor('NVDA', [{ symbol: 'NVDA', price: 187.43, change24h: null }]).change24h, null);
    assert.equal(referencePriceFor('BRK.B', feed), null);
    /* A zero or NaN price is an unread price. The row shows «—» — it does not
       show $0.00 as if the company had collapsed. */
    assert.equal(referencePriceFor('SPY', feed), null);
    assert.equal(referencePriceFor('QQQ', feed), null);
    assert.equal(referencePriceFor('', feed), null);
    assert.equal(referencePriceFor('NVDA', null), null);
  });

  it('the loader never throws, and caches what it read', async () => {
    const realFetch = globalThis.fetch;
    const realStorage = globalThis.localStorage;
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
    try {
      let calls = 0;
      let requested = '';
      globalThis.fetch = async (url) => {
        calls += 1;
        requested = String(url);
        return { ok: true, status: 200, json: async () => payload(REAL_ROWS) };
      };
      const first = await loadStockTokenUniverse();
      assert.equal(calls, 1);
      assert.equal(equityCount(first), 3);
      assert.match(requested, /^https:\/\//);
      /* The same tab, once more: the universe is served from memory. */
      const second = await loadStockTokenUniverse();
      assert.equal(calls, 1);
      assert.equal(second.length, first.length);

      /* A dead CDN is an empty list — the section then says so — and never a
         rejection that would take the Stocks tab down. */
      const dead = await loadStockTokenUniverse({ refresh: true, chainId: 999999 });
      assert.ok(Array.isArray(dead));
      assert.deepEqual(dead, []);
    } finally {
      globalThis.fetch = realFetch;
      if (realStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = realStorage;
    }
  });

  it('reads ONE https list, and caches under the prefix the app clears', () => {
    /*
     * Three contracts with the rest of the app, all of them invisible from the
     * rendered screen and therefore pinned here:
     *
     *  1. The source is Uniswap's own list over https — the header promises it,
     *     and the same host already backs the swap picker's chain-1 source
     *     (lib/tokenLists.js). A downgraded or third-party URL would change
     *     what the rail claims to show.
     *  2. The cache key keeps the `fbt-tokens-` prefix: lib/dataStorage.js and
     *     lib/userDataStores.js sweep that prefix, so «پاککردن حافظه پنهان» in
     *     Settings clears this universe the way it clears every other list.
     *  3. It is a data module: no React, no JSX, so the unit suite can read it
     *     and the rules above stay testable.
     */
    const src = readFileSync(new URL('../src/lib/stockTokens.js', import.meta.url), 'utf8');
    assert.match(src, /https:\/\/tokens\.uniswap\.org/);
    assert.match(src, /const CACHE_KEY = 'fbt-tokens-/);
    assert.ok(!/from 'react'|\.jsx/.test(src));
  });
});
