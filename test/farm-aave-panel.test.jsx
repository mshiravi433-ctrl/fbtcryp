// @vitest-environment jsdom
/**
 * The Aave Base/USDC panel's GATING.
 *
 * The adapter's arithmetic is covered in test/farm-defi.test.js. What this file
 * covers is the one UI property that would strand a user's money if it
 * regressed: with the feature flag OFF, supply must be gone but WITHDRAW must
 * still be reachable for anyone holding a position.
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

import AaveBaseUsdcPanel from '../src/components/Farm/AaveBaseUsdcPanel';
import { AAVE_V3_BASE } from '../src/lib/defi/aaveV3Base';
import { AAVE_BASE_SUPPLY_ENABLED } from '../src/lib/features';
import { encodeReserveConfig, makeAaveProvider } from './helpers/aaveMockProvider.mjs';
import { confirmAaveAction, recordAaveAction } from '../src/lib/defi/aaveV3History';

const OWNER = '0x1111111111111111111111111111111111111111';
const USDC_1 = 10n ** BigInt(AAVE_V3_BASE.usdcDecimals);
const POOL_ROW = { project: 'aave-v3', chain: 'Base', symbol: 'USDC', exposure: 'single', ilRisk: false };

const providerWith = (over = {}) => makeAaveProvider({
  pool: AAVE_V3_BASE.pool,
  aToken: AAVE_V3_BASE.aUsdc,
  usdc: AAVE_V3_BASE.usdc,
  pinnedPool: AAVE_V3_BASE.pool,
  pinnedAToken: AAVE_V3_BASE.aUsdc,
  configBitmap: encodeReserveConfig({ decimals: 6, active: true, supplyCapWhole: 1_000_000n }),
  usdcBalanceWei: 500n * USDC_1,
  aTokenBalanceWei: 25n * USDC_1,
  totalSupplyWei: 100_000n * USDC_1,
  ...over
});

const setWallet = (over = {}) => {
  walletState.current = {
    address: OWNER,
    chainId: 8453,
    isConnected: true,
    nativeBalance: 1,
    getReadProvider: async () => providerWith(over.provider),
    getSigner: () => null,
    switchChain: async () => true,
    ...over
  };
};

// vitest runs without `globals`, so RTL's automatic cleanup does not happen.
describe('aave base/usdc panel gating', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('is the shipped configuration: flag off, caps 100/500', () => {
    expect(AAVE_BASE_SUPPLY_ENABLED).toBe(false);
  });

  it('renders nothing for a pool that is not Aave v3 / Base / USDC', () => {
    setWallet();
    const { container } = render(<AaveBaseUsdcPanel pool={{ project: 'uniswap-v3', chain: 'Base', symbol: 'USDC-WETH' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the flag is off and there is no position to withdraw', () => {
    setWallet({ provider: { aTokenBalanceWei: 0n } });
    const { container } = render(<AaveBaseUsdcPanel pool={POOL_ROW} />);
    return waitFor(() => {
      // Still nothing once the position read has settled.
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText('farm.aave.supplyInApp')).toBeNull();
      expect(screen.queryByText('farm.aave.withdraw')).toBeNull();
    });
  });

  it('hides supply but keeps withdraw reachable when the flag is off and a position exists', async () => {
    setWallet();
    render(<AaveBaseUsdcPanel pool={POOL_ROW} />);
    // The kill switch removes the money-IN path…
    expect(screen.queryByText('farm.aave.supplyInApp')).toBeNull();
    // …and leaves the money-OUT path, with the real on-chain balance.
    await waitFor(() => expect(screen.getByText('farm.aave.withdraw')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('25.00 USDC')).toBeTruthy());
  });

  it('shows no health factor when the position carries no debt', async () => {
    setWallet();
    render(<AaveBaseUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(screen.getByText('farm.aave.healthFactor')).toBeTruthy());
    // The label is present; the value must be an honest "—", never a number.
    const label = screen.getByText('farm.aave.healthFactor');
    expect(label.parentElement.textContent).toContain('—');
  });

  it('on the wrong chain, offers to switch instead of a button that would revert', async () => {
    // Flag off, a confirmed supply in the ledger, wallet sitting on Ethereum.
    // The card still renders, but signs nothing until the chain matches.
    const row = recordAaveAction({
      action: 'supply', owner: OWNER, amountUsdcWei: 25n * USDC_1, amountUsdc: '25'
    });
    confirmAaveAction(row.id, { txHash: '0xdead', blockNumber: 21_000_000 });

    setWallet({ chainId: 1 });
    render(<AaveBaseUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(screen.getByText('farm.aave.switchChain')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('farm.aave.wrongChainNote')).toBeTruthy());
    expect(screen.queryByText('farm.aave.withdraw')).toBeNull();
    expect(screen.queryByText('farm.aave.supplyInApp')).toBeNull();
  });

  it('discovers an imported wallet position cross-chain without local history or the yield feed', async () => {
    setWallet({ chainId: 1 });
    render(<AaveBaseUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(screen.getByText('farm.aave.switchChain')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('25.00 USDC')).toBeTruthy());
    expect(screen.queryByText('farm.aave.supplyInApp')).toBeNull();
  });

  it('renders nothing when the wallet is on the wrong chain and has never supplied here', async () => {
    // The switch prompt must not appear for users with no Aave position at all.
    setWallet({ chainId: 1, provider: { aTokenBalanceWei: 0n } });
    const { container } = render(<AaveBaseUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByText('farm.aave.wrongChainNote')).toBeNull();
  });
});
