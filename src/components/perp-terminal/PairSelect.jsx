/**
 * PAIR SELECT — the token picker of the terminal.
 * ---------------------------------------------------------------------------
 * «برای انتخاب توکن ها با لوگو و باکس بازشونده باشد»
 *
 * One button (logo + symbol) opens a dropdown panel with search and a venue
 * filter. The list is the EXECUTION UNIVERSE — only markets an in-app venue
 * settles — which is deliberately a different catalogue from the Perpetual
 * tab's market-cap list: two screens, two jobs, two sets of markets.
 *
 *   • every row carries the token's logo (CoinGecko image when the parent
 *     feed knows one, a deterministic monogram otherwise — never a broken
 *     image icon);
 *   • venue badges say WHERE the pair settles (Velocity / Ostium / dYdX);
 *   • search matches symbol or name; the venue chips narrow it further;
 *   • keyboard: Escape closes, focus returns to the trigger — a dropdown a
 *     keyboard cannot leave is a trap.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const searchRef = useRef(null);
  const buttonRef = useRef(null);

  const rows = useMemo(() => (Array.isArray(options) ? options : []), [options]);

  /* Outside tap or Escape closes; returning focus to the trigger keeps the
     keyboard trap-free. */
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  /* Focus lands on the search field, ready to type. */
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => searchRef.current?.focus(), 50);
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
        <TokenIcon token={{ symbol: selected || '?', image: currentImage }} size={30} />
        <span className="ps-trigger-text">
          <span className="ps-trigger-sym" dir="ltr">{selected || '—'}<span className="ps-trigger-quote">-PERP</span></span>
          <span className="ps-trigger-sub">
            {current?.venues?.length
              ? current.venues.map((v) => t(`perpTerminal.venue.${v}`, { defaultValue: v })).join(' · ')
              : t('perpTerminal.pairSelectVenue', { defaultValue: 'venue-settled markets' })}
          </span>
        </span>
        <svg className="ps-trigger-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="ps-panel" role="listbox" aria-label={t('perpTerminal.pairSelectLabel', { defaultValue: 'Select a perpetual market' })} data-testid="pair-select-panel">
          <div className="ps-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
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
              <button type="button" className="ps-search-clear" onClick={() => setQuery('')} aria-label={t('common.clear', { defaultValue: 'Clear' })}>×</button>
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
            <span className="ps-count mono">{filtered.length}</span>
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
                    <TokenIcon token={{ symbol: m.base, image: img }} size={26} />
                    <span className="ps-option-id">
                      <span className="ps-option-sym" dir="ltr">{m.base}<span className="ps-option-quote">/USD</span></span>
                      <span className="ps-option-name">{images?.[m.base]?.name || t('perpTerminal.pairPerp', { defaultValue: 'Perpetual' })}</span>
                    </span>
                    <span className="ps-option-nums">
                      <span className="ps-option-price mono">{m.price != null ? fmtPrice(m.price) : '—'}</span>
                      <span className={`ps-option-chg mono ${m.change24hPct > 0 ? 'is-up' : m.change24hPct < 0 ? 'is-down' : ''}`}>
                        {m.change24hPct != null ? fmtPct(m.change24hPct) : '—'}
                      </span>
                    </span>
                    <span className="ps-option-badges">
                      {[...(m.venues || [])].sort((a, b) => (VENUE_RANK[a] ?? 9) - (VENUE_RANK[b] ?? 9)).map((v) => (
                        <span key={v} className={`ps-badge ps-badge-${v}`}>{t(`perpTerminal.venueShort.${v}`, { defaultValue: v })}</span>
                      ))}
                      {m.volume24hUsd != null && <span className="ps-vol mono">{fmtCompact(m.volume24hUsd)}</span>}
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
      )}
    </div>
  );
}
