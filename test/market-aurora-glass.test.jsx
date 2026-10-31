// @vitest-environment jsdom
/**
 * MARKET AURORA GLASS — «باکس‌ها شیشه‌ای‌تر و مدرن‌تر».
 * ---------------------------------------------------------------------------
 * The pass this file pins is a MATERIAL pass, so the checks are about the
 * material and about the two things a material can quietly break:
 *
 *   1. the readings are untouched — the trio is still three boxes with the
 *      feed's numbers, and the new light layers are all decoration;
 *   2. the glass is still PAINTED — no backdrop-filter, no mask, no filter, no
 *      will-change, and every keyframe moves transform/opacity only;
 *   3. the light has a stop policy — reduced motion, the native shell, lite
 *      mode and the explicit data-reduce-motion switch all park the loops;
 *   4. the pearl theme is re-graded rather than inverted;
 *   5. the sheet is the LAST layer of the route, and it stays on the route
 *      (never the entry chunk).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import fa from '../src/i18n/locales/fa.json';

const dict = { fa };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (key, opts = {}) => {
  const v = get(dict.fa, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor, i18n: { language: 'fa', resolvedLanguage: 'fa', changeLanguage: () => {} } })
}));

import MarketOverview from '../src/components/market/MarketOverview.jsx';

const css = readFileSync('src/styles/market-aurora-glass.css', 'utf8');
/* Comments explain the rule; only declarations can break it. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const pageSrc = readFileSync('src/pages/Market.jsx', 'utf8');

const BTC = {
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 92450, change24h: 2.41,
  volume: 3.9e10, mcap: 1.83e12, high24h: 93200, low24h: 89500, sparkline: [89500, 90200, 91400, 92450], rank: 1
};
const GLOBAL = {
  mcap: 3.15e12, volume: 1.4e11, btcDominance: 56.4, ethDominance: 13.8,
  coins: 14820, markets: 1124, mcapChange: 2.84, avgChange: 2.35
};
const TREND = { points: [1, 2, 3, 4, 5], changePct: 2.84, days: 7, coins: 60 };

afterEach(cleanup);

const overview = (bitcoin = BTC, liveAvgChange = 2.35) => render(
  <MemoryRouter>
    <MarketOverview
      global={GLOBAL}
      bitcoin={bitcoin}
      trend={TREND}
      liveAvgChange={liveAvgChange}
      loading={false}
      vs="usd"
      onOpenCoin={() => {}}
    />
  </MemoryRouter>
);

/* ── 1 · THE TRIO: same three readings, now with light behind them ───────── */
describe('۱ · سه باکس، همان سه خوانش، با نورِ تازه', () => {
  it('gives every box its own aura, out of the reading and out of focus order', () => {
    overview();
    const boxes = [...screen.getByTestId('market-trio').querySelectorAll('.mx-trio-box')];
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      const aura = box.querySelector('.mx-trio-aura');
      expect(aura, `${box.dataset.testid} aura`).toBeTruthy();
      expect(aura.getAttribute('aria-hidden')).toBe('true');
      expect(aura.querySelectorAll('i')).toHaveLength(2);
      /* the reading is still the only text in the box, and the aura adds none */
      expect(aura.textContent).toBe('');
      expect(box.querySelector('.mx-trio-mark svg')).toBeTruthy();
    }
    /* still the same three readings, in the same order */
    expect(boxes[0].textContent).toContain(fa.marketIntel.statCoins);
    expect(boxes[1].textContent).toContain(fa.marketIntel.statMarkets);
    expect(boxes[2].textContent).toContain(fa.marketIntel.statAvg);
    expect(boxes[0].textContent).toContain('14,820');
    expect(boxes[2].textContent).toContain('%');
  });

  it('keeps the aura behind the reading, inside its own frame', () => {
    expect(bare).toMatch(/\.mx-trio-aura \{[^}]*position: absolute[^}]*z-index: 0/s);
    expect(bare).toMatch(/\.mx-trio-mark,\s*\.mx-trio-text \{ position: relative; z-index: 1; \}/);
    expect(bare).toMatch(/\.mx-trio-aura \{[^}]*border-radius: inherit[^}]*pointer-events: none/s);
    /* one row of three equal columns survives this pass — it only re-dresses it */
    expect(bare).not.toMatch(/grid-template-columns/);
    const intelligence = readFileSync('src/styles/market-intelligence.css', 'utf8');
    expect(intelligence).toMatch(/\.mx-trio \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 10px; \}/);
  });
});

/* ── 2 · THE GLASS IS PAINTED, NEVER READ BACK ───────────────────────────── */
describe('۲ · شیشه رنگ می‌شود، از صفحه خوانده نمی‌شود', () => {
  it('uses no live blur, no mask, no filter and no promotion hint', () => {
    expect(bare).not.toMatch(/backdrop-filter/);
    expect(bare).not.toMatch(/mask(-image)?:/);
    expect(bare).not.toMatch(/(^|[^-])filter:/);
    expect(bare).not.toMatch(/will-change/);
  });

  it('builds every box from the same four painted layers', () => {
    /* the tokens: a translucent shell, one glaze, one frost, one bevel */
    expect(bare).toMatch(/--ag-shell-a: rgba\(11, 32, 50, \.92\)/);
    expect(bare).toMatch(/--ag-glaze: linear-gradient\(152deg/);
    expect(bare).toMatch(/--ag-stria: repeating-linear-gradient\(118deg/);
    /* the deck's interior is still ONE token, so its travelling rim copies it */
    expect(bare).toMatch(/\.mx-market \.mx-deck \{\s*--mx-deck-interior:[\s\S]*?var\(--ag-glaze\) padding-box,[\s\S]*?var\(--ag-stria\) padding-box,[\s\S]*?\) padding-box;\s*--mx-deck-rim-a/);
    /* …and the Bitcoin card keeps its own, in three directions */
    for (const rule of [
      /\.mx-market \.mx-btc-card \{\s*--mx-btc-interior:[\s\S]*?var\(--ag-stria\) padding-box/,
      /\.mx-market \.mx-btc-card\[data-dir='up'\] \{\s*--mx-btc-interior:[\s\S]*?var\(--ag-stria\) padding-box/,
      /\.mx-market \.mx-btc-card\[data-dir='down'\] \{\s*--mx-btc-interior:[\s\S]*?var\(--ag-stria\) padding-box/
    ]) expect(bare).toMatch(rule);
  });

  it('gives the feed boxes, the discovery cards and the rows the same material', () => {
    for (const selector of ['.mx-lens', '.mx-terminal', '.mx-search', '.mx-hot-card', '.coin-row']) {
      expect(bare).toContain(selector);
    }
    expect(bare).toMatch(/\.mx-market \.mx-lens \{[^}]*padding-box[^}]*border-box/s);
    expect(bare).toMatch(/\.mx-market \.mx-terminal \{[^}]*padding-box[^}]*border-box/s);
    expect(bare).toMatch(/\.mx-market \.mx-hot-card \{[^}]*colormix|\.mx-market \.mx-hot-card \{[^}]*color-mix/s);
    /* the row card is re-dressed; the slot around it stays bare */
    expect(bare).toMatch(/\.mx-market \.mx-coin-row > \.coin-row \{/);
    expect(bare).not.toMatch(/\.mx-market \.mx-coin-row \{[^}]*background/);
  });
});

/* ── 3 · THE STAGE: light behind the showcase, not a panel around it ─────── */
describe('۳ · نورِ پشت ویترین', () => {
  it('paints the stage on the overview itself and keeps it out of the grid', () => {
    expect(bare).toMatch(/\.mx-market \.mx-overview \{\s*position: relative;\s*isolation: isolate;\s*\}/);
    expect(bare).toMatch(/\.mx-market \.mx-overview::before \{[^}]*position: absolute[^}]*z-index: 0/s);
    /* no border and no radius-as-a-box: it is light, not another card */
    const stage = /\.mx-market \.mx-overview::before \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(stage).not.toMatch(/border:/);
    expect(stage).toMatch(/background: var\(--ag-stage\)/);
    /* the boxes sit above it */
    expect(bare).toMatch(/\.mx-market \.mx-overview > \* \{ position: relative; z-index: 1; \}/);
  });

  it('moves the stage and the auras on the compositor only', () => {
    expect(bare).toMatch(/animation: ag-stage-drift 26s ease-in-out infinite alternate/);
    expect(bare).toMatch(/animation: ag-aura-drift 18s ease-in-out infinite alternate/);
    expect(bare).toMatch(/\.mx-trio-box:nth-child\(2\) \.mx-trio-aura i:first-child \{ animation-duration: 21s; \}/);
    expect(bare).toMatch(/\.mx-trio-box:nth-child\(3\) \.mx-trio-aura i:first-child \{ animation-duration: 24s; \}/);

    /* brace-matched scan of every keyframe this sheet ships */
    const frames = [];
    for (const m of bare.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < bare.length && depth > 0) {
        if (bare[i] === '{') depth += 1;
        else if (bare[i] === '}') depth -= 1;
        i += 1;
      }
      frames.push([m[1], bare.slice(start, i - 1)]);
    }
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const [name, body] of frames) {
      const props = new Set([...body.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map((x) => x[1]));
      const legal = ['transform', 'opacity', 'scale', 'translate', 'rotate'];
      expect([...props].filter((prop) => !legal.includes(prop)), name).toEqual([]);
    }
  });
});

/* ── 4 · INTERACTION — a lift only where a pointer exists ────────────────── */
describe('۴ · لمس و ماوس', () => {
  it('lifts a discovery card on hover, and only under a hover-capable pointer', () => {
    expect(bare).toMatch(/@media \(hover: hover\) \{\s*\.mx-market \.mx-hot-card:hover \{ transform: translateY\(-3px\); \}/);
    expect(bare).toMatch(/@media \(hover: none\) \{\s*\.mx-market \.mx-hot-card:hover \{ transform: none; \}/);
    /* the reading boxes are not controls: they glow, they never pretend to tap */
    expect(bare).not.toMatch(/\.mx-trio-box \{ cursor/);
    expect(bare).not.toMatch(/\.mx-trio-box:hover \{[^}]*transform/);
  });
});

/* ── 5 · THE STOP POLICY ─────────────────────────────────────────────────── */
describe('۵ · توقف حرکت', () => {
  it('parks the stage and the auras for reduced motion, native, lite and the switch', () => {
    const guard = bare.slice(bare.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(guard).toMatch(/\.mx-market \.mx-overview::before,\s*\.mx-market \.mx-trio-aura i \{ animation: none !important; \}/);
    expect(guard).toMatch(/\.mx-market \.mx-hot-card:hover \{ transform: none; \}/);
    for (const flag of ['native', 'lite', 'reduce-motion']) {
      expect(bare).toContain(`:root[data-${flag}='true'] .mx-market .mx-overview::before`);
      expect(bare).toContain(`:root[data-${flag}='true'] .mx-market .mx-trio-aura i`);
    }
    /* native/lite freeze the light — they never erase the design */
    expect(bare).toMatch(/:root\[data-native='true'\][\s\S]*?opacity: \.85;/);
    const lite = bare.slice(bare.indexOf(":root[data-lite='true'] .mx-market .mx-trio-aura"));
    expect(lite).toMatch(/\.mx-market \.mx-trio-aura \{ display: none; \}/);
  });
});

/* ── 6 · THE PEARL THEME ─────────────────────────────────────────────────── */
describe('۶ · تم مرواریدی', () => {
  it('re-grades the tokens and every box instead of inverting the dark ones', () => {
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \{\s*--ag-aqua-rgb: 26, 156, 160;/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \{[\s\S]*?--ag-shell-a: rgba\(255, 255, 255, \.90\)/);
    for (const selector of ['.mx-deck', '.mx-metric', '.mx-trio-box', '.mx-btc-card', '.mx-lens', '.mx-terminal', '.mx-search', '.mx-hot-card', '.coin-row']) {
      expect(bare).toContain(`:root[data-theme='light']`);
      expect(bare).toMatch(new RegExp(`:root\\[data-theme='light'\\] [^{]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
    /* the dark glass never leaks into the pearl theme */
    const lightDeck = /:root\[data-theme='light'\] \.mx-market \.mx-deck \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(lightDeck).toMatch(/linear-gradient\(#fff, #fff\) padding-box/);
    expect(lightDeck).not.toMatch(/--ag-shell-a\)/);
  });
});

/* ── 7 · IT IS THE LAST LAYER, AND ONLY ON THIS ROUTE ────────────────────── */
describe('۷ · ترتیب لایه و بودجهٔ ورودی', () => {
  it('is imported after the three existing sheet layers, by the market page', () => {
    const order = ['market-modern.css', 'market-intelligence.css', 'market-glass-v3.css', 'market-aurora-glass.css']
      .map((sheet) => pageSrc.indexOf(`styles/${sheet}`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    /* and the entry stylesheet never pulls it in */
    const entry = readFileSync('src/index.css', 'utf8');
    expect(entry).not.toContain('market-aurora-glass');
  });

  it('stays inside the market scope: nothing it adds escapes .mx-market', () => {
    /* every top-level selector in the new layer either starts at .mx-market /
       .mx-trio (a child of it) or is a :root theme/stop flag scoped to it */
    for (const line of bare.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.endsWith('{') || trimmed.startsWith('@')) continue;
      const selectors = trimmed.slice(0, -1).split(',').map((s) => s.trim());
      for (const selector of selectors) {
        expect(
          /(^|[\s>])(\.mx-market|\.mx-trio|\.mx-trio-aura|\.mx-trio-box|\.mx-trio-mark|\.mx-trio-text|\.mx-stories)/.test(selector),
          selector
        ).toBe(true);
      }
    }
  });
});
