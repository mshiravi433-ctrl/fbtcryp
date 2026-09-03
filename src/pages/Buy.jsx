import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import BuySellPanel from '../components/BuySellPanel';
import { IconChevronLeft, IconShield } from '../components/Icons';
import '../styles/lab-modern.css';
import '../styles/buy-sell.css';
import '../styles/iran-buy.css';

/**
 * One hosted-checkout surface for fiat on/off-ramp activity.
 *
 * There are deliberately no wallet-type tabs here. A connected wallet merely
 * supplies a real destination address; a manually entered address receives
 * the same network validation on the server before a payment can be created.
 *
 * This page also serves /order/result/:orderId — Ramp's finalUrl return
 * target. Returning from checkout never implies success; the panel re-reads
 * the verified order state from the server.
 */
export default function Buy() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orderId } = useParams();

  return (
    <PageTransition>
      <div className="row" style={{ gap: 10, marginBottom: 4 }}>
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ margin: 0 }}>{orderId ? t('buySell.resultTitle') : t('buySell.title')}</h1>
      </div>
      <p className="prose-sm buy-sell-page-intro">{orderId ? t('buySell.resultIntro') : t('buySell.pageIntro')}</p>

      <BuySellPanel initialOrderId={orderId || null} />

      <motion.section className="lab-card buy-sell-safety" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <span style={{ color: 'var(--rgb-5)', display: 'grid', placeItems: 'center' }}><IconShield width={17} height={17} /></span>
          <p className="section-label" style={{ margin: 0 }}>{t('buySell.safetyTitle')}</p>
        </div>
        <ul className="prose-list">
          <li>{t('buySell.safetyAddress')}</li>
          <li>{t('buySell.safetyProvider')}</li>
          <li>{t('buySell.safetyVerification')}</li>
        </ul>
      </motion.section>
    </PageTransition>
  );
}
