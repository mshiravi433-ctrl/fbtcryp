// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const META = [{
  mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  symbol: 'BONK',
  name: 'Bonk',
  icon: null,
  decimals: 5,
  verified: false,
  discovered: true,
  usdPrice: 0.0000036,
  liquidity: 1_000_000,
  priceChange24h: 2,
  sentiment: null
}];

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, options = {}) => {
  let text = key;
  for (const [name, value] of Object.entries(options)) text = text.replaceAll(`{{${name}}}`, String(value));
  return text;
} }) }));
vi.mock('./../src/components/Sheet', () => ({ default: ({ open, title, children }) => open ? <section aria-label={title}>{children}</section> : null }));
vi.mock('../src/lib/tokenIcon', () => ({ default: ({ token }) => <span data-testid="token-icon">{token?.symbol || 'mint'}</span> }));
vi.mock('../src/lib/solana', () => ({ isSolanaAddress: (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || '')) }));
vi.mock('../src/lib/solanaTokenMeta', () => ({
  searchSolanaTokenMeta: async () => [],
  discoverSolanaTokenMeta: async () => META,
  fetchSolanaTokenSentiment: async () => null,
  fetchSolanaTokensMeta: async () => new Map()
}));
vi.mock('../src/store/useSettingsStore', () => ({ useSettingsStore: (select) => select({ solanaCluster: 'mainnet-beta' }) }));

import SolanaTokenPicker from '../src/components/SolanaTokenPicker.jsx';

beforeEach(() => {});
afterEach(() => cleanup());

describe('Solana live token discovery picker', () => {
  it('shows the token name and unverified status, then imports its exact mint', async () => {
    const onImport = vi.fn();
    render(
      <SolanaTokenPicker
        open
        onClose={() => {}}
        tokens={[{ mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', imported: false }]}
        onPick={() => {}}
        onImport={onImport}
        side="to"
      />
    );

    const row = await screen.findByTestId('stp-discovery-DezXAZ');
    expect(row.textContent).toContain('BONK');
    expect(row.textContent).toContain('Bonk');
    expect(row.textContent).toContain('solana.picker.unverified');
    fireEvent.click(row);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({
      mint: META[0].mint,
      symbol: 'BONK',
      name: 'Bonk',
      verified: false,
      imported: true,
      decimalsVerified: false
    }));
  });
});
