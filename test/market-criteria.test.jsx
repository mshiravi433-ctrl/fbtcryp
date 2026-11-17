// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import en from '../src/i18n/locales/en.json';

/*
 * «چه چیزی این فهرست را این‌گونه کرد» — THE CRITERIA ROW.
 *
 * The market table is the product of four controls (search, sector, chip view,
 * sort popover) plus a 60-row render budget inside a feed of up to 750 rows.
 * Three of those are invisible from where the rows are read, and the old footer
 * printed the SAME «60 of 250» whether the next sixty were already in memory or
 * cost a request — which is how a reader learns to distrust a button.
 *
 * These tests are about the three claims the row makes:
 *   1. the headline names the set, and changes when the set changes;
 *   2. every active constraint is a removable token, and removing it calls the
 *      right reset (a constraint you cannot see is a constraint you cannot undo);
 *   3. the caption distinguishes "already loaded" from "needs a request".
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, values = {}) => {
      const text = key.split('.').reduce((row, part) => row?.[part], en) ?? key;
      return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
    },
    i18n: { language: 'en' }
  })
}));

import MarketCriteriaRow from '../src/components/market/MarketCriteriaRow.jsx';
import MarketColumnHeader from '../src/components/market/MarketColumnHeader.jsx';

afterEach(cleanup);

const mount = (props) =>
  render(
    <MarketCriteriaRow
      headline="All coins, in the order you chose"
      shown={60}
      total={250}
      {...props}
    />
  );

describe('MarketCriteriaRow — the headline names the set', () => {
  it('prints the sentence it was given, verbatim', () => {
    mount({ headline: 'The sector: DeFi' });
    expect(screen.getByTestId('market-criteria-headline').textContent).toBe('The sector: DeFi');
  });

  it('renders even when the list is empty, because "0 of 250" is the answer', () => {
    mount({ shown: 0, total: 250, headline: 'Results for «zzz»' });
    expect(screen.getByTestId('market-criteria')).toBeTruthy();
    expect(screen.getByTestId('market-criteria-caption').textContent).toContain('0 of 250');
  });
});

describe('MarketCriteriaRow — constraints are visible and removable', () => {
  it('draws one token per active constraint, in the order given', () => {
    mount({
      criteria: [
        { id: 'query', label: '«eth»', onRemove: vi.fn() },
        { id: 'sector', label: 'DeFi', onRemove: vi.fn() }
      ]
    });
    expect(screen.getByTestId('market-criteria-query').textContent).toContain('«eth»');
    expect(screen.getByTestId('market-criteria-sector').textContent).toContain('DeFi');
  });

  it('removing a token calls that constraint\u2019s own reset, not a global one', () => {
    const removeSector = vi.fn();
    const removeQuery = vi.fn();
    mount({
      criteria: [
        { id: 'query', label: '«eth»', onRemove: removeQuery },
        { id: 'sector', label: 'DeFi', onRemove: removeSector }
      ]
    });
    fireEvent.click(screen.getByTestId('market-criteria-sector-remove'));
    expect(removeSector).toHaveBeenCalledTimes(1);
    expect(removeQuery).not.toHaveBeenCalled();
  });

  it('names what the \u2715 removes, because "\u00d7" alone is not a label', () => {
    mount({ criteria: [{ id: 'sector', label: 'DeFi', onRemove: vi.fn() }] });
    const button = screen.getByTestId('market-criteria-sector-remove');
    expect(button.getAttribute('aria-label')).toContain('DeFi');
    expect(button.getAttribute('aria-label')).toContain('Remove filter');
  });

  it('offers "reset all" only when there is something to reset', () => {
    mount({ criteria: [{ id: 'sector', label: 'DeFi', onRemove: vi.fn() }], onReset: vi.fn() });
    expect(screen.getByTestId('market-criteria-reset')).toBeTruthy();
    cleanup();
    mount({ criteria: [] });
    expect(screen.queryByTestId('market-criteria-reset')).toBeNull();
  });

  it('does not render a chip row when nothing is constrained', () => {
    const { container } = mount({ criteria: [] });
    expect(container.querySelector('.mx-criteria-chips')).toBeNull();
  });
});

describe('MarketCriteriaRow — the scope caption knows where the rest is', () => {
  it('says the remainder is already loaded when it is a reveal', () => {
    mount({ shown: 60, total: 250, nextKind: 'memory' });
    const caption = screen.getByTestId('market-criteria-caption').textContent;
    expect(caption).toContain('60 of 250');
    expect(caption).toContain('already loaded');
  });

  it('says the remainder costs a request when it does', () => {
    mount({ shown: 60, total: 250, nextKind: 'request' });
    const caption = screen.getByTestId('market-criteria-caption').textContent;
    expect(caption).toContain('60 of 250');
    expect(caption).toContain('request');
  });

  it('the two captions are DIFFERENT — this was the footer bug', () => {
    mount({ shown: 60, total: 250, nextKind: 'memory' });
    const memory = screen.getByTestId('market-criteria-caption').textContent;
    cleanup();
    mount({ shown: 60, total: 250, nextKind: 'request' });
    const request = screen.getByTestId('market-criteria-caption').textContent;
    expect(memory).not.toBe(request);
  });

  it('announces completion, not a promise, when everything is shown', () => {
    mount({ shown: 60, total: 60, nextKind: null });
    expect(screen.getByTestId('market-criteria-caption').textContent).toContain('All 60 rows');
  });

  it('fills the rail by ratio of shown to total', () => {
    const { container } = mount({ shown: 60, total: 240 });
    const fill = container.querySelector('.mx-criteria-fill');
    expect(Number(fill.getAttribute('style').match(/width:\s*([\d.]+)%/)[1])).toBeCloseTo(25, 5);
  });

  it('does not divide by zero for an empty view', () => {
    const { container } = mount({ shown: 0, total: 0 });
    const fill = container.querySelector('.mx-criteria-fill');
    expect(fill.getAttribute('style')).toContain('0');
    expect(fill.getAttribute('style')).not.toContain('NaN');
  });

  it('clamps a shown count that exceeds the total', () => {
    const { container } = mount({ shown: 300, total: 250 });
    const width = Number(container.querySelector('.mx-criteria-fill').getAttribute('style').match(/width:\s*([\d.]+)%/)[1]);
    expect(width).toBe(100);
  });
});

describe('MarketCriteriaRow — the cost of drawing it', () => {
  const src = fs.readFileSync(path.resolve('src/components/market/MarketCriteriaRow.jsx'), 'utf8');

  it('runs no timer, effect or animation', () => {
    for (const forbidden of ['useEffect', 'setInterval', 'setTimeout', 'requestAnimationFrame', 'framer-motion']) {
      expect(src.includes(forbidden), `must not contain ${forbidden}`).toBe(false);
    }
  });

  it('transitions only the rail width', () => {
    const css = fs.readFileSync(path.resolve('src/styles/market-intelligence.css'), 'utf8');
    const block = css.slice(css.indexOf('.mx-market .mx-criteria {'));
    // No blur: this row is redrawn on every 30s poll inside the scroll region.
    expect(block.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/backdrop-filter\s*:/);
    expect(block).toMatch(/\.mx-criteria-fill[\s\S]{0,200}transition:\s*width/);
  });
});

describe('MarketColumnHeader — the table roles are no longer orphans', () => {
  const src = fs.readFileSync(path.resolve('src/components/market/MarketColumnHeader.jsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const page = fs.readFileSync(path.resolve('src/pages/Market.jsx'), 'utf8');

  it('is wrapped in a real table > rowgroup before it claims role="row"', () => {
    /* A `role="row"` with no `table`/`rowgroup` ancestor is an orphan ARIA
       allows to exist and no browser resolves — which is how a five-cell
       header gets read as five unrelated items. The roles stay; the ancestors
       are what had to be added, and this asserts they are there. */
    expect(code).toMatch(/role="row"/);
    expect(code).toMatch(/role="columnheader"/);
    expect(page).toMatch(/role="table"/);
    expect(page).toMatch(/role="rowgroup"/);
    /* The wrapper must not introduce a box: `display: contents` keeps the
       existing grid layout byte-identical. */
    const css = fs.readFileSync(path.resolve('src/styles/market-intelligence.css'), 'utf8');
    expect(css).toMatch(/\.mx-table-semantics[\s\S]{0,200}display:\s*contents/);
  });

  it('never nests one columnheader inside another', () => {
    /* The change cell used to sit INSIDE the price cell, both columnheaders —
       invalid, and it made the price/change relationship unreadable. They are
       siblings now: count the opening tags and check the price wrapper closes
       before the change wrapper opens. */
    const opens = (code.match(/role="columnheader"/g) || []).length;
    expect(opens).toBe(3);
    const priceAt = code.indexOf("aria-sort={ariaSort('price')}");
    const changeAt = code.indexOf("aria-sort={ariaSort(changeSortKey)}");
    expect(priceAt).toBeGreaterThan(-1);
    expect(changeAt).toBeGreaterThan(priceAt);
    const between = code.slice(priceAt, changeAt);
    /* The price cell must CLOSE before the change cell opens. Its own opening
       tag is included in the slice, so a `</span>` before the next
       `className="mx-colhead-change"` is exactly that: the two are siblings. */
    const closeAt = between.indexOf('</span>');
    const changeOpenAt = between.indexOf('mx-colhead-change');
    expect(closeAt).toBeGreaterThan(-1);
    expect(changeOpenAt).toBeGreaterThan(closeAt);
  });

  it('states the sort in the accessible name and in aria-pressed', () => {
    expect(code).toMatch(/aria-pressed=\{sorted \? true : false\}/);
    expect(code).toMatch(/market\.criteriaAsc/);
    expect(code).toMatch(/market\.criteriaDesc/);
  });

  it('carries the state into the name for the active column only', () => {
    render(
      <MarketColumnHeader horizon="24h" sortKey="price" sortDir="desc" onSort={() => {}} />
    );
    /* The accessible name is the sort ACTION plus the current state:
       «Sort by price — descending». The old name was the action alone, so the
       direction existed only as an arrow path nobody could see. */
    const price = screen.getByRole('button', { name: /Sort by price — descending/ });
    expect(price.getAttribute('aria-pressed')).toBe('true');
    const change = screen.getByTestId('market-column-header').querySelector('[data-sort-key="change"]');
    expect(change.getAttribute('aria-pressed')).toBe('false');
    expect(change.getAttribute('aria-label')).not.toContain('descending');
  });

  it('sorts by the horizon the header was given', () => {
    const onSort = vi.fn();
    render(<MarketColumnHeader horizon="7d" sortKey="rank" sortDir="asc" onSort={onSort} />);
    const header = screen.getByTestId('market-column-header');
    fireEvent.click(header.querySelector('[data-sort-key="change7d"]'));
    expect(onSort).toHaveBeenCalledWith('change7d');
    expect(header.getAttribute('data-horizon')).toBe('7d');
  });
});
