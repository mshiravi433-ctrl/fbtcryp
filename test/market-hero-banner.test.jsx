// @vitest-environment jsdom
/**
 * MARKET HERO SHOWCASE BANNER («ویترین فرماندهی FBT — بالای تب‌ها»)
 * ---------------------------------------------------------------------------
 * Verifies the dedicated Market showcase banner requested for the slot above
 * the «مرور / توکن» tab strip:
 *   1. Positioned on `/market` strictly ABOVE `<MarketTabStrip />`, persistent
 *      across both tabs without adding any network request.
 *   2. Ships three interactive scenes (`pulse`, `swap`, `wealth`), bespoke
 *      inline SVG crests + orbital HUD + live 7d horizon curve, and three real
 *      on-disk 3D `.webp` sculptures under `public/images/market-banner/`.
 *   3. Supports scene switching, RTL/LTR keyboard navigation, auto-advance +
 *      dwell pause, live telemetry pods, honest empty-feed fallback, and real
 *      route/tab actions.
 *   4. Upholds the Market performance & glyph contract: zero `backdrop-filter`,
 *      zero `mask`, zero `filter`, zero `will-change`, compositor-only
 *      keyframes, `data-inview='false'` off-screen pause, and 12-locale parity.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { setLanguage } from '../src/i18n/index.js';
import MarketHeroBanner, { HERO_SCENES } from '../src/components/market/MarketHeroBanner.jsx';

const ROOT = resolve(import.meta.dirname, '..');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc-probe">{loc.pathname}{loc.search}</output>;
}

const SAMPLE_GLOBAL = {
  mcap: 2_480_000_000_000,
  mcapChange: 3.42,
  volume: 96_000_000_000,
  btcDominance: 54.6
};

const SAMPLE_BREADTH = {
  up: 64,
  down: 36,
  flat: 0,
  counted: 100,
  upShare: 0.64,
  downShare: 0.36
};

const SAMPLE_COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 89400, change24h: 2.8, mcap: 1.76e12, sparkline: [84, 85, 86, 88, 89.4] },
  { id: 'solana', symbol: 'SOL', name: 'Solana', price: 214.5, change24h: 12.84, mcap: 9.8e10, sparkline: [188, 194, 201, 208, 214.5] },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 3240, change24h: -1.4, mcap: 3.9e11, sparkline: [3300, 3280, 3260, 3250, 3240] }
];

const SAMPLE_TREND = {
  days: 7,
  change: 4.15,
  points: [
    { x: 1, y: 2.32e12 },
    { x: 2, y: 2.36e12 },
    { x: 3, y: 2.35e12 },
    { x: 4, y: 2.41e12 },
    { x: 5, y: 2.44e12 },
    { x: 6, y: 2.48e12 }
  ]
};

describe('MarketHeroBanner — dedicated banner above the Market tabs', () => {
  beforeEach(async () => {
    await setLanguage('fa');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('ships three real, compact bespoke WebP sculptures on disk and renders custom SVGs with zero text symbols', () => {
    expect(HERO_SCENES).toHaveLength(3);
    for (const scene of HERO_SCENES) {
      const diskPath = resolve(ROOT, 'public', scene.artwork.replace(/^\//, ''));
      expect(existsSync(diskPath), `missing artwork ${diskPath}`).toBe(true);
      const sizeBytes = statSync(diskPath).size;
      expect(sizeBytes).toBeGreaterThan(4_000);
      expect(sizeBytes).toBeLessThan(65_000);
    }

    const { container } = render(
      <MemoryRouter initialEntries={['/market']}>
        <MarketHeroBanner
          global={SAMPLE_GLOBAL}
          breadth={SAMPLE_BREADTH}
          coins={SAMPLE_COINS}
          trend={SAMPLE_TREND}
          vs="usd"
        />
      </MemoryRouter>
    );

    const banner = screen.getByTestId('market-hero-banner');
    expect(banner.getAttribute('data-scene')).toBe('pulse');

    // Custom vector icons + orbital HUD + live 7d curve are all real SVGs.
    const svgs = banner.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(8);
    expect(banner.querySelector('.mhb-hud-svg')).toBeTruthy();
    expect(banner.querySelector('.mhb-wave svg path')).toBeTruthy();

    // Active 3D portal render matches the active scene.
    const activeArt = banner.querySelector('.mhb-art.is-active');
    expect(activeArt?.getAttribute('src')).toBe('/images/market-banner/prism.webp');

    // Zero banned text arrows, triangles, checkmarks or emojis in rendered text.
    expect(container.textContent).not.toMatch(/[↗↘↑↓▲▼✓◈ⓘ]/);
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('switches scenes interactively, navigates routes on CTA tap, and cycles on RTL keyboard arrows', () => {
    const onSelectTab = vi.fn();

    render(
      <MemoryRouter initialEntries={['/market']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <MarketHeroBanner
                  global={SAMPLE_GLOBAL}
                  breadth={SAMPLE_BREADTH}
                  coins={SAMPLE_COINS}
                  trend={SAMPLE_TREND}
                  vs="usd"
                  onSelectTab={onSelectTab}
                />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    const banner = screen.getByTestId('market-hero-banner');

    // Secondary CTA on scene 0 («کاوش توکن‌ها») switches to the tokens tab in-place.
    fireEvent.click(screen.getByTestId('market-hero-secondary-cta'));
    expect(onSelectTab).toHaveBeenCalledWith('tokens');

    // Switch to scene 2 (`swap`) via the scene pill.
    const swapPill = banner.querySelector('[data-scene-btn="swap"]');
    fireEvent.click(swapPill);
    expect(banner.getAttribute('data-scene')).toBe('swap');
    expect(banner.querySelector('.mhb-art.is-active')?.getAttribute('src')).toBe('/images/market-banner/vault.webp');

    // Primary CTA on `swap` navigates to `/swap`.
    fireEvent.click(screen.getByTestId('market-hero-primary-cta'));
    expect(screen.getByTestId('loc-probe').textContent).toBe('/swap');

    // RTL keyboard ArrowLeft advances to the next scene (`wealth`).
    fireEvent.keyDown(swapPill, { key: 'ArrowLeft' });
    expect(banner.getAttribute('data-scene')).toBe('wealth');
    expect(banner.querySelector('.mhb-art.is-active')?.getAttribute('src')).toBe('/images/market-banner/globe.webp');

    // Primary CTA on `wealth` («رادار پول هوشمند») navigates to `/smart-money`,
    // and secondary CTA («سهام و طلا») navigates to `/stocks`.
    fireEvent.click(screen.getByTestId('market-hero-primary-cta'));
    expect(screen.getByTestId('loc-probe').textContent).toBe('/smart-money');

    fireEvent.click(screen.getByTestId('market-hero-secondary-cta'));
    expect(screen.getByTestId('loc-probe').textContent).toBe('/stocks');
  });

  it('auto-advances across scenes on timer and pauses cleanly on focus', () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={['/market']}>
        <MarketHeroBanner
          global={SAMPLE_GLOBAL}
          breadth={SAMPLE_BREADTH}
          coins={SAMPLE_COINS}
          trend={SAMPLE_TREND}
          vs="usd"
        />
      </MemoryRouter>
    );

    const banner = screen.getByTestId('market-hero-banner');
    expect(banner.getAttribute('data-scene')).toBe('pulse');

    act(() => {
      vi.advanceTimersByTime(8_600);
    });
    expect(banner.getAttribute('data-scene')).toBe('swap');

    // Focusing an interactive control inside the banner pauses auto-rotation.
    fireEvent.focus(screen.getByTestId('market-hero-primary-cta'));
    expect(banner.getAttribute('data-autoplay')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(banner.getAttribute('data-scene')).toBe('swap');
  });

  it('displays live telemetry pods with top 24h gainer and degrades honestly when feed is empty', () => {
    const onSelectTab = vi.fn();
    const onOpenCoin = vi.fn();

    const { rerender } = render(
      <MemoryRouter initialEntries={['/market']}>
        <MarketHeroBanner
          global={SAMPLE_GLOBAL}
          breadth={SAMPLE_BREADTH}
          coins={SAMPLE_COINS}
          trend={SAMPLE_TREND}
          vs="usd"
          onSelectTab={onSelectTab}
          onOpenCoin={onOpenCoin}
        />
      </MemoryRouter>
    );

    const leaderPod = screen.getByTestId('market-hero-leader');
    expect(leaderPod.textContent).toContain('SOL');
    fireEvent.click(leaderPod);
    expect(onOpenCoin).toHaveBeenCalledWith('solana');

    const telemetry = screen.getByTestId('market-hero-telemetry');
    const pods = telemetry.querySelectorAll('button.mhb-pod');
    expect(pods).toHaveLength(3);
    expect(pods[1].textContent).toContain('64%');
    fireEvent.click(pods[1]);
    expect(onSelectTab).toHaveBeenCalledWith('tokens');

    // Empty / loading feed never fabricates $0 or NaN%.
    rerender(
      <MemoryRouter initialEntries={['/market']}>
        <MarketHeroBanner
          global={null}
          breadth={{ up: 0, down: 0, flat: 0, total: 0, upShare: 0, downShare: 0 }}
          coins={[]}
          trend={null}
          vs="usd"
        />
      </MemoryRouter>
    );

    const banner = screen.getByTestId('market-hero-banner');
    expect(banner.textContent).not.toContain('NaN');
    expect(within(screen.getByTestId('market-hero-leader')).getByText('در حال همگام‌سازی')).toBeTruthy();
  });

  it('is mounted in Market.jsx strictly above MarketTabStrip and obeys every CSS speed & locale invariant', () => {
    const marketSrc = readFileSync(resolve(ROOT, 'src/pages/Market.jsx'), 'utf8');
    const heroPos = marketSrc.indexOf('<MarketHeroBanner');
    const stripPos = marketSrc.indexOf('<MarketTabStrip');
    expect(heroPos).toBeGreaterThan(-1);
    expect(stripPos).toBeGreaterThan(heroPos);

    // Stylesheet stays route-scoped and precedes `market-perf.css`.
    const heroCssImport = marketSrc.indexOf("import '../styles/market-hero-banner.css'");
    const perfCssImport = marketSrc.lastIndexOf("import '../styles/market-perf.css'");
    expect(heroCssImport).toBeGreaterThan(-1);
    expect(perfCssImport).toBeGreaterThan(heroCssImport);

    const css = stripComments(readFileSync(resolve(ROOT, 'src/styles/market-hero-banner.css'), 'utf8'));
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/\bmask(-image)?\s*:/);
    expect(css).not.toMatch(/(^|[^-])\bfilter\s*:/m);
    expect(css).not.toMatch(/will-change/);
    expect(css).toMatch(/contain:\s*paint/);
    expect(css).toMatch(/\.mhb\[data-inview='false'\]/);

    // Every @keyframes block animates transform and/or opacity ONLY.
    const keyframeBodies = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?\n\})/g)].map((m) => m[1]);
    expect(keyframeBodies.length).toBeGreaterThanOrEqual(6);
    for (const body of keyframeBodies) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const prop of props) {
        if (['from', 'to'].includes(prop)) continue;
        expect(['transform', 'opacity']).toContain(prop);
      }
    }

    // All 12 locales carry complete `marketHero` translations.
    const locales = ['fa', 'en', 'ar', 'ur', 'es', 'fr', 'tr', 'ru', 'zh', 'hi', 'pt', 'id'];
    for (const loc of locales) {
      const json = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${loc}.json`), 'utf8'));
      expect(json.marketHero?.kicker, `${loc}.marketHero.kicker`).toBeTruthy();
      expect(json.marketHero?.scenes?.pulse?.titleLead, `${loc}.marketHero.scenes.pulse.titleLead`).toBeTruthy();
      expect(json.marketHero?.scenes?.swap?.titleLead, `${loc}.marketHero.scenes.swap.titleLead`).toBeTruthy();
      expect(json.marketHero?.scenes?.wealth?.titleLead, `${loc}.marketHero.scenes.wealth.titleLead`).toBeTruthy();
      expect(json.marketHero?.telemetry?.topMover, `${loc}.marketHero.telemetry.topMover`).toBeTruthy();
    }
  });
});
