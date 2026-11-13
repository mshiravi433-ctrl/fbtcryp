// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      return ({ children, ...p }) => {
        const clean = Object.fromEntries(Object.entries(p).filter(([k]) =>
          !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
        return <T {...clean}>{children}</T>;
      };
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));
/* The row defers its sparkline through this hook; drawing it is irrelevant
   here and its viewport observer does not exist in the test DOM. */
vi.mock('../src/hooks/useRowWindow', () => ({ useNearViewport: () => [() => {}, true] }));

import CoinRow from '../src/components/CoinRow.jsx';

/*
 * THE 24 H POSITION BAR.
 *
 * `high24h` / `low24h` arrive on every row and, before this, the market list
 * showed them nowhere — only the Bitcoin box in Overview used the pair. A row
 * reading "+4%" is two very different situations depending on whether the
 * price is at the bottom of its day or under the top, and the list could not
 * tell them apart.
 *
 * The bar is tiny, so most of the risk is not visual: it is drawing a DOT FOR
 * A NUMBER THAT DOES NOT EXIST. These tests are about that:
 *   • a missing high/low draws nothing (the CoinLore backup sends neither);
 *   • a broken pair (high below low, a zero low) draws nothing rather than a
 *     dot outside its own track;
 *   • a price above the high or below the low clamps to the ends;
 *   • the dot is positioned as a percentage of the range;
 *   • it is NOT a live region and it does NOT animate.
 */

const base = {
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 100,
  change24h: 4.2, volume: 1e9, mcap: 1e12, sparkline: [1, 2, 3], rank: 1
};

const mount = (coin, props = {}) =>
  render(<CoinRow coin={coin} showRange animate={false} {...props} />);

const bar = () => screen.queryByTestId('coin-row-range');
/* The dot is the one <i> inside the track; read its inline offset as a NUMBER.
   React normalises `50.0%` to `50%`, so compare values rather than strings. */
const dotPercent = () => {
  const dot = bar()?.querySelector('i');
  if (!dot) return null;
  const style = dot.getAttribute('style') || '';
  const match = style.match(/inset-inline-start:\s*(-?[\d.]+)%/);
  return match ? Number(match[1]) : null;
};

afterEach(cleanup);

describe('the 24h position bar', () => {
  it('draws nothing when the pair is absent, as the backup feed sends it', () => {
    mount({ ...base });
    expect(bar()).toBeNull();
  });

  it('draws nothing for a broken pair instead of a dot outside its track', () => {
    /* High below low — a feed glitch. */
    mount({ ...base, low24h: 200, high24h: 90 });
    expect(bar()).toBeNull();
    cleanup();
    /* A zero low cannot be divided into. */
    mount({ ...base, low24h: 0, high24h: 120 });
    expect(bar()).toBeNull();
    cleanup();
    /* High === low is a degenerate range, not a percentage. */
    mount({ ...base, low24h: 100, high24h: 100 });
    expect(bar()).toBeNull();
  });

  it('draws nothing when the row is rendered without showRange', () => {
    render(<CoinRow coin={{ ...base, low24h: 80, high24h: 120 }} animate={false} />);
    expect(bar()).toBeNull();
  });

  it('places the dot where the price sits in the range', () => {
    mount({ ...base, price: 100, low24h: 80, high24h: 120 });
    expect(bar()).toBeTruthy();
    /* (100 - 80) / (120 - 80) = 50% */
    expect(dotPercent()).toBeCloseTo(50, 1);
    cleanup();

    mount({ ...base, price: 84, low24h: 80, high24h: 120 });
    expect(dotPercent()).toBeCloseTo(10, 1);
    cleanup();

    mount({ ...base, price: 118, low24h: 80, high24h: 120 });
    expect(dotPercent()).toBeCloseTo(95, 1);
  });

  it('clamps a price outside its own day rather than running off the track', () => {
    /* A price above the high is stale high/low data — clamp to the end. */
    mount({ ...base, price: 130, low24h: 80, high24h: 120 });
    expect(dotPercent()).toBe(100);
    expect(bar().getAttribute('data-pos')).toBe('high');
    cleanup();
    mount({ ...base, price: 70, low24h: 80, high24h: 120 });
    expect(dotPercent()).toBe(0);
    expect(bar().getAttribute('data-pos')).toBe('low');
  });

  it('marks the third of the range it is in, for styling', () => {
    mount({ ...base, price: 82, low24h: 80, high24h: 120 });
    expect(bar().getAttribute('data-pos')).toBe('low');
    cleanup();
    mount({ ...base, price: 100, low24h: 80, high24h: 120 });
    expect(bar().getAttribute('data-pos')).toBe('mid');
    cleanup();
    mount({ ...base, price: 118, low24h: 80, high24h: 120 });
    expect(bar().getAttribute('data-pos')).toBe('high');
  });

  it('is decoration, not a second live region', () => {
    mount({ ...base, low24h: 80, high24h: 120 });
    /* A screen reader already announces the price and the move on this row;
       the bar adds a picture of a number it can already read. */
    expect(bar().getAttribute('aria-hidden')).toBe('true');
    /* The actual low/high values are still available as a tooltip. */
    expect(bar().getAttribute('title')).toContain('80');
    expect(bar().getAttribute('title')).toContain('120');
  });

  it('costs one element and no gradient definition', () => {
    /* The reason this was NOT built as a second Sparkline: a sparkline brings
       an SVG with a gradient <def> per row. The bar is a span with a
       background and a dot — asserted on the source, because "we chose the
       cheaper element" is a decision that survives only if it is written
       down. */
    const src = require('node:fs').readFileSync('src/components/CoinRow.jsx', 'utf8');
    const block = src.slice(src.indexOf('coin-row-range'), src.indexOf('coin-row-range') + 700);
    expect(block).not.toContain('<svg');
    expect(block).not.toContain('gradient');
    expect(block).not.toContain('transition');
  });
});
