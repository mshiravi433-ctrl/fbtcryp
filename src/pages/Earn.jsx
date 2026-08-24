import { useEffect, useMemo, useState } from 'react';
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
import { IconCheck, IconChevronRight, IconKey, IconPools, IconShield, IconSwap, IconTrend, IconUser, IconWallet } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import ShareSheet from '../components/ShareSheet';
import VaultCard from '../components/VaultCard';
import InfoBox from '../components/InfoBox';
import { perksFor } from '../lib/perks';
import { useShare } from '../hooks/useShare';
import { copyText } from '../lib/share';
import { telegramBotStartAppUrl } from '../lib/telegramBot';
import { dailyRewardStatus } from '../lib/dailyRewards';
import { SPECULATION_ENABLED } from '../lib/features';
import { vaultIsLive } from '../lib/vault';

/**
 * Earn.
 *
 * Split deliberately into two halves that are never blended:
 *
 *   REAL YIELD — the ways to put money to work. Every single one of them is
 *   OUR OWN SCREEN. There is no outbound link anywhere in the list, which is
 *   the rule this file is built around (see YIELD below for why).
 *
 *   POINTS — a reputation score for using the app. Points buy nothing and
 *   transfer to nobody. They used to be "virtual credits", which looked like a
 *   balance and implied withdrawable value; that was misleading in an app
 *   where other screens move real funds.
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE YIELD LIST IS OUR OWN PRODUCTS. EVERY ROW. NO EXCEPTIONS.
 * ═══════════════════════════════════════════════════════════════════════════
 * Owner directive: «بخش درآمد باید از محصولات خودمون استفاده کنه — مثلا طلا و
 * فارکس».
 *
 * ─── WHAT WAS HERE BEFORE, AND WHY IT WAS WRONG ────────────────────────────
 * Nine rows, seven of them `url:` links to PancakeSwap, Venus, Aave, Morpho,
 * Jito, THORChain and Lido. The render did `y.internal ? navigate(...) :
 * open(y.url)`, so the majority of this screen sent the user to somebody
 * else's site at the exact moment they were ready to put money in — and paid
 * us nothing for finding the opportunity. Every one of those venues has no
 * referral programme we can join (checked: Aave, Compound and Morpho have none
 * at all; the CeFi desks exclude our readers by name), so it was not even a
 * referral we simply had not registered. It was free advertising.
 *
 * ─── WHAT REPLACED IT ──────────────────────────────────────────────────────
 * The products this app actually runs, each of which is already built,
 * reachable and fee-earning:
 *
 *   gold      — PAXG / XAUt, bought through our own swap
 *   ethStake  — stETH / rETH, where buying the token IS the stake
 *   solStake  — Solana LSTs, same shape, routed through our Solana swap
 *   stocks    — tokenized equities, quoted by our own aggregator
 *   forex     — forex / metals / indices on Ostium (website builds only)
 *   vault     — our own lending vault, and only once it is deployed
 *   bridge    — cross-chain moves, our own bridge fee
 *
 * ─── THE TWO RULES THIS ARRAY IS HELD TO ───────────────────────────────────
 * 1. THERE IS NO `url` KEY. Not one row carries an outbound address, so there
 *    is nothing for a future edit to accidentally open. The render navigates
 *    and does nothing else.
 * 2. NO INVENTED NUMBERS. Not one row carries an `apr` string. A rate written
 *    into a source file is stale the day it is committed, and a fabricated
 *    rate on a money screen destroys trust in every honest number around it.
 *    Where a real live rate exists (staking APY, pool yields) it is shown on
 *    the screen that actually measures it — Farm reads DefiLlama — and this
 *    row says what the product IS instead.
 */
const YIELD = [
  {
    /*
     * GOLD. Listed first because it is the one asset here with no yield at
     * all and the one most people come to this screen for — and because
     * pretending otherwise is the exact failure the rest of this file avoids.
     *
     * `buys` renders two buttons that pre-fill our own swap with the token
     * address from lib/chains.js. Never a symbol: PAXG has clones.
     */
    id: 'gold',
    Icon: IconShield,
    risk: 'low',
    color: 'var(--rgb-5)',
    internal: '/farm?tab=inapp&focus=gold',
    buys: ['PAXG', 'XAUt']
  },
  {
    /*
     * ETHEREUM STAKING. Buying stETH or rETH IS the deposit — there is no
     * separate stake step and no lock-up, and the token grows against ETH by
     * itself. That is why this is one of our own products rather than a link
     * to Lido: the same outcome runs through our swap at the normal fee.
     */
    id: 'ethStake',
    Icon: IconTrend,
    risk: 'medium',
    color: 'var(--rgb-8)',
    internal: '/farm?tab=inapp&focus=eth',
    buys: ['stETH', 'rETH']
  },
  {
    /*
     * SOLANA STAKING. Same shape as above, on the other chain: the LST is
     * bought through our Solana swap and stays tradable. The live APY per
     * token is on the Farm screen, which measures it — not guessed here.
     */
    id: 'solStake',
    Icon: IconTrend,
    risk: 'low',
    color: 'var(--rgb-2)',
    internal: '/farm?tab=inapp&focus=sol'
  },
  {
    /*
     * TOKENIZED STOCKS. Our own aggregator quotes Backed's xStocks and the
     * issuer's key is re-verified server-side on every fetch, so the clones
     * cannot reach the list. Settles in USDT and is not a share — the Stocks
     * screen says both, above the list rather than in a footnote.
     */
    id: 'stocks',
    Icon: IconPools,
    risk: 'medium',
    color: 'var(--rgb-1)',
    internal: '/stocks'
  },
  /*
   * FOREX / METALS / INDICES.
   *
   * Gated on the SAME flag that gates the route in App.jsx. In a store build
   * `/ostium` does not exist, so a card pointing at it would land on the
   * catch-all and look broken — and "cannot work completely" means absent,
   * not half-built.
   */
  ...(SPECULATION_ENABLED
    ? [{
      id: 'forex',
      Icon: IconTrend,
      risk: 'high',
      color: 'var(--rgb-3)',
      internal: '/ostium'
    }]
    : []),
  /*
   * OUR OWN VAULT — the only row that recurs instead of paying once.
   *
   * Rendered from the live config, not a static entry: `vaultIsLive()` is
   * false on every deployment until a real Morpho vault address AND chain are
   * set, and a card for a vault nobody can deposit into is worse than no card.
   * The same condition already governs <VaultCard /> above this list.
   */
  ...(vaultIsLive()
    ? [{
      id: 'vault',
      Icon: IconShield,
      risk: 'medium',
      color: 'var(--rgb-4)',
      internal: '/vault'
    }]
    : []),
  {
    /*
     * BRIDGE. Moves the user's own assets between chains and collects our
     * bridge fee on the way. Not yield in the strict sense, but it is ours,
     * it works, and it belongs on a list of things to do with money in this
     * app far more than a link to a protocol we cannot pay for.
     */
    id: 'bridge',
    Icon: IconSwap,
    risk: 'low',
    color: 'var(--rgb-4)',
    internal: '/bridge'
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
  const claimDailyReward = useAppStore((s) => s.claimDaily);
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);
  const username = useSettingsStore((s) => s.username);

  const [tab, setTab] = useState('real');
  const [now, setNow] = useState(() => Date.now());

  /*
   * Crossing midnight must unlock the button even when this screen was left
   * open. `Date.now()` inside render does not cause a render by itself, which
   * is why the old 20-hour countdown could stay disabled until navigation.
   */
  useEffect(() => {
    const refreshClock = () => setNow(Date.now());
    const timer = setInterval(refreshClock, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshClock();
    };
    window.addEventListener('focus', refreshClock);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshClock);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const refCode = useMemo(() => ensureRefCode(user?.id), [ensureRefCode, user?.id]);
  /*
   * The official bot is the shortest, most useful referral entry point: its
   * Main Mini App opens directly and Telegram forwards startapp=CODE as the
   * signed Web App start_param. telegramBotStartAppUrl owns the public bot
   * identity, validates the parameter and falls back to the bare bot link if
   * a corrupted local refCode somehow reaches this point.
   */
  const inviteUrl = telegramBotStartAppUrl(refCode);

  const tier = tierFor(points);
  const next = nextTier(points);
  const progress = tierProgress(points);
  /* Recomputed only when the score changes — the venue codes are build-time
     constants, so nothing else can alter the result. */
  const perks = useMemo(() => perksFor(points), [points]);

  const daily = useMemo(
    () => dailyRewardStatus({ now, lastClaim, streak }),
    [now, lastClaim, streak]
  );
  const { canClaim, hoursLeft, reward: claimValue, activeStreak } = daily;

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const claimDaily = () => {
    if (!canClaim) return;
    const reward = claimDailyReward(Date.now());
    if (reward !== false) {
      setNow(Date.now());
      haptic?.('success');
    }
  };

  /**
   * The click only opens a share UI; it is not an earned action. Wait until the
   * OS reports a completed share, or until the user picks/copies a destination
   * in our fallback sheet, before recording any points. Dismissing either sheet
   * resolves with ok:false and changes nothing.
   */
  const shareInvite = async () => {
    const result = await share({ url: inviteUrl, text: t('earn.shareText') });
    if (!result?.ok) return;

    const state = useAppStore.getState();
    state.awardPoints('shareApp', POINT_VALUES.shareApp, { via: result.via });
    // Sharing is not proof that a friend joined. The referral quest remains
    // pending until a future verified-join event can complete it honestly.
    state.notify('pointsEarned', 'success');
    haptic?.('success');
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
          <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.12)' }}>
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

            Placed above the list because a live vault is the one entry that
            pays us on an ongoing basis rather than once per trade. Every row
            below is ours too now — that is the rule this screen runs on — but
            the vault is still the one worth showing first when it exists.
          */}
          <VaultCard />

          <section>
            <p className="section-label">{t('earn.opportunities')}</p>
            <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
              {YIELD.map((y) => (
                /*
                 * ─── A CARD, NOT A BUTTON ─────────────────────────────────
                 * It used to be one big <motion.button>. That is impossible
                 * now: the gold and staking rows carry their OWN buy buttons,
                 * and a <button> inside a <button> is invalid HTML — the
                 * browser drops the inner one, which would have made the buy
                 * buttons the thing that silently does nothing.
                 */
                <motion.div
                  key={y.id}
                  className="card earn-yield"
                  variants={riseIn}
                  style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' }}
                >
                  <button
                    type="button"
                    className="earn-yield-head"
                    onClick={() => {
                      haptic?.('select');
                      navigate(y.internal);
                    }}
                  >
                    <div className="row-between">
                      <div className="row" style={{ gap: 13, minWidth: 0 }}>
                        {/*
                         * The escaped `\${y.color}` here was a real bug: inside
                         * a template literal `\$` is a literal dollar sign, so
                         * the gradient read `linear-gradient(135deg, ${y.color}
                         * 14%, transparent)` and the browser threw the whole
                         * value away. The icon chips have been flat and
                         * borderless since the day this was written.
                         */}
                        <span
                          className="earn-yield-icon"
                          style={{ background: `linear-gradient(135deg, ${y.color} 14%, transparent)`, border: `1px solid ${y.color}22`, color: y.color }}
                        >
                          <y.Icon width={20} height={20} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 14 }}>{t(`earn.yield.${y.id}.title`)}</div>
                          <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 2 }}>{t(`earn.yield.${y.id}.body`)}</div>
                        </div>
                      </div>
                      {/* A chevron only. There is no external icon on this
                          screen any more, because there is nothing external
                          left to point at. */}
                      <span className="docs-chevron" style={{ flexShrink: 0 }}>
                        <IconChevronRight width={16} height={16} />
                      </span>
                    </div>
                  </button>

                  <div className="row" style={{ gap: 7, marginTop: 12, flexWrap: 'wrap' }}>
                    {/*
                      WHAT THE PRODUCT IS, INSTEAD OF AN APR NUMBER.

                      The old pill read "APR 4–9%", typed into this file. A
                      rate frozen in source is wrong within a week and nobody
                      notices, so the number is gone: each row says what it
                      actually is, and the screens that measure a real rate
                      (Farm reads live yields, Stocks reads live prices) show
                      that number where it can be true.
                    */}
                    <span className="pill pill-up" style={{ fontSize: 11, padding: '4px 8px' }}>
                      {t(`earn.yield.${y.id}.tag`)}
                    </span>
                    <span className={`pill ${y.risk === 'low' ? 'pill-neutral' : 'pill-rgb'}`} style={{ fontSize: 11 }}>
                      {t(`invest.risk.${y.risk}`)}
                    </span>
                    <span className="pill pill-neutral">{t('earn.inApp')}</span>
                  </div>

                  {/*
                    ─── BUY HERE, ON THE CARD ──────────────────────────────
                    For the two products where buying IS the whole action
                    (gold and ETH staking) the swap is pre-filled right here:
                    chain 1, USDT out, the named token in. One tap instead of
                    card → section → token → swap.

                    The SYMBOL travels because that is the contract the Swap
                    screen already accepts — `?to=PAXG` resolves the address
                    from its own verified table. An address retyped in this
                    file would be a second source of truth for a token with
                    clones.
                  */}
                  {y.buys && (
                    <div className="btn-row" style={{ marginTop: 10 }}>
                      {y.buys.map((sym) => (
                        <button
                          key={sym}
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            haptic?.('select');
                            navigate(`/swap?chain=1&from=USDT&to=${encodeURIComponent(sym)}`);
                          }}
                        >
                          {t('earn.yield.buy', { sym })}
                        </button>
                      ))}
                    </div>
                  )}

                  {/*
                    The honest limit, on the card. Gold can be frozen by its
                    issuer; tokenized stocks settle in USDT and are not shares.
                    Both were already stated on the screens these rows open —
                    repeating the one line here is what stops the card reading
                    as a promise the destination then walks back.
                  */}
                  <p className="faint earn-yield-note">{t(`earn.yield.${y.id}.note`)}</p>
                </motion.div>
              ))}
            </motion.div>
          </section>

          <AdBanner slot="farm" />

          {/*
            Reported: «در صفحه سود واقعی پایین صفحه هشدار هست».

            Kept as `danger` tone but folded: the list still carries genuinely
            risky entries (forex can take the whole margin, a gold issuer can
            freeze an address), so the warning has to stay prominent — but a
            red wall at the foot of a list of opportunities was being scrolled
            past, which is the opposite of prominent.

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
            style={{ borderColor: `${tier.color}22`, cursor: 'pointer', background: `linear-gradient(145deg, ${tier.color}0a, var(--bg-raised))`, borderRadius: 16 }}
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
                <div className="faint">{t('earn.streakDays', { n: activeStreak })}</div>
              </div>
              <span className="pill pill-rgb">+{claimValue} {t('rank.pts')}</span>
            </div>

            <div className="row" style={{ gap: 5, marginBottom: 12 }}>
              {Array.from({ length: 7 }).map((_, i) => {
                const done = i < Math.min(activeStreak, 7);
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
                onClick={() => shareInvite()}
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
                        void shareInvite();
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
