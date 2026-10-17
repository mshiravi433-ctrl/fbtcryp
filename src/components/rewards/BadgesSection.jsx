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
import { IconLock, IconSparkle } from '../Icons';

/**
 * BADGES — the soulbound shelf, auto achievements and the tier milestone box.
 *
 * There is no "mint" button and no wallet interaction. A badge is added only by
 * a real event already recorded in this install: a wheel sector, a confirmed
 * referral, a tier crossing, or an achievement condition derived from the
 * points ledger. Everything on this shelf is explicitly non-transferable.
 */
export default function BadgesSection({ points, streak, referrals, pointsLog }) {
  const { t } = useTranslation();
  const hub = useRewardsHub();
  const [boxResult, setBoxResult] = useState(null);

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

      <div className="rwd-nft-shelf">
        {TIERS.map((tier) => {
          const has = owned.has(tier.id);
          const row = hub.nfts.find((n) => n.tier === tier.id);
          return (
            <div
              key={tier.id}
              className={`rwd-nft${has ? ' owned' : ' locked'}`}
              style={{ '--tier': tier.color }}
            >
              <TierTotem tier={tier.id} size={62} idle={has} locked={!has} />
              <div className="rwd-nft-name">{t(`rank.tier.${tier.id}`)}</div>
              <div className="rwd-nft-animal">{t(`rewards.v2.animals.${TIER_ANIMALS[tier.id]}`)}</div>
              {has ? (
                <span className="rwd-nft-state up">{t('rewards.v2.badges.owned')}</span>
              ) : (
                <span className="rwd-nft-state"><IconLock width={10} height={10} /> {t('rewards.v2.badges.locked')}</span>
              )}
              {has && row?.at && <span className="rwd-nft-date">{fmtDateTime(row.at)}</span>}
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
          <h4>{t('rewards.v2.badges.achievements')}</h4>
          <span className="rwd-pill">{earnedCount}/{achievements.length}</span>
        </div>
        <div className="rwd-ach-grid">
          {achievements.map((row) => (
            <div
              key={row.id}
              className={`rwd-ach${row.earned ? ' earned' : ''}`}
              style={{ '--tier': row.tierMeta.color }}
            >
              <TierTotem tier={row.tier} size={38} idle={row.earned} interactive={false} locked={!row.earned} />
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
            </div>
          ))}
        </div>
      </div>

      <p className="rwd-fine">{t('rewards.v2.badges.note')}</p>
    </section>
  );
}
