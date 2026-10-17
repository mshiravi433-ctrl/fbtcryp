import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { YIELD } from '../../lib/earnProducts';
import { vaultIsLive } from '../../lib/vault';
import { useTelegram } from '../../context/TelegramContext';
import VaultCard from '../VaultCard';
import InfoBox from '../InfoBox';
import AdBanner from '../AdBanner';
import { riseIn, stagger } from '../PageTransition';

const riskTone = (risk) =>
  risk === 'low' ? 'up' : risk === 'medium' ? 'amber' : 'rgb';

/**
 * EARN tab — "put your assets to work". Every row is one of OUR OWN products
 * (no outbound links, no invented APYs — see lib/earnProducts.js). The data is
 * the same audited list Earn.jsx uses; only the presentation is new.
 */
export default function RewardsEarnPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  const products = useMemo(() => YIELD, []);
  const vault = vaultIsLive();

  const go = (to) => { haptic?.('select'); navigate(to); };

  return (
    <div className="rwd-panel rwd-fade">
      <section className="rwd-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center',
            background: 'linear-gradient(135deg, var(--rgb-4), #00e5ff)', color: '#001014', fontSize: 16
          }}>◈</span>
          <h2 style={{ fontSize: 14.5, fontWeight: 800, margin: 0 }}>{t('earn.realTitle')}</h2>
        </div>
        <p className="rwd-prose">{t('earn.realBody')}</p>
      </section>

      {vault && <VaultCard />}

      <div className="rwd-section-head">
        <h2>{t('earn.opportunities')}</h2>
      </div>

      <motion.div className="rwd-prod-grid" variants={stagger} initial="hidden" animate="show">
        {products.map((y) => (
          <motion.button
            key={y.id}
            type="button"
            className="rwd-prod"
            variants={riseIn}
            onClick={() => go(y.internal)}
            style={{ textAlign: 'start' }}
          >
            <span className="rwd-prod-ico" style={{ background: `linear-gradient(135deg, ${y.color}, color-mix(in srgb, ${y.color} 30%, #000))` }}>
              <y.Icon width={22} height={22} />
            </span>
            <div className="rwd-prod-title">{t(`earn.yield.${y.id}.title`)}</div>
            <div className="rwd-prod-body">{t(`earn.yield.${y.id}.body`)}</div>

            <div className="rwd-prod-pills">
              <span className={`rwd-pill ${riskTone(y.risk)}`}>{t(`invest.risk.${y.risk}`)}</span>
              <span className="rwd-pill">{t(`earn.yield.${y.id}.tag`)}</span>
              <span className="rwd-pill rgb">{t('earn.inApp')}</span>
            </div>

            {y.buys && (
              <div className="rwd-buy-row">
                {y.buys.map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => { e.stopPropagation(); haptic?.('select'); navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(sym)}`); }}
                  >
                    {t('earn.yield.buy', { sym })}
                  </button>
                ))}
              </div>
            )}

            <div className="rwd-prod-note">{t(`earn.yield.${y.id}.note`)}</div>
          </motion.button>
        ))}
      </motion.div>

      <InfoBox title={t('earn.riskTitle')} tone="danger" id="rwd-earn-risk">
        <p className="rwd-prose">{t('earn.realRisk')}</p>
        <p className="rwd-prose">{t('earn.aprNote')}</p>
      </InfoBox>

      <AdBanner slot="farm" />
    </div>
  );
}
