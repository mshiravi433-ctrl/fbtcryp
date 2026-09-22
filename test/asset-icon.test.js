/**
 * ASSET ICON — the artwork registry the /loan page now draws from.
 *
 * «کارت‌ها فقط دایره رنگی با متن ۳-۴ حرفی بودند» — the fix is wiring
 * AssetIcon into Loan.jsx / SolanaLendingPanel.jsx. This test pins the
 * resolution layer: every symbol the loan page can render must resolve to
 * vendored SVG art (or the deliberate monogram fallback), and the wrapper
 * aliases added for the new markets must never silently revert to the raw
 * monogram again.
 */
import { describe, it, expect } from 'vitest';
import { symbolSvg, chainSvg } from '../src/components/AssetIcon.jsx';

describe('asset icons — lending coverage', () => {
  it('every Aave-market symbol on every wired chain resolves to real artwork', () => {
    /* lendingAssetsFor across the EVM shell: majors + Sonic's own pair. */
    const evmSymbols = ['USDT', 'USDC', 'DAI', 'WBTC', 'LINK', 'BTCB', 'ETH', 'WETH', 'cbBTC', 'ARB', 'S', 'wS', 'stS'];
    for (const symbol of evmSymbols) {
      const svg = symbolSvg(symbol);
      expect(svg, `symbol ${symbol} must have artwork`).toBeTruthy();
      expect(String(svg)).toContain('<svg');
    }
  });

  it('the Kamino main-market collateral universe resolves to artwork', () => {
    const kaminoSymbols = ['SOL', 'WSOL', 'USDC', 'USDT', 'PYUSD', 'FDUSD', 'JITOSOL', 'JUPSOL', 'JTO', 'WBTC', 'BTC', 'ETH', 'EURC', 'USDe', 'sUSDe', 'USDS', 'USDG'];
    for (const symbol of kaminoSymbols) {
      const svg = symbolSvg(symbol);
      expect(svg, `Kamino reserve ${symbol} must have artwork`).toBeTruthy();
      expect(String(svg)).toContain('<svg');
    }
  });

  it('wrappers resolve to their parent artwork instead of the raw monogram', () => {
    expect(symbolSvg('wS')).toBe(symbolSvg('S') ?? symbolSvg('wS')); /* Sonic pair via the chain mark */
    expect(symbolSvg('WSOL')).toBeTruthy();
    /* wS must EXACTLY be the Sonic network mark — not a generic monogram tile */
    expect(String(symbolSvg('wS'))).toBe(String(chainSvg('146')));
  });

  it('unknown symbols deliberately get the honest null (the caller renders a monogram)', () => {
    expect(symbolSvg('SCAMTOKEN123')).toBe(null);
  });

  it('the network badges exist for every chain the loan page can select', () => {
    for (const chain of ['1', '10', '56', '137', '8453', '42161', '43114', '59144', '146', 'solana']) {
      expect(chainSvg(chain), `badge for ${chain}`).toBeTruthy();
    }
  });
});
