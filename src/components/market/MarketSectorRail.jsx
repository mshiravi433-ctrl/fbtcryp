import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GlyphGrid, SECTOR_GLYPHS } from './MarketGlyphs.jsx';

/** Native touch/trackpad scrolling, with mouse drag and keyboard equivalents.
 * No carousel timer: a selected category must never move out from under a tap.
 */
export default function MarketSectorRail({ sectors, selected, onSelect }) {
  const { t } = useTranslation();
  const railRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const onWheel = (event) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (rail.scrollWidth <= rail.clientWidth) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1;
      const direction = getComputedStyle(rail).direction === 'rtl' ? -1 : 1;
      const before = rail.scrollLeft;
      rail.scrollLeft += direction * event.deltaY * unit;
      // At either end, let the page keep scrolling instead of trapping it.
      if (Math.abs(rail.scrollLeft - before) > 0.5) event.preventDefault();
    };
    rail.addEventListener('wheel', onWheel, { passive: false });
    return () => rail.removeEventListener('wheel', onWheel);
  }, []);

  const endDrag = (event) => {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || drag.id !== event.pointerId) return;
    suppressClick.current = drag.moved && event.type !== 'pointercancel';
    dragRef.current = null;
    delete rail.dataset.dragging;
    if (rail.hasPointerCapture?.(event.pointerId)) rail.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const rail = railRef.current;
    const buttons = [...rail.querySelectorAll('button')];
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    const rtl = getComputedStyle(rail).direction === 'rtl';
    const step = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, current + step));
    event.preventDefault();
    buttons[next]?.focus({ preventScroll: true });
    buttons[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  };

  return (
    <div className="mx-sector-rail" data-tab-swipe-ignore>
      <div
        ref={railRef}
        className="mx-sectors mx-sectors-rail"
        data-horizontal-scroll
        role="group"
        aria-label={t('market.sectorsAria')}
        data-testid="market-sector-rail"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          suppressClick.current = false;
          if (event.pointerType !== 'mouse' || event.button !== 0) return;
          dragRef.current = { id: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.id !== event.pointerId) return;
          const delta = event.clientX - drag.x;
          if (!drag.moved && Math.abs(delta) < 6) return;
          drag.moved = true;
          event.currentTarget.dataset.dragging = 'true';
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.currentTarget.scrollLeft = drag.scroll - delta;
        }}
        onPointerLeave={() => { if (!dragRef.current?.moved) dragRef.current = null; }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }}
        onDragStart={(event) => event.preventDefault()}
      >
        {[null, ...sectors].map((sector) => {
          // New network categories reuse the neutral grid mark until they have
          // a dedicated illustration; an undefined glyph must never break the rail.
          const Glyph = sector ? (SECTOR_GLYPHS[sector] || GlyphGrid) : GlyphGrid;
          const active = selected === sector;
          return (
            <button
              key={sector ?? 'all'}
              type="button"
              className="mx-sector"
              data-sector={sector ?? 'all'}
              data-active={active ? 'true' : undefined}
              aria-pressed={active}
              onClick={() => onSelect(active ? null : sector)}
            >
              <span className="mx-sector-tile" aria-hidden="true"><Glyph className="mx-sector-icon" width={16} height={16} /></span>
              <span className="mx-sector-label">{t(sector ? `market.sector.${sector}` : 'marketIntel.allSectors')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
