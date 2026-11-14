// @vitest-environment jsdom
/**
 * THE COLUMN HEADER.
 *
 * The list is the app's home page and it is a 250-row table, and until now it
 * had no header: nothing said what the right-hand number measured, and the
 * sort lived in a popover two controls away. Every market table a reader has
 * used has a header row that names the columns and re-sorts when you tap it.
 *
 * What these tests guard, in order of how easy each is to get wrong:
 *   1. the geometry — the header MUST share the row's grid, or it drifts left
 *      of the numbers it labels (a misaligned header is worse than none);
 *   2. the label — the change column says the horizon the pills are printing,
 *      so header and pills cannot describe different windows;
 *   3. the behaviour — tap a column to sort by it, tap it again to reverse;
 *   4. the accessibility — `aria-sort` on the ACTIVE column only, and each
 *      button's accessible name is a sentence, not a 9px word.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor('fa'), i18n: { language: 'fa', resolvedLanguage: 'fa', changeLanguage: () => {} } })
}));

import MarketColumnHeader, { changeKey } from '../src/components/market/MarketColumnHeader.jsx';

afterEach(cleanup);

const mount = (props = {}) => render(
  <MarketColumnHeader sortKey="rank" sortDir="asc" onSort={() => {}} {...props} />
);

const header = () => screen.getByTestId('market-column-header');
const btn = (key) => header().querySelector(`[data-sort-key="${key}"]`);

describe('the column header', () => {
  it('mirrors the row grid exactly, at both breakpoints', () => {
    /* Two files must agree, so both are read: the row's grid is the source of
       truth, and a header with its own numbers would sit over the wrong values
       the first time either one changed. */
    const css = readFileSync('src/styles/market-intelligence.css', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const rowGrid = css.match(/\.mx-market \.mx-coin-row \.coin-row-open \{[^}]*grid-template-columns:\s*([^;]+);/)[1].trim();
    const headGrid = css.match(/\.mx-market \.mx-colhead \{[^}]*grid-template-columns:\s*([^;]+);/)[1].trim();
    expect(headGrid).toBe(rowGrid);

    /* And the phone override, same pair. */
    const phone = css.slice(css.lastIndexOf('@media (max-width: 619px)'));
    const rowPhone = css.match(/\.mx-market \.mx-coin-row \.coin-row-open \{ grid-template-columns: ([^;]+);/)[1].trim();
    const headPhone = phone.match(/\.mx-market \.mx-colhead \{[^}]*grid-template-columns:\s*([^;]+);/)[1].trim();
    expect(headPhone).toBe(rowPhone);
  });

  it('has five cells over the row’s five columns', () => {
    mount();
    const cells = [...header().children];
    expect(cells).toHaveLength(5);
    expect(cells[0].className).toContain('mx-colhead-rank');
    expect(cells[1].className).toContain('mx-colhead-logo');
    expect(cells[2].className).toContain('mx-colhead-name');
    expect(cells[3].className).toContain('mx-colhead-spark');
    expect(cells[4].className).toContain('mx-colhead-right');
  });

  it('labels the change column with the horizon the pills are printing', () => {
    mount({ horizon: '24h' });
    expect(btn('change').textContent).toContain(fa.market.horizon['24h']);
    cleanup();

    mount({ horizon: '7d' });
    /* The 7d rail must move BOTH the sort key and the label. */
    expect(btn('change7d')).toBeTruthy();
    expect(btn('change7d').textContent).toContain(fa.market.horizon['7d']);
    expect(btn('change')).toBeNull();
    cleanup();

    mount({ horizon: '1h' });
    expect(btn('change1h').textContent).toContain(fa.market.horizon['1h']);
  });

  it('maps a horizon to its sort key the same way the rail does', () => {
    expect(changeKey('1h')).toBe('change1h');
    expect(changeKey('24h')).toBe('change');
    expect(changeKey('7d')).toBe('change7d');
  });

  it('sorts on tap and reverses on the second tap', () => {
    const onSort = vi.fn();
    const { rerender } = render(
      <MarketColumnHeader sortKey="rank" sortDir="asc" onSort={onSort} />
    );
    fireEvent.click(btn('price'));
    expect(onSort).toHaveBeenCalledWith('price');

    /* The parent decides what a tap means; this component only reports which
       column was tapped. That keeps the "same column flips" rule in one place
       (Market.jsx `flipOrChoose`) instead of duplicating it here. */
    rerender(<MarketColumnHeader sortKey="price" sortDir="desc" onSort={onSort} />);
    fireEvent.click(btn('price'));
    expect(onSort).toHaveBeenCalledTimes(2);
    expect(onSort).toHaveBeenLastCalledWith('price');
  });

  it('exposes aria-sort on the active column only', () => {
    mount({ sortKey: 'price', sortDir: 'desc' });
    const sorted = header().querySelectorAll('[aria-sort]');
    expect(sorted).toHaveLength(1);
    expect(sorted[0].getAttribute('aria-sort')).toBe('descending');

    cleanup();
    mount({ sortKey: 'change', sortDir: 'asc' });
    const asc = header().querySelectorAll('[aria-sort]');
    expect(asc).toHaveLength(1);
    expect(asc[0].getAttribute('aria-sort')).toBe('ascending');
  });

  it('marks the active button for styling, and only that one', () => {
    mount({ sortKey: 'volume', sortDir: 'desc' });
    const active = header().querySelectorAll('.mx-col-btn[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('data-sort-key')).toBe('volume');
  });

  it('gives every button a spoken name longer than its label', () => {
    /* A 9px column label is not a sentence. «قیمت» alone tells a screen reader
       nothing about what pressing it does; the accessible name says
       «مرتب‌سازی بر اساس قیمت». */
    mount({ horizon: '7d' });
    for (const b of header().querySelectorAll('.mx-col-btn')) {
      const name = b.getAttribute('aria-label');
      expect(name, 'every sort button needs an accessible name').toBeTruthy();
      expect(name).not.toContain('market.');
      expect(name.length).toBeGreaterThan(4);
      /* The horizon must be interpolated, not left as a placeholder. */
      expect(name).not.toContain('{{');
    }
  });

  it('speaks all twelve locales, with the horizon interpolated', () => {
    const locales = ['fa', 'en', 'ar', 'ur', 'es', 'fr', 'tr', 'ru', 'zh', 'hi', 'pt', 'id'];
    for (const loc of locales) {
      const json = JSON.parse(readFileSync(`src/i18n/locales/${loc}.json`, 'utf8'));
      for (const key of ['columnsAria', 'colName', 'colPrice', 'colVolume',
        'colPriceAria', 'colVolumeAria', 'colChangeAria']) {
        const value = json.market?.[key];
        expect(typeof value, `${loc}.market.${key}`).toBe('string');
        expect(value.trim().length, `${loc}.market.${key} is empty`).toBeGreaterThan(0);
        expect(value).not.toContain('market.');
      }
      expect(json.market.colChangeAria).toContain('{{window}}');
    }
  });

  it('does not invent a material: no background, border or blur of its own', () => {
    /* The labels sit on the card the rows are already on. A second plate above
       the list would be a visual boundary that means nothing — and a blur here
       would be exactly the per-frame cost market-perf.css §9 removed. */
    const css = readFileSync('src/styles/market-intelligence.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const block = css.slice(css.indexOf('.mx-market .mx-colhead {'));
    const head = block.slice(0, block.indexOf('}'));
    expect(head).not.toMatch(/backdrop-filter/);
    expect(head).not.toMatch(/background:[^;]*gradient/);
    expect(head).not.toMatch(/box-shadow/);
    expect(head).not.toMatch(/position:\s*sticky/);
  });
});
