/**
 * PAIR SELECT — Portalled Perpetual Market Picker Modal.
 * ---------------------------------------------------------------------------
 * «انتخاب توکن باید پاپ اپ با اندازه و فاصله درست باشد الان نیمی صفحه در موبایل نمیاد»
 *
 * Portals `.ps-panel` into `document.body` inside a centered/responsive
 * viewport-safe modal backdrop (`.ps-backdrop`) so it never clips or slides
 * half off-screen on mobile phones or inside overflow-clipped containers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TokenIcon from '../../lib/tokenIcon';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';

const VENUE_FILTERS = ['all', 'velocity', 'ostium', 'dydx'];
const VENUE_RANK = { velocity: 0, ostium: 1, dydx: 2 };

export default function PairSelect({ options = [], selected, onSelect, images = null, loading = false, testId = 'pair-select' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [venue, setVenue] = useState('all');
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const buttonRef = useRef(null);

  const rows = useMemo(() => (Array.isArray(options) ? options : []), [options]);

  /* Outside tap or Escape closes; body scroll locks while modal is open. */
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* Focus lands on the search field, ready to type. */
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => searchRef.current?.focus(), 40);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return rows.filter((m) => {
      if (venue !== 'all' && !(m.venues || []).includes(venue)) return false;
      if (!q) return true;
      const name = String(images?.[m.base]?.name || m.name || '').toUpperCase();
      return m.base.toUpperCase().includes(q) || name.includes(q);
    });
  }, [rows, query, venue, images]);

  const current = rows.find((m) => m.base === selected) || null;
  const currentImage = images?.[selected]?.image || null;

  const pick = (base) => {
    onSelect?.(base);
    setOpen(false);
    setQuery('');
  };

  const modal = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="ps-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div
          ref={panelRef}
          className="ps-panel"
          role="listbox"
          aria-label={t('perpTerminal.pairSelectLabel', { defaultValue: 'Select a perpetual market' })}
          data-testid="pair-select-panel"
        >
          <div className="ps-modal-head">
            <div className="ps-modal-titles">
              <div className="ps-modal-title-row">
                <strong className="ps-modal-title">
                  {t('perpTerminal.pairModalTitle', { defaultValue: 'Select Perpetual Market' })}
                </strong>
                <span className="ps-count pt-mono">
                  {t('perpTerminal.pairModalCount', { n: filtered.length, defaultValue: `${filtered.length} markets` })}
                </span>
              </div>
              <span className="ps-modal-sub">
                {t('perpTerminal.pairModalSub', { defaultValue: 'Search by ticker or filter by settlement venue' })}
              </span>
            </div>
            <button
              type="button"
              className="ps-close-btn"
              onClick={() => { setOpen(false); buttonRef.current?.focus(); }}
              aria-label={t('perpTerminal.pairModalClose', { defaultValue: 'Close' })}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="ps-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('perpTerminal.pairSelectSearch', { defaultValue: 'Search a market…' })}
              aria-label={t('perpTerminal.pairSelectSearch', { defaultValue: 'Search a market…' })}
              data-testid="pair-select-search"
              spellCheck={false}
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                className="ps-search-clear"
                onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                aria-label={t('common.clear', { defaultValue: 'Clear' })}
              >
                ×
              </button>
            )}
          </div>

          <div className="ps-venues" role="group" aria-label={t('perpTerminal.venueFilter', { defaultValue: 'Filter by venue' })}>
            {VENUE_FILTERS.map((v) => (
              <button
                key={v}
                type="button"
                className={`ps-venue-chip ${venue === v ? 'is-on' : ''}`}
                onClick={() => setVenue(v)}
                data-testid={`pair-select-venue-${v}`}
                aria-pressed={venue === v}
              >
                {v === 'all' ? t('perpTerminal.venueAll', { defaultValue: 'All' }) : t(`perpTerminal.venue.${v}`, { defaultValue: v })}
              </button>
            ))}
          </div>

          <ul className="ps-list">
            {filtered.map((m) => {
              const img = images?.[m.base]?.image || null;
              const active = m.base === selected;
              return (
                <li key={m.base}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`ps-option ${active ? 'is-on' : ''}`}
                    onClick={() => pick(m.base)}
                    data-testid={`pair-select-option-${m.base}`}
                  >
                    <span className="ps-option-avatar">
                      <TokenIcon token={{ symbol: m.base, image: img }} size={32} />
                    </span>
                    <span className="ps-option-id">
                      <span className="ps-option-sym pt-mono" dir="ltr">
                        {m.base}<span className="ps-option-quote">/USD</span>
                      </span>
                      <span className="ps-option-sub">
                        <span className="ps-option-name">{images?.[m.base]?.name || t('perpTerminal.pairPerp', { defaultValue: 'Perpetual' })}</span>
                        <span className="ps-option-badges">
                          {[...(m.venues || [])].sort((a, b) => (VENUE_RANK[a] ?? 9) - (VENUE_RANK[b] ?? 9)).map((v) => (
                            <span key={v} className={`ps-badge ps-badge-${v}`}>{t(`perpTerminal.venueShort.${v}`, { defaultValue: v })}</span>
                          ))}
                        </span>
                      </span>
                    </span>
                    <span className="ps-option-nums pt-mono">
                      <span className="ps-option-price">{m.price != null ? fmtPrice(m.price) : '—'}</span>
                      <span className={`ps-option-chg ${m.change24hPct > 0 ? 'is-up' : m.change24hPct < 0 ? 'is-down' : 'is-flat'}`}>
                        {m.change24hPct != null ? fmtPct(m.change24hPct) : '—'}
                      </span>
                      {m.volume24hUsd != null && <span className="ps-vol">{fmtCompact(m.volume24hUsd)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="ps-empty" data-testid="pair-select-empty">
                {loading
                  ? t('perpTerminal.pairSelectLoading', { defaultValue: 'Reading the venue catalogues…' })
                  : t('perpTerminal.pairSelectNone', { defaultValue: 'No venue-settled market matches that search.' })}
              </li>
            )}
          </ul>

          <p className="ps-foot">{t('perpTerminal.pairSelectFoot', { defaultValue: 'Only markets settled by an in-app venue are listed here.' })}</p>
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <div className="ps-root" ref={rootRef} data-testid={testId}>
      <button
        type="button"
        ref={buttonRef}
        className={`ps-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="pair-select-button"
      >
        <span className="ps-trigger-avatar">
          <TokenIcon token={{ symbol: selected || '?', image: currentImage }} size={32} />
        </span>
        <span className="ps-trigger-text">
          <span className="ps-trigger-sym pt-mono" dir="ltr">
            {selected || '—'}<span className="ps-trigger-quote">-PERP</span>
          </span>
          <span className="ps-trigger-sub">
            {current?.venues?.length
              ? current.venues.map((v) => t(`perpTerminal.venue.${v}`, { defaultValue: v })).join(' · ')
              : t('perpTerminal.pairSelectVenue', { defaultValue: 'venue-settled markets' })}
          </span>
        </span>
        <span className="ps-trigger-chev-box" aria-hidden="true">
          <svg className="ps-trigger-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {modal}
    </div>
  );
}
