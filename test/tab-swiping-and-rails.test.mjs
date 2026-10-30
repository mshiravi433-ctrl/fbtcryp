/**
 * TAB SWIPING + TAB RAILS — source pins for the 2026-10-30 pass
 * ---------------------------------------------------------------------------
 * Two of the owner's notes are about the same thing from opposite ends:
 *
 *   2) «با کشیدن لمسی صفحه به چپ و راست به تب‌های دیگر برو — چپ = تب قبلی،
 *      راست = تب بعدی.»
 *   3) / 7) «انتخاب تب‌ها خیلی بهم نزدیکه؛ فاصله را درست کن و افقی و ریلی
 *      باشند.»
 *
 * The gesture lives in App.jsx and the rails live in three stylesheets; none of
 * them is reachable from a DOM test without mounting the whole app. These pins
 * are therefore source-level, and they are deliberately about the CONTRACT
 * (direction mapping, thresholds, which containers own their own drags, and
 * that each rail really scrolls with a real gap) rather than about exact
 * pixels, so a future restyle can move the numbers without lying to the user.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');

const APP = read('src/App.jsx');
const INDEX = read('src/index.css');
const PERP = read('src/styles/perp-modern.css');
const SMART = read('src/styles/smart-money.css');
const NEWS = read('src/styles/news-modern.css');

/** Last occurrence of a rule block, which is the one that wins the cascade. */
function lastRule(css, selector) {
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[\\s\\S]*?\\n\\}`, 'g');
  const all = [...css.matchAll(re)];
  return all.length ? all[all.length - 1][0] : '';
}

describe('swipe between primary tabs', () => {
  it('maps a drag to the reading direction, not to a fixed screen side', () => {
    /* RTL (fa/ar/ur): drag right → next, drag left → previous.
       LTR: drag left → next, drag right → previous. */
    expect(APP).toMatch(/const\s+forward\s*=\s*rtl\s*\?\s*dx\s*>\s*0\s*:\s*dx\s*<\s*0/);
    expect(APP).toMatch(/document\.documentElement\.dir\s*===\s*'rtl'/);
    /* …and the step is applied to the ordered tab list, clamped at the ends. */
    expect(APP).toMatch(/index\s*\+\s*\(forward\s*\?\s*1\s*:\s*-1\)/);
    expect(APP).toMatch(/Math\.max\(0,\s*Math\.min\(PRIMARY_SWIPE_TABS\.length\s*-\s*1/);
  });

  it('is deliberate to trigger and impossible to trigger while scrolling', () => {
    const threshold = Number((APP.match(/Math\.abs\(dx\)\s*<\s*(\d+)/) || [])[1]);
    expect(threshold).toBeGreaterThanOrEqual(44);
    expect(threshold).toBeLessThanOrEqual(64);
    /* A mostly-vertical drag is a scroll, never navigation. */
    expect(APP).toMatch(/Math\.abs\(dy\)\s*>\s*Math\.abs\(dx\)\s*\*/);
    /* Decide once, on touchend — no touchmove listener, no work per frame. */
    expect(APP).toContain('onTouchStart');
    expect(APP).toContain('onTouchEnd');
    expect(APP).not.toContain('onTouchMove');
  });

  it('yields to charts, rails, forms and horizontally scrollable containers', () => {
    for (const selector of ['.perp-rail', '.news-mode-tabs', '.smx-dock', '.segmented', '.market-sectors-rail', 'canvas', '[role="tab"]']) {
      expect(APP, `${selector} must own its own drag`).toContain(selector);
    }
    /* The zone keeps vertical scrolling native. */
    const zone = lastRule(INDEX, '.app-tab-swipe-zone');
    expect(zone).toContain('touch-action: pan-y');
  });
});

describe('tab rails have room', () => {
  const rails = [
    { name: 'futures venue rail', css: PERP, selector: '.perp-rail', minWidth: 88 },
    { name: 'smart-money dock', css: SMART, selector: '.smx-dock', minWidth: 80 },
    { name: 'news mode tabs', css: NEWS, selector: '.news-page .news-mode-tabs.segmented', minWidth: 80 }
  ];

  for (const rail of rails) {
    it(`${rail.name} scrolls horizontally with a real gap`, () => {
      const block = lastRule(rail.css, rail.selector);
      expect(block, `${rail.selector} must have a base rule`).not.toBe('');
      expect(block).toContain('gap:');
      const gap = Number((block.match(/gap:\s*(\d+)px/) || [])[1]);
      expect(gap, 'adjacent targets need visible space').toBeGreaterThanOrEqual(6);

      /* Scrolling is declared on the rail itself… */
      const scrolls = `${block}${rail.css.replace(/\s+/g, ' ')}`;
      expect(scrolls).toMatch(/overflow-x:\s*auto|flex-basis: \d+px|min-width: \d+px/);
    });
  }

  it('never lets a tab collapse below a readable tap target', () => {
    const perp = lastRule(PERP, '.perp-rail-tab');
    expect(perp).toMatch(/min-width:\s*(8[89]|9\d|1\d\d)px/);
    const dock = lastRule(SMART, '.smx-dock-btn');
    expect(dock).toMatch(/min-width:\s*(8[0-9]|9\d|1\d\d)px/);
  });

  it('hides the scrollbar without hiding the content', () => {
    for (const css of [PERP, SMART, NEWS]) {
      expect(css).toContain('scrollbar-width: none');
    }
    /* Scroll-snap so a flick settles on a destination, not mid-label. */
    expect(PERP).toContain('scroll-snap-type');
    expect(SMART).toContain('scroll-snap-type');
  });
});
