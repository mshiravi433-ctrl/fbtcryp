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
 * ─── WHY IT IS NOT STICKY ──────────────────────────────────────────────────
 * `market-tabs.css` already has a sticky tab strip. A second sticky bar under
 * it would take 34px from a 390px-wide phone's list for a label row that is
 * useful on the first screen and noise after it. A header that scrolls away is
 * the honest trade at this width.
 *
 * ─── WHY ARIA ROLES AND NOT A <table> ──────────────────────────────────────
 * The rows below are `<button>`s inside `<div>`s — a whole row has to be one tap
 * target. A native table would be a lie about the structure, so the roles
 * describe what is actually there: a rowgroup with header cells, and
 * `aria-sort` on the ONE active column (never `"none"` on the rest — that is a
 * word a screen reader repeats on every header it passes).
 */
function MarketColumnHeader({
  horizon = '24h',
  sortKey,
  sortDir,
  onSort,
}) {
  const { t } = useTranslation();
  const horizonLabel = t(`market.horizon.${horizon}`);
  const changeSortKey = changeKey(horizon);

  const ariaSort = (key) => {
    if (sortKey !== key) return undefined;
    return sortDir === 'asc' ? 'ascending' : 'descending';
  };

  const Direction = () => (sortDir === 'asc'
    ? <GlyphSortAsc width={11} height={11} aria-hidden="true" />
    : <GlyphSortDesc width={11} height={11} aria-hidden="true" />);

  const ColButton = ({ sortAs, label, ariaLabel }) => (
    <button
      type="button"
      className="mx-col-btn"
      onClick={() => onSort?.(sortAs)}
      /* The visible label is short because a 92px column cannot hold
         «تغییر ۲۴ ساعت»; the accessible name carries the whole sentence. */
      aria-label={ariaLabel}
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
      aria-label={t('market.columnsAria')}
      data-testid="market-column-header"
      data-horizon={horizon}
    >
      <span className="mx-colhead-rank" aria-hidden="true" />
      <span className="mx-colhead-logo" aria-hidden="true" />

      <span
        className="mx-colhead-name"
        role="columnheader"
        aria-sort={ariaSort('volume')}
      >
        <ColButton
          sortAs="volume"
          label={t('market.colName')}
          ariaLabel={t('market.colVolumeAria')}
        />
      </span>

      <span className="mx-colhead-spark" aria-hidden="true" />

      <span className="mx-colhead-right" role="columnheader" aria-sort={ariaSort('price')}>
        <ColButton
          sortAs="price"
          label={t('market.colPrice')}
          ariaLabel={t('market.colPriceAria')}
        />
        <span className="mx-colhead-change" aria-sort={ariaSort(changeSortKey)} role="columnheader">
          <ColButton
            sortAs={changeSortKey}
            /* The change label IS the horizon: «۲۴ ساعت» becomes «۷ روز» when
               the rail moves, which is the point of having a rail. */
            label={horizonLabel}
            ariaLabel={t('market.colChangeAria', { window: horizonLabel })}
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

export default memo(MarketColumnHeader);
