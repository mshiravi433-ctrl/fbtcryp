// @vitest-environment jsdom
/**
 * THE IN-APP NOTIFICATION BAR — the only surface whose pixels we own
 * ---------------------------------------------------------------------------
 * The OS shade is drawn by Android and iOS: a payload can colour it, give it
 * artwork and pin it, but it cannot decide the layout. The bar inside the app is
 * the one place the reference design is reproduced exactly (mark, tone colour,
 * the big number, the rail), so it is also the one place where a regression is
 * both possible and invisible to every other test in this repo.
 *
 * What is asserted here, and why each one is a real failure mode:
 *
 *   · an empty store paints NOTHING — a stray fixed overlay at z-index 9000 with
 *     no card in it swallows taps on the top of every screen;
 *   · a card carries the TONE's colour from the design system, not a hardcoded
 *     one — the whole point of the colour language is that a loss is crimson in
 *     the app, in the shade and on the lock screen;
 *   · the progress rail is a real `progressbar` with the value, so a screen
 *     reader says «۳ از ۴» instead of nothing;
 *   · dismissing removes the card, and tapping it deep-links and clears it;
 *   · the Settings preview renders the SAME card (it is the same component) and
 *     has no close button, because there is nothing to dismiss.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TONES } from '../src/lib/notificationDesign.js';
import { useAppStore } from '../src/store/useAppStore';

const navigate = vi.fn();

/*
 * `routerState.inRouter` lets one suite cover BOTH trees: the real app mounts
 * the bar inside <HashRouter>, and a future refactor that forgets that must
 * degrade to a hash navigation instead of throwing `useNavigate() may be used
 * only in the context of a <Router>` — the exception that once blanked every
 * route of the site with «خطای غیرمنتظره».
 */
const { routerState } = vi.hoisted(() => ({ routerState: { inRouter: true } }));

vi.mock('react-router-dom', () => ({
  useInRouterContext: () => routerState.inRouter,
  useNavigate: () => navigate
}));

/*
 * framer-motion is mocked the way the other UI suites mock it: `motion.div`
 * becomes a plain div with the animation-only props stripped, so the assertions
 * are about our markup and our classes rather than about a spring.
 */
vi.mock('framer-motion', async () => {
  const ReactModule = await import('react');
  const strip = ReactModule.forwardRef(({ children, initial, animate, exit, transition, layout,
    drag, dragConstraints, dragElastic, onDragStart, onDragEnd, ...rest }, ref) =>
    ReactModule.createElement('div', { ref, ...rest }, children));
  return {
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => false,
    motion: new Proxy({}, { get: () => strip })
  };
});

const { default: NotificationBar, NotificationPreview } = await import('../src/components/NotificationBar');

const reset = () => useAppStore.setState({ notifBar: [] });

beforeEach(() => {
  reset();
  navigate.mockReset();
  routerState.inRouter = true;
  document.documentElement.lang = 'fa';
  window.history.replaceState(null, '', '#/');
});

afterEach(cleanup);

describe('notification bar', () => {
  it('paints nothing when there is no notification', () => {
    const { container } = render(<NotificationBar />);
    expect(container.querySelectorAll('.nbar__card')).toHaveLength(0);
  });

  it('draws a card with the tone colour, the number and the rail', () => {
    useAppStore.getState().showNotifBar({
      title: 'به هدف رسید — آمادهٔ سواپ',
      body: '۱ BTC به ۶۵٬۲۴۰ USDT رسید.',
      tone: 'profit',
      value: '+12.4%',
      label: 'BTC > USDT',
      kicker: 'PROFIT',
      progress: 68,
      link: '/orders'
    });
    const { container } = render(<NotificationBar />);

    expect(container.querySelector('.nbar__card--profit')).toBeTruthy();
    expect(screen.getByText('+12.4%')).toBeTruthy();
    expect(screen.getByText('BTC > USDT')).toBeTruthy();
    expect(screen.getByText('PROFIT')).toBeTruthy();

    /* The palette is the source of truth: the card's accent must be the design
       system's profit colour, and the card must expose it to CSS. */
    const card = container.querySelector('.nbar__card');
    expect(card.style.getPropertyValue('--tone-accent').trim().toLowerCase())
      .toBe(TONES.profit.accent.toLowerCase());

    const rail = screen.getByRole('progressbar');
    expect(rail.getAttribute('aria-valuenow')).toBe('68');
  });

  it('paints a loss in the loss colour, never the profit one', () => {
    useAppStore.getState().showNotifBar({ title: 'حد ضرر فعال شد', tone: 'loss', value: '-3.75%' });
    const { container } = render(<NotificationBar />);
    const card = container.querySelector('.nbar__card--loss');
    expect(card).toBeTruthy();
    expect(card.style.getPropertyValue('--tone-accent').trim().toLowerCase())
      .toBe(TONES.loss.accent.toLowerCase());
    expect(TONES.loss.accent).not.toBe(TONES.profit.accent);
  });

  it('dismisses when the close button is pressed', () => {
    useAppStore.getState().showNotifBar({ title: 'در انتظار', tone: 'pending' });
    const { container } = render(<NotificationBar />);
    const close = container.querySelector('.nbar__close');
    expect(close).toBeTruthy();
    fireEvent.click(close);
    expect(useAppStore.getState().notifBar).toHaveLength(0);
  });

  it('deep-links and clears the card when tapped', () => {
    useAppStore.getState().showNotifBar({ title: 'آمادهٔ سواپ', tone: 'ready', link: '/orders?execute=abc' });
    const { container } = render(<NotificationBar />);
    fireEvent.click(container.querySelector('.nbar__card'));
    expect(navigate).toHaveBeenCalledWith('/orders?execute=abc');
    expect(useAppStore.getState().notifBar).toHaveLength(0);
  });

  it('survives being mounted with no Router above it, and still deep-links', () => {
    /*
     * THE REGRESSION THAT TOOK THE SITE DOWN. The bar shipped mounted outside
     * <HashRouter>; `useNavigate()` threw on every route and `BootBoundary`
     * answered with «خطای غیرمنتظره» — the app never came up. Two behaviours
     * are asserted here: rendering without a router does not throw, and the
     * card still opens its page (via the hash the HashRouter listens to).
     */
    routerState.inRouter = false;
    useAppStore.getState().showNotifBar({ title: 'آمادهٔ سواپ', tone: 'ready', link: '/orders?execute=abc' });
    const { container } = render(<NotificationBar />);
    const card = container.querySelector('.nbar__card');
    expect(card).toBeTruthy();
    fireEvent.click(card);
    expect(window.location.hash).toBe('#/orders?execute=abc');
    expect(useAppStore.getState().notifBar).toHaveLength(0);
  });

  it('refuses a deep link that is not an in-app path', () => {
    routerState.inRouter = false;
    useAppStore.getState().showNotifBar({ title: 'x', tone: 'info', link: 'https://evil.example' });
    const { container } = render(<NotificationBar />);
    fireEvent.click(container.querySelector('.nbar__card'));
    expect(window.location.hash).toBe('#/');
  });

  it('never stacks more than three cards over the screen', () => {
    for (let i = 0; i < 6; i += 1) {
      useAppStore.getState().showNotifBar({ title: `n${i}`, tone: 'info' });
    }
    expect(useAppStore.getState().notifBar).toHaveLength(3);
    const { container } = render(<NotificationBar />);
    expect(container.querySelectorAll('.nbar__card')).toHaveLength(3);
  });

  it('keeps the bar out of the persisted state', () => {
    useAppStore.getState().showNotifBar({ title: 'x', tone: 'info' });
    /* zustand's persist writes through localStorage; the partialize filter must
       drop `notifBar` so a reload does not replay dismissed alerts. */
    const raw = window.localStorage.getItem('fbt-swap-v1') || '{}';
    expect(raw.includes('notifBar')).toBe(false);
  });
});

describe('settings preview', () => {
  it('renders the real card for a tone, with no dismiss affordance', () => {
    const { container } = render(<NotificationPreview tone="loss" lang="fa" />);
    const card = container.querySelector('.nbar__card--loss');
    expect(card).toBeTruthy();
    expect(container.querySelector('.nbar__close')).toBeNull();
    /* A preview is not a live notification: it must not enter the store, or
       opening Settings twice would fill the bell with fake history. */
    expect(useAppStore.getState().notifBar).toHaveLength(0);
  });

  it('previews an English card for an English UI', () => {
    render(<NotificationPreview tone="profit" lang="en" />);
    expect(screen.getByText('Target reached — in profit')).toBeTruthy();
  });
});
