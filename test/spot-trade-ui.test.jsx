// @vitest-environment jsdom
/**
 * SPOT TRADE — the screen, rendered for real.
 *
 * What is real: SpotTrade, SpotMarketList, the order flow (runSpotOrder), the
 * quote timer and the review sheet. What is replaced: the wallet (no network,
 * no keys), the market feed (fixed prices), and the swap library's
 * chain-touching functions. Every replaced function is a counter, so the
 * assertions read as "this many signatures happened": the wallet is the only
 * thing that can sign, and the only route to it is the review's confirm button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: () => {} } })
}));

const walletState = { current: null };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => walletState.current
}));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: () => {} })
}));

vi.mock('../src/hooks/useHideBalances', () => ({ useHideBalances: () => false }));

vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => ({
    data: [
      { id: 'binancecoin', price: 600, change24h: 1.2 },
      { id: 'tether', price: 1, change24h: 0 }
    ],
    loading: false
  })
}));

vi.mock('../src/components/WalletConnectSheet', () => ({ default: () => null }));

vi.mock('../src/pages/Trade', () => ({
  default: (props) => <div data-testid="paper-trade" data-embedded={String(Boolean(props?.embedded))} />
}));

// The swap library: the functions that touch a chain are counters. Everything
// else (constants, token list, formatting) is the real module.
const swap = vi.hoisted(() => ({
  getQuote: null,
  getTokenBalance: null,
  needsApproval: null,
  approveToken: null,
  executeSwap: null,
  getPriceImpact: null,
  estimateGasCost: null
}));
vi.mock('../src/lib/swap', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getQuote: (...a) => swap.getQuote(...a),
    getTokenBalance: (...a) => swap.getTokenBalance(...a),
    needsApproval: (...a) => swap.needsApproval(...a),
    approveToken: (...a) => swap.approveToken(...a),
    executeSwap: (...a) => swap.executeSwap(...a),
    getPriceImpact: (...a) => swap.getPriceImpact(...a),
    estimateGasCost: (...a) => swap.estimateGasCost(...a)
  };
});

import SpotTrade from '../src/components/spot/SpotTrade';
import { recordSwap } from '../src/lib/swapHistory';

const ADDR = '0x1111111111111111111111111111111111111111';
const ONE = 10n ** 18n;

/** A quote shaped like getQuote's real success return (see lib/swap.js). */
function quote(over = {}) {
  return {
    path: ['0xaaa', '0xbbb'],
    amountInWei: ONE,
    swapInWei: ONE,
    platformFeeWei: 0n,
    platformFee: 0,
    feeBps: 0,
    amountOutWei: 2n * ONE,
    minOutWei: 2n * ONE - (2n * ONE * 5n) / 1000n,
    amountOut: 2,
    minOut: 1.99,
    rate: 2,
    hops: 1,
    slippage: 0.5,
    ...over
  };
}

function connectedWallet(over = {}) {
  return {
    isConnected: true,
    locked: false,
    address: ADDR,
    chainId: 56,
    chainOk: true,
    locked_: false,
    switchChain: vi.fn(() => Promise.resolve()),
    getReadProvider: vi.fn(() => Promise.resolve({ __provider: true })),
    getSigner: () => ({ __signer: true }),
    ensureSigner: vi.fn(() => Promise.resolve({ __signer: true })),
    ...over
  };
}

function disconnectedWallet() {
  return {
    isConnected: false,
    locked: false,
    address: null,
    chainId: 56,
    chainOk: true,
    switchChain: vi.fn(() => Promise.resolve()),
    getReadProvider: vi.fn(() => Promise.resolve({ __provider: true })),
    getSigner: () => null,
    ensureSigner: vi.fn(() => Promise.resolve(null))
  };
}

beforeEach(() => {
  localStorage.clear();
  swap.getQuote = vi.fn(async () => quote());
  swap.getTokenBalance = vi.fn(async () => ({ raw: 1000n * ONE, formatted: 1000 }));
  swap.needsApproval = vi.fn(async () => false);
  swap.approveToken = vi.fn(async () => ({ hash: '0xapprove', wait: async () => ({ status: 1 }) }));
  swap.executeSwap = vi.fn(async () => ({ hash: '0xswap', wait: async () => ({ status: 1 }) }));
  swap.getPriceImpact = vi.fn(async () => 0.1);
  swap.estimateGasCost = vi.fn(async () => 0.0001);
});

afterEach(() => {
  cleanup();
  walletState.current = null;
  vi.clearAllMocks();
});

describe('not connected: the market is readable, nothing can be signed', () => {
  it('shows the market and the connect card, and the review button is disabled', async () => {
    walletState.current = disconnectedWallet();
    render(<SpotTrade />);
    expect(screen.getByText('spot.connectCard.title')).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    const cta = document.querySelector('.spot-cta');
    expect(cta.disabled).toBe(true);
    expect(screen.getByText('spot.err.WALLET_NOT_CONNECTED')).toBeTruthy();
  });

  it('typing an amount still signs nothing and reads no balances', async () => {
    walletState.current = disconnectedWallet();
    render(<SpotTrade />);
    fireEvent.change(document.getElementById('spot-amount'), { target: { value: '1' } });
    await new Promise((r) => setTimeout(r, 450));
    expect(swap.approveToken).not.toHaveBeenCalled();
    expect(swap.executeSwap).not.toHaveBeenCalled();
    expect(swap.getTokenBalance).not.toHaveBeenCalled();
  });
});

describe('wrong network: a clear message and a switch, never a silent trade', () => {
  it('an order on a network the wallet is not on shows the card, and can ask the wallet to switch', async () => {
    // The order network follows the wallet when the wallet is on a supported
    // chain. To get a mismatch the user picks another network, as they would.
    walletState.current = connectedWallet({ chainId: 1 });
    render(<SpotTrade />);
    expect(screen.queryByText('spot.wrongNetwork.title')).toBeNull();
    fireEvent.change(document.getElementById('spot-chain'), { target: { value: '56' } });
    expect(screen.getByText('spot.wrongNetwork.title')).toBeTruthy();
    fireEvent.click(screen.getByText('spot.wrongNetwork.switch'));
    await waitFor(() => expect(walletState.current.switchChain).toHaveBeenCalledWith(56));
  });

  it('a wallet on the order network shows no wrong-network card', () => {
    walletState.current = connectedWallet({ chainId: 56 });
    render(<SpotTrade />);
    expect(screen.queryByText('spot.wrongNetwork.title')).toBeNull();
  });
});

describe('balances: a failed read is «unavailable», never zero', () => {
  it('a balance that throws shows the unavailable label in the market list', async () => {
    swap.getTokenBalance = vi.fn(async () => {
      throw new Error('rpc down');
    });
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    await waitFor(() => expect(screen.getAllByText('spot.balanceUnavailable').length).toBeGreaterThan(0));
    expect(document.querySelectorAll('.spot-row-bal')[0].textContent).not.toMatch(/^0(\.0+)?\s/);
  });

  it('a resolved balance is shown with its symbol', async () => {
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    await waitFor(() => expect(document.querySelector('.spot-row-bal').textContent).toMatch(/1000/));
  });
});

describe('paper trading is separate, labelled, and never the real path', () => {
  it('the paper tab shows the trial banner and the embedded paper screen, with no real order button', async () => {
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    fireEvent.click(screen.getByRole('tab', { name: /spot.mode.paper/ }));
    expect(screen.getByText('spot.paperBanner')).toBeTruthy();
    const paper = screen.getByTestId('paper-trade');
    expect(paper.getAttribute('data-embedded')).toBe('true');
    expect(document.querySelector('.spot-cta')).toBeNull();
  });
});

describe('the real order: nothing is signed until the review confirm is clicked', () => {
  it('quote → review → confirm sends exactly one swap, with zero approvals', async () => {
    walletState.current = connectedWallet();
    render(<SpotTrade />);

    fireEvent.change(document.getElementById('spot-amount'), { target: { value: '1' } });

    // The review button enables once the quote is fresh and the balance covers it.
    await waitFor(() => expect(document.querySelector('.spot-cta').disabled).toBe(false), { timeout: 3000 });

    // Opening the review signs nothing.
    fireEvent.click(document.querySelector('.spot-cta'));
    const sheetTitle = await screen.findByText('spot.review.title');
    expect(sheetTitle).toBeTruthy();
    expect(swap.approveToken).not.toHaveBeenCalled();
    expect(swap.executeSwap).not.toHaveBeenCalled();
    expect(walletState.current.ensureSigner).not.toHaveBeenCalled();

    // The review shows the platform fee, the network fee line, the route and the receiving address.
    expect(screen.getAllByText('swap.recipient').length).toBeGreaterThan(0);
    expect(screen.getAllByText('swap.route').length).toBeGreaterThan(0);
    expect(screen.getAllByText('spot.platformFee').length).toBeGreaterThan(0);

    // Only the confirm button moves funds.
    fireEvent.click(screen.getByRole('button', { name: 'spot.review.confirm' }));
    await waitFor(() => expect(swap.executeSwap).toHaveBeenCalledTimes(1));
    expect(swap.approveToken).not.toHaveBeenCalled();
    expect(swap.executeSwap.mock.calls[0][0].signer).toEqual({ __signer: true });
  });

  it('the user rejects in the wallet → cancelled, the swap is not retried', async () => {
    swap.executeSwap = vi.fn(async () => {
      const err = new Error('User rejected the request.');
      err.code = 4001;
      throw err;
    });
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    fireEvent.change(document.getElementById('spot-amount'), { target: { value: '1' } });
    await waitFor(() => expect(document.querySelector('.spot-cta').disabled).toBe(false), { timeout: 3000 });
    fireEvent.click(document.querySelector('.spot-cta'));
    fireEvent.click(await screen.findByRole('button', { name: 'spot.review.confirm' }));
    expect(await screen.findByText('spot.status.cancelled')).toBeTruthy();
    expect(swap.executeSwap).toHaveBeenCalledTimes(1);
    expect(swap.approveToken).not.toHaveBeenCalled();
  });
});

describe('history: only spot orders appear in the spot tab', () => {
  it('the spot history panel shows spot rows and hides swap-page rows', async () => {
    recordSwap({ network: 'evm', chainId: 56, from: '1', fromSymbol: 'USDT', to: '2', toSymbol: 'BNB', status: 'confirmed', source: null });
    recordSwap({ network: 'evm', chainId: 56, from: '3', fromSymbol: 'USDT', to: '4', toSymbol: 'CAKE', status: 'confirmed', source: 'spot' });
    walletState.current = connectedWallet();
    const { container } = render(<SpotTrade />);
    const history = container.querySelector('.spot-history');
    const rows = within(history).queryAllByText(/CAKE|BNB/);
    expect(rows.some((el) => el.textContent.includes('CAKE'))).toBe(true);
    expect(rows.some((el) => el.textContent.includes('BNB'))).toBe(false);
  });
});
