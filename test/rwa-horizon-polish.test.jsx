// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { rwaSymbolSvg } from '../src/lib/rwaAssetSvg';
import { iconCandidates } from '../src/lib/tokenIcon';
import TokenIcon from '../src/lib/tokenIcon';
import { RWA_CURATED_TOKENS, canonicalizeRwa } from '../src/lib/rwaTokens';
import OstiumHeroSlider from '../src/components/ostium/OstiumHeroSlider';

afterEach(cleanup);

describe('Real-World Asset Logo & Icon Completeness', () => {
  it('generates high-fidelity vector SVG marks for all curated RWA tokens', () => {
    const requiredSymbols = [
      'USDY', 'USDG', 'PAXG', 'XAUT', 'ONDO', 'MKR', 'CFG',
      'PENDLE', 'MPL', 'CPOOL', 'USYC', 'THBILL', 'VBILL', 'JTRSY',
      'RGTI', 'JOBY', 'SOFI', 'POLYX', 'GFI', 'TRUF', 'FACTR'
    ];

    for (const sym of requiredSymbols) {
      const svg = rwaSymbolSvg(sym);
      expect(svg, `Missing vector SVG for ${sym}`).toBeTruthy();
      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox="0 0 24 24"');
    }
  });

  it('provides verified CDN image or vector fallback for all RWA curated entries', () => {
    for (const raw of RWA_CURATED_TOKENS) {
      const canonical = canonicalizeRwa(raw);
      const candidates = iconCandidates(canonical, canonical.chainId);
      // Either candidate list has https images, or rwaSymbolSvg resolves directly
      const hasImage = candidates.some((c) => c.startsWith('https://'));
      const hasSvg = Boolean(rwaSymbolSvg(canonical.symbol));
      expect(hasImage || hasSvg, `No artwork source found for ${canonical.symbol}`).toBe(true);
    }
  });

  it('renders TokenIcon with image candidate and local SVG on error', () => {
    // When candidates exist, renders img with CDN source
    const { container, rerender } = render(<TokenIcon token={{ symbol: 'PAXG' }} size={40} />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toContain('coingecko.com');

    // Trigger error to advance past candidates list
    fireEvent.error(img);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });
});

describe('Ostium Global Horizon Hero Slider Minimalism', () => {
  it('renders compact hero slider without CTA link buttons or arrow controls', () => {
    const { container } = render(<OstiumHeroSlider feedLive={true} />);

    // Renders the region and slide content
    expect(container.querySelector('.ost-slider')).toBeTruthy();
    expect(container.querySelector('.ost-title')).toBeTruthy();

    // Verifies absence of previous CTA button and arrow navigation controls
    expect(container.querySelector('.ost-cta-btn')).toBeNull();
    expect(container.querySelector('.ost-arrow')).toBeNull();
    expect(container.querySelector('.ost-controls')).toBeNull();

    // Verifies hairline progress segments exist
    expect(container.querySelector('.ost-segments')).toBeTruthy();
  });
});

describe('Robinhood Token Box Glassmorphism and Chart Sizing', () => {
  it('applies glassmorphism backdrop-filter and elevated 54px chart slot', () => {
    const css = readFileSync('src/styles/stock-tokens.css', 'utf8');

    // Glassmorphism properties
    expect(css).toMatch(/backdrop-filter:\s*blur/);
    expect(css).toMatch(/rgba\(255,\s*255,\s*255/);

    // Elevated 54px chart slot for balanced spacing
    expect(css).toMatch(/\.stk-chart-slot\s*\{[^}]*flex:\s*0 0 54px/s);
  });
});
