import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import TierTotem, { TIER_ANIMALS } from './TierTotem';
import { TIERS } from '../../lib/ranks';
import { achievementsFor } from '../../lib/rewards/achievements';
import {
  markAchievement, openTierBox, pendingTierBox, useRewardsHub
} from '../../lib/rewards/wheel';
import { fmtDateTime } from '../../lib/format';
import { IconLock, IconSparkle, IconCheck } from '../Icons';

/** Staggered entrance for the discovery wall. */
const wall = {
  hidden: {},
  show: { transition: { staggerChildren: 0.028, delayChildren: 0.02 } }
};
const card = {
  hidden: { opacity: 0, y: 10, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }
};

/**
 * BADGES — the soulbound shelf, the discovery wall and the tier milestone box.
 *
 * There is no "mint" button and no wallet interaction. A badge is added only by
 * a real event already recorded in this install: a wheel sector, a confirmed
 * referral, a tier crossing, or an achievement condition derived from the
 * points ledger. Everything on this shelf is explicitly non-transferable.
 *
 * THE DISCOVERY WALL — twenty-eight cards, one per verifiable thing the user
 * has actually done, each one carrying a different animal. The filter row
 * narrows the wall to a single tier, which is what turns the list into a
 * hunt: the user can see exactly how many bronze cards are still missing.
 */
export default function BadgesSection({ points, streak, referrals, pointsLog }) {
  const { t } = useTranslation();
  const hub = useRewardsHub();
  const [boxResult, setBoxResult] = useState(null);
  const [filter, setFilter] = useState('all');

  const achievements = useMemo(
    () => achievementsFor({ points, streak, referrals, pointsLog, nfts: hub.nfts }),
    [points, streak, referrals, pointsLog, hub.nfts]
  );

  useEffect(() => {
    for (const row of achievements) {
      if (row.earned && !hub.achievements[row.id]) markAchievement(row.id);
    }
  }, [achievements, hub.achievements]);

  const box = pendingTierBox(points);
  const owned = new Set(hub.nfts.map((row) => row.tier));

  useEffect(() => { if (box) setBoxResult(null); }, [box?.id]);
  const earnedCount = achievements.filter((row) => row.earned).length;
  const shown = filter === 'all'
    ? achievements
    : achievements.filter((row) => row.tier === filter);

  const openBox = () => {
    if (!box) return;
    const result = openTierBox(box.id);
    if (result) setBoxResult(result);
  };

  return (
    <section className="rwd-card rwd-badges-card" id="rwd-badges">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.badges.kicker')}</div>
          <h3 className="rwd-sec-title">
            <IconSparkle width={17} height={17} style={{ color: 'var(--rgb-1)' }} />
            {t('rewards.v2.badges.title')}
          </h3>
        </div>
        <span className="rwd-chip">{t('rewards.v2.badges.ownedChip', { n: owned.size, total: TIERS.length })}</span>
      </header>

      <p className="rwd-prose">{t('rewards.v2.badges.sub')}</p>

      <div className="rwd-medal-shelf">
        {TIERS.map((tier) => {
          const has = owned.has(tier.id);
          const row = hub.nfts.find((n) => n.tier === tier.id);
          return (
            <div
              key={tier.id}
              className={`rwd-medal${has ? ' owned' : ' locked'}`}
              style={{ '--tier': tier.color }}
            >
              <div className="rwd-medal-art">
                <TierTotem tier={tier.id} size={58} idle={has} locked={!has} />
              </div>
              <div className="rwd-medal-name">{t(`rank.tier.${tier.id}`)}</div>
              <div className="rwd-medal-animal">{t(`rewards.v2.animals.${TIER_ANIMALS[tier.id]}`)}</div>
              {has ? (
                <span className="rwd-medal-state up"><IconCheck width={10} height={10} /> {t('rewards.v2.badges.owned')}</span>
              ) : (
                <span className="rwd-medal-state"><IconLock width={10} height={10} /> {t('rewards.v2.badges.locked')}</span>
              )}
              {has && row?.at && <span className="rwd-medal-date">{fmtDateTime(row.at)}</span>}
            </div>
          );
        })}
      </div>

      <div className="rwd-soulbound-note">
        <span aria-hidden="true">◈</span> {t('rewards.v2.badges.soulbound')}
      </div>

      <AnimatePresence>
        {box && !boxResult && (
          <motion.div
            className="rwd-mystery"
            style={{ '--tier': box.color }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
          >
            <div className="rwd-mystery-glow" aria-hidden="true" />
            <TierTotem tier={box.id} size={70} />
            <div className="rwd-mystery-body">
              <div className="rwd-kicker">{t('rewards.v2.badges.boxKicker')}</div>
              <div className="rwd-mystery-title">{t('rewards.v2.badges.boxTitle', { tier: t(`rank.tier.${box.id}`) })}</div>
              <p className="rwd-prose">{t('rewards.v2.badges.boxSub')}</p>
            </div>
            <button type="button" className="btn btn-primary rwd-mystery-btn" onClick={openBox}>
              {t('rewards.v2.badges.boxOpen')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {boxResult && (
          <motion.div
            className="rwd-mystery-result"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <span className="rwd-wheel-result-glyph" aria-hidden="true">✦</span>
            <span>{t('rewards.v2.badges.boxResult', { tier: t(`rank.tier.${boxResult.tier.id}`) })}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rwd-achievements">
        <div className="rwd-achievements-head">
          <div>
            <h4>{t('rewards.v2.badges.achievements')}</h4>
            <span className="rwd-achievements-sub">{t('rewards.v2.badges.achievementsSub')}</span>
          </div>
          <span className="rwd-pill up">{earnedCount}/{achievements.length}</span>
        </div>

        <div className="rwd-ach-filter" role="group" aria-label={t('rewards.v2.badges.achievements')}>
          <button
            type="button"
            className={`rwd-ach-filter-chip${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t('rewards.v2.badges.allTiers')}
          </button>
          {TIERS.map((tier) => {
            const total = achievements.filter((row) => row.tier === tier.id).length;
            const got = achievements.filter((row) => row.tier === tier.id && row.earned).length;
            return (
              <button
                key={tier.id}
                type="button"
                className={`rwd-ach-filter-chip${filter === tier.id ? ' active' : ''}`}
                style={{ '--tier': tier.color }}
                onClick={() => setFilter(tier.id)}
              >
                <TierTotem tier={tier.id} size={16} idle={false} interactive={false} locked={got === 0} />
                {got}/{total}
              </button>
            );
          })}
        </div>

        <motion.div className="rwd-ach-grid" key={filter} variants={wall} initial="hidden" animate="show">
          {shown.map((row) => (
            <motion.div
              key={row.id}
              className={`rwd-ach${row.earned ? ' earned' : ''}`}
              style={{ '--tier': row.tierMeta.color }}
              variants={card}
            >
              <TierTotem tier={row.tier} size={36} idle={row.earned} interactive={false} locked={!row.earned} />
              <div className="rwd-ach-meta">
                <div className="rwd-ach-title">{t(`rewards.v2.achievements.${row.id}.title`)}</div>
                <div className="rwd-ach-desc">{t(`rewards.v2.achievements.${row.id}.desc`)}</div>
                {!row.earned && (
                  <div className="rwd-bar rwd-bar-sm">
                    <span className="rwd-bar-fill" style={{ width: `${Math.round(row.progress * 100)}%` }} />
                  </div>
                )}
              </div>
              <span className={`rwd-ach-state${row.earned ? ' up' : ''}`}>
                {row.earned ? '✓' : `${Math.round(row.progress * 100)}%`}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </div>

      <p className="rwd-fine">{t('rewards.v2.badges.note')}</p>
    </section>
  );
}
