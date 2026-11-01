import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MARKET_TABS, nextMarketTab } from '../../lib/marketTabs.js';
import { MarketPaneGlyph } from './MarketGlyphs.jsx';

/**
 * «مرور / توکن» — THE TWO TABS OF THE MARKET SCREEN.
 * ---------------------------------------------------------------------------
 * Requested: «در صفحه بازار دو تب کن … تب‌ها از تم اصلی و ظاهر پیروی کند».
 *
 * ─── WHAT THIS IS, IN ONE SENTENCE ─────────────────────────────────────────
 * A segmented control that follows the sheet's existing material (the same
 * glass body, the same prism rim, the same accent tokens as the boxes it
 * switches between), never a new design language and never a second header.
 *
 * ─── THE ACCESSIBILITY CONTRACT ────────────────────────────────────────────
 * A tablist is not a row of buttons: it is ONE stop in the tab order, and the
 * arrow keys move between its tabs. So every tab carries `role="tab"`,
 * `aria-selected`, and `tabIndex={active ? 0 : -1}`, and Left/Right are
 * mirrored for Farsi — ArrowRight means «the next tab» in an RTL document,
 * which is why the direction is read here and the ARITHMETIC lives in
 * lib/marketTabs.js where a test can pin both directions without a DOM.
 *
 * Home/End jump to the first and last tab, per the pattern. Every other key is
 * left to the browser, so Tab still leaves the strip.
 *
 * ─── WHY THE ARROW IS A DRAWN GLYPH, NOT A TEXT CHEVRON ────────────────────
 * The same rule as the rest of this screen (see MarketGlyphs.jsx): a typed
 * arrow arrives as platform artwork with its own weight and baseline, and
 * cannot inherit the accent colour of the tab that is lit.
 */
export default function MarketTabStrip({ active, onChange, overviewId, tokensId }) {
  const { t, i18n } = useTranslation();
  const listRef = useRef(null);

  /*
   * The direction of the document, from the router's own answer first (i18n
   * knows the language even before <html dir> is written) and from the DOM
   * second. `dir()` returns undefined in the test mock, so both are checked.
   */
  const dir = i18n?.dir?.();
  const rtl = dir
    ? dir === 'rtl'
    : typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  const ids = { overview: overviewId, tokens: tokensId };

  const onKeyDown = useCallback((event) => {
    const next = nextMarketTab(active, event.key, rtl);
    if (!next) return;
    event.preventDefault();
    onChange?.(next);
    /* Focus follows selection, so the next arrow key continues from the tab
       the reader is now standing on rather than from the one they left. */
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-tab="${next}"]`)?.focus();
    });
  }, [active, onChange, rtl]);

  return (
    <div className="mx-tabs-wrap" data-testid="market-tabs-strip">
      <div
        className="mx-tabs"
        id="market-tabs"
        role="tablist"
        aria-label={t('market.tabs.aria')}
        ref={listRef}
        onKeyDown={onKeyDown}
        data-active={active}
      >
        {/* The moving plate. One element for both tabs: its position is driven
            by `data-active` on the strip, so the switch is a single transform
            and the strip's DOM does not change shape between tabs. */}
        <span className="mx-tabs-thumb" aria-hidden="true" />
        {MARKET_TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`market-tab-${tab.id}`}
              className="mx-tab"
              data-tab={tab.id}
              data-active={selected ? 'true' : undefined}
              aria-selected={selected}
              aria-controls={ids[tab.id]}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange?.(tab.id)}
            >
              <span className="mx-tab-glyph" aria-hidden="true">
                <MarketPaneGlyph name={tab.glyph} width={15} height={15} />
              </span>
              <span className="mx-tab-label">{t(tab.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
