import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BEST_TYPE_MIN_CLOSED, STATS_TYPES, STATS_WINDOWS, computeOrderStats } from '../lib/orderHistory';

const fmtPct = (v) => (v == null ? '—' : `${Math.round(v)}%`);

const icons = {
  total: <><path d="M5 7h14M5 12h14M5 17h9"/><circle cx="18" cy="17" r="2"/></>,
  open: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>,
  filled: <><path d="m5 12 4 4L19 7"/></>,
  expired: <><path d="M7 4h10M8 4v3c0 2 2 3 4 5-2 2-4 3-4 5v3h8v-3c0-2-2-3-4-5 2-2 4-3 4-5V4"/></>
};

export default function OrderStats({ orders = [], now }) {
  const { t } = useTranslation();
  const [windowDays, setWindowDays] = useState(0);
  const stats = useMemo(() => computeOrderStats(orders, { windowDays, now: now ?? Date.now() }), [orders, windowDays, now]);
  if (!(Array.isArray(orders) ? orders : []).some((o) => o && STATS_TYPES.includes(o.type))) return null;

  const bestLabel = stats.bestType ? t(`orders.typeName.${stats.bestType}`) : null;
  const bestRate = stats.bestType ? stats.byType[stats.bestType].fillRate : null;
  return (
    <section className="ord-stats" aria-label={t('orders.stats.title')}>
      <header className="ord-stats-head">
        <div><span className="ord-stats-kicker">LIVE ANALYTICS</span><h2>{t('orders.stats.title')}</h2></div>
        <div className="ord-stats-windows" role="group" aria-label={t('orders.stats.windowLabel')}>
          {STATS_WINDOWS.map((days) => <button key={days} type="button" aria-pressed={windowDays === days} onClick={() => setWindowDays(days)}>{days === 0 ? t('orders.stats.winAll') : t(`orders.stats.win${days}`)}</button>)}
        </div>
      </header>
      <div className="ord-stats-grid">
        <Stat kind="total" label={t('orders.stats.total')} value={stats.total} />
        <Stat kind="open" label={t('orders.stats.open')} value={stats.open} />
        <Stat kind="filled" label={t('orders.stats.filled')} value={stats.filled} detail={fmtPct(stats.fillRate)} />
        <Stat kind="expired" label={t('orders.stats.expired')} value={stats.expired} detail={fmtPct(stats.expireRate)} />
      </div>
      <div className="ord-stats-insights">
        <div><span>{t('orders.avgFillTime')}</span><strong>{stats.avgFillTimeDays == null ? '—' : t('orders.stats.days', { n: stats.avgFillTimeDays.toFixed(1) })}</strong></div>
        <div><span>{bestLabel ? t('orders.stats.bestType', { type: bestLabel, rate: fmtPct(bestRate) }) : t('orders.stats.bestNone', { n: BEST_TYPE_MIN_CLOSED })}</span></div>
      </div>
      <div className="ord-stats-types">
        {STATS_TYPES.map((type) => { const b = stats.byType[type]; return b.total ? <span key={type}><b>{t(`orders.typeName.${type}`)}</b><i>{fmtPct(b.fillRate)}</i><small>{t('orders.stats.closedCount', { n: b.closed })}</small></span> : null; })}
      </div>
      <p className="ord-stats-note">{t('orders.stats.closedNote')}</p>
    </section>
  );
}

function Stat({ kind, label, value, detail }) {
  return <div className={`ord-stat ord-stat--${kind}`}><span className="ord-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[kind]}</svg></span><span className="ord-stat-copy"><small>{label}</small><strong>{value}</strong></span>{detail && <em>{detail}</em>}</div>;
}
