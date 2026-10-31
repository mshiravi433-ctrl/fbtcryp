// @vitest-environment jsdom
/**
 * THE MORE SHEET, LIQUID-GLASS PASS — behaviour pins
 * ---------------------------------------------------------------------------
 * The owner's brief («لیکوئید گلس و خیلی خیلی مدرن، بدون نوار جستجو و جملات
 * اضافه») is mostly material, and material lives in src/styles/more-menu.css.
 * What THIS suite pins is the behaviour the glass pass added or reaffirmed —
 * the parts a future restyle could quietly break while keeping the look:
 *
 *   · still no search field, no footer, no filler copy — the removals of the
 *     previous pass stay removed (a restyle is how they creep back);
 *   · exactly ONE sliding glass capsule exists, on the selected filter pill,
 *     and it moves to the newly selected pill (the layoutId morph needs the
 *     element to be singular or Framer has nothing to morph between);
 *   · the row for the screen you are already on is marked with aria-current
 *     and carries the dot instead of a chevron;
 *   · filtering by a category shrinks the list to that category, and section
 *     headings only appear in the unfiltered view;
 *   · the drag-to-dismiss affordances (grabber zone + dialog semantics) are
 *     in the DOM the CSS expects.
 */
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { setLanguage } from '../src/i18n/index.js';
import MoreSheet from '../src/components/MoreSheet.jsx';

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(() => {
  cleanup();
});

/* The sheet portals into <body>, so queries go to the document, and the
   lazily-imported stylesheet must land before the panel renders. */
async function mountMore(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MoreSheet open onClose={() => {}} />
    </MemoryRouter>
  );
  await waitFor(() => {
    expect(document.querySelectorAll('.more-tile').length).toBeGreaterThan(0);
  });
  return {
    tiles: () => [...document.querySelectorAll('.more-tile')],
    tileByLabel: (label) => [...document.querySelectorAll('.more-tile')]
      .find((tile) => tile.querySelector('.more-tile-label')?.textContent.trim() === label),
    pills: () => [...document.querySelectorAll('.more-pill')]
  };
}

describe('More sheet — liquid glass pass', () => {
  it('has no search field, no footer, no filler copy', async () => {
    await mountMore();
    expect(document.querySelector('input[type="search"]')).toBeNull();
    expect(document.querySelector('.more-search')).toBeNull();
    expect(document.querySelector('.more-footer')).toBeNull();
    expect(document.querySelector('[data-testid="more-menu-dialog"]')).not.toBeNull();
  });

  it('renders every destination once, each a real button with an icon', async () => {
    const { tiles } = await mountMore();
    /* 25 is the directory's size with the default feature flags; the exact
       number is owned by GROUPS in MoreSheet.jsx — what must not change
       silently is "every row is a tappable labelled button". */
    expect(tiles().length).toBeGreaterThanOrEqual(20);
    for (const tile of tiles()) {
      expect(tile.getAttribute('type')).toBe('button');
      expect(tile.querySelector('.more-tile-icon svg')).not.toBeNull();
      expect(tile.querySelector('.more-tile-label')?.textContent.trim()).not.toBe('');
      /* the cascade delay token the CSS reads */
      expect(tile.style.getPropertyValue('--more-i')).not.toBe('');
      expect(tile.style.getPropertyValue('--more-accent')).not.toBe('');
    }
  });

  it('keeps exactly one glass capsule, on the selected pill, and moves it', async () => {
    const { pills } = await mountMore();
    expect(pills()).toHaveLength(4);
    expect(document.querySelectorAll('.more-pill-glass')).toHaveLength(1);
    expect(pills()[0].dataset.active).toBe('true');
    expect(pills()[0].querySelector('.more-pill-glass')).not.toBeNull();
    expect(pills()[0].getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(pills()[2]);
    expect(document.querySelectorAll('.more-pill-glass')).toHaveLength(1);
    expect(pills()[2].dataset.active).toBe('true');
    expect(pills()[2].querySelector('.more-pill-glass')).not.toBeNull();
    expect(pills()[0].dataset.active).toBe('false');
  });

  it('filtering shrinks the list and drops the section headings', async () => {
    const { tiles, pills } = await mountMore();
    const all = tiles().length;
    expect(document.querySelectorAll('.more-group-title').length).toBe(3);

    fireEvent.click(pills()[1]); /* markets */
    expect(tiles().length).toBeLessThan(all);
    expect(tiles().length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.more-group-title')).toHaveLength(0);
  });

  it('marks the current screen with aria-current and a dot, not a chevron', async () => {
    const { tileByLabel } = await mountMore('/news');
    const news = tileByLabel('اخبار');
    expect(news).toBeTruthy();
    expect(news.getAttribute('aria-current')).toBe('page');
    expect(news.dataset.current).toBe('true');
    expect(news.querySelector('.more-tile-dot')).not.toBeNull();
    expect(news.querySelector('.more-tile-chevron')).toBeNull();

    const market = tileByLabel('بازار');
    expect(market.getAttribute('aria-current')).toBeNull();
    expect(market.querySelector('.more-tile-chevron')).not.toBeNull();
  });

  it('exposes the drag affordances and dialog semantics', async () => {
    await mountMore();
    const panel = document.querySelector('[data-testid="more-menu-dialog"]');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.querySelector('.more-dragzone .more-grabber')).not.toBeNull();
    expect(document.querySelector('[data-testid="more-menu-close"]')).not.toBeNull();
  });
});

/**
 * THE PRISM-BLADE PASS — material pins
 * ---------------------------------------------------------------------------
 * The third pass on this sheet is geometry, colour and one sweep (see
 * src/styles/more-menu.css and the header of MoreSheet.jsx). This block pins
 * the parts that a future restyle could quietly undo while the look still
 * "seems fine" in a screenshot:
 *
 *   · the category tint actually reaches the panel and CHANGES with the rail
 *     (if it stops, the sheet silently loses its colour system and nobody
 *     notices until it looks flat again);
 *   · exactly one sweep element exists, it is not focusable, and the
 *     stylesheet never asks for an infinite animation — a looping sheen under
 *     a backdrop blur is the Android "fluorescent tube" flicker this whole
 *     file is written against;
 *   · the blade corner is made of radii, not clip-path: clipping the glass
 *     pane is the one combination that both clips its own shadow and that
 *     browsers disagree about.
 */
import fs from 'node:fs';
import path from 'node:path';

const CSS = fs.readFileSync(path.resolve(__dirname, '../src/styles/more-menu.css'), 'utf8');

describe('More sheet — prism-blade pass', () => {
  it('tints the pane with the active category and re-tints it on filter change', async () => {
    const { pills } = await mountMore();
    const panel = document.querySelector('[data-testid="more-menu-dialog"]');

    /* At rest: the spectrum ("All"), never an empty variable. The noir pass
       (2026-10-31) moved the rest pair from cyan→violet to violet→magenta so
       the sheet reads purple-on-black before a category is picked; the
       invariant this test owns is "the pane is always tinted, and the tint
       follows the rail". */
    expect(panel.style.getPropertyValue('--more-tint')).toBe('var(--rgb-2)');
    expect(panel.style.getPropertyValue('--more-tint-2')).toBe('var(--rgb-3)');
    expect(panel.dataset.activeGroup).toBe('all');

    /* "Earn" is the second category — mint/amber. */
    fireEvent.click(pills()[2]);
    expect(panel.style.getPropertyValue('--more-tint')).toBe('var(--rgb-4)');
    expect(panel.style.getPropertyValue('--more-tint-2')).toBe('var(--rgb-5)');
    expect(panel.dataset.activeGroup).not.toBe('all');

    /* …and back to the rest state without leaking the old colour. */
    fireEvent.click(pills()[0]);
    expect(panel.style.getPropertyValue('--more-tint')).toBe('var(--rgb-2)');
  });

  it('gives every pill and section heading its own tint token', async () => {
    const { pills } = await mountMore();
    for (const pill of pills()) {
      expect(pill.style.getPropertyValue('--more-tint')).not.toBe('');
    }
    const titles = [...document.querySelectorAll('.more-group-title')];
    expect(titles).toHaveLength(3);
    for (const title of titles) {
      expect(title.style.getPropertyValue('--more-group-accent')).not.toBe('');
    }
  });

  it('sweeps light across the pane ONCE, decoratively', async () => {
    await mountMore();
    const sweeps = document.querySelectorAll('.more-sweep');
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].getAttribute('aria-hidden')).toBe('true');
    /* It must never join the tab order or eat a tap. */
    expect(sweeps[0].getAttribute('tabindex')).toBeNull();
    expect(sweeps[0].tagName).toBe('SPAN');

    /* One-shot by construction: no `infinite` anywhere in the stylesheet. */
    expect(/infinite/i.test(CSS)).toBe(false);
    const sweepRule = /\.more-panel > \.more-sweep \{[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
    expect(sweepRule).toContain('animation: more-sweep');
    expect(sweepRule).toMatch(/\b1 both\b/);
    /* …and it is a transform, not a paint, so it costs the compositor. */
    expect(sweepRule).toContain('translate3d');
  });

  it('builds the blade corner out of radii, never clip-path', () => {
    /* Logical radii are what mirror the cut in RTL without a duplicate rule. */
    expect(CSS).toMatch(/\.more-panel \{[\s\S]*?border-end-end-radius: var\(--more-cut\)/);
    expect(CSS).toContain('--more-cut:');
    for (const selector of ['.more-list', '.more-tile-icon', '.more-close', '.more-pill-glass']) {
      /* Anchored to the start of a line: `.more-tile:hover .more-tile-icon {`
         also exists, and it is the base rule we are pinning. */
      const block = new RegExp(`^\\${selector} \\{[\\s\\S]*?\\n\\}`, 'm').exec(CSS)?.[0] ?? '';
      expect(block, `${selector} must carry the blade corner`).toContain('border-end-end-radius');
    }
    /* No clip-path DECLARATION: it would also clip the pane's own shadow, and
       clipping a backdrop-filtered element is where engines disagree. The
       comments are stripped first — this file's own prose names clip-path as
       the thing it refused to use (the same trap test/wiring.mjs documents). */
    const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssCode.includes('clip-path')).toBe(false);
  });

  it('keeps the compositor budget: one backdrop-filter, none on rows', () => {
    /* Line-anchored so the @supports FEATURE QUERY (which also contains the
       words `backdrop-filter: blur`) is not counted as a declaration. Exactly
       two live blurs are allowed — the panel and its -webkit twin. */
    const blurDecls = CSS.match(/^\s*(?:-webkit-)?backdrop-filter:\s*blur/gm) || [];
    expect(blurDecls).toHaveLength(2);
    expect(CSS).toMatch(/backdrop-filter:/);
    for (const selector of ['.more-tile', '.more-tile-icon', '.more-pill', '.more-list']) {
      const block = new RegExp(`^\\${selector} \\{[\\s\\S]*?\\n\\}`, 'm').exec(CSS)?.[0] ?? '';
      expect(block, `${selector} must not sample the backdrop`).not.toContain('backdrop-filter');
    }
    /* A filter/animation on 25 rows inside a springing pane is the bug this
       sheet already paid for once. */
    expect(CSS).not.toMatch(/\.more-tile \{[^}]*filter:/);
  });
});

/* ==========================================================================
   THE NOIR PASS (2026-10-31) — machine box removed, RGB rim light, faster open
   --------------------------------------------------------------------------
   The owner's fourth pass on this sheet: «باکس موتور fbt را پاکش کن، رنگ‌بندی
   را بهتر کن یعنی ته‌مایه‌های سیاهی در تم مشکی باشد با بنفش در نمای کلی، و در
   ماچین هم یک نور rgb انیمیشنی باشد در کناره حرکت می‌کند، و سرعت بازشدن
   پاپ‌آپ منو … سرعتش را بیشتر کن».

   Deletions creep back and "faster" silently regresses, so all four are pinned:

     · the machine box is GONE — no `.more-machine*` anything in the DOM, no
       `MACHINE_SHORTCUTS`, no `nav.machine.*` key left in any of the twelve
       locales (a dead key in one language is how the card comes back);
     · the rim light exists, is exactly one decorative element, can never be
       focused or tapped, and its stylesheet runs ONE infinite animation on
       `transform` alone — with the three guards (reduced motion, the packaged
       shell, the lite profile) freezing rather than hiding it;
     · the pane is noir + violet in the dark theme: near-black base stops and a
       violet pool, and the rest tint leads with `--rgb-2`;
     · the open is measurably quicker than the pass before it: spring stiffness,
       travel distance, scrim duration and the CSS cascade all below the old
       numbers, and the scrim no longer waits for the lazy stylesheet.
   ========================================================================== */
const EDGE_CSS_RAW = fs.readFileSync(path.resolve(__dirname, '../src/styles/more-edge.css'), 'utf8');
/* Comments are prose, not rules — strip them before asserting on the material. */
const EDGE_CSS = EDGE_CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');
const MORE_JSX = fs.readFileSync(path.resolve(__dirname, '../src/components/MoreSheet.jsx'), 'utf8');
/* The same code-only view the wiring suite uses: prose in this file talks about
   the removed box at length, and a comment must not read as a live symbol. */
const MORE_CODE = MORE_JSX.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('More sheet — noir pass: the machine box is gone', () => {
  it('renders no console card, no shortcut chips and no spectrum blooms', async () => {
    await mountMore();
    expect(document.querySelector('[data-testid="more-machine"]')).toBeNull();
    expect(document.querySelector('.more-machine')).toBeNull();
    expect(document.querySelectorAll('[class*="more-machine"]').length).toBe(0);
    /* The header, the rail and the directory are still the whole sheet. */
    expect(document.querySelector('.more-head .more-title')).not.toBeNull();
    expect(document.querySelectorAll('.more-pill').length).toBe(4);
    expect(document.querySelectorAll('.more-tile').length).toBeGreaterThanOrEqual(20);
  });

  it('keeps the removed card out of the source, the styles and all 12 locales', () => {
    /* The shortcut rail went with the card; nothing may re-add it. */
    expect(MORE_CODE).not.toContain('MACHINE_SHORTCUTS');
    expect(MORE_CODE).not.toMatch(/more-machine/);
    expect(fs.existsSync(path.resolve(__dirname, '../src/styles/more-machine.css'))).toBe(false);

    /* A dead locale key is how a removed card returns in a later merge, and
       `nav.machine.title` was rendered by the box that is now gone. */
    for (const loc of fs.readdirSync(path.resolve(__dirname, '../src/i18n/locales'))) {
      const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/i18n/locales', loc), 'utf8'));
      expect(json?.nav?.machine, `${loc} still carries nav.machine`).toBeUndefined();
    }
  });
});

describe('More sheet — noir pass: the RGB rim light', () => {
  it('is one decorative element on the pane, never focusable, never tappable', async () => {
    await mountMore();
    const edges = document.querySelectorAll('.more-edge');
    expect(edges).toHaveLength(1);

    const panel = document.querySelector('[data-testid="more-menu-dialog"]');
    /* A direct child of the pane, like the sweep: it frames the sheet, so it
       has to be in the pane's own stacking context and clipped by its radii. */
    expect(edges[0].parentElement).toBe(panel);
    expect(edges[0].getAttribute('aria-hidden')).toBe('true');
    expect(edges[0].getAttribute('tabindex')).toBeNull();
    expect(edges[0].tagName).toBe('SPAN');
    expect(edges[0].querySelectorAll('button, a, [tabindex]').length).toBe(0);
    expect(edges[0].querySelector('.more-edge-beam')).not.toBeNull();
  });

  it('runs exactly ONE infinite animation, on transform alone', () => {
    const infinite = [...EDGE_CSS.matchAll(/animation:\s*([a-z0-9-]+)[^;]*infinite/gi)].map((m) => m[1]);
    expect(infinite).toEqual(['more-edge-spin']);

    const block = /@keyframes more-edge-spin \{[\s\S]*?\n\}/.exec(EDGE_CSS)?.[0] ?? '';
    expect(block, 'the spin keyframes must exist').not.toBe('');
    /* Rotation and nothing else: no paint property, no layout property. */
    expect(block).toMatch(/transform:\s*rotate\(/);
    expect(block).not.toMatch(/\b(filter|backdrop-filter|width|height|left|top|margin|opacity|background)\s*:/);

    /* The whole sheet's rim light costs no blur and no backdrop sample. */
    expect(EDGE_CSS).not.toMatch(/filter:\s*blur/);
    expect(EDGE_CSS).not.toContain('backdrop-filter');
    /* The ring is a mask, not a clip: a clip-path here would also cut the
       pane's shadow and is banned in this sheet's vocabulary. */
    expect(EDGE_CSS).not.toContain('clip-path');
    expect(EDGE_CSS).toMatch(/mask-composite:\s*exclude/);
    /* …and where the mask trick is unavailable the rim is removed outright
       rather than painting an unmasked rainbow square over the list. */
    expect(EDGE_CSS).toMatch(/@supports not \(\(mask-composite: exclude\)[\s\S]*?\.more-edge \{[\s\S]*?display: none/);
  });

  it('freezes (does not hide) the rim for reduced motion, native and lite', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.more-edge-beam \{[\s\S]*?animation: none !important/.test(EDGE_CSS);
    expect(reduced).toBe(true);
    expect(EDGE_CSS).toMatch(/:root\[data-native='true'\] \.more-edge-beam/);
    expect(EDGE_CSS).toMatch(/:root\[data-lite='true'\] \.more-edge-beam/);
    /* Frozen means a static spectrum ring still frames the sheet. The slice
       stops at the `@supports` block on purpose: hiding the rim where masking
       is unsupported is a different (and correct) rule, and must not be read
       as a guard that hides it. */
    const from = EDGE_CSS.indexOf('prefers-reduced-motion');
    const to = EDGE_CSS.indexOf('@supports not');
    const guards = EDGE_CSS.slice(from, to > from ? to : undefined);
    expect(guards.match(/animation: none !important/g).length).toBeGreaterThanOrEqual(2);
    expect(guards).toMatch(/conic-gradient/);
    expect(guards).not.toMatch(/display:\s*none/);
    /* A frozen rim is a dimmer rim, never an invisible one. */
    expect(guards).toMatch(/opacity:\s*0?\.[45]/);
  });

  it('stays a lazy sheet of its own, out of the first-paint bundle', () => {
    expect(MORE_JSX).toMatch(/import\('\.\.\/styles\/more-edge\.css'\)/);
    expect(MORE_JSX).toMatch(/import\('\.\.\/styles\/more-menu\.css'\)/);
  });
});

describe('More sheet — noir pass: black undertones, violet overall', () => {
  it('builds the dark pane from near-black stops with a violet pool', () => {
    const panel = /^\.more-panel \{[\s\S]*?\n\}/m.exec(CSS)?.[0] ?? '';
    /* Three noir tokens, all of them effectively black (each channel < 0x20). */
    const noirs = [...panel.matchAll(/--more-noir-\d:\s*#([0-9a-f]{6})/gi)].map((m) => m[1]);
    expect(noirs).toHaveLength(3);
    for (const hex of noirs) {
      for (const pair of hex.match(/../g)) {
        expect(parseInt(pair, 16), `#${hex} is not a black undertone`).toBeLessThan(0x20);
      }
    }
    expect(panel).toContain('var(--more-noir-1)');
    /* Violet is the permanent hue of the overall view, not a category accent. */
    expect(panel).toMatch(/radial-gradient\([^)]*at 50% 116%,\s*color-mix\(in srgb, var\(--rgb-2\)/);
    /* The pane still owns exactly one backdrop blur (counted in the budget test
       above) and never went back to white glass over a grey panel. */
    expect(panel).not.toContain('var(--bg-panel-solid)');
  });

  it('leads the rest tint with violet and keeps the four categories distinct', async () => {
    const { pills } = await mountMore();
    const panel = document.querySelector('[data-testid="more-menu-dialog"]');
    expect(panel.style.getPropertyValue('--more-tint')).toBe('var(--rgb-2)');
    expect(panel.style.getPropertyValue('--more-tint-2')).toBe('var(--rgb-3)');

    /* Every rail position wears a different pair, or "picking a category
       re-tints the material" is a lie on one of the four stops. */
    const pairs = new Set();
    for (const pill of pills()) {
      const tint = pill.style.getPropertyValue('--more-tint');
      expect(tint).not.toBe('');
      pairs.add(tint);
    }
    expect(pairs.size).toBe(4);

    /* Earn still answers in money green. */
    fireEvent.click(pills()[2]);
    expect(panel.style.getPropertyValue('--more-tint')).toBe('var(--rgb-4)');
  });

  it('leaves the light theme pale instead of painting it black', () => {
    expect(CSS).toContain(":root[data-theme='light'] .more-panel {");
    const light = /:root\[data-theme='light'\] \.more-panel \{[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
    expect(light).not.toContain('var(--more-noir');
    expect(light).toMatch(/rgba\(255, 255, 255/);
  });
});

describe('More sheet — noir pass: the open is faster', () => {
  /* The numbers of the pass this one replaced, pinned as ceilings. "Faster" is
     a claim about a duration, so it is asserted as one. */
  const spring = /stiffness: (\d+), damping: (\d+), mass: ([\d.]+)/.exec(MORE_CODE)?.slice(1) ?? [];

  it('springs the panel in harder and travels less', () => {
    /* Fifth pass (2026-10-31): 720/40/0.62 over 14px → 980/48/0.5 over 10px,
       a critically damped settle (~80ms) with no bounce at all. */
    expect(Number(spring[0]), 'stiffness').toBeGreaterThanOrEqual(900);
    expect(Number(spring[2]), 'mass').toBeLessThanOrEqual(0.6);
    /* Was y: 28, then 14 — a shorter travel with a harder spring is the whole
       speed-up. */
    expect(MORE_CODE).toMatch(/initial=\{\{ opacity: 0, y: still \? 0 : 10 \}\}/);
    expect(MORE_CODE).toMatch(/exit=\{\{ opacity: 0, y: still \? 0 : 16 \}\}/);
    /* Still no parent scale: that is the jitter this sheet already paid for. */
    expect(MORE_CODE).not.toMatch(/animate=\{\{[^}]*scale/);
  });

  it('requests its stylesheet when the module is evaluated, not on an idle callback', () => {
    /* Fifth pass: `requestIdleCallback` is a race — on a busy screen it can
       fire seconds after the module loads, or not before the first tap, and a
       cold tap then waited a network round trip with nothing on screen. The
       import is kicked off at module evaluation (still a dynamic `import()`,
       still its own chunk) so the tap renders immediately. */
    const boot = MORE_CODE.indexOf("if (typeof window !== 'undefined') loadMenuStyles();");
    expect(boot, 'the boot warm-up exists').toBeGreaterThan(0);
    expect(boot).toBeLessThan(MORE_CODE.indexOf('export default function MoreSheet'));
    /* Still lazy: the sheet's two sheets are dynamic imports, never static. */
    expect(MORE_CODE).not.toMatch(/^import\s+['"]\.\.\/styles\/more-/m);
  });

  it('paints the scrim immediately and only gates the panel on the stylesheet', () => {
    /* Was `{open && menuStylesReady && ( …everything… )}`: on a cold tap the
       button looked dead for a network round trip. */
    expect(MORE_CODE).toMatch(/\{open && \(/);
    expect(MORE_CODE).toMatch(/\{menuStylesReady && \(/);
    const scrimAt = MORE_CODE.indexOf('sheet-backdrop more-backdrop');
    const gateAt = MORE_CODE.indexOf('{menuStylesReady && (');
    expect(scrimAt).toBeGreaterThan(0);
    expect(gateAt).toBeGreaterThan(scrimAt);
    expect(MORE_CODE).toMatch(/duration: still \? 0 : 0\.1/);
  });

  it('shortens every CSS duration that delays the list being readable', () => {
    const sweep = /animation: more-sweep ([\d.]+)s [^;]*?([\d.]+)s 1 both/.exec(CSS)?.slice(1) ?? [];
    expect(Number(sweep[0])).toBeLessThanOrEqual(0.45);
    expect(Number(sweep[1])).toBe(0);

    const fade = /animation: more-fade-in ([\d.]+)s/.exec(CSS)?.[1];
    expect(Number(fade)).toBeLessThanOrEqual(0.12);

    const cascade = /animation: more-tile-in ([\d.]+)s/.exec(CSS)?.[1];
    /* The stagger is CAPPED now — `min(var(--more-i, 0), 11) * 8ms` — so the
       whole list is readable inside ~90ms instead of the 26th row arriving
       590ms after the tap. Both the slot count and the step are ceilings. */
    const stagger = /animation-delay: calc\(min\(var\(--more-i, 0\), (\d+)\) \* (\d+)ms\)/.exec(CSS)?.slice(1) ?? [];
    expect(Number(stagger[1]), 'per-row step').toBeLessThanOrEqual(8);
    expect(Number(stagger[0]), 'capped slot').toBeLessThanOrEqual(11);
    expect(Number(cascade)).toBeLessThanOrEqual(0.16);

    /* One-shot rules are unchanged: still no loop in this stylesheet. */
    expect(/infinite/i.test(CSS)).toBe(false);
  });

  it('closes before navigating, with less dead time after the tap', () => {
    expect(MORE_CODE).toMatch(/\}, 55\);/);
    const goStart = MORE_CODE.indexOf('const go = ');
    expect(MORE_CODE.indexOf('onClose?.()', goStart)).toBeLessThan(MORE_CODE.indexOf('navigate(to)', goStart));
  });
});
