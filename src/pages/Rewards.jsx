import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft, IconCoins, IconTrophy, IconShield } from '../components/Icons';
import RewardsHero from '../components/rewards/RewardsHero';
import RewardsEarnPanel from '../components/rewards/RewardsEarnPanel';
import RewardsRewardsPanel from '../components/rewards/RewardsRewardsPanel';
import '../styles/rewards.css';

/**
 * POINTS & REWARDS — the hub (Earn / Rewards).
 * ---------------------------------------------------------------------------
 * The `?tab=` contract from PR #526 is preserved: Android back steps through
 * tabs, deep links open a tab, and a crash-reload returns to where the user
 * was. Only this page is restyled; the standalone /earn and /leaderboard pages
 * keep their own layouts and data.
 *
 * Two permanent promises are part of the chrome, not a tab:
 *   · FBT is a loyalty balance, not a coin: no price, no trade, no withdrawal.
 *   · Points are a reputation score, not currency.
 * They render above the hero so no tab can accidentally hide them.
 */
const TABS = [
  { id: 'earn', labelKey: 'rewards.v2.tab.earn.label', titleKey: 'rewards.v2.tab.earn.title', subKey: 'rewards.v2.tab.earn.sub', Icon: IconCoins },
  { id: 'rewards', labelKey: 'rewards.v2.tab.rewards.label', titleKey: 'rewards.v2.tab.rewards.title', subKey: 'rewards.v2.tab.rewards.sub', Icon: IconTrophy }
];

export default function Rewards() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [params, setParams] = useSearchParams();

  const fromUrl = params.get('tab');
  const valid = TABS.some((tab) => tab.id === fromUrl);
  const [active, setActive] = useState(valid ? fromUrl : 'earn');

  useEffect(() => {
    if (valid && fromUrl !== active) setActive(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const select = (id) => {
    if (id === active) return;
    haptic?.('select');
    setActive(id);
    setParams({ tab: id }, { replace: true });
  };

  const current = TABS.find((tab) => tab.id === active) || TABS[0];

  return (
    <PageTransition className="page rwd">
      <div className="rwd-aurora" aria-hidden="true" />
      <div className="rwd-grid-bg" aria-hidden="true" />

      <div className="rwd-header">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <div className="rwd-header-title">
          <h1>{t('rewards.title')}</h1>
          <span className="rwd-header-sub">{t('rewards.v2.headerSub')}</span>
        </div>
        <span className="rwd-spark"><IconTrophy width={18} height={18} /></span>
      </div>

      <div className="rwd-loyalty-note" role="note">
        <span className="rwd-loyalty-ico"><IconShield width={15} height={15} /></span>
        <div>
          <b>{t('rewards.v2.loyalty.fbt')}</b>
          <span>{t('rewards.v2.loyalty.points')}</span>
        </div>
      </div>

      <RewardsHero />

      <div className="rwd-tabs" role="tablist" aria-label={t('rewards.title')}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`rwd-tab${active === tab.id ? ' active' : ''}`}
            onClick={() => select(tab.id)}
          >
            {active === tab.id && (
              <motion.span
                layoutId="rwd-tab-ind"
                className="rwd-tab-ind"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <tab.Icon width={16} height={16} aria-hidden="true" />
            <span>{t(tab.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="rwd-active-head">
        <div className="rwd-active-kicker">{t('rewards.v2.activeKicker', { tab: t(current.labelKey) })}</div>
        <h2>{t(current.titleKey)}</h2>
        <p>{t(current.subKey)}</p>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          className="rwd-fade"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          {active === 'earn'
            ? <RewardsEarnPanel onOpenRewards={() => select('rewards')} />
            : <RewardsRewardsPanel />}
        </motion.div>
      </AnimatePresence>

      <div className="rwd-footer-note">
        <IconShield width={13} height={13} />
        <span>{t('rewards.v2.footerNote')}</span>
      </div>
    </PageTransition>
  );
}
