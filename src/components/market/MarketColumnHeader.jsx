import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { GlyphSortAsc, GlyphSortDesc } from './MarketGlyphs.jsx';

/**
 * ─── THE COLUMN HEADER (2026-11-12) ─────────────────────────────────────────
 *
 * Every market table a reader has ever used has one, and this screen — the
 * app's home page, a 250-row table — had none. The list is a stack of cards:
 * rank, logo, name, a sparkline, a price and one percentage. Nothing on it said
 * what the right-hand number was measured over, and the sort lived in a popover
 * two controls away, so re-ordering the table meant opening a menu.
 *
 * ─── WHY THIS IS FIVE CELLS AND NOT SEVEN ──────────────────────────────────
 * A coin row puts each VALUE in one of five grid columns
 * (`21px 32px minmax(0,1fr) 58px 92px` — rank, logo, name, spark, right) and
 * stacks two readings inside two of them: the volume/market-cap figure under
 * the coin's name, and the price above the change pill. A header with separate
 * «قیمت» and «تغییر» columns would therefore point at columns that do not
 * exist and drift left of the numbers it names.
 *
 * So the header mirrors the row:
 *   • NAME + its second line — with the VOLUME sort, because the volume figure
 *     is printed under the name. Tapping there sorts by what you are looking at.
 *   • The right cell — two stacked buttons: PRICE over the horizon change, in
 *     the same order the price and the pill are stacked in the row.
 *
 * ─── WHY IT IS NOT STICKY *IN ITS OWN RULE* (2026-11-12, REVISED) ─────────
 * `market-tabs.css` already has a sticky tab strip. A second sticky bar under
 * it would take 34px from a 390px-wide phone's list for a label row that is
 * useful on the first screen and noise after it. A header that scrolls away is
 * the honest trade AT THAT WIDTH.
 *
 * It is the wrong trade at 1440px, where a reader forty rows into a five-column
 * table is looking at two stacked numbers in the right cell with nothing left
 * on screen to say which is the price and which is the change. So the row now
 * carries `data-sticky="true"`, and `market-benchmark.css` §2 turns that into
 * `position: sticky` ABOVE 620px only — the phone keeps exactly the decision
 * described above, and this rule stays true where it was made.
 *
 * The flag is an explicit attribute rather than a bare class so the behaviour
 * cannot arrive by accident: a component that renders this header without
 * asking for stickiness gets none.
 *
 * ─── WHY ARIA ROLES AND NOT A <table> ──────────────────────────────────────
 * The rows below are `<button>`s inside `<div>`s — a whole row has to be one tap
 * target. A native table would be a lie about the structure, so the roles
 * describe what is actually there, and `aria-sort` sits on the ONE active
 * column (never `"none"` on the rest — that is a word a screen reader repeats
 * on every header it passes).
 *
 * ─── AND WHY THE STRUCTURE WAS REBUILT (2026-11-12) ────────────────────────
 * The roles above were PRESENT AND BROKEN, which is the worst of both: a
 * `role="row"` and `role="columnheader"` are only meaningful inside
 * `role="table"` / `role="rowgroup"`, and nothing on the screen declared
 * either — so the tree carried table roles the browser could not resolve, and
 * a five-cell header was announced as five unrelated items. The change cell
 * was also a `columnheader` NESTED inside another `columnheader`, which is
 * invalid outright.
 *
 * The fix is not "delete the semantics", it is "make the ancestors real": the
 * page now wraps this row in `role="rowgroup"` inside a `role="table"` (see
 * `Market.jsx`), so the row and its column headers are where they claim to be
 * and `aria-sort` reaches the reader. The nesting was flattened — one
 * columnheader per cell, the price and change cells SIBLINGS rather than one
 * inside the other — and every button also carries `aria-pressed` plus its
 * state in the accessible name, so a reader who never hears `aria-sort`
 * (some mobile screen readers do not) still hears «قیمت — نزولی».
 */
function MarketColumnHeader({
  horizon = '24h',
  sortKey,
  sortDir,
  onSort,
  sticky = true,
}) {
  const { t } = useTranslation();
  const horizonLabel = t(`market.horizon.${horizon}`);
  const changeSortKey = changeKey(horizon);

  /*
   * `aria-sort` is the ONE piece of table semantics that earns its place here,
   * and only because `Market.jsx` gives this row a real `role="rowgroup"`
   * ancestor — a columnheader outside a table is the orphan the note above
   * describes. It sits on the cell, never on the button inside it (a button
   * with aria-sort is ignored), and only on the ACTIVE one: `aria-sort="none"`
   * on the rest is a word a screen reader repeats at every header it passes.
   */
  const ariaSort = (key) => {
    if (sortKey !== key) return undefined;
    return sortDir === 'asc' ? 'ascending' : 'descending';
  };

  const Direction = () => (sortDir === 'asc'
    ? <GlyphSortAsc width={11} height={11} aria-hidden="true" />
    : <GlyphSortDesc width={11} height={11} aria-hidden="true" />);

  /*
   * The state lives in the accessible NAME as well as in `aria-pressed`,
   * because a name is the only thing some assistive tech reads when a button
   * enters the tree: «قیمت» beside an arrow nobody can see is a button that
   * does nothing, while «قیمت — نزولی» is the same button with its state.
   */
  const ColButton = ({ sortAs, label, ariaLabel, sorted }) => (
    <button
      type="button"
      className="mx-col-btn"
      onClick={() => onSort?.(sortAs)}
      /* The visible label is short because a 92px column cannot hold
         «تغییر ۲۴ ساعت»; the accessible name carries the whole sentence. */
      aria-label={sorted
        ? `${ariaLabel} — ${t(sorted === 'asc' ? 'market.criteriaAsc' : 'market.criteriaDesc')}`
        : ariaLabel}
      aria-pressed={sorted ? true : false}
      data-sort-key={sortAs}
      data-active={sortKey === sortAs ? 'true' : undefined}
    >
      <span className="mx-col-label">{label}</span>
      {sortKey === sortAs && <Direction />}
    </button>
  );

  return (
    <div
      className="mx-colhead"
      role="row"
      data-testid="market-column-header"
      /* `market-benchmark.css` §2 reads this and makes the row sticky above
         620px. Defaulted true above; see the note there for why the phone
         keeps a non-sticky header. */
      data-sticky={sticky ? 'true' : undefined}
      data-horizon={horizon}
      aria-label={t('market.columnsAria')}
    >
      <span className="mx-colhead-rank" aria-hidden="true" />
      <span className="mx-colhead-logo" aria-hidden="true" />

      <span className="mx-colhead-name" role="columnheader" aria-sort={ariaSort('volume')}>
        <ColButton
          sortAs="volume"
          label={t('market.colName')}
          ariaLabel={t('market.colVolumeAria')}
          sorted={sortKey === 'volume' ? sortDir : null}
        />
      </span>

      <span className="mx-colhead-spark" aria-hidden="true" />

      <span className="mx-colhead-right">
        <span role="columnheader" aria-sort={ariaSort('price')}>
          <ColButton
            sortAs="price"
            label={t('market.colPrice')}
            ariaLabel={t('market.colPriceAria')}
            sorted={sortKey === 'price' ? sortDir : null}
          />
        </span>
        <span className="mx-colhead-change" role="columnheader" aria-sort={ariaSort(changeSortKey)}>
          <ColButton
            sortAs={changeSortKey}
            /* The change label IS the horizon: «۲۴ ساعت» becomes «۷ روز» when
               the rail moves, which is the point of having a rail. */
            label={horizonLabel}
            ariaLabel={t('market.colChangeAria', { window: horizonLabel })}
            sorted={sortKey === changeSortKey ? sortDir : null}
          />
        </span>
      </span>
    </div>
  );
}

/** The sort key that corresponds to a horizon — the same mapping the rail uses. */
export function changeKey(horizon) {
  if (horizon === '1h') return 'change1h';
  if (horizon === '7d') return 'change7d';
  return 'change';
}

/*
 * The sticky flag is opt-OUT, not opt-in at the call site: this is the market
 * table's header and the market table is the only thing that renders it, so
 * requiring `Market.jsx` to pass a boolean would be a second place to keep the
 * same decision. A future table that must NOT stick passes `sticky={false}`.
 * The default lives in the destructuring above — `defaultProps` is deprecated
 * on function components and warns at runtime in React 19.
 */

export default memo(MarketColumnHeader);
