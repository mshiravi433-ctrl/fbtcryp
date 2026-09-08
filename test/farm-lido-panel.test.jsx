// @vitest-environment jsdom
/**
 * Lido panel gating. The Lido adapter owns the on-chain reads; this test only
 * supplies a deterministic chain-shaped provider and checks the money-in kill
 * switch never removes exits (wrap, unwrap, withdrawal request, claim).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AbiCoder, Interface } from 'ethers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: () => {} } })
}));

const walletState = { current: null };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => walletState.current
}));

import LidoPanel from '../src/components/Farm/LidoPanel';
import { LIDO } from '../src/lib/defi/lido';
import { LIDO_STAKE_ENABLED } from '../src/lib/features';
import { confirmLidoAction, recordLidoAction } from '../src/lib/defi/lidoHistory';

const OWNER = '0x1111111111111111111111111111111111111111';
const coder = AbiCoder.defaultAbiCoder();
const ZERO = '0x0000000000000000000000000000000000000000';
const ST = new Interface([
  'function getTotalPooledEther() view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function sharesOf(address) view returns (uint256)',
  'function getTotalShares() view returns (uint256)',
  'function getFee() view returns (uint16)',
  'function getBufferedEther() view returns (uint256)',
  'function isStakingPaused() view returns (bool)',
  'function allowance(address,address) view returns (uint256)'
]);
const WST = new Interface([
  'function stETH() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function getStETHByWstETH(uint256) view returns (uint256)'
]);
const Q = new Interface([
  'function WSTETH() view returns (address)',
  'function STETH() view returns (address)',
  'function getWithdrawalQueueLength() view returns (uint256)',
  'function getWithdrawalRequests(address) view returns (uint256[])',
  'function getWithdrawalStatus(uint256[]) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])',
  'function isPaused() view returns (bool)',
  'function isBunkerModeActive() view returns (bool)'
]);

const selector = (iface, name) => iface.getFunction(name).selector;
const enc = (types, values) => coder.encode(types, values);

function makeProvider({ stETHWei = 2n * 10n ** 18n, wstETHWei = 0n, queueIds = [], allowances = [0n, 0n] } = {}) {
  const s = {
    total: selector(ST, 'getTotalPooledEther'), symbol: selector(ST, 'symbol'), decimals: selector(ST, 'decimals'),
    balance: selector(ST, 'balanceOf'), shares: selector(ST, 'sharesOf'), totalShares: selector(ST, 'getTotalShares'),
    fee: selector(ST, 'getFee'), buffered: selector(ST, 'getBufferedEther'), stakingPaused: selector(ST, 'isStakingPaused'), allowance: selector(ST, 'allowance')
  };
  const w = { stETH: selector(WST, 'stETH'), balance: selector(WST, 'balanceOf'), rate: selector(WST, 'getStETHByWstETH') };
  const q = {
    wst: selector(Q, 'WSTETH'), st: selector(Q, 'STETH'), length: selector(Q, 'getWithdrawalQueueLength'),
    requests: selector(Q, 'getWithdrawalRequests'), status: selector(Q, 'getWithdrawalStatus'), paused: selector(Q, 'isPaused'), bunker: selector(Q, 'isBunkerModeActive')
  };
  const provider = {
    async getNetwork() { return { chainId: 1n }; },
    async getBalance() { return 10n ** 18n; },
    async estimateGas() { return 120000n; },
    async call(tx) {
      const to = String(tx.to).toLowerCase();
      const sig = String(tx.data).slice(0, 10);
      if (to === LIDO.stETH.toLowerCase()) {
        if (sig === s.total) return enc(['uint256'], [100_000n * 10n ** 18n]);
        if (sig === s.symbol) return enc(['string'], ['stETH']);
        if (sig === s.decimals) return enc(['uint8'], [18]);
        if (sig === s.balance) return enc(['uint256'], [stETHWei]);
        if (sig === s.shares) return enc(['uint256'], [stETHWei]);
        if (sig === s.totalShares) return enc(['uint256'], [100_000n * 10n ** 18n]);
        if (sig === s.fee) return enc(['uint16'], [1000]);
        if (sig === s.buffered) return enc(['uint256'], [1000n * 10n ** 18n]);
        if (sig === s.stakingPaused) return enc(['bool'], [false]);
        if (sig === s.allowance) {
          const index = String(tx.data).slice(-40).toLowerCase() === LIDO.wstETH.slice(2).toLowerCase() ? 0 : 1;
          return enc(['uint256'], [allowances[index]]);
        }
      }
      if (to === LIDO.wstETH.toLowerCase()) {
        if (sig === w.stETH) return enc(['address'], [LIDO.stETH]);
        if (sig === w.balance) return enc(['uint256'], [wstETHWei]);
        if (sig === w.rate) return enc(['uint256'], [wstETHWei]);
      }
      if (to === LIDO.withdrawalQueue.toLowerCase()) {
        if (sig === q.wst) return enc(['address'], [LIDO.wstETH]);
        if (sig === q.st) return enc(['address'], [LIDO.stETH]);
        if (sig === q.length) return enc(['uint256'], [BigInt(queueIds.length)]);
        if (sig === q.requests) return enc(['uint256[]'], [queueIds]);
        if (sig === q.status) {
          const rows = queueIds.map((id) => [1n * 10n ** 18n, 1n * 10n ** 18n, OWNER, 1_700_000_000n, false, false]);
          return enc(['tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[]'], [rows]);
        }
        if (sig === q.paused || sig === q.bunker) return enc(['bool'], [false]);
      }
      throw new Error(`unhandled Lido mock call ${to} ${sig}`);
    }
  };
  return provider;
}

const POOL = { project: 'lido', chain: 'Ethereum', symbol: 'stETH', exposure: 'single', ilRisk: false };
const setWallet = (over = {}) => {
  walletState.current = {
    address: OWNER,
    chainId: 1,
    isConnected: true,
    nativeBalance: 1,
    getReadProvider: async () => makeProvider(over.provider),
    getSigner: () => null,
    switchChain: async () => true,
    ...over
  };
};

describe('lido panel gating', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('ships with staking disabled', () => {
    expect(LIDO_STAKE_ENABLED).toBe(false);
  });

  it('does not render for a non-Lido pool', () => {
    setWallet();
    const { container } = render(<LidoPanel pool={{ project: 'aave-v3', chain: 'Ethereum', symbol: 'stETH' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('keeps exits reachable when stake entry is disabled', async () => {
    setWallet({ provider: { stETHWei: 2n * 10n ** 18n } });
    render(<LidoPanel pool={POOL} />);
    await waitFor(() => expect(screen.getByText('farm.lido.wrap')).toBeTruthy());
    expect(screen.queryByText('farm.lido.stakeInApp')).toBeNull();
    expect(screen.getByText('farm.lido.unwrap')).toBeTruthy();
    expect(screen.getByText('farm.lido.requestWithdraw')).toBeTruthy();
    expect(screen.getAllByText('farm.lido.claim').length).toBeGreaterThan(0);
  });

  it('shows the chain recovery prompt from a confirmed local stake ledger', async () => {
    const row = recordLidoAction({ action: 'stake', owner: OWNER, amountWei: '1000000000000000000', amount: 1, symbol: 'ETH' });
    confirmLidoAction(row.id, { txHash: '0xdead', blockNumber: 20_000_000 });
    setWallet({ chainId: 137, provider: { stETHWei: 0n } });
    render(<LidoPanel pool={POOL} />);
    await waitFor(() => expect(screen.getByText('farm.lido.wrongChainNote')).toBeTruthy());
    expect(screen.getByText('farm.lido.switchChain')).toBeTruthy();
  });
});
