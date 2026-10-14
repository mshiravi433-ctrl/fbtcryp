import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { loadOrders } from '../lib/orders';
import { HISTORY_RANGES, STATS_TYPES, describeFill, selectFilledHistory } from '../lib/orderHistory';
import { fmtQty } from '../lib/format';
import { IconChevronLeft } from '../components/Icons';

/*
 * LEVEL 2 — the full history of filled orders, at /orders/history.
 *
 * Every filled order is listed, not the last ten that the Orders screen shows.
 *
 * The honest caveat is on the page itself: the figures are the quotation the
 * watcher saw when the order became ready, which is recorded when the user
 * hands the order off to Swap. The app does not watch the chain, so this is
 * not a receipt and the page does not present it as one.
 */

const chipStyle = (on) => ({
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid rgba(127,127,127,0.45)',
  background: on ? 'rgba(127,127,127,0.25)' : 'transparent',
  color: 'inherit',
  fontSize: 12.5,
  fontWeight: on ? 600 : 400,
  cursor: 'pointer'
});

export default function OrderHistory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [orders] = useState(() => loadOrders());
  const [type, setType] = useState('all');
  const [range, setRange] = useState('all');

  const rows = useMemo(() => selectFilledHistory(orders, { type, range }), [orders, type, range]);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10 }}>
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('orders.fullHistory.title')}</h1>
      </div>

      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.85 }}>{t('orders.fullHistory.honest')}</p>

      <div className="row" role="group" aria-label={t('orders.fullHistory.filterType')} style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" aria-pressed={type === 'all'} style={chipStyle(type === 'all')} onClick={() => setType('all')}>
          {t('orders.fullHistory.allTypes')}
        </button>
        {STATS_TYPES.map((k) => (
          <button key={k} type="button" aria-pressed={type === k} style={chipStyle(type === k)} onClick={() => setType(k)}>
            {t(`orders.typeName.${k}`)}
          </button>
        ))}
      </div>

      <div className="row" role="group" aria-label={t('orders.fullHistory.filterRange')} style={{ gap: 6, flexWrap: 'wrap' }}>
        {HISTORY_RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={range === r} style={chipStyle(range === r)} onClick={() => setRange(r)}>
            {t(`orders.fullHistory.range.${r}`)}
          </button>
        ))}
      </div>

      <p className="faint" style={{ fontSize: 12 }}>{t('orders.fullHistory.count', { n: rows.length })}</p>

      {rows.length === 0 && (
        <div className="card">
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.85 }}>{t('orders.fullHistory.empty')}</p>
        </div>
      )}

      {rows.map((o) => (
        <HistoryRow key={o.id} order={o} t={t} />
      ))}
    </div>
  );
}

function HistoryRow({ order, t }) {
  const d = describeFill(order);
  const from = order.fromToken?.symbol ?? '?';
  const to = order.toToken?.symbol ?? '?';
  const when = Number.isFinite(order.filledAt) ? new Date(order.filledAt).toLocaleString() : '—';
  const show = (v, suffix = '') => (v === null ? '—' : `${fmtQty(v)}${suffix}`);

  return (
    <article className="card" style={{ display: 'grid', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>{from} → {to}</strong>
        <span className="faint" style={{ fontSize: 12 }}>{t(`orders.typeName.${order.type}`, { defaultValue: order.type })}</span>
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
        <div>{t('orders.fullHistory.filledAt')}: <span className="mono">{when}</span></div>
        <div>{t('orders.fullHistory.amountIn')}: <span className="mono">{fmtQty(Number(order.amountIn))} {from}</span></div>
        <div>{t('orders.fullHistory.rate')}: <span className="mono">{show(d.rate, ` ${to}`)}</span></div>
        <div>{t('orders.fullHistory.amountOut')}: <span className="mono">{show(d.amountOut, ` ${to}`)}</span></div>
        <div>{t('orders.fullHistory.minOut')}: <span className="mono">{show(d.minAmountOut, ` ${to}`)}</span></div>
        <div>
          {t('orders.fullHistory.aboveFloor')}:{' '}
          <span className="mono">{d.aboveFloor === null ? '—' : `${d.aboveFloor >= 0 ? '+' : ''}${fmtQty(d.aboveFloor)} ${to}`}</span>
        </div>
        <div>{t('orders.fullHistory.source')}: <span className="mono">{d.source ?? t('orders.fullHistory.unknownSource')}</span></div>
        <div>{t('orders.fullHistory.pnl')}: <span className="faint">{t('orders.fullHistory.pnlNa')}</span></div>
      </div>
    </article>
  );
}
