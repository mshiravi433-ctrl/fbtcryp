// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/i18n/index.js';
import i18n from '../src/i18n/index.js';

import {
  buildHeatmapLayout,
  computeCapitalPulse,
  heatToneForChange,
  isStablecoinCoin,
  squarifyTreemap
} from '../src/lib/marketHeatmap.js';
import {
  FBT_SWAP_NETWORKS,
  mergeNetworkTelemetry,
  probeAllFbtSwapNetworks
} from '../src/lib/fbtSwapNetworks.js';
import {
  assembleDefiIntel,
  emptyOfflineOverviewIntel,
  normalizeChainsPayload,
  normalizeDexOverviewPayload,
  normalizeFeesOverviewPayload,
  normalizeHistoricalTvlPayload,
  normalizeProtocolsPayload,
  normalizeStablecoinsPayload
} from '../src/lib/defiIntelNormalizer.js';
import { fetchMarketOverviewIntel } from '../server/marketOverviewIntel.js';
import { MARKET_TAB_CONTENT } from '../src/lib/marketTabs.js';

import MarketHeatmap from '../src/components/market/MarketHeatmap.jsx';
import MarketCapitalPulse from '../src/components/market/MarketCapitalPulse.jsx';
import MarketDefiIntel from '../src/components/market/MarketDefiIntel.jsx';
import MarketFbtNetworks from '../src/components/market/MarketFbtNetworks.jsx';

const SAMPLE_COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1, price: 94200, mcap: 1.86e12, volume: 4.2e10, change1h: 0.4, change24h: 3.25, change7d: 8.4, mcapChange24h: 5.8e10 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2, price: 3480, mcap: 4.18e11, volume: 2.1e10, change1h: -0.2, change24h: -1.85, change7d: 4.1, mcapChange24h: -7.5e9 },
  { id: 'tether', symbol: 'USDT', name: 'Tether', rank: 3, price: 1.0, mcap: 1.42e11, volume: 6.4e10, change1h: 0.01, change24h: 0.01, change7d: 0.02, mcapChange24h: 3.1e8 },
  { id: 'solana', symbol: 'SOL', name: 'Solana', rank: 4, price: 212, mcap: 1.01e11, volume: 7.5e9, change1h: 1.3, change24h: 9.6, change7d: 18.2, mcapChange24h: 8.9e9 },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', rank: 5, price: 660, mcap: 9.5e10, volume: 2.3e9, change1h: 0.2, change24h: 1.4, change7d: 3.9, mcapChange24h: 1.3e9 },
  { id: 'usd-coin', symbol: 'USDC', name: 'USDC', rank: 6, price: 1.0, mcap: 5.6e10, volume: 9.2e9, change1h: 0, change24h: 0, change7d: 0, mcapChange24h: 1.1e8 },
  { id: 'arbitrum', symbol: 'ARB', name: 'Arbitrum', rank: 7, price: 1.12, mcap: 4.6e9, volume: 6.9e8, change1h: -0.8, change24h: -5.4, change7d: -9.1, mcapChange24h: -2.6e8 },
  { id: 'aave', symbol: 'AAVE', name: 'Aave', rank: 8, price: 285, mcap: 4.3e9, volume: 5.4e8, change1h: 0.9, change24h: 6.2, change7d: 14.5, mcapChange24h: 2.5e8 }
];

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc-probe">{`${loc.pathname}${loc.search}`}</output>;
}

function renderWithRouter(ui, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('fa');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Market Overview Phase 2 · Squarified Heatmap & Capital Pulse math', () => {
  it('lays out non-overlapping squarified treemap tiles summing to 100% area', () => {
    const layout = buildHeatmapLayout(SAMPLE_COINS, {
      limit: 24,
      metric: 'mcap',
      window: '24h',
      excludeStables: true,
      aspect: 1.6
    });

    // Excludes USDT & USDC by default
    expect(layout.tiles.map((t) => t.coin.symbol)).not.toContain('USDT');
    expect(layout.tiles.map((t) => t.coin.symbol)).not.toContain('USDC');
    expect(layout.tiles).toHaveLength(6);

    const areaSum = layout.tiles.reduce((s, t) => s + (t.wPct * t.hPct) / 100, 0);
    expect(areaSum).toBeCloseTo(100, 3);

    // Every tile stays within [0..100]% bounds
    for (const tile of layout.tiles) {
      expect(tile.xPct).toBeGreaterThanOrEqual(-0.001);
      expect(tile.yPct).toBeGreaterThanOrEqual(-0.001);
      expect(tile.xPct + tile.wPct).toBeLessThanOrEqual(100.001);
      expect(tile.yPct + tile.hPct).toBeLessThanOrEqual(100.001);
    }

    // Including stables restores USDT & USDC
    const withStables = buildHeatmapLayout(SAMPLE_COINS, {
      limit: 24,
      excludeStables: false
    });
    expect(withStables.tiles).toHaveLength(8);
    expect(isStablecoinCoin(SAMPLE_COINS[2])).toBe(true);
    expect(heatToneForChange(9.6)).toBe('up-5');
    expect(heatToneForChange(-5.4)).toBe('down-4');
    expect(heatToneForChange(0.01)).toBe('flat');
    expect(squarifyTreemap([])).toEqual([]);
  });

  it('computes accurate altcoin share, velocity, median return, and movers', () => {
    const pulse = computeCapitalPulse(SAMPLE_COINS, {
      mcap: 3.1e12,
      volume: 1.24e11,
      btcDominance: 56.5,
      ethDominance: 13.5
    });

    expect(pulse.altcoinSharePct).toBeCloseTo(30.0, 2);
    expect(pulse.turnoverPct).toBeCloseTo(4.0, 2);
    expect(pulse.upCount).toBe(4);
    expect(pulse.downCount).toBe(2);
    expect(pulse.gainers[0].coin.symbol).toBe('SOL');
    expect(pulse.losers[0].coin.symbol).toBe('ARB');
    expect(pulse.volumeLeaders[0].coin.symbol).toBe('BTC');
    expect(pulse.netMcapFlow24h).toBeGreaterThan(0);
  });
});

describe('Market Overview Phase 2 · FBT Swap 19-network registry & honest RPC merge', () => {
  it('exposes all 19 FBT Swap networks (16 EVM + Solana + Bitcoin + Tron) with real swap routes', () => {
    expect(FBT_SWAP_NETWORKS).toHaveLength(19);
    const evm = FBT_SWAP_NETWORKS.filter((n) => n.isEvm);
    const nonEvm = FBT_SWAP_NETWORKS.filter((n) => !n.isEvm);
    expect(evm).toHaveLength(16);
    expect(nonEvm.map((n) => n.key)).toEqual(['solana', 'bitcoin', 'tron']);

    // Every EVM swap deep-link carries both `chain` and `from` for Swap.jsx compatibility
    for (const net of evm) {
      expect(net.swapHref).toMatch(/^\/swap\?chain=\d+&from=[A-Z0-9]+$/);
      expect(net.executors.length).toBeGreaterThanOrEqual(1);
    }
    expect(FBT_SWAP_NETWORKS.find((n) => n.key === 'solana').swapHref).toBe('/swap?chain=solana');
  });

  it('never fabricates latency or block height when offline, and merges real probes + TVL cleanly', async () => {
    const offlineMerged = mergeNetworkTelemetry({ probes: null, chainTvls: [], loading: false });
    expect(offlineMerged.onlineCount).toBe(0);
    expect(offlineMerged.medianLatencyMs).toBeNull();
    for (const n of offlineMerged.networks) {
      expect(n.status).toBe('offline');
      expect(n.latencyMs).toBeNull();
      expect(n.latestBlock).toBeNull();
    }

    const liveMerged = mergeNetworkTelemetry({
      probes: {
        'evm:1': { key: 'evm:1', ok: true, latencyMs: 118, latestBlock: 21900123 },
        solana: { key: 'solana', ok: true, latencyMs: 210, latestBlock: 312004500 },
        'evm:56': { key: 'evm:56', ok: true, latencyMs: 1120, latestBlock: 45100200 }
      },
      chainTvls: [
        { name: 'Ethereum', tvl: 62_500_000_000 },
        { name: 'Solana', tvl: 9_400_000_000 }
      ],
      loading: false
    });

    expect(liveMerged.onlineCount).toBe(3);
    expect(liveMerged.medianLatencyMs).toBe(210);
    expect(liveMerged.totalFbtTvlUsd).toBe(71_900_000_000);
    expect(liveMerged.networks.find((n) => n.key === 'evm:1').status).toBe('online');
    expect(liveMerged.networks.find((n) => n.key === 'evm:56').status).toBe('slow');

    // Probe helper handles failing fetch gracefully without throwing
    const failedProbes = await probeAllFbtSwapNetworks({
      fetchImpl: () => Promise.reject(new Error('offline')),
      timeoutMs: 50
    });
    expect(Object.values(failedProbes).every((p) => p.ok === false && p.latencyMs === null)).toBe(true);
  });
});

describe('Market Overview Phase 2 · Server DeFi & Network aggregator', () => {
  it('normalizes DefiLlama payloads and joins FBT integrations accurately', async () => {
    const mockFetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/v2/chains')) {
        return {
          ok: true,
          json: async () => [
            { name: 'Ethereum', tokenSymbol: 'ETH', tvl: 60e9 },
            { name: 'Solana', tokenSymbol: 'SOL', tvl: 9.2e9 },
            { name: 'Sui', tokenSymbol: 'SUI', tvl: 1.8e9 }
          ]
        };
      }
      if (u.includes('/v2/historicalChainTvl')) {
        return {
          ok: true,
          json: async () =>
            Array.from({ length: 40 }, (_, i) => ({
              date: 1750000000 + i * 86400,
              tvl: 95e9 + i * 5e8
            }))
        };
      }
      if (u.includes('/protocols')) {
        return {
          ok: true,
          json: async () => [
            { name: 'Aave V3', slug: 'aave-v3', symbol: 'AAVE', category: 'Lending', tvl: 21e9, change_1d: 2.1, chains: ['Ethereum', 'Arbitrum', 'Base'] },
            { name: 'Lido', slug: 'lido', symbol: 'LDO', category: 'Liquid Staking', tvl: 26e9, change_1d: 1.4, chains: ['Ethereum'] },
            { name: 'Uniswap V3', slug: 'uniswap-v3', symbol: 'UNI', category: 'DEXs', tvl: 5.4e9, change_1d: -0.6, chains: ['Ethereum', 'Base'] },
            { name: 'Binance CEX', slug: 'binance-cex', category: 'CEX', tvl: 120e9, chains: ['Ethereum'] }
          ]
        };
      }
      if (u.includes('/overview/dexs')) {
        return {
          ok: true,
          json: async () => ({
            total24h: 13.8e9,
            total7d: 88e9,
            change_1d: 4.5,
            protocols: [{ name: 'Uniswap', total24h: 3.9e9, change_1d: 5.1 }]
          })
        };
      }
      if (u.includes('/overview/fees')) {
        return {
          ok: true,
          json: async () => ({ total24h: 78e6, totalRevenue24h: 24e6, change_1d: 3.2 })
        };
      }
      if (u.includes('mempool.space/api/v1/fees/recommended')) {
        return { ok: true, json: async () => ({ halfHourFee: 7 }) };
      }
      if (u.includes('mempool.space/api/blocks/tip/height')) {
        return { ok: true, text: async () => '894120' };
      }
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x14e3320' })
      };
    });

    const result = await fetchMarketOverviewIntel({ fetchImpl: mockFetch });
    expect(result.ok).toBe(true);
    expect(result.offline).toBe(false);
    expect(result.defi.totalTvlUsd).toBeGreaterThan(100e9);
    expect(result.defi.topChains[0].name).toBe('Ethereum');
    expect(result.defi.topChains[0].fbtSupported).toBe(true);
    // CEX excluded from DeFi protocols
    expect(result.defi.topProtocols.map((p) => p.slug)).not.toContain('binance-cex');
    expect(result.defi.topProtocols[0].fbtIntegrated).toBe(true);
    expect(result.defi.dexVolume24hUsd).toBe(13.8e9);
    expect(result.defi.fees24hUsd).toBe(78e6);
    expect(result.networkProbes.bitcoin.feeHint).toBe('7 sat/vB');
  });

  it('normalizes raw stablecoins payload and returns honest nulls when offline', () => {
    const stables = normalizeStablecoinsPayload({
      peggedAssets: [
        {
          symbol: 'USDT',
          name: 'Tether',
          circulating: { peggedUSD: 145e9 },
          circulatingPrevDay: { peggedUSD: 144.6e9 },
          circulatingPrevWeek: { peggedUSD: 143.5e9 },
          chainCirculating: {
            Ethereum: { current: { peggedUSD: 72e9 }, circulatingPrevDay: { peggedUSD: 71.7e9 } },
            Tron: { current: { peggedUSD: 61e9 }, circulatingPrevDay: { peggedUSD: 61.2e9 } }
          }
        }
      ]
    });
    expect(stables.stablecoinTotalUsd).toBe(145e9);
    expect(stables.stablecoinNet24hUsd).toBeCloseTo(4e8, -2);
    expect(stables.chainInflows[0].chain).toBe('Ethereum');
    expect(stables.chainOutflows[0].chain).toBe('Tron');

    const offline = emptyOfflineOverviewIntel();
    expect(offline.offline).toBe(true);
    expect(offline.defi.totalTvlUsd).toBeNull();
    expect(normalizeChainsPayload([]).totalChainTvlUsd).toBeNull();
    expect(normalizeHistoricalTvlPayload([]).latestTvlUsd).toBeNull();
    expect(normalizeProtocolsPayload([]).topProtocols).toEqual([]);
    expect(normalizeDexOverviewPayload(null).dexVolume24hUsd).toBeNull();
    expect(normalizeFeesOverviewPayload(null).fees24hUsd).toBeNull();
    expect(assembleDefiIntel({}).totalTvlUsd).toBeNull();
  });
});

describe('Market Overview Phase 2 · Interactive UI components & navigation', () => {
  it('registers all 4 Phase-2 modules exclusively on the Overview tab', () => {
    for (const id of [
      'market-heatmap',
      'market-capital-pulse',
      'market-defi-intel',
      'market-fbt-networks'
    ]) {
      expect(MARKET_TAB_CONTENT.overview).toContain(id);
      expect(MARKET_TAB_CONTENT.tokens).not.toContain(id);
    }
  });

  it('renders MarketHeatmap, filters tickers, toggles stablecoins, and navigates to /coin/:id', () => {
    renderWithRouter(<MarketHeatmap coins={SAMPLE_COINS} vs="usd" />);

    const card = screen.getByTestId('market-heatmap');
    expect(card).toBeTruthy();
    expect(card.querySelectorAll('.mx-hm-tile')).toHaveLength(6);

    // Inspector defaults to #1 BTC; hovering SOL updates inspector
    const solTile = card.querySelector('.mx-hm-tile[data-symbol="SOL"]');
    fireEvent.pointerEnter(solTile);
    expect(screen.getByTestId('market-heatmap-inspector').textContent).toContain('Solana');

    // Search filter narrows tiles
    const input = card.querySelector('.mx-hm-filter input');
    fireEvent.change(input, { target: { value: 'aave' } });
    expect(card.querySelectorAll('.mx-hm-tile')).toHaveLength(1);

    // Clicking tile navigates to /coin/aave
    fireEvent.click(card.querySelector('.mx-hm-tile'));
    expect(screen.getByTestId('loc-probe').textContent).toBe('/coin/aave');
  });

  it('renders MarketCapitalPulse, switches leaderboards, and opens coin details', () => {
    renderWithRouter(
      <MarketCapitalPulse
        coins={SAMPLE_COINS}
        global={{ mcap: 3.1e12, volume: 1.2e11, btcDominance: 56, ethDominance: 14 }}
        vs="usd"
      />
    );

    const card = screen.getByTestId('market-capital-pulse');
    expect(card.textContent).toContain('30.0%');

    // Switch to Top Losers and verify ARB leads
    const btns = card.querySelectorAll('.mx-p2-seg-btn');
    fireEvent.click(btns[1]);
    const firstRow = card.querySelector('.mx-pulse-row');
    expect(firstRow.textContent).toContain('Arbitrum');
    fireEvent.click(firstRow);
    expect(screen.getByTestId('loc-probe').textContent).toBe('/coin/arbitrum');
  });

  it('renders MarketDefiIntel across all 4 lenses and links to FBT rooms', () => {
    const sampleDefi = {
      totalTvlUsd: 108_400_000_000,
      tvlChange24hPct: 2.35,
      tvlChange30dPct: 8.1,
      tvlChange90dPct: 19.4,
      tvlHistory90d: [90e9, 94e9, 99e9, 102e9, 105e9, 108.4e9],
      ethSharePct: 56.2,
      topChains: [
        { name: 'Ethereum', symbol: 'ETH', tvlUsd: 60.9e9, sharePct: 56.2, fbtSupported: true, swapHref: '/swap?chain=1&from=ETH' },
        { name: 'Solana', symbol: 'SOL', tvlUsd: 9.8e9, sharePct: 9.0, fbtSupported: true, swapHref: '/swap?chain=solana' }
      ],
      categories: [
        { id: 'liquid_staking', tvlUsd: 38e9, sharePct: 35.1, protocolCount: 42, leaderName: 'Lido', fbtRoute: '/farm' },
        { id: 'lending', tvlUsd: 31e9, sharePct: 28.6, protocolCount: 95, leaderName: 'Aave', fbtRoute: '/loan' }
      ],
      topProtocols: [
        { name: 'Lido', slug: 'lido', symbol: 'LDO', category: 'Liquid Staking', tvlUsd: 26e9, change1d: 1.8, chainsCount: 5, fbtIntegrated: true, fbtRoute: '/farm' }
      ],
      dexVolume24hUsd: 14.5e9,
      dexChange24hPct: 5.2,
      topDexs: [],
      fees24hUsd: 82e6,
      revenue24hUsd: 26e6,
      stablecoinTotalUsd: 304e9,
      stablecoinNet24hUsd: 420e6,
      topStablecoins: [
        { symbol: 'USDT', name: 'Tether', circulatingUsd: 185e9, sharePct: 60.8, delta24hUsd: 310e6 }
      ],
      chainInflows: [{ chain: 'Ethereum', delta24hUsd: 280e6 }],
      chainOutflows: [{ chain: 'Tron', delta24hUsd: -95e6 }]
    };

    renderWithRouter(
      <MarketDefiIntel
        defi={sampleDefi}
        global={{ volume: 100e9 }}
        loading={false}
        offline={false}
      />
    );

    const card = screen.getByTestId('market-defi-intel');
    expect(card.textContent).toContain('56.2%');
    expect(card.textContent).toContain('14.5%'); // DEX / Global Vol ratio

    const lensBtns = card.querySelectorAll('.mx-defi-tabs .mx-p2-seg-btn');
    // Categories lens
    fireEvent.click(lensBtns[1]);
    expect(card.textContent).toContain('Lido');
    // Protocols lens
    fireEvent.click(lensBtns[2]);
    fireEvent.click(card.querySelector('.mx-defi-tag-btn'));
    expect(screen.getByTestId('loc-probe').textContent).toBe('/farm');

    // Stables lens
    fireEvent.click(lensBtns[3]);
    expect(card.textContent).toContain('USDT');
    expect(card.textContent).toContain('Ethereum');
  });

  it('renders MarketFbtNetworks, filters L1/L2/Non-EVM, expands all 19, and navigates to Swap', () => {
    const model = mergeNetworkTelemetry({
      probes: {
        'evm:1': { key: 'evm:1', ok: true, latencyMs: 94, latestBlock: 21888111 },
        solana: { key: 'solana', ok: true, latencyMs: 145, latestBlock: 312999000 }
      },
      chainTvls: [{ name: 'Ethereum', tvl: 61e9 }],
      loading: false
    });

    renderWithRouter(<MarketFbtNetworks swapNetworks={model} />);
    const card = screen.getByTestId('market-fbt-networks');
    expect(card.textContent).toContain('2 / 19');
    expect(card.textContent).toContain('94 ms');

    // Shows 8 flagship networks initially, expands to all 19
    expect(card.querySelectorAll('.mx-net-item')).toHaveLength(8);
    fireEvent.click(card.querySelector('.mx-net-more-btn'));
    expect(card.querySelectorAll('.mx-net-item')).toHaveLength(19);

    // Filter to Non-EVM (Solana, Bitcoin, Tron = 3)
    const filterBtns = card.querySelectorAll('.mx-p2-seg-btn');
    fireEvent.click(filterBtns[3]);
    expect(card.querySelectorAll('.mx-net-item')).toHaveLength(3);

    // Tap Solana Swap button -> /swap?chain=solana
    const solCard = card.querySelector('[data-chain-key="solana"]');
    fireEvent.click(solCard.querySelector('.mx-net-swap-btn'));
    expect(screen.getByTestId('loc-probe').textContent).toBe('/swap?chain=solana');
  });

  it('enforces scroll-budget CSS discipline and 12-locale completeness with zero emojis', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/market-overview-phase2.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/backdrop-filter|will-change|content-visibility|contain-intrinsic-size|url\(/);
    expect(css).not.toMatch(/(?:^|[;\s{])(?:filter|mask|mask-image|-webkit-mask-image)\s*:/);

    const localeDir = join(process.cwd(), 'src/i18n/locales');
    const files = readdirSync(localeDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(12);
    const faKeys = Object.keys(
      JSON.parse(readFileSync(join(localeDir, 'fa.json'), 'utf8')).marketPhase2
    ).sort();
    expect(faKeys.length).toBeGreaterThanOrEqual(55);

    for (const file of files) {
      const parsed = JSON.parse(readFileSync(join(localeDir, file), 'utf8'));
      expect(Object.keys(parsed.marketPhase2 || {}).sort(), file).toEqual(faKeys);
      for (const val of Object.values(parsed.marketPhase2)) {
        expect(typeof val).toBe('string');
        expect(val.length).toBeGreaterThan(0);
        expect(val).not.toMatch(/[→←↑↓↗]/);
      }
    }
  });
});
