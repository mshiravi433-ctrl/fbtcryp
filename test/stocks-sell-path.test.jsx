// @vitest-environment jsdom
/*
 * THE WAY OUT OF A TOKENIZED SHARE.
 *
 * Reported (in substance): the Stocks page could buy AAPLx but nothing in
 * the app showed what had been bought, where it was, or how to sell it. The
 * wallet's holdings list was display-only and the swap screen expected the
 * user to find the token in a picker and put it in the FROM box by hand.
 *
 * This suite pins the whole path, end to end:
 *
 *   1. lib/solanaSell.js builds ONE link shape for every Sell button, refuses
 *      symbols, and joins wallet holdings to the curated lists by mint —
 *      membership from the curated list (so a price outage cannot turn a
 *      real holding into «you own nothing»), price from the page's list.
 *   2. EquityRow shows the held amount and a Sell only when there is
 *      something to sell, and never lets the buy-size gate hide the exit.
 *   3. EquityHoldings («سهام من») has three honest states — no wallet,
 *      read failed, read ok — and a failed read never renders as empty.
 *   4. The wallet's holdings rows carry a «فروش» (or «تبدیل» for SOL and
 *      the stables) that opens the swap by hash, since that screen mounts
 *      without a Router in its own tests.
 *   5. The swap screen actually honours ?fromMint=&toMint= — the effect that
 *      makes every button above work had no live producer before this and
 *      could have been deleted as dead code.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';

const state = vi.hoisted(() => ({
  portfolio: vi.fn(),
  solAddress: null
}));

/* Real Persian strings, no i18next runtime: a raw key would fail the assertions. */
const t = (key, values = {}) => {
  const found = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), fa);
  let text = typeof found === 'string' ? found : undefined;
  if (text == null && typeof values === 'string') text = values;
  if (text == null) text = key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) =>
    (values && typeof values === 'object' ? (values[k] ?? '') : ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'fa', resolvedLanguage: 'fa' } })
}));
vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(
              Object.entries(props).filter(([k]) => ![
                'initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'
              ].includes(k))
            );
            return <Tag {...clean}>{children}</Tag>;
          });
        }
        return components.get(tag);
      }
    }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => true
  };
});
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/lib/tokenIcon', () => ({ default: ({ token }) => <i data-icon={token?.symbol} /> }));
vi.mock('../src/lib/solana/portfolio', () => ({ readSolanaPortfolio: state.portfolio }));
vi.mock('../src/lib/solana/portfolio.js', () => ({ readSolanaPortfolio: state.portfolio }));
/* The swap screen: no wallet, no chain, no quotes — only the URL contract is under test. */
vi.mock('../src/lib/solanaWallet', async (importOriginal) => ({
  ...await importOriginal(),
  solanaAddress: () => state.solAddress,
  signAndSendSolana: vi.fn(),
  signSolanaTransaction: vi.fn(),
  getSolanaSwapBalances: vi.fn(async () => ({ ok: false })),
  getSolanaTokenInfo: vi.fn(async () => null),
  solanaWalletName: () => null,
  solanaWalletAvailable: () => false,
  canInjectSolana: () => false,
  canUseMwa: () => false,
  getSolanaProvider: () => null
}));
vi.mock('../src/lib/solanaRpc.js', () => ({
  getSolanaRpcUrl: async () => 'https://127.0.0.1:9',
  probeSolanaRpc: async () => ({ ok: false, reason: 'UNREACHABLE' }),
  readSolanaNetworkSettings: () => ({ network: 'mainnet', rpcUrl: '' }),
  solanaRpcCall: async () => ({ ok: false, reason: 'UNREACHABLE' }),
  solanaRpcCandidates: () => []
}));
vi.mock('../src/lib/solana/deeplink.js', async (importOriginal) => ({
  ...await importOriginal(),
  warmDeeplinkRequest: () => {}
}));
vi.mock('../src/store/useAppStore', () => ({
  useAppStore: Object.assign((fn) => fn({ awardPoints: () => {} }), { getState: () => ({ awardPoints: () => {} }) })
}));
vi.mock('../src/store/useSettingsStore', () => ({
  useSettingsStore: Object.assign((fn) => fn({ hideBalances: false, solanaNetwork: 'mainnet' }), {
    getState: () => ({ hideBalances: false, solanaNetwork: 'mainnet' })
  })
}));

import { SOL_MINT, USDC_MINT, USDT_MINT } from '../src/lib/solana.js';
import { EQUITY_ASSETS, COMMODITY_ASSETS } from '../src/lib/solanaAssets.js';
import { holdingsTotalUsd, joinEquityHoldings, solanaExitKind, solanaSellUrl } from '../src/lib/solanaSell.js';
import EquityRow from '../src/components/EquityRow.jsx';
import EquityHoldings, { useSolanaEquityHoldings } from '../src/components/EquityHoldings.jsx';
import SolanaWalletHome from '../src/components/SolanaWalletHome.jsx';

const AAPL = EQUITY_ASSETS.find((a) => a.symbol === 'AAPLx');
const NVDA = EQUITY_ASSETS.find((a) => a.symbol === 'NVDAx');
const PAXG = COMMODITY_ASSETS.find((a) => a.symbol === 'PAXG');
const OWNER = '9Z4wtiosH7JMXhKg8JpUPDCtB5ZyM8vzby14HwDidgVz';
const MEME = 'GQfQ2avnmJBMttz2D5nyDkQAY9rWLHGvDVq8BMRpxWh4';

const pricedAapl = { ...AAPL, usdPrice: 200, change24h: 1.2, liquidity: 80_000 };
const pricedNvda = { ...NVDA, usdPrice: 120, change24h: -0.4, liquidity: 2_000_000 };

beforeEach(() => {
  state.portfolio.mockReset();
  state.solAddress = null;
  window.location.hash = '';
});
afterEach(() => cleanup());

/* ------------------------------------------------------------------------ */
describe('lib/solanaSell — one link shape, by mint', () => {
  it('sells an asset into USDC and USDC into SOL', () => {
    expect(solanaSellUrl(AAPL.mint)).toBe(`/solana?fromMint=${AAPL.mint}&toMint=${USDC_MINT}`);
    expect(solanaSellUrl(PAXG.mint)).toBe(`/solana?fromMint=${PAXG.mint}&toMint=${USDC_MINT}`);
    expect(solanaSellUrl(USDC_MINT)).toBe(`/solana?fromMint=${USDC_MINT}&toMint=${SOL_MINT}`);
  });
  it('refuses symbols and garbage — the swap screen resolves mints only', () => {
    expect(solanaSellUrl('AAPLx')).toBeNull();
    expect(solanaSellUrl('SOL')).toBeNull();
    expect(solanaSellUrl(null)).toBeNull();
    expect(solanaSellUrl('')).toBeNull();
  });
  it('labels SOL and the stables as a swap, everything else as a sell', () => {
    expect(solanaExitKind(SOL_MINT)).toBe('swap');
    expect(solanaExitKind(USDC_MINT)).toBe('swap');
    expect(solanaExitKind(USDT_MINT)).toBe('swap');
    expect(solanaExitKind(AAPL.mint)).toBe('sell');
    expect(solanaExitKind(MEME)).toBe('sell');
  });
  it('joins holdings to the curated lists by mint, prices from the page, values sorted', () => {
    const rows = joinEquityHoldings(
      [
        { mint: SOL_MINT, amount: '1.5', native: true },
        { mint: AAPL.mint, amount: '0.5' },
        { mint: NVDA.mint, amount: '3' },
        { mint: MEME, amount: '999999' },
        { mint: PAXG.mint, amount: '0' }
      ],
      [pricedAapl, pricedNvda]
    );
    expect(rows.map((r) => r.symbol)).toEqual(['NVDAx', 'AAPLx']);
    expect(rows[0].usdValue).toBe(360);
    expect(rows[1].usdValue).toBe(100);
    expect(holdingsTotalUsd(rows)).toBe(460);
  });
  it('keeps a real holding when the price feed is down — never «you own nothing»', () => {
    const rows = joinEquityHoldings([{ mint: AAPL.mint, amount: '0.5' }], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('AAPLx');
    expect(rows[0].usdValue).toBeNull();
    expect(rows[0].listed).toBe(false);
    /* and a total that would be too small is withheld, not shown */
    expect(holdingsTotalUsd(rows)).toBeNull();
  });
  it('tolerates a null read', () => {
    expect(joinEquityHoldings(null, [pricedAapl])).toEqual([]);
    expect(holdingsTotalUsd([])).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
describe('EquityRow — the held line and the Sell button', () => {
  it('shows nothing about holdings when there is no holding', () => {
    render(<EquityRow asset={pricedAapl} amountUsd={100} onBuy={() => {}} onSell={() => {}} />);
    expect(screen.queryByTestId('eq-held')).toBeNull();
    expect(screen.queryByTestId('eq-sell')).toBeNull();
    expect(screen.getByRole('button', { name: new RegExp(t('stocks.buyWith', { sym: 'AAPLx' })) })).toBeTruthy();
  });
  it('shows the amount held, its value, and a Sell that hands back the asset', () => {
    const onSell = vi.fn();
    render(
      <EquityRow
        asset={pricedAapl}
        amountUsd={100}
        onBuy={() => {}}
        onSell={onSell}
        holding={{ amount: 0.5, amountText: '0.5', usdValue: 100 }}
      />
    );
    const held = screen.getByTestId('eq-held');
    expect(held.textContent).toContain(fa.stocks.held.inWallet);
    expect(held.textContent).toContain('0.5');
    expect(held.textContent).toContain('AAPLx');
    expect(held.textContent).toContain('100');
    fireEvent.click(screen.getByTestId('eq-sell'));
    expect(onSell).toHaveBeenCalledWith(pricedAapl);
  });
  it('a zero or malformed holding is treated as none', () => {
    render(<EquityRow asset={pricedAapl} amountUsd={100} onBuy={() => {}} onSell={() => {}} holding={{ amount: 0 }} />);
    expect(screen.queryByTestId('eq-sell')).toBeNull();
  });
  it('the buy-size gate disables Buy but never hides Sell', () => {
    /* $5,000 against an $80k book is refused for BUY (6.25% of the pool). */
    render(
      <EquityRow
        asset={pricedAapl}
        amountUsd={5000}
        onBuy={() => {}}
        onSell={() => {}}
        holding={{ amount: 2, amountText: '2', usdValue: 400 }}
      />
    );
    const buy = screen.getByRole('button', { name: new RegExp(t('stocks.buyWith', { sym: 'AAPLx' })) });
    expect(buy.disabled).toBe(true);
    expect(screen.getByTestId('eq-sell').disabled).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
function Harness({ address, priced, onSell = () => {}, onOpenWallet = () => {} }) {
  const held = useSolanaEquityHoldings(address, priced);
  return <EquityHoldings address={address} held={held} onSell={onSell} onOpenWallet={onOpenWallet} />;
}

describe('EquityHoldings («سهام من») — three honest states', () => {
  it('without a wallet: says where purchases go and offers to connect', () => {
    const onOpenWallet = vi.fn();
    render(<Harness address={null} priced={[pricedAapl]} onOpenWallet={onOpenWallet} />);
    const card = screen.getByTestId('equity-holdings');
    expect(card.getAttribute('data-state')).toBe('disconnected');
    expect(card.textContent).toContain(fa.stocks.held.connectBody);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fa.stocks.held.connectCta) }));
    expect(onOpenWallet).toHaveBeenCalled();
    expect(state.portfolio).not.toHaveBeenCalled();
  });

  it('a failed read says so and NEVER renders as an empty list', async () => {
    state.portfolio.mockResolvedValue({ ok: false, code: 'RPC_RATE_LIMITED', holdings: [] });
    render(<Harness address={OWNER} priced={[pricedAapl]} />);
    await waitFor(() => expect(screen.getByTestId('equity-holdings').getAttribute('data-state')).toBe('error'));
    const text = screen.getByTestId('equity-holdings').textContent;
    expect(text).toContain(fa.stocks.held.readFailed);
    expect(text).toContain(fa.solana.err.RPC_RATE_LIMITED);
    expect(text).not.toContain(fa.stocks.held.none);
    expect(screen.queryByTestId('eqh-sell')).toBeNull();
    /* retry re-reads */
    state.portfolio.mockResolvedValue({ ok: true, holdings: [] });
    fireEvent.click(screen.getByRole('button', { name: fa.common.retry }));
    await waitFor(() => expect(screen.getByTestId('equity-holdings').getAttribute('data-state')).toBe('ok'));
    expect(screen.getByTestId('equity-holdings').textContent).toContain(fa.stocks.held.none);
  });

  it('a successful read lists the curated holdings with a Sell each and the total', async () => {
    const onSell = vi.fn();
    state.portfolio.mockResolvedValue({
      ok: true,
      partial: false,
      holdings: [
        { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', native: true, decimals: 9, raw: '1500000000', amount: '1.5' },
        { mint: AAPL.mint, symbol: 'AAPLx', name: 'Apple xStock', decimals: 8, raw: '50000000', amount: '0.5' },
        { mint: NVDA.mint, symbol: 'NVDAx', name: 'NVIDIA xStock', decimals: 8, raw: '300000000', amount: '3' },
        { mint: MEME, symbol: 'GQfQ…xWh4', name: '', decimals: 6, raw: '1', amount: '0.000001' }
      ]
    });
    render(<Harness address={OWNER} priced={[pricedAapl, pricedNvda]} onSell={onSell} />);
    await waitFor(() => expect(screen.getAllByTestId('eqh-sell')).toHaveLength(2));
    const card = screen.getByTestId('equity-holdings');
    /* SOL and the memecoin belong to the wallet screen, not to «سهام من» */
    expect(card.textContent).not.toContain('Solana');
    expect(card.textContent).not.toContain('GQfQ');
    expect(card.textContent).toContain(fa.stocks.held.total);
    expect(card.textContent).toContain('460');
    expect(card.textContent).toContain(fa.stocks.held.trust);
    /* sorted by value: NVDAx ($360) before AAPLx ($100) */
    const sells = screen.getAllByTestId('eqh-sell');
    expect(sells[0].getAttribute('aria-label')).toContain('NVDAx');
    fireEvent.click(sells[1]);
    expect(onSell).toHaveBeenCalledTimes(1);
    expect(onSell.mock.calls[0][0].mint).toBe(AAPL.mint);
  });

  it('a holding the page has no price for still gets its row, without a made-up value', async () => {
    state.portfolio.mockResolvedValue({
      ok: true,
      holdings: [{ mint: AAPL.mint, symbol: 'AAPLx', name: 'Apple xStock', decimals: 8, raw: '50000000', amount: '0.5' }]
    });
    render(<Harness address={OWNER} priced={[]} />);
    await waitFor(() => expect(screen.getAllByTestId('eqh-sell')).toHaveLength(1));
    const card = screen.getByTestId('equity-holdings');
    expect(card.textContent).toContain(fa.stocks.held.noPrice);
    expect(card.textContent).not.toContain('$0');
  });
});

/* ------------------------------------------------------------------------ */
describe('SolanaWalletHome — a way out on every holding', () => {
  it('renders «فروش» on assets and «تبدیل» on SOL/USDC, and opens the swap by hash', async () => {
    state.portfolio.mockResolvedValue({
      ok: true,
      partial: false,
      holdings: [
        { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', native: true, decimals: 9, raw: '1500000000', amount: '1.5' },
        { mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6, raw: '5000000', amount: '5' },
        { mint: AAPL.mint, symbol: 'AAPLx', name: 'Apple xStock', decimals: 8, raw: '50000000', amount: '0.5' },
        /* an unread native row must NOT get a button — there is no amount to sell */
        { mint: MEME, symbol: 'GQfQ…xWh4', name: '', native: false, amount: null, unread: true }
      ]
    });
    render(
      <SolanaWalletHome
        address={OWNER}
        walletName="Phantom"
        balance="1.5"
        balanceLoading={false}
        balanceFailed={false}
        onConnect={() => {}}
        onDisconnect={() => {}}
      />
    );
    await waitFor(() => expect(screen.getAllByTestId('sol-wal-exit')).toHaveLength(3));
    const exits = screen.getAllByTestId('sol-wal-exit');
    expect(exits.map((b) => b.getAttribute('data-exit'))).toEqual(['swap', 'swap', 'sell']);
    expect(exits[0].textContent).toBe(fa.solana.wallet.swap);
    expect(exits[2].textContent).toBe(fa.trade.sell);
    await act(async () => { fireEvent.click(exits[2]); });
    expect(window.location.hash).toBe(`#/solana?fromMint=${AAPL.mint}&toMint=${USDC_MINT}`);
    await act(async () => { fireEvent.click(exits[1]); });
    expect(window.location.hash).toBe(`#/solana?fromMint=${USDC_MINT}&toMint=${SOL_MINT}`);
  });
});

/* ------------------------------------------------------------------------ */
describe('SolanaSwap — the ?fromMint=&toMint= handoff every Sell button relies on', () => {
  it('pre-fills FROM with the held token and TO with USDC', async () => {
    const { default: SolanaSwap } = await import('../src/pages/SolanaSwap.jsx');
    render(
      <MemoryRouter initialEntries={[solanaSellUrl(AAPL.mint)]}>
        <SolanaSwap />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId('solana-token-from').textContent).toContain('AAPLx');
      expect(screen.getByTestId('solana-token-to').textContent).toContain('USDC');
    });
  });
  it('a gold Buy (?to=<PAXG mint>) lands on USDC → PAXG, not USDC → USDC', async () => {
    const { default: SolanaSwap } = await import('../src/pages/SolanaSwap.jsx');
    render(
      <MemoryRouter initialEntries={[`/solana?to=${PAXG.mint}`]}>
        <SolanaSwap />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId('solana-token-from').textContent).toContain('USDC');
      expect(screen.getByTestId('solana-token-to').textContent).toContain('PAXG');
    });
  });
});
