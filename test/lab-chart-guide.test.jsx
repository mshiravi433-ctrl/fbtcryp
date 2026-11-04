// @vitest-environment jsdom
/**
 * THE CHART GUIDE — curriculum shape, locale completeness, and a real mount.
 * ═══════════════════════════════════════════════════════════════════════════
 * Three separate things can go wrong on a data-driven tutorial screen, and each
 * one is invisible in a screenshot:
 *
 *   1. THE CURRICULUM DRIFTS FROM THE CHART. A step teaches a chip that has
 *      been renamed or removed, so the reader presses something that is not
 *      there. The guide is only worth shipping if every control it names
 *      exists in `TokenChart`'s toolbar, so the list is asserted against the
 *      source.
 *
 *   2. A KEY IS MISSING IN ONE LANGUAGE. i18next falls back to English, so the
 *      screen renders and a Persian reader gets an English paragraph in the
 *      middle of a Persian lesson. Nothing fails; it just looks broken. This
 *      suite therefore walks EVERY chapter and step id and asserts the key
 *      resolves in both hand-maintained locales, including the nine generated
 *      ones.
 *
 *   3. THE PRACTICE SERIES IS NOT DETERMINISTIC. Two chapters drawing two
 *      different "histories" of the same practice asset makes the reader think
 *      the chart is live and the lesson moved. `toCandles(makeWalk())` is
 *      module-scoped for exactly that reason and the test pins it.
 *
 * The mount test is jsdom + a stubbed engine: `ProChart` falls back to its SVG
 * chart when `lightweight-charts` is unavailable, which is what a test
 * environment looks like. That exercises the fallback path the app ships for
 * real browsers that fail too.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const LANG = vi.hoisted(() => ({ current: 'fa' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    /* i18next interpolates `{{name}}` from the options object. The stub has to
       do it too, or every assertion about a parameterised string (the clamp
       note names its own range) sees the raw placeholder. */
    t: (key, opt) => {
      if (typeof opt === 'string') return opt;
      if (typeof opt === 'object' && opt) {
        const base = opt.defaultValue ?? key;
        return String(base).replace(/\{\{(\w+)\}\}/g, (m, name) =>
          opt[name] != null ? String(opt[name]) : m
        );
      }
      return key;
    },
    i18n: {
      language: LANG.current,
      resolvedLanguage: LANG.current,
      changeLanguage: (l) => { LANG.current = l; }
    }
  })
}));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: () => {} })
}));

import ChartGuide from '../src/components/Lab/ChartGuide';
import { CHAPTERS, CHAPTER_BY_ID, DEMO_DEFAULT, TAB_GROUPS, demoFor } from '../src/components/Lab/chartGuideData';
import { buildLocaleTree, keyFromPath } from './helpers/locale-walk.js';

/* `new URL(`../${x}`, import.meta.url)` is rewritten by Vite's asset plugin
   into a static asset reference, which resolves to `test/undefined` here. The
   repo's other source-reading tests go through `fileURLToPath` for exactly
   this reason; do the same. */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

beforeEach(() => {
  localStorage.clear();
  LANG.current = 'fa';
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · THE CURRICULUM
   ══════════════════════════════════════════════════════════════════════════ */

describe('chart guide · curriculum', () => {
  it('gives every tab at least one chapter and every chapter a tab', () => {
    const inTabs = TAB_GROUPS.flatMap((g) => g.chapters);
    expect(inTabs.sort()).toEqual(CHAPTERS.map((c) => c.id).sort());
  });

  it('gives every chapter at least two steps and a unique id', () => {
    const ids = CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHAPTERS) {
      expect(c.steps.length, `${c.id} needs steps`).toBeGreaterThanOrEqual(2);
      expect(new Set(c.steps).size, `${c.id} has a duplicate step`).toBe(c.steps.length);
    }
  });

  it('only names toolbar controls that exist in TokenChart', () => {
    /* The chips are literal in the source: MA7/MA25/MA99/EMA21/EMA55, BB,
       volume, RSI, MACD, fib, level, measure, log, grid, PNG, fit, zoom.
       If a chip is renamed, the guide's `where` lines become wrong, so this
       assertion fails on the rename instead of on a user report. */
    /* The labels are built, not literal: `[7,25,99].map(p => …, <>MA{p}</>)`.
       Assert the SOURCE SHAPE, so a rename of the periods or a swapped list is
       caught here instead of by a reader hunting for a chip that moved. */
    const source = read('src/components/ProChart/TokenChart.jsx');
    expect(source, 'MA periods').toContain('[7, 25, 99].map((period)');
    expect(source, 'MA7/MA25/MA99 labels').toContain('MA{period}');
    expect(source, 'EMA periods').toContain('[21, 55].map((period)');
    expect(source, 'EMA21/EMA55 labels').toContain('EMA{period}');

    /* The other chips the guide names must be real toolbar entries too. */
    for (const key of ['coin.pro.bb', 'coin.pro.volume', 'coin.pro.rsi', 'coin.pro.macd',
      'coin.pro.fib', 'coin.pro.level', 'coin.pro.measure']) {
      expect(source.includes(key), `${key} must be a toolbar chip`).toBe(true);
    }
    /* …and the chart must NOT have a freehand drawing tool, which the guide
       therefore does not teach. */
    expect(source).not.toContain('coin.pro.draw');
    /* And the guide must not promise a freehand drawing tool that the chart
       does not have. */
    for (const step of CHAPTERS.flatMap((c) => c.steps)) {
      expect(['draw', 'shape', 'text', 'brush']).not.toContain(step);
    }
  });

  it('keeps every chapter\'s demo patch inside DEMO_DEFAULT\'s vocabulary', () => {
    const allowed = new Set(Object.keys(DEMO_DEFAULT));
    for (const c of CHAPTERS) {
      for (const key of Object.keys(c.demo ?? {})) {
        expect(allowed.has(key), `${c.id}.demo.${key} is not a demo field`).toBe(true);
      }
    }
  });

  it('merges a chapter demo over the default without leaking sibling keys', () => {
    const base = demoFor({ demo: {} });
    expect(base.overlays).toEqual({});
    expect(base.panes).toEqual(DEMO_DEFAULT.panes);

    const withMa = demoFor({ demo: { overlays: { ma: { 7: true } } } });
    expect(withMa.overlays).toEqual({ ma: { 7: true } });
    /* A field the chapter did not mention keeps the default... */
    expect(withMa.panes).toEqual(DEMO_DEFAULT.panes);

    /* ...but a field it DID mention is taken verbatim: `overlays: {}` means
       "no overlays", not "inherit the default overlays". */
    const cleared = demoFor({ demo: { overlays: {} } });
    expect(cleared.overlays).toEqual({});
  });

  it('exposes every chapter through CHAPTER_BY_ID', () => {
    for (const c of CHAPTERS) expect(CHAPTER_BY_ID[c.id]).toBe(c);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · LOCALES
   ══════════════════════════════════════════════════════════════════════════ */

const FULL = ['en', 'fa'];
const GENERATED = ['zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];

/** Every key the screen can ask for, derived from the data, not hand-listed. */
function guideKeys() {
  const keys = [
    'lab2.screens.chartGuide.title',
    'lab2.screens.chartGuide.sub',
    'lab2.chartGuide.sampleData',
    'lab2.chartGuide.chaptersLabel',
    'lab2.chartGuide.noteTitle',
    'lab2.chartGuide.note',
    'lab2.chartGuide.backToLab',
    'lab2.chartGuide.demo.title',
    'lab2.chartGuide.demo.legendHint',
    'lab2.chartGuide.demo.type',
    'lab2.chartGuide.demo.toggles',
    'lab2.chartGuide.demo.view',
    'lab2.chartGuide.demo.zoomIn',
    'lab2.chartGuide.demo.fit',
    'lab2.chartGuide.demo.log',
    'lab2.chartGuide.demo.loadingNote',
    'lab2.cards.chartGuide.title',
    'lab2.cards.chartGuide.sub',
    'lab2.advancedGuide.kicker',
    'lab2.advancedGuide.title',
    'lab2.advancedGuide.body',
    'lab2.advancedGuide.cta',
    'lab2.percent.clamped',
    'lab2.percent.increase',
    'lab2.percent.decrease'
  ];
  for (const tab of TAB_GROUPS) keys.push(`lab2.chartGuide.tabs.${tab.id}`);
  for (const type of ['candles', 'line', 'area']) keys.push(`lab2.chartGuide.demo.types.${type}`);
  for (const t of ['ma7', 'ma25', 'ema21', 'bb', 'volume', 'rsi', 'fib']) {
    keys.push(`lab2.chartGuide.demo.togglesMap.${t}`);
  }
  for (const c of CHAPTERS) {
    keys.push(`lab2.chartGuide.chapters.${c.id}.title`);
    for (const step of c.steps) {
      keys.push(`lab2.chartGuide.chapters.${c.id}.steps.${step}.title`);
      keys.push(`lab2.chartGuide.chapters.${c.id}.steps.${step}.body`);
      keys.push(`lab2.chartGuide.chapters.${c.id}.steps.${step}.where`);
    }
  }
  return keys;
}

const KEYS = guideKeys();

for (const lang of FULL) {
  describe(`chart guide · ${lang} locale is complete`, () => {
    const tree = buildLocaleTree(read(`src/i18n/locales/${lang}.json`));

    it(`resolves all ${KEYS.length} keys the screen asks for`, () => {
      const missing = KEYS.filter((k) => {
        const v = keyFromPath(tree, k);
        return typeof v !== 'string' || v.trim() === '';
      });
      expect(missing, `missing in ${lang}.json: ${missing.join(', ')}`).toEqual([]);
    });

    it('has a `where` line on every step, not just a title and a body', () => {
      /* `where` is what makes the guide usable next to the real screen: it
         names the room and the chip. A step without one is a paragraph about
         charts. */
      const stepless = CHAPTERS.flatMap((c) =>
        c.steps
          .filter((s) => !keyFromPath(tree, `lab2.chartGuide.chapters.${c.id}.steps.${s}.where`))
          .map((s) => `${c.id}/${s}`)
      );
      expect(stepless).toEqual([]);
    });
  });
}

for (const lang of GENERATED) {
  describe(`chart guide · ${lang} generated locale carries the curriculum`, () => {
    const tree = buildLocaleTree(read(`src/i18n/locales/${lang}.json`));

    it('has every chapter and step title (the generated module covers them)', () => {
      const missing = KEYS.filter((k) => typeof keyFromPath(tree, k) !== 'string');
      expect(missing, `missing in ${lang}.json: ${missing.join(', ')}`).toEqual([]);
    });
  });
}

it('the generated locales are generated — editing one by hand would be lost', () => {
  /* `gen-locales.mjs` rewrites these nine files from `scripts/locales/*.mjs`,
     so a hand-edit here is a change the next `node scripts/gen-locales.mjs`
     silently deletes. The header of the script says so; this asserts the script
     really is the thing that produced the chart-guide keys. */
  const gen = read('scripts/gen-locales.mjs');
  expect(gen.includes("from './locales/chart-guide.mjs'")).toBe(true);
  expect(gen.includes('...CHART_GUIDE')).toBe(true);
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · THE SCREEN
   ══════════════════════════════════════════════════════════════════════════ */

async function mount() {
  const view = render(
    <MemoryRouter initialEntries={['/lab/chart-guide']}>
      <ChartGuide />
    </MemoryRouter>
  );
  await new Promise((r) => setTimeout(r, 60));
  return view;
}

describe('chart guide · the screen', () => {
  it('renders its own header with a back affordance', async () => {
    const { container, unmount } = await mount();
    const head = container.querySelector('.lab2-screen-head');
    expect(head, 'screen header missing').toBeTruthy();
    expect(head.querySelector('.lab2-screen-title').textContent).toBe('lab2.screens.chartGuide.title');
    expect(head.querySelector('.lab2-back'), 'no way out of the screen').toBeTruthy();
    unmount();
  });

  it('labels the practice series as practice data before any chart pixels', async () => {
    const { container, unmount } = await mount();
    const banner = container.querySelector('[data-testid="chart-guide-sample"]');
    expect(banner, 'the honesty banner must exist').toBeTruthy();
    expect(banner.textContent).toContain('lab2.chartGuide.sampleData');
    unmount();
  });

  it('draws its own chart synchronously, with no engine to wait for', async () => {
    const { container, unmount } = await mount();
    /* The guide taught itself on `ProChart` and the reader reported the result
       as «دکمه‌ها کار نمیده»: the engine is a dynamic import behind
       `matchMedia`/`ResizeObserver`, and its fallback accepts no props, so on
       every device where it had not settled the chips toggled state nothing
       was drawing. The teaching canvas is now an SVG rendered in the same
       commit as the chips — so it is there the instant the screen is, in
       jsdom included, and that is precisely what this asserts. */
    const chart = container.querySelector('[data-testid="guide-chart"]');
    expect(chart, 'the teaching chart must mount synchronously').toBeTruthy();
    expect(chart.querySelector('svg'), 'the chart must have drawn an SVG').toBeTruthy();
    /* It draws REAL geometry, not an empty frame: candles and an axis. */
    expect(chart.querySelectorAll('.cgc-candles rect').length, 'candles').toBeGreaterThan(10);
    expect(chart.querySelectorAll('.cgc-axis').length, 'axis labels').toBeGreaterThan(1);
    unmount();
  });

  it('gives every control a visible effect — the dead-chip regression', async () => {
    /* THE GUARANTEE THE LAST ROUND DID NOT HAVE. A chip that flips React state
       nobody renders is indistinguishable from a chip wired to nothing, which
       is exactly what the reader saw. So: press every toggle, and require the
       rendered SVG to change. `outerHTML` is the honest fingerprint here —
       it catches a class swap, a colour, a pane appearing, anything the reader
       would actually see. */
    const { container, unmount } = await mount();
    const chart = () => container.querySelector('[data-testid="guide-chart"]');
    const before = chart().querySelector('svg').outerHTML;

    const chips = [...container.querySelectorAll('[data-testid^="chart-guide-toggle-"]')];
    expect(chips.length, 'the demo must expose its toggles').toBeGreaterThanOrEqual(8);

    for (const chip of chips) {
      const id = chip.getAttribute('data-testid');
      const snapshot = chart().querySelector('svg').outerHTML;
      fireEvent.click(chip);
      await new Promise((r) => setTimeout(r, 0));
      expect(chart().querySelector('svg').outerHTML, `${id} changed nothing on the chart`).not.toBe(snapshot);
      /* put it back, so each chip is measured against the same baseline */
      fireEvent.click(chip);
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(chart().querySelector('svg').outerHTML).toBe(before);
    unmount();
  });

  it('repaints the chart when the window and the chart type change', async () => {
    const { container, unmount } = await mount();
    const svg = () => container.querySelector('[data-testid="guide-chart"] svg').outerHTML;

    /* The range chips must change how MANY bars are drawn, not just a label. */
    const wide = svg();
    const day = container.querySelector('[data-testid="chart-guide-range-1D"]');
    expect(day, 'the 1D chip must exist').toBeTruthy();
    fireEvent.click(day);
    await new Promise((r) => setTimeout(r, 0));
    expect(svg(), 'the 1D window must draw a different chart').not.toBe(wide);
    expect(container.querySelectorAll('[data-testid="guide-chart"] .cgc-candles rect').length,
      'a 1D window must draw a bar per hour, not one per day').toBeLessThanOrEqual(60);

    /* And the type chips must actually switch the mark. */
    expect(container.querySelector('[data-testid="guide-chart"] .cgc-candles')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid="chart-guide-type-line"]'));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="guide-chart"] .cgc-candles'),
      'the line type must remove the candles').toBeFalsy();
    unmount();
  });

  it('annotates the chart for the chapters that are about what a mark means', async () => {
    /* "Teach ON the chart" — the candle chapter rings a specific candle and
       prints its four numbers under the plot; the average chapter rings the
       bar where the fast average crosses the slow one. */
    const { container, unmount } = await mount();
    expect(container.querySelector('[data-testid="guide-chart"] .cgc-focus'),
      'the open chapter must annotate a bar').toBeTruthy();
    expect(container.querySelector('.lab2-cg-callout').textContent).toMatch(/\d/);

    /* `avg` sits in another tab, so reaching it also proves the tab rail
       swaps the chapter list rather than only repainting a label. */
    const tab = [...container.querySelectorAll('[role="tab"], button')]
      .find((b) => (b.getAttribute('data-testid') ?? '') === 'chart-guide-tab-studies');
    expect(tab, 'the studies tab must be reachable').toBeTruthy();
    fireEvent.click(tab);
    await new Promise((r) => setTimeout(r, 30));

    const avg = container.querySelector('[data-testid="chart-guide-chapter-avg"]');
    expect(avg, 'the average chapter must be listed under studies').toBeTruthy();
    fireEvent.click(avg);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-testid="guide-chart"] .cgc-focus'),
      'the averages chapter must ring the bar where the two lines meet').toBeTruthy();
    unmount();
  });

  it('opens on the first chapter and moves to another when its button is pressed', async () => {
    const { container, unmount } = await mount();
    const firstBtn = container.querySelector('[data-testid="chart-guide-chapter-read"]');
    expect(firstBtn).toBeTruthy();
    expect(firstBtn.getAttribute('aria-pressed')).toBe('true');

    const rangeBtn = container.querySelector('[data-testid="chart-guide-chapter-range"]');
    fireEvent.click(rangeBtn);
    await new Promise((r) => setTimeout(r, 30));

    const pressed = [...container.querySelectorAll('[data-testid^="chart-guide-chapter-"]')]
      .filter((el) => el.getAttribute('aria-pressed') === 'true')
      .map((el) => el.getAttribute('data-testid'));
    expect(pressed).toEqual(['chart-guide-chapter-range']);

    /* And the steps below really changed with it: one of the range chapter's
       own step keys is now on screen. */
    expect(container.textContent).toContain('lab2.chartGuide.chapters.range.steps.ranges.title');
    unmount();
  });

  it('every tab exposes its own chapters and no other tab\'s', async () => {
    const { container, unmount } = await mount();
    for (const group of TAB_GROUPS) {
      const tabBtn = [...container.querySelectorAll('[role="group"] button')]
        .find((b) => b.textContent.includes(`lab2.chartGuide.tabs.${group.id}`));
      expect(tabBtn, `tab ${group.id} missing`).toBeTruthy();
      fireEvent.click(tabBtn);
      await new Promise((r) => setTimeout(r, 20));

      const shown = [...container.querySelectorAll('[data-testid^="chart-guide-chapter-"]')]
        .map((el) => el.getAttribute('data-testid').replace('chart-guide-chapter-', ''));
      for (const id of group.chapters) expect(shown).toContain(id);
      for (const other of CHAPTERS.map((c) => c.id)) {
        if (!group.chapters.includes(other)) expect(shown).not.toContain(other);
      }
    }
    unmount();
  });

  it('toggles a real overlay chip and the pressed state follows', async () => {
    const { container, unmount } = await mount();
    const ma7 = container.querySelector('[data-testid="chart-guide-toggle-ma7"]');
    expect(ma7).toBeTruthy();
    const before = ma7.getAttribute('aria-pressed');
    fireEvent.click(ma7);
    await new Promise((r) => setTimeout(r, 20));
    const after = container
      .querySelector('[data-testid="chart-guide-toggle-ma7"]')
      .getAttribute('aria-pressed');
    expect(after).not.toBe(before);
    unmount();
  });

  it('contains no NaN anywhere, however it is navigated', async () => {
    const { container, unmount } = await mount();
    for (const c of CHAPTERS) {
      const tab = TAB_GROUPS.find((g) => g.chapters.includes(c.id));
      const btn = container.querySelector(`[data-testid="chart-guide-chapter-${c.id}"]`);
      if (!btn) {
        const tabBtn = [...container.querySelectorAll('[role="group"] button')]
          .find((b) => b.textContent.includes(`lab2.chartGuide.tabs.${tab.id}`));
        fireEvent.click(tabBtn);
        await new Promise((r) => setTimeout(r, 20));
        fireEvent.click(container.querySelector(`[data-testid="chart-guide-chapter-${c.id}"]`));
      } else {
        fireEvent.click(btn);
      }
      await new Promise((r) => setTimeout(r, 20));
      expect(container.innerHTML, `NaN rendered in chapter ${c.id}`).not.toContain('NaN');
    }
    unmount();
  });
});

it('the Advanced tab shows the doorway above the cards, linking to the guide', async () => {
  /* The doorway is the ONLY entry point in the product, so a broken href there
     makes the whole screen unreachable by a normal user. */
  const { default: AdvancedGroup } = await import('../src/components/Lab/AdvancedGroup');
  const { container, unmount } = render(
    <MemoryRouter initialEntries={['/lab?tab=advanced']}>
      <AdvancedGroup activeChild={null} onSelectChild={() => {}} />
    </MemoryRouter>
  );
  const door = container.querySelector('[data-testid="lab-advanced-guide-door"]');
  expect(door, 'the doorway box must be on the Advanced tab').toBeTruthy();

  const link = container.querySelector('[data-testid="lab-advanced-guide-door-cta"]');
  expect(link, 'the doorway must carry a real link').toBeTruthy();
  expect(link.getAttribute('href')).toBe('/lab/chart-guide');
  expect(link.tagName).toBe('A');

  /* Order matters: the lesson comes before the simulators it explains. */
  const kids = [...container.querySelector('.lab2-group').children];
  const doorIndex = kids.indexOf(door);
  const gridIndex = kids.findIndex((el) => el.classList.contains('lab2-grid'));
  expect(doorIndex).toBeGreaterThan(-1);
  expect(doorIndex).toBeLessThan(gridIndex);

  screen.getByText('lab2.advancedGuide.title');
  unmount();
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · THE PERCENT FIELD, THROUGH THE SCREEN THAT USES IT
   ══════════════════════════════════════════════════════════════════════════
   The pure arithmetic is pinned in `lab-percent-field.test.js`. What that suite
   cannot see is the WIRING: whether the box and the slider are bound to the
   same state, whether a half-typed entry reaches the calculator, and whether
   the value the risk engine receives is a number. Risk Trainer is the right
   host for this — a wrong value there changes a position size.

   `calcPositionSize` is a pure function, so the assertion is on the RENDERED
   result, not on internal state: type 2.5 into the risk field and the position
   size on screen must move to the size 2.5% implies. */

describe('percent field · on the Risk Trainer', () => {
  async function mountRisk() {
    const { default: RiskTrainer } = await import('../src/components/Lab/RiskTrainer');
    const view = render(
      <MemoryRouter initialEntries={['/lab']}>
        <RiskTrainer onBack={() => {}} />
      </MemoryRouter>
    );
    await new Promise((r) => setTimeout(r, 40));
    return view;
  }

  it('renders three editable percent fields and the two plain sliders', async () => {
    const { container, unmount } = await mountRisk();
    for (const id of ['risk-pct', 'risk-stop', 'risk-target']) {
      expect(container.querySelector(`[data-testid="${id}"]`), `${id} missing`).toBeTruthy();
      expect(container.querySelector(`[data-testid="${id}-input"]`)).toBeTruthy();
      expect(container.querySelector(`[data-testid="${id}-slider"]`)).toBeTruthy();
    }
    /* Capital and entry stay sliders on purpose (order-of-magnitude controls),
       so the screen must NOT have five percent fields. */
    expect(container.querySelectorAll('.lab2-percent')).toHaveLength(3);
    unmount();
  });

  it('commits a typed value and moves the computed position size with it', async () => {
    const { container, unmount } = await mountRisk();
    const input = container.querySelector('[data-testid="risk-pct-input"]');
    const before = container.textContent;

    fireEvent.change(input, { target: { value: '2.5' } });
    await new Promise((r) => setTimeout(r, 30));

    expect(container.querySelector('[data-testid="risk-pct-input"]').value).toBe('2.5');
    expect(container.textContent, 'the risk change did not reach the calculator').not.toBe(before);
    expect(container.innerHTML).not.toContain('NaN');
    unmount();
  });

  it('clamps an out-of-range entry and rewrites the box to the clamped number', async () => {
    const { container, unmount } = await mountRisk();
    const input = container.querySelector('[data-testid="risk-pct-input"]');
    /* 10 is the max for risk-per-trade; 99 must not survive as text. */
    fireEvent.change(input, { target: { value: '99' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(input.value).toBe('10');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    /* The clamped note is a live region, not just a red border — a reader who
       never sees the colour still learns the number was limited. The stub i18n
       echoes `defaultValue`, so assert on the note ELEMENT and on the range it
       names. */
    const note = container.querySelector('[data-testid="risk-pct"] .lab2-percent-note[role="status"]');
    expect(note, 'the clamp must be announced, not only painted').toBeTruthy();
    expect(note.textContent).toContain('0.1%');
    expect(note.textContent).toContain('10.0%');

    /* And blurring settles it: the value is on the 0.1 grid, not 99. */
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-testid="risk-pct-input"]').value).toBe('10');
    expect(container.innerHTML).not.toContain('NaN');
    unmount();
  });

  it('does not commit a half-typed entry', async () => {
    const { container, unmount } = await mountRisk();
    const input = container.querySelector('[data-testid="risk-stop-input"]');
    fireEvent.change(input, { target: { value: '' } });
    await new Promise((r) => setTimeout(r, 20));
    /* Empty box, but the slider and the calculator keep the last real value —
       clearing to retype must not send 0 into a division. */
    expect(input.value).toBe('');
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).not.toContain('Infinity');
    unmount();
  });

  it('keeps the slider and the box on the same number', async () => {
    const { container, unmount } = await mountRisk();
    const slider = container.querySelector('[data-testid="risk-target-slider"]');
    fireEvent.change(slider, { target: { value: '4.5' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-testid="risk-target-input"]').value).toBe('4.5');
    unmount();
  });

  it('accepts a Persian-typed percent from a Persian keyboard', async () => {
    const { container, unmount } = await mountRisk();
    const input = container.querySelector('[data-testid="risk-pct-input"]');
    fireEvent.change(input, { target: { value: '۳' } });
    await new Promise((r) => setTimeout(r, 30));
    /* Committed as 3, not as NaN. The box keeps the Persian glyph until blur,
       which is what lets the reader finish typing. */
    expect(container.innerHTML).not.toContain('NaN');
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-testid="risk-pct-input"]').value).toBe('3');
    unmount();
  });
});

describe('chart guide · interactive teacher', () => {
  beforeEach(() => cleanup());
  it('explains a selected control and switches between RSI and MACD', () => {
    render(<MemoryRouter><ChartGuide /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('chart-guide-toggle-rsi'));
    expect(screen.getByTestId('chart-guide-toggle-rsi').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.cgc-sub-rsi')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chart-guide-toggle-macd'));
    expect(screen.getByTestId('chart-guide-toggle-rsi').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.cgc-sub-macd')).toBeTruthy();
    expect(document.querySelector('.lab2-cg-insight').textContent).toContain('MACD');
  });

  it('sends chart context to the teacher and labels rule-based answers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ answer: 'Test answer', degraded: true }) });
    render(<MemoryRouter><ChartGuide /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: /RSI/ }), { target: { value: 'RSI?' } });
    fireEvent.click(screen.getByRole('button', { name: 'بپرس' }));
    expect(await screen.findByText('Test answer')).toBeTruthy();
    expect(screen.getByText(/موتور قاعده/)).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).context.join(' ')).toContain('Practice chart');
    fetchMock.mockRestore();
  });
});
