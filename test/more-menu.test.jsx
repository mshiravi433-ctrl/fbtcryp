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

    /* At rest: the spectrum ("All"), never an empty variable. */
    expect(panel.style.getPropertyValue('--more-tint')).toBe('var(--rgb-1)');
    expect(panel.style.getPropertyValue('--more-tint-2')).toBe('var(--rgb-2)');
    expect(panel.dataset.activeGroup).toBe('all');

    /* "Earn" is the second category — mint/amber. */
    fireEvent.click(pills()[2]);
    expect(panel.style.getPropertyValue('--more-tint')).toBe('var(--rgb-4)');
    expect(panel.style.getPropertyValue('--more-tint-2')).toBe('var(--rgb-5)');
    expect(panel.dataset.activeGroup).not.toBe('all');

    /* …and back to the rest state without leaking the old colour. */
    fireEvent.click(pills()[0]);
    expect(panel.style.getPropertyValue('--more-tint')).toBe('var(--rgb-1)');
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
   THE MACHINE BOX — behaviour and motion-budget pins
   --------------------------------------------------------------------------
   The owner asked for an RGB animation in the menu's console header, «بدون
   کاهش سرعت» and theme-aware. Those two requirements are testable, so they are
   tested rather than described:

     · the box exists, is not focusable, adds no search field and its shortcut
       chips are real navigations;
     · every infinite animation in its stylesheet is named in a closed list —
       the spectrum blooms, the ring and the live dot — so a later change that
       makes the ROWS loop forever fails here;
     · those loops are `transform`/`opacity` (compositor) or a box-shadow on a
       6px dot, never `filter`, `backdrop-filter`, `width` or `left`;
     · the three guards that must switch them off are present: system
       reduced-motion, the packaged shell (`data-native`) and the lite profile.
   ========================================================================== */
const MACHINE_CSS_RAW = fs.readFileSync(path.resolve(__dirname, '../src/styles/more-machine.css'), 'utf8');
/* Comments are prose, not rules — strip them before asserting on the material. */
const MACHINE_CSS = MACHINE_CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');

describe('More sheet — machine box', () => {
  it('renders one decorative console header with working shortcuts', async () => {
    await mountMore();
    const box = document.querySelector('[data-testid="more-machine"]');
    expect(box).toBeTruthy();
    expect(box.getAttribute('aria-label')).toBeTruthy();
    /* The spectrum field is decoration: hidden from assistive tech, and it
       can never become a focus stop or eat a tap. */
    const field = box.querySelector('.more-machine-field');
    expect(field.getAttribute('aria-hidden')).toBe('true');
    expect(box.querySelectorAll('.more-machine-field [tabindex]')).toHaveLength(0);
    expect(box.querySelectorAll('.more-machine-field button, .more-machine-field a')).toHaveLength(0);
    const chips = [...box.querySelectorAll('.more-machine-chip')];
    expect(chips.length).toBeGreaterThanOrEqual(3);
    for (const chip of chips) {
      expect(chip.getAttribute('type')).toBe('button');
      expect(chip.textContent.trim()).not.toBe('');
      expect(chip.querySelector('svg')).not.toBeNull();
    }
    /* The machine box is not a second search bar. */
    expect(document.querySelector('input[type="search"]')).toBeNull();
  });

  it('loops only the spectrum, and only on compositor properties', () => {
    const infinite = [...MACHINE_CSS.matchAll(/animation:\s*([a-z0-9-]+)[^;]*infinite/gi)]
      .map((m) => m[1])
      .sort();
    expect(infinite).toEqual(['mm-bloom-a', 'mm-bloom-b', 'mm-bloom-c', 'mm-live', 'mm-ring']);

    for (const name of ['mm-bloom-a', 'mm-bloom-b', 'mm-bloom-c', 'mm-ring', 'mm-live']) {
      const block = new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`).exec(MACHINE_CSS)?.[0] ?? '';
      expect(block, `${name} must exist`).not.toBe('');
      expect(block, `${name} must not animate paint`).not.toMatch(/\b(filter|backdrop-filter|width|height|left|top|margin)\s*:/);
    }

    /* No blur, no canvas, no per-row animation. */
    expect(MACHINE_CSS).not.toMatch(/filter:\s*blur/);
    expect(MACHINE_CSS).not.toContain('backdrop-filter');
  });

  it('stops the loops for reduced motion, the packaged shell and the lite profile', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.more-machine-bloom[\s\S]*?animation: none !important/.test(MACHINE_CSS);
    expect(reduced).toBe(true);
    expect(MACHINE_CSS).toMatch(/:root\[data-native='true'\] \.more-machine-bloom/);
    expect(MACHINE_CSS).toMatch(/:root\[data-lite='true'\] \.more-machine-bloom/);
  });

  it('carries a dark material and a light-theme override, not a second design', () => {
    /* Near-black card with a black vignette over the colour: «هاله‌های مشکی با
       رنگ درست». */
    expect(MACHINE_CSS).toMatch(/\.more-machine-vignette \{[\s\S]*?rgba\(0, 0, 0, 0\.5/);
    expect(MACHINE_CSS).toContain(":root[data-theme='light'] .more-machine {");
  });
});
