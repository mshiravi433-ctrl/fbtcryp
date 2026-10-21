import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  getAaveBaseStatus: vi.fn(),
  getCompoundBaseStatus: vi.fn(),
  getAaveArbitrumStatus: vi.fn(),
  aaveBase: { chainId: 8453, usdcSymbol: 'USDC' },
  compoundBase: { chainId: 8453, usdcSymbol: 'USDC' },
  aaveArbitrum: { chainId: 42161, usdcSymbol: 'USDC' },
  morpho: {
    chainId: 8453,
    marketId: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
    loanToken: '0x00000000000000000000000000000000000000aa',
    loanSymbol: 'USDC',
    collateralToken: '0x00000000000000000000000000000000000000bb',
    defiLlamaPoolId: '7d33d57d-36dc-414b-9538-22a223250468'
  }
}));

vi.mock('../src/lib/defi/aaveV3Base.js', () => ({ AAVE_V3_BASE: mock.aaveBase, getReserveStatus: mock.getAaveBaseStatus }));
vi.mock('../src/lib/defi/compoundV3Base.js', () => ({ COMPOUND_V3_BASE: mock.compoundBase, getMarketStatus: mock.getCompoundBaseStatus }));
vi.mock('../src/lib/defi/aaveV3Arbitrum.js', () => ({ AAVE_V3_ARBITRUM: mock.aaveArbitrum, getReserveStatus: mock.getAaveArbitrumStatus }));
vi.mock('../src/lib/defi/morphoBlueBase.js', () => ({ MORPHO_BLUE_BASE: mock.morpho }));

import { getFarmProtocolFallback, LIDO_STETH_APR_API, MORPHO_FARM_API } from '../src/lib/farmProtocolFallback.js';

const morphoPayload = (patch = {}) => ({
  data: {
    marketById: {
      marketId: mock.morpho.marketId,
      chain: { id: 8453 },
      loanAsset: { address: mock.morpho.loanToken, symbol: 'USDC' },
      collateralAsset: { address: mock.morpho.collateralToken, symbol: 'cbBTC' },
      state: { supplyApy: 0.05, supplyAssetsUsd: '250000000', ...patch }
    }
  }
});

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

beforeEach(() => {
  mock.getAaveBaseStatus.mockReset().mockResolvedValue({ supplyApyPct: 4.2 });
  mock.getCompoundBaseStatus.mockReset().mockResolvedValue({ supplyApyPct: 0.3, supplyAprPct: 0.299 });
  mock.getAaveArbitrumStatus.mockReset().mockResolvedValue({ supplyApyPct: 5.1 });
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url === MORPHO_FARM_API) return response(morphoPayload());
    if (url === LIDO_STETH_APR_API) return response({ data: { smaApr: 3.4 } });
    return response({}, 404);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('direct protocol-source failover', () => {
  it('returns only verified, live venue observations and never converts Lido APR into APY', async () => {
    const getReadProvider = vi.fn(async (chainId) => ({ chainId }));
    const result = await getFarmProtocolFallback({ getReadProvider, now: 1_800_000_000_000 });

    expect(result).toMatchObject({ source: 'protocolDirect', freshness: 'FRESH', fallback: true, pools: [] });
    expect(result.venues.map((row) => row.project)).toEqual([
      'aave-v3', 'compound-v3', 'aave-v3', 'morpho-blue', 'lido'
    ]);
    expect(result.venues[0]).toMatchObject({ apy: 4.2, apyBase: 4.2, source: 'aaveBaseOnchain', historyAvailable: false });
    expect(result.venues[1]).toMatchObject({ apy: 0.3, apr: 0.299, source: 'compoundBaseOnchain' });
    expect(result.venues[3]).toMatchObject({ apy: 5, apyBase: 5, tvlUsd: 250_000_000, pool: mock.morpho.defiLlamaPoolId });
    expect(result.venues[3]).not.toHaveProperty('apyMean30d');
    expect(result.venues[4]).toMatchObject({ apr: 3.4, source: 'lidoSevenDayApr' });
    expect(result.venues[4]).not.toHaveProperty('apy');
    expect(getReadProvider.mock.calls.map(([chainId]) => chainId).sort((a, b) => a - b)).toEqual([8453, 42161]);
  });

  it('keeps partial successes and omits malformed or unavailable protocol responses', async () => {
    mock.getAaveBaseStatus.mockRejectedValue(new Error('rpc down'));
    mock.getCompoundBaseStatus.mockResolvedValue({ supplyApyPct: 0.3, supplyAprPct: 0.299 });
    mock.getAaveArbitrumStatus.mockRejectedValue(new Error('rpc down'));
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === MORPHO_FARM_API) return response(morphoPayload({ supplyApy: 5 })); // Wrong units are rejected.
      if (url === LIDO_STETH_APR_API) return response({}, 503);
      return response({}, 404);
    });

    const result = await getFarmProtocolFallback({ getReadProvider: async () => ({}) });
    expect(result.venues).toHaveLength(1);
    expect(result.venues[0]).toMatchObject({ project: 'compound-v3', apy: 0.3 });
  });

  it('does not attempt network reads without a public read-provider path', async () => {
    expect(await getFarmProtocolFallback()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
