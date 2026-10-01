import assert from 'node:assert/strict';
import { buildHumanResponse } from '../../src/lib/intent-ai/os/humanResponse.js';
import { createRiskAgent } from '../../src/lib/intent-ai/os/agents/riskAgent.js';

const baseContext = {
  wallet: { connected: true },
  portfolio: {
    dataStatus: 'partial',
    priceDataStatus: 'live',
    totalValueUsd: 120,
    partial: true,
    fetchedAt: 1_790_843_000_000,
    holdings: [
      { symbol: 'USDC', name: 'USD Coin', address: '0xusdc-eth', chainId: 1, amount: 100, valueUsd: 100 },
      { symbol: 'USDC', name: 'USD Coin', address: '0xusdc-bsc', chainId: 56, amount: 20, valueUsd: 20 },
      { symbol: 'SOL', chainId: 501, amount: 0.1, valueUsd: null },
      { symbol: 'ZERO', chainId: 1, amount: 0, valueUsd: null },
      { symbol: 'UNPRICED', chainId: 137, amount: 3, valueUsd: 0 }
    ],
    chains: [
      { chainId: 1, failed: false, stale: false, rows: 2, unpriced: 0 },
      { chainId: 56, failed: false, stale: false, rows: 1, unpriced: 0 },
      { chainId: 137, failed: true, stale: true, rows: 0, unpriced: 0 },
      { chainId: 8453, failed: false, stale: true, rows: 0, unpriced: 0 }
    ],
    failedChains: ['Polygon']
  }
};

function portfolioReply(context = baseContext) {
  return buildHumanResponse({
    intent: { type: 'PORTFOLIO_ANALYSIS' },
    context,
    results: {},
    locale: 'en-US'
  });
}

async function test(name, fn) {
  await fn();
  console.log(`  ✓ ${name}`);
}

console.log('\n=== Intent AI portfolio chat card probe ===');

await test('builds an in-chat portfolio card from the real portfolio response', () => {
  const reply = portfolioReply();
  assert.equal(reply.ui.type, 'PORTFOLIO_CARD');
  assert.equal(reply.card.kind, 'PORTFOLIO');
  assert.equal(reply.card.status, 'stale');
  assert.equal(reply.card.displayedValueKind, 'priced-subtotal');
  assert.equal(reply.card.totalValueUsd, 120);
  assert.equal(reply.card.unpricedCount, 2);
  assert.equal(reply.card.rows.length, 4, 'zero-balance rows are not holdings');
  assert.equal(reply.card.rows.some((row) => row.symbol === 'ZERO'), false);
  assert.equal(reply.card.rows.find((row) => row.symbol === 'SOL').valueUsd, null);
  assert.equal(reply.card.rows.find((row) => row.symbol === 'UNPRICED').valueUsd, null);
  assert.match(reply.message, /not counted as zero/i);
  assert.match(reply.message, /wallet-mix score is withheld/i);
  assert.match(reply.message, /cost basis/i);
});

await test('keeps same-token balances separate by network while aggregating known exposure', () => {
  const card = portfolioReply().card;
  const usdcRows = card.rows.filter((row) => row.symbol === 'USDC');
  assert.equal(usdcRows.length, 2);
  assert.notEqual(usdcRows[0].key, usdcRows[1].key);
  assert.deepEqual(usdcRows.map((row) => row.chainId).sort(), [1, 56]);
  assert.equal(card.stablecoinValueUsd, 120);
  assert.equal(card.stablecoinPct, 100);
  assert.equal(card.concentrationSymbol, 'USDC');
  assert.equal(card.concentrationPct, 100);
  assert.equal(card.networks.find((network) => network.chainId === 1).valueUsd, 100);
  assert.equal(card.networks.find((network) => network.chainId === 56).valueUsd, 20);
  assert.equal(card.networks.find((network) => network.chainId === 137).status, 'failed');
  assert.equal(card.networks.find((network) => network.chainId === 8453).status, 'stale');
});

await test('marks a partially read network partial instead of calling its balances live', () => {
  const card = portfolioReply({
    wallet: { connected: true },
    portfolio: {
      dataStatus: 'partial',
      priceDataStatus: 'live',
      partial: true,
      holdings: [{ symbol: 'SOL', chainId: 501, amount: 1, valueUsd: 120 }],
      chains: [
        { chainId: 501, failed: false, stale: false, partial: true, rows: 1, unpriced: 0 },
        { chainId: 1, failed: false, stale: false, partial: true, rows: 0, unpriced: 0 }
      ]
    }
  }).card;
  assert.equal(card.status, 'partial');
  assert.equal(card.rows[0].networkStatus, 'partial');
  assert.equal(card.networks.find((network) => network.chainId === 501).status, 'partial');
  assert.equal(card.networks.find((network) => network.chainId === 1).status, 'partial', 'a partially read network with no returned rows remains visible');
});

await test('does not fabricate P&L or promote concentration into a full risk score', () => {
  const card = portfolioReply().card;
  assert.equal(card.pnlUsd, null);
  assert.equal(card.overallRiskScore, null);
  assert.equal(card.portfolioMixScore, null, 'partial or stale data must not produce a mix score');
  assert.equal(card.concentrationPct, 100, 'concentration is available as a separate observation');
});

await test('recognizes a fully priced, fresh portfolio without calling it partial', () => {
  const context = {
    wallet: { connected: true },
    portfolio: {
      dataStatus: 'live',
      priceDataStatus: 'live',
      partial: false,
      holdings: [
        { symbol: 'BTC', chainId: 1, amount: 0.01, valueUsd: 600 },
        { symbol: 'USDT', chainId: 56, amount: 600, valueUsd: 600 }
      ],
      chains: []
    }
  };
  const reply = portfolioReply(context);
  const card = reply.card;
  assert.equal(card.status, 'live');
  assert.equal(card.displayedValueKind, 'total');
  assert.equal(card.totalValueUsd, 1200);
  assert.equal(card.stablecoinPct, 50);
  assert.equal(card.unpricedCount, 0);
  assert.equal(card.overallRiskScore, null, 'the heuristic is not mislabeled as an overall score');
  assert.equal(card.portfolioMixScore, 12);
  assert.equal(card.portfolioMixBand, 'low');
  assert.match(reply.message, /Wallet-mix heuristic: 12\/100/i);
  assert.match(reply.message, /not a comprehensive risk score/i);
});

await test('does not call an empty but successfully read wallet a failed portfolio read', () => {
  const reply = portfolioReply({
    wallet: { connected: true },
    portfolio: { dataStatus: 'empty', priceDataStatus: 'live', freshness: 'FRESH', holdings: [], failedChains: [], chains: [] }
  });
  assert.equal(reply.code, 'EMPTY_PORTFOLIO');
  assert.notEqual(reply.code, 'PORTFOLIO_SYNC_RETRY');
});

await test('a stale-only empty read is not presented as a confirmed empty wallet', () => {
  const reply = portfolioReply({
    wallet: { connected: true },
    portfolio: {
      dataStatus: 'partial', freshness: 'STALE', partial: true, fromSnapshot: true,
      holdings: [], failedChains: [], staleChains: ['Base'],
      chains: [{ chainId: 8453, failed: false, stale: true, rows: 0, unpriced: 0 }]
    }
  });
  assert.equal(reply.code, 'PORTFOLIO_READ_INCOMPLETE');
  assert.equal(reply.refresh, true);
  assert.notEqual(reply.code, 'EMPTY_PORTFOLIO');
  assert.match(reply.message, /cannot confirm.*empty/i);
});

await test('a partial Solana read with zero returned holdings is not treated as empty', () => {
  const reply = portfolioReply({
    wallet: { connected: true, solanaAddresses: ['SoL11111111111111111111111111111111111111111'] },
    portfolio: {
      dataStatus: 'partial', freshness: 'PARTIAL', partial: true,
      holdings: [], failedChains: [], staleChains: [],
      chains: [{ chainId: 501, failed: false, stale: false, partial: true, rows: 0, unpriced: 0 }]
    }
  });
  assert.equal(reply.code, 'PORTFOLIO_READ_INCOMPLETE');
  assert.notEqual(reply.code, 'EMPTY_PORTFOLIO');
});

await test('marks a partial concentration observation unknown for overall risk and refuses approval', async () => {
  const agent = createRiskAgent();
  const risk = await agent.analyze({
    portfolio: {
      dataStatus: 'partial',
      priceDataStatus: 'live',
      partial: true,
      holdings: [
        { symbol: 'BTC', valueUsd: 70 },
        { symbol: 'SOL', valueUsd: null }
      ]
    },
    riskTolerance: 'high'
  });
  assert.equal(risk.riskLevel, 'unknown');
  assert.equal(risk.concentrationBand, 'high');
  assert.equal(risk.concentration, 100);
  assert.equal(risk.overallRiskScore, null);
  assert.equal(risk.approved, false);
  assert.equal(risk.dataStatus, 'partial');
});

await test('returns no numerical risk score when all holdings are unpriced', async () => {
  const risk = await createRiskAgent().analyze({
    portfolio: {
      dataStatus: 'partial',
      priceDataStatus: 'unavailable',
      partial: true,
      holdings: [{ symbol: 'SOL', valueUsd: null }]
    }
  });
  assert.equal(risk.riskLevel, 'unknown');
  assert.equal(risk.concentration, null);
  assert.equal(risk.overallRiskScore, null);
  assert.equal(risk.approved, false);
  assert.equal(risk.dataStatus, 'unavailable');
});

console.log('\nAll portfolio chat card checks passed.');
