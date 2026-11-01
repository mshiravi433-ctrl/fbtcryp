// @vitest-environment jsdom
/**
 * THE SOLANA TRACKING PANEL — what the Smart Wallet's reader actually sees.
 * ===========================================================================
 *   «در کیف پول هوشمند ردیابی sol کیف پول و تراکنش و نهنگ های سولانا را اضافه کن»
 *
 * The strings asserted here are the REAL ones from src/i18n/locales/fa.json,
 * imported rather than retyped: a key that is missing from the locale would
 * print as `smart.sol.tokensUnread` on a wallet screen, and that is exactly the
 * failure this file is built to catch.
 *
 * Pinned:
 *   1 · nothing is fetched for a wallet until an address exists, and an address
 *     that is not base-58 is answered in the field, not by the server;
 *   2 · the wallet segment prints balance, value, price and tokens — and when
 *     the node did NOT answer the token program, it says «خوانده نشد» instead of
 *     the very different claim «توکنی ندارد»;
 *   3 · the transaction segment prints the node's own 25-signature window WITH
 *     the window stated next to the counts;
 *   4 · the whale segment prints movements, the floor, the coverage sentence —
 *     and an empty feed says WHICH kind of empty it is;
 *   5 · a dead node prints «گره پاسخ نداد» and no numbers at all;
 *   6 · refresh bypasses the client cache, and the watched address survives a
 *     remount;
 *   7 · the read-only promise is on the panel in every state.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import fa from '../src/i18n/locales/fa.json';

/* The real locale, interpolated the way i18next does it. A missing key returns
   the key itself — which is what the app would print, and what several
   assertions below are looking for. */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      const raw = key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), fa);
      let out = typeof raw === 'string' ? raw : key;
      if (opts && typeof opts === 'object') {
        for (const [name, value] of Object.entries(opts)) out = out.replaceAll(`{{${name}}}`, String(value));
      }
      return out;
    },
    i18n: { language: 'fa', resolvedLanguage: 'fa' }
  })
}));

import SolTrackPanel from '../src/components/smart-wallet/SolTrackPanel.jsx';
import { invalidateSolTrack, loadWatchedAddress, shortSolAddress } from '../src/lib/solTrack';

const ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER = 'DYfRFzXcMN7oXH6V1VKbFGwLfCp6P2eG8XKkczGR8yVd';
const SIG_OK = '5xQ7nMZ1kRtJqL8pVrN2sWbYhC4dE6fG9jK1mN3oP5qR7sT9uV2wX4yZ6aB8cD1e';
const SIG_FAILED = '2aB4cD6eF8gH1jK3mN5oP7qR9sT1uV3wX5yZ7aB9cD1eF3gH5jK7mN9oP1qR3sT5';

/** The same interpolation the mock performs, so an assertion can build the
    exact string the panel is expected to print. */
const text = (key, opts) => {
  const raw = key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), fa);
  let out = typeof raw === 'string' ? raw : key;
  if (opts && typeof opts === 'object') {
    for (const [name, value] of Object.entries(opts)) out = out.replaceAll(`{{${name}}}`, String(value));
  }
  return out;
};

/** A wallet payload exactly as server/solanaTrack.js returns it. */
function walletPayload(overrides = {}) {
  return {
    schema: 'fbt.solana-track.v1',
    available: true,
    address: ADDRESS,
    vs: 'usd',
    updatedAt: new Date(Date.now() - 4_000).toISOString(),
    native: {
      symbol: 'SOL', lamports: 1_250_000_000_000, balance: 1250, price: 178.42,
      priceChange24hPct: 3.21, value: 223025, currency: 'usd'
    },
    tokens: [
      { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 4200.5, decimals: 6, uiAmountString: '4200.5' },
      { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', amount: 12.25, decimals: 6, uiAmountString: '12.25' }
    ],
    tokenCount: 2,
    transactions: [
      { signature: SIG_OK, slot: 300000011, at: Date.now() - 62_000, failed: false, memo: null },
      { signature: SIG_FAILED, slot: 300000009, at: Date.now() - 90_000_000, failed: true, memo: 'swap' }
    ],
    activity: { windowSize: 25, last24h: 1, failed24h: 0, failedInWindow: 1, lastAt: Date.now() - 62_000 },
    partial: { balance: false, tokens: false, transactions: false },
    ...overrides
  };
}

function whalePayload(overrides = {}) {
  return {
    schema: 'fbt.solana-whale-watch.v1',
    available: true,
    vs: 'usd',
    solPrice: 178.42,
    updatedAt: new Date().toISOString(),
    floorSol: 1000,
    transfers: [
      {
        id: 'sig1:a:b', signature: 'sig1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', slot: 300000020,
        at: Date.now() - 25_000, from: ADDRESS, to: OTHER, lamports: 4_200_000_000_000, sol: 4200,
        value: 749364, asset: 'SOL', source: 'rpc-block-sample'
      }
    ],
    coverage: {
      blocksPerRefresh: 1,
      lastSample: { slot: 300000020, head: 300000084, transactions: 1841, found: 3, upstream: 'mainnet-beta', at: new Date().toISOString() },
      ledgerSize: 1, oldestAt: Date.now() - 25_000, newestAt: Date.now() - 25_000,
      sources: ['rpc-block-sample'], solscanConfigured: false, blockScanEnabled: true, errors: []
    },
    reason: null,
    ...overrides
  };
}

/** Install a fetch that serves the two tracking routes from fixtures. */
function serve({ wallet = walletPayload(), whales = whalePayload(), walletStatus = 200, whaleStatus = 200 } = {}) {
  const calls = [];
  global.fetch = vi.fn(async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/solana/track/wallet')) {
      const body = walletStatus === 200 ? wallet : { error: wallet.error || 'RPC_UNAVAILABLE', detail: 'no upstream' };
      return { ok: walletStatus === 200, status: walletStatus, json: async () => body };
    }
    if (href.includes('/solana/track/whales')) {
      const body = whaleStatus === 200 ? whales : { error: 'SOLANA_WHALE_FEED_FAILED' };
      return { ok: whaleStatus === 200, status: whaleStatus, json: async () => body };
    }
    throw new Error(`unexpected fetch in test: ${href}`);
  });
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  invalidateSolTrack();
  delete window.solana;
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); invalidateSolTrack(); });

const renderPanel = () => render(<SolTrackPanel vs="usd" currencySymbol="$" />);

describe('Solana tracking panel — the address', () => {
  it('reads the whale feed on mount but no wallet until an address exists', async () => {
    const calls = serve();
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('sol-track-wallet')).toBeTruthy());

    expect(screen.getByTestId('sol-track-wallet').textContent).toContain(text('smart.sol.pickAddress'));
    expect(calls.some((c) => c.includes('/track/whales'))).toBe(true);
    expect(calls.some((c) => c.includes('/track/wallet'))).toBe(false);
    /* The promise is printed whether or not anything is being tracked. */
    expect(screen.getByTestId('sol-track').textContent).toContain(text('smart.sol.readonlyNote'));
  });

  it('answers an address that is not base-58 in the field, without a request', async () => {
    const calls = serve();
    renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' } });
    fireEvent.click(screen.getByTestId('sol-track-go'));
    await waitFor(() => expect(screen.getByTestId('sol-track').textContent).toContain(text('smart.sol.badAddress')));

    expect(calls.some((c) => c.includes('/track/wallet'))).toBe(false);
    expect(loadWatchedAddress()).toBe(null);
  });

  it('tracks a pasted address, prints it, and remembers it across a remount', async () => {
    const calls = serve();
    const view = renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('sol-track-go'));

    await waitFor(() => expect(calls.some((c) => c.includes(`address=${ADDRESS}`))).toBe(true));
    expect(loadWatchedAddress()).toBe(ADDRESS);

    /* A remount (leaving the screen and coming back) starts from storage. */
    view.unmount();
    invalidateSolTrack();
    const calls2 = serve();
    renderPanel();
    await waitFor(() => expect(calls2.some((c) => c.includes(`address=${ADDRESS}`))).toBe(true));
    expect(screen.getByTestId('sol-track-input').value).toBe(ADDRESS);
  });
});

describe('Solana tracking panel — the wallet segment', () => {
  it('prints the balance, its value, the price and the tokens the node reported', async () => {
    serve();
    renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('sol-track-go'));

    const body = await screen.findByTestId('sol-track-wallet');
    await waitFor(() => expect(body.textContent).toContain('1,250.00'));
    expect(body.textContent).toContain('SOL');
    expect(body.textContent).toContain('$223,025');
    expect(body.textContent).toContain('$178.42');
    expect(body.textContent).toContain('+3.21%');
    expect(body.textContent).toContain('4,200.50');
    expect(body.textContent).toContain('EPjF…Dt1v');
    /* Nothing invented: no label this app cannot source. */
    expect(body.textContent).not.toContain(text('smart.sol.tokensUnread'));
    expect(body.textContent).not.toContain(text('smart.sol.balanceUnread'));
  });

  it('says a token read FAILED instead of claiming the wallet holds none', async () => {
    serve({ wallet: walletPayload({ tokens: null, tokenCount: 0, partial: { balance: false, tokens: true, transactions: false } }) });
    renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('sol-track-go'));

    const body = await screen.findByTestId('sol-track-wallet');
    await waitFor(() => expect(body.textContent).toContain(text('smart.sol.tokensUnread')));
    expect(body.textContent).not.toContain(text('smart.sol.noTokens'));
  });

  it('prints a wallet that genuinely holds no tokens as empty, not as unread', async () => {
    serve({ wallet: walletPayload({ tokens: [], tokenCount: 0 }) });
    renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('sol-track-go'));

    const body = await screen.findByTestId('sol-track-wallet');
    await waitFor(() => expect(body.textContent).toContain(text('smart.sol.noTokens')));
    expect(body.textContent).not.toContain(text('smart.sol.tokensUnread'));
  });

  it('prints a dead node as a dead node — and no numbers at all', async () => {
    serve({ walletStatus: 502 });
    renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('sol-track-go'));

    await waitFor(() => expect(screen.getByTestId('sol-track').textContent).toContain(text('smart.sol.rpcDown')));
    const body = screen.getByTestId('sol-track-wallet');
    expect(body.textContent).not.toContain('$');
    expect(body.textContent).not.toMatch(/\d\.\d\d/);
  });
});

describe('Solana tracking panel — the transaction segment', () => {
  it('lists the node\'s signatures with their state, and states the window the counts came from', async () => {
    serve();
    renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('sol-track-go'));
    await waitFor(() => expect(screen.getByTestId('sol-track-wallet').textContent).toContain('1,250.00'));

    fireEvent.click(screen.getByText(text('smart.sol.tabTx')));
    const body = screen.getByTestId('sol-track-tx');
    /* The panel shortens a 64-character signature to six characters each end. */
    expect(body.textContent).toContain(shortSolAddress(SIG_OK, 6, 6));
    expect(body.textContent).toContain(shortSolAddress(SIG_FAILED, 6, 6));
    expect(body.textContent).toContain(text('smart.sol.ok'));
    expect(body.textContent).toContain(text('smart.sol.failed'));
    expect(body.textContent).toContain('swap', 'a memo the node reported is shown, not dropped');
    /* THE WINDOW IS PART OF THE NUMBER. A node gives no lifetime count, so
       «1 in the last 24h» must be printed as «1 in the last 25 signatures». */
    expect(body.textContent).toContain(text('smart.sol.txWindow', { n: 25 }));
    expect(body.textContent).toContain(text('smart.sol.last24h'));
    /* Every row links to the explorer the rest of the app links to. */
    const links = [...body.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links.filter((h) => h && h.startsWith('https://solscan.io/tx/')).length).toBe(2);
  });

  it('prints an empty recent window as empty', async () => {
    serve({ wallet: walletPayload({ transactions: [], activity: { windowSize: 25, last24h: 0, failed24h: 0, failedInWindow: 0, lastAt: null } }) });
    renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('sol-track-go'));
    await waitFor(() => expect(screen.getByTestId('sol-track-wallet').textContent).toContain('1,250.00'));
    fireEvent.click(screen.getByText(text('smart.sol.tabTx')));
    expect(screen.getByTestId('sol-track-tx').textContent).toContain(text('smart.sol.noTx'));
  });
});

describe('Solana tracking panel — the whale segment', () => {
  it('prints movements with the floor, the sources and the coverage sentence', async () => {
    serve();
    renderPanel();
    fireEvent.click(screen.getByText(text('smart.sol.tabWhales')));

    const body = await screen.findByTestId('sol-track-whales');
    await waitFor(() => expect(body.textContent).toContain('4,200'));
    expect(body.textContent).toContain(text('smart.sol.whaleFloor', { n: 1000 }));
    expect(body.textContent).toContain(text('smart.sol.source.rpcBlockSample'));
    expect(body.textContent).toContain(text('smart.sol.whaleCoverage'));
    expect(body.textContent).toContain('9WzD…AWWM');
    expect(body.textContent).toContain('DYfR…8yVd');
    expect(body.textContent).toContain('$749,364');
    expect(body.textContent).toContain(text('smart.sol.viewTx'));
  });

  it('distinguishes «nothing large moved in the blocks we read» from «we could not read»', async () => {
    serve({ whales: whalePayload({ available: false, transfers: [], reason: 'NO_MOVEMENTS_IN_SAMPLE' }) });
    renderPanel();
    fireEvent.click(screen.getByText(text('smart.sol.tabWhales')));
    await waitFor(() => expect(screen.getByTestId('sol-track-whales').textContent).toContain(text('smart.sol.whaleEmpty')));

    cleanup();
    invalidateSolTrack();
    serve({ whales: whalePayload({ available: false, transfers: [], reason: 'UPSTREAM_UNAVAILABLE' }) });
    renderPanel();
    fireEvent.click(screen.getByText(text('smart.sol.tabWhales')));
    await waitFor(() => expect(screen.getByTestId('sol-track-whales').textContent).toContain(text('smart.sol.whaleUnavailable')));
  });

  it('a feed with no transfers prints no dollar figures', async () => {
    serve({ whales: whalePayload({ available: false, solPrice: null, transfers: [], reason: 'NO_MOVEMENTS_IN_SAMPLE' }) });
    renderPanel();
    fireEvent.click(screen.getByText(text('smart.sol.tabWhales')));
    const body = await screen.findByTestId('sol-track-whales');
    await waitFor(() => expect(body.textContent).toContain(text('smart.sol.whaleEmpty')));
    expect(body.textContent).not.toContain('$');
  });
});

describe('Solana tracking panel — refresh', () => {
  it('bypasses the client cache and asks again', async () => {
    const calls = serve();
    renderPanel();
    fireEvent.change(screen.getByTestId('sol-track-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('sol-track-go'));
    await waitFor(() => expect(screen.getByTestId('sol-track-wallet').textContent).toContain('1,250.00'));

    const before = calls.filter((c) => c.includes('/track/wallet')).length;
    await act(async () => { fireEvent.click(screen.getByTestId('sol-track-refresh')); });
    await waitFor(() => expect(calls.filter((c) => c.includes('/track/wallet')).length).toBeGreaterThan(before));
  });
});
