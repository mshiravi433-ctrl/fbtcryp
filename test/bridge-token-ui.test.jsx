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

/*
 * ─── THE CAROUSEL IS GONE, AND THE SLOT IT HELD NOW SELLS FARM ─────────────
 *
 * «بنر بالای صفحه که مربوط به ترون و سولانا هست را محو کن و ببرش، به‌درد
 * نمی‌خورد … پایین صفحه‌ش یک بنر تبلیغاتی خیلی مدرن با انیمیشن برای تبلیغ
 * فارم بزار».
 *
 * Two things had to be true at once, so both are asserted: the top banner is
 * ABSENT (not merely hidden — a `display:none`ed carousel still costs its
 * fetches and its timers), and the two routes it advertised are still reachable
 * from the tab rail below, because deleting a promo must never delete a tab.
 */
it('drops the tron/solana carousel but keeps both routes on the mode rail', async () => {
  render(<MemoryRouter initialEntries={['/bridge']}><Bridge /></MemoryRouter>);
  await advance();

  expect(document.querySelector('.brg-hero')).toBeNull();
  expect(screen.queryByText('bridge.hero.tron.title')).toBeNull();

  // the two modes are still one tap away, under their own labels
  expect(screen.getByRole('tab', { name: 'bridge.mode.tron' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'bridge.mode.solana' })).toBeTruthy();
});

it('pitches Farm at the foot of the page, after the ticket and the disclosure', async () => {
  const { container } = render(<MemoryRouter initialEntries={['/bridge']}><Bridge /></MemoryRouter>);
  await advance();

  const promo = container.querySelector('.farm-promo');
  expect(promo).toBeTruthy();
  expect(screen.getByText('bridge.farmPromo.title')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'bridge.farmPromo.cta' })).toBeTruthy();

  /* Below the custody warning, never above it: a promotion printed over the
     one paragraph that says «we cannot recover your transfer» reads as an
     attempt to bury it. `InfoBox` is the last thing the page renders before
     the banner, so its title is the anchor to compare against. */
  const trust = screen.getByText('bridge.trustTitle').closest('section, div');
  expect(trust).toBeTruthy();
  expect(trust.compareDocumentPosition(promo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

/*
 * ─── NO PICKER MAY RAISE THE KEYBOARD ON ITS OWN ───────────────────────────
 *
 * «باکس‌های پاپ‌اپ برای انتخاب توکن و شبکه … هر بار می‌زنه خودکار صفحه کلید هم
 * باز می‌شود». The old sheet rendered `<input autoFocus>` from six options up,
 * so opening the network list covered half of it with a keyboard. This asserts
 * the property, not the implementation: after tapping a picker trigger, there
 * is no focused text field anywhere in the document.
 */
it('opening a token or network picker focuses nothing and shows no search box', async () => {
  render(<MemoryRouter initialEntries={['/bridge']}><Bridge /></MemoryRouter>);
  await advance();

  fireEvent.click(screen.getByTestId('bridge-from-chain').querySelector('.modern-select-trigger'));
  await advance(350);

  const active = document.activeElement;
  expect(active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA').toBe(false);
  expect(document.querySelector('.modern-select-search')).toBeNull();
  expect(document.querySelector('.modern-select-option')).toBeTruthy();
});
