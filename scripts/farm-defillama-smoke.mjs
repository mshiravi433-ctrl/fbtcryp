#!/usr/bin/env node
/** No mocks, wallets, keys or transactions. Run from an environment with
 * outbound TLS access to yields.llama.fi. A blocked feed MUST fail this probe. */
import assert from 'node:assert/strict';
import { fetchYields, fetchYieldHistory, isYieldPoolId } from '../server/yields.js';

try {
  const feed = await fetchYields();
  assert.equal(feed.source, 'defillama');
  assert.ok(feed.considered > 0, 'Empty upstream feed');
  assert.ok(feed.pools.length > 0, 'No eligible pools to verify');
  assert.ok(feed.pools.length <= 500);
  assert.equal(feed.freshness, 'FRESH');
  const pool = feed.pools.find((row) => isYieldPoolId(row.id));
  assert.ok(pool, 'No valid DefiLlama pool ID');
  const history = await fetchYieldHistory(pool.id);
  assert.equal(history.pool, pool.id);
  assert.ok(history.points.length > 0, 'No historical observations for selected pool');
  assert.ok(history.points.length <= 365);
  console.log(JSON.stringify({
    ok: true, checkedAt: new Date().toISOString(), considered: feed.considered,
    passed: feed.passed, returned: feed.pools.length, truncated: feed.truncated,
    pool: { id: pool.id, project: pool.project, chain: pool.chain, symbol: pool.symbol },
    historyPoints: history.points.length,
    latestObservation: new Date(history.points.at(-1).timestamp).toISOString(),
    transactionsExecuted: 0
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, cause: error.cause?.code || error.cause?.message || null }));
  process.exitCode = 1;
}
