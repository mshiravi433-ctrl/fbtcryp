// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options = {}) => key.split('.').reduce((value, part) => value?.[part], fa) ?? options.defaultValue ?? key,
    i18n: { resolvedLanguage: 'fa', language: 'fa' }
  })
}));

import MarketStackedHero from '../src/components/market/MarketStackedHero.jsx';
import SmartMoneyBanner from '../src/components/market/SmartMoneyBanner.jsx';

afterEach(cleanup);

describe('global-market banners', () => {
  it('starts with a compact, image-led global markets banner linked to the global page', () => {
    render(<MemoryRouter><MarketStackedHero /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /نبض بازارهای جهان/ });
    expect(link.getAttribute('href')).toBe('/global');
    expect(link.querySelector('img').getAttribute('src')).toBe('/images/market-stack/global-market-art.webp');
    expect(link.querySelector('.mx-global-hero-title').textContent).toBe('نبض بازارهای جهان');
    expect(link.querySelector('.mx-global-hero-subtitle').textContent).toContain('سهام');
  });

  it('ends with a compact global-markets invitation and abstract, unnumbered chart', () => {
    render(<MemoryRouter><SmartMoneyBanner /></MemoryRouter>);
    const banner = screen.getByTestId('market-smart-money-banner');
    expect(banner.textContent).toContain(fa.marketGlobalAd.title);
    expect(banner.textContent).toContain(fa.marketGlobalAd.desc);
    expect(banner.querySelector('.mx-global-preview svg')).toBeTruthy();
    expect(banner.querySelector('a').getAttribute('href')).toBe('/global');
    expect(banner.textContent).not.toMatch(/\d+([.,]\d+)?\s?%/);
  });
});
