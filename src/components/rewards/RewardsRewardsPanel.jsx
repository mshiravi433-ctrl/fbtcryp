import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { riseIn, stagger } from '../PageTransition';
import { useAppStore } from '../../store/useAppStore';
import { useTelegram } from '../../context/TelegramContext';
import { POINT_VALUES } from '../../lib/ranks';
import { rewardsSummary, bindRewardCode } from '../../lib/rewards/rewardsApi';
import { refreshHub, useRewardsHub } from '../../lib/rewards/wheel';
import { fmtNum, fmtDateTime } from '../../lib/format';
import {
  IconWallet, IconSwap, IconKey, IconShield, IconUser, IconCheck,
  IconSparkle, IconTrophy, IconChevronRight
} from '../Icons';
import DailyWheel from './DailyWheel';
import StreakCard from './StreakCard';
import ReferralCard from './ReferralCard';
import BadgesSection from './BadgesSection';
import LearnQuests from './LearnQuests';
import FocusGame from './FocusGame';
import SeasonCard from './SeasonCard';
import RebateLadder from './RebateLadder';
import ProfileCard from './ProfileCard';

/* The same five real quests Earn.jsx and Leaderboard.jsx use. */
const QUESTS = [
  { id: 'connectWallet', to: '/wallet', pts: POINT_VALUES.connectWallet, Icon: IconWallet, tone: 'var(--rgb-1)' },
  { id: 'firstSwap', to: '/swap', pts: POINT_VALUES.firstSwap, Icon: IconSwap, tone: 'var(--rgb-2)' },
  { id: 'backupWallet', to: '/wallet', pts: POINT_VALUES.backupWallet, Icon: IconKey, tone: 'var(--rgb-5)' },
  { id: 'enable2fa', to: '/settings', pts: POINT_VALUES.enable2fa, Icon: IconShield, tone: 'var(--rgb-1)' },
  { id: 'inviteFriend', to: null, pts: POINT_VALUES.referral, Icon: IconUser, tone: 'var(--rgb-3)' }
];

const SECTIONS = [
  { id: 'rwd-wheel', key: 'wheel' },
  { id: 'rwd-streak', key: 'streak' },
  { id: 'rwd-referral', key: 'referral' },
  { id: 'rwd-badges', key: 'badges' },
  { id: 'rwd-learn', key: 'learn' },
  { id: 'rwd-focus', key: 'focus' },
  { id: 'rwd-season', key: 'season' },
  { id: 'rwd-perks', key: 'perks' },
  { id: 'rwd-profile', key: 'profile' }
];

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
 *
 * One vertical journey, anchored by a quick-jump rail: wheel → streak → real
 * quests → referral → soulbound badges → lessons → focus round → honest season
 * → fee ladder → shareable profile → points history.
 *
 * Every point-bearing surface routes through the existing server-backed store
 * actions. The device ledger (wheel/entries/badges) is explicitly labelled as
 * device-local where that matters.
 */
export default function RewardsRewardsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, user } = useTelegram();
  const hub = useRewardsHub();

  const points = useAppStore((s) => s.points);
  const streak = useAppStore((s) => s.streak);
  const referralsLocal = useAppStore((s) => s.referrals);
  const quests = useAppStore((s) => s.quests);
  const pointsLog = useAppStore((s) => s.pointsLog);
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);

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

  const jump = (id) => {
    haptic?.('select');
    const node = document.getElementById(id);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openQuest = (quest) => {
    haptic?.('select');
    if (quest.id === 'inviteFriend') {
      jump('rwd-referral');
      return;
    }
    if (quest.to) navigate(quest.to);
  };

  return (
    <div className="rwd-panel rwd-fade">
      <nav className="rwd-quicknav" aria-label={t('rewards.v2.quicknav')}>
        {SECTIONS.map((section) => (
          <button key={section.id} type="button" className="rwd-quicknav-chip" onClick={() => jump(section.id)}>
            {t(`rewards.v2.quicknavItems.${section.key}`)}
          </button>
        ))}
      </nav>

      <DailyWheel />

      <div className="rwd-grid-2">
        <StreakCard />
        <section className="rwd-card rwd-missions-card">
          <header className="rwd-sec-head">
            <div>
              <div className="rwd-kicker">{t('rewards.v2.missions.kicker')}</div>
              <h3 className="rwd-sec-title">
                <IconTrophy width={17} height={17} style={{ color: 'var(--rgb-5)' }} />
                {t('rewards.v2.missions.title')}
              </h3>
            </div>
            <span className="rwd-chip">{t('rewards.v2.missions.chip')}</span>
          </header>
          <p className="rwd-prose">{t('rewards.v2.missions.sub')}</p>
          <motion.div className="rwd-list rwd-missions-list" variants={stagger} initial="hidden" animate="show">
            {QUESTS.map((quest) => {
              const done = Boolean(quests?.[quest.id]?.done);
              return (
                <motion.button
                  key={quest.id}
                  type="button"
                  className={`rwd-quest${done ? ' done' : ''}`}
                  variants={riseIn}
                  onClick={() => openQuest(quest)}
                  disabled={done}
                >
                  <span
                    className="rwd-quest-ico"
                    style={{
                      color: quest.tone,
                      borderColor: done ? 'transparent' : quest.tone,
                      background: done ? 'rgba(0,255,157,.12)' : `color-mix(in srgb, ${quest.tone} 12%, transparent)`
                    }}
                  >
                    {done ? <IconCheck width={16} height={16} /> : <quest.Icon width={16} height={16} />}
                  </span>
                  <span className="rwd-quest-meta">
                    <span className="rwd-quest-title">{t(`earn.quest.${quest.id}`)}</span>
                    <span className="rwd-quest-pts">+{quest.pts} {t('rank.pts')}</span>
                  </span>
                  <span className={`rwd-pill${done ? ' up' : ''}`}>
                    {done ? '✓' : <IconChevronRight width={13} height={13} />}
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
          <p className="rwd-fine">{t('rewards.v2.missions.note')}</p>
        </section>
      </div>

      <ReferralCard summary={summary} online={online} />

      <BadgesSection points={points} streak={streak} referrals={referrals} pointsLog={pointsLog} />

      <LearnQuests />

      <FocusGame />

      <SeasonCard />

      <RebateLadder points={points} />

      <ProfileCard referrals={referrals} />

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

      <div className="rwd-device-note">
        <IconSparkle width={13} height={13} />
        <span>{t('rewards.v2.deviceNote')}</span>
      </div>
      {!online && loaded && <p className="rwd-fine">{t('rewards.offlineNote')}</p>}
    </div>
  );
}
