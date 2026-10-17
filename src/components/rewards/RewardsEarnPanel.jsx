import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { YIELD } from '../../lib/earnProducts';
import { vaultIsLive } from '../../lib/vault';
import { useTelegram } from '../../context/TelegramContext';
import { useAppStore } from '../../store/useAppStore';
import { POINT_VALUES, tierFor, nextTier, tierProgress } from '../../lib/ranks';
import { fbtFromPoints } from '../../lib/fbt';
import { fmtNum } from '../../lib/format';
import VaultCard from '../VaultCard';
import InfoBox from '../InfoBox';
import AdBanner from '../AdBanner';
import TierTotem from './TierTotem';
import { riseIn, stagger } from '../PageTransition';
import { IconChevronRight, IconSparkle } from '../Icons';

const riskTone = (risk) =>
  risk === 'low' ? 'up' : risk === 'medium' ? 'amber' : 'rgb';

/**
 * EARN TAB — put assets to work, with the points bridge made explicit.
 *
 * The product list is the SAME audited YIELD array used by /earn: no outbound
 * links, no typed APY/APR, only rows that navigate to our own screens. The new
 * "points bridge" card uses the real POINT_VALUES table, so the connection
 * between doing the work and climbing the animal ladder is visible without
 * inventing a reward.
 */
export default function RewardsEarnPanel({ onOpenRewards }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  const products = useMemo(() => YIELD, []);
  const vault = vaultIsLive();

  const points = useAppStore((s) => s.points);
  const tier = tierFor(points);
  const next = nextTier(points);
  const progress = tierProgress(points);
  const fbt = fbtFromPoints(points);

  const go = (to) => { haptic?.('select'); navigate(to); };

  const bridges = [
    { key: 'swap', value: POINT_VALUES.swap },
    { key: 'firstSwap', value: POINT_VALUES.firstSwap },
    { key: 'lending', value: POINT_VALUES.lending },
    { key: 'bridge', value: POINT_VALUES.bridge }
  ];

  return (
    <div className="rwd-panel rwd-fade">
      <section className="rwd-card rwd-earn-bridge" style={{ '--accent': tier.color }}>
        <div className="rwd-earn-bridge-orb">
          <TierTotem tier={tier.id} size={104} />
        </div>
        <div className="rwd-earn-bridge-copy">
          <div className="rwd-kicker">{t('rewards.v2.earn.kicker')}</div>
          <h3 className="rwd-sec-title">{t('rewards.v2.earn.title')}</h3>
          <p className="rwd-prose">{t('rewards.v2.earn.sub')}</p>
          <div className="rwd-earn-bridge-stats">
            <span><b>{fmtNum(points, 0)}</b> {t('rewards.points')}</span>
            <span><b>{fmtNum(fbt, 0)}</b> FBT</span>
            <span><b>{t(`rank.tier.${tier.id}`)}</b></span>
          </div>
          <div className="rwd-bar rwd-earn-bar">
            <motion.span
              className="rwd-bar-fill"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <div className="rwd-earn-bridge-foot">
            <span>
              {next
                ? t('rewards.v2.earn.next', { n: fmtNum(next.min - points, 0), tier: t(`rank.tier.${next.id}`) })
                : t('rewards.levelMax')}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenRewards}>
              <IconSparkle width={13} height={13} /> {t('rewards.v2.earn.openRewards')}
            </button>
          </div>
        </div>
      </section>

      <section className="rwd-card rwd-earn-real">
        <div className="rwd-sec-head">
          <div>
            <div className="rwd-kicker">{t('rewards.v2.earn.onlyOurs')}</div>
            <h3 className="rwd-sec-title">{t('earn.realTitle')}</h3>
          </div>
          <span className="rwd-chip up">{t('earn.inApp')}</span>
        </div>
        <p className="rwd-prose">{t('earn.realBody')}</p>
      </section>

      {vault && <VaultCard />}

      <div className="rwd-section-head">
        <h2>{t('earn.opportunities')}</h2>
        <span className="rwd-chip">{t('rewards.v2.earn.noApy')}</span>
      </div>

      <motion.div className="rwd-prod-grid" variants={stagger} initial="hidden" animate="show">
        {products.map((product) => (
          <motion.div
            key={product.id}
            className="rwd-prod"
            variants={riseIn}
            style={{ '--prod': product.color }}
          >
            <div className="rwd-prod-top">
              <span className="rwd-prod-ico" style={{ background: `linear-gradient(135deg, ${product.color}, color-mix(in srgb, ${product.color} 22%, #000))` }}>
                <product.Icon width={22} height={22} />
              </span>
              <span className={`rwd-pill ${riskTone(product.risk)}`}>{t(`invest.risk.${product.risk}`)}</span>
            </div>

            <div className="rwd-prod-title">{t(`earn.yield.${product.id}.title`)}</div>
            <div className="rwd-prod-body">{t(`earn.yield.${product.id}.body`)}</div>

            <div className="rwd-prod-pills">
              <span className="rwd-pill">{t(`earn.yield.${product.id}.tag`)}</span>
              <span className="rwd-pill rgb">{t('earn.inApp')}</span>
            </div>

            <button type="button" className="rwd-prod-open" onClick={() => go(product.internal)}>
              {t('rewards.v2.earn.openProduct')} <IconChevronRight width={14} height={14} />
            </button>

            {product.buys && (
              <div className="rwd-buy-row">
                {product.buys.map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      haptic?.('select');
                      navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(symbol)}`);
                    }}
                  >
                    {t('earn.yield.buy', { sym: symbol })}
                  </button>
                ))}
              </div>
            )}

            <div className="rwd-prod-note">{t(`earn.yield.${product.id}.note`)}</div>
          </motion.div>
        ))}
      </motion.div>

      <section className="rwd-card rwd-points-bridge">
        <header className="rwd-sec-head">
          <div>
            <div className="rwd-kicker">{t('rewards.v2.earn.pointsKicker')}</div>
            <h3 className="rwd-sec-title">{t('rewards.v2.earn.pointsTitle')}</h3>
          </div>
          <span className="rwd-chip">{t('rewards.v2.earn.pointsChip')}</span>
        </header>
        <p className="rwd-prose">{t('rewards.v2.earn.pointsSub')}</p>
        <div className="rwd-points-bridge-grid">
          {bridges.map((row) => (
            <div key={row.key} className="rwd-points-bridge-row">
              <span>{t(`rank.action.${row.key}`)}</span>
              <b>+{row.value}</b>
            </div>
          ))}
        </div>
        <p className="rwd-fine">{t('rewards.v2.earn.pointsNote')}</p>
      </section>

      <InfoBox title={t('earn.riskTitle')} tone="danger" id="rwd-earn-risk">
        <p className="rwd-prose">{t('earn.realRisk')}</p>
        <p className="rwd-prose">{t('earn.aprNote')}</p>
      </InfoBox>

      <AdBanner slot="farm" />
    </div>
  );
}
