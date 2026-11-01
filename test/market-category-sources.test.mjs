import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  taggedBinanceAssets, candidateCoinIds, verifiedRiskIds, createBinanceRiskSource
} from '../server/binanceRiskCategories.js';
import { fetchCategory } from '../server/providers.js';
import { MARKET_CATEGORIES, sectorFromRows } from '../src/lib/marketSectors.js';

const product = (b, an, q = 'USDT', tags = ['Seed'], st = 'TRADING') => ({ b, an, q, tags, st });
const feed = (data) => ({ code: '000000', success: true, data });
const ticker = (coin_id, base, target = 'USDT', extra = {}) => ({
  coin_id, base, target, market: { identifier: 'binance' }, is_stale: false, ...extra
});

const newCategories = {
  defi: 'decentralized-finance-defi', storage: 'storage', nft: 'non-fungible-tokens-nft',
  fanToken: 'fan-token', megadrop: 'binance-megadrop', launchpool: 'binance-launchpool',
  infrastructure: 'infrastructure', bsc: 'binance-smart-chain', payment: 'payment-solutions',
  launchpad: 'binance-launchpad'
};

test('every new category is allow-listed with its own upstream ID, and all locales have labels', () => {
  for (const [key, slug] of Object.entries(newCategories)) assert.equal(MARKET_CATEGORIES[key], slug);
  assert.equal(MARKET_CATEGORIES.monitoring, 'binance-monitoring');
  assert.equal(MARKET_CATEGORIES.seed, 'binance-seed');
  const names = [...Object.keys(newCategories), 'monitoring', 'seed'];
  const notes = ['categorySource', 'categoryRiskSource', 'categoryPartial', 'categoryStale', 'categoryLimit', 'categoryPageError', 'categoryError', 'categoryEmpty'];
  for (const lang of ['fa', 'en', 'ar', 'es', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const dict = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lang}.json`, import.meta.url)));
    for (const key of names) assert.ok(dict.market.sector[key], `${lang} missing ${key}`);
    for (const key of notes) assert.ok(dict.market[key], `${lang} missing ${key}`);
    assert.equal(dict.market.sector.nft, 'NFT');
    assert.equal(dict.market.sector.bsc, 'BSC');
  }
  assert.deepEqual(sectorFromRows('seed', [{ id: 'bitcoin', symbol: 'OG' }]), []);
  assert.deepEqual(sectorFromRows('monitoring', [{ id: 'bitcoin', symbol: 'GNS' }]), []);
});

test('Binance risk membership requires an explicit tag on a trading base, never a quote or boolean flag', () => {
  const assets = taggedBinanceAssets(feed([
    product('OG', 'OG Fan Token', 'USDT', ['fan_token', 'Seed']),
    product('OG', 'OG Fan Token', 'BTC', ['SEED']),
    product('OG', 'Imposter', 'EUR', ['Seed'], 'BREAK'),
    { ...product('NONE', 'Not tagged', 'OG', []), sd: true, r: true },
    product('GNS', 'Gains Network', 'USDT', ['Monitoring']),
    product('CONFLICT', 'First Name'), product('CONFLICT', 'Second Name'),
    product('SUSPEND', 'Suspended', 'USDT', ['Seed'], 'BREAK')
  ]), 'seed');
  assert.deepEqual(assets.map((a) => a.symbol), ['OG']);
  assert.deepEqual([...assets[0].quotes].sort(), ['BTC', 'USDT']);
  assert.throws(() => taggedBinanceAssets({ code: '000000', success: true, data: [{}] }, 'seed'), /UNAVAILABLE/);
  assert.throws(() => taggedBinanceAssets(feed([product('OG', 'OG')]), 'not-a-tag'), /UNAVAILABLE/);
});

test('names and symbols only nominate candidates; ambiguous or mismatched identities are excluded', () => {
  const assets = taggedBinanceAssets(feed([
    product('OG', 'OG Fan Token'), product('GNS', 'Gains Network'),
    product('SYN', 'Synapse'), product('COPY', 'Copied Name'), product('OLD', 'Old Name')
  ]), 'seed');
  const candidates = candidateCoinIds(assets, [
    { id: 'og-fan-token', symbol: 'og', name: 'OG Fan Token' },
    { id: 'gains-network', symbol: 'gains', name: 'Gains' }, // no GNS guessing
    { id: 'synapse-2', symbol: 'syn', name: 'Synapse' },
    { id: 'imposter', symbol: 'og', name: 'Different token' },
    { id: 'copy-a', symbol: 'copy', name: 'Copied Name' },
    { id: 'copy-b', symbol: 'copy', name: 'Copied Name' }, // ambiguous
    { id: 'old', symbol: 'old', name: 'New Name' }
  ]);
  assert.deepEqual(candidates.map((c) => c.id).sort(), ['og-fan-token', 'synapse-2']);
  const verified = verifiedRiskIds(candidates, [
    ticker('og-fan-token', 'OG'),
    ticker('synapse-2', 'SYN', 'USDC'), // not a tagged Binance quote pair
    ticker('synapse-2', 'SYN', 'USDT', { market: { identifier: 'another-exchange' } }),
    ticker('synapse-2', 'SYN', 'USDT', { is_stale: true }),
    ticker('imposter', 'OG'), // right symbol and pair, wrong coin_id
    ticker('synapse-2', 'NOTSYN')
  ]);
  assert.deepEqual(verified, ['og-fan-token']);
});

test('live risk lists are deduplicated, paged, currency-specific, and fail closed after an outage', async () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  let products = feed([product('AAA', 'Alpha', 'USDT', ['Seed', 'Monitoring']), product('AAA', 'Alpha', 'BTC', ['Seed']), product('BBB', 'Beta')]);
  let outage = false;
  const calls = { products: 0, tickers: 0, markets: [] };
  const source = createBinanceRiskSource({
    fetchProducts: async () => { calls.products++; if (outage) throw Error('offline'); return products; },
    fetchCatalog: async () => [{ id: 'alpha', symbol: 'aaa', name: 'Alpha' }, { id: 'beta', symbol: 'bbb', name: 'Beta' }],
    fetchTickers: async () => { calls.tickers++; return { tickers: [ticker('alpha', 'AAA'), ticker('alpha', 'AAA', 'BTC'), ticker('beta', 'BBB')] }; },
    fetchMarkets: async (ids, vs) => { calls.markets.push(vs); return ids.map((id) => ({ id, rank: id === 'alpha' ? 1 : 2, price: vs === 'eur' ? 2 : 3 })); },
    normalizeCoin: (row) => row
  });
  try {
    const [one, two] = await Promise.all([
      source('seed', { perPage: 1, page: 1 }), source('seed', { perPage: 1, page: 2 })
    ]);
    assert.deepEqual(one.map((x) => x.id), ['alpha']);
    assert.deepEqual(two.map((x) => x.id), ['beta']);
    assert.equal(one[0].classificationProvider, 'binance');
    assert.equal(calls.products, 1, 'concurrent pages share one live product request');
    assert.equal(calls.tickers, 1, 'concurrent pages share identity work');
    assert.equal(calls.markets.length, 1, 'concurrent pages share price work');
    const euro = await source('seed', { vs: 'eur' });
    assert.equal(euro[0].price, 2);
    assert.deepEqual(calls.markets, ['usd', 'eur']);

    now += 60_001;
    products = feed([product('AAA', 'Alpha', 'USDT', ['Monitoring']), product('BBB', 'Beta')]);
    assert.deepEqual((await source('seed')).map((x) => x.id), ['beta'], 'removed tags disappear on refresh');
    now += 60_001;
    outage = true;
    await assert.rejects(source('seed'), /offline/, 'an old tag is never served after a refresh fails');
  } finally { Date.now = realNow; }
});

test('the real provider wiring checks ticker identity and does not request fake CoinGecko risk categories', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const json = (body) => new Response(JSON.stringify(body), { status: 200 });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === 'www.binance.com') return json(feed([product('OG', 'OG Fan Token', 'USDT', ['Seed', 'Monitoring'])]));
    if (url.pathname.endsWith('/coins/list')) return json([{ id: 'og-fan-token', symbol: 'og', name: 'OG Fan Token' }]);
    if (url.pathname.endsWith('/exchanges/binance/tickers')) return json({ tickers: [ticker('og-fan-token', 'OG')] });
    if (url.pathname.endsWith('/coins/markets')) return json([{ id: 'og-fan-token', symbol: 'og', name: 'OG Fan Token', current_price: 1, market_cap_rank: 10 }]);
    throw new Error(`unexpected ${url}`);
  };
  try {
    const rows = await fetchCategory(MARKET_CATEGORIES.seed, { perPage: 250 });
    assert.equal(rows[0].id, 'og-fan-token');
    assert.equal(rows[0].classificationProvider, 'binance');
    assert.ok(calls.some((url) => url.pathname.endsWith('/exchanges/binance/tickers')));
    assert.ok(calls.every((url) => !url.searchParams.get('category')?.startsWith('binance-seed')));
  } finally { globalThis.fetch = original; }
});

test('each thematic provider request uses its precise CoinGecko category and supports an empty next page', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); calls.push(url);
    return new Response(JSON.stringify(url.searchParams.get('page') === '2' ? [] : [{
      id: 'real-id', symbol: 'real', name: 'Real coin', current_price: 1
    }]), { status: 200 });
  };
  try {
    for (const [key, slug] of Object.entries(newCategories)) {
      const rows = await fetchCategory(slug, { perPage: 250, page: 1 });
      assert.equal(rows[0].id, 'real-id', key);
      assert.equal(calls.at(-1).searchParams.get('category'), slug);
      assert.equal(calls.at(-1).searchParams.get('per_page'), '250');
    }
    assert.deepEqual(await fetchCategory(MARKET_CATEGORIES.defi, { page: 2 }), []);
  } finally { globalThis.fetch = original; }
});
