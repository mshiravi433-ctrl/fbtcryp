import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateNftResults } from '../src/lib/nftAggregation.js';

const nft = (id) => ({ id, name: `Item ${id}`, contract: '0x' + 'a'.repeat(40), tokenId: '1' });

test('partial provider failure keeps the verified networks and names the gap', () => {
  const ids = [1, 137, 42161];
  const results = [
    { status: 'fulfilled', value: [nft('eth')] },
    { status: 'rejected', reason: new Error('RATE_LIMITED') },
    { status: 'fulfilled', value: [nft('arb')] }
  ];
  const out = aggregateNftResults(ids, results);
  assert.deepEqual(out.items.map((i) => i._chainId), [1, 42161]);
  assert.deepEqual(out.failed, [137]);
  assert.equal(out.allFailed, false);
});

test('a total provider outage is reported, not shown as an empty wallet', () => {
  const out = aggregateNftResults([1, 137], [
    { status: 'rejected', reason: new Error('UPSTREAM_DOWN') },
    { status: 'rejected', reason: new Error('UPSTREAM_DOWN') }
  ]);
  assert.equal(out.allFailed, true);
  assert.equal(out.items.length, 0);
  assert.deepEqual(out.failed, [1, 137]);
});

test('no indexed chains is not an outage', () => {
  const out = aggregateNftResults([], []);
  assert.equal(out.allFailed, false);
  assert.equal(out.items.length, 0);
});
