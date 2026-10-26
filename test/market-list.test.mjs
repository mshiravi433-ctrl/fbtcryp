/**
 * THE MARKET LIST'S MATHS — sort, breadth, freshness.
 * ---------------------------------------------------------------------------
 * These are the three answers on the market screen that can be proven without
 * a browser, so they are proven here rather than eyeballed. Each test names the
 * defect it pins:
 *
 *   1. «صعودی‌ها» used to be `sort(...).slice(0, 25)` — a VIEW implemented as a
 *      budget. Reordering must never remove a row.
 *   2. A coin with no volume sorted to the TOP of an ascending volume sort,
 *      because `null` was treated as zero. "No data" is not "smallest".
 *   3. A page-wide breadth figure that counted unreadable rows as "flat" would
 *      turn a broken feed into good news.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SORT, MARKET_SORTS, freshness, marketBreadth, sortMarketRows } from '../src/lib/marketList.js';

const row = (id, extra = {}) => ({
  id,
  symbol: id.toUpperCase(),
  name: id,
  price: 1,
  change24h: 0,
  volume: 0,
  mcap: 0,
  rank: 1,
  ...extra
});

test('every offered sort key is one the comparator understands', () => {
  assert.deepEqual([...MARKET_SORTS], ['rank', 'mcap', 'change', 'volume', 'price']);
  assert.deepEqual({ ...DEFAULT_SORT }, { key: 'rank', dir: 'asc' });
  const rows = [row('a', { rank: 3, mcap: 30, volume: 3, price: 3, change24h: -2 })];
  for (const key of MARKET_SORTS) {
    for (const dir of ['asc', 'desc']) {
      assert.equal(sortMarketRows(rows, key, dir).length, rows.length, `${key}/${dir} kept its rows`);
    }
  }
});

test('a view reorders the whole page — it never truncates it', () => {
  /* The regression this file exists for. 500 rows in, 500 rows out. */
  const rows = Array.from({ length: 500 }, (_, i) => row(`c${i}`, {
    rank: i + 1,
    change24h: i - 250, // unique, so the order is not decided by the tie-break
    volume: 1000 - i,
    mcap: 1e9 - i,
    price: i / 10
  }));

  const gainers = sortMarketRows(rows, 'change', 'desc');
  assert.equal(gainers.length, 500, 'gainers kept every row');
  assert.equal(gainers[0].id, 'c499', 'the biggest gainer is first');
  assert.equal(gainers.at(-1).id, 'c0', 'the biggest loser is last');

  const losers = sortMarketRows(rows, 'change', 'asc');
  assert.equal(losers.length, 500);
  assert.equal(losers[0].id, 'c0', 'ascending change means worst first');

  const volume = sortMarketRows(rows, 'volume', 'desc');
  assert.equal(volume.length, 500);
  assert.equal(volume[0].id, 'c0', 'highest volume first');

  /* And the input was not touched: the page's own feed array is passed in
     here, and every other derived value on that page reads it. */
  assert.equal(rows[0].id, 'c0');
  assert.equal(rows[1].id, 'c1');
});

test('"no data" sorts last in BOTH directions, never first', () => {
  const rows = [
    row('known-small', { volume: 1 }),
    row('missing', { volume: null }),
    row('known-big', { volume: 900 }),
    row('undef', { volume: undefined }),
    row('text', { volume: 'not a number' })
  ];

  for (const dir of ['asc', 'desc']) {
    const sorted = sortMarketRows(rows, 'volume', dir);
    const ids = sorted.map((r) => r.id);
    assert.deepEqual(ids.slice(-3).sort(), ['missing', 'text', 'undef'], `unknown values are last (${dir})`);
    assert.equal(ids[0], dir === 'asc' ? 'known-small' : 'known-big');
    assert.equal(ids[1], dir === 'asc' ? 'known-big' : 'known-small');
  }
});

test('rank 0 or a missing rank is "unranked", not rank zero', () => {
  const sorted = sortMarketRows([
    row('nobody', { rank: 0 }),
    row('ten', { rank: 10 }),
    row('one', { rank: 1 }),
    row('nada', { rank: null })
  ], 'rank', 'asc');
  assert.deepEqual(sorted.map((r) => r.id), ['one', 'ten', 'nobody', 'nada']);
});

test('equal values keep feed order, so the list does not reshuffle every poll', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id, i) => row(id, { change24h: 0, rank: i + 1 }));
  const first = sortMarketRows(rows, 'change', 'desc').map((r) => r.id);
  const second = sortMarketRows(rows, 'change', 'desc').map((r) => r.id);
  assert.deepEqual(first, ['a', 'b', 'c', 'd']);
  assert.deepEqual(second, first);
});

test('string-typed numbers from a secondary provider still sort', () => {
  const sorted = sortMarketRows([
    row('low', { mcap: '10' }),
    row('high', { mcap: '20' })
  ], 'mcap', 'desc');
  assert.deepEqual(sorted.map((r) => r.id), ['high', 'low']);
});

test('breadth counts up / down / flat and reports unreadable rows separately', () => {
  const breadth = marketBreadth([
    { change24h: 5 }, { change24h: 2 }, { change24h: -1 },
    { change24h: 0 }, { change24h: null }, { change24h: 'oops' }, {}
  ]);
  assert.deepEqual(breadth, {
    up: 2,
    down: 1,
    flat: 1,
    unknown: 3,
    counted: 4,
    total: 7,
    avgChange: 1.5,
    upShare: 0.5,
    downShare: 0.25,
    flatShare: 0.25
  });
});

test('shares are of the coins that reported, and add up to one', () => {
  const breadth = marketBreadth([{ change24h: 1 }, { change24h: -1 }, { change24h: null }]);
  assert.equal(breadth.upShare + breadth.downShare + breadth.flatShare, 1);
  assert.equal(breadth.counted, 2);
});

test('an empty page reports zero rather than NaN', () => {
  const breadth = marketBreadth([]);
  assert.equal(breadth.total, 0);
  assert.equal(breadth.counted, 0);
  assert.equal(breadth.avgChange, 0);
  assert.equal(marketBreadth(null).total, 0);
});

test('freshness is rounded, and stops claiming to be live past 90s', () => {
  const now = 1_000_000;
  assert.equal(freshness(null, now), null);
  assert.equal(freshness(0, now), null);
  assert.deepEqual(freshness(now - 12_000, now), { seconds: 10, minutes: 0, stale: false });
  assert.deepEqual(freshness(now - 61_000, now), { seconds: 60, minutes: 1, stale: false });
  assert.deepEqual(freshness(now - 200_000, now), { seconds: 200, minutes: 3, stale: true });
  /* A clock that runs backwards (device time change) must not print a
     negative age or a wild timestamp. */
  assert.deepEqual(freshness(now + 60_000, now), { seconds: 0, minutes: 0, stale: false });
});
