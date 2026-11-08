/**
 * PERP APIS — two reads that make the terminal's side panels real.
 * ---------------------------------------------------------------------------
 * PROBE (`node --test test/perp-apis-probe.mjs`): the normalisers, the clamps
 * and the honest-empty shapes, with global fetch replaced by a scripted stub.
 *
 * WHY A PROBE AND NOT JUST A UNIT TEST: the bug this file exists to prevent is
 * "the number looks like a number but means something else". dYdX publishes a
 * 24h CHANGE but no 24h RANGE; the range has to come from the venue's hourly
 * candles or not at all. It publishes an HOURLY funding rate as a decimal
 * string, which is not an APR until it is multiplied by 8 760. A tape's side is
 * the TAKER's side. Each of those is a silent factor-of-a-thousand away from
 * looking right on screen, so each one is pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDydx24hRange, getDydxTrades, getDydxFundingHistory } from '../src/lib/dydx.js';

/* ── a scripted fetch: every call answers from a queue, and every URL is
      recorded so the test can check the PATH the client built (that is where a
      typo sends the browser to the wrong endpoint and nothing throws). ── */
let calls = [];
let queue = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  const next = queue.shift();
  if (!next) throw new Error('NO_STUB');
  if (next.throw) throw new Error(next.throw);
  return {
    ok: next.ok !== false,
    status: next.status || 200,
    json: async () => next.body
  };
};
const reset = (stubs) => { calls = []; queue = stubs.slice(); };

test('24h range comes from the venue hourly candles and refuses to invent one', async () => {
  reset([{ body: { high24h: 104.5, low24h: 97.25, bars: 24, live: true } }]);
  const r = await getDydx24hRange('btc-usd');
  /* WHATWG URL: whatever the API base resolved to, the PATH is what matters. */
  const path = (u) => new URL(u, 'https://app.example').pathname;
  assert.equal(path(calls[0]), '/api/dydx/range/BTC-USD', calls[0]);
  assert.equal(r.high24h, 104.5);
  assert.equal(r.low24h, 97.25);
  assert.equal(r.live, true);

  /* Fewer than two bars: the server sends nulls, the client keeps them null. */
  reset([{ body: { high24h: null, low24h: null, bars: 1 } }]);
  const empty = await getDydx24hRange('BTC-USD');
  assert.equal(empty.high24h, null);
  assert.equal(empty.low24h, null);
  assert.equal(empty.live, false);

  /* A ticker that is not BASE-QUOTE never reaches the network at all. */
  reset([]);
  const bad = await getDydx24hRange('BTC/USD');
  assert.equal(bad.reason, 'BAD_TICKER');
  assert.equal(calls.length, 0);

  reset([{ throw: 'HTTP_502' }]);
  assert.equal((await getDydx24hRange('BTC-USD')).reason, 'INDEXER_UNAVAILABLE');
});

test('the tape is normalised to the TAKER side, with the notional it actually traded', async () => {
  reset([{
    body: {
      trades: [
        { id: 'a', price: '100.5', size: '2', side: 'BUY', createdAt: '2026-11-08T10:00:00.000Z' },
        { id: 'b', price: '100.4', size: '1', side: 'SELL', createdAt: '2026-11-08T09:59:59.000Z' },
        { id: 'c', price: 'oops', size: '1', side: 'BUY', createdAt: '2026-11-08T09:59:58.000Z' },
        { id: 'd', price: '100.3', size: '1', createdAt: '2026-11-08T09:59:57.000Z' }
      ]
    }
  }]);
  const r = await getDydxTrades('eth-usd', 3);
  assert.equal(new URL(calls[0], 'https://app.example').pathname + new URL(calls[0], 'https://app.example').search,
    '/api/dydx/trades/ETH-USD?limit=3', 'the client clamps and uppercases');
  assert.equal(r.trades.length, 3, 'the unparseable row is dropped, not zeroed');
  assert.equal(r.trades[0].side, 'buy');
  assert.equal(r.trades[1].side, 'sell');
  assert.equal(r.trades[0].usd, 201, 'price × size, not price');
  assert.equal(r.trades[2].side, 'unknown', 'a print with no side is neutral, not a guess');
  assert.equal(r.live, true);
});

test('the tape clamps its limit and never asks for more than the route will serve', async () => {
  reset([{ body: { trades: [] } }]);
  await getDydxTrades('BTC-USD', 100000);
  assert.equal(calls[0].endsWith('limit=100'), true, calls[0]);
  assert.equal(calls[0][0], '/', 'a relative path: the browser stays on its own origin');
  reset([{ body: { trades: [] } }]);
  await getDydxTrades('BTC-USD', -5);
  assert.equal(calls[0].endsWith('limit=1'), true, calls[0]);
  reset([{ body: { trades: [] } }]);
  await getDydxTrades('BTC-USD', 'abc');
  assert.equal(calls[0].endsWith('limit=50'), true, 'garbage falls back to the default, not to 0');
});

test('funding history: an hourly decimal becomes BOTH a % and an APR, via 24×365', async () => {
  reset([{
    body: {
      historicalFunding: [
        { effectiveAt: '2026-11-08T02:00:00.000Z', rate: '0.0000125', price: '100' },
        { effectiveAt: '2026-11-08T01:00:00.000Z', rate: '0.0000250', price: '99' },
        { effectiveAt: 'not-a-date', rate: '0.0001', price: '100' }
      ]
    }
  }]);
  const r = await getDydxFundingHistory('BTC-USD', 24);
  assert.equal(new URL(calls[0], 'https://app.example').pathname + new URL(calls[0], 'https://app.example').search,
    '/api/dydx/funding-history/BTC-USD?limit=24');
  assert.equal(r.rows.length, 2, 'the undated row is dropped: a cost with no time cannot be placed on a chart');
  assert.equal(r.rows[0].atMs < r.rows[1].atMs, true, 'oldest first');
  assert.equal(r.rows[0].rateHourlyPct, 0.0025);
  assert.ok(Math.abs(r.rows[0].aprPct - 0.0025 * 24 * 365) < 1e-12);
  /* oldest first: the 02:00 row (0.00125% per hour) sorts AFTER the 01:00 one */
  assert.equal(r.rows[0].oracleAtSettlement, 99);
  assert.equal(r.rows[0].rateHourlyPct, 0.0025);
  assert.ok(Math.abs(r.rows[0].aprPct - 0.0025 * 24 * 365) < 1e-12);
  assert.equal(r.rows[1].oracleAtSettlement, 100);
  /* the window's total: 0.0025 + 0.00125 = 0.00375% of notional paid by a long */
  assert.ok(Math.abs(r.cumulativePct - 0.00375) < 1e-12);
  assert.equal(r.live, true);

  reset([{ body: { historicalFunding: [] } }]);
  const none = await getDydxFundingHistory('BTC-USD');
  assert.equal(none.live, false);
  assert.equal(none.cumulativePct, null, 'no rows is null, not a zero cost');
  assert.deepEqual(none.rows, []);
});
