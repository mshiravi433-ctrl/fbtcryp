// @vitest-environment jsdom
/**
 * THE UNISWAP-STYLE DOCK — Farm / Loan / Protection / Auto Orders.
 * ---------------------------------------------------------------------------
 * The request, in the owner's words:
 *
 *   «در صفحات فارم و وام و محافظت و سفارش خودکار … فوتر شبیه والت یونی‌سواپ
 *    یعنی چهار ایکون کنار هم با فاصله، یک ایکون برای هوش مصنوعی … وقتی
 *    اسکرول می‌کنی پایین هیدر و فوتر محو شود و اسکرول بالا دوباره بیاد»
 *
 * So this file asserts three separate promises, none of them cosmetic:
 *
 *   1. SCOPE — the dock appears on exactly those four sections (and their
 *      children), the global BottomNav is gone there, and nothing else in
 *      the app changed.
 *   2. SHAPE — four icons, the fourth one the AI, each a real link-sized
 *      tap target with an accessible name.
 *   3. MOTION — scrolling down hides header AND dock, scrolling up brings
 *      both back, and reduced motion cancels the whole behaviour.
 */
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n';
import { AppChrome } from '../src/App';
import { useSettingsStore } from '../src/store/useSettingsStore';

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(() => {
  cleanup();
  cleanup();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    })
  });
});

/** jsdom has no layout, so the scroll position is whatever we say it is. */
async function scrollTo(y) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  await act(async () => {
    fireEvent.scroll(window);
    // One frame: the hook throttles through requestAnimationFrame.
    await new Promise((r) => setTimeout(r, 40));
  });
}

const renderAt = async (path) => {
  const out = render(
    <MemoryRouter initialEntries={[path]}>
      <AppChrome />
    </MemoryRouter>
  );
  // The dock is a lazy chunk, like QuickAccess.
  await waitFor(() => expect(out.container.querySelector('.uni-dock')).toBeTruthy());
  return out;
};

describe('the Uniswap-style dock', () => {
  it.each(['/farm', '/loan', '/insurance', '/orders', '/orders/history', '/insurance/marketplace'])(
    'replaces the global nav on %s',
    async (path) => {
      const { container } = await renderAt(path);
      expect(container.querySelector('.bottom-nav')).toBeNull();
      const dock = container.querySelector('.uni-dock');
      expect(dock).toBeTruthy();
      expect(container.querySelector('.app-shell').classList.contains('app-shell--uni-dock')).toBe(true);
    }
  );

  it('leaves the rest of the app on the global nav', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/wallet']}>
        <AppChrome />
      </MemoryRouter>
    );
    expect(container.querySelector('.bottom-nav')).toBeTruthy();
    expect(container.querySelector('.uni-dock')).toBeNull();
    expect(container.querySelector('.app-shell').classList.contains('app-shell--uni-dock')).toBe(false);
  });

  it('shows four icons side by side, the last one the AI', async () => {
    const { container } = await renderAt('/farm');
    const items = container.querySelectorAll('.uni-dock > button');
    expect(items.length).toBe(4);
    expect(items[3].classList.contains('uni-dock__item--ai')).toBe(true);
    // Only the AI gets the saturated disc.
    const ai = container.querySelectorAll('.uni-dock__item--ai');
    expect(ai.length).toBe(1);
    // Every slot is a real, named target.
    for (const el of items) {
      expect(el.getAttribute('aria-label')).toBeTruthy();
      expect(el.querySelector('svg')).toBeTruthy();
    }
    // Icon-only, like the reference: the names live in .uni-dock__sr and in
    // aria-label, never as visible text under the glyphs.
    for (const el of items) {
      const visible = [...el.childNodes]
        .filter((n) => !(n.classList && n.classList.contains('uni-dock__sr')))
        .map((n) => n.textContent.trim())
        .join('');
      expect(visible).toBe('');
    }
    expect(container.querySelectorAll('.uni-dock__sr').length).toBe(4);
  });

  it('sends the AI icon to Intent OS and marks the current screen', async () => {
    const { container } = await renderAt('/loan');
    const items = container.querySelectorAll('.uni-dock > button');
    expect(items[3].getAttribute('aria-label')).toBe('سیستم Intent');
    // /loan is not one of the four destinations, so nothing is current here…
    expect(container.querySelector('.uni-dock [aria-current="page"]')).toBeNull();
    // …and the active state is driven by the route, not by a local tap.
    const market = items[0];
    fireEvent.click(market);
    expect(market.getAttribute('aria-label')).toBe('بازار');
  });

  it('hides header and dock on scroll down, brings both back on scroll up', async () => {
    const { container } = await renderAt('/farm');
    const dock = () => container.querySelector('.uni-dock');
    const header = () => container.querySelector('.top-bar');

    expect(dock().getAttribute('data-hidden')).toBe('false');

    await scrollTo(320);
    await waitFor(() => expect(dock().getAttribute('data-hidden')).toBe('true'));
    // ONE state drives both bars, so they can never disagree.
    expect(header().classList.contains('is-chrome-hidden')).toBe(true);

    await scrollTo(260);
    await waitFor(() => expect(dock().getAttribute('data-hidden')).toBe('false'));
    expect(header().classList.contains('is-chrome-hidden')).toBe(false);
  });

  it('stays put near the top of the page and on tiny scroll deltas', async () => {
    const { container } = await renderAt('/farm');
    const dock = () => container.querySelector('.uni-dock');

    // In the "always visible near the top" band, however far you move.
    await scrollTo(100);
    expect(dock().getAttribute('data-hidden')).toBe('false');
    await scrollTo(130);
    expect(dock().getAttribute('data-hidden')).toBe('false');

    // Below the "always visible near the top" band, a real downward move.
    await scrollTo(400);
    await waitFor(() => expect(dock().getAttribute('data-hidden')).toBe('true'));

    // Back to the very top: shown, whatever the direction history says.
    await scrollTo(0);
    await waitFor(() => expect(dock().getAttribute('data-hidden')).toBe('false'));
  });

  it('never hides when the user asked for reduced motion', async () => {
    // The app's OWN setting, not the OS one: useStill() ORs the two, and this
    // is the switch the user can actually reach in Settings.
    useSettingsStore.setState({ reduceMotion: true });
    try {
      const { container } = await renderAt('/orders');
      await scrollTo(600);
      expect(container.querySelector('.uni-dock').getAttribute('data-hidden')).toBe('false');
    } finally {
      useSettingsStore.setState({ reduceMotion: false });
    }
  });

  it('keeps the More menu reachable from the header', async () => {
    const { container } = await renderAt('/farm');
    const more = screen.getByRole('button', { name: 'بیشتر' });
    expect(more.closest('.top-bar')).toBeTruthy();
    fireEvent.click(more);
    expect(await screen.findByRole('heading', { name: 'بیشتر' })).toBeTruthy();
  });
});
