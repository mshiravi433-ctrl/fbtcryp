// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const state = vi.hoisted(() => ({ wallet: null, approve: vi.fn(), getDlnTx: vi.fn(), getDlnQuote: vi.fn(), getQuote: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/context/WalletContext', () => ({ useWallet: () => state.wallet }));
vi.mock('../src/components/AnimatedIcon', () => ({ useStill: () => true }));
vi.mock('../src/components/AssetIcon', () => ({ default: () => null }));
vi.mock('../src/components/crosschain/CrossChainHistory', () => ({ default: () => null }));
vi.mock('../src/components/crosschain/CrossChainStatus', () => ({ default: () => null }));
vi.mock('../src/store/useAppStore', () => ({ useAppStore: Object.assign((fn) => fn({}), { getState: () => ({ awardPoints: () => {} }) }) }));
vi.mock('../src/store/useSettingsStore', () => ({ useSettingsStore: (fn) => fn({ defaultSlippage: 0.5 }) }));
vi.mock('../src/lib/dln', async (original) => ({ ...await original(), getDlnTx: state.getDlnTx, getDlnQuote: state.getDlnQuote }));
vi.mock('../src/services/cross-chain', () => ({ crossChainService: {
  getRoutes: async () => ({ routes: [] }), getQuote: state.getQuote
} }));
vi.mock('ethers', () => ({ Contract: class {
  allowance = async () => 0n;
  approve = state.approve;
} }));
import Bridge from '../src/pages/Bridge';

const OWNER = '0x3456789012345678901234567890123456789012';
const TOKEN = '0x55d398326f99059ff775485246999027b3197955';
const BRIDGE = '0x1234567890123456789012345678901234567890';
const FRESH = '0x2345678901234567890123456789012345678901';
const OLD = '0x4567890123456789012345678901234567890123';
const advance = async (ms = 700) => act(async () => { await vi.advanceTimersByTimeAsync(ms); await vi.dynamicImportSettled(); });
const setup = async () => {
  render(<MemoryRouter initialEntries={['/bridge?amount=1']}><Bridge /></MemoryRouter>);
  await advance();
  fireEvent.click(screen.getByRole('button', { name: 'bridge.provider.dln' }));
};
beforeEach(() => {
  vi.useFakeTimers(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  state.wallet = { isConnected: true, address: OWNER, chainId: 56, getSigner: () => signer };
  signer.sendTransaction.mockClear();
  state.approve.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
  state.getQuote.mockReset().mockResolvedValue({ toAmount: '900000', fromAmountUsd: 1, transactionRequest: { to: BRIDGE, data: '0x12345678' } });
  state.getDlnQuote.mockReset().mockResolvedValue({ toAmount: '900000', allowanceTarget: OLD });
  state.getDlnTx.mockReset().mockResolvedValue({ toAmount: '900000', tx: { to: BRIDGE, data: '0x1234567800', allowanceTarget: FRESH, value: '0' } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const signer = {
  provider: { getNetwork: async () => ({ chainId: 56 }), getCode: async () => '0x6000' },
  getAddress: async () => OWNER,
  sendTransaction: vi.fn(async () => ({ hash: '0xhash' }))
};

it('deBridge reviews and approves the freshly built order spender, never the old quote spender', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'bridge.send' })); await advance();
  expect(screen.getByText(FRESH)).toBeTruthy();
  expect(screen.queryByText(OLD)).toBeNull();
  expect(state.approve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'bridge.safety.continue' })); await advance();
  expect(state.approve).toHaveBeenCalledWith(FRESH, 10n ** 18n, { chainId: 56 });
  expect(signer.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: BRIDGE, chainId: 56 }));
});
it('deBridge cancellation never sends an approval or bridge transaction', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'bridge.send' })); await advance();
  fireEvent.click(screen.getByRole('button', { name: 'bridge.cancel' })); await advance();
  expect(state.approve).not.toHaveBeenCalled(); expect(signer.sendTransaction).not.toHaveBeenCalled();
});
it('deBridge rejects a token contract as the bridge target before approval', async () => {
  state.getDlnTx.mockResolvedValue({ tx: { to: TOKEN, data: '0x12345678', allowanceTarget: FRESH } });
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'bridge.send' })); await advance();
  expect(screen.getByText('bridge.err.GENERIC')).toBeTruthy();
  expect(state.approve).not.toHaveBeenCalled(); expect(signer.sendTransaction).not.toHaveBeenCalled();
});
it('an edited amount disables stale routes immediately, before the debounce fires', async () => {
  await setup();
  expect(screen.getByRole('button', { name: 'bridge.send' }).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('bridge.amount'), { target: { value: '2' } });
  expect(screen.getByRole('button', { name: 'bridge.send' }).disabled).toBe(true);
  await advance();
  expect(screen.getByRole('button', { name: 'bridge.send' }).disabled).toBe(false);
});
it('an invalid destination cannot silently fall back to the sender', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'bridge.optionsTitle' })); await advance();
  fireEvent.change(screen.getByLabelText('bridge.toAddressLabel'), { target: { value: '0x123' } });
  await advance();
  expect(screen.getByRole('button', { name: 'bridge.send' }).disabled).toBe(true);
});
