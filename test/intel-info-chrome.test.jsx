// @vitest-environment jsdom
/**
 * INTEL + INFO CHROME — Smart Money / News / Global and the ten info pages.
 * ---------------------------------------------------------------------------
 * The owner's brief, in order:
 *
 *   1. The footer centre opens Quick Access, colored by page, with no side rail.
 *   2. «کاوش، آموزش، امنیت، توسعه‌دهنده، اکوسیستم، بیزینس، تماس با ما،
 *      درباره ما، تنظیمات و امتیازها — کلا فوتر محو شود و در هیدر به جای
 *      آیکون شبکه اجتماعی منو بیشتر باشد مانند فارم» — on those ten pages
 *      there is no footer at all, and the header button becomes More.
 *   3. «برای همه این صفحات هنگام اسکرول به پایین هیدر محو و هنگام اسکرول
 *      به بالا هیدر بیاد» — the header hides on scroll down and returns on
 *      scroll up on all of them.
 *   6. «در منو بیشتر قسمت صفحه تغییرات محو بشه» — the «تغییرات» tile is
 *      gone from the More menu (its route stays).
 *
 * Farm's sticky header + sticky tabs and the quieted green field live in
 * uni-dock.test.jsx and the CSS assertions at the bottom of this file.
 */
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { setLanguage } from '../src/i18n';
import { AppChrome } from '../src/App';

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
});

/** jsdom has no layout, so the scroll position is whatever we say it is. */
async function scrollTo(y) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  await act(async () => {
    fireEvent.scroll(window);
    await new Promise((r) => setTimeout(r, 40));
  });
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppChrome />
    </MemoryRouter>
  );

describe('intel pages — Smart Money / News / Global', () => {
  it.each([
    ['/smart-money', 'green'], ['/news', 'blue'], ['/global', 'purple']
  ])('puts a colored Quick Access launcher in the footer on %s', async (path, tone) => {
    const { container } = renderAt(path);
    expect(container.querySelector('.bottom-nav')).toBeTruthy();
    expect(container.querySelector('.nav-centre')).toBeNull();
    await waitFor(() => expect(document.querySelector('.quick-access--footer')).toBeTruthy());
    const launcher = document.querySelector('.quick-access');
    expect(launcher.classList.contains(`quick-access--tone-${tone}`)).toBe(true);
    expect(launcher.classList.contains('quick-access--centered')).toBe(true);
    expect(document.querySelectorAll('.quick-access')).toHaveLength(1);
    fireEvent.click(within(launcher).getByRole('button', { name: 'باز کردن دسترسی سریع' }));
    const nav = within(launcher).getByRole('navigation', { name: 'دسترسی سریع' });
    expect(within(nav).getAllByRole('link').length).toBeGreaterThan(0);
    expect(within(launcher).getAllByRole('button', { name: 'بستن دسترسی سریع' }).length).toBeGreaterThan(0);
  });

  it('hides the header on scroll down and brings it back on scroll up', async () => {
    const { container } = renderAt('/smart-money');
    const header = () => container.querySelector('.top-bar');
    expect(header().classList.contains('is-chrome-hidden')).toBe(false);
    await scrollTo(400);
    await waitFor(() => expect(header().classList.contains('is-chrome-hidden')).toBe(true));
    await scrollTo(300);
    await waitFor(() => expect(header().classList.contains('is-chrome-hidden')).toBe(false));
  });
});

describe('info pages — no footer, More in the header', () => {
  it.each([
    '/explore-hub', '/learn', '/security', '/developers', '/ecosystem',
    '/business', '/contact', '/about', '/settings', '/rewards'
  ])('removes the footer and puts More in the header on %s', async (path) => {
    const { container } = renderAt(path);
    const shell = container.querySelector('.app-shell');
    expect(shell.classList.contains('app-shell--info')).toBe(true);
    expect(container.querySelector('.bottom-nav')).toBeNull();
    const header = container.querySelector('.top-bar');
    expect(within(header).getByRole('button', { name: 'بیشتر' })).toBeTruthy();
    expect(within(header).queryByRole('button', { name: 'شبکهٔ اجتماعی' })).toBeNull();
    // The header More opens the More sheet.
    fireEvent.click(within(header).getByRole('button', { name: 'بیشتر' }));
    expect(await screen.findByRole('heading', { name: 'بیشتر' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('more-menu-close'));
  });

  it('hides the header on scroll down and brings it back on scroll up', async () => {
    const { container } = renderAt('/settings');
    const header = () => container.querySelector('.top-bar');
    await scrollTo(400);
    await waitFor(() => expect(header().classList.contains('is-chrome-hidden')).toBe(true));
    await scrollTo(300);
    await waitFor(() => expect(header().classList.contains('is-chrome-hidden')).toBe(false));
  });

  it('leaves the rest of the app on the global footer', () => {
    const { container } = renderAt('/wallet');
    expect(container.querySelector('.app-shell').classList.contains('app-shell--info')).toBe(false);
    expect(container.querySelector('.app-shell').classList.contains('app-shell--intel')).toBe(false);
    expect(container.querySelector('.bottom-nav')).toBeTruthy();
  });
});

describe('the More menu', () => {
  it('no longer lists «تغییرات» — the route stays, the tile is gone', async () => {
    const src = readFileSync('src/components/MoreSheet.jsx', 'utf8');
    expect(src).not.toMatch(/to: '\/whats-new'/);
    // …but the page itself is still mounted for old links.
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).toMatch(/path="\/whats-new"/);
  });
});

describe('Farm — sticky tabs and the quieted green field', () => {
  it('pins the channel rail under the header', () => {
    const css = readFileSync('src/styles/farm-greenhouse.css', 'utf8');
    const block = /\.farm-page \.farm-tabs\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/top:\s*calc\(env\(safe-area-inset-top/);
    expect(block).toMatch(/z-index:\s*20/);
  });

  it('draws the page contour lines at a whisper, not a glare', () => {
    const css = readFileSync('src/styles/farm-greenhouse.css', 'utf8');
    // The full-page survey field: 16% → 4.5% (dark), 14% → 4% (light).
    expect(css).toContain("stroke='%2300ff9d' stroke-opacity='.045'");
    expect(css).toContain("stroke='%2300a86b' stroke-opacity='.04'");
    expect(css).not.toContain("stroke='%2300ff9d' stroke-opacity='.16'");
    expect(css).not.toContain("stroke='%2300a86b' stroke-opacity='.14'");
    // The hero contour lines quieted with it.
    expect(css).toContain("stroke='%2300ff9d' stroke-opacity='.15'");
    expect(css).not.toContain("stroke='%2300ff9d' stroke-opacity='.5'");
  });
});
