import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import BuySellPanel from '../components/BuySellPanel';
import { IconChevronLeft, IconFingerprint, IconShield, IconSwap } from '../components/Icons';
import '../styles/lab-modern.css';
import '../styles/buy-sell.css';
import '../styles/iran-buy.css';

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
 * ─── THE HEADER IS A HERO NOW (2026-10-30) ─────────────────────────────────
 * «صفحهٔ خرید و فروش را از نظر رنگ، باکس، ایکون، اندازه و فاصله، زبان و تم
 *  درست کن.»
 *
 * What was here: a back chevron, a 32px badge, an h1 and a grey paragraph
 * floating on the page background — the same shape as fifteen other internal
 * screens. On the one screen where a stranger is about to hand over money,
 * that reads as a settings sub-page rather than as a counter.
 *
 * It is now a single glass hero: an aurora that carries the desk's mint→cyan
 * (buy) identity, the badge at a real size, a kicker, the title, the intro and
 * three trust chips that state — in the reader's own language — what this
 * screen will and will not do. Nothing in it is new behaviour; the same
 * strings that used to sit in one grey paragraph are now scannable.
 *
 * The hero is RTL-safe by construction: every offset is logical, the back
 * chevron is mirrored by its own icon set, and the aurora is anchored to the
 * inline edges rather than to "left" and "right".
 */
export default function Buy() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orderId } = useParams();

  return (
    <PageTransition>
      <motion.section
        className="buy-sell-hero"
        variants={riseIn}
        initial="hidden"
        animate="show"
      >
        <span className="buy-sell-hero-field" aria-hidden="true">
          <i className="buy-sell-hero-bloom buy-sell-hero-bloom--a" />
          <i className="buy-sell-hero-bloom buy-sell-hero-bloom--b" />
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
          <span className="buy-sell-page-mark" aria-hidden="true">
            <IconSwap width={19} height={19} />
          </span>
          <div className="buy-sell-hero-text">
            <span className="buy-sell-hero-kicker" aria-hidden="true">FBT · ON / OFF RAMP</span>
            <h1 className="buy-sell-hero-title">
              {orderId ? t('buySell.resultTitle') : t('buySell.title')}
            </h1>
          </div>
        </div>

        <p className="prose-sm buy-sell-page-intro">
          {orderId ? t('buySell.resultIntro') : t('buySell.pageIntro')}
        </p>

        <div className="buy-sell-hero-trust">
          <span className="buy-sell-hero-chip">
            <IconShield width={13} height={13} aria-hidden="true" />
            {t('buySell.nonCustodial')}
          </span>
          <span className="buy-sell-hero-chip">
            <IconFingerprint width={13} height={13} aria-hidden="true" />
            {t('buySell.verifiedLink')}
          </span>
          <span className="buy-sell-hero-chip">
            <IconSwap width={13} height={13} aria-hidden="true" />
            {t('buySell.generalCaption')}
          </span>
        </div>
      </motion.section>

      <BuySellPanel initialOrderId={orderId || null} />

      <motion.section className="lab-card buy-sell-safety" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <span className="buy-sell-safety-mark" style={{ color: 'var(--rgb-5)', display: 'grid', placeItems: 'center' }}><IconShield width={17} height={17} /></span>
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
