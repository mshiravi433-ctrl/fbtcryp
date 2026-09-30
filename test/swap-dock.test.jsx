// @vitest-environment jsdom
/**
 * THE STICKY SWAP DOCK — «مثل یونی سواپ».
 * ---------------------------------------------------------------------------
 * The dock only earns its place if three things are true at once, and each
 * one is a different failure mode:
 *
 *   1. it appears when the in-page trade buttons have scrolled away, and not
 *      before — a dock under the hero on the first frame is the same button
 *      twice, one of them covering the chart;
 *   2. it TAKES the nav's place rather than stacking under it, because two
 *      fixed blurred bars at the bottom of a phone is a layout accident;
 *   3. it renders NOTHING for a coin with no real venue. A dock over every
 *      token that leads to a swap screen which then refuses the route
 *      converts a clear dead end into a misleading button.
 *
 * Plus the thing that makes it free: the venue the market list already
 * resolved must be reused, not re-fetched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tFor('fa'), i18n: { language: 'fa', changeLanguage: () => {} } }) }));

const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION_STUBS.has(T)) {
        MOTION_STUBS.set(T, ({ children, ...p }) => {
          const clean = Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
          return <T {...clean}>{children}</T>;
        });
      }
      return MOTION_STUBS.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

import SwapDock from '../src/components/SwapDock.jsx';
import { useSwapDockStore } from '../src/store/useSwapDockStore.js';
import { rememberCoinVenues, _clearVenueBatchCache } from '../src/lib/coinVenues.js';

const coin = (over = {}) => ({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 60123, change24h: 2.4, ...over });

/** jsdom has no layout, so the page metrics the dock reads are ours to set. */
function setPage({ scrollY, scrollHeight, innerHeight }) {
  window.scrollY = scrollY;
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true, writable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: scrollHeight, configurable: true, writable: true });
  const scroll = () => window.dispatchEvent(new Event('scroll'));
  return scroll;
}

const Probe = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
};

const mount = (token) => render(
  <MemoryRouter initialEntries={['/coin/bitcoin']}>
    <Probe />
    <SwapDock coin={token} />
  </MemoryRouter>
);

beforeEach(() => {
  useSwapDockStore.getState().reset();
  _clearVenueBatchCache();
});

afterEach(() => cleanup());

describe('the sticky swap dock', () => {
  it('is absent at the top of the page, where the in-page buttons already are', () => {
    const scroll = setPage({ scrollY: 0, scrollHeight: 5000, innerHeight: 800 });
    mount(coin());
    scroll();
    expect(screen.queryByTestId('swap-dock')).toBeNull();
    expect(useSwapDockStore.getState().active).toBe(false);
  });

  it('appears once the page has scrolled past them, and takes the nav\'s place', async () => {
    const scroll = setPage({ scrollY: 0, scrollHeight: 5000, innerHeight: 800 });
    mount(coin());
    scroll();
    expect(screen.queryByTestId('swap-dock')).toBeNull();

    window.scrollY = 1200;
    scroll();
    await waitFor(() => expect(screen.getByTestId('swap-dock')).toBeTruthy());
    /* the fact the shell renders from — this is how the bottom nav fades */
    await waitFor(() => expect(useSwapDockStore.getState().active).toBe(true));

    /* and it names the action and the token, not just "swap" */
    const btn = screen.getByTestId('swap-dock-buy');
    expect(btn.textContent).toContain('خرید');
    expect(btn.textContent).toContain('BTC');
    /* the live price rides along, so the dock is also information */
    expect(screen.getByTestId('swap-dock').textContent).toContain('$60,123');

    /* and it leads somewhere real */
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/swap?chain=56'));
  });

  it('yields the edge again at the very bottom, where the page footer is read', async () => {
    const scroll = setPage({ scrollY: 0, scrollHeight: 5000, innerHeight: 800 });
    mount(coin());
    window.scrollY = 1200;
    scroll();
    await waitFor(() => expect(screen.getByTestId('swap-dock')).toBeTruthy());

    window.scrollY = 4200; /* max = 5000 - 800 */
    scroll();
    await waitFor(() => expect(screen.queryByTestId('swap-dock')).toBeNull());
    expect(useSwapDockStore.getState().active).toBe(false);
  });

  it('releases the edge when it unmounts, so the nav never stays hidden', async () => {
    const scroll = setPage({ scrollY: 0, scrollHeight: 5000, innerHeight: 800 });
    const { unmount } = mount(coin());
    window.scrollY = 1200;
    scroll();
    await waitFor(() => expect(useSwapDockStore.getState().active).toBe(true));
    unmount();
    expect(useSwapDockStore.getState().active).toBe(false);
    expect(useSwapDockStore.getState().count).toBe(0);
  });

  it('renders NOTHING for a coin with no real venue — no misleading button', () => {
    const scroll = setPage({ scrollY: 0, scrollHeight: 5000, innerHeight: 800 });
    /* a Cardano asset: no curated contract, no venue on any chain we trade */
    mount(coin({ id: 'cardano', symbol: 'ADA' }));
    window.scrollY = 2000;
    scroll();
    expect(screen.queryByTestId('swap-dock')).toBeNull();
    expect(useSwapDockStore.getState().active).toBe(false);
  });

  it('uses the venue the market list already resolved, with no request', async () => {
    /* This is what makes the dock free to show on EVERY coin. The list asked
       for the whole page in one call; the dock must not re-ask per coin. */
    const fetches = [];
    globalThis.fetch = vi.fn(async (u) => { fetches.push(String(u)); return { ok: false, json: async () => ({}) }; });
    rememberCoinVenues('pudgy-penguins', { chains: {}, solana: '2zMMhcSRxJb2xNvpdPCmRRQNb8HaT9czZzfnYa1cpnKm', tradeable: true });

    const scroll = setPage({ scrollY: 0, scrollHeight: 5000, innerHeight: 800 });
    mount(coin({ id: 'pudgy-penguins', symbol: 'PENGU', name: 'Pudgy Penguins' }));
    window.scrollY = 1200;
    scroll();
    await waitFor(() => expect(screen.getByTestId('swap-dock')).toBeTruthy());
    expect(fetches.length).toBe(0);

    fireEvent.click(screen.getByTestId('swap-dock-buy'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/solana?toMint='));
  });
});
