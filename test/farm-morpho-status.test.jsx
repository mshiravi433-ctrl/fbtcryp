// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';

const mock = vi.hoisted(() => ({ loadMorphoHistoryFor: vi.fn() }));
const owner = '0x1111111111111111111111111111111111111111';
const wallet = {
  address: owner,
  isConnected: true,
  chainId: 8453,
  getReadProvider: vi.fn(async () => { throw new Error('offline'); }),
  getSigner: vi.fn(() => null),
  switchChain: vi.fn(async () => true)
};
const t = (key, values = {}) => {
  const text = key.split('.').reduce((value, part) => value?.[part], en) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
};

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('../src/context/WalletContext', () => ({ useWallet: () => wallet }));
vi.mock('../src/lib/farmRolloutMode', () => ({ MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC: true }));
vi.mock('../src/lib/features', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    MORPHO_BASE_SUPPLY_ALLOWLIST: [],
    morphoBaseSupplyAllowedFor: () => true,
    morphoBaseWithdrawAllowedFor: () => false
  };
});
vi.mock('../src/lib/defi/morphoBlueHistory', async (importOriginal) => ({
  ...await importOriginal(),
  loadMorphoHistoryFor: mock.loadMorphoHistoryFor
}));
vi.mock('framer-motion', () => {
  const components = new Map();
  return { motion: new Proxy({}, { get: (_, tag) => {
    if (!components.has(tag)) components.set(tag, ({ children, ...props }) => {
      const Tag = String(tag);
      const clean = Object.fromEntries(Object.entries(props).filter(([key]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(key)));
      return <Tag {...clean}>{children}</Tag>;
    });
    return components.get(tag);
  } }), AnimatePresence: ({ children }) => children, useReducedMotion: () => true };
});

import MorphoBaseUsdcPanel from '../src/components/Farm/MorphoBaseUsdcPanel';

beforeEach(() => {
  localStorage.clear();
  wallet.getReadProvider.mockClear();
  mock.loadMorphoHistoryFor.mockReset();
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Morpho transaction status in its analysis sheet', () => {
  it.each([
    ['pending', 'pending'],
    ['confirmed', 'confirmed'],
    ['failed', 'failed']
  ])('localizes a %s transaction status', async (storedStatus, expectedStatus) => {
    mock.loadMorphoHistoryFor.mockReturnValue([{
      id: `m-${storedStatus}`,
      action: 'supply',
      owner,
      amountUsdc: 25,
      status: storedStatus,
      at: Date.now()
    }]);
    render(<MorphoBaseUsdcPanel pool={{ project: 'morpho-blue', chain: 'Base', symbol: 'USDC' }} />);

    const supply = await screen.findByRole('button', { name: t('farm.morpho.supplyInApp') });
    await waitFor(() => expect(supply.disabled).toBe(false));
    fireEvent.click(supply);

    const status = await screen.findByTestId('farm-morpho-transaction-status');
    expect(status.getAttribute('data-status')).toBe(expectedStatus);
    expect(status.textContent).toContain(t(`farm.transactionStatus.${expectedStatus}`));
    expect(screen.getByText(t('farm.transactionStatus.label'))).toBeTruthy();
    expect(status.querySelector('.farm-morpho-status-pill').textContent).toBe(t(`farm.transactionStatus.${expectedStatus}`));
  });
});
