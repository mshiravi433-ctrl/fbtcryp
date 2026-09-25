// @vitest-environment jsdom
/**
 * «تخصیص دارایی» MUST NOT LIE ABOUT THE WALLET'S CONNECTION.
 * ---------------------------------------------------------------------------
 * Reported: «در صفحه هوش در کیف پول، در گزینه تخصیص دارایی با اینکه کیف پول
 * وصله میگه کیف پول را وصل کنید — انگار کار نمیده».
 *
 * Two real defects produced that screen:
 *
 *   1. The wallet's «هوش» sheet mounted Portfolio with its OWN sixteen-chain
 *      read; while that read was in flight the allocation table was empty,
 *      and its empty state was the CONNECT-A-WALLET sentence — over a
 *      connected wallet. The Wallet page now hands its verified `portfolio`
 *      and `intel` down, and this suite pins that an embedded dashboard with
 *      shared data paints rows immediately and never prints the connect
 *      sentence.
 *
 *   2. buildIntelligence silently dropped holdings without a price (value
 *      null), so a wallet whose prices had not ticked yet looked EMPTY. A
 *      real holding is a row now — with an honest dash, not a fake zero and
 *      not an accusation.
 *
 * The three empties are now distinguishable — not connected / still reading /
 * genuinely nothing — and each says its own reason.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(Object.entries(props).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
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

const walletState = { address: null, chainId: 56, locked: false, getReadProvider: () => null };
vi.mock('../src/context/WalletContext', () => ({ useWallet: () => walletState }));
vi.mock('../src/hooks/useHideBalances', () => ({ useHideBalances: () => {} }));

/* The two fetch hooks must never fire here: every case below is about what
   the dashboard does with data it is GIVEN (or deliberately not given). */
const sources = { single: { rows: [], total: 0, loading: false, error: null, partial: false }, multi: { rows: [], totalValue: 0, chains: [], loading: false, pricing: false, loaded: true, partial: false, refresh: () => {} } };
vi.mock('../src/hooks/useWalletBalances', () => ({ useWalletBalances: () => sources.single }));
vi.mock('../src/hooks/useMultiChainPortfolio', () => ({ useMultiChainPortfolio: () => sources.multi }));

import Portfolio from '../src/pages/Portfolio';
import { buildIntelligence } from '../src/lib/portfolioIntel';

const EVM = '0x66c14A85E3f0ab12508F5289A3041BEdE1EaE1DE';

const pricedRows = [
  { key: '56:BNB', symbol: 'BNB', name: 'BNB', address: null, native: true, decimals: 18, coingeckoId: 'binancecoin', amount: 2, chainId: 56, price: 600, value: 1200 },
  { key: '56:USDT', symbol: 'USDT', name: 'Tether', address: '0xusdt', native: false, decimals: 18, coingeckoId: 'tether', amount: 500, chainId: 56, price: 1, value: 500 }
];

const unpricedRows = [
  { key: '56:ZZZ', symbol: 'ZZZ', name: 'Mystery Coin', address: '0xzzz', native: false, decimals: 18, coingeckoId: null, amount: 42, chainId: 56, price: null, value: null }
];

function sourceWith(rows, flags = {}) {
  return {
    rows,
    totalValue: rows.reduce((s, r) => s + (r.value ?? 0), 0),
    chains: [],
    loading: false,
    pricing: false,
    loaded: true,
    partial: false,
    refresh: () => {},
    ...flags
  };
}

function expandAllocation() {
  const btn = screen.getByText(en.intel.allocation).closest('button');
  fireEvent.click(btn);
}

beforeEach(() => {
  walletState.address = EVM;
  walletState.chainId = 56;
  walletState.locked = false;
  sources.single = { rows: [], total: 0, loading: false, error: null, partial: false };
  sources.multi = { rows: [], totalValue: 0, chains: [], loading: false, pricing: false, loaded: true, partial: false, refresh: () => {} };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener: () => {}, removeListener: () => {} }));
});
afterEach(() => cleanup());

describe('the wallet Intelligence sheet’s asset allocation', () => {
  it('paints shared holdings instantly and never says “connect a wallet” while connected', () => {
    const portfolio = sourceWith(pricedRows);
    const intel = buildIntelligence({
      holdings: pricedRows.map(({ symbol, name, value, amount, chainId, native }) => ({ symbol, name, value, amount, chainId, native })),
      lots: []
    });
    render(<Portfolio embedded portfolio={portfolio} intel={intel} />);
    expandAllocation();
    expect(screen.getByText('BNB')).toBeTruthy();
    expect(screen.getByText('USDT')).toBeTruthy();
    expect(document.body.textContent).not.toContain(en.intel.empty);
    expect(document.body.querySelector('[data-testid="alloc-empty"]')).toBeNull();
  });

  it('keeps unpriced-but-real holdings in the list with a dash — never drops them', () => {
    /* The old buildIntelligence filter (`Number(h.value) > 0`) dropped ZZZ
       here and the panel fell through to its connect-a-wallet empty state.
       A holding with a positive AMOUNT is a row; its value/weight are honest
       dashes until the price feed covers it. */
    const portfolio = sourceWith(unpricedRows);
    render(<Portfolio embedded portfolio={portfolio} />);
    expandAllocation();
    expect(screen.getByText('ZZZ')).toBeTruthy();
    expect(document.body.textContent).not.toContain(en.intel.empty);
    expect(document.body.textContent).not.toContain(en.intel.noAssets);
    // Weight and value render as dashes, not 0.0% / $0.
    expect(document.body.textContent).toContain('—');
  });

  it('names “not connected” as its own empty reason', () => {
    walletState.address = null;
    render(<Portfolio embedded portfolio={sourceWith([])} />);
    expandAllocation();
    const empty = document.body.querySelector('[data-testid="alloc-empty"]');
    expect(empty).toBeTruthy();
    expect(empty.getAttribute('data-reason')).toBe('not-connected');
    expect(empty.textContent).toContain(en.intel.empty);
  });

  it('names “still reading” while the first read is in flight', () => {
    render(<Portfolio embedded portfolio={sourceWith([], { loading: true, loaded: false })} />);
    expandAllocation();
    const empty = document.body.querySelector('[data-testid="alloc-empty"]');
    expect(empty.getAttribute('data-reason')).toBe('loading');
    expect(empty.textContent).toContain(en.intel.loadingHoldings);
    expect(empty.textContent).not.toContain(en.intel.empty);
  });

  it('names “nothing there” once the read has finished with no holdings', () => {
    render(<Portfolio embedded portfolio={sourceWith([], { loading: false, loaded: true })} />);
    expandAllocation();
    const empty = document.body.querySelector('[data-testid="alloc-empty"]');
    expect(empty.getAttribute('data-reason')).toBe('no-assets');
    expect(empty.textContent).toContain(en.intel.noAssets);
    expect(empty.textContent).not.toContain(en.intel.empty);
  });
});
