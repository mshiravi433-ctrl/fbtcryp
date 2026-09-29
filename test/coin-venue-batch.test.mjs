// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetVenueIndex, resolveVenues } from '../server/coinVenue.js';
import { getCoinVenues, venueRoute } from '../src/lib/coinVenue.js';

const SOL_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const BASE_ADDRESS = '0x1111111111111111111111111111111111111111';

beforeEach(() => {
  _resetVenueIndex();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ([
      { id: 'pepe', platforms: { solana: SOL_MINT } },
      { id: 'base-example', platforms: { base: BASE_ADDRESS } },
      { id: 'unsupported-only', platforms: { tron: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' } }
    ])
  })));
});

afterEach(() => {
  _resetVenueIndex();
  vi.unstubAllGlobals();
});

describe('batched CoinGecko venue resolution', () => {
  it('chunks client discovery beyond one 100-id server request', async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `client-batch-${index}`);
    const request = vi.fn(async (url) => {
      const parsed = new URL(String(url), 'https://app.example.test');
      const batch = parsed.searchParams.get('ids').split(',');
      return {
        ok: true,
        json: async () => ({
          venues: batch.map((id) => ({ id, chains: {}, solana: null, tradeable: false }))
        })
      };
    });
    vi.stubGlobal('fetch', request);

    const venues = await getCoinVenues(ids, { timeout: 1000 });
    expect(venues.size).toBe(205);
    expect(request).toHaveBeenCalledTimes(3);
    const batchSizes = request.mock.calls.map(([url]) => (
      new URL(String(url), 'https://app.example.test').searchParams.get('ids').split(',').length
    ));
    expect(batchSizes).toEqual([100, 100, 5]);
  });
  it('returns exact id-address mappings for supported venues from one index read', async () => {
    const out = await resolveVenues('pepe,missing,base-example,pepe');
    expect(out.error).toBeUndefined();
    expect(out.venues.map((item) => item.id)).toEqual(['pepe', 'missing', 'base-example']);
    expect(out.venues[0]).toMatchObject({ id: 'pepe', solana: SOL_MINT, tradeable: true });
    expect(out.venues[1]).toMatchObject({ id: 'missing', solana: null, chains: {}, tradeable: false });
    expect(out.venues[2]).toMatchObject({ id: 'base-example', chains: { 8453: BASE_ADDRESS }, tradeable: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed ids and oversized batches before any upstream read', async () => {
    expect(await resolveVenues('pepe,../fake')).toMatchObject({ error: 'BAD_IDS' });
    expect(await resolveVenues(Array.from({ length: 101 }, (_, i) => `coin-${i}`))).toMatchObject({ error: 'TOO_MANY_IDS' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('builds only exact-address swap routes, never ticker-based links', () => {
    const evm = venueRoute({ chains: { 8453: BASE_ADDRESS }, solana: null, tradeable: true });
    expect(evm.href).toBe(`/swap?chain=8453&toAddress=${BASE_ADDRESS}&side=buy`);
    const solana = venueRoute({ chains: {}, solana: SOL_MINT, tradeable: true });
    expect(solana.href).toBe(`/solana?toMint=${SOL_MINT}&side=buy`);
    expect(venueRoute({ chains: {}, solana: null, tradeable: false })).toBeNull();
  });
});
