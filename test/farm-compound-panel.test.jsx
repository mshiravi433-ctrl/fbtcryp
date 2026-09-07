// @vitest-environment jsdom
/**
 * The Compound V3 Base/USDC panel's GATING.
 *
 * The adapter's arithmetic is covered in test/compound-defi.test.js. What this
 * file covers is the one UI property that would strand a user's money if it
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

import CompoundBaseUsdcPanel from '../src/components/Farm/CompoundBaseUsdcPanel';
import { COMPOUND_V3_BASE } from '../src/lib/defi/compoundV3Base';
import { COMPOUND_BASE_SUPPLY_ENABLED } from '../src/lib/features';
import { makeCometProvider } from './helpers/compoundMockProvider.mjs';
import { confirmCompoundAction, recordCompoundAction } from '../src/lib/defi/compoundV3History';

const OWNER = '0x1111111111111111111111111111111111111111';
const USDC_1 = 10n ** BigInt(COMPOUND_V3_BASE.usdcDecimals);
const POOL_ROW = { project: 'compound-v3', chain: 'Base', symbol: 'USDC', exposure: 'single', ilRisk: false };

const providerWith = (over = {}) => makeCometProvider({
  comet: COMPOUND_V3_BASE.comet,
  configurator: COMPOUND_V3_BASE.configurator,
  rewards: COMPOUND_V3_BASE.rewards,
  usdc: COMPOUND_V3_BASE.usdc,
  usdcBalanceWei: 500n * USDC_1,
  positionWei: 25n * USDC_1,
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
describe('compound base/usdc panel gating', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('is the shipped configuration: flag off', () => {
    expect(COMPOUND_BASE_SUPPLY_ENABLED).toBe(false);
  });

  it('renders nothing for a pool that is not Compound V3 / Base / USDC', () => {
    setWallet();
    const { container } = render(<CompoundBaseUsdcPanel pool={{ project: 'aave-v3', chain: 'Base', symbol: 'USDC', exposure: 'single' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the flag is off and there is no position to withdraw', () => {
    setWallet({ provider: { positionWei: 0n } });
    const { container } = render(<CompoundBaseUsdcPanel pool={POOL_ROW} />);
    return waitFor(() => {
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText('farm.compound.supplyInApp')).toBeNull();
      expect(screen.queryByText('farm.compound.withdraw')).toBeNull();
    });
  });

  it('hides supply but keeps withdraw reachable when the flag is off and a position exists', async () => {
    setWallet();
    render(<CompoundBaseUsdcPanel pool={POOL_ROW} />);
    // The kill switch removes the money-IN path…
    expect(screen.queryByText('farm.compound.supplyInApp')).toBeNull();
    // …and leaves the money-OUT path, with the real on-chain balance.
    await waitFor(() => expect(screen.getByText('farm.compound.withdraw')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('25.00 USDC')).toBeTruthy());
  });

  it('shows the compounded APY AND Compound\u2019s own simple APR, separately labelled', async () => {
    setWallet();
    render(<CompoundBaseUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(screen.getByText('farm.compound.apr')).toBeTruthy());
    const apr = screen.getByText('farm.compound.apr').parentElement.textContent;
    const apy = screen.getAllByText('farm.compound.apy')[0].parentElement.textContent;
    // Two different numbers, not the same figure printed twice.
    expect(apr).not.toBe(apy);
  });

  it('surfaces an existing borrow rather than hiding it behind the supply figure', async () => {
    setWallet({ provider: { positionWei: 25n * USDC_1, borrowWei: 7n * USDC_1 } });
    render(<CompoundBaseUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(screen.getByText('farm.compound.borrowed')).toBeTruthy());
    expect(screen.getByText('7.00 USDC')).toBeTruthy();
  });

  it('on the wrong chain, offers to switch instead of a button that would revert', async () => {
    // Flag off, a confirmed supply in the ledger, wallet sitting on Ethereum.
    const row = recordCompoundAction({
      action: 'supply', owner: OWNER, amountUsdcWei: 25n * USDC_1, amountUsdc: '25'
    });
    confirmCompoundAction(row.id, { txHash: '0xdead', blockNumber: 21_000_000 });

    setWallet({ chainId: 1 });
    render(<CompoundBaseUsdcPanel pool={POOL_ROW} />);
    await waitFor(() => expect(screen.getByText('farm.compound.switchChain')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('farm.compound.wrongChainNote')).toBeTruthy());
    expect(screen.queryByText('farm.compound.withdraw')).toBeNull();
    expect(screen.queryByText('farm.compound.supplyInApp')).toBeNull();
  });

  it('renders nothing when the wallet is on the wrong chain and has never supplied here', () => {
    setWallet({ chainId: 1, provider: { positionWei: 0n } });
    const { container } = render(<CompoundBaseUsdcPanel pool={POOL_ROW} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('farm.compound.wrongChainNote')).toBeNull();
  });

  it('does not offer a rewards figure the market cannot pay at these caps', async () => {
    setWallet();
    render(<CompoundBaseUsdcPanel pool={POOL_ROW} />);
    // baseMinForRewards is 1 000 USDC, above the 500 USDC total cap.
    await waitFor(() => expect(screen.getByText('farm.compound.rewardsFloor')).toBeTruthy());
  });
});
