// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jupiterTokenHeaders, jupiterTokenUrl } from '../server/jupiterTokenApi.js';

describe('Jupiter Tokens API configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to the current API host and keeps the API key server-side', () => {
    vi.stubEnv('JUPITER_TOKEN_API_BASE', '');
    vi.stubEnv('JUPITER_API_KEY', 'server-only-test-key');

    expect(jupiterTokenUrl('toptraded/24h', { limit: 60 })).toBe(
      'https://api.jup.ag/tokens/v2/toptraded/24h?limit=60'
    );
    expect(jupiterTokenHeaders()).toMatchObject({
      accept: 'application/json',
      'x-api-key': 'server-only-test-key'
    });
  });

  it('supports an explicit compatible proxy base without exposing config to clients', () => {
    vi.stubEnv('JUPITER_TOKEN_API_BASE', 'https://tokens.example.test/v2/');
    vi.stubEnv('JUPITER_API_KEY', '');

    expect(jupiterTokenUrl('search', { query: 'BONK MINT' })).toBe(
      'https://tokens.example.test/v2/search?query=BONK+MINT'
    );
    expect(jupiterTokenHeaders()).not.toHaveProperty('x-api-key');
  });
});
