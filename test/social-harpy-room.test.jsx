// @vitest-environment jsdom
/**
 * SOCIAL — THE HARPY ROOM CONTRACT
 * ---------------------------------------------------------------------------
 * The brief was specific (2026-11-06, Persian):
 *
 *   «شبکهٔ اجتماعی ... اصلاً یک صفحهٔ مجزا باشد، شکلش شبیه هارپی ... منو به
 *    جای پایین بالا باشد و صفحات مثل مرورگر، ترندها و تایم‌لاین باشد از تم
 *    مشکی هارپی ... نوشتن گوشهٔ راست با اسکرول بالا و پایین همراه صفحه بیاد»
 *
 * A render test proves the component mounts; it cannot prove the room LOOKS
 * like Harpy. These assertions check the four things that make it that room,
 * in the only places they can be checked:
 *
 *   1. The shell — `/social` must be headerless, or the app's own header and
 *      bottom nav stack on top of this room and the whole point is lost.
 *   2. The bar — Harpy's navigation sits at the TOP, inside the page, and the
 *      app's BottomNav is not rendered for this route.
 *   3. The palette — taken from Harpy's own `_crow` theme (background
 *      #00030F→#12254A, primary #F3AA2F), not invented, not the app's RGB.
 *   4. The write button — Harpy's floating compose: physical right corner,
 *      hides on a downward scroll and comes back on the first upward one.
 *
 * i18n is the real instance (not a stub that echoes keys): an English tab
 * label on a Persian screen is exactly the kind of bug a stub cannot see.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n/index.js';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

/* The network never answers in this test; what is asserted is the shape. */
vi.mock('../src/lib/social', () => ({
  BSKY_HOME: 'https://bsky.app',
  composeUrl: (text) => `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`,
  fetchTopic: vi.fn(async () => ({ rows: [], live: true })),
  fetchTrending: vi.fn(async () => []),
  fetchProfile: vi.fn(async () => ({ rows: [], live: true })),
  fetchThread: vi.fn(async () => ({ root: null, replies: [], live: true })),
  search: vi.fn(async () => ({ posts: [], accounts: [], live: true }))
}));
vi.mock('../src/lib/browser', () => ({ openUrl: vi.fn() }));
/*
 * Framer is reduced to plain elements here. The room's motion is decorative —
 * an assertion about WHICH controls exist must not depend on an exit animation
 * having finished in jsdom, and a `motion.button` that is mid-fade-out is
 * still a button to the accessibility tree.
 */
vi.mock('framer-motion', async () => {
  const React = await import('react');
  /* Cached per tag: a NEW component identity on every render would unmount and
     remount the subtree, which detaches the node a test is holding. */
  const cache = new Map();
  const make = (tag) => {
    if (!cache.has(tag)) {
      cache.set(
        tag,
        React.forwardRef((props, ref) => {
          const { children, initial, animate, exit, transition, variants, whileTap, layout, layoutId, custom, ...rest } = props;
          void initial; void animate; void exit; void transition; void variants; void whileTap; void layout; void layoutId; void custom;
          return React.createElement(tag, { ref, ...rest }, children);
        })
      );
    }
    return cache.get(tag);
  };
  return {
    motion: new Proxy({}, { get: (_target, tag) => make(tag) }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => false
  };
});
/* Discover drags the whole directory + its API layer in; the browser tab is
   only asserted to EXIST here, and its own screen contract has its own test. */
vi.mock('../src/pages/Discover.jsx', () => ({ default: () => <div data-testid="discover-embed" /> }));

const Social = (await import('../src/pages/Social.jsx')).default;

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/social']}>
      <Social />
    </MemoryRouter>
  );

describe('the Harpy room — shell', () => {
  it('takes the whole screen: the app’s header and bottom nav are not rendered on /social', () => {
    const app = read('src/App.jsx');
    expect(app).toMatch(/pathname\.startsWith\('\/social'\)/);
    expect(app).toMatch(/const headerless = [^;]*startsWith\('\/social'\)[^;]*;/);
    /* …and the facts that make headerless matter: the shell owns BOTH bars. */
    expect(app).toMatch(/\{!headerless && <Header \/>\}/);
    expect(app).toMatch(/\{!headerless && <BottomNav \/>\}/);
  });

  it('renders its own top navigation, not a bottom one', async () => {
    mount();
    await screen.findAllByRole('tab');
    /* Five pages in the top bar — the topic chips inside the timeline are a
       second tablist (the feed filter) and are deliberately not counted. */
    expect(document.querySelectorAll('.hsp-tabs [role="tab"]').length).toBe(5);
    expect(document.querySelectorAll('.bottom-nav').length).toBe(0);
    await cleanup();
  });
});

describe('the Harpy room — pages', () => {
  beforeAll(async () => {
    expect(await setLanguage('fa')).toBe(true);
  });
  afterEach(cleanup);

  it('ships the timeline, trends, browser, search and settings pages in Persian', async () => {
    mount();
    await screen.findAllByRole('tab');
    const tabs = [...document.querySelectorAll('.hsp-tabs [role="tab"]')];
    const names = tabs.map((tab) => tab.getAttribute('aria-label'));
    expect(names).toEqual(['تایم‌لاین', 'ترندها', 'مرورگر', 'جست‌وجو', 'تنظیمات']);

    /* Tapping the browser tab mounts the real directory, embedded. */
    fireEvent.click(tabs[2]);
    expect(await screen.findByTestId('discover-embed')).toBeTruthy();
  });

  it('opens the drawer and reaches every page from it too', async () => {
    mount();
    const menu = await screen.findByRole('button', { name: 'باز کردن منو' });
    fireEvent.click(menu);
    const drawer = await screen.findByRole('complementary', { name: 'منوی شبکهٔ اجتماعی' });
    expect(drawer.textContent).toContain('بازگشت به اپ');
    expect(drawer.textContent).toContain('نوشتن');
    /* The mark beside «شبکهٔ اجتماعی» is the app coin, not a generic globe. */
    expect(drawer.querySelector('.hsp-appmark svg')).toBeTruthy();
    expect(drawer.textContent).toContain('پست‌های کریپتو در دیگر شبکه‌های اجتماعی');
    expect(drawer.textContent).not.toContain('پست‌های کریپتوی Bluesky');
  });

  it('puts the Farcaster conversation channels on the timeline and signs the settings page fbtswap', async () => {
    mount();
    await screen.findAllByRole('tab');
    for (const label of ['ارز دیجیتال', 'بیس', 'توسعه‌دهندگان']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    const settings = [...document.querySelectorAll('.hsp-tabs [role="tab"]')].find((tab) => tab.getAttribute('aria-label') === 'تنظیمات');
    fireEvent.click(settings);
    fireEvent.click(await screen.findByRole('button', { name: 'درباره و هشدار' }));
    expect(screen.getByText('هشدار')).toBeTruthy();
    expect(document.body.textContent).toContain('عبارت بازیابی');
    expect(document.querySelector('.hsp-brandline')?.textContent).toBe('fbtswap');
  });
});

describe('the Harpy room — palette and shape', () => {
  const css = read('src/styles/social.css');

  it('uses Harpy’s own crow palette, scoped to the room', () => {
    /* From lib/core/harpy_theme/predefined_themes.dart in the upstream app. */
    expect(css).toMatch(/--hsp-bg:\s*#00030f/i);
    expect(css).toMatch(/--hsp-bg-2:\s*#12254a/i);
    expect(css).toMatch(/--hsp-primary:\s*#f3aa2f/i);
    expect(css).toMatch(/--hsp-secondary:\s*#4689ff/i);
    /* Scoped: the room must not repaint the app's tokens. */
    expect(css).not.toMatch(/:root\s*\{/);
    expect(css).not.toMatch(/--rgb-1:/);
  });

  it('draws the amber pill and the fixed right-corner write button', () => {
    expect(css).toMatch(/\.hsp-tab\.is-on\s*\{[^}]*background:[^}]*var\(--hsp-primary\)/s);
    expect(css).toMatch(/\.hsp-fab,\s*\n?\.hsp-topbtn\s*\{[^}]*position:\s*absolute[^}]*right:/s);
    expect(css).toMatch(/\.hsp\s*\{[^}]*position:\s*fixed/s);
  });

  it('fills the menu tile with the coin instead of shrinking it', () => {
    /* Reported: «در منو لوگو بسیار سایزس بده و خیلی کوچکه سایزش متناسب باکس
       داخل باشه». The mark is the app coin, whose drawing spans 77% of its
       SVG box; at 30px inside a 46px tile the coin was ~23px — half the box.
       42px inside 48px puts the coin at ~32px (73% of the tile) and keeps the
       gradient rim readable. The inner disc follows the tile radius too. */
    const tile = /\.hsp-drawer-head \.hsp-appmark \{([\s\S]*?)\n\}/.exec(css)[1];
    expect(tile).toMatch(/width:\s*48px/);
    expect(tile).toMatch(/height:\s*48px/);
    const disc = /\.hsp-drawer-head \.hsp-appmark::after \{([\s\S]*?)\n\}/.exec(css)[1];
    expect(disc).toMatch(/border-radius:\s*15px/);
    const svg = /\.hsp-drawer-head \.hsp-appmark svg \{([\s\S]*?)\n\}/.exec(css)[1];
    expect(svg).toMatch(/width:\s*42px/);
    expect(svg).toMatch(/height:\s*42px/);
  });
});

describe('the Harpy room — the write button travels with the scroll', () => {
  it('hides on a downward scroll and returns on the first upward one', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined); // exercise the sync path
    mount();
    const fab = await screen.findByRole('button', { name: 'نوشتن' });
    expect(fab).toBeTruthy();

    const scroller = document.querySelector('.hsp-scroll');
    const setScroll = (top) => {
      Object.defineProperty(scroller, 'scrollTop', { value: top, configurable: true, writable: true });
      fireEvent.scroll(scroller);
    };

    setScroll(400); // reading down
    expect(screen.queryByRole('button', { name: 'نوشتن' })).toBeNull();

    setScroll(120); // coming back up
    expect(await screen.findByRole('button', { name: 'نوشتن' })).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
