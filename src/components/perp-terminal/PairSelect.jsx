import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FullScreenSheet from '../FullScreenSheet';
import TokenIcon from '../../lib/tokenIcon';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';

const VENUE_FILTERS = ['all', 'velocity', 'ostium', 'dydx'];
const VENUE_RANK = { velocity: 0, ostium: 1, dydx: 2 };

export default function PairSelect({ options = [], selected, onSelect, images = null, loading = false, testId = 'pair-select' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [venue, setVenue] = useState('all');
  const close = useCallback(() => setOpen(false), []);
  const panelId = useId();
  const searchRef = useRef(null);

  const rows = useMemo(() => (Array.isArray(options) ? options : []), [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return rows.filter((m) => {
      if (venue !== 'all' && !(m.venues || []).includes(venue)) return false;
      if (!q) return true;
      const name = String(images?.[m.base]?.name || m.name || '').toUpperCase();
      return m.base.toUpperCase().includes(q) || name.includes(q);
    });
  }, [rows, query, venue, images]);

  const currentImage = images?.[selected]?.image || null;

  const pick = (base) => {
    onSelect?.(base);
    setOpen(false);
    setQuery('');
  };

  const searchPanel = (
        <div className="ptx ps-sheet-panel" id={panelId} data-testid="pair-select-panel">
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

          <ul className="ps-list" aria-label={t('perpTerminal.pairSelectLabel')}>
            {filtered.map((m) => {
              const img = images?.[m.base]?.image || null;
              const active = m.base === selected;
              return (
                <li key={m.base}>
                  <button
                    type="button"
                    aria-pressed={active}
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
  );

  return (
    <div className="ps-root" data-testid={testId}>
      <button
        type="button"
        className={`ps-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
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
        </span>
        <span className="ps-trigger-chev-box" aria-hidden="true">
          <svg className="ps-trigger-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <FullScreenSheet manageFocus open={open} onClose={close} className="futures-full-sheet ps-market-sheet"
        title={t('perpTerminal.pairSelectLabel')} closeLabel={t('common.close')} testId={`${testId}-sheet`}>
        {searchPanel}
      </FullScreenSheet>
    </div>
  );
}
