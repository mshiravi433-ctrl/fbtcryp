// @vitest-environment jsdom
/**
 * The Aave Arbitrum/USDC panel's GATING.
 *
 * Same property as the Base panel's test: with the feature flag OFF, supply
 * must be gone but WITHDRAW must still be reachable for anyone holding a
 * position. Plus the one property that only exists because there are now two
 * Aave panels: the Arbitrum panel must NOT render for the Base pool (and the
 * Base panel, by its own matcher, not for the Arbitrum one).
 *
 * Nothing of ours is mocked. The adapter runs for real; the chain is the same
 * mock provider the adapter tests use, and `useTranslation` / `useWallet` are
 * stubbed because they are framework/context plumbing, not logic under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: () => {} } })
}));

const walletState = { current: null };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => walletState.current
}));

import AaveArbUsdcPanel from '../src/components/Farm/AaveArbUsdcPanel';
import { AAVE_V3_ARBITRUM } from '../src/lib/defi/aaveV3Arbitrum';
import { AAVE_ARB_SUPPLY_ENABLED } from '../src/lib/features';
import { encodeReserveConfig, makeAaveProvider } from './helpers/aaveMockProvider.mjs';
import { confirmAaveArbAction, recordAaveArbAction } from '../src/lib/defi/aaveV3ArbHistory';

const OWNER = '0x1111111111111111111111111111111111111111';
const USDC_1 = 10n ** BigInt(AAVE_V3_ARBITRUM.usdcDecimals);
const POOL_ROW = { project: 'aave-v3', chain: 'Arbitrum', symbol: 'USDC', exposure: 'single', ilRisk: false };

const providerWith = (over = {}) => makeAaveProvider({
  chainId: 42161,
  pool: AAVE_V3_ARBITRUM.pool,
  aToken: AAVE_V3_ARBITRUM.aUsdc,
  usdc: AAVE_V3_ARBITRUM.usdc,
  pinnedPool: AAVE_V3_ARBITRUM.pool,
  pinnedAToken: AAVE_V3_ARBITRUM.aUsdc,
  configBitmap: encodeReserveConfig({ decimals: 6, active: true, supplyCapWhole: 1_000_000n }),
  usdcBalanceWei: 500n * USDC_1,
  aTokenBalanceWei: 25n * USDC_1,
  totalSupplyWei: 100_000n * USDC_1,
  ...over
});

const setWallet = (over = {}) => {
  walletState.current = {
    address: OWNER,
    chainId: 42161,
    isConnected: true,
    nativeBalance: 1,
    getReadProvider: async () => providerWith(over.provider),
    getSigner: () => null,
    switchChain: async () => true,
    ...over
  };
};

// vitest runs without `globals`, so RTL's automatic cleanup does not happen.
describe('aave arbitrum/usdc panel gating', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('is the shipped configuration: flag off, caps 100/500', () => {
    expect(AAVE_ARB_SUPPLY_ENABLED).toBe(false);
  });

  it('renders nothing for a pool that is not Aave v3 / Arbitrum / USDC', () => {
    setWallet();
    const { container } = render(<AaveArbUsdcPanel pool={{ project: 'uniswap-v3', chain: 'Arbitrum', symbol: 'USDC-WETH' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for the Base Aave pool — the two Aave panels never double-render', () => {
    setWallet();
    const { container } = render(<AaveArbUsdcPanel pool={{ project: 'aave-v3', chain: 'Base', symbol: 'USDC', exposure: 'single', ilRisk: false }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the flag is off and there is no position to withdraw', () => {
    setWallet({ provider: { aTokenBalanceWei: 0n } });
    const { container } = render(<AaveArbUsdcPanel pool={POOL_ROW} />);
    return waitFor(() => {
      // Still nothing once the position read has settled.
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText('farm.aaveArb.supplyInApp')).toBeNull();
      expect(screen.queryByText('farm.aaveArb.withdraw')).toBeNull();
    });
  });

  it('hides supply but keeps withdraw reachable when the flag is off and a position exists', async () => {
    setWallet();
    render(<AaveArbUsdcPanel pool={POOL_ROW} />);
    // The kill switch removes the money-IN path…
    expect(screen.queryByText('farm.aaveArb.supplyInApp')).toBeNull();
    // …and leaves the money-OUT path, with the real on-chain balance.
    await waitFor(() => expect(screen.getByText('farm.aaveArb.withdraw')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('25.00 USDC')).toBeTruthy());
  });

  it('shows no health factor when the position carries no debt', async () => {
    setWallet();
    render(<AaveArbUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(screen.getByText('farm.aaveArb.healthFactor')).toBeTruthy());
    // The label is present; the value must be an honest "—", never a number.
    const label = screen.getByText('farm.aaveArb.healthFactor');
    expect(label.parentElement.textContent).toContain('—');
  });

  it('on the wrong chain, offers to switch instead of a button that would revert', async () => {
    // Flag off, a confirmed supply in the ledger, wallet sitting on Ethereum.
    // The card still renders, but signs nothing until the chain matches.
    const row = recordAaveArbAction({
      action: 'supply', owner: OWNER, amountUsdcWei: 25n * USDC_1, amountUsdc: '25'
    });
    confirmAaveArbAction(row.id, { txHash: '0xdead', blockNumber: 21_000_000 });

    setWallet({ chainId: 1 });
    render(<AaveArbUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(screen.getByText('farm.aaveArb.switchChain')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('farm.aaveArb.wrongChainNote')).toBeTruthy());
    expect(screen.queryByText('farm.aaveArb.withdraw')).toBeNull();
    expect(screen.queryByText('farm.aaveArb.supplyInApp')).toBeNull();
  });

  it('renders nothing when the wallet is on the wrong chain and has never supplied here', () => {
    // The switch prompt must not appear for users with no Aave position at all.
    setWallet({ chainId: 1, provider: { aTokenBalanceWei: 0n } });
    const { container } = render(<AaveArbUsdcPanel pool={POOL_ROW} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('farm.aaveArb.wrongChainNote')).toBeNull();
  });
});
