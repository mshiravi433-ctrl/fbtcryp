// @vitest-environment jsdom
/**
 * «همهٔ جدول‌ها و باکس‌ها فشرده‌اند — از دو طرف چپ و راست کمی صفحه را عریض‌تر کن»
 * (2026-09-23, about the derivatives tab of the stocks page).
 *
 * Two separate things were squeezing that board, and only one of them is a
 * width:
 *
 *   1. A NESTED `.page`. Stocks is already a `.page` (16px of side padding) and
 *      it hosted Ostium and the derivatives hall WITHOUT `embedded`, so each of
 *      them built a second `.page` inside it: 32px in from every edge of a
 *      390px phone, plus the nested `motion` wrapper PageTransition's own
 *      comment warns about (two enter animations, and a transformed ancestor
 *      that becomes the containing block for every fixed descendant).
 *   2. A FIXED COLUMN. From 600px up `.app-shell` caps at 600/680/760px — right
 *      for a single file of rows, wrong for a board of five measured columns, a
 *      depth chart and an order book. The hall now asks for ~48px more of it
 *      while it is on screen, via `body.hall-wide`.
 *
 * Pinned here: the geometry (one page box, not two), the contract between the
 * two stylesheets (the hall's column is WIDER than the app's at every
 * breakpoint, never narrower — an unpinned pair of numbers in two files is how
 * a page ends up 48px narrower than intended after a refactor), and the class's
 * lifecycle (given back on unmount, so no other page inherits the width).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

/* The board's data is not what is under test, and neither module may reach the
   network from a unit test. */
vi.mock('../src/lib/dydx', () => ({
  getDydxMarkets: async () => ({ markets: [], unavailable: false }),
  getDydxOrderbook: async () => null
}));
vi.mock('../src/hooks/useMarket', () => ({ useMarkets: () => ({ data: [] }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en' } })
}));

const loadHall = async () => (await import('../src/pages/DerivativesDashboard.jsx')).default;

/** The hall calls useNavigate(), so it must be mounted inside a router. */
const within = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

/** Every `max-width` a selector is given, in the order the sheet declares it,
    with the media range each one sits in. */
function widthsFor(css, selector) {
  const out = [];
  const rule = new RegExp(`([^{}]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{}]*)\\{([^}]*)\\}`, 'g');
  for (const match of css.matchAll(rule)) {
    const [, selectors, body] = match;
    if (!selectors.split(',').some((one) => one.trim().endsWith(selector))) continue;
    const width = /max-width:\s*(\d+)px/.exec(body);
    if (!width) continue;
    /* Which @media block, if any, encloses this rule: count the braces before
       it and walk back to the nearest unmatched `@media`. */
    const before = css.slice(0, match.index);
    let depth = 0;
    let range = null;
    for (const chunk of before.split(/(@media[^{]*)\{/)) {
      if (chunk.startsWith('@media')) { if (depth === 0) range = chunk.trim(); depth += 1; continue; }
      depth -= (chunk.match(/\}/g) || []).length;
      if (depth < 0) { depth = 0; range = null; }
    }
    out.push({ px: Number(width[1]), range });
  }
  return out;
}

const indexCss = () => read('src/index.css');
const hallCss = () => read('src/styles/derivatives-glass.css');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
});

afterEach(() => {
  cleanup();
  document.body.className = '';
  vi.unstubAllGlobals();
});

describe('the board is hosted, not re-paged', () => {
  it('renders ONE page box when the host already made one', async () => {
    const Hall = await loadHall();
    const { container } = within(
      <div className="page">
        <Hall embedded />
      </div>
    );
    expect(container.querySelectorAll('.page')).toHaveLength(1);
    expect(container.querySelector('.derivatives-hall'), 'the board itself is still there').toBeTruthy();
  });

  it('shows the squeeze that `embedded` removes', async () => {
    /* Not a bug to keep — the measurement of the one that was reported: a
       hosted hall that builds its own page box puts a second 16px of padding
       inside the first, which is 32px of dead edge on a phone. */
    const Hall = await loadHall();
    const { container } = within(
      <div className="page">
        <Hall />
      </div>
    );
    expect(container.querySelectorAll('.page')).toHaveLength(2);
  });

  it('is still its own page when routed to directly', async () => {
    const Hall = await loadHall();
    const { container } = within(<Hall />);
    expect(container.querySelectorAll('.page')).toHaveLength(1);
  });
});

describe('the hall asks the shell for more column, and gives it back', () => {
  it('adds body.hall-wide while mounted', async () => {
    const Hall = await loadHall();
    within(<Hall />);
    expect(document.body.classList.contains('hall-wide')).toBe(true);
  });

  it('removes it on unmount, so no other page inherits the width', async () => {
    const Hall = await loadHall();
    const { unmount } = within(<Hall />);
    expect(document.body.classList.contains('hall-wide')).toBe(true);
    unmount();
    expect(document.body.classList.contains('hall-wide')).toBe(false);
  });
});

describe('the two stylesheets agree, at every breakpoint', () => {
  /* index.css's own column: base 520, then 600 / 680 / 760 at 600 / 900 / 1400. */
  const APP = [
    { name: 'phone window', range: '(max-width: 599px)', app: 520 },
    { name: 'tablet portrait', range: '(min-width: 600px) and (max-width: 899px)', app: 600 },
    { name: 'desktop', range: '(min-width: 900px) and (max-width: 1399px)', app: 680 },
    { name: 'large desktop', range: '(min-width: 1400px)', app: 760 }
  ];

  it('is wider than the app column in all four ranges — never narrower', () => {
    const hall = widthsFor(hallCss(), 'body.hall-wide .app-shell');
    expect(hall.length, 'one rule per range, and no rule outside a range').toBe(APP.length);
    for (const step of APP) {
      const rule = hall.find((row) => row.range && row.range.includes(step.range));
      expect(rule, `a hall-wide rule for ${step.name} (${step.range})`).toBeTruthy();
      expect(rule.px, `${step.name}: the hall must be wider than ${step.app}px`).toBeGreaterThan(step.app);
      expect(rule.px - step.app, `${step.name}: «کمی» — a little, not a second layout`).toBeLessThanOrEqual(64);
    }
  });

  it('carries the fixed bottom nav with it, or the bar floats detached', () => {
    const hall = widthsFor(hallCss(), 'body.hall-wide .bottom-nav');
    const nav = widthsFor(indexCss(), '.bottom-nav');
    /* The two sheets spell their ranges differently — index.css writes
       `min-width: 900px` and lets the next block override, this one writes the
       range outright so bundle order cannot matter — so they are matched on the
       breakpoint they START at, and index.css's winner for a breakpoint is its
       last declaration, which is what the cascade would apply. */
    const startsAt = (rule) => Number(/min-width:\s*(\d+)px/.exec(rule.range || '')?.[1] ?? 0);
    const appNavAt = (px) => nav.filter((row) => startsAt(row) === px).pop();

    /* index.css widens the nav at 600 / 900 / 1400; below 600 it is its own
       narrower float (440px against a 520px shell) and stays that way. */
    expect(hall.length).toBe(3);
    expect(hall.map(startsAt).sort((a, b) => a - b)).toEqual([600, 900, 1400]);
    for (const rule of hall) {
      const matching = appNavAt(startsAt(rule));
      expect(matching, `index.css has a nav rule from ${startsAt(rule)}px`).toBeTruthy();
      expect(rule.px).toBeGreaterThan(matching.px);
    }
    /* …and the hall's shell and nav are the SAME width in each range, which is
       the whole point of the existing breakpoint blocks. */
    const shell = widthsFor(hallCss(), 'body.hall-wide .app-shell').filter((row) => row.range !== null);
    for (const rule of shell.slice(1)) {
      const partner = hall.find((row) => row.range === rule.range);
      expect(partner?.px, `nav matches shell at ${rule.range}`).toBe(rule.px);
    }
  });

  it('spends the extra width on the rows, not on the artwork', () => {
    const css = hallCss();
    /* The bleed still cancels the host page's 16px, but the ROWS now sit 10px
       in instead of 16px: 12px more board on a phone, where no shell width
       exists to widen. */
    const hallBlock = /\.derivatives-hall\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(hallBlock).toContain('margin-left: -16px');
    expect(hallBlock).toContain('width: calc(100% + 32px)');
    expect(hallBlock).toContain('padding-left: 10px');
    expect(hallBlock).toContain('padding-right: 10px');
  });
});
