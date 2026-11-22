// @vitest-environment jsdom
/**
 * «صفحه فارم نمیاد کلا و می‌گه به مشکل برخورده» — the Farm screen must MOUNT.
 * ---------------------------------------------------------------------------
 * What actually broke it, and what each assertion below is for:
 *
 *   1. A MISSING BROWSER METHOD TOOK THE WHOLE PAGE DOWN.
 *      Farm's mount effect scrolled its active tab into view with
 *      `el?.scrollIntoView(...)`. The optional chain guards the ELEMENT, not
 *      the METHOD — so on any engine/webview without `scrollIntoView` the
 *      call throws a TypeError. Effects are not wrapped by <Suspense>: the
 *      throw unwinds to the route's error boundary, which replaces the entire
 *      screen with «این صفحه به مشکل خورد» even though the feed had loaded
 *      perfectly. Every scroll call on the page now goes through
 *      `scrollIntoViewSafe`, and this file renders the page with the method
 *      DELETED — the exact failing environment, reproduced.
 *
 *   2. ONE OPTIONAL ADAPTER COULD TAKE THE PAGE WITH IT.
 *      FarmPositionHub pulls five adapter panels statically. In Farm's own
 *      chunk, any throw inside any of them (or their imports) was a Farm
 *      crash. It is a lazy chunk now, and the page renders while it is still
 *      loading, so the screen is never hostage to an adapter.
 */
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n';

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(cleanup);

const renderFarm = async () => {
  const Farm = (await import('../src/pages/Farm.jsx')).default;
  const out = render(
    <MemoryRouter initialEntries={['/farm']}>
      <Farm />
    </MemoryRouter>
  );
  await waitFor(() => expect(out.container.querySelector('.farm-page')).toBeTruthy(), { timeout: 20000 });
  return out;
};

describe('the Farm screen mounts', () => {
  it('renders with NO scrollIntoView on the element prototype', { timeout: 30000 }, async () => {
    // jsdom does not implement it, which is exactly the reported class of
    // engine. Assert that first, so this test cannot silently stop testing
    // the thing it was written for.
    expect(typeof window.HTMLElement.prototype.scrollIntoView).not.toBe('function');

    const { container } = await renderFarm();
    const text = container.textContent;
    expect(text).not.toContain('این صفحه به مشکل خورد');
    expect(text).not.toContain('خطای غیرمنتظره');
    // The hero is the page's own first screen, not an error fallback.
    expect(container.querySelector('.farm-hero-premium, .farm-hero-title')).toBeTruthy();
  });

  it('also renders when scrollIntoView exists but THROWS', { timeout: 30000 }, async () => {
    window.HTMLElement.prototype.scrollIntoView = () => { throw new Error('boom'); };
    try {
      const { container } = await renderFarm();
      expect(container.textContent).not.toContain('این صفحه به مشکل خورد');
    } finally {
      delete window.HTMLElement.prototype.scrollIntoView;
    }
  });

  it('keeps the position hub a separate chunk, so an adapter cannot crash the page', async () => {
    const src = (await import('node:fs')).readFileSync('src/pages/Farm.jsx', 'utf8');
    // Lazy import, not a static component import…
    expect(src).toMatch(/const FarmPositionHub = lazyRetry\(\(\) => import\('\.\.\/components\/Farm\/FarmPositionHub'\)\)/);
    // …rendered inside its own Suspense, so a pending/failed chunk is local.
    expect(src).toMatch(/<Suspense fallback=\{null\}>\s*<FarmPositionHub \/>\s*<\/Suspense>/);
  });
});
