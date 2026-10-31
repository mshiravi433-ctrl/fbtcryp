import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import BuySellPanel from '../components/BuySellPanel';
import AssetIcon from '../components/AssetIcon';
import { IconChevronLeft, IconFingerprint, IconShield, IconSwap, IconWallet } from '../components/Icons';
import '../styles/lab-modern.css';
import '../styles/buy-sell.css';
import '../styles/iran-buy.css';
import '../styles/buy-sell-modern.css';

/**
 * One hosted-checkout surface for fiat on/off-ramp activity.
 * ---------------------------------------------------------------------------
 * There are deliberately no wallet-type tabs here. A connected wallet merely
 * supplies a real destination address; a manually entered address receives
 * the same network validation on the server before a payment can be created.
 *
 * This page also serves /order/result/:orderId — Ramp's finalUrl return
 * target. Returning from checkout never implies success; the panel re-reads
 * the verified order state from the server.
 *
 * ─── PRISM DESK (2026-10-31) ──────────────────────────────────────────────
 * A compact exchange counter, not another glowing settings card. The asset
 * constellation is decorative (and hidden from assistive technology); the
 * title, explanation and three factual trust statements remain real text.
 * The final, page-scoped stylesheet resolves the shared tab fallback without
 * changing any other screen. Every offset is logical, so fa/ar mirror safely.
 * No prices, availability claims, payment logic or wallet permissions live here.
 */
export default function Buy() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orderId } = useParams();

  return (
    <PageTransition className="page buy-sell-page">
      <motion.section
        className="buy-sell-hero"
        variants={riseIn}
        initial="hidden"
        animate="show"
        aria-labelledby="buy-sell-page-title"
      >
        <span className="buy-sell-hero-field" aria-hidden="true">
          <i className="buy-sell-hero-grid" />
          <i className="buy-sell-hero-sheen" />
        </span>

        <div className="buy-sell-hero-top">
          <button
            className="icon-btn buy-sell-hero-back"
            onClick={() => navigate(-1)}
            aria-label={t('common.back')}
          >
            <IconChevronLeft width={18} height={18} />
          </button>
          <span className="buy-sell-hero-kicker" dir="ltr">FBT <i /> EXCHANGE</span>
          <span className="buy-sell-hero-edition" aria-hidden="true">01 / DESK</span>
        </div>

        <div className="buy-sell-hero-main">
          <div className="buy-sell-hero-text">
            <h1 className="buy-sell-hero-title" id="buy-sell-page-title">
              {orderId ? t('buySell.resultTitle') : t('buySell.title')}
            </h1>
            <p className="buy-sell-page-intro">
              {orderId ? t('buySell.resultIntro') : t('buySell.pageIntro')}
            </p>
          </div>
          <div className="buy-sell-constellation" aria-hidden="true">
            <span className="buy-sell-orbit buy-sell-orbit--outer" />
            <span className="buy-sell-orbit buy-sell-orbit--inner" />
            <span className="buy-sell-asset buy-sell-asset--btc"><AssetIcon symbol="BTC" size={38} radius={19} /></span>
            <span className="buy-sell-asset buy-sell-asset--eth"><AssetIcon symbol="ETH" size={30} radius={15} /></span>
            <span className="buy-sell-asset buy-sell-asset--usdt"><AssetIcon symbol="USDT" size={28} radius={14} /></span>
            <span className="buy-sell-page-mark"><IconSwap width={27} height={27} /></span>
            <span className="buy-sell-orbit-dot" />
          </div>
        </div>

        <div className="buy-sell-hero-trust">
          <span className="buy-sell-hero-chip">
            <IconShield width={15} height={15} aria-hidden="true" />
            <span>{t('buySell.nonCustodial')}</span>
          </span>
          <span className="buy-sell-hero-chip">
            <IconFingerprint width={15} height={15} aria-hidden="true" />
            <span>{t('buySell.verifiedLink')}</span>
          </span>
          <span className="buy-sell-hero-chip">
            <IconWallet width={15} height={15} aria-hidden="true" />
            <span>{t('buySell.directSettlement')}</span>
          </span>
        </div>
      </motion.section>

      <BuySellPanel initialOrderId={orderId || null} />

      <motion.section className="lab-card buy-sell-safety" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <span className="buy-sell-safety-mark" style={{ display: 'grid', placeItems: 'center' }}><IconShield width={17} height={17} /></span>
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
