import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft, IconCoins, IconTrophy } from '../components/Icons';
import RewardsHero from '../components/rewards/RewardsHero';
import RewardsEarnPanel from '../components/rewards/RewardsEarnPanel';
import RewardsRewardsPanel from '../components/rewards/RewardsRewardsPanel';
import '../styles/rewards.css';

/**
 * POINTS & REWARDS — امتیاز و پاداش.
 * ---------------------------------------------------------------------------
 * A single, modern hub with a live score hero and two tabs:
 *   earn     — put your assets to work (our own yield products)
 *   rewards  — daily check-in, missions, perks, referral, points history
 *
 * The `?tab=` param is preserved (Android back steps between tabs, deep links
 * land on a tab, crash-reload returns to where you were) — the same contract
 * the old TabbedPage had. Only this page is restyled; /earn and /leaderboard
 * keep their own layouts.
 */
const TABS = [
  { id: 'earn', labelKey: 'nav.earn', Icon: IconCoins },
  { id: 'rewards', labelKey: 'nav.leaderboard', Icon: IconTrophy }
];

export default function Rewards() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [params, setParams] = useSearchParams();

  const fromUrl = params.get('tab');
  const valid = TABS.some((x) => x.id === fromUrl);
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

  return (
    <PageTransition className="page rwd">
      <div className="rwd-aurora" aria-hidden="true" />

      <div className="rwd-header">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1>{t('rewards.title')}</h1>
        <span className="rwd-spark"><IconTrophy width={18} height={18} /></span>
      </div>

      <RewardsHero />

      <div className="rwd-tabs" role="tablist">
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
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          className="rwd-fade"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {active === 'earn' ? <RewardsEarnPanel /> : <RewardsRewardsPanel />}
        </motion.div>
      </AnimatePresence>
    </PageTransition>
  );
}
