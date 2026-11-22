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
 *   2. FOUR + ONE — the pill holds the group's four sections (Farm, Loan,
 *      INSURANCE, Auto Orders — the owner replaced «محافظت» with «بیمه»),
 *      and the AI is a SEPARATE surface outside that pill, never a fifth
 *      slot in it.
 *   3. THE ACTIVE ONE HAS THE NOTCH — exactly one button carries the notch,
 *      and it is the section you are on.
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

  it('puts exactly four section buttons in the pill, one per screen', async () => {
    const { container } = await renderAt('/farm');
    const pill = container.querySelector('.uni-dock__pill');
    expect(pill).toBeTruthy();
    expect(pill.querySelectorAll(':scope > button').length).toBe(4);
    expect(labelsOf(pill)).toEqual(['فارم', 'وام', 'بیمه', 'سفارش خودکار']);
    for (const btn of pill.querySelectorAll(':scope > button')) {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
      expect(btn.querySelector('svg')).toBeTruthy();
    }
  });

  it('names the third slot «بیمه», not «محافظت»', async () => {
    const { container } = await renderAt('/loan');
    const labels = labelsOf(container.querySelector('.uni-dock__pill'));
    expect(labels[2]).toBe('بیمه');
    expect(labels.join(' ')).not.toContain('محافظت');
  });

  it('stands the AI OUTSIDE the pill, not as a fifth slot in it', async () => {
    const { container } = await renderAt('/farm');
    const ai = container.querySelector('.uni-dock__ai');
    const pill = container.querySelector('.uni-dock__pill');
    expect(ai).toBeTruthy();
    // The structural rule this whole layout is for.
    expect(pill.contains(ai)).toBe(false);
    expect(pill.querySelectorAll(':scope > button').length).toBe(4);
    // …and it is still a real, named destination.
    expect(ai.getAttribute('aria-label')).toBe('سیستم Intent');
  });

  it('marks the section you are on as active, and only that one', async () => {
    const cases = { '/farm': 'farm', '/loan': 'loan', '/insurance': 'insurance', '/orders': 'orders', '/orders/history': 'orders' };
    for (const [path, id] of Object.entries(cases)) {
      const { container } = await renderAt(path);
      const active = [...container.querySelectorAll('.uni-dock__pill > button.is-active')];
      expect(active.length, path).toBe(1);
      expect(active[0].dataset.section, path).toBe(id);
      expect(container.querySelectorAll('.uni-dock__pill [aria-current="page"]').length, path).toBe(1);
      cleanup();
    }
  });

  it('gives the active button the notch, and nobody else', async () => {
    const { container } = await renderAt('/insurance');
    const active = container.querySelector('.uni-dock__pill > button.is-active');
    expect(active.querySelector('.uni-dock__notch')).toBeTruthy();
    // Exactly one notch is rendered in the whole bar.
    expect(container.querySelectorAll('.uni-dock__notch').length).toBe(1);
    for (const btn of container.querySelectorAll('.uni-dock__pill > button:not(.is-active)')) {
      expect(btn.querySelector('.uni-dock__notch')).toBeNull();
    }
  });

  it('lists the AI as separate from the section buttons', async () => {
    const { container } = await renderAt('/orders');
    const pillLabels = labelsOf(container.querySelector('.uni-dock__pill'));
    const ai = container.querySelector('.uni-dock__ai');
    expect(pillLabels).not.toContain(ai.getAttribute('aria-label'));
    // Four section slots + the AI button, and no more.
    expect(container.querySelectorAll('.uni-dock button').length).toBe(5);
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
    expect(container.querySelectorAll('.uni-dock__sr').length).toBe(5);
  });

  it('moves the notch to the section that was tapped', async () => {
    const { container } = await renderAt('/farm');
    const pill = container.querySelector('.uni-dock__pill');
    // Farm is active on /farm; tap Orders (the fourth slot).
    fireEvent.click(pill.querySelectorAll(':scope > button')[3]);
    await waitFor(() => {
      const active = container.querySelector('.uni-dock__pill > button.is-active');
      expect(active).toBeTruthy();
      expect(active.dataset.section).toBe('orders');
    });
    expect(container.querySelectorAll('.uni-dock__notch').length).toBe(1);
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
