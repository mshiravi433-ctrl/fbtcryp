#!/usr/bin/env node
/**
 * THE NATIVE DATA BENCH MUST BE WIRED TO THE REAL SERVER MODULES.
 * ---------------------------------------------------------------------------
 * This file exists because of a regression that every other test missed.
 *
 * `server/agentHub/native/data.js` resolves its readers lazily with relative
 * imports. Those imports used to say `import('../yields.js')` — which resolves
 * to `server/agentHub/yields.js`, a file that does not exist — and
 * `import('../providers.js')`, which resolved to the AGENT REGISTRY (a module
 * with no `fetchSearch`). Nothing threw at import time, because the loaders are
 * lazy. The result in production was that every FBT-native agent answered
 * «داده خوانده نشد» / “No data was read”: the agent ran, the task completed, and
 * zero requests ever left the process.
 *
 * The suite passed because every existing test injected its own readers
 * (`createDataAccess({ overrides })`), so the DEFAULT wiring — the only wiring
 * production uses — was never called once.
 *
 * These tests therefore call `createDataAccess()` with NO overrides, stub only
 * `globalThis.fetch`, and assert:
 *   1. the call reaches the upstream host the app already audits (so the module
 *      that answered is the real provider client, not a same-named registry);
 *   2. the value has the normalised shape the agents consume;
 *   3. no reader rejects with a module-resolution error.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDataAccess } from '../../server/agentHub/native/data.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';

const json = (value) => ({
  ok: true,
  status: 200,
  json: async () => value,
  text: async () => JSON.stringify(value)
});

/** One stub for every upstream the native bench talks to. */
function upstreamFor(url) {
  if (url.includes('api.coingecko.com') && url.includes('/search')) {
    return { coins: [{ id: 'uniswap', symbol: 'uni', name: 'Uniswap', thumb: 'thumb.png', market_cap_rank: 20 }] };
  }
  if (url.includes('yields.llama.fi/pools')) {
    return {
      status: 'success',
      data: [{
        pool: 'pool-1',
        chain: 'Arbitrum',
        project: 'aave-v3',
        symbol: 'USDC',
        tvlUsd: 50_000_000,
        apy: 5,
        apyBase: 4,
        apyReward: 1,
        apyMean30d: 5,
        apyPct1D: 0,
        apyPct7D: 0,
        apyPct30D: 0,
        stablecoin: true,
        ilRisk: 'no',
        exposure: 'single',
        volumeUsd1d: 1_000_000,
        url: 'https://defillama.com/yields/pool/pool-1'
      }]
    };
  }
  if (url.includes('api.llama.fi/protocols')) {
    return [{ slug: 'aave', name: 'Aave', tvl: 1e10, category: 'Lending', chains: ['Ethereum'], url: 'https://aave.com' }];
  }
  if (url.includes('api.llama.fi/protocol/')) {
    return { slug: 'aave', name: 'Aave', tvl: 1e10, category: 'Lending', chains: ['Ethereum'] };
  }
  if (url.includes('api.llama.fi/hacks')) {
    return [{ name: 'Aave', date: '2022-11-01', amountUSD: 1000, chain: ['Ethereum'], classification: 'Oracle', link: 'https://example.com/incident' }];
  }
  if (url.includes('api.gopluslabs.io')) {
    return { code: 1, result: { [ADDRESS]: { is_honeypot: '0', buy_tax: '0', sell_tax: '0', is_open_source: '1' } } };
  }
  return {};
}

const originalFetch = globalThis.fetch;
let calls = [];

function stubUpstream() {
  calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    return json(upstreamFor(href));
  };
}

const hosts = () => [...new Set(calls.map((url) => {
  try { return new URL(url).hostname; } catch { return ''; }
}))];

afterEach(() => { globalThis.fetch = originalFetch; });

describe('native data bench wiring (no injected readers)', () => {
  it('reads coin search through the real CoinGecko client', async () => {
    stubUpstream();
    const data = createDataAccess();
    const rows = await data.searchCoins('uni');
    assert.ok(hosts().includes('api.coingecko.com'), `expected CoinGecko, saw ${hosts().join(',')}`);
    assert.deepEqual(rows.map((row) => row.symbol), ['UNI']);
    assert.equal(rows[0].id, 'uniswap');
  });

  it('reads yields, protocol catalogue, protocol detail and incidents through DefiLlama', async () => {
    stubUpstream();
    const data = createDataAccess();

    const yields = await data.yields({ timeoutMs: 4000 });
    assert.ok(Array.isArray(yields.pools) && yields.pools.length > 0);

    const protocols = await data.protocols({ timeoutMs: 4000 });
    assert.equal(protocols[0].slug, 'aave');

    const detail = await data.protocolDetail('aave', { timeoutMs: 4000 });
    assert.equal(detail.tvl, 1e10);

    const incidents = await data.incidents({ timeoutMs: 4000 });
    assert.equal(incidents[0].protocol, 'Aave');

    assert.ok(hosts().includes('yields.llama.fi'), 'yields must come from yields.llama.fi');
    assert.ok(hosts().includes('api.llama.fi'), 'protocols and incidents must come from api.llama.fi');
  });

  it('reads the contract risk report through GoPlus', async () => {
    stubUpstream();
    const data = createDataAccess();
    const out = await data.tokenRisk(1, ADDRESS);
    assert.ok(hosts().includes('api.gopluslabs.io'));
    assert.equal(out.report.honeypot, false);
  });

  it('reads token, wallet and overview intelligence through the smart-money module', async () => {
    stubUpstream();
    const data = createDataAccess();

    const intel = await data.tokenIntel(ADDRESS, 42161, { timeoutMs: 4000 });
    assert.equal(typeof intel, 'object');
    assert.ok(intel.dataStatus, 'the token read must report a data status');

    const wallet = await data.walletIntel(ADDRESS, 42161, { timeoutMs: 4000 });
    assert.equal(wallet.address.toLowerCase(), ADDRESS);

    const overview = await data.smartMoneyOverview('24h', { timeoutMs: 4000 });
    assert.ok(overview.dataStatus, 'the overview must report a data status');
  });

  it('keeps the shipped data access schema and reader names stable', async () => {
    stubUpstream();
    const data = createDataAccess();
    assert.equal(data.schema, 'fbt.agent-hub.native-data.v1');
    for (const name of [
      'searchCoins', 'coinDetail', 'candles', 'markets',
      'yields', 'protocols', 'protocolDetail', 'incidents',
      'tokenRisk', 'tokenIntel', 'topTraders', 'walletIntel', 'smartMoneyOverview'
    ]) {
      assert.equal(typeof data[name], 'function', `missing reader: ${name}`);
    }
  });
});
