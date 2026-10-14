import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BEST_TYPE_MIN_CLOSED, STATS_TYPES, STATS_WINDOWS, computeOrderStats } from '../lib/orderHistory';

/*
 * LEVEL 2 — the fill-rate card on the Orders screen.
 *
 * Shows nothing at all when the user has no price-triggered orders: an empty
 * statistics card would only add noise to a screen the user opens to act on.
 *
 * Every percentage is over CLOSED orders (filled + expired). See
 * lib/orderHistory.js for why open orders are left out of the rate.
 */

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

export default function OrderStats({ orders = [], now }) {
  const { t } = useTranslation();
  const [windowDays, setWindowDays] = useState(0);

  const stats = useMemo(
    () => computeOrderStats(orders, { windowDays, now: now ?? Date.now() }),
    [orders, windowDays, now]
  );

  const hasAny = (Array.isArray(orders) ? orders : []).some((o) => o && STATS_TYPES.includes(o.type));
  if (!hasAny) return null;

  const bestLabel = stats.bestType ? t(`orders.typeName.${stats.bestType}`) : null;
  const bestRate = stats.bestType ? stats.byType[stats.bestType].fillRate : null;

  return (
    <section className="card" aria-label={t('orders.stats.title')} style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <p className="section-label" style={{ margin: 0 }}>{t('orders.stats.title')}</p>
        <div className="row" role="group" aria-label={t('orders.stats.windowLabel')} style={{ gap: 4 }}>
          {STATS_WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={windowDays === days}
              onClick={() => setWindowDays(days)}
              style={{
                padding: '3px 9px',
                borderRadius: 999,
                border: '1px solid rgba(127,127,127,0.45)',
                background: windowDays === days ? 'rgba(127,127,127,0.25)' : 'transparent',
                color: 'inherit',
                fontSize: 12,
                fontWeight: windowDays === days ? 600 : 400,
                cursor: 'pointer'
              }}
            >
              {days === 0 ? t('orders.stats.winAll') : t(`orders.stats.win${days}`)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        <Stat label={t('orders.stats.total')} value={stats.total} />
        <Stat label={t('orders.stats.open')} value={stats.open} />
        <Stat label={t('orders.stats.filled')} value={`${stats.filled} (${fmtPct(stats.fillRate)})`} />
        <Stat label={t('orders.stats.expired')} value={`${stats.expired} (${fmtPct(stats.expireRate)})`} />
      </div>

      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
        <div>
          {t('orders.avgFillTime')}:{' '}
          <span className="mono">
            {stats.avgFillTimeDays === null ? '—' : t('orders.stats.days', { n: stats.avgFillTimeDays.toFixed(1) })}
          </span>
        </div>
        <div>
          {bestLabel
            ? t('orders.stats.bestType', { type: bestLabel, rate: fmtPct(bestRate) })
            : t('orders.stats.bestNone', { n: BEST_TYPE_MIN_CLOSED })}
        </div>
        <div style={{ marginTop: 4 }}>
          {STATS_TYPES.map((type) => {
            const b = stats.byType[type];
            if (!b.total) return null;
            return (
              <div key={type}>
                {t(`orders.typeName.${type}`)}: {fmtPct(b.fillRate)}{' '}
                <span className="faint">({t('orders.stats.closedCount', { n: b.closed })})</span>
              </div>
            );
          })}
        </div>
        <div className="faint" style={{ marginTop: 4 }}>{t('orders.stats.closedNote')}</div>
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
