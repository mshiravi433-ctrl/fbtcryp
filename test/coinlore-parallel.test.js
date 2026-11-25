import { describe, it, expect, vi } from 'vitest';
import { fetchCoinLoreTickers } from '../src/lib/coinLore';
const batch = (start, count) => ({ data: Array.from({ length: count }, (_, i) => ({ id: start + i, nameid: `coin-${start + i}`, name: `Coin ${start + i}`, symbol: `C${start + i}`, price_usd: '1' })) });

describe('parallel market backup', () => {
  it('starts three requests together, preserving page order', async () => {
    const resolve = [];
    const fetchJson = vi.fn(() => new Promise((r) => resolve.push(r)));
    const pending = fetchCoinLoreTickers({ fetchJson, perPage: 250, parallel: true });
    expect(fetchJson).toHaveBeenCalledTimes(3);
    resolve[2](batch(200, 50)); resolve[0](batch(0, 100)); resolve[1](batch(100, 100));
    const rows = await pending;
    expect(rows).toHaveLength(250);
    expect(rows[0].id).toBe('coin-0');
    expect(rows[249].id).toBe('coin-249');
  });
  it('does not splice in rows after an earlier failed chunk', async () => {
    const fetchJson = vi.fn().mockResolvedValueOnce(batch(0, 100)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(batch(200, 50));
    await expect(fetchCoinLoreTickers({ fetchJson, perPage: 250, parallel: true })).rejects.toThrow('offline');
  });
});
