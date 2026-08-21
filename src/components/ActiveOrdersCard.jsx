import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { loadOrders } from '../lib/orders';
import { loadIntents } from '../lib/intentOS';
import { IconClock, IconChevronRight } from './Icons';

/**
 * ACTIVE CARD — up to 4 live orders + up to 2 recent local intents.
 * ---------------------------------------------------------------------------
 * Read-only, straight from the same localStorage the /orders and Intent OS
 * screens use. The server never executes orders; this card only displays
 * them. Empty state is honest, never a fake row.
 */
export default function ActiveOrdersCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [intents, setIntents] = useState([]);

  useEffect(() => {
    const refresh = () => {
      setOrders(loadOrders().filter((o) => o.status === 'active').slice(0, 4));
      setIntents(loadIntents().slice(0, 2));
    };
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  const typeLabel = (type) => t(`orders.type.${type}`, { defaultValue: type });

  const fmtTime = (ts) => {
    if (!ts) return '';
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(ts);
    } catch {
      return '';
    }
  };

  const empty = orders.length === 0 && intents.length === 0;

  return (
    <section className="wallet-pie-card" style={{ padding: 14, borderRadius: 18 }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="row" style={{ gap: 7 }}>
          <span className="wallet-section-title">{t('wallet.active.title')}</span>
          {orders.length > 0 && <span className="pill pill-up" style={{ fontSize: 9.5 }}>{orders.length}</span>}
        </span>
        <span className="row" style={{ gap: 10 }}>
          <button className="wal-link-btn" onClick={() => navigate('/orders')}>{t('nav.orders')}</button>
          <button className="wal-link-btn" onClick={() => navigate('/intent')}>{t('wallet.active.os')}</button>
        </span>
      </div>

      {empty && (
        <div className="wal-empty-asset">
          <div style={{ fontSize: 16, marginBottom: 6 }}>🛡</div>
          {t('wallet.active.empty')}
        </div>
      )}

      {orders.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {orders.map((o) => (
            <button
              key={o.id}
              type="button"
              className="wal-active-row"
              onClick={() => navigate('/orders')}
            >
              <span className="wal-active-ico"><IconClock width={15} height={15} /></span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
                <strong style={{ fontSize: 12 }}>{typeLabel(o.type)}</strong>
                <small className="faint" style={{ display: 'block', fontSize: 10.5 }}>
                  {o.fromToken?.symbol ?? o.fromToken} → {o.toToken?.symbol ?? o.toToken}
                  {o.targetRate ? ` · ${o.targetRate}` : ''}
                </small>
              </span>
              <span className="mono faint" style={{ fontSize: 10.5 }}>{fmtTime(o.createdAt)}</span>
              <IconChevronRight width={13} height={13} />
            </button>
          ))}
        </div>
      )}

      {intents.length > 0 && (
        <>
          <div className="faint" style={{ fontSize: 10.5, fontWeight: 700, margin: '10px 2px 6px' }}>{t('wallet.active.intents')}</div>
          <div className="stack" style={{ gap: 6 }}>
            {intents.map((rec) => {
              const it = rec.intent || {};
              return (
                <button
                  key={it.id || rec.savedAt}
                  type="button"
                  className="wal-active-row"
                  onClick={() => navigate('/intent')}
                >
                  <span className="wal-active-ico"><IconSparkleMini /></span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
                    <strong style={{ fontSize: 12 }}>{t(`intentOS.action.${it.kind}`, { defaultValue: it.kind })}</strong>
                    <small className="faint" style={{ display: 'block', fontSize: 10.5 }}>
                      {it.fromSymbol} → {it.toSymbol}
                    </small>
                  </span>
                  <span className="mono faint" style={{ fontSize: 10.5 }}>{rec.status || ''}</span>
                  <IconChevronRight width={13} height={13} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function IconSparkleMini() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.3L12 3z" />
    </svg>
  );
}
