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
import ShareSheet from '../components/ShareSheet';
import VaultCard from '../components/VaultCard';
import InfoBox from '../components/InfoBox';
import { useShare } from '../hooks/useShare';
import { copyText } from '../lib/share';
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
  },

  /*
   * ═════════════════════════════════════════════════════════════════════════
   * ADDED AFTER A DEEP SEARCH FOR REAL, USABLE YIELD.
   * ═════════════════════════════════════════════════════════════════════════
   * The owner asked for more genuine ways to earn here. These four were the
   * survivors of a much longer list, and what got the others cut matters as
   * much as what got these in:
   *
   *   REJECTED — anything requiring an account. Nexo, YouHodler, CoinRabbit
   *   and every other CeFi yield desk was excluded, not on quality grounds
   *   but because they exclude us: CoinRabbit's terms name the "Islamic
   *   Republic of Iran" in their restricted list verbatim, alongside the US,
   *   UK, Canada and Hong Kong. Listing a platform that will refuse most of
   *   our readers is the dead-button problem again.
   *
   *   REJECTED — anything paying in a protocol's own inflationary token and
   *   quoting that emission as "APR". A 300% APR paid in a token with no
   *   buyers is not 300%, and printing the number would make everything else
   *   on this screen less believable.
   *
   *   KEPT — permissionless, non-custodial, no account, real revenue
   *   underneath. Each one below is a protocol the user interacts with from
   *   their own wallet, exactly like the five above.
   */
  {
    /*
     * Aave. The largest lending market in DeFi and the obvious omission from
     * the original list, which pointed only at Venus on BNB Chain.
     *
     * `risk: medium` and not `low` despite the size: supply yield is real
     * revenue from borrower interest, but a lending pool can take bad debt in
     * a fast liquidation cascade, and that has happened to major protocols
     * more than once.
     */
    id: 'aaveSupply',
    Icon: IconShield,
    apr: '3–8%',
    risk: 'medium',
    color: 'var(--rgb-3)',
    url: 'https://app.aave.com'
  },
  {
    /*
     * Morpho. Included because it is structurally different rather than as a
     * second name on the same list: markets are isolated, so a bad asset
     * cannot contaminate the pool your money is in. That is a genuinely
     * different risk shape, and the reason a user might choose it over Aave.
     */
    id: 'morphoLend',
    Icon: IconShield,
    apr: '4–9%',
    risk: 'medium',
    color: 'var(--rgb-1)',
    url: 'https://app.morpho.org'
  },
  {
    /*
     * Solana liquid staking. The app already has a whole Solana screen and
     * lists SOL everywhere, but every yield route here was EVM-only — a
     * Solana holder had nothing to do.
     *
     * Jito rather than a wrapper: it is the largest by a distance and the
     * stake is redeemable for SOL directly, so there is no third-party
     * redemption queue between the user and their asset.
     */
    id: 'solStake',
    Icon: IconTrend,
    apr: '6–8%',
    risk: 'low',
    color: 'var(--rgb-2)',
    url: 'https://www.jito.network/staking/'
  },
  {
    /*
     * Native-BTC yield, which is the one thing none of the routes above can
     * offer. THORChain's savers take real Bitcoin — not a wrapped IOU — and
     * pay from swap fees.
     *
     * `risk: high`, stated plainly and higher than anything else on this
     * screen. Savers carry impermanent loss against the pool, the protocol
     * has paused savers before, and yield depends entirely on swap volume
     * that can fall to nothing. It is listed because native BTC yield with
     * no custodian genuinely has no substitute, not because it is safe.
     */
    id: 'thorSavers',
    Icon: IconPools,
    apr: '2–7%',
    risk: 'high',
    color: 'var(--rgb-5)',
    url: 'https://app.thorswap.finance/earn'
  }
];

export default function Earn({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, user, tg } = useTelegram();

  /*
   * REAL BUG: this screen used `share` from TelegramContext, which built a
   * t.me/share/url link and nothing else. On a phone without Telegram — and
   * on most Iranian networks, where t.me does not resolve at all — the button
   * opened a tab that never loaded. Sharing is the only free growth channel
   * we have, so a share button that silently fails is the most expensive bug
   * in the app.
   *
   * useShare goes through the OS share sheet first (Capacitor in the APK,
   * navigator.share in Safari iOS / Chrome Android) and only falls back to our
   * own list of destinations when there is genuinely nothing native.
   */
  const [share, shareSheet] = useShare();

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
    <PageTransition embedded={embedded}>
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
            <p className="prose-sm">{t('earn.realBody')}</p>
          </motion.section>

          {/*
            ─── OUR OWN VAULT, WHEN IT EXISTS ───────────────────────────────
            Renders NOTHING until a real vault address and chain are
            configured — see lib/vault.js. Shipping the surface before the
            product exists is the "wired to nothing" failure this repo has
            already had three times (bridge, gasless, fiat), and a card
            advertising a vault nobody can deposit into is worse than no card.

            Placed above the other routes because it is the only entry on this
            screen that is ours. Every row below sends the user to somebody
            else's protocol and earns us nothing, and the user is entitled to
            know which is which.
          */}
          <VaultCard />

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
          </section>

          <AdBanner slot="farm" />

          {/*
            Reported: «در صفحه سود واقعی پایین صفحه هشدار هست».

            Kept as `danger` tone but folded: this list now carries a HIGH-risk
            entry (THORChain savers), so the warning still has to be prominent
            — but a red wall at the foot of a list of opportunities was being
            scrolled past, which is the opposite of prominent.

            The title alone carries the point, and the detail opens for anyone
            about to act on it.
          */}
          <InfoBox title={t('earn.riskTitle')} tone="danger" id="earn-risk">
            <p>{t('earn.realRisk')}</p>
            <p>{t('earn.aprNote')}</p>
          </InfoBox>
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

            {/*
              `.btn-row`, not `.row` + `flex: 1`.

              `.btn` carries `width: 100%`, which becomes the flex-basis of any
              child that does not override it. So Copy (no flex declaration)
              had a basis of the whole row while Share had a basis of 0 — the
              bases overflowed, free space went negative, and `flex-grow` had
              nothing to hand out. The button asking to expand was the one that
              collapsed. See the .btn-row block in index.css.
            */}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  share({ url: inviteUrl, text: t('earn.shareText') });
                  awardPoints('shareApp', POINT_VALUES.shareApp);
                }}
              >
                {t('earn.shareInvite')}
              </button>
              {/*
                Copy sits beside share, not behind it. The share sheet can be
                refused by the browser or dismissed by accident; the clipboard
                never fails, and half the people who send an invite are pasting
                it into a group they already have open.
              */}
              <button
                className="btn btn-ghost btn-row-minor"
                onClick={async () => {
                  const ok = await copyText(inviteUrl);
                  useAppStore.getState().notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
                }}
              >
                {t('common.copy')}
              </button>
            </div>
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
                        share({ url: inviteUrl, text: t('earn.shareText') });
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

      {/* Only ever visible when the OS refused to handle the share itself. */}
      <ShareSheet {...shareSheet} />
    </PageTransition>
  );
}
