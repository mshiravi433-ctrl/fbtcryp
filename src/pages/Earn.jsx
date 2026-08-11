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
import { IconCheck, IconChevronRight, IconExternal, IconKey, IconPools, IconShield, IconSwap, IconTrend, IconUser, IconWallet } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import ShareSheet from '../components/ShareSheet';
import VaultCard from '../components/VaultCard';
import InfoBox from '../components/InfoBox';
import { perksFor } from '../lib/perks';
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
    /*
     * ─── ROUTED INWARDS, BECAUSE WE ACTUALLY DO THIS ONE ────────────────────
     * Asked to prefer our own screens over external links here.
     *
     * This row pointed at lido.fi, which was a real mistake rather than a
     * missed optimisation: the Farm screen already sells stETH and rETH
     * directly, and for a liquid staking token BUYING IT IS THE DEPOSIT —
     * there is no separate stake step, no lock-up, and it grows against ETH by
     * itself. So the user got sent to another site to accomplish something
     * this app performs in one swap, and we earned nothing for finding it for
     * them.
     *
     * `internal` makes the card navigate rather than open a browser, and the
     * 0.70% swap fee applies exactly as it does anywhere else.
     */
    id: 'liquidStake',
    Icon: IconSwap,
    apr: '3–6%',
    risk: 'medium',
    color: 'var(--rgb-8)',
    url: 'https://lido.fi',
    internal: '/farm'
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
  /* Recomputed only when the score changes — the venue codes are build-time
     constants, so nothing else can alter the result. */
  const perks = useMemo(() => perksFor(points), [points]);

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

  /*
   * ─── EVERY QUEST GETS ITS OWN ICON AND ITS OWN COLOUR ────────────────────
   *   «در صفحه فارم پایین صفحه دعوت دوستان بدون رنگ و ایکون هست»
   *
   * Reported against the Farm screen because that is where this list is
   * reached from, but the list lives here — Earn renders it, embedded.
   *
   * Every row drew the same grey `◆` glyph. Six identical diamonds in a
   * column is not a list of six things, it is one thing repeated: the eye
   * has nothing to anchor on, so "invite a friend" was indistinguishable
   * from "enable 2FA" without reading both labels.
   *
   * That matters more for THIS row than for the others, because inviting a
   * friend is the only quest that brings us a new user. It should be the
   * most findable item on the screen and it was the least.
   *
   * The colours are the app's own RGB tokens, so they follow the theme
   * rather than being a second palette that drifts out of sync — the same
   * rule the audio player follows.
   */
  const QUESTS = [
    { id: 'connectWallet', to: '/wallet', pts: POINT_VALUES.connectWallet, Icon: IconWallet, tone: 'var(--rgb-1)' },
    { id: 'firstSwap', to: '/swap', pts: POINT_VALUES.firstSwap, Icon: IconSwap, tone: 'var(--rgb-2)' },
    /*
     * ─── REMOVED, BECAUSE WE CANNOT SEE IT HAPPEN ───────────────────────────
     * "Add liquidity to a pool, +150" was advertised and could never complete.
     * Unlike the other five, that is not a wiring bug we can fix: the Farm
     * screen LINKS OUT to PancakeSwap and Venus, so the deposit happens on
     * somebody else's site and we have no way to know whether it occurred.
     *
     * The three options were to pay on the tap (rewarding a click, which any
     * user could farm), to leave it advertised and unearnable (the bug being
     * fixed here), or to remove it. Removed. Liquid staking still earns
     * through `firstSwap`, because on our Farm screen buying stETH or rETH IS
     * the deposit and it routes through our own swap.
     */
    { id: 'backupWallet', to: '/wallet', pts: POINT_VALUES.backupWallet, Icon: IconKey, tone: 'var(--rgb-5)' },
    { id: 'enable2fa', to: '/settings', pts: POINT_VALUES.enable2fa, Icon: IconShield, tone: 'var(--rgb-1)' },
    /*
     * Magenta, and it is the only magenta on the screen. The share button
     * above uses the primary style; this row is the same action reached a
     * different way, and it is the one that grows the app.
     */
    { id: 'inviteFriend', to: null, pts: POINT_VALUES.referral, Icon: IconUser, tone: 'var(--rgb-3)' }
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
          <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ background: 'linear-gradient(145deg, color-mix(in srgb, var(--rgb-4) 6%, var(--bg-raised)), var(--bg-raised))', borderColor: 'color-mix(in srgb, var(--rgb-4) 14%, var(--line))', borderRadius: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--rgb-4), #00e5ff)', color: '#fff' }}>◈</span>
              {t('earn.realTitle')}
            </div>
            <p className="prose-sm" style={{ lineHeight: 1.85 }}>{t('earn.realBody')}</p>
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
                  className="card"
                  variants={riseIn}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => (y.internal ? navigate(y.internal) : open(y.url))}
                  style={{ textAlign: 'start', cursor: 'pointer', width: '100%', padding: 16, borderRadius: 16, background: `linear-gradient(145deg, color-mix(in srgb, \${y.color} 6%, var(--bg-raised)), var(--bg-raised))`, borderColor: `color-mix(in srgb, \${y.color} 12%, var(--line))`, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                >
                  <div className="row-between">
                    <div className="row" style={{ gap: 13, minWidth: 0 }}>
                      <span
                        style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, \${y.color} 14%, transparent)`, border: `1px solid \${y.color}22`, color: y.color }}
                      >
                        <y.Icon width={20} height={20} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{t(`earn.yield.${y.id}.title`)}</div>
                        <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 2 }}>{t(`earn.yield.${y.id}.body`)}</div>
                      </div>
                    </div>
                    <span className="docs-chevron" style={{ flexShrink: 0 }}>
                      {y.internal ? (
                        <IconChevronRight width={16} height={16} />
                      ) : (
                        <IconExternal width={14} height={14} />
                      )}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 7, marginTop: 12, flexWrap: 'wrap' }}>
                    <span className="pill pill-up" style={{ fontSize: 11, padding: '4px 8px' }}>APR {y.apr}</span>
                    <span className={`pill ${y.risk === 'low' ? 'pill-neutral' : 'pill-rgb'}`} style={{ fontSize: 11 }}>
                      {t(`invest.risk.${y.risk}`)}
                    </span>
                    {/*
                      Says plainly which rows stay in the app.

                      The chevron-versus-external-icon already encoded this,
                      but only to somebody who knows the convention. Asked to
                      favour our own screens here, and a route the user cannot
                      TELL is ours is not favoured in any way that matters —
                      they still tap it expecting to leave.
                    */}
                    {y.internal && <span className="pill pill-neutral">{t('earn.inApp')}</span>}
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
            className="card"
            variants={riseIn}
            initial="hidden"
            animate="show"
            style={{ borderColor: `${tier.color}22`, cursor: 'pointer', background: `linear-gradient(145deg, \${tier.color}0a, var(--bg-raised))`, borderRadius: 16 }}
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

          {/*
            ─── WHAT THE POINTS ARE FOR ──────────────────────────────────────
            Asked whether each rank could unlock redeemable services, and
            whether that could earn revenue. Both, but only where the thing
            behind the code is real — see lib/perks.js for the routes that were
            checked and rejected (Bitrefill pays in store credit; Travala needs
            a bank account and a tax form).

            Placed immediately under the rank card because that card is where
            the user just learned their tier, and "so what?" is the next
            question. Locked perks are shown WITH their distance in points: a
            reward nobody can see motivates nobody.
          */}
          <section>
            <p className="section-label">{t('perks.title')}</p>
            <p className="prose-sm" style={{ marginTop: 4 }}>{t('perks.intro')}</p>

            <motion.div className="stack" style={{ gap: 9, marginTop: 10 }} variants={stagger} initial="hidden" animate="show">
              {perks.map((pk) => (
                <motion.div
                  key={pk.id}
                  className="card card-tight perk-row"
                  variants={riseIn}
                  data-locked={!pk.unlocked}
                >
                  <div className="row-between" style={{ gap: 10 }}>
                    <div className="row" style={{ gap: 10, minWidth: 0 }}>
                      <span
                        className="perk-medal"
                        style={{ borderColor: pk.tierColor, '--perk-glow': `${pk.tierColor}55` }}
                        aria-hidden="true"
                      >
                        {pk.tierIcon}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 12.8 }}>{t(`perks.item.${pk.id}.title`)}</div>
                        <p className="prose-sm" style={{ marginTop: 2 }}>{t(`perks.item.${pk.id}.desc`)}</p>
                      </div>
                    </div>
                    {pk.benefitPct != null && (
                      <span className="pill pill-up" style={{ flexShrink: 0 }}>−{pk.benefitPct}%</span>
                    )}
                  </div>

                  {/*
                    Three states, never collapsed into two. A locked perk shows
                    the gap; an unlocked perk whose venue is not registered says
                    so instead of handing over a link that quietly does nothing;
                    only the third gives a real code.
                  */}
                  {!pk.unlocked ? (
                    <p className="faint" style={{ marginTop: 9, fontSize: 11.8 }}>
                      {t('perks.locked', {
                        n: fmtNum(pk.pointsToGo, 0),
                        tier: t(`rank.tier.${pk.tier}`)
                      })}
                    </p>
                  ) : !pk.configured ? (
                    <p className="faint" style={{ marginTop: 9, fontSize: 11.8 }}>
                      {t('perks.notReady')}
                    </p>
                  ) : (
                    <div className="btn-row" style={{ marginTop: 10 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          const ok = await copyText(pk.code);
                          useAppStore.getState().notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
                        }}
                      >
                        {t('perks.copyCode', { code: pk.code })}
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={() => open(pk.link)}>
                        {t('perks.use')}
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>

            {/*
              The honest footnote. These discounts exist because the venue pays
              us a referral share — saying so costs nothing and is the reason
              anyone should trust the number above.
            */}
            <InfoBox title={t('perks.howTitle')} tone="info" id="perks-how">
              <p>{t('perks.howBody')}</p>
            </InfoBox>
          </section>

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

          {/*
            ─── THE SELF-REFERENTIAL BANNER IS GONE ──────────────────────────
            Reported: tapping the invite banner navigates to another page.

            It did, and the destination was the bug. `AdBanner slot="referral"`
            points at `/earn`, and this banner was rendered ON the earn screen —
            directly beneath the referral card it was advertising. Inside the
            Rewards tabs it was worse: `/earn` is also a standalone route, so
            the tap threw the user out of the tabbed screen into a bare copy of
            the tab they were already reading, losing the tab bar.

            Deleted rather than repointed. The referral card with its code,
            Copy and Share buttons is the thing it was promoting and it is
            immediately above; a banner that scrolls you to the element you can
            already see is noise, not navigation.
          */}

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
                    {/*
                      Done becomes a tick in the quest's own colour rather
                      than a grey one: fading the row to 55% opacity already
                      says "finished", and draining the colour on top of that
                      made completed quests look disabled — as though the
                      points had been taken away rather than earned.
                    */}
                    <div
                      className="coin-logo"
                      style={{
                        color: q.tone,
                        borderColor: done ? undefined : q.tone,
                        /* A wash, not a fill. At full saturation six of these
                           in a column would out-shout the labels next to them. */
                        background: done ? undefined : `color-mix(in srgb, ${q.tone} 12%, transparent)`
                      }}
                    >
                      {done ? <IconCheck width={16} height={16} /> : <q.Icon width={16} height={16} />}
                    </div>
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

          {/*
            ─── THE OLD POINTS NOTICE IS GONE, ON REQUEST ────────────────────
            It said points are "not money and never will be", cannot be
            withdrawn, sent or exchanged. Removed because it is now both
            redundant and wrong in tone: FbtPanel states the same limits once,
            in one line, right under the balance it applies to. Repeating it
            here as a red slab at the foot of the quests list was the
            warning-fatigue pattern this project has already stripped out of
            Wallet and Stocks.

            The claim itself is NOT lost — see components/FbtPanel.jsx, where
            `fbt.notCoin` is deliberately never collapsed.
          */}
        </>
      )}

      {/* Only ever visible when the OS refused to handle the share itself. */}
      <ShareSheet {...shareSheet} />
    </PageTransition>
  );
}
