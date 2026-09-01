/**
 * FBT CENTRAL INTELLIGENCE OS — external-boundary fixtures for the probes.
 * ────────────────────────────────────────────────────────────────────────────
 * These are NOT mock business logic: every rule, gate, planner and engine under
 * test is the real one. Only the twenty names in `server/ci/sources.js`
 * (the sole place the brain touches a provider) are replaced, because CI has no
 * outbound network and a probe that "passes" by skipping the call proves nothing.
 *
 * Each fake returns the shape its real counterpart returns — array vs object,
 * `[{t,p}]` vs `{series}`, `ok:true` plus the payload fields. That shape
 * agreement is exactly what the probes are for: the bugs this system produced
 * were consumers reading `.value` when the producer sent `.data`, and a `null`
 * price being coerced to `0` and reported as a free swap.
 *
 * A fake that always succeeds is also useless, so `installFakes(overrides)`
 * accepts per-name replacements (including `null` to remove a source entirely and
 * watch the brain admit it is reading nothing).
 */
export const ADDR = '0x1111111111111111111111111111111111111111';
const series = (base, n = 34, drift = 0.0006) => Array.from({ length: n }, (_, i) => ({ at: Date.now() - (n - i) * 3600_000, price: base * (1 + drift * i) * (1 + (i % 3) * 0.002) }));
const spark = (base, n = 34, drift = 0.0006) => series(base, n, drift).map((p) => p.price);

export function installFakes(overrides = {}) {
  const F = {
    walletBalances: async () => ({
      ok: true, connected: true, addresses: { evm: [ADDR] }, chainsRead: [1, 137],
      balances: [
        { symbol: 'BTC', name: 'Bitcoin', amount: 0.25, valueUsd: 9000, chainId: 1, decimals: 8 },
        { symbol: 'USDC', name: 'USD Coin', amount: 1000, valueUsd: 1000, chainId: 1, decimals: 6 }
      ],
      totalValueUsd: 10000, unpriced: [], skipped: [], stale: false, partial: false,
      source: 'fake:wallet', at: Date.now()
    }),
    portfolioSummary: async () => ({
      ok: true, totalValueUsd: 10000,
      holdings: [
        { symbol: 'BTC', category: 'crypto', amount: 0.25, valueUsd: 9000, sharePct: 90, priceUsd: 36000 },
        { symbol: 'USDC', category: 'stable', amount: 1000, valueUsd: 1000, sharePct: 10, priceUsd: 1 }
      ],
      stableSharePct: 10, positionCount: 2, unpriced: [], stale: false, source: 'fake:portfolio', at: Date.now()
    }),
    marketSnapshot: async () => ({
      ok: true,
      prices: {
        BTC: { symbol: 'BTC', priceUsd: 36000, change24hPct: 1.4, marketCapUsd: 7e11 },
        ETH: { symbol: 'ETH', priceUsd: 3000, change24hPct: -0.6, marketCapUsd: 3.6e11 },
        USDC: { symbol: 'USDC', priceUsd: 1, change24hPct: 0, marketCapUsd: 3.4e10 }
      },
      changes24hPct: { BTC: 1.4, ETH: -0.6, USDC: 0 },
      volatilityPct: { BTC: 2.1, ETH: 2.8, USDC: 0.02 },
      history: { BTC: series(36000), ETH: series(3000, 34, -0.0004), USDC: series(1, 34, 0) },
      breadth: { totalMarketCapUsd: 1.3e12, totalVolumeUsd: 4.2e10, marketCapChange24hPct: 0.8, btcDominancePct: 52.4, provider: 'fake', activeCryptocurrencies: 12000 },
      topGainers: [{ symbol: 'BTC', priceUsd: 36000, change24hPct: 1.4 }],
      topLosers: [{ symbol: 'ETH', priceUsd: 3000, change24hPct: -0.6 }],
      stale: false, failedSources: [], source: 'fake:market', at: Date.now()
    }),
    assetHistory: async ({ id }) => ({ ok: true, series: series(id === 'ethereum' ? 3000 : 36000), stale: false, source: 'fake:history', at: Date.now() }),
    signals: async () => ({
      ok: true,
      byAsset: {
        BTC: { direction: 'bullish', strength: 0.62, changeWindowPct: 2.1, volatilityDailyPct: 2.1, samples: 34, method: 'SMA(7/21)', source: 'fake:signals', at: Date.now() },
        ETH: { direction: 'bearish', strength: 0.3, changeWindowPct: -1.1, volatilityDailyPct: 2.8, samples: 34, method: 'SMA(7/21)', source: 'fake:signals', at: Date.now() }
      },
      coverage: { requested: 2, computed: 2, failed: [] }, stale: false, source: 'fake:signals', at: Date.now()
    }),
    news: async () => ({
      ok: true,
      items: [{ id: 'n1', title: 'Bitcoin ETF inflows hit weekly high', url: 'https://example.org/n1', source: 'fake', lang: 'en', at: Date.now() - 3600_000, symbols: ['BTC'] }],
      total: 1, stale: false, source: 'fake:news', at: Date.now()
    }),
    lendingPosition: async () => ({
      ok: true, chainId: 1, healthFactor: 1.82, collateralUsd: 12000, debtUsd: 5000, availableBorrowsUsd: 2600,
      ltvPct: 41.7, liquidationThresholdPct: 83,
      positions: [{ network: 'chain:1', collateralUsd: 12000, debtUsd: 5000, healthFactor: 1.82, ltv: 0.417, liquidationThreshold: 0.83, borrowAprPct: 4.1 }],
      reserve: { symbol: 'USDC', supplyApyPct: 3.2, borrowApyPct: 4.1, status: 'ACTIVE', ltv: 0.81, liquidationThreshold: 0.835 },
      oracle: { status: 'OK', prices: { USDC: 1 }, fresh: true }, verifiedOnChain: true, stale: false,
      source: 'fake:lending', at: Date.now()
    }),
    lendingReserve: async () => ({ ok: true, chainId: 1, asset: 'USDC', listed: true, status: 'ACTIVE', supplyAprPct: 3.2, borrowAprPct: 4.1, ltv: 0.81, liquidationThreshold: 0.835, source: 'fake:reserve', at: Date.now() }),
    perpMarkets: async () => ({ ok: true, assets: 12, fundingAprPct: { BTC: 12.4, ETH: 8.1 }, openInterestUsd: { BTC: 4.2e9 }, stale: false, venues: null, positions: null, source: 'fake:perp', at: Date.now() }),
    dydxAccount: async () => ({ ok: true, equityUsd: 5000, marginUsedUsd: 1200, freeCollateralUsd: 3800, positions: [{ symbol: 'BTC-USD', size: 0.05, side: 'long', entryPx: 34000, unrealizedPnl: 100, leverage: 0.34 }], stale: false, source: 'fake:dydx', at: Date.now() }),
    yields: async () => ({
      ok: true,
      pools: [
        { id: 'p1', project: 'aave-v3', chain: 'Ethereum', symbol: 'USDC', apy: 4.1, tvlUsd: 1.2e9, risk: 'low', ilRisk: false, poolMeta: null },
        { id: 'p2', project: 'lido', chain: 'Ethereum', symbol: 'stETH', apy: 3.3, tvlUsd: 2.4e10, risk: 'low', ilRisk: false, poolMeta: null }
      ],
      considered: 2, stale: false, source: 'fake:yields', at: Date.now()
    }),
    goalList: async () => ({
      ok: true,
      goals: [{ id: 'g1', title: 'سرمایه ۱۰۰ هزار دلاری', targetAmount: 100000, currency: 'USD', durationMonths: 24, contributionMonthly: 4000, currentAmount: 20000, status: 'ACTIVE', createdAt: Date.now() - 86400_000 * 30 }],
      count: 1, source: 'fake:goals', at: Date.now()
    }),
    goalMarketSnapshot: async () => ({ ok: true, btcPrice: 36000, ethPrice: 3000, stale: false, source: 'fake:goals', at: Date.now() }),
    swapQuote: async () => ({
      ok: true, provider: 'kyber', chainId: 1, fromAsset: 'BTC', toAsset: 'USDC',
      amountIn: 0.1, amountUsd: 3600, expectedOut: 3585.2, minOut: 3560, price: 35852, priceImpactPct: 0.12, feeUsd: 3.6,
      route: [{ exchange: 'Uniswap', portion: 1 }], gasUsd: 4.2, expiresAt: Date.now() + 45_000, quoteTtlMs: 45_000,
      at: Date.now(), slippagePct: 0.5, partial: false, unsignedOnly: true, source: 'fake:dex', tried: ['kyber']
    }),
    bridgeQuoteSource: async () => ({
      ok: true, provider: 'lifi', fromChain: 1, toChain: 137, asset: 'USDC', amountIn: 500, amountUsd: 500,
      expectedOut: 499.1, minOut: 495, feeUsd: 0.9, estimatedSeconds: 240, destinationLiquidityUsd: 4.1e6,
      expiresAt: Date.now() + 60_000, quoteTtlMs: 60_000, stale: false, unsignedOnly: true, source: 'fake:bridge', at: Date.now()
    }),
    transactionReceipt: async () => ({
      ok: true, status: 'CONFIRMED', chainId: 1, hash: '0x' + 'a'.repeat(64), blockNumber: 19_000_100, confirmations: 12,
      gasUsed: 142000, effectiveGasPriceGwei: 12.4, from: ADDR, to: '0x2222222222222222222222222222222222222222', logs: 3, at: Date.now(), source: 'fake:chain'
    }),
    swapTokenSafety: async () => ({ ok: true, chainId: 1, address: '0x2222222222222222222222222222222222222222', symbol: 'USDC', riskLevel: 'LOW', flags: [], securityBlock: false, holders: 4200, sellTax: 0, buyTax: 0, source: 'fake:token-safety', at: Date.now() }),
    tokenRisk: async () => ({ ok: true, honeypot: false, isWhitelisted: true, transferTax: 0, buyTax: 0, sellTax: 0, holders: 4200, risk: 'LOW', source: 'fake:risk', at: Date.now() }),
    equitiesMarkets: async () => ({ ok: true, venue: 'avantis', instruments: [{ symbol: 'AAPL', name: 'Apple', priceUsd: 228.4, change24hPct: 0.4, marketOpen: true, leverageCap: 5, settlement: 'USDC' }], pricePartial: false, stale: false, readOnly: true, source: 'fake:equities', at: Date.now() }),
    rwaMarkets: async () => ({ ok: true, venue: 'ostium', rows: [{ symbol: 'XAU', priceUsd: 2640.2, category: 'commodities' }, { symbol: 'EURUSD', priceUsd: 1.08, category: 'forex' }], stale: false, readOnly: true, source: 'fake:rwa', at: Date.now() })
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete F[k];
    else F[k] = typeof v === 'function' ? v : async () => v;
  }
  return F;
}
