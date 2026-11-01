import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiCache, getCategory } from '../src/lib/api';

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

beforeEach(() => clearApiCache());
afterEach(() => { vi.unstubAllGlobals(); clearApiCache(); });

describe('category data transport', () => {
  it('never asks CoinGecko for a Binance risk tag when its backend is down', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: 'down' }, 503));
    vi.stubGlobal('fetch', fetch);
    await expect(getCategory('seed', { perPage: 250, strict: true })).rejects.toThrow('CATEGORY_DATA_UNAVAILABLE');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('/category/binance-seed');
    // Existing non-strict callers keep their historical empty-array contract.
    await expect(getCategory('seed', { perPage: 250 })).resolves.toEqual([]);
    fetch.mockResolvedValueOnce(json([{ id: 'og-fan-token', symbol: 'OG', name: 'OG Fan Token' }]));
    await expect(getCategory('seed', { perPage: 250, strict: true, force: true })).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects stale risk classifications even if a server mistakenly returns them', async () => {
    const fetch = vi.fn().mockResolvedValue(json([{ id: 'old' }], 200, { 'x-data-stale': '1' }));
    vi.stubGlobal('fetch', fetch);
    await expect(getCategory('monitoring', { strict: true })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the precise live CoinGecko category on thematic backend failure, including an empty final page', async () => {
    const fetch = vi.fn(async (input) => String(input).startsWith('/api/')
      ? json({ error: 'down' }, 503)
      : json([{ id: 'filecoin', symbol: 'fil', name: 'Filecoin', current_price: 4 }]));
    vi.stubGlobal('fetch', fetch);
    const rows = await getCategory('storage', { perPage: 250, page: 1, strict: true });
    expect(rows.map((r) => r.id)).toEqual(['filecoin']);
    expect(String(fetch.mock.calls[1][0])).toContain('category=storage');
    expect(String(fetch.mock.calls[1][0])).toContain('per_page=250');
    fetch.mockImplementation(async (input) => String(input).startsWith('/api/') ? json({}, 503) : json([]));
    await expect(getCategory('storage', { perPage: 250, page: 2, strict: true })).resolves.toEqual([]);
  });

  it('distinguishes malformed backend data from a legitimately empty category', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ error: 'not an array' }));
    vi.stubGlobal('fetch', fetch);
    await expect(getCategory('monitoring', { strict: true })).rejects.toThrow();
    fetch.mockResolvedValue(json([]));
    await expect(getCategory('monitoring', { strict: true, force: true })).resolves.toEqual([]);
  });
});
