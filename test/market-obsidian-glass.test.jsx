// @vitest-environment jsdom
/**
 * MARKET OBSIDIAN GLASS — «شیشه‌ای‌تر، پشت‌زمینهٔ خاص، حرفه‌ای‌ترین صفحه».
 * ---------------------------------------------------------------------------
 * This pass changes the MATERIAL and the ROOM, so the checks are about the
 * three things a material change can quietly break:
 *
 *   1. the room is painted, never read back — no blur, no mask, no filter, no
 *      will-change, and every keyframe moves transform/opacity only;
 *   2. the glass is ONE recipe with ONE source of truth per card, and the
 *      travelling-rim replica still copies the deck's interior token;
 *   3. the hand — hover only where a pointer exists, press feedback, real
 *      focus, 44px touch targets, and a stop policy for every preference the
 *      platform can report (motion, native, lite, transparency, contrast).
 *
 * It also pins the two things a heavy visual pass is most likely to ruin: the
 * readings (unchanged numbers, unchanged decorations) and light mode (re-graded
 * with pearl tokens instead of the dark glass leaking through).
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

const css = readFileSync('src/styles/market-obsidian-glass.css', 'utf8');
/* Comments explain the rule; only declarations can break it. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const pageSrc = readFileSync('src/pages/Market.jsx', 'utf8');

const BTC = {
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 92450, change24h: 2.41,
  volume: 3.9e10, mcap: 1.83e12, high24h: 93200, low24h: 89500,
  sparkline: [89500, 90200, 91400, 92450], rank: 1
};
const GLOBAL = {
  mcap: 3.152e12, volume: 1.42e11, btcDominance: 56.4, ethDominance: 13.8,
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

/* ── 1 · THE ROOM ─────────────────────────────────────────────────────────── */
describe('۱ · اتاقِ بازار — پشت‌زمینهٔ خاص، رنگ‌شده نه خوانده‌شده', () => {
  it('paints a vault, a measuring grid and a drifting ceiling behind the page', () => {
    /* the page itself is a window, not a flat fill */
    expect(bare).toMatch(/\.mx-market \{[^}]*position: relative;[^}]*isolation: isolate;[^}]*background:/s);
    /* the grid: two repeating gradients, absolutely placed, behind the content */
    expect(bare).toMatch(/\.mx-market::before \{[^}]*position: absolute;[^}]*z-index: -1;[^}]*pointer-events: none;[^}]*repeating-linear-gradient\(90deg/s);
    expect(bare).toMatch(/\.mx-market::before \{[^}]*repeating-linear-gradient\(0deg/s);
    /* the ceiling: one wide cold light and one warm one */
    expect(bare).toMatch(/\.mx-market::after \{[^}]*position: absolute;[^}]*z-index: -1;[^}]*var\(--og-ceiling\)/s);
    expect(bare).toMatch(/\.mx-market::after \{[^}]*var\(--og-ceiling-warm\)/s);
    /* it drifts on a long alternate cycle, on the compositor */
    expect(bare).toMatch(/animation: og-ceiling-drift 32s ease-in-out infinite alternate/);
  });

  it('keeps the room out of layout and out of the reading order', () => {
    for (const pseudo of ['.mx-market::before', '.mx-market::after']) {
      const block = new RegExp(`${pseudo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([\\s\\S]*?)\\n\\}`).exec(bare)[1];
      expect(block, pseudo).toMatch(/position: absolute/);
      expect(block, pseudo).toMatch(/z-index: -1/);
      expect(block, pseudo).toMatch(/pointer-events: none/);
      expect(block, pseudo).not.toMatch(/content: '(?!')/);
    }
  });
});

/* ── 2 · THE GLASS ────────────────────────────────────────────────────────── */
describe('۲ · بدنهٔ شیشه — یک دستور، یک منبع حقیقت', () => {
  it('defines the shell, the glaze, the frost, the grain and the prism rim as tokens', () => {
    expect(bare).toMatch(/--og-shell-a: rgba\(12, 25, 43, \.91\)/);
    expect(bare).toMatch(/--og-shell-b: rgba\(8, 17, 33, \.94\)/);
    expect(bare).toMatch(/--og-glaze: linear-gradient\(154deg/);
    expect(bare).toMatch(/--og-stria: repeating-linear-gradient\(124deg/);
    /* photographic grain, drawn once by feTurbulence and repeated by the painter */
    expect(bare).toMatch(/--og-grain: url\("data:image\/svg\+xml,[^"]*feTurbulence/);
    /* the rim is a CONIC gradient: the hue walks around the frame */
    expect(bare).toMatch(/--og-prism: conic-gradient\(from 212deg/);
    expect(bare).toMatch(/--og-prism-warm: conic-gradient\(from 248deg/);
  });

  it('applies one nine-layer recipe to every large surface', () => {
    const group = /\.mx-market \.mx-lens,\n\.mx-market \.mx-terminal,\n\.mx-market \.mx-hot-card,\n\.mx-market \.mx-stories \.market-stories-section,\n\.mx-market \.mx-empty,\n\.mx-market \.mx-skel-row \{([\s\S]*?)\n\}/.exec(bare)[1];
    /* the six painted planes, in writing order */
    expect(group).toMatch(/rgba\(255, 255, 255, \.10\), transparent 62%\) padding-box/);
    expect(group).toMatch(/color-mix\(in srgb, var\(--og-accent\) 26%, transparent\), transparent 64%\) padding-box/);
    expect(group).toMatch(/color-mix\(in srgb, var\(--og-counter\) 22%, transparent\), transparent 66%\) padding-box/);
    expect(group).toMatch(/linear-gradient\(to top, color-mix\(in srgb, var\(--og-accent\) 13%, transparent\)/);
    expect(group).toMatch(/var\(--og-grain\) padding-box/);
    expect(group).toMatch(/var\(--og-stria\) padding-box/);
    expect(group).toMatch(/var\(--og-glaze\) padding-box/);
    expect(group).toMatch(/linear-gradient\(162deg, var\(--og-shell-a\), var\(--og-shell-b\) 54%, var\(--og-shell-c\)\) padding-box/);
    expect(group).toMatch(/var\(--og-prism\) border-box/);
    /* the bevel is three edges, not one border */
    expect(group).toMatch(/var\(--og-bevel-top\)/);
    expect(group).toMatch(/var\(--og-bevel-bottom\)/);
  });

  it('keeps the deck interior in ONE token so the travelling rim still copies it', () => {
    const deck = /\.mx-market \.mx-deck \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(deck).toMatch(/--mx-deck-interior:/);
    expect(deck).toMatch(/var\(--og-grain\) padding-box/);
    expect(deck).toMatch(/\) padding-box;\s*$/m);
    expect(deck).toMatch(/border-width: 1\.5px/);
    expect(deck).toMatch(/background: var\(--mx-deck-interior\), var\(--og-prism\) border-box;/);
    /* the rim in the earlier layer reads that token, so nothing is hand-copied */
    const older = readFileSync('src/styles/market-intelligence.css', 'utf8');
    expect(older).toMatch(/\.mx-market \.mx-deck-rim \{[^}]*background: var\(--mx-deck-interior\), var\(--mx-deck-rim-b\) border-box/s);
  });

  it('re-cuts the Bitcoin card in three directions, each with its own rim', () => {
    const base = /\.mx-market \.mx-btc-card \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(base).toMatch(/--mx-btc-interior:/);
    expect(base).toMatch(/background: var\(--mx-btc-interior\), var\(--og-prism\) border-box;/);
    expect(base).toMatch(/--og-prism: var\(--og-prism-warm\)/);
    for (const dir of ['up', 'down']) {
      const block = new RegExp(`\\.mx-market \\.mx-btc-card\\[data-dir='${dir}'\\] \\{([\\s\\S]*?)\\n\\}`).exec(bare)[1];
      expect(block, dir).toMatch(/--mx-btc-interior:[\s\S]*?var\(--og-grain\) padding-box/);
      expect(block, dir).toMatch(/--og-prism: conic-gradient\(from 248deg/);
    }
  });

  it('lights the three reading boxes with their own accent, inside their own frame', () => {
    expect(bare).toMatch(/\.mx-trio-box \{[^}]*background:/s);
    expect(bare).toMatch(/color-mix\(in srgb, var\(--mx-accent\) 42%, transparent\), transparent 60%\) padding-box/);
    expect(bare).toMatch(/conic-gradient\(from 200deg at 50% 50%,\s*color-mix\(in srgb, var\(--mx-accent\) 92%, transparent\)/);
    expect(bare).toMatch(/\.mx-trio-box \{[^}]*var\(--og-grain\) padding-box/s);
  });

  it('lets the Smart Money blade keep its art and join the family by its frame', () => {
    const smart = /\.mx-market \.mx-smart-banner \{([\s\S]*?)\n\}/.exec(bare)[1];
    /* a padding-box base first — a lone border-box gradient would flood the card */
    expect(smart).toMatch(/padding-box,/);
    expect(smart).toMatch(/var\(--og-prism\) border-box/);
    expect(smart).toMatch(/var\(--og-bevel-top\)/);
  });

  it('paints rows cheaply on purpose: no grain tile per coin', () => {
    const row = /\.mx-market \.mx-coin-row > \.coin-row \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(row).not.toMatch(/--og-grain/);
    expect(row).toMatch(/linear-gradient\(150deg, rgba\(11, 22, 38, \.90\)/);
    expect(row).toMatch(/border-radius: 18px/);
  });
});

/* ── 3 · PAINTED, NEVER READ BACK ─────────────────────────────────────────── */
describe('۳ · رنگ می‌شود، از صفحه خوانده نمی‌شود', () => {
  it('uses no live blur, no mask, no filter and no promotion hint', () => {
    expect(bare).not.toMatch(/backdrop-filter/);
    expect(bare).not.toMatch(/mask(-image)?:/);
    expect(bare).not.toMatch(/(^|[^-])filter:/m);
    expect(bare).not.toMatch(/will-change/);
  });

  it('loads nothing from the network for its material', () => {
    /* every url() in the sheet is an inline data:image tile */
    const urls = [...bare.matchAll(/url\((?:'|")?([^'")]+)/g)].map((m) => m[1])
      /* `url(%23n)` is the filter reference INSIDE the inline SVG tile */
      .filter((url) => !url.startsWith('%23'));
    expect(urls.length).toBe(2);
    for (const url of urls) expect(url.startsWith('data:image/svg+xml,'), url).toBe(true);
    expect(bare).not.toMatch(/url\(['"]?\/(images|static|assets)/);
  });

  it('moves only transform and opacity, in every keyframe it ships', () => {
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
    expect(frames.map(([name]) => name).sort()).toEqual(['og-ceiling-drift', 'og-skel-pulse']);
    for (const [name, body] of frames) {
      const props = new Set([...body.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map((x) => x[1]));
      const legal = ['transform', 'opacity', 'scale', 'translate', 'rotate'];
      expect([...props].filter((prop) => !legal.includes(prop)), name).toEqual([]);
    }
  });
});

/* ── 4 · THE HAND ─────────────────────────────────────────────────────────── */
describe('۴ · دستِ کاربر — لیفت فقط جایی که تپ می‌شود', () => {
  it('lifts only tappable surfaces, and only under a hover-capable pointer', () => {
    const hover = /@media \(hover: hover\) \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(hover).toMatch(/\.mx-market \.mx-hot-card:hover \{ transform: translateY\(-3px\); \}/);
    expect(hover).toMatch(/\.mx-market \.mx-coin-row > \.coin-row:hover \{ transform: translateY\(-1px\); \}/);
    /* the three reading boxes are not controls: they glow, they never move */
    expect(bare).not.toMatch(/\.mx-trio-box:hover \{[^}]*transform/);
    expect(bare).not.toMatch(/\.mx-metric:hover \{[^}]*transform/);
    /* and a touch screen never keeps the lift after a tap */
    const none = /@media \(hover: none\) \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(none).toMatch(/transform: none/);
  });

  it('answers a press, draws a focus ring, and keeps 44px targets on a phone', () => {
    expect(bare).toMatch(/:active \{\s*transform: scale\(\.975\);/);
    expect(bare).toMatch(/focus-visible \{\s*outline: 2px solid color-mix\(in srgb, var\(--mx-cyan\) 90%, #fff\);\s*outline-offset: 3px;/);
    const phone = /@media \(max-width: 619px\) \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(phone).toMatch(/\.mx-market \.mx-view \{ min-height: 44px; \}/);
    expect(phone).toMatch(/\.mx-market \.mx-sector \{ min-height: 44px; \}/);
    expect(phone).toMatch(/\.mx-market \.mx-sort-trigger \{ min-height: 44px; \}/);
  });
});

/* ── 5 · THE STOP POLICY ──────────────────────────────────────────────────── */
describe('۵ · توقف حرکت و شفافیت — برای هر تنظیمی که پلتفرم می‌گوید', () => {
  it('parks the room for reduced motion, native, lite and the explicit switch', () => {
    const guard = bare.slice(bare.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(guard).toMatch(/\.mx-market::after \{ animation: none !important; opacity: 1; \}/);
    for (const flag of ['native', 'lite', 'reduce-motion']) {
      expect(guard).toContain(`:root[data-${flag}='true'] .mx-market::after`);
    }
    /* lite drops the painted extras without touching the panes or the numbers */
    expect(bare).toMatch(/:root\[data-lite='true'\] \.mx-market::before \{ display: none; \}/);
    expect(bare).toMatch(/:root\[data-lite='true'\] \.mx-market \{ --og-grain: none; \}/);
  });

  it('offers a reduced-transparency and a high-contrast variant of the material', () => {
    const transparent = /@media \(prefers-reduced-transparency: reduce\) \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(transparent).toMatch(/--og-shell-a: #0a1626/);
    expect(transparent).toMatch(/:root\[data-theme='light'\] \.mx-market \{[^}]*--og-shell-a: #fff/s);
    const at = bare.indexOf('@media (prefers-contrast: more)');
    expect(at).toBeGreaterThan(-1);
    const block = bare.slice(at);
    expect(block).toMatch(/--og-shell-a: rgba\(6, 12, 22, \.98\)/);
    expect(block).toMatch(/--mx-muted: #cfdaf0/);
  });
});

/* ── 6 · THE PEARL THEME ──────────────────────────────────────────────────── */
describe('۶ · تم مرواریدی — بازدرجه‌بندی، نه معکوس‌کردن', () => {
  it('re-grades every token instead of letting the dark glass leak through', () => {
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \{\s*--og-void: #f4f7fd;/);
    expect(bare).toMatch(/--og-shell-a: rgba\(255, 255, 255, \.93\)/);
    /* the light grain is dark ink, not white frost */
    const lightGrain = /:root\[data-theme='light'\] \.mx-market \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(lightGrain).toMatch(/feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 \.022/);
    /* the deck's light interior ends on pure #fff, so the navy never shows */
    const lightDeck = /:root\[data-theme='light'\] \.mx-market \.mx-deck \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(lightDeck).toMatch(/linear-gradient\(#fff, #fff\) padding-box/);
    expect(lightDeck).not.toMatch(/--og-shell-a\)/);
  });

  it('re-grades every surface the dark pass touched', () => {
    for (const selector of ['.mx-trio-box', '.mx-market .mx-metric', '.mx-market .mx-btc-card',
      '.mx-market .mx-btc-card[data-dir=\'up\']', '.mx-market .mx-btc-card[data-dir=\'down\']',
      '.mx-market .mx-search', '.mx-market .mx-sort-trigger', '.mx-market .mx-sort-popover',
      '.mx-market .mx-search-popup', '.mx-market .mx-coin-row > .coin-row', '.mx-market .mx-swap-btn',
      '.mx-market .mx-smart-banner']) {
      const needle = `:root[data-theme='light'] ${selector}`;
      expect(bare, needle).toContain(needle);
    }
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market :is\(\.mx-lens, \.mx-terminal, \.mx-hot-card, \.mx-empty, \.mx-skel-row, \.mx-stories \.market-stories-section\)/);
  });
});

/* ── 7 · IT IS THE LAST LAYER, AND ONLY ON THIS ROUTE ─────────────────────── */
describe('۷ · ترتیب لایه و دامنه', () => {
  it('is imported after the four existing sheets, by the market page alone', () => {
    const order = ['market-modern.css', 'market-intelligence.css', 'market-glass-v3.css', 'market-aurora-glass.css', 'market-obsidian-glass.css']
      .map((sheet) => pageSrc.indexOf(`styles/${sheet}`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const entry = readFileSync('src/index.css', 'utf8');
    expect(entry).not.toContain('market-obsidian-glass');
  });

  it('stays inside the market scope: nothing it adds escapes .mx-market', () => {
    /* Selector lists here wrap across lines inside :is(...), so the scan is
       structural: every rule prelude, split on the commas that are OUTSIDE
       parentheses. A keyframe stop or an at-rule is not a selector. */
    const splitTop = (prelude) => {
      const out = [];
      let depth = 0;
      let current = '';
      for (const ch of prelude) {
        if (ch === '(' || ch === '[') depth += 1;
        if (ch === ')' || ch === ']') depth -= 1;
        if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; continue; }
        current += ch;
      }
      out.push(current.trim());
      return out.filter(Boolean);
    };
    let seen = 0;
    for (const m of bare.matchAll(/([^{}]+)\{/g)) {
      const prelude = m[1].trim().replace(/\s+/g, ' ');
      if (!prelude || prelude.startsWith('@')) continue;
      /* 0%, 100% / from / to belong to @keyframes, not to the page */
      if (/^(from|to|\d)/.test(prelude)) continue;
      for (const selector of splitTop(prelude)) {
        seen += 1;
        expect(
          /(^|[\s>])(\.mx-market|\.mx-trio)/.test(selector),
          selector
        ).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(40);
  });
});

/* ── 8 · THE READINGS ARE UNTOUCHED ───────────────────────────────────────── */
describe('۸ · خوانش‌ها دست‌نخورده', () => {
  it('renders the same deck, the same three readings and the same Bitcoin card', () => {
    overview();
    const deck = screen.getByTestId('market-global-card');
    const boxes = [...screen.getByTestId('market-trio').querySelectorAll('.mx-trio-box')];
    expect(boxes).toHaveLength(3);
    expect(boxes[0].textContent).toContain(fa.marketIntel.statCoins);
    expect(boxes[0].textContent).toContain('14,820');
    expect(boxes[1].textContent).toContain('1,124');
    expect(boxes[2].textContent).toContain('%');
    expect(screen.getByTestId('market-btc-hero-card')).toBeTruthy();
    /* the light never carries a number: every decorative layer is aria-hidden */
    for (const selector of ['.mx-deck-rim', '.mx-deck-veil', '.mx-deck-matrix', '.mx-deck-orbit', '.mx-deck-sheen', '.mx-deck-gloss']) {
      const node = deck.querySelector(selector);
      expect(node, selector).toBeTruthy();
      expect(node.getAttribute('aria-hidden'), selector).toBe('true');
    }
    /* and the material pass adds no element of its own */
    expect(deck.querySelectorAll('[data-obsidian]')).toHaveLength(0);
  });

  it('prints «—» rather than a zero when a reading is absent', () => {
    overview({ ...BTC, price: null, change24h: null, volume: null, mcap: null }, null);
    const boxes = [...screen.getByTestId('market-trio').querySelectorAll('.mx-trio-box')];
    expect(boxes[2].textContent).toContain('—');
  });
});
