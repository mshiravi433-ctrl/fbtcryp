import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../lib/format';

/**
 * ─── «چه چیزی این فهرست را این‌گونه کرد»: THE FILTERS, AS ONE ROW ────────
 *
 * The list is the product of four independent controls: a search box, a
 * sector rail, a five-chip view row and a sort popover with seven keys, on top
 * of a 60-row render budget inside a 250..750-row feed. When a reader lands on
 * a list of nine rows they had to piece the answer together from:
 *
 *   • a chip lit somewhere above the fold,
 *   • a sector chip lit somewhere else,
 *   • the text still sitting in the search box,
 *   • a sort popover that is CLOSED and therefore invisible,
 *   • and a footer sixty pixels below that says «۶۰ از ۷۵۰».
 *
 * Worse, three of those are LOSSY: the footer prints the same number for "60
 * of 250, tap to reveal 60 more instantly" and "60 of 250, the next 60 costs a
 * request", which are different promises.
 *
 * So the current reading is stated once, above the rows, in the same order a
 * reader would ask: WHAT is it a subset of (a sentence), WHICH constraints are
 * on (removable tokens, each with an ✕), and HOW MUCH of the feed is on screen
 * (a progress rail with words under it).
 *
 * ─── WHY THE TOKENS ARE REMOVABLE AND THE FOOTER IS NOT ────────────────────
 * A constraint that cannot be seen cannot be removed: before this, the only
 * way to leave a sector was to scroll back UP to a rail above the fold and
 * find the lit chip. Here every active constraint is a chip with an ✕ sitting
 * directly above the list it is constraining — the same reason every file
 * manager puts its filter bar above the files.
 *
 * ─── NOTHING HERE IS ANIMATED ──────────────────────────────────────────────
 * One `transition` on the rail's fill width and nothing else: this row sits
 * inside the scroll area of the app's home screen, and `market-perf.css` §9
 * already records what a blur or a keyframe in that region costs. The chips
 * are `filter: none`, the rail is a 2px gradient bar, and there is no entrance
 * animation on any of it, because this row is DRAWN ON EVERY POLL.
 */
function Chip({ label, onRemove, testId, tone }) {
  const { t } = useTranslation();
  return (
    <span className="mx-criteria-chip" data-tone={tone ?? 'neutral'} data-testid={testId}>
      <span className="mx-criteria-chip-label">{label}</span>
      {onRemove && (
        <button
          type="button"
          className="mx-criteria-chip-x"
          onClick={onRemove}
          /* The ✕ is 18px; the accessible name says what it removes, because
             «×» alone is the worst button label on the internet. */
          aria-label={t('market.criteriaRemove', { item: label })}
          data-testid={testId ? `${testId}-remove` : undefined}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      )}
    </span>
  );
}

/**
 * @param {object}   props
 * @param {string}   props.headline   Already-translated sentence naming the list.
 * @param {Array}    props.criteria   `{ id, label, tone?, onRemove? }` — the active
 *                                    constraints, in the order they were applied.
 * @param {number}   props.shown      Rows rendered.
 * @param {number}   props.total      Rows this view holds (may exceed the feed).
 * @param {number}   [props.feedSize] Rows loaded from the provider; when it is a
 *                                    different promise from `total`, the caption says so.
 * @param {'memory'|'request'|null} [props.nextKind] Where the next rows come from.
 * @param {Function} [props.onReset]  Clears every constraint at once.
 */
function MarketCriteriaRow({
  headline,
  criteria = [],
  shown = 0,
  total = 0,
  nextKind = null,
  onReset,
  testId = 'market-criteria'
}) {
  const { t } = useTranslation();

  const pct = total > 0 ? Math.min(100, Math.max(0, (shown / total) * 100)) : 0;
  const remaining = Math.max(0, total - shown);

  /*
   * THE SENTENCE UNDER THE RAIL, AND WHY IT HAS THREE BRANCHES.
   *
   *   nothing left            → «همهٔ ۶۰ نمایش داده شد» (a completion, not a promise)
   *   rows already in memory  → «۶۰ از ۲۵۰ — بقیه بدون درخواست» (instant)
   *   the next page is a call → «۶۰ از ۲۵۰ — صفحهٔ بعد درخواست دارد» (not instant)
   *
   * The old footer said «۶۰ از ۲۵۰» for both of the last two, which is how a
   * reader learns to distrust a button.
   */
  const caption = remaining === 0
    ? t('market.criteriaAllShown', { count: fmtNum(shown) })
    : nextKind === 'memory'
      ? t('market.criteriaInMemory', { shown: fmtNum(shown), total: fmtNum(total) })
      : nextKind === 'request'
        ? t('market.criteriaNeedsRequest', { shown: fmtNum(shown), total: fmtNum(total) })
        : t('market.criteriaOfTotal', { shown: fmtNum(shown), total: fmtNum(total) });

  return (
    <div className="mx-criteria" data-testid={testId}>
      <div className="mx-criteria-head">
        <p className="mx-criteria-headline" data-testid={`${testId}-headline`}>{headline}</p>
        {criteria.length > 0 && onReset && (
          <button
            type="button"
            className="mx-criteria-reset"
            onClick={onReset}
            data-testid={`${testId}-reset`}
          >
            {t('market.criteriaReset')}
          </button>
        )}
      </div>

      {criteria.length > 0 && (
        <div className="mx-criteria-chips">
          {criteria.map((c) => (
            <Chip key={c.id} label={c.label} tone={c.tone} onRemove={c.onRemove} testId={`${testId}-${c.id}`} />
          ))}
        </div>
      )}

      <div className="mx-criteria-scope">
        <span className="mx-criteria-rail" aria-hidden="true">
          <span className="mx-criteria-fill" style={{ width: `${pct.toFixed(1)}%` }} />
        </span>
        <span className="mx-criteria-caption" data-testid={`${testId}-caption`}>{caption}</span>
      </div>
    </div>
  );
}

export default memo(MarketCriteriaRow);
