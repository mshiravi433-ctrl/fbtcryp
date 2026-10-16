import SegIndicator from '../SegIndicator';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import InfoBox from '../InfoBox';
import { fmtPrice, fmtUsd } from '../../lib/format';
import { dydxSessionAddress, getDydxFills, getDydxOrders } from '../../lib/dydx';
import {
  HISTORY_PAGE_SIZE,
  HISTORY_VENUES,
  annotateFills,
  filterHistory,
  marketsIn,
  normaliseDydxFill,
  sortNewestFirst
} from '../../lib/futuresHistory';
import '../../styles/futures-tpsl-history.css';

/*
 * ─── READ-ONLY FUTURES HISTORY ───────────────────────────────────────────────
 * This table has no buttons that act on a trade. Its only controls are the
 * filters, «بارگذاری بیشتر» and refresh, and each of those only reads.
 *
 * Each venue states its own source. Ostium and Velocity are listed with an
 * explicit «در دسترس نیست» and the reason, so an empty dYdX table is never read
 * as «no trades anywhere».
 */
const RANGE_KEYS = ['24h', '7d', '30d', 'all'];

const dirLabel = (row, t) => {
  if (row.direction === 'LONG') return t('futures.history.dir.long');
  if (row.direction === 'SHORT') return t('futures.history.dir.short');
  return t('futures.history.dir.unknown');
};

/*
 * TP/SL for Ostium and Velocity is set on the screens that already own it.
 * This panel links there; it does not sign anything itself.
 */
const OTHER_VENUE_TPSL = Object.freeze([
  { id: 'ostium', to: '/ostium', textKey: 'futures.history.tpsl.ostium' },
  { id: 'velocity', to: '/perp?tab=onchain', textKey: 'futures.history.tpsl.velocity' }
]);

export default function FuturesHistory({ onOpenDydx = null }) {
  const { t, i18n } = useTranslation();
  /* Read on every render: the session is set on the dYdX tab and this page can mount first. */
  const address = dydxSessionAddress();
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);
  const [marketFilter, setMarketFilter] = useState('all');
  const [range, setRange] = useState('all');
  /* How many filtered rows are on screen. Grows by one page per «بارگذاری بیشتر». */
  const [shown, setShown] = useState(HISTORY_PAGE_SIZE);
  const mounted = useRef(false);
  const requestSeq = useRef(0);
  const currentAddress = useRef(address);
  currentAddress.current = address;
  useEffect(() => {
    // React StrictMode replays effects: setup must restore the mounted guard.
    mounted.current = true;
    return () => { mounted.current = false; requestSeq.current += 1; };
  }, []);

  /* Filled orders, loaded once per first page and reused to annotate every later
     page, so an older fill still gets its direction from the order it belongs to. */
  const filledOrders = useRef([]);

  const fetchPage = useCallback(async ({ before = null, reset = false } = {}) => {
    if (!address) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    const [fills, orders] = await Promise.all([
      getDydxFills({ address, subaccount: 0, limit: HISTORY_PAGE_SIZE, before }),
      reset ? getDydxOrders({ address, subaccount: 0, status: 'FILLED' }) : Promise.resolve(null)
    ]);
    if (!mounted.current || seq !== requestSeq.current || currentAddress.current !== address) return;
    if (orders) filledOrders.current = orders.orders || [];
    const normalised = (fills.fills || []).map(normaliseDydxFill).filter(Boolean);
    const joined = annotateFills(normalised, filledOrders.current);
    setLive(Boolean(fills.live && (!orders || orders.live)));
    setRows((prev) => {
      const base = reset ? [] : prev;
      const seen = new Set(base.map((r) => r.id));
      return sortNewestFirst([...base, ...joined.filter((r) => !seen.has(r.id))]);
    });
    /* A short page means the indexer has no older rows. */
    setExhausted((fills.fills || []).length < HISTORY_PAGE_SIZE);
    const last = joined[joined.length - 1];
    setCursor(last ? last.iso : null);
    setLoading(false);
  }, [address]);

  useEffect(() => {
    // Never reuse another account's rows, filters or pagination cursor.
    requestSeq.current += 1;
    setRows([]);
    filledOrders.current = [];
    setCursor(null);
    setExhausted(false);
    setLoading(false);
    setLive(false);
    setMarketFilter('all');
    setShown(HISTORY_PAGE_SIZE);
    if (address) fetchPage({ reset: true });
  }, [address, fetchPage]);

  const markets = useMemo(() => marketsIn(rows), [rows]);
  const filtered = useMemo(
    () => filterHistory(rows, { market: marketFilter, range, now: Date.now() }),
    [rows, marketFilter, range]
  );
  const items = filtered.slice(0, shown);
  const hasMoreLocal = filtered.length > shown;

  const loadMore = async () => {
    if (loading) return;
    if (hasMoreLocal) {
      setShown((n) => n + HISTORY_PAGE_SIZE);
      return;
    }
    if (!exhausted && cursor) {
      await fetchPage({ before: cursor });
      setShown((n) => n + HISTORY_PAGE_SIZE);
    }
  };
  const canLoadMore = hasMoreLocal || (!exhausted && Boolean(cursor));

  const dateFmt = (ms) => {
    try {
      return new Date(ms).toLocaleString(i18n.language || 'en', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
    }
  };

  return (
    <section className="fhist" aria-labelledby="fhist-title">
      <div className="fhist-head">
        <h2 id="fhist-title" className="fhist-title">{t('futures.history.title')}</h2>
        <p className="faint fhist-sub">{t('futures.history.subtitle')}</p>
      </div>

      {!address ? (
        <div className="empty fhist-empty">
          <p>{t('futures.history.notConnected')}</p>
          {onOpenDydx && (
            <button type="button" className="btn btn-primary btn-sm fhist-touch" onClick={onOpenDydx}>
              {t('futures.history.openDydx')}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="fhist-filters">
            <div className="fhist-filter">
              <label className="field-label" htmlFor="fhist-market">{t('futures.history.filters.market')}</label>
              <select id="fhist-market" dir="ltr" value={marketFilter} onChange={(e) => { setMarketFilter(e.target.value); setShown(HISTORY_PAGE_SIZE); }}>
                <option value="all">{t('futures.history.filters.allMarkets')}</option>
                {markets.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="fhist-filter">
              <div className="field-label">{t('futures.history.filters.range')}</div>
              <div className="segmented" role="group" aria-label={t('futures.history.filters.range')}>
                {RANGE_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={range === k ? 'active' : ''}
                    aria-pressed={range === k}
                    onClick={() => { setRange(k); setShown(HISTORY_PAGE_SIZE); }}
                  >
                    {range === k && <SegIndicator id="fhist-range" />}{t(`futures.history.range.${k}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!live && <p className="notice notice-danger" role="status">{t('futures.history.indexerUnavailable')}</p>}

          {loading && rows.length === 0 ? (
            <div className="fhist-skeleton" role="status" aria-live="polite">
              {[0, 1, 2].map((i) => <span key={i} className="fhist-skel-row" />)}
              <span className="faint">{t('futures.history.loading')}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="empty fhist-empty">
              <p>{live ? t('futures.history.empty') : t('futures.history.emptyUnavailable')}</p>
            </div>
          ) : (
            <div className="fhist-table-wrap">
              <table className="fhist-table">
                <caption className="sr-only">{t('futures.history.tableCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('futures.history.cols.time')}</th>
                    <th scope="col">{t('futures.history.cols.market')}</th>
                    <th scope="col">{t('futures.history.cols.direction')}</th>
                    <th scope="col">{t('futures.history.cols.type')}</th>
                    <th scope="col" className="num">{t('futures.history.cols.size')}</th>
                    <th scope="col" className="num">{t('futures.history.cols.price')}</th>
                    <th scope="col" className="num">{t('futures.history.cols.fee')}</th>
                    <th scope="col" className="num">{t('futures.history.cols.pnl')}</th>
                    <th scope="col">{t('futures.history.cols.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const tone = r.direction === 'LONG' ? 'up' : r.direction === 'SHORT' ? 'down' : 'faint';
                    return (
                      <tr key={r.id}>
                        <td data-label={t('futures.history.cols.time')} className="mono" dir="ltr">{dateFmt(r.time)}</td>
                        <td data-label={t('futures.history.cols.market')} className="mono" dir="ltr">{r.market}</td>
                        <td data-label={t('futures.history.cols.direction')}>
                          <span className={`fhist-dir ${tone}`}>
                            <span aria-hidden="true">{r.direction === 'LONG' ? '▲' : r.direction === 'SHORT' ? '▼' : '•'}</span>
                            {dirLabel(r, t)}
                          </span>
                        </td>
                        <td data-label={t('futures.history.cols.type')}>
                          {r.closing === true ? t('futures.history.closing') : r.closing === false ? t('futures.history.opening') : '—'}
                          {(r.orderType || r.fillType) && <span className="faint"> · {r.orderType || r.fillType}</span>}
                        </td>
                        <td data-label={t('futures.history.cols.size')} className="mono num" dir="ltr">{r.size}</td>
                        <td data-label={t('futures.history.cols.price')} className="mono num" dir="ltr">${fmtPrice(r.price)}</td>
                        <td data-label={t('futures.history.cols.fee')} className="mono num" dir="ltr">{r.fee == null ? '—' : fmtUsd(r.fee)}</td>
                        <td data-label={t('futures.history.cols.pnl')} className="mono num" title={t('futures.history.pnlNone')} dir="ltr">—</td>
                        <td data-label={t('futures.history.cols.status')}>
                          <span className="fhist-status">
                            <span aria-hidden="true">✓</span> {t('futures.history.status.filled')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="faint fhist-note">{t('futures.history.pnlNote')} {t('futures.history.joinNote')}</p>

          {canLoadMore && (
            <button type="button" className="btn btn-ghost fhist-more" onClick={loadMore} disabled={loading}>
              {loading ? t('common.loading') : t('futures.history.loadMore')}
            </button>
          )}
          {!canLoadMore && items.length > 0 && <p className="faint fhist-end">{t('futures.history.end')}</p>}
        </>
      )}

      <div className="fhist-venues">
        {HISTORY_VENUES.filter((v) => !v.available).map((v) => (
          <InfoBox key={v.id} title={t(`futures.history.venue.${v.id}`)} tone="info" id={`fhist-${v.id}`} defaultOpen>
            <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.8 }}>{t(v.reasonKey)}</p>
          </InfoBox>
        ))}
        <InfoBox title={t('futures.history.tpsl.title')} tone="info" id="fhist-tpsl-other" defaultOpen>
          <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.8 }}>{t('futures.history.tpsl.intro')}</p>
          <ul className="tpsl-open-list" style={{ marginTop: 12 }}>
            {OTHER_VENUE_TPSL.map((v) => (
              <li key={v.id} className="tpsl-open-row">
                <span style={{ fontSize: 12.5, lineHeight: 1.8 }}>{t(v.textKey)}</span>
                <Link to={v.to} className="btn btn-ghost btn-sm fhist-touch">
                  {t('futures.history.tpsl.open', { venue: t(`futures.history.venue.${v.id}`) })}
                </Link>
              </li>
            ))}
          </ul>
        </InfoBox>
        <p className="faint fhist-note">
          {t('futures.history.venue.dydxSource')}
        </p>
      </div>
    </section>
  );
}
