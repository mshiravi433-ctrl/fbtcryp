// @vitest-environment jsdom
/**
 * THE SECTION DOCK — Farm / Loan / Protection / Auto Orders.
 * ---------------------------------------------------------------------------
 * The owner's two rounds of instruction, both pinned here:
 *
 *   «فوتر شبیه والت یونی‌سواپ … وقتی اسکرول می‌کنی پایین هیدر و فوتر محو شود
 *    و اسکرول بالا دوباره بیاد»
 *   «منو فوتر … باید سه تا دکمه از این صفحات باشد و دکمه هوش مصنوعی از این‌ها
 *    جدا باشد … بغل صفحه در این صفحات هم دسترسی سریع را محو کن»
 *
 * So four promises, none of them cosmetic:
 *
 *   1. SCOPE — the dock appears on exactly those four sections (and their
 *      children), the global BottomNav is gone there, nothing else changed.
 *   2. THREE + ONE — the pill holds three section buttons, and the AI is a
 *      SEPARATE surface outside that pill, never the fourth slot in it.
 *   3. THE THREE ARE THE SIBLINGS — the page you are on is not one of them,
 *      so all four screens are always one tap apart.
 *   4. MOTION + CHROME — scroll down hides header and dock, scroll up
 *      brings both back, reduced motion cancels it, and the side QuickAccess
 *      rail is not mounted on these screens.
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

const labelsOf = (root) =>
  [...root.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

describe('the section dock', () => {
  it.each(['/farm', '/loan', '/insurance', '/orders', '/orders/history', '/insurance/marketplace'])(
    'replaces the global nav on %s',
    async (path) => {
      const { container } = await renderAt(path);
      expect(container.querySelector('.bottom-nav')).toBeNull();
      expect(container.querySelector('.uni-dock')).toBeTruthy();
      expect(container.querySelector('.app-shell').classList.contains('app-shell--uni-dock')).toBe(true);
    }
  );

  it('leaves the rest of the app on the global nav', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/wallet']}>
        <AppChrome />
      </MemoryRouter>
    );
    expect(container.querySelector('.bottom-nav')).toBeTruthy();
    expect(container.querySelector('.uni-dock')).toBeNull();
    expect(container.querySelector('.app-shell').classList.contains('app-shell--uni-dock')).toBe(false);
  });

  it('puts exactly three section buttons in the pill', async () => {
    const { container } = await renderAt('/farm');
    const group = container.querySelector('.uni-dock__group');
    expect(group).toBeTruthy();
    expect(group.querySelectorAll(':scope > button').length).toBe(3);
    for (const btn of group.querySelectorAll(':scope > button')) {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
      expect(btn.querySelector('svg')).toBeTruthy();
    }
  });

  it('stands the AI OUTSIDE the pill, not as a fourth slot in it', async () => {
    const { container } = await renderAt('/farm');
    const ai = container.querySelector('.uni-dock__ai');
    const group = container.querySelector('.uni-dock__group');
    expect(ai).toBeTruthy();
    // The structural rule this whole layout is for.
    expect(group.contains(ai)).toBe(false);
    expect(group.querySelectorAll(':scope > button').length).toBe(3);
    // …and it is still a real, named destination.
    expect(ai.getAttribute('aria-label')).toBe('سیستم Intent');
  });

  it('shows the three SIBLING sections, never the page you are on', async () => {
    const cases = {
      '/farm': ['وام', 'محافظت / بیمه', 'سفارش خودکار'],
      '/loan': ['فارم', 'محافظت / بیمه', 'سفارش خودکار'],
      '/insurance': ['فارم', 'وام', 'سفارش خودکار'],
      '/orders': ['فارم', 'وام', 'محافظت / بیمه']
    };
    for (const [path, expected] of Object.entries(cases)) {
      const { container } = await renderAt(path);
      const group = container.querySelector('.uni-dock__group');
      expect(labelsOf(group), path).toEqual(expected);
      // Nothing in the pill claims to be the current page.
      expect(container.querySelector('.uni-dock__group [aria-current="page"]'), path).toBeNull();
      cleanup();
    }
  });

  it('lists the AI as separate from the section buttons', async () => {
    const { container } = await renderAt('/orders');
    const groupLabels = labelsOf(container.querySelector('.uni-dock__group'));
    const ai = container.querySelector('.uni-dock__ai');
    expect(groupLabels).not.toContain(ai.getAttribute('aria-label'));
    // Three section slots + the AI button, and no more.
    expect(container.querySelectorAll('.uni-dock button').length).toBe(4);
  });

  it('is icon-only: no visible label text inside either surface', async () => {
    const { container } = await renderAt('/loan');
    for (const btn of container.querySelectorAll('.uni-dock button')) {
      const visible = [...btn.childNodes]
        .filter((n) => !(n.classList && n.classList.contains('uni-dock__sr')))
        .map((n) => n.textContent.trim())
        .join('');
      expect(visible).toBe('');
    }
    expect(container.querySelectorAll('.uni-dock__sr').length).toBe(4);
  });

  it('navigates to the sibling section that was tapped', async () => {
    const { container } = await renderAt('/farm');
    const group = container.querySelector('.uni-dock__group');
    fireEvent.click(group.querySelectorAll(':scope > button')[0]);
    // Nothing in a jsdom MemoryRouter can prove the route rendered here, but
    // /loan becoming the current section would empty it of that label.
    await waitFor(() => {
      const labels = labelsOf(container.querySelector('.uni-dock__group'));
      expect(labels[0]).toBe('فارم');
    });
  });

  it('does not mount the side QuickAccess rail on these screens', async () => {
    render(
      <MemoryRouter initialEntries={['/farm']}>
        <AppChrome />
      </MemoryRouter>
    );
    // QuickAccess portals to document.body and is lazy: give it the time it
    // would need, then assert it never arrived.
    await new Promise((r) => setTimeout(r, 300));
    expect(document.querySelector('.quick-access')).toBeNull();
  });

  it('still mounts the side rail elsewhere', async () => {
    render(
      <MemoryRouter initialEntries={['/wallet']}>
        <AppChrome />
      </MemoryRouter>
    );
    await waitFor(() => expect(document.querySelector('.quick-access')).toBeTruthy());
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

    await scrollTo(100);
    expect(dock().getAttribute('data-hidden')).toBe('false');
    await scrollTo(130);
    expect(dock().getAttribute('data-hidden')).toBe('false');

    await scrollTo(400);
    await waitFor(() => expect(dock().getAttribute('data-hidden')).toBe('true'));

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
    await renderAt('/farm');
    const more = screen.getByRole('button', { name: 'بیشتر' });
    expect(more.closest('.top-bar')).toBeTruthy();
    fireEvent.click(more);
    expect(await screen.findByRole('heading', { name: 'بیشتر' })).toBeTruthy();
  });
});
