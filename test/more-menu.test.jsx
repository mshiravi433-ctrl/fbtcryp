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
