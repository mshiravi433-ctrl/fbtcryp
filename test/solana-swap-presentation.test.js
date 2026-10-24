import { describe, expect, it } from 'vitest';

import {
  compareSolanaQuotes,
  formatSolanaAmount,
  formatSolanaPercent,
  solanaMinimumReceivedRaw,
  solanaPriceImpactPercent
} from '../src/lib/solana/swapPresentation.js';

describe('Solana quote presentation', () => {
  it('normalizes provider impact to percentage points without turning missing data into zero', () => {
    expect(solanaPriceImpactPercent('0.35%', 'openocean')).toBe(0.35);
    expect(solanaPriceImpactPercent('0.01', 'lifi')).toBe(1);
    expect(solanaPriceImpactPercent('0.02', 'jupfee')).toBe(2);
    expect(solanaPriceImpactPercent('0.02%', 'jupiter')).toBe(0.02);
    expect(solanaPriceImpactPercent('not-a-number', 'lifi')).toBeNull();
    expect(solanaPriceImpactPercent('0.01', 'unrecognized-provider')).toBeNull();
    expect(solanaPriceImpactPercent(null, 'openocean')).toBeNull();
  });

  it('uses a valid provider minimum, or derives the exact configured slippage floor', () => {
    expect(solanaMinimumReceivedRaw({
      outAmount: '1000000', minOutAmount: '995000', slippageBps: 100
    })).toBe('995000');
    expect(solanaMinimumReceivedRaw({
      outAmount: '1000000', minOutAmount: null, slippageBps: 50
    })).toBe('995000');
    expect(solanaMinimumReceivedRaw({
      outAmount: '1000000', minOutAmount: '1000001', slippageBps: 50
    })).toBe('995000');
    expect(solanaMinimumReceivedRaw({
      outAmount: '1000000', minOutAmount: null, slippageBps: null
    })).toBeNull();
  });

  it('compares raw outputs exactly and identifies the selected route', () => {
    const rows = compareSolanaQuotes([
      { provider: 'lifi', outAmount: '999999999999999999' },
      { provider: 'openocean', outAmount: '1000000000000000000' },
      { provider: 'jupfee', outAmount: '900000000000000000' },
      { provider: 'broken', outAmount: '0' }
    ], 'openocean');

    expect(rows.map((row) => row.quote.provider)).toEqual(['openocean', 'lifi', 'jupfee']);
    expect(rows[0]).toMatchObject({ isSelected: true, isHighestOutput: true, differenceRaw: '0' });
    expect(rows[1]).toMatchObject({ isSelected: false, isHighestOutput: false, differencePct: 0 });
    expect(rows[2].differencePct).toBe(10);
  });

  it('formats token amounts exactly and localizes numerals', () => {
    expect(formatSolanaAmount('1234567.890123000', 'en', 9)).toBe('1,234,567.890123');
    expect(formatSolanaAmount('0.000000001', 'en', 9)).toBe('0.000000001');
    expect(formatSolanaAmount('0.000000001', 'fa', 9)).toMatch(/۰/);
    expect(formatSolanaPercent(0.7, 'en')).toBe('0.7');
    expect(formatSolanaPercent(0.001, 'en')).toBe('0.001');
  });
});
