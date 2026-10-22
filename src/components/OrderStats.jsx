import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BEST_TYPE_MIN_CLOSED, STATS_TYPES, STATS_WINDOWS, computeOrderStats } from '../lib/orderHistory';
import '../styles/order-stats-modern.css';

/**
 * ORDER STATISTICS — the modern cockpit.
 * ===========================================================================
 * Requested: «باکس آمار سفارش‌های شما خیلی مدرن‌تر کن — فاصله و اندازهٔ هر
 * نوشته درست، تقسیم‌بندی درست، آیکن مدرن و رنگ‌بندی درست؛ باکس کاملاً کار بدهد».
 *
 * What this box now is, top to bottom:
 *   1. A header band — gradient icon tile, title, a live dot, and the window
 *      switcher (۳۰ روز / ۹۰ روز / همه) as one segmented control.
 *   2. A fill-rate RING — one SVG donut whose arc is the real fill rate over
 *      closed orders, with the filled / expired / open legend beside it.
 *   3. Four KPI tiles — کل / باز / پرشده / منقضی — each with its own modern
 *      line icon, its own colour, a big mono numeral, and a small rate badge.
 *   4. A stacked distribution bar — the same three counts as shares of the
 *      total, animated on `width` only when the window changes.
 *   5. Two insight chips — average time to fill, and the best-performing
 *      order type (only once a type has enough closed orders to mean it).
 *   6. A per-type breakdown — one progress row per type that exists.
 *
 * Every number comes from `computeOrderStats` over the user's own local
 * orders; nothing is invented and nothing leaves the device. The component
 * still renders nothing when there are no price-triggered orders, so a
 * first-time visitor never sees an empty dashboard.
 */

const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v)}%`);
const share = (n, d) => (d > 0 ? (n / d) * 100 : 0);
const clampPct = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

/* Modern 24px line icons — one per metric, drawn on the same grid. */
const ICONS = {
  chart: (
    <>
      <path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" />
      <path d="m7 9 4-4 3 3 5-5" opacity=".55" />
    </>
  ),
  total: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" opacity=".55" />
    </>
  ),
  open: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
      <circle cx="12" cy="12" r=".6" fill="currentColor" />
    </>
  ),
  filled: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" opacity=".55" />
      <path d="m8.5 12.2 2.4 2.4L15.8 9.5" />
    </>
  ),
  expired: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M8 3v3.2c0 1.9 1.7 3 4 5.8-2.3 2.8-4 3.9-4 5.8V21" />
      <path d="M16 3v3.2c0 1.9-1.7 3-4 5.8 2.3 2.8 4 3.9 4 5.8V21" opacity=".55" />
    </>
  ),
  timer: (
    <>
      <path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      <path d="M12 11.5 15 10M10 2.5h4" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4a1 1 0 0 0-1 1c0 2 1.4 3.2 4 3.2M17 6h3a1 1 0 0 1 1 1c0 2-1.4 3.2-4 3.2" opacity=".55" />
    </>
  )
};

function Icon({ kind }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[kind]}
    </svg>
  );
}

export default function OrderStats({ orders = [], now }) {
  const { t } = useTranslation();
  const [windowDays, setWindowDays] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stats = useMemo(
    () => computeOrderStats(orders, { windowDays, now: now ?? Date.now() }),
    [orders, windowDays, now]
  );

  if (!(Array.isArray(orders) ? orders : []).some((o) => o && STATS_TYPES.includes(o.type))) return null;

  const { total, open, filled, expired, closed } = stats;
  const fillRate = stats.fillRate;
  const ringPct = clampPct(fillRate ?? 0);
  /* Donut geometry: r=34 → C≈213.6. The arc is data, the track is not. */
  const R = 34;
  const C = 2 * Math.PI * R;

  const bestLabel = stats.bestType ? t(`orders.typeName.${stats.bestType}`) : null;
  const bestRate = stats.bestType ? stats.byType[stats.bestType].fillRate : null;

  const tiles = [
    { kind: 'total', label: t('orders.stats.total'), value: total, detail: null },
    { kind: 'open', label: t('orders.stats.open'), value: open, detail: total ? fmtPct(share(open, total)) : '—' },
    { kind: 'filled', label: t('orders.stats.filled'), value: filled, detail: fmtPct(fillRate) },
    { kind: 'expired', label: t('orders.stats.expired'), value: expired, detail: fmtPct(stats.expireRate) }
  ];

  const typeRows = STATS_TYPES
    .map((type) => ({ type, ...stats.byType[type] }))
    .filter((b) => b.total > 0);

  return (
    <section className="ord2" aria-label={t('orders.stats.title')} data-testid="order-stats">
      <span className="ord2-glow" aria-hidden="true" />

      {/* ── 1 · header band ─────────────────────────────────────────────── */}
      <header className="ord2-head">
        <div className="ord2-head-main">
          <span className="ord2-head-icon"><Icon kind="chart" /></span>
          <div className="ord2-head-copy">
            <span className="ord2-kicker">
              <span className="ord2-live-dot" aria-hidden="true" />
              {t('orders.stats.live', { defaultValue: 'LIVE ANALYTICS' })}
            </span>
            <h2 className="ord2-title">{t('orders.stats.title')}</h2>
          </div>
        </div>
        <div className="ord2-windows" role="group" aria-label={t('orders.stats.windowLabel')}>
          {STATS_WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              className={windowDays === days ? 'is-on' : ''}
              aria-pressed={windowDays === days}
              onClick={() => setWindowDays(days)}
            >
              {days === 0 ? t('orders.stats.winAll') : t(`orders.stats.win${days}`)}
            </button>
          ))}
        </div>
      </header>

      {/* ── 2 · expanded fill-rate ring + legend ────────────────────────── */}
      {detailsOpen && (
      <div className="ord2-details ord2-details--hero">
      <div className="ord2-hero">
        <div className="ord2-ring-wrap">
          <svg className="ord2-ring" viewBox="0 0 84 84" role="img" aria-label={`${t('orders.stats.fillRate', { defaultValue: 'Fill rate' })} ${fmtPct(fillRate)}`}>
            <defs>
              <linearGradient id="ord2RingGrad" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#00ff9d" />
                <stop offset="100%" stopColor="#00e5ff" />
              </linearGradient>
            </defs>
            <circle className="ord2-ring-track" cx="42" cy="42" r={R} />
            <circle
              className="ord2-ring-arc"
              cx="42" cy="42" r={R}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - ringPct / 100)}
            />
          </svg>
          <div className="ord2-ring-center">
            <strong>{fmtPct(fillRate)}</strong>
            <small>{t('orders.stats.fillRate', { defaultValue: 'نرخ پرشدن' })}</small>
          </div>
        </div>

        <ul className="ord2-legend">
          <li className="ord2-legend--filled">
            <span className="ord2-legend-dot" aria-hidden="true" />
            <span className="ord2-legend-label">{t('orders.stats.filled')}</span>
            <strong className="ord2-legend-val">{filled}</strong>
          </li>
          <li className="ord2-legend--expired">
            <span className="ord2-legend-dot" aria-hidden="true" />
            <span className="ord2-legend-label">{t('orders.stats.expired')}</span>
            <strong className="ord2-legend-val">{expired}</strong>
          </li>
          <li className="ord2-legend--open">
            <span className="ord2-legend-dot" aria-hidden="true" />
            <span className="ord2-legend-label">{t('orders.stats.open')}</span>
            <strong className="ord2-legend-val">{open}</strong>
          </li>
          <li className="ord2-legend-note">
            {t('orders.stats.closedOf', { defaultValue: '{{closed}} سفارش بسته از {{total}}', closed, total })}
          </li>
        </ul>
      </div>
      </div>
      )}

      {/* ── 3 · KPI tiles ───────────────────────────────────────────────── */}
      <div className="ord2-grid">
        {tiles.map((tile) => (
          <Stat key={tile.kind} {...tile} />
        ))}
      </div>

      {/* ── 4 · distribution ────────────────────────────────────────────── */}
      {total > 0 && (
        <div className="ord2-dist">
          <div className="ord2-dist-head">
            <span>{t('orders.stats.distribution', { defaultValue: 'توزیع سفارش‌ها' })}</span>
            <span className="ord2-dist-total">{total}</span>
          </div>
          <div
            className="ord2-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={filled}
            aria-label={t('orders.stats.distribution', { defaultValue: 'توزیع سفارش‌ها' })}
          >
            <span className="ord2-seg ord2-seg--filled" style={{ width: `${share(filled, total)}%` }} />
            <span className="ord2-seg ord2-seg--open" style={{ width: `${share(open, total)}%` }} />
            <span className="ord2-seg ord2-seg--expired" style={{ width: `${share(expired, total)}%` }} />
          </div>
        </div>
      )}

      <button
        type="button"
        className="ord2-details-toggle"
        aria-expanded={detailsOpen}
        aria-controls="ord2-breakdown"
        onClick={() => setDetailsOpen((open) => !open)}
      >
        <span>{t(detailsOpen ? 'orders.stats.hideDetails' : 'orders.stats.showDetails', { defaultValue: detailsOpen ? 'کاهش جزئیات' : 'نمایش تحلیل کامل' })}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* ── 5 · expandable insights and per-type breakdown ──────────────── */}
      {detailsOpen && (
      <div className="ord2-details ord2-details--breakdown" id="ord2-breakdown">
      <div className="ord2-insights">
        <div className="ord2-insight">
          <span className="ord2-insight-icon ord2-insight-icon--timer"><Icon kind="timer" /></span>
          <span className="ord2-insight-copy">
            <small>{t('orders.avgFillTime')}</small>
            <strong>
              {stats.avgFillTimeDays == null
                ? '—'
                : t('orders.stats.days', { n: stats.avgFillTimeDays.toFixed(1) })}
            </strong>
          </span>
        </div>
        <div className="ord2-insight">
          <span className="ord2-insight-icon ord2-insight-icon--trophy"><Icon kind="trophy" /></span>
          <span className="ord2-insight-copy ord2-insight-copy--wide">
            <small>{t('orders.stats.best', { defaultValue: 'بهترین نوع سفارش' })}</small>
            <strong>
              {bestLabel
                ? t('orders.stats.bestType', { type: bestLabel, rate: fmtPct(bestRate) })
                : t('orders.stats.bestNone', { n: BEST_TYPE_MIN_CLOSED })}
            </strong>
          </span>
        </div>
      </div>

      {/* ── 6 · per-type breakdown ──────────────────────────────────────── */}
      {typeRows.length > 0 && (
        <div className="ord2-types">
          <div className="ord2-types-head">{t('orders.stats.byType', { defaultValue: 'به تفکیک نوع سفارش' })}</div>
          {typeRows.map((b) => (
            <div className="ord2-type-row" key={b.type}>
              <span className="ord2-type-name">{t(`orders.typeName.${b.type}`)}</span>
              <span className="ord2-type-bar" aria-hidden="true">
                <span style={{ width: `${clampPct(b.fillRate ?? 0)}%` }} />
              </span>
              <span className="ord2-type-rate">{fmtPct(b.fillRate)}</span>
              <span className="ord2-type-closed">{t('orders.stats.closedCount', { n: b.closed })}</span>
            </div>
          ))}
        </div>
      )}

      <p className="ord2-note">{t('orders.stats.closedNote')}</p>
      </div>
      )}
    </section>
  );
}

function Stat({ kind, label, value, detail }) {
  return (
    <div className={`ord2-tile ord2-tile--${kind}`}>
      <span className="ord2-tile-icon"><Icon kind={kind} /></span>
      <span className="ord2-tile-copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      {detail && detail !== '—' ? <em className="ord2-tile-badge">{detail}</em> : null}
      {/* Screen-reader / test-friendly combined reading: «2 (67%)». */}
      {detail ? <span className="ord2-sr">{`${value} (${detail})`}</span> : null}
    </div>
  );
}
