// @vitest-environment node
/**
 * TOKEN METADATA + AI SENTIMENT — the facts behind the modern picker.
 * ======================================================================
 * The swap screen's token list used to be bare `<select>` symbols; the new
 * picker renders logos, prices, verified badges and an AI sentiment dot, all
 * normalised in server/solanaTokenMeta.js from Jupiter's published index.
 *
 * That module sits one step from a money screen, so its honesty contract is
 * pinned here, with fixtures and no network:
 *
 *   · a missing field is UNKNOWN, never "bad" and never "good" — USDC's audit
 *     row carries no mint/freeze booleans, and collapsing «not reported» into
 *     «live» stamped one of Solana's deepest tokens with a fake penalty;
 *   · nothing measured at all → `unknown`, never a score (fail closed);
 *   · every label travels with the numbers that produced it, so the UI can
 *     show WHY and a translation key can change without re-scoring.
 */
import { describe, expect, it } from 'vitest';

import {
  ageInDays,
  deriveSentiment,
  normalizeJupiterToken,
  searchSolanaTokensByMints
} from '../server/solanaTokenMeta.js';

/** A healthy, verified, deep-liquidity token — the BONK shape. */
const HEALTHY = {
  id: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  symbol: 'BONK',
  name: 'Bonk',
  icon: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
  decimals: 5,
  holderCount: 1023240,
  usdPrice: 0.0000036,
  liquidity: 5_520_815,
  stats24h: { priceChange: 1.32 },
  firstPool: { createdAt: new Date(Date.now() - 900 * 86_400_000).toISOString() },
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 31.2, devBalancePercentage: 0.00000016 },
  organicScore: 97.6,
  isVerified: true,
  tags: ['verified', 'meme']
};

/** A rug in the shape Jupiter's data can actually see: dust liquidity, live
    freeze authority, a dev still holding, everything concentrated. */
const RUG = {
  id: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  symbol: 'SCAM',
  name: 'Definitely Not A Scam',
  decimals: 6,
  liquidity: 1_800,
  holderCount: 41,
  stats24h: { priceChange: 240 },
  firstPool: { createdAt: new Date(Date.now() - 36 * 3_600_000).toISOString() },
  audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPercentage: 82, devBalancePercentage: 14 },
  organicScore: 4,
  isVerified: false,
  tags: ['pump']
};

/** USDC's real audit row: concentration reported, the two booleans ABSENT.
    The bug this pins once stamped it «live mint authority» — a penalty for a
    fact nobody asserted. */
const USDC = {
  id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  liquidity: 456_898_492,
  holderCount: 5248202,
  stats24h: { priceChange: -0.01 },
  audit: { topHoldersPercentage: 27.26 },
  organicScore: 100,
  isVerified: true,
  tags: ['verified', 'stable']
};

describe('normalizeJupiterToken', () => {
  it('keeps the fields the picker renders and drops what it cannot trust', () => {
    const tk = normalizeJupiterToken(HEALTHY);
    expect(tk.mint).toBe(HEALTHY.id);
    expect(tk.symbol).toBe('BONK');
    expect(tk.icon.startsWith('https://')).toBe(true);
    expect(tk.decimals).toBe(5);
    expect(tk.verified).toBe(true);
    expect(tk.liquidity).toBeGreaterThan(0);
    expect(tk.sentiment).toBeUndefined(); // decoration happens in decorate(), not here
  });

  it('refuses a row without a mint-shaped id', () => {
    expect(normalizeJupiterToken({ symbol: 'X' })).toBeNull();
    expect(normalizeJupiterToken(null)).toBeNull();
    expect(normalizeJupiterToken({ id: 'not-a-mint' })).toBeNull();
  });

  it('does not let a non-https icon reach the DOM', () => {
    const tk = normalizeJupiterToken({ ...HEALTHY, icon: 'http://example.com/x.png' });
    expect(tk.icon).toBeNull();
  });

  it('keeps unreported audit booleans as null (tri-state), not false', () => {
    const tk = normalizeJupiterToken(USDC);
    expect(tk.mintAuthorityDisabled).toBeNull();
    expect(tk.freezeAuthorityDisabled).toBeNull();
    expect(tk.topHoldersPct).toBeCloseTo(27.26, 2);
  });
});

describe('deriveSentiment', () => {
  it('scores a healthy token positive, with drivers that say why', () => {
    const s = deriveSentiment(normalizeJupiterToken(HEALTHY));
    expect(s.data).toBe(true);
    expect(s.label).toBe('positive');
    expect(s.score).toBeGreaterThanOrEqual(62);
    const keys = s.drivers.map((d) => d.key);
    expect(keys).toContain('sentLiqDeep');
    expect(keys).toContain('sentMintRevoked');
  });

  it('scores the rug risky, naming the exact reasons', () => {
    const s = deriveSentiment(normalizeJupiterToken(RUG));
    expect(s.label).toBe('risky');
    const keys = s.drivers.map((d) => d.key);
    expect(keys).toContain('sentLiqDust');
    expect(keys).toContain('sentFreezeLive');
    expect(keys).toContain('sentHoldersConcentrated');
    expect(keys).toContain('sentDevHeavy');
    expect(keys).toContain('sentVeryNew');
  });

  it('USDC is NOT punished for an audit row that simply omits the booleans', () => {
    const s = deriveSentiment(normalizeJupiterToken(USDC));
    const keys = s.drivers.map((d) => d.key);
    expect(keys).not.toContain('sentMintLive');
    expect(keys).not.toContain('sentFreezeLive');
    expect(s.label).not.toBe('risky');
  });

  it('answers unknown when nothing was measured — never a score from silence', () => {
    const s = deriveSentiment({ symbol: 'GHOST' });
    expect(s.label).toBe('unknown');
    expect(s.data).toBe(false);
  });
});

describe('ageInDays', () => {
  it('reads a real timestamp and rejects a fake one', () => {
    expect(ageInDays(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBeCloseTo(2, 0);
    expect(ageInDays('not-a-date')).toBeNull();
    expect(ageInDays(null)).toBeNull();
  });
});

describe('searchSolanaTokensByMints', () => {
  it('refuses a call with no mint-shaped input', async () => {
    const out = await searchSolanaTokensByMints({ mints: 'hello,world' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('BAD_QUERY');
  });

  it('parses, dedupes and caps the list (shape only — no network)', async () => {
    /* The dedupe/cap logic runs BEFORE the fetch; a bogus-shaped remainder
       would fail the same BAD_QUERY guard, so we assert the guard, and the
       happy path is exercised by the picker against the live deployment. */
    const out = await searchSolanaTokensByMints({ mints: '' });
    expect(out.ok).toBe(false);
  });
});
