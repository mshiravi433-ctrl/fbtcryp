import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTokenProfile } from '../server/providers';
afterEach(() => vi.unstubAllGlobals());
describe('project profile provider', () => {
  it('fetches only project metadata and checks the returned identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'bitcoin', description: { en: 'Bitcoin' }, links: { homepage: ['https://bitcoin.org'] }, categories: ['Currency'], platforms: {} }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchTokenProfile('bitcoin');
    expect(result.description.en).toBe('Bitcoin');
    expect(fetchMock.mock.calls[0][0]).toContain('market_data=false');
    expect(result).not.toHaveProperty('market_data');
    await expect(fetchTokenProfile('../escape')).rejects.toThrow('INVALID_COIN_ID');
  });
  it('does not leak upstream URLs or secrets in errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret URL')));
    await expect(fetchTokenProfile('bitcoin')).rejects.toThrow('PROFILE_UNAVAILABLE');
  });
});
