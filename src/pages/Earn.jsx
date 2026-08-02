import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AnimatedNumber from '../components/AnimatedNumber';
import AdBanner from '../components/AdBanner';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { POINT_VALUES, tierFor, nextTier, tierProgress } from '../lib/ranks';
import { IconChevronRight, IconExternal, IconPools, IconShield, IconSwap, IconTrend } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import { publicAppUrl } from '../lib/nativeShell';

/**
 * Earn.
 *
 * Split deliberately into two halves that are never blended:
 *
 *   REAL YIELD — actual on-chain opportunities where the user's own money
 *   earns a return. Every one routes to an audited protocol from the user's
 *   own wallet; we take nothing beyond the swap fee they'd pay anyway.
 *
 *   POINTS — a reputation score for using the app. Points buy nothing and
 *   transfer to nobody. They used to be "virtual credits", which looked like a
 *   balance and implied withdrawable value; that was misleading in an app
 *   where other screens move real funds.
 */

/** Real, on-chain ways to earn. Ordered roughly by risk. */
const YIELD = [
  {
    id: 'stablePool',
    Icon: IconPools,
    apr: '4–9%',
    risk: 'low',
    color: 'var(--rgb-4)',
    url: 'https://pancakeswap.finance/liquidity/pools',
    internal: '/farm'
  },
  {
    id: 'cakeStake',
    Icon: IconTrend,
    apr: '2–8%',
    risk: 'low',
    color: 'var(--rgb-5)',
    url: 'https://pancakeswap.finance/pools'
  },
  {
    id: 'lpFarm',
    Icon: IconPools,
    apr: '10–40%',
    risk: 'medium',
    color: 'var(--rgb-1)',
    url: 'https://pancakeswap.finance/farms',
    internal: '/farm'
  },
  {
    id: 'lending',
    Icon: IconShield,
    apr: '3–12%',
    risk: 'medium',
    color: 'var(--rgb-2)',
    url: 'https://app.venus.io'
  },
  {
    id: 'liquidStake',
    Icon: IconSwap,
    apr: '3–6%',
    risk: 'medium',
    color: 'var(--rgb-8)',
    url: 'https://lido.fi'
  }
];

export default function Earn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, share, user, tg } = useTelegram();

  const points = useAppStore((s) => s.points);
  const streak = useAppStore((s) => s.streak);
  const lastClaim = useAppStore((s) => s.lastClaim);
  const referrals = useAppStore((s) => s.referrals);
  const quests = useAppStore((s) => s.quests);
  const awardPoints = useAppStore((s) => s.awardPoints);
  const completeQuest = useAppStore((s) => s.completeQuest);
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);
  const username = useSettingsStore((s) => s.username);

  const [tab, setTab] = useState('real');

  const refCode = useMemo(() => ensureRefCode(user?.id), [ensureRefCode, user?.id]);
  /*
   * REAL BUG: this was `https://t.me/your_bot_username?start=...` — a literal
   * placeholder. Every invite anyone shared pointed at a Telegram bot that has
   * never existed, so the referral feature could not have worked once, and the
   * friend received a dead link with our name on it.
   *
   * It now points at the site, which is where the app actually lives.
   * `publicAppUrl` resolves the configured origin rather than
   * window.location, because inside the APK that is https://localhost and the
   * invite would send people to their own phone.
   */
  const inviteUrl = `${publicAppUrl('/')}?ref=${encodeURIComponent(refCode)}`;

  const tier = tierFor(points);
  const next = nextTier(points);
  const progress = tierProgress(points);

  const canClaim = Date.now() - lastClaim >= 20 * 3600000;
  const hoursLeft = Math.max(0, Math.ceil((lastClaim + 20 * 3600000 - Date.now()) / 3600000));
  const claimValue = POINT_VALUES.dailyCheckin + Math.min(streak, 7) * POINT_VALUES.streakBonus;

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const claimDaily = () => {
    if (!canClaim) return;
    const continuing = Date.now() - lastClaim < 48 * 3600000;
    const nextStreak = continuing ? streak + 1 : 1;
    useAppStore.setState({ lastClaim: Date.now(), streak: nextStreak });
    awardPoints('dailyCheckin', POINT_VALUES.dailyCheckin + Math.min(nextStreak, 7) * POINT_VALUES.streakBonus);
    haptic?.('success');
    useAppStore.getState().notify('pointsEarned', 'success');
  };

  const QUESTS = [
    { id: 'connectWallet', to: '/wallet', pts: POINT_VALUES.connectWallet },
    { id: 'firstSwap', to: '/swap', pts: POINT_VALUES.firstSwap },
    { id: 'addLiquidity', to: '/farm', pts: POINT_VALUES.addLiquidity },
    { id: 'backupWallet', to: '/wallet', pts: POINT_VALUES.backupWallet },
    { id: 'enable2fa', to: '/settings', pts: POINT_VALUES.enable2fa },
    { id: 'inviteFriend', to: null, pts: POINT_VALUES.referral }
  ];

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('earn.title')}</h1>
        <p className="muted">{t('earn.subtitle')}</p>
      </motion.div>

      <div className="segmented">
        {['real', 'points'].map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ isolation: 'isolate' }}>
            {tab === k && <SegIndicator id="earntab" />}
            {t(`earn.tab.${k}`)}
          </button>
        ))}
      </div>

      {/* ============================ REAL YIELD ============================ */}
      {tab === 'real' ? (
        <>
          <motion.section className="card card-rgb edge-mint" variants={riseIn} initial="hidden" animate="show">
            <div className="aurora" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{t('earn.realTitle')}</div>
            <p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('earn.realBody')}</p>
          </motion.section>

          <section>
            <p className="section-label">{t('earn.opportunities')}</p>
            <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
              {YIELD.map((y) => (
                <motion.button
                  key={y.id}
                  className="card lift"
                  variants={riseIn}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => (y.internal ? navigate(y.internal) : open(y.url))}
                  style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
                >
                  <div className="row-between">
                    <div className="row" style={{ gap: 11, minWidth: 0 }}>
                      <motion.span
                        className="wallet-badge"
                        style={{ color: y.color, width: 38, height: 38 }}
                        animate={{ rotate: [0, 6, -6, 0] }}
                        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <y.Icon width={19} height={19} />
                      </motion.span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.3 }}>{t(`earn.yield.${y.id}.title`)}</div>
                        <div className="set-row-sub">{t(`earn.yield.${y.id}.body`)}</div>
                      </div>
                    </div>
                    {y.internal ? (
                      <IconChevronRight width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                    ) : (
                      <IconExternal width={15} height={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                    )}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 9 }}>
                    <span className="pill pill-up">APR {y.apr}</span>
                    <span className={`pill ${y.risk === 'low' ? 'pill-neutral' : 'pill-rgb'}`}>
                      {t(`invest.risk.${y.risk}`)}
                    </span>
                  </div>
                </motion.button>
              ))}
            </motion.div>
            <p className="faint" style={{ marginTop: 10, lineHeight: 1.7 }}>{t('earn.aprNote')}</p>
          </section>

          <AdBanner slot="farm" />

          <p className="notice notice-danger">{t('earn.realRisk')}</p>
        </>
      ) : (
        /* ============================== POINTS ============================== */
        <>
          <motion.section
            className="card card-rgb"
            variants={riseIn}
            initial="hidden"
            animate="show"
            style={{ borderColor: `${tier.color}55`, cursor: 'pointer' }}
            onClick={() => navigate('/leaderboard')}
          >
            <div className="aurora" />
            <div className="row-between">
              <div className="row" style={{ gap: 12 }}>
                <motion.div
                  animate={{ scale: [1, 1.1, 1], rotate: [0, 5, 0] }}
                  transition={{ duration: 3.5, repeat: Infinity }}
                  style={{
                    width: 50, height: 50, borderRadius: 16, display: 'grid', placeItems: 'center',
                    fontSize: 24,
                    background: `radial-gradient(circle at 30% 30%, ${tier.color}44, transparent 70%)`,
                    border: `1px solid ${tier.color}66`
                  }}
                >
                  {tier.icon}
                </motion.div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: tier.color }}>
                    {t(`rank.tier.${tier.id}`)}
                  </div>
                  <div className="faint">{t('rank.viewBoard')}</div>
                </div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div className="stat-mini">
                  <AnimatedNumber value={points} format={(v) => fmtNum(v, 0)} />
                </div>
                <div className="faint">{t('rank.points')}</div>
              </div>
            </div>

            {next && (
              <div className="progress" style={{ marginTop: 12 }}>
                <motion.div
                  className="progress-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress * 100}%` }}
                  transition={{ duration: 0.9 }}
                  style={{ background: `linear-gradient(90deg, ${tier.color}, ${next.color})` }}
                />
              </div>
            )}
          </motion.section>

          {/* daily check-in */}
          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{t('earn.dailyReward')}</div>
                <div className="faint">{t('earn.streakDays', { n: streak })}</div>
              </div>
              <span className="pill pill-rgb">+{claimValue} {t('rank.pts')}</span>
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
                      flex: 1, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center',
                      fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      background: done ? 'linear-gradient(135deg,var(--rgb-1),var(--rgb-2))' : 'rgba(127,127,127,.1)',
                      color: done ? '#000' : 'var(--text-3)',
                      border: '1px solid var(--line)'
                    }}
                  >
                    {done ? '✓' : i + 1}
                  </motion.div>
                );
              })}
            </div>

            <button className="btn btn-primary" disabled={!canClaim} onClick={claimDaily}>
              {canClaim ? t('earn.claimNow') : t('earn.comeBackIn', { h: hoursLeft })}
            </button>
          </motion.section>

          {/* referral */}
          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{t('earn.referral')}</div>
                <div className="faint">{t('earn.referralDesc')}</div>
              </div>
              <span className="pill pill-up">+{POINT_VALUES.referral}</span>
            </div>

            <div
              className="row-between"
              style={{ background: 'rgba(127,127,127,.08)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px' }}
            >
              <span className="mono" style={{ fontSize: 12, color: 'var(--rgb-1)' }}>{refCode}</span>
              <span className="pill pill-neutral">{referrals}</span>
            </div>

            <button
              className="btn btn-ghost"
              style={{ marginTop: 10 }}
              onClick={() => {
                share?.(inviteUrl, t('earn.shareText'));
                awardPoints('shareApp', POINT_VALUES.shareApp);
              }}
            >
              {t('earn.shareInvite')}
            </button>
          </motion.section>

          <AdBanner slot="referral" compact />

          {/* quests */}
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
                    style={{ opacity: done ? 0.55 : 1 }}
                    onClick={() => {
                      if (done) return;
                      if (q.id === 'inviteFriend') {
                        share?.(inviteUrl, t('earn.shareText'));
                        completeQuest(q.id);
                        awardPoints('referral', q.pts);
                      } else if (q.to) {
                        navigate(q.to);
                      }
                    }}
                  >
                    <div className="coin-logo" style={{ fontSize: 15 }}>{done ? '✓' : '◆'}</div>
                    <div className="coin-meta">
                      <div className="coin-sym" style={{ textTransform: 'none', fontSize: 12.5 }}>
                        {t(`earn.quest.${q.id}`)}
                      </div>
                      <div className="coin-name">+{q.pts} {t('rank.pts')}</div>
                    </div>
                    <span className={`pill ${done ? 'pill-up' : 'pill-neutral'}`}>{done ? '✓' : '›'}</span>
                  </motion.div>
                );
              })}
            </motion.div>
          </section>

          <p className="notice">{t('earn.pointsNotice')}</p>
        </>
      )}
    </PageTransition>
  );
}
