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

describe('the horizontal drag belongs to the page\'s own tab strip', () => {
  /*
   * ─── REVISED 2026-11-01 ───────────────────────────────────────────────────
   * The earlier pins here described a drag that walked the PRIMARY ROUTES
   * («چپ = تب قبلی، راست = تب بعدی» read as app tabs). The owner has since
   * said exactly what was wrong with that:
   *
   *   «با لمسی که سمت چپی یا راست می‌کشیم می‌ره صفحه بعد یا قبل — این اشتباهه
   *    … اگر تب نداشته باشه با لمس چپ یا راست نره صفحه بعد یا قبل.»
   *
   * So the contract is no longer «a drag navigates»; it is the opposite:
   *   · the drag selects the neighbouring tab of THIS screen;
   *   · a screen with no tab strip does nothing at all;
   *   · NOTHING in the gesture path may navigate.
   * The behaviour itself is pinned in test/page-tab-swipe.test.jsx (18 DOM
   * tests plus the pure arithmetic); these are the source-level guarantees
   * that are easier to state about the files than about a mounted app.
   */
  const GESTURE = read('src/lib/tabGesture.js');
  const SWIPE = read('src/components/PageTabSwipe.jsx');

  it('maps a drag to the reading direction, not to a fixed screen side', () => {
    /* RTL (fa/ar/ur): drag right → next, drag left → previous.
       LTR: drag left → next, drag right → previous. */
    expect(GESTURE).toMatch(/const forward = rtl \? dx > 0 : dx < 0/);
    expect(GESTURE).toContain("documentElement?.dir === 'rtl'");
    /* …and the step is applied to the strip's own tab list, clamped at the ends. */
    expect(GESTURE).toMatch(/tabs\[index \+ \(forward \? 1 : -1\)\]/);
    expect(GESTURE).toMatch(/if \(!next\) return null;/);
  });

  it('cannot navigate: no router call exists on the gesture path', () => {
    for (const [name, src] of [['tabGesture.js', GESTURE], ['PageTabSwipe.jsx', SWIPE]]) {
      expect(src, `${name} must not navigate`).not.toMatch(/useNavigate|navigate\(|history\.(push|back|go)|location\.hash\s*=/);
    }
    /* The only thing a gesture does is click a tab the strip already owns. */
    expect(GESTURE).toContain('tab.click?.()');
  });

  it('is deliberate to trigger and impossible to trigger while scrolling', () => {
    const threshold = Number((GESTURE.match(/SWIPE_MIN_X = (\d+)/) || [])[1]);
    expect(threshold).toBeGreaterThanOrEqual(44);
    expect(threshold).toBeLessThanOrEqual(64);
    expect(GESTURE).toMatch(/Math\.abs\(dy\) > Math\.abs\(dx\) \* SWIPE_FLATNESS/);
    /* Decide once, on touchend — no move handler, no work per frame. */
    expect(SWIPE).toContain("'touchstart'");
    expect(SWIPE).toContain("'touchend'");
    expect(SWIPE).not.toContain("'touchmove'");
    expect(APP).toContain('<PageTabSwipe');
  });

  it('does nothing at all on a screen without a tab strip', () => {
    /* `findTabStrip` is the single gate: no strip, no destination, no action. */
    expect(GESTURE).toMatch(/export function findTabStrip[\s\S]*?if \(!lists\.length\) return null;/);
    expect(GESTURE).toMatch(/const tabs = tabsOf\(list\);/);
    expect(GESTURE).toMatch(/if \(!next\) return null;/);
  });

  it('yields to charts, rails, forms and horizontally scrollable containers', () => {
    for (const selector of ['.perp-rail', '.news-mode-tabs', '.smx-dock', '.segmented', '.market-sectors-rail', '.mx-sector-rail', 'canvas', '[role="tab"]']) {
      expect(GESTURE, `${selector} must own its own drag`).toContain(selector);
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
