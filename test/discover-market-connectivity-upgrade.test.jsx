// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';
import Discover from '../src/pages/Discover.jsx';
import CoinLogo from '../src/components/CoinLogo.jsx';
import ConnectivityAlert from '../src/components/ConnectivityAlert.jsx';
import { DISCOVERY_PROTOCOLS, DISCOVERY_CATEGORIES } from '../src/lib/discoveryRegistry.js';
import { discoveryProtocolSvg } from '../src/lib/discoveryLogos.js';
import { descriptionFor } from '../src/lib/discoveryLocalized.js';

vi.mock('../src/lib/apiBase', () => ({ apiBase: () => '/api' }));

const i18n = i18next.createInstance();

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: {
      fa: { translation: fa },
      en: { translation: en }
    },
    lng: 'fa',
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  });
});

afterEach(() => {
  cleanup();
});

describe('Explore › Discover comprehensive redesign & Persian ZWNJ', () => {
  it('fixes stuck Persian plural words across locale and protocol descriptions', () => {
    const stuckPattern = /(شبکهها|پروتکلها|داراییها|دستهبندی|کیفپول|زنجیرهها|توکنها)/;
    expect(JSON.stringify(fa.discover)).not.toMatch(stuckPattern);

    for (const p of DISCOVERY_PROTOCOLS) {
      const desc = descriptionFor(p.id, 'fa');
      expect(desc).not.toMatch(stuckPattern);
    }
  });

  it('supplies offline full-bleed vector SVG brand marks for all 53 protocols', () => {
    expect(DISCOVERY_PROTOCOLS.length).toBeGreaterThanOrEqual(53);
    for (const p of DISCOVERY_PROTOCOLS) {
      const svg = discoveryProtocolSvg(p.id);
      expect(svg, `missing brand SVG for ${p.id}`).toBeTruthy();
      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox="0 0 24 24"');
    }
  });

  it('keeps category sub-tabs non-sticky with SVG icons, replaces native selects with SVG popovers, and removes X close on protocol detail sheet', async () => {
    await i18n.changeLanguage('fa');
    const { container } = render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <Discover embedded />
        </I18nextProvider>
      </MemoryRouter>
    );

    // 1. Category chips all carry crisp SVG icons
    const catButtons = container.querySelectorAll('.dcx-chips .dcx-chip');
    expect(catButtons.length).toBe(DISCOVERY_CATEGORIES.length);
    catButtons.forEach((btn) => {
      expect(btn.querySelector('.dcx-chip-ico svg')).toBeTruthy();
    });

    // 2. Zero native <select>; 2 aligned custom dropdown triggers inside .dcx-filter-bar
    expect(container.querySelectorAll('select').length).toBe(0);
    const triggers = container.querySelectorAll('.dcx-filter-bar .dcx-dd-trigger');
    expect(triggers.length).toBe(2);

    // Open network popover -> anchored inside .dcx-dd-wrap with SVG icons
    fireEvent.click(triggers[0]);
    const listbox = container.querySelector('.dcx-dd-wrap .dcx-popover[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(listbox.querySelectorAll('[role="option"] svg').length).toBeGreaterThan(5);

    // Close network popover by picking Ethereum
    const ethOption = Array.from(listbox.querySelectorAll('[role="option"]')).find((el) =>
      el.textContent.includes('اتریوم')
    );
    expect(ethOption).toBeTruthy();
    fireEvent.click(ethOption);
    expect(container.querySelector('.dcx-popover')).toBeNull();

    // 3. Open first protocol card -> detail sheet has NO .sheet-close (X) and HAS compact .dcx-sheet-fav star
    const firstCard = container.querySelector('.dcx-card');
    expect(firstCard).toBeTruthy();
    fireEvent.click(firstCard);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('.sheet-close')).toBeNull();
    const sheetFav = dialog.querySelector('button.dcx-fav.dcx-sheet-fav');
    expect(sheetFav).toBeTruthy();
  });

  it('keeps .dcx-toolbar position: relative (never sticky/fixed) and anchors .dcx-popover with position: absolute', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/styles/discovery-center.css'),
      'utf8'
    );
    const toolbarMatch = css.match(/\.dcx-toolbar\s*\{([^}]+)\}/);
    expect(toolbarMatch?.[1]).toContain('position: relative');
    expect(toolbarMatch?.[1]).not.toContain('sticky');

    const popMatch = css.match(/\.dcx-popover\s*\{([^}]+)\}/);
    expect(popMatch?.[1]).toContain('position: absolute');
  });
});

describe('Market Bitcoin hero logo & zero-blackout icon/scroll pipeline', () => {
  it('renders Bitcoin preferVector CoinLogo as an instant full-bleed SVG with zero remote circular PNG', () => {
    const btc = {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      image: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png'
    };
    const { container } = render(<CoinLogo coin={btc} preferVector />);
    expect(container.querySelector('img')).toBeNull();
    const svg = container.querySelector('.coin-logo svg');
    expect(svg).toBeTruthy();
    expect(svg.innerHTML.toLowerCase()).toContain('#f7931a');
  });

  it('renders an instant frame-0 vector underlay while a remote CoinLogo image is still loading', () => {
    const eth = {
      id: 'ethereum',
      symbol: 'eth',
      name: 'Ethereum',
      image: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png'
    };
    const { container } = render(<CoinLogo coin={eth} />);
    expect(container.querySelector('.coin-logo-underlay svg')).toBeTruthy();
    const img = container.querySelector('img.coin-logo-net');
    expect(img).toBeTruthy();

    fireEvent.load(img);
    expect(img.classList.contains('is-loaded')).toBe(true);
    expect(container.querySelector('.coin-logo-underlay')).toBeNull();
  });

  it('replaces circular 50% hero orbit with concentric squircle and disables blurred GPU scroll traps', () => {
    const marketCss = fs.readFileSync(
      path.resolve(process.cwd(), 'src/styles/market-modern.css'),
      'utf8'
    );
    const indexCss = fs.readFileSync(
      path.resolve(process.cwd(), 'src/index.css'),
      'utf8'
    );
    expect(marketCss).toContain('.market-hero-logo-halo');
    expect(marketCss).toContain('background: #f7931a');
    expect(marketCss).toContain('.market-hero-orbit--rev {\n  display: none !important;');
    expect(indexCss).toMatch(/\.rgb-still\s+\.rgb-orb\s*\{[^}]*filter:\s*none/);
  });
});

describe('Modernized ConnectivityAlert telemetry popup', () => {
  it('renders concentric radar, signal strength bars (0 offline vs 1 weak), and dismisses on Escape', async () => {
    await i18n.changeLanguage('fa');
    const prevOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

    try {
      render(
        <I18nextProvider i18n={i18n}>
          <ConnectivityAlert />
        </I18nextProvider>
      );

      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.classList.contains('connectivity-alert-card')).toBe(true);
      expect(dialog.querySelector('.connectivity-alert-radar svg')).toBeTruthy();
      expect(dialog.querySelectorAll('.connectivity-alert-bars i.is-lit').length).toBe(0);

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    } finally {
      if (prevOnline) Object.defineProperty(window.navigator, 'onLine', prevOnline);
      else delete window.navigator.onLine;
    }
  });
});
