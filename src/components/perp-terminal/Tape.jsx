/**
 * THE TAPE — Redesigned recent trade stream inside a glass telemetry box.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { tapeRows } from './desk.js';

const fmtPrice = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const digits = n >= 1000 ? 1 : n >= 1 ? 2 : n >= 0.01 ? 5 : 8;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtSize = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(n >= 1 ? 3 : 5);
};
const fmtUsd = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
};
const fmtClock = (ms, locale) => {
  const t = Number(ms);
  if (!Number.isFinite(t)) return '—';
  try {
    return new Date(t).toLocaleTimeString(locale === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return new Date(t).toISOString().slice(11, 19);
  }
};

export default function Tape({ trades = [], live = false, loading = false, reason = null, testId = 'perp-tape' }) {
  const { t, i18n } = useTranslation();
  const tape = useMemo(() => tapeRows(trades), [trades]);
  const locale = i18n?.language || 'en';

  if (loading && !tape.rows.length) {
    return (
      <div className="pt-tape" data-testid={testId}>
        <div className="pt-panel-head">
          <div className="pt-panel-title-wrap">
            <span className="pt-panel-dot is-emerald" aria-hidden="true" />
            <span className="pt-panel-title">{t('perpTerminal.tape.title', { defaultValue: 'Tape' })}</span>
          </div>
        </div>
        <div className="pt-tape-box">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="pt-skel pt-skel-row" />
          ))}
        </div>
      </div>
    );
  }

  if (!tape.rows.length) {
    return (
      <div className="pt-tape" data-testid={testId}>
        <div className="pt-panel-head">
          <div className="pt-panel-title-wrap">
            <span className="pt-panel-dot is-emerald" aria-hidden="true" />
            <span className="pt-panel-title">{t('perpTerminal.tape.title', { defaultValue: 'Tape' })}</span>
          </div>
        </div>
        <div className="pt-empty-box">
          <span className="pt-empty-ico" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </span>
          <p className="pt-empty" data-testid="perp-tape-empty">
            {reason === 'INDEXER_UNAVAILABLE'
              ? t('perpTerminal.tape.unavailable', { defaultValue: 'The indexer is not answering, so there are no prints to show.' })
              : t('perpTerminal.tape.none', { defaultValue: 'No trades in the window the venue returned.' })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-tape" data-testid={testId}>
      <div className="pt-panel-head">
        <div className="pt-panel-title-wrap">
          <span className="pt-panel-dot is-emerald" aria-hidden="true" />
          <span className="pt-panel-title">{t('perpTerminal.tape.title', { defaultValue: 'Tape' })}</span>
          {live && <span className="pt-live" aria-label={t('perpTerminal.live', { defaultValue: 'live' })} />}
        </div>
        {tape.buySharePct != null && (
          <span className="pt-pill-stat pt-mono" data-testid="perp-tape-buyshare">
            {t('perpTerminal.tape.buys', { defaultValue: 'buys' })} {tape.buySharePct.toFixed(0)}%
          </span>
        )}
      </div>

      <div className="pt-tape-box">
        <div
          className="pt-tape-grid pt-mono"
          role="table"
          dir="ltr"
          aria-label={t('perpTerminal.tape.alt', { defaultValue: 'Recent trades: price, size and side of the aggressor' })}
        >
          <div className="pt-tape-head" role="row">
            <span role="columnheader">{t('perpTerminal.tape.price', { defaultValue: 'Price' })}</span>
            <span role="columnheader">{t('perpTerminal.tape.size', { defaultValue: 'Size' })}</span>
            <span role="columnheader">{t('perpTerminal.tape.time', { defaultValue: 'Time' })}</span>
          </div>
          {tape.rows.map((r) => (
            <div
              key={r.id}
              className="pt-tape-row"
              role="row"
              data-side={r.side}
              data-testid={`perp-tape-row-${r.side}`}
            >
              <span role="cell" className={`pt-tape-px-cell ${r.side === 'buy' ? 'pt-up' : r.side === 'sell' ? 'pt-down' : 'pt-muted'}`}>
                {r.side === 'buy' ? '▲ ' : r.side === 'sell' ? '▼ ' : '• '}
                {fmtPrice(r.price)}
              </span>
              <span role="cell" className="pt-tape-size">
                <span className="pt-tape-bar" style={{ width: `${(r.barPct ?? 0).toFixed(0)}%` }} aria-hidden="true" />
                <span>{fmtSize(r.size)}</span>
              </span>
              <span role="cell" className="pt-muted pt-tape-time" title={fmtUsd(r.usd)}>
                {fmtClock(r.atMs, locale)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="pt-note pt-tape-foot">
        {t('perpTerminal.tape.sideNote', {
          defaultValue: 'Colour is the side of the aggressor (the taker), not the resting order.'
        })}
      </p>
    </div>
  );
}
