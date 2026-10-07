/**
 * OSTIUM SUBGRAPH GATEWAY — THE DOOR THAT WAS SHUT
 * ---------------------------------------------------------------------------
 * What broke in production: the «افق جهانی» tab (Stocks → Ostium) and the
 * futures provider list both read the market catalogue from the builder
 * gateway's GraphQL route (`POST /v1/subgraph/gn`). That gateway is stricter
 * than a plain Graph node, and every query this app sent carried
 * `subgraphError: allow` — copied from @ostium/builder-sdk 0.7.0. The gateway
 * refuses the argument: the request comes back as an HTTP error, the server
 * proxy reports `OSTIUM_UPSTREAM_502`, and the market list collapses to
 * "feed unavailable — trading disabled" while `/v1/prices` on the SAME host
 * keeps answering. That asymmetry is the fingerprint: the feed was never
 * down, one route to it was.
 *
 * The SDK's own 0.10.0 release (2026-10-06) dropped `subgraphError: allow`
 * from every query for the same reason, so the fix here is not a guess: it is
 * the vendor's own shape, plus a second door (the public deployment the
 * official python SDK reads) so a future gateway change cannot empty the
 * screen again.
 *
 * This test pins all three things:
 *   1. no query in this repo asks for `subgraphError: allow` any more;
 *   2. a refused gateway read retries the same query against the fallback and
 *      returns its data;
 *   3. when both doors fail, the error a caller sees is the gateway's own
 *      (`OSTIUM_UPSTREAM_502`) — never a silent empty catalogue.
 *
 * No network: `fetch` is stubbed throughout, which also means this runs in CI
 * where egress is off.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { memoryStore } from '../server/cache.js';
import { fetchOstiumSubgraph, OSTIUM_SUBGRAPH_FALLBACK } from '../server/ostium.js';
import { readMarkets } from '../server/futures/adapters/ostium.js';

const SUBGRAPH_URL = 'https://builder.prod.bedrock.ostium.io/v1/subgraph/gn';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

const PAIRS = [{
  id: '7',
  from: 'XAU',
  to: 'USD',
  maxLeverage: '2000',
  overnightMaxLeverage: '1000',
  takerFeeP: '60',
  makerFeeP: '30',
  longOI: '1250000000000',
  shortOI: '900000000',
  maxOI: '5000000000000',
  lastFundingRate: '10000000000000',
  curRollover: '0',
  group: { name: 'Metals', maxLeverage: '2000' },
  fee: { minLevPos: '10000000' }
}];

const PRICES = [{
  pair: 'XAU-USD',
  from: 'XAU',
  to: 'USD',
  bid: 4119.5,
  mid: 4120.85,
  ask: 4121.12,
  isMarketOpen: true,
  isDayTradingClosed: false,
  timestampSeconds: 1_791_375_623
}];

const stubFetch = (handler) => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body || null, headers: init.headers || {} };
    calls.push(call);
    return handler(call, calls.length);
  };
  return calls;
};

afterEach(() => { memoryStore.clear(); });

describe('the queries this repo sends', () => {
  it('never ask the strict gateway for subgraphError: allow', () => {
    for (const file of ['src/lib/ostium.js', 'server/futures/adapters/ostium.js']) {
      /* Comments in these files name the argument on purpose (they explain why
         it is gone); only the executable source is asserted. */
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      assert.ok(!source.includes('subgraphError'), `${file} still asks for subgraphError`);
      assert.match(source, /pairs\(/, `${file} must still read the pairs catalogue`);
    }
  });
});

describe('fetchOstiumSubgraph', () => {
  it('answers from the gateway in one request when the gateway is healthy', async () => {
    const calls = stubFetch(() => jsonResponse({ data: { pairs: PAIRS } }));
    const body = await fetchOstiumSubgraph({ query: '{ pairs { id } }' });
    assert.deepEqual(body.data.pairs, PAIRS);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, SUBGRAPH_URL);
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].headers['content-type'], /application\/json/);
  });

  it('retries the same query against the public deployment when the gateway refuses it', async () => {
    const calls = stubFetch((call) => (call.url === SUBGRAPH_URL
      ? jsonResponse({ error: 'Not Found' }, 502)
      : jsonResponse({ data: { pairs: PAIRS } })));
    const body = await fetchOstiumSubgraph({ query: '{ pairs { id } }', variables: { a: 1 } });
    assert.deepEqual(body.data.pairs, PAIRS);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, OSTIUM_SUBGRAPH_FALLBACK);
    assert.equal(calls[1].method, 'POST');
    /* The fallback must receive the identical query document and variables,
       not a rewritten one — a different query would be a different question. */
    assert.equal(calls[1].body, calls[0].body);
    assert.equal(JSON.parse(calls[0].body).variables.a, 1);
  });

  it('treats a 200 with errors and no data as a refused read, not an empty venue', async () => {
    const calls = stubFetch((call) => (call.url === SUBGRAPH_URL
      ? jsonResponse({ errors: [{ message: 'Cannot query field "spreadP" on type "Pair"' }] })
      : jsonResponse({ data: { pairs: PAIRS } })));
    const body = await fetchOstiumSubgraph({ query: '{ pairs { id } }' });
    assert.deepEqual(body.data.pairs, PAIRS);
    assert.equal(calls.length, 2);
  });

  it('reports the gateway failure when neither door can serve the read', async () => {
    const calls = stubFetch(() => jsonResponse({ error: 'bad gateway' }, 502));
    await assert.rejects(
      () => fetchOstiumSubgraph({ query: '{ pairs { id } }' }),
      (error) => {
        assert.equal(error.message, 'OSTIUM_UPSTREAM_502');
        return true;
      }
    );
    assert.equal(calls.length, 2, 'the fallback must be attempted before giving up');
  });

  it('does not retry a transport failure — a dead network is not a strict gateway', async () => {
    let attempts = 0;
    globalThis.fetch = async () => { attempts += 1; throw new TypeError('fetch failed'); };
    await assert.rejects(
      () => fetchOstiumSubgraph({ query: '{ pairs { id } }' }),
      (error) => {
        assert.equal(error.message, 'OSTIUM_UPSTREAM_FAILED');
        assert.equal(error.transport, true);
        return true;
      }
    );
    assert.equal(attempts, 1, 'a second host only doubles the wait when the path itself is down');
  });

  it('never touches the network for a query this server itself rejects', async () => {
    const calls = stubFetch(() => jsonResponse({ data: {} }));
    /* These throw before the promise is built — validating input is this
       server's own job, and a caller's bad query is not the venue's fault. */
    assert.throws(() => fetchOstiumSubgraph({ query: '' }), /BAD_OSTIUM_QUERY/);
    assert.throws(() => fetchOstiumSubgraph({ query: '{ x }', variables: [1] }), /BAD_OSTIUM_VARIABLES/);
    assert.equal(calls.length, 0);
  });
});

describe('readMarkets (the BFF path the futures tabs call)', () => {
  const stubVenue = ({ gatewayStatus = 200 } = {}) => stubFetch((call) => {
    if (call.url === SUBGRAPH_URL) {
      return gatewayStatus === 200
        ? jsonResponse({ data: { pairs: PAIRS } })
        : jsonResponse({ error: 'bad gateway' }, gatewayStatus);
    }
    if (call.url === OSTIUM_SUBGRAPH_FALLBACK) return jsonResponse({ data: { pairs: PAIRS } });
    if (call.url.endsWith('/v1/prices')) return jsonResponse({ prices: PRICES, stale: false, generatedAt: 1_791_375_623_000 });
    throw new Error(`unexpected url ${call.url}`);
  });

  it('merges the catalogue with the live prices, and never invents a mid', async () => {
    stubVenue();
    const read = await readMarkets();
    assert.equal(read.live, true);
    assert.equal(read.markets.length, 1);
    const market = read.markets[0];
    assert.equal(market.marketId, '7');
    assert.equal(market.symbol, 'XAU/USD');
    assert.equal(market.mid, 4120.85);
    assert.equal(market.maxLeverage, 20);
  });

  it('survives exactly the production failure: gateway refused, prices healthy', async () => {
    stubVenue({ gatewayStatus: 502 });
    const read = await readMarkets();
    assert.equal(read.live, true, 'the catalogue must still arrive through the fallback');
    assert.equal(read.markets.length, 1);
    assert.equal(read.markets[0].symbol, 'XAU/USD');
  });

  it('throws rather than serving a fabricated catalogue when both doors are shut', async () => {
    stubFetch((call) => {
      if (call.url.endsWith('/v1/prices')) return jsonResponse({ prices: PRICES, stale: false });
      return jsonResponse({ error: 'bad gateway' }, 502);
    });
    await assert.rejects(() => readMarkets(), /OSTIUM_UPSTREAM_502/);
  });
});
