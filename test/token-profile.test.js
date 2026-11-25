import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTokenProfile, normalizeTokenProfile } from '../src/lib/tokenProfile';

afterEach(() => vi.unstubAllGlobals());
describe('token profile reads', () => {
  it('normalizes metadata without inventing fields', () => {
    expect(normalizeTokenProfile({ id: 'test', description: { en: 'A' }, links: { homepage: ['', 'https://example.com'] }, platforms: { ethereum: '0x123', solana: '' } }))
      .toMatchObject({ id: 'test', descriptions: { en: 'A' }, homepage: 'https://example.com', platforms: ['ethereum'], categories: [] });
  });
  it('falls back to the direct provider and caches successful responses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'profile-test-one', description: { en: 'Hello' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const profile = await getTokenProfile('profile-test-one');
    expect(profile.descriptions.en).toBe('Hello');
    expect(fetchMock.mock.calls[0][0]).toContain('/coin/profile-test-one/profile');
    expect(fetchMock.mock.calls[1][0]).toContain('api.coingecko.com');
    await getTokenProfile('profile-test-one');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects bad IDs and does not try a fallback after cancellation', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('aborted'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getTokenProfile('../bad')).toBeNull();
    const c = new AbortController(); c.abort();
    expect(await getTokenProfile('profile-test-two', { signal: c.signal })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
