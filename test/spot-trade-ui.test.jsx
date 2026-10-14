// @vitest-environment jsdom
/**
 * SPOT TRADE — the screen, rendered for real.
 *
 * What is real: SpotTrade, SpotSelect (the popup picker), SpotTokenRisk, the
 * order flow (runSpotOrder), the quote timer and the review sheet. What is
 * replaced: the wallet (no network, no keys), the market feed (fixed prices),
 * the token-risk reader, and the swap library's chain-touching functions.
 * Every replaced function is a counter, so the assertions read as "this many
 * signatures happened": the wallet is the only thing that can sign, and the
 * only route to it is the review's confirm button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import EN from '../src/i18n/locales/en.json';

/*
 * A `t()` that behaves like i18next does. A key that exists answers with itself
 * (so the assertions can read the key); a key that does NOT exist answers with
 * its defaultValue, or with the key when there is none. That last part is the
 * bug the error test below is written against: a bare `t('spot.err.X')` on a
 * code nobody translated printed «spot.err.X» to the user.
 */
const i18n = vi.hoisted(() => ({ keys: null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (i18n.keys && !i18n.keys.has(key) ? (opts?.defaultValue ?? key) : key),
    i18n: { language: 'en', changeLanguage: () => {} }
  })
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
      { id: 'binancecoin', price: 600, change24h: 1.2, sparkline: [1, 2, 3, 4, 5] },
      { id: 'tether', price: 1, change24h: 0, sparkline: [1, 1, 1, 1, 1] },
      { id: 'usd-coin', price: 1, change24h: 0.01, sparkline: [1, 1, 1, 1, 1] },
      { id: 'pancakeswap-token', price: 2.5, change24h: -3.4, sparkline: [5, 4, 3, 2, 1] }
    ],
    loading: false
  })
}));

/* The AI risk reader: one verdict, and a counter of what it was asked about. */
const riskState = vi.hoisted(() => ({ verdict: null, calls: [] }));
vi.mock('../src/lib/tokenRisk', () => ({
  goplusChainId: (chainId) => (Number(chainId) === 56 ? '56' : null),
  fetchTokenRisk: (args) => {
    riskState.calls.push(args);
    return Promise.resolve(riskState.verdict);
  },
  isTrustedNative: () => false
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

/** Every leaf key path in en.json, so the t() mock knows what exists. */
function leafKeys(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) leafKeys(v, path, out);
    else out.push(path);
  }
  return out;
}

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

/** Open a picker popup by its trigger id and hand back the portalled card. */
async function openPopup(triggerId) {
  fireEvent.click(document.getElementById(triggerId));
  return screen.findByTestId(`${triggerId}-popup`);
}

beforeEach(() => {
  localStorage.clear();
  i18n.keys = new Set(leafKeys(EN));
  riskState.calls = [];
  riskState.verdict = {
    score: 41,
    level: 'medium',
    honeypot: false,
    scam: false,
    contractRisk: 'medium',
    liquidityRisk: 'high',
    holderConcentration: 54,
    whaleActivity: 'elevated',
    rugPull: 30,
    flags: [{ id: 'lpUnlocked', severity: 'high', values: {} }],
    unknown: false,
    generatedAt: Date.now()
  };
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
  it('shows the connect card, and the review button is disabled', () => {
    walletState.current = disconnectedWallet();
    render(<SpotTrade />);
    expect(screen.getByText('spot.connectCard.title')).toBeTruthy();
    const cta = document.querySelector('.spot-cta');
    expect(cta.disabled).toBe(true);
    expect(screen.getByText('spot.err.WALLET_NOT_CONNECTED')).toBeTruthy();
  });

  it('the token picker IS the market: one popup, no search field, no separate market box', async () => {
    walletState.current = disconnectedWallet();
    const { container } = render(<SpotTrade />);
    // The old «بازار» column repeated the picker row for row; it is gone.
    expect(container.querySelector('.spot-market-col')).toBeNull();

    const popup = await openPopup('spot-asset');
    const options = within(popup).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    // «هیچ کدام باکس‌ها فیلد جستجو نداشته باشد»
    expect(popup.querySelector('input')).toBeNull();
    expect(popup.querySelector('input[type="search"]')).toBeNull();
    // Every row is one line: name, chart, price.
    expect(within(popup).getAllByText('CAKE').length).toBeGreaterThan(0);
    expect(popup.querySelectorAll('.spot-sel-spark').length).toBeGreaterThan(0);
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

describe('the pickers are popups: network, token and pay-with', () => {
  it('the network opens as a popup and choosing one switches the order network', async () => {
    walletState.current = connectedWallet({ chainId: 1 });
    render(<SpotTrade />);
    expect(screen.queryByText('spot.wrongNetwork.title')).toBeNull();

    const popup = await openPopup('spot-chain');
    expect(popup.querySelector('input')).toBeNull();
    fireEvent.click(popup.querySelector('[data-value="56"]'));

    expect(screen.getByText('spot.wrongNetwork.title')).toBeTruthy();
    fireEvent.click(screen.getByText('spot.wrongNetwork.switch'));
    await waitFor(() => expect(walletState.current.switchChain).toHaveBeenCalledWith(56));
  });

  it('the pay-with token is a popup with the token logos, and it lists no search field', async () => {
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    const popup = await openPopup('spot-quote');
    expect(popup.querySelector('input')).toBeNull();
    expect(within(popup).getAllByRole('option').length).toBeGreaterThan(0);
    expect(popup.querySelectorAll('.spot-sel-ico').length).toBeGreaterThan(0);
  });

  it('a wallet on the order network shows no wrong-network card', () => {
    walletState.current = connectedWallet({ chainId: 56 });
    render(<SpotTrade />);
    expect(screen.queryByText('spot.wrongNetwork.title')).toBeNull();
  });
});

describe('balances: a failed read is «unavailable», never zero', () => {
  it('a balance that throws shows the unavailable label in the picker rows', async () => {
    swap.getTokenBalance = vi.fn(async () => {
      throw new Error('rpc down');
    });
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    const popup = await openPopup('spot-asset');
    await waitFor(() => expect(within(popup).getAllByText('spot.balanceUnavailable').length).toBeGreaterThan(0));
    expect(popup.querySelectorAll('.spot-row-bal')[0].textContent).not.toMatch(/^0(\.0+)?\s/);
  });

  it('a resolved balance is shown with its symbol', async () => {
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    const popup = await openPopup('spot-asset');
    await waitFor(() => expect(popup.querySelector('.spot-row-bal').textContent).toMatch(/1000/));
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

describe('the two folds below the ticket: warnings and AI risk', () => {
  it('the three warnings live in one box that starts closed and opens', async () => {
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    const head = screen.getByRole('button', { name: /spot\.notices\.title/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(head);
    await waitFor(() => expect(head.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByText('spot.notice.own')).toBeTruthy();
    expect(screen.getByText('spot.notice.price')).toBeTruthy();
    expect(screen.getByText('spot.notice.gas')).toBeTruthy();
  });

  it('the AI risk box scans the selected token and shows the breakdown when opened', async () => {
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    // BNB is the network's own gas coin: there is no contract to scan.
    expect(screen.getByText('spot.risk.native')).toBeTruthy();

    const popup = await openPopup('spot-asset');
    fireEvent.click(popup.querySelector('[data-value="CAKE"]'));

    await waitFor(() =>
      expect(riskState.calls.some((c) => Number(c.chainId) === 56 && /^0x[a-fA-F0-9]{40}$/.test(String(c.address)))).toBe(true)
    );

    const head = screen.getByRole('button', { name: /risk\.badge/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(head);
    await waitFor(() => expect(head.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByText('risk.band.high')).toBeTruthy(); // liquidity
    expect(screen.getByText('risk.flag.lpUnlocked')).toBeTruthy();
    expect(screen.getByText('spot.risk.whaleLabel')).toBeTruthy();
  });
});

describe('the amount field', () => {
  it('the ≈ figure prices the token being PAID, not the asset', async () => {
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    // Buy: USDT (1 USD) is paid. Sell: BNB (600 USD) is paid.
    fireEvent.change(document.getElementById('spot-amount'), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByText(/≈ \$1\b/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /spot\.side\.sell/ }));
    fireEvent.change(document.getElementById('spot-amount'), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByText(/≈ \$600\b/)).toBeTruthy());
  });
});

describe('errors reach the reader as sentences, in the reader’s language', () => {
  it('a code nobody translated falls back to a real sentence, never to the key', async () => {
    swap.getQuote = vi.fn(async () => ({ error: 'MYSTERY_CODE' }));
    walletState.current = connectedWallet();
    render(<SpotTrade />);
    fireEvent.change(document.getElementById('spot-amount'), { target: { value: '1' } });
    await waitFor(() => expect(screen.getAllByText('spot.err.TX_FAILED').length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.queryAllByText('spot.err.MYSTERY_CODE').length).toBe(0);
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
