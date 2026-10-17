import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/useAppStore';
import { useTelegram } from '../../context/TelegramContext';
import { rewardsSummary, bindRewardCode } from '../../lib/rewards/rewardsApi';
import { refreshHub, useRewardsHub, pendingTierBox, focusAvailable } from '../../lib/rewards/wheel';
import { dailyRewardStatus } from '../../lib/dailyRewards';
import { fmtNum, fmtDateTime } from '../../lib/format';
import { IconSparkle } from '../Icons';
import DailyWheel from './DailyWheel';
import StreakCard from './StreakCard';
import ReferralCard from './ReferralCard';
import BadgesSection from './BadgesSection';
import LearnQuests from './LearnQuests';
import FocusGame from './FocusGame';
import SeasonCard from './SeasonCard';
import RebateLadder from './RebateLadder';
import ProfileCard from './ProfileCard';
import RewardsMissions from './RewardsMissions';
import RewardsSubNav from './RewardsSubNav';
import { REWARD_SECTIONS } from './sections';

function labelFor(t, action) {
  const raw = String(action ?? '');
  if (raw.startsWith('wheel:')) return t('rewards.v2.actions.wheel');
  if (raw.startsWith('learn:')) return t('rewards.v2.actions.learn');
  const id = raw.replace(/^quest:/, '').replace(/^mission:/, '');
  if (raw.startsWith('mission:')) {
    return t(`rewards.mission.${id}`, { defaultValue: '' }) || t('rewards.missionBonus');
  }
  if (raw === 'sync') return t('rank.action.sync', { defaultValue: t('rewards.action.sync') });
  if (raw === 'dailyWheel') return t('rewards.v2.actions.wheel');
  if (raw === 'learn') return t('rewards.v2.actions.learn');
  return t(`rank.action.${id}`, { defaultValue: '' }) || t('rank.action.quest');
}

/**
 * REWARDS TAB — the gamified side of the hub.
 * ---------------------------------------------------------------------------
 * ONE SECTION AT A TIME. The tab used to be a single scrolling page holding
 * eleven stacked surfaces; the user complained that it was crowded and that
 * tapping a chip only scrolled them further down the pile. Now the dock at
 * the top is a real switcher: one chip, one section, nothing else mounted.
 *
 * Every point-bearing surface routes through the existing server-backed store
 * actions. The device ledger (wheel/entries/badges) is explicitly labelled as
 * device-local where that matters.
 */
export default function RewardsRewardsPanel({ section, onSection }) {
  const { t } = useTranslation();
  const { haptic, user } = useTelegram();
  const hub = useRewardsHub();

  const points = useAppStore((s) => s.points);
  const streak = useAppStore((s) => s.streak);
  const referralsLocal = useAppStore((s) => s.referrals);
  const pointsLog = useAppStore((s) => s.pointsLog);
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);
  const quests = useAppStore((s) => s.quests);
  const lastClaim = useAppStore((s) => s.lastClaim);

  const dailyStatus = useMemo(
    () => dailyRewardStatus({ now: Date.now(), lastClaim, streak }),
    [lastClaim, streak]
  );
  const questsLeft = useMemo(
    () => ['connectWallet', 'firstSwap', 'backupWallet', 'enable2fa', 'inviteFriend']
      .filter((id) => !quests?.[id]?.done).length,
    [quests]
  );

  const [summary, setSummary] = useState(null);
  const [online, setOnline] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    refreshHub();
  }, []);

  useEffect(() => {
    let alive = true;
    void rewardsSummary().then((res) => {
      if (!alive) return;
      if (res.ok) {
        setSummary(res.data);
        setOnline(true);
        useAppStore.getState().syncServerPoints(Number(res.data?.points) || 0);
      } else {
        setOnline(false);
      }
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  const refCode = useMemo(() => ensureRefCode(user?.id), [ensureRefCode, user?.id]);
  useEffect(() => { if (refCode) void bindRewardCode({ code: refCode }); }, [refCode]);

  const serverReferrals = Number(summary?.referrals?.total);
  const referrals = Math.max(
    Number.isFinite(serverReferrals) ? serverReferrals : 0,
    Number(referralsLocal) || 0,
    hub.refsSeen
  );

  const history = useMemo(
    () => [...(pointsLog ?? [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 10),
    [pointsLog]
  );

  const openReferral = () => onSection?.('referral');

  /** A live dot on the chips: something is genuinely waiting there. */
  const badgeOf = (id) => {
    if (id === 'streak') return dailyStatus.canClaim;
    if (id === 'missions') return questsLeft > 0;
    if (id === 'badges') return Boolean(pendingTierBox(points));
    if (id === 'focus') return focusAvailable();
    return false;
  };

  const select = (id) => {
    if (id === section) return;
    haptic?.('select');
    onSection?.(id);
  };

  const sections = {
    wheel: <DailyWheel />,
    streak: <StreakCard />,
    missions: <RewardsMissions onOpenReferral={openReferral} />,
    referral: <ReferralCard summary={summary} online={online} />,
    badges: <BadgesSection points={points} streak={streak} referrals={referrals} pointsLog={pointsLog} />,
    learn: <LearnQuests />,
    focus: <FocusGame />,
    season: <SeasonCard />,
    perks: <RebateLadder points={points} />,
    profile: <ProfileCard referrals={referrals} />
  };

  const active = REWARD_SECTIONS.some((row) => row.id === section) ? section : REWARD_SECTIONS[0].id;

  return (
    <div className="rwd-panel rwd-fade">
      <RewardsSubNav items={REWARD_SECTIONS} active={active} onSelect={select} badgeOf={badgeOf} />

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          className="rwd-fade"
          initial={{ opacity: 0, y: 14, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.99 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
          {sections[active]}
        </motion.div>
      </AnimatePresence>

      {active === 'profile' && (
        <section className="rwd-history" id="rwd-history">
          <div className="rwd-section-head">
            <h2>{t('rank.historyTitle')}</h2>
            <span className="rwd-chip">{t('rewards.v2.history.chip')}</span>
          </div>
          {history.length === 0 ? (
            <p className="rwd-empty">{t('rank.noneYet')}</p>
          ) : (
            <div className="rwd-card rwd-history-card">
              <div className="rwd-timeline">
                {history.map((entry) => (
                  <div key={`${entry.id || entry.action}-${entry.at}`} className="rwd-entry">
                    <span className="rwd-entry-dot" />
                    <div className="rwd-entry-meta">
                      <div className="rwd-entry-title">{labelFor(t, entry.action)}</div>
                      <div className="rwd-entry-time">{fmtDateTime(entry.at)}</div>
                    </div>
                    <div className="rwd-entry-pts">+{fmtNum(entry.amount ?? entry.pts ?? 0, 0)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="rwd-fine">{t('rewards.v2.history.note')}</p>
        </section>
      )}

      <div className="rwd-device-note">
        <IconSparkle width={13} height={13} />
        <span>{t('rewards.v2.deviceNote')}</span>
      </div>
      {!online && loaded && <p className="rwd-fine">{t('rewards.offlineNote')}</p>}
    </div>
  );
}
