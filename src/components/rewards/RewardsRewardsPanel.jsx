import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { riseIn, stagger } from '../PageTransition';
import { useAppStore } from '../../store/useAppStore';
import { useTelegram } from '../../context/TelegramContext';
import { POINT_VALUES, tierFor } from '../../lib/ranks';
import { perksFor } from '../../lib/perks';
import { dailyRewardStatus } from '../../lib/dailyRewards';
import { bindRewardCode } from '../../lib/rewards/rewardsApi';
import { siteInviteUrl } from '../../lib/referral';
import { copyText } from '../../lib/share';
import { useShare } from '../../hooks/useShare';
import { fmtNum, fmtDateTime } from '../../lib/format';
import InfoBox from '../InfoBox';
import ShareSheet from '../ShareSheet';
import {
  IconWallet, IconSwap, IconKey, IconShield, IconUser,
  IconCheck, IconCopy, IconLink, IconSparkle
} from '../Icons';

/* Missions — identical to Earn's QUESTS so behaviour never diverges. */
const QUESTS = [
  { id: 'connectWallet', to: '/wallet', pts: POINT_VALUES.connectWallet, Icon: IconWallet, tone: 'var(--rgb-1)' },
  { id: 'firstSwap', to: '/swap', pts: POINT_VALUES.firstSwap, Icon: IconSwap, tone: 'var(--rgb-2)' },
  { id: 'backupWallet', to: '/wallet', pts: POINT_VALUES.backupWallet, Icon: IconKey, tone: 'var(--rgb-5)' },
  { id: 'enable2fa', to: '/settings', pts: POINT_VALUES.enable2fa, Icon: IconShield, tone: 'var(--rgb-1)' },
  { id: 'inviteFriend', to: null, pts: POINT_VALUES.referral, Icon: IconUser, tone: 'var(--rgb-3)' }
];

function labelFor(t, action) {
  const id = String(action ?? '').replace(/^quest:/, '').replace(/^mission:/, '');
  if (String(action ?? '').startsWith('mission:')) {
    return t(`rewards.mission.${id}`, { defaultValue: '' }) || t('rewards.missionBonus');
  }
  if (action === 'sync') return t('rank.action.sync', { defaultValue: t('rewards.action.sync') });
  return t(`rank.action.${id}`, { defaultValue: '' }) || t('rank.action.quest');
}

/**
 * REWARDS tab — the "امتیاز" side: daily check-in, missions, the perks your
 * tier unlocks, referral, and an honest log of where every point came from.
 * Logic mirrors Earn.jsx / Leaderboard.jsx exactly; only the presentation is
 * new.
 */
export default function RewardsRewardsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, user, tg } = useTelegram();
  const [share, shareSheet] = useShare();

  const points = useAppStore((s) => s.points);
  const streak = useAppStore((s) => s.streak);
  const lastClaim = useAppStore((s) => s.lastClaim);
  const referrals = useAppStore((s) => s.referrals);
  const quests = useAppStore((s) => s.quests);
  const pointsLog = useAppStore((s) => s.pointsLog);
  const claimDailyReward = useAppStore((s) => s.claimDaily);
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);

  const [now, setNow] = useState(() => Date.now());

  /* Keep the claim button's countdown live across midnight / tab refocus. */
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);

  const refCode = useMemo(() => ensureRefCode(user?.id), [ensureRefCode, user?.id]);
  useEffect(() => { if (!refCode) return; void bindRewardCode({ code: refCode }); }, [refCode]);
  const inviteUrl = siteInviteUrl(refCode);

  const tier = tierFor(points);
  const perks = useMemo(() => perksFor(points), [points]);

  const daily = useMemo(
    () => dailyRewardStatus({ now, lastClaim, streak }),
    [now, lastClaim, streak]
  );
  const { canClaim, hoursLeft, reward: claimValue, activeStreak } = daily;

  const history = useMemo(
    () => [...(pointsLog ?? [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 12),
    [pointsLog]
  );

  const claimDaily = () => {
    if (!canClaim) return;
    const reward = claimDailyReward(Date.now());
    if (reward !== false) { setNow(Date.now()); haptic?.('success'); }
  };

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const shareInvite = async () => {
    const result = await share({ url: inviteUrl, text: t('earn.shareText') });
    if (!result?.ok) return;
    const state = useAppStore.getState();
    state.awardPoints('shareApp', POINT_VALUES.shareApp, { via: result.via });
    state.notify('pointsEarned', 'success');
    haptic?.('success');
  };

  const copyInvite = async () => {
    const ok = await copyText(inviteUrl);
    useAppStore.getState().notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
    haptic?.(ok ? 'success' : 'error');
  };
  const copyCode = async (code) => {
    const ok = await copyText(code);
    useAppStore.getState().notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
  };

  return (
    <div className="rwd-panel rwd-fade">
      {/* ----------------------------- daily ----------------------------- */}
      <section className="rwd-card rwd-daily">
        <div className="rwd-ring-wrap" style={{ width: 96, height: 96 }}>
          <svg viewBox="0 0 132 132" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
            <circle cx="66" cy="66" r="54" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="9" />
            <motion.circle
              cx="66" cy="66" r="54" fill="none" stroke="var(--rgb-4)" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 54}
              initial={{ strokeDashoffset: 2 * Math.PI * 54 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 54 * (1 - Math.min(1, activeStreak / 7)) }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              style={{ filter: 'drop-shadow(0 0 6px rgba(0,255,157,.5))' }}
            />
          </svg>
          <div className="rwd-ring-core">
            <div style={{ fontSize: 26 }}>🔥</div>
            <div className="rwd-ring-label" style={{ marginTop: 0 }}>{activeStreak}</div>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{t('earn.dailyReward')}</div>
          <div className="rwd-prose" style={{ marginTop: 2 }}>{t('earn.streakDays', { n: activeStreak })}</div>

          <div className="rwd-week">
            {Array.from({ length: 7 }).map((_, i) => {
              const done = i < Math.min(activeStreak, 7);
              return <div key={i} className={done ? 'rwd-day done' : 'rwd-day'}>{done ? '✓' : i + 1}</div>;
            })}
          </div>

          <button className="btn btn-primary" style={{ width: '100%' }} disabled={!canClaim} onClick={claimDaily}>
            {canClaim ? t('earn.claimNow') : t('earn.comeBackIn', { h: hoursLeft })}
            {canClaim && <span className="rwd-pill up" style={{ marginInlineStart: 6, background: 'rgba(0,0,0,.18)', color: '#001014', border: 0 }}>+{claimValue}</span>}
          </button>
        </div>
      </section>

      {/* ---------------------------- missions --------------------------- */}
      <div className="rwd-section-head">
        <h2><IconSparkle width={16} height={16} style={{ color: 'var(--rgb-1)' }} /> {t('earn.quests')}</h2>
      </div>
      <motion.div className="rwd-list" variants={stagger} initial="hidden" animate="show">
        {QUESTS.map((q) => {
          const done = quests?.[q.id]?.done;
          return (
            <motion.div
              key={q.id}
              className={`rwd-quest${done ? ' done' : ''}`}
              variants={riseIn}
              onClick={() => {
                if (done) return;
                if (q.id === 'inviteFriend') void shareInvite();
                else if (q.to) navigate(q.to);
              }}
            >
              <div className="rwd-quest-ico" style={{ color: q.tone, borderColor: done ? undefined : q.tone, background: done ? undefined : `color-mix(in srgb, ${q.tone} 12%, transparent)` }}>
                {done ? <IconCheck width={17} height={17} /> : <q.Icon width={17} height={17} />}
              </div>
              <div className="rwd-quest-meta">
                <div className="rwd-quest-title">{t(`earn.quest.${q.id}`)}</div>
                <div className="rwd-quest-pts">+{q.pts} {t('rank.pts')}</div>
              </div>
              <span className={`rwd-pill ${done ? 'up' : ''}`} style={done ? { background: 'rgba(0,255,157,.14)', color: 'var(--up)', borderColor: 'transparent' } : {}}>
                {done ? '✓' : '›'}
              </span>
            </motion.div>
          );
        })}
      </motion.div>

      {/* ----------------------------- perks ----------------------------- */}
      <div className="rwd-section-head">
        <h2>{t('perks.title')}</h2>
      </div>
      <p className="rwd-prose" style={{ margin: '0 2px' }}>{t('perks.intro')}</p>
      <motion.div className="rwd-perks" variants={stagger} initial="hidden" animate="show">
        {perks.map((pk) => (
          <motion.div
            key={pk.id}
            className={`rwd-perk${pk.available ? ' unlocked' : ''}`}
            variants={riseIn}
            style={{ '--pk': pk.tierColor }}
          >
            <div className="rwd-perk-medal">{pk.tierIcon}</div>
            <div className="rwd-perk-title">{t(`perks.item.${pk.id}.title`)}</div>
            <div className="rwd-perk-desc">{t(`perks.item.${pk.id}.desc`)}</div>

            {pk.available ? (
              <div className="rwd-refer-actions" style={{ marginTop: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={async () => copyCode(pk.code)}>
                  <IconCopy width={13} height={13} /> {t('perks.copyCode', { code: pk.code })}
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => open(pk.link)}>
                  {t('perks.use')}
                </button>
              </div>
            ) : !pk.unlocked ? (
              <p className="rwd-perk-lock">
                {t('perks.locked', { n: fmtNum(pk.pointsToGo, 0), tier: t(`rank.tier.${pk.tier}`) })}
              </p>
            ) : (
              <p className="rwd-perk-lock">{t('perks.notReady')}</p>
            )}
          </motion.div>
        ))}
      </motion.div>
      <InfoBox title={t('perks.howTitle')} tone="info" id="rwd-perks-how">
        <p className="rwd-prose">{t('perks.howBody')}</p>
      </InfoBox>

      {/* ---------------------------- referral --------------------------- */}
      <section className="rwd-card" style={{ padding: 16 }}>
        <div className="rwd-section-head" style={{ margin: 0 }}>
          <h2><IconUser width={16} height={16} style={{ color: 'var(--rgb-3)' }} /> {t('rewards.referralTitle')}</h2>
          <span className="rwd-pill up">+{fmtNum(POINT_VALUES.referral, 0)}</span>
        </div>
        <p className="rwd-prose" style={{ margin: '6px 0 0' }}>{t('rewards.referralHow')}</p>

        <div className="rwd-refer-code">
          <span className="mono" dir="ltr">{inviteUrl}</span>
          <span className="rwd-pill">{fmtNum(referrals ?? 0, 0)}</span>
        </div>

        <div className="rwd-refer-actions">
          <button className="btn btn-primary" onClick={() => void shareInvite()}>
            <IconLink width={14} height={14} /> {t('earn.shareInvite')}
          </button>
          <button className="btn btn-ghost btn-row-minor" onClick={() => void copyInvite()}>
            <IconCopy width={14} height={14} /> {t('common.copy')}
          </button>
        </div>
      </section>

      {/* ---------------------------- history ---------------------------- */}
      <div className="rwd-section-head">
        <h2>{t('rank.historyTitle')}</h2>
      </div>
      {history.length === 0 ? (
        <p className="rwd-empty">{t('rank.noneYet')}</p>
      ) : (
        <div className="rwd-card" style={{ padding: '6px 14px' }}>
          <div className="rwd-timeline">
            {history.map((e) => (
              <div key={`${e.id || e.action}-${e.at}`} className="rwd-entry">
                <span className="rwd-entry-dot" />
                <div className="rwd-entry-meta">
                  <div className="rwd-entry-title">{labelFor(t, e.action)}</div>
                  <div className="rwd-entry-time">{fmtDateTime(e.at)}</div>
                </div>
                <div className="rwd-entry-pts">+{fmtNum(e.amount ?? e.pts ?? 0, 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ShareSheet {...shareSheet} />
    </div>
  );
}
