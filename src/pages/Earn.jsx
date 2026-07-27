import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AnimatedNumber from '../components/AnimatedNumber';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';

const QUESTS = [
  { id: 'firstTrade', emoji: '⚡', reward: 150, to: '/trade' },
  { id: 'firstStake', emoji: '🏦', reward: 200, to: '/invest' },
  { id: 'firstGame', emoji: '🎮', reward: 100, to: '/play' },
  { id: 'firstPredict', emoji: '📈', reward: 120, to: '/predict' },
  { id: 'addFavorite', emoji: '⭐', reward: 60, to: '/' },
  { id: 'inviteFriend', emoji: '👥', reward: 300, to: null }
];


export default function Earn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, share, user } = useTelegram();

  const balance = useAppStore((s) => s.balance);
  const streak = useAppStore((s) => s.streak);
  const lastClaim = useAppStore((s) => s.lastClaim);
  const level = useAppStore((s) => s.level);
  const xp = useAppStore((s) => s.xp);
  const quests = useAppStore((s) => s.quests);
  const referrals = useAppStore((s) => s.referrals);
  const claimDaily = useAppStore((s) => s.claimDaily);
  const completeQuest = useAppStore((s) => s.completeQuest);
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);

  const refCode = useMemo(() => ensureRefCode(user?.id), [ensureRefCode, user?.id]);
  const xpNeeded = 250 * level;
  const xpPct = Math.min(100, (xp / xpNeeded) * 100);

  const canClaim = Date.now() - lastClaim >= 20 * 3600000;
  const nextReward = 50 + Math.min((canClaim ? streak + 1 : streak) || 1, 7) * 25;
  const hoursLeft = Math.max(0, Math.ceil((lastClaim + 20 * 3600000 - Date.now()) / 3600000));

  const inviteUrl = `https://t.me/your_bot_username?start=${refCode}`;

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('earn.title')}</h1>
        <p className="muted">{t('earn.subtitle')}</p>
      </motion.div>

      {/* ---------- level ---------- */}
      <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row-between">
          <div>
            <div className="faint">{t('earn.level')}</div>
            <div className="stat-value gradient-text">{level}</div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="faint">{t('common.balance')}</div>
            <div className="stat-mini">
              <AnimatedNumber value={balance} format={(v) => `${fmtNum(v, 2)} NX`} />
            </div>
          </div>
        </div>
        <div className="progress" style={{ marginTop: 12 }}>
          <motion.div className="progress-fill" initial={{ width: 0 }} animate={{ width: `${xpPct}%` }} transition={{ duration: 0.9 }} />
        </div>
        <div className="row-between" style={{ marginTop: 5 }}>
          <span className="faint mono">{xp} XP</span>
          <span className="faint mono">{xpNeeded} XP</span>
        </div>
      </motion.section>

      {/* ---------- daily ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>🎁 {t('earn.dailyReward')}</div>
            <div className="faint">{t('earn.streakDays', { n: streak })}</div>
          </div>
          <span className="pill pill-rgb">+{nextReward} NX</span>
        </div>

        <div className="row" style={{ gap: 5, marginBottom: 12 }}>
          {Array.from({ length: 7 }).map((_, i) => {
            const done = i < Math.min(streak, 7);
            return (
              <motion.div
                key={i}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.05 }}
                style={{
                  flex: 1,
                  height: 34,
                  borderRadius: 9,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  background: done ? 'linear-gradient(135deg,var(--rgb-1),var(--rgb-2))' : 'rgba(255,255,255,.05)',
                  color: done ? '#000' : 'var(--text-3)',
                  border: '1px solid var(--line)',
                  fontWeight: 700
                }}
              >
                {done ? '✓' : i + 1}
              </motion.div>
            );
          })}
        </div>

        <button
          className="btn btn-primary"
          disabled={!canClaim}
          onClick={() => {
            haptic?.('success');
            claimDaily();
          }}
        >
          {canClaim ? t('earn.claimNow') : t('earn.comeBackIn', { h: hoursLeft })}
        </button>
      </motion.section>

      {/* ---------- referral ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>👥 {t('earn.referral')}</div>
            <div className="faint">{t('earn.referralDesc')}</div>
          </div>
          <span className="pill pill-neutral mono">{referrals}</span>
        </div>

        <div
          className="row-between"
          style={{ background: 'rgba(255,255,255,.05)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px' }}
        >
          <span className="mono" style={{ fontSize: 12, color: 'var(--rgb-1)' }}>{refCode}</span>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              navigator.clipboard?.writeText(inviteUrl);
              haptic?.('success');
              useAppStore.getState().notify('linkCopied', 'success');
            }}
          >
            {t('common.copy')}
          </button>
        </div>

        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => share?.(inviteUrl, t('earn.shareText'))}>
          {t('earn.shareInvite')}
        </button>
        <p className="faint" style={{ marginTop: 8 }}>{t('earn.referralNote')}</p>
      </motion.section>

      {/* ---------- quests ---------- */}
      <section>
        <p className="section-label">{t('earn.quests')}</p>
        <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {QUESTS.map((q) => {
            const done = quests[q.id]?.done;
            return (
              <motion.div
                key={q.id}
                className="coin-row"
                variants={riseIn}
                onClick={() => {
                  if (done) return;
                  if (q.id === 'inviteFriend') {
                    share?.(inviteUrl, t('earn.shareText'));
                    completeQuest(q.id, q.reward);
                  } else if (q.to) {
                    navigate(q.to);
                  }
                }}
                style={{ opacity: done ? 0.55 : 1 }}
              >
                <div className="coin-logo" style={{ fontSize: 16 }}>{q.emoji}</div>
                <div className="coin-meta">
                  <div className="coin-sym" style={{ textTransform: 'none' }}>{t(`earn.quest.${q.id}`)}</div>
                  <div className="coin-name">+{q.reward} NX</div>
                </div>
                <span className={`pill ${done ? 'pill-up' : 'pill-neutral'}`}>{done ? '✓' : '›'}</span>
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      <p className="notice">{t('earn.virtualNotice')}</p>
    </PageTransition>
  );
}
