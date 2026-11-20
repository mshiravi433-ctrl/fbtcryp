import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import BuySellLanding from '../components/BuySellLanding';
import { getBuySellOrder, storedOrderAccessToken } from '../lib/buySell';
import { useAppStore } from '../store/useAppStore';
import { useEffect, useState } from 'react';

const errorKey = (error) => error?.code || error?.message || 'REQUEST_FAILED';
import '../styles/buy-sell.css';
import '../styles/iran-buy.css';
import '../styles/lab-modern.css';
import '../styles/buy-sell-landing.css';

/**
 * ONE hosted-checkout surface for fiat on/off-ramp activity — THE LANDING
 * DESK (2026-11-20).
 * ---------------------------------------------------------------------------
 * The page is a full-screen landing, not an app screen: no header, no
 * bottom nav, no menu (the shell drops its chrome on this route). The
 * surface itself is `BuySellLanding`:
 *
 *   · a numeric KEYBOARD at the bottom of the amount step;
 *   · two small buttons ABOVE the keyboard — payment methods (the same
 *     pistnaadi sites the hand-off goes to, plus the on-chain follow-up)
 *     and the buy/sell popup;
 *   · a back button, the step COUNTER and the Iran icon at the TOP;
 *   · the Iran icon opens a popup ONLY for Iranians and ONLY in Persian;
 *   · step two picks network + token, and its bottom button is a buy/sell
 *     switch that swaps mode with the user's selection.
 *
 * This page also serves /order/result/:orderId — Ramp's finalUrl return
 * target. Returning from checkout never implies success; the panel re-reads
 * the verified order state from the server.
 */
export default function Buy() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orderId } = useParams();
  const upsertOrder = useAppStore((state) => state.upsertBuySellOrder);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orderId) return;
    if (!storedOrderAccessToken(orderId)) { setError('ORDER_ACCESS_UNAVAILABLE'); return; }
    let live = true;
    getBuySellOrder(orderId, { verify: true })
      .then((response) => {
        if (!live || !response?.order) return;
        setOrder(response.order);
        upsertOrder(response.order);
      })
      .catch((requestError) => live && setError(errorKey(requestError)));
    return () => { live = false; };
  }, [orderId, upsertOrder]);

  return (
    <PageTransition className="page buy-sell-page">
      {orderId ? (
        <div className="buy-sell-result" dir="rtl">
          <button type="button" className="icon-btn buy-sell-hero-back" onClick={() => navigate('/')} aria-label={t('common.back')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <h1 className="buy-sell-hero-title">{t('buySell.resultTitle')}</h1>
          <p className="buy-sell-page-intro">{t('buySell.resultIntro')}</p>
          {error === 'ORDER_ACCESS_UNAVAILABLE' && (
            <section className="lab-card buy-sell-unavailable">
              <p className="section-label" style={{ margin: 0 }}>{t('buySell.orderAccessLostTitle')}</p>
              <p className="prose-sm" style={{ marginTop: 6 }}>{t('buySell.orderAccessLostBody')}</p>
            </section>
          )}
          {order && (
            <section className="lab-card buy-sell-order-result">
              <p className="section-label" style={{ margin: 0 }}>{t('buySell.reviewTitle')}</p>
              <dl className="buy-sell-order-details">
                <div><dt>{t('buySell.orderId')}</dt><dd className="mono">{order.orderId}</dd></div>
                <div><dt>{t('buySell.asset')}</dt><dd>{order.asset} · {order.network}</dd></div>
                <div><dt>{t('buySell.destinationWallet')}</dt><dd className="mono">{order.walletAddress}</dd></div>
                <div><dt>{t('buySell.paymentStatus')}</dt><dd>{t(`buySell.orderState.${order.status}`, { defaultValue: order.status })}</dd></div>
              </dl>
            </section>
          )}
        </div>
      ) : (
        <BuySellLanding />
      )}
    </PageTransition>
  );
}
