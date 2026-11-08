/**
 * OPPORTUNITY ENGINE — the personalised room
 * Locks: (1) capital comes from spendable balance only, never a locked signer,
 * (2) all four personalisation inputs reach the ranking, (3) every card gets a
 * real, mounted destination, (4) a family with no feed is `empty`, never a
 * fabricated row, (5) the scanner summary explains why each row matched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCapitalSnapshot, normalizeYieldRows, normalizeWhaleRows, normalizeEmergingRows,
  scanPersonalised, chainFit, RISK_PROFILES, readRiskProfile
} from '../src/lib/opportunity/feed.js';
import { openActionFor, CATEGORY_TONE, msRemaining } from '../src/lib/opportunity/openAction.js';
import { attachTokenIds, tokenIdFor, buildSymbolIndex } from '../src/lib/opportunity/tokenMatch.js';
import { ROUTED_PATHS, isRoutedPath } from '../src/lib/intent-ai/autonomy/chatRoutes.js';

const NOW = 1_760_000_000_000;

const rows = [
  { symbol: 'USDC', value: 6000, amount: 6000, chainName: 'Base', chainId: 8453 },
  { symbol: 'ETH', value: 3000, amount: 1, chainName: 'Base', chainId: 8453 },
  { symbol: 'XYZ', amount: 500, value: null, chainName: 'BSC', chainId: 56 }
];

const yields = {
  pools: [
    { id: 'pool-uuid-1', project: 'uniswap-v3', symbol: 'ETH-USDC', chain: 'Base', apy: 22, apyBase: 18, apyReward: 4, tvlUsd: 9_000_000, volumeUsd1d: 800_000, exposure: 'multi', risk: 'high', url: 'https://defillama.com/yields/pool/pool-uuid-1' },
    { id: 'pool-uuid-2', project: 'aave-v3', symbol: 'USDC', chain: 'Base', apy: 7.4, tvlUsd: 40_000_000, exposure: 'single', risk: 'low', url: 'https://defillama.com/yields/pool/pool-uuid-2' },
    { id: 'pool-uuid-3', project: 'lido', symbol: 'STETH', chain: 'Ethereum', apy: 3.1, tvlUsd: 20_000_000, exposure: 'single', risk: 'low' },
    { id: 'pool-uuid-4', project: 'aave-v3', symbol: 'DAI', chain: 'Ethereum', apy: 4.2, tvlUsd: 12_000_000, exposure: 'single', risk: 'medium' }
  ],
  venues: [{ id: 'pool-uuid-2', venue: 'aave-base' }]
};

test('capital: only a spendable wallet contributes investable capital', () => {
  const live = buildCapitalSnapshot({ rows, priceDataStatus: 'live', walletCanSign: true, connected: true });
  assert.equal(live.totalValue, 9000);
  assert.equal(live.stableUsd, 6000);
  assert.equal(live.investableUsd, 9000);
  assert.equal(live.unpricedRows, 1, 'an unpriced holding is reported, not priced at zero');
  assert.deepEqual(live.activeChains.sort(), ['base', 'bsc']);
  assert.equal(live.capitalStatus, 'live');

  const locked = buildCapitalSnapshot({ rows, priceDataStatus: 'live', walletCanSign: false, connected: true });
  assert.equal(locked.investableUsd, 0, 'an attached but locked signer cannot fund a position');
  assert.equal(locked.totalValue, 9000);

  const partial = buildCapitalSnapshot({ rows, priceDataStatus: 'stale', walletCanSign: true, connected: true, staleChains: ['Base'] });
  assert.equal(partial.capitalStatus, 'partial');
  const disconnected = buildCapitalSnapshot({ rows: [], connected: false });
  assert.equal(disconnected.capitalStatus, 'disconnected');
  assert.equal(disconnected.investableUsd, 0);
});

test('feed normalisation keeps identity (pool id, venue, external page) and splits families', () => {
  const out = normalizeYieldRows(yields);
  assert.equal(out.liquidityPools.length, 1);
  assert.equal(out.lendingMarkets.length, 2, 'aave rows are money markets');
  assert.equal(out.farms.length, 1, 'lido is staking');
  assert.equal(out.liquidityPools[0].id, 'pool-uuid-1');
  assert.equal(out.liquidityPools[0].url, 'https://defillama.com/yields/pool/pool-uuid-1');
  assert.equal(out.lendingMarkets[0].venue, 'aave-base', 'a signable venue is carried onto the row');

  const whales = normalizeWhaleRows([{ symbol: 'SOL', signal: 'ACCUMULATION', netFlowUsd: 4e6, independentVotes: 6, confidence: 80 }]);
  assert.equal(whales[0].direction, 'accumulation');
  assert.equal(whales[0].confidence, 0.8);

  const early = normalizeEmergingRows([{ symbol: 'NEW', ageHours: 24, liquidityUsd: 500_000, priceChangeH24: 12 }]);
  assert.equal(early[0].ageDays, 1);
});

test('scan: personalised, all families covered, personalised header carries the four inputs', () => {
  const capital = buildCapitalSnapshot({ rows, priceDataStatus: 'live', walletCanSign: true, connected: true });
  const scan = scanPersonalised({
    capital, riskProfile: 'MODERATE', now: NOW, limit: 40,
    feeds: { ...yields, whaleConsensus: [{ symbol: 'ETH', signal: 'ACCUMULATION', netFlowUsd: 3e6, independentVotes: 5, confidence: 82 }] }
  });
  assert.equal(scan.schema, 'fbt.opportunity-engine.v2');
  assert.ok(scan.opportunities.length + scan.rejected.length > 0);
  assert.equal(scan.personalisation.capitalUsd, 9000);
  assert.equal(scan.personalisation.riskProfile, 'MODERATE');
  assert.deepEqual(scan.personalisation.activeChains.sort(), ['base', 'bsc']);
  assert.ok(scan.personalisation.candidates >= 5);

  /* A family with no feed is empty — never invented. */
  const arb = scan.coverage.find((c) => c.id === 'ARBITRAGE');
  assert.equal(arb.rows, 0);
  assert.equal(arb.status, 'empty');
  assert.equal(scan.scanner.length > 0, true);
  assert.ok(scan.scanner.every((s) => Array.isArray(s.reasons)));
});

test('risk appetite changes the outcome, and it is persisted as a preference', () => {
  const capital = buildCapitalSnapshot({ rows, priceDataStatus: 'live', walletCanSign: true, connected: true });
  const feeds = { ...yields, whaleConsensus: [] };
  const conservative = scanPersonalised({ capital, riskProfile: 'CONSERVATIVE', now: NOW, feeds });
  const aggressive = scanPersonalised({ capital, riskProfile: 'AGGRESSIVE', now: NOW, feeds });
  assert.ok(conservative.profile.riskTolerance < aggressive.profile.riskTolerance);
  assert.ok(conservative.rejected.some((o) => o.exclusionReasons.some((r) => r.code === 'risk-above-tolerance')));
  assert.ok(aggressive.eligibleTotal >= conservative.eligibleTotal);
  assert.ok(RISK_PROFILES.some((p) => p.id === readRiskProfile()));
});

test('chain fit: a $40 position on Ethereum mainnet is not viable', () => {
  const eth = chainFit({ chain: 'Ethereum', capitalUsd: 40, activeChains: ['base'], gasUsdPerLeg: 4.5 });
  assert.equal(eth.viable, false);
  assert.equal(eth.active, false);
  const base = chainFit({ chain: 'base', capitalUsd: 40, activeChains: ['base'], gasUsdPerLeg: 0.05 });
  assert.equal(base.viable, true);
  assert.equal(base.active, true);
});

test('every card gets a mounted in-app destination or an explicit external/none', () => {
  const markets = [
    { id: 'usd-coin', symbol: 'usdc', dataProvenance: 'live' },
    { id: 'staked-ether', symbol: 'steth', dataProvenance: 'live' }
  ];
  const capital = buildCapitalSnapshot({ rows, priceDataStatus: 'live', walletCanSign: true, connected: true });
  const scan = scanPersonalised({
    capital, riskProfile: 'AGGRESSIVE', now: NOW,
    feeds: {
      ...yields,
      whaleConsensus: [{ symbol: 'BTC', signal: 'ACCUMULATION', netFlowUsd: 2e6, independentVotes: 4, confidence: 78 }],
      emergingTokens: [{ symbol: 'NEW', ageHours: 10, liquidityUsd: 400_000, priceChangeH24: 20 }]
    }
  });
  attachTokenIds(scan, markets);
  const all = [...scan.opportunities, ...scan.rejected];
  assert.ok(all.length >= 4);
  let sawMounted = 0;
  for (const row of all) {
    const action = openActionFor(row);
    assert.ok(CATEGORY_TONE[row.category], `tone for ${row.category}`);
    if (action.kind === 'none') {
      /* Only allowed when the row genuinely has no id and no feed page. */
      assert.equal(row.ref?.tokenId ?? null, null);
      assert.equal(row.ref?.poolId ?? null, null);
      continue;
    }
    if (action.kind === 'external') { assert.ok(action.href.startsWith('http')); continue; }
    assert.ok(isRoutedPath(action.to.split('?')[0]), `${row.category} → ${action.to} is a mounted route`);
    assert.ok(ROUTED_PATHS.includes(action.to.split('?')[0]) || action.to.startsWith('/coin/'), action.to);
    sawMounted += 1;
  }
  assert.ok(sawMounted >= 3, 'at least the pool, lending and token rows open something real');

  /* The pool row opens the pool itself, not a generic screen. */
  const poolRow = all.find((r) => r.category === 'LIQUIDITY_POOL');
  assert.match(openActionFor(poolRow).to, /^\/farm\?tab=pools&pool=/);
  /* The small USDC row is safe to link to a token page; a pair never is. */
  const pairRow = all.find((r) => r.symbol === 'ETH-USDC');
  assert.equal(tokenIdFor(pairRow, buildSymbolIndex(markets)), null);
});

test('token matching is exact and refuses stale or unknown symbols', () => {
  const index = buildSymbolIndex([
    { id: 'usd-coin', symbol: 'usdc', dataProvenance: 'live' },
    { id: 'stale-coin', symbol: 'stale', dataProvenance: 'offline' }
  ]);
  assert.equal(tokenIdFor({ symbol: 'USDC' }, index), 'usd-coin');
  assert.equal(tokenIdFor({ symbol: 'STALE' }, index), null, 'a non-live quote may not become a destination');
  assert.equal(tokenIdFor({ symbol: 'NOTREAL' }, index), null);
  assert.equal(tokenIdFor({ symbol: 'ETH-USDC' }, index), null, 'a pool is not a coin');
});

test('validity window is reported and never negative', () => {
  assert.equal(msRemaining({ expiresAt: NOW + 60_000 }, NOW), 60_000);
  assert.equal(msRemaining({ expiresAt: NOW - 60_000 }, NOW), 0);
  assert.equal(msRemaining({}, NOW), null);
});
