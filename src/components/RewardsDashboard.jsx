/**
 * FBT REWARDS — dashboard (the default tab of /rewards).
 * ---------------------------------------------------------------------------
 * API-FIRST: every number here comes from GET /api/v1/rewards/summary — the
 * engine's verified ledger. While the API is unreachable the card degrades to
 * the device's own instant ledger and says so instead of pretending.
 *
 * Sections: wallet strip · Points / Level / FBT / Rank · Today's Missions ·
 * streak · Your Benefits · Referral · Achievements · Reward History ·
 * FBT Utility · FBT Market · Claim status.
 *
 * NOTHING on this screen is invented: utilities the backend does not execute
 * and markets that are not launched render NOT_LAUNCHED, never a number.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from './PageTransition';
import AnimatedNumber from './AnimatedNumber';
import InfoBox from './InfoBox';
import AdBanner from './AdBanner';
import ShareSheet from './ShareSheet';
import { useShare } from '../hooks/useShare';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { useTelegram } from '../context/TelegramContext';
import { POINT_VALUES, tierFor, nextTier } from '../lib/ranks';
import { perksFor } from '../lib/perks';
import { rewardsSummary, bindRewardCode } from '../lib/rewards/rewardsApi';
import { telegramBotStartAppUrl } from '../lib/telegramBot';
import { copyText } from '../lib/share';
import {
  IconActivity, IconCheck, IconChevronRight, IconCopy, IconGift, IconLink,
  IconLock, IconPools, IconSparkle, IconSwap, IconTrophy, IconUser, IconWallet
} from './Icons';

/** Server error codes the bind endpoint can answer with — mapped to text. */
const BIND_ERROR_KEYS = new Set([
  'WALLET_REQUIRED', 'NO_CODE', 'CODE_TAKEN', 'SIGNATURE_REQUIRED',
  'BAD_BIND_MESSAGE', 'SIGNATURE_VERIFY_FAILED', 'SIGNATURE_MISMATCH',
  'BAD_REF_CODE', 'TELEGRAM_OWNER_REQUIRED'
]);

function labelFor(t, action) {
  const id = String(action ?? '').replace(/^quest:/, '');
  if (id.startsWith('mission:')) {
    return t(`rewards.mission.${id.slice(8)}`, { defaultValue: '' }) || t('rewards.missionBonus');
  }
  if (id === 'sync') return t('rank.action.sync', { defaultValue: t('rewards.action.sync') });
  return (
    t(`rank.action.${id}`, { defaultValue: '' }) ||
    t(`rewards.action.${id}`, { defaultValue: '' }) ||
    t('rank.action.quest')
  );
}

export default function RewardsDashboard({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const sol = useSolanaWallet();
  const [share, shareSheet] = useShare();

  const points = useAppStore((s) => s.points);
  const refCodeState = useAppStore((s) => s.refCode);

  /* The invite code exists from first need; create it lazily so the share row
     always has something real to copy. */
  useEffect(() => {
    useAppStore.getState().ensureRefCode();
  }, []);
  const refCodeLocal = refCodeState || useAppStore.getState().refCode || '';

  const [summary, setSummary] = useState(null);
  const [mode, setMode] = useState('loading'); // loading | online | offline
  const [bindBusy, setBindBusy] = useState(false);
  const [bindError, setBindError] = useState(null);

  const load = async () => {
    const res = await rewardsSummary();
    if (!res.ok) {
      setMode('offline');
      return;
    }
    setSummary(res.data);
    setMode('online');
    /* Converge the device ledger on the engine total (points only rise). */
    useAppStore.getState().syncServerPoints(Number(res.data?.points) || 0);
  };

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const res = await rewardsSummary();
      if (!alive) return;
      if (!res.ok) {
        setMode('offline');
        return;
      }
      setSummary(res.data);
      setMode('online');
      useAppStore.getState().syncServerPoints(Number(res.data?.points) || 0);
    };
    void run();
    const onRefresh = () => void run();
    window.addEventListener('focus', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    const iv = setInterval(onRefresh, 60000);
    return () => {
      alive = false;
      window.removeEventListener('focus', onRefresh);
      document.removeEventListener('visibilitychange', onRefresh);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const evmConnected = Boolean(wallet.isConnected && wallet.address);
  const solConnected = Boolean(sol.isConnected && sol.address);
  const primaryAddress = evmConnected ? wallet.address : sol.address || null;
  const walletLabel = evmConnected
    ? `${t('rewards.wallet.evm')}${wallet.chain?.short ? ` · ${wallet.chain.short}` : ''}`
    : solConnected
      ? `${t('rewards.wallet.solana')}${sol.walletName ? ` · ${sol.walletName}` : ''}`
      : '';

  const pts = mode === 'online' && summary ? Number(summary.points) || 0 : points;
  const level = summary?.level || null;
  const streak = Number(summary?.streak?.count || 0);

  /* offline fallbacks */
  const localTier = tierFor(points);
  const localNext = nextTier(points);

  const perks = useMemo(() => perksFor(pts), [pts]);
  const inviteUrl = telegramBotStartAppUrl(refCodeLocal);

  const missions = summary?.missions?.today || [];
  const milestones = summary?.missions?.milestones || [];
  const achievements = summary?.achievements || [];
  const utilities = summary?.utilities || [];
  const history = summary?.history || [];
  const referrals = summary?.referrals || { total: 0, code: null };
  const claim = summary?.claim || { status: 'NOT_LAUNCHED' };
  const codeBound = Boolean(mode === 'online' && referrals?.code);

  const copyCode = async (text = refCodeLocal) => {
    const ok = await copyText(text);
    useAppStore.getState().notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
    haptic?.(ok ? 'success' : 'error');
  };

  const openWallet = () => {
    haptic?.('select');
    navigate('/wallet');
  };

  const connectSol = async () => {
    haptic?.('light');
    try {
      await sol.connect();
    } catch {
      useAppStore.getState().notify('copyFailed', 'error');
    }
  };

  /**
   * Share the invite. Same contract as Earn's referral card: success is only
   * true after the OS accepts the share (or a concrete action in the fallback
   * sheet), and only then does the real `shareApp` reward land — once per day,
   * mirrored by the engine's own daily cap.
   */
  const shareInvite = async () => {
    const result = await share({ url: inviteUrl, text: t('earn.shareText') });
    if (!result?.ok) return;
    useAppStore.getState().awardPoints('shareApp', POINT_VALUES.shareApp, { via: result.via || 'share' });
    haptic?.('success');
  };

  /** Activate the referral code with the connected EVM wallet (signed). */
  const activateCode = async () => {
    setBindError(null);
    if (!wallet.isConnected || !wallet.address) {
      setBindError('WALLET_REQUIRED');
      return;
    }
    const signer = wallet.getSigner?.();
    if (!signer?.signMessage) {
      setBindError('WALLET_REQUIRED');
      return;
    }
    const code = String(referrals?.code || refCodeLocal || '').trim();
    if (!code) {
      setBindError('NO_CODE');
      return;
    }
    setBindBusy(true);
    try {
      const message = `FBT Rewards referral code ${code} for ${wallet.address.toLowerCase()}`;
      const signature = await signer.signMessage(message);
      const res = await bindRewardCode({ code, wallet: wallet.address, signature, message });
      if (!res.ok) {
        setBindError(BIND_ERROR_KEYS.has(res.code) ? res.code : 'BIND_FAILED');
        return;
      }
      setBindError(null);
      haptic?.('success');
      void load();
    } catch {
      setBindError('SIGN_REJECTED');
    } finally {
      setBindBusy(false);
    }
  };

  return (
    <PageTransition embedded={embedded}>
      {/* ------------------------------ wallet ------------------------------ */}
      <motion.section variants={riseIn} initial="hidden" animate="show" className="card card-tight">
        <div className="row-between" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <span
              className="wallet-chip"
              style={{
                width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0,
                background: primaryAddress ? 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))' : 'rgba(127,127,127,.14)',
                color: primaryAddress ? '#001014' : 'var(--text-3)'
              }}
            >
              <IconWallet width={19} height={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              {primaryAddress ? (
                <>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }} dir="ltr">
                    {shortAddress(primaryAddress)}
                  </div>
                  <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>
                    {walletLabel}
                    {evmConnected && wallet.nativeBalance != null
                      ? ` · ${fmtNum(wallet.nativeBalance, 4)} ${wallet.chain?.native?.symbol || ''}`
                      : ''}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t('rewards.wallet.title')}</div>
                  <div className="faint" style={{ fontSize: 11, marginTop: 1 }}>{t('rewards.wallet.sub')}</div>
                </>
              )}
            </div>
          </div>
          {!primaryAddress && (
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              {sol.available && (
                <button className="btn btn-ghost btn-sm" onClick={() => void connectSol()} style={{ whiteSpace: 'nowrap' }}>
                  Solana
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={openWallet} style={{ whiteSpace: 'nowrap' }}>
                {t('rewards.wallet.connect')}
              </button>
            </div>
          )}
        </div>
        {mode === 'offline' && (
          <p className="notice" style={{ marginTop: 10, marginBottom: 0 }}>{t('rewards.offlineNote')}</p>
        )}
      </motion.section>

      {/* ---------------------- points · level · fbt · rank ---------------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 9 }}>
          <div className="card card-tight stat-card">
            <div className="stat-key row" style={{ gap: 6 }}>
              <IconSparkle width={13} height={13} /> {t('rewards.points')}
            </div>
            <div className="stat-mini mono" style={{ marginTop: 4 }}>
              <AnimatedNumber value={pts} format={(v) => fmtNum(v, 0)} />
            </div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('rewards.pointsSub')}</div>
          </div>

          <div className="card card-tight stat-card">
            <div className="stat-key row" style={{ gap: 6 }}>
              <IconActivity width={13} height={13} /> {t('rewards.level')}
            </div>
            <div className="stat-mini" style={{ marginTop: 4, color: 'var(--rgb-1)' }}>
              {level
                ? t(`rank.tier.${level.current.id}`)
                : t(`rank.tier.${localTier.id}`)}
            </div>
            <div className="faint" style={{ fontSize: 10.5 }}>
              {level?.next
                ? t('rewards.levelTo', { n: fmtNum(level.toNext, 0), tier: t(`rank.tier.${level.next.id}`) })
                : !level && localNext
                  ? t('rewards.levelTo', { n: fmtNum(localNext.min - points, 0), tier: t(`rank.tier.${localNext.id}`) })
                  : t('rewards.levelMax')}
            </div>
          </div>

          <div className="card card-tight stat-card">
            <div className="stat-key row" style={{ gap: 6 }}>
              <IconGift width={13} height={13} /> {t('rewards.fbtBalance')}
            </div>
            <div className="stat-mini mono" style={{ marginTop: 4, color: 'var(--rgb-2)' }}>
              <AnimatedNumber value={pts} format={(v) => fmtNum(v, 0)} /> <span style={{ fontSize: 12.5 }}>FBT</span>
            </div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('rewards.fbtSub')}</div>
          </div>

          <div className="card card-tight stat-card">
            <div className="stat-key row" style={{ gap: 6 }}>
              <IconTrophy width={13} height={13} /> {t('rewards.rank')}
            </div>
            <div className="stat-mini" style={{ marginTop: 4 }}>
              {summary?.rank?.available ? String(summary.rank.position ?? '—') : t('rewards.rankNone')}
            </div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('rewards.rankSub')}</div>
          </div>
        </div>
      </motion.section>

      {mode === 'online' && level?.next && (
        <div className="progress" style={{ marginTop: 10 }}>
          <motion.div
            className="progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(Math.min(1, Math.max(0, level.progress)) * 100)}%` }}
            transition={{ duration: 0.8 }}
          />
        </div>
      )}

      {/* --------------------------- today's missions --------------------------- */}
      {(missions.length > 0 || milestones.length > 0) && (
        <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <p className="section-label">{t('rewards.todayMissions')}</p>
          <motion.div className="stack" style={{ gap: 7, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {[...missions, ...milestones].map((m) => (
              <motion.div
                key={m.id}
                variants={riseIn}
                className="coin-row"
                style={{ opacity: m.done ? 0.6 : 1, padding: '10px 12px', borderRadius: 13, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <span
                  style={{
                    width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
                    color: m.done ? '#0b3d20' : 'var(--rgb-1)',
                    background: m.done ? 'linear-gradient(135deg, #00ff9d, #00e5ff)' : 'color-mix(in srgb, var(--rgb-1) 12%, transparent)'
                  }}
                >
                  {m.done ? <IconCheck width={15} height={15} /> : <IconActivity width={15} height={15} />}
                </span>
                <div className="coin-meta">
                  <div className="coin-sym" style={{ textTransform: 'none', fontSize: 12.3 }}>{labelFor(t, `mission:${m.id}`)}</div>
                  <div className="coin-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="progress" style={{ width: 74, height: 4, margin: 0 }}>
                      <div
                        className="progress-fill"
                        style={{
                          width: `${Math.min(100, Math.round((m.progress / Math.max(1, m.target)) * 100))}%`,
                          background: m.done ? 'linear-gradient(90deg,#00ff9d,#00e5ff)' : undefined
                        }}
                      />
                    </div>
                    <span>{fmtNum(m.progress, 0)}/{fmtNum(m.target, 0)}</span>
                  </div>
                </div>
                <span className={`pill ${m.done ? 'pill-up' : 'pill-neutral'}`} style={{ flexShrink: 0 }}>
                  {m.done ? t('rewards.done') : m.pts > 0 ? `+${m.pts}` : '›'}
                </span>
              </motion.div>
            ))}
          </motion.div>
        </motion.section>
      )}

      {/* -------------------------------- streak -------------------------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
        <div className="row-between" style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="row" style={{ gap: 9 }}>
            <span style={{ fontSize: 18 }}>🔥</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t('rewards.streakTitle')}</div>
              <div className="faint" style={{ fontSize: 10.8, marginTop: 1 }}>{t('rewards.streakSub')}</div>
            </div>
          </div>
          <span className="pill pill-rgb" style={{ flexShrink: 0 }}>{fmtNum(streak, 0)} {t('rewards.days')}</span>
        </div>
      </motion.section>

      {/* ------------------------------ benefits ------------------------------ */}
      <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
        <p className="section-label">{t('rewards.benefitsTitle')}</p>
        <p className="prose-sm" style={{ fontSize: 11.5 }}>{t('rewards.benefitsSub')}</p>
        <motion.div className="stack" style={{ gap: 7, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {perks.map((pk) => (
            <motion.div key={pk.id} variants={riseIn} className="card card-tight" style={{ borderRadius: 13 }}>
              <div className="row-between" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 9, minWidth: 0 }}>
                  <span className="perk-medal" style={{ borderColor: pk.tierColor, '--perk-glow': `${pk.tierColor}55` }} aria-hidden="true">{pk.tierIcon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.3 }}>{t(`perks.item.${pk.id}.title`)}</div>
                    <p className="prose-sm" style={{ fontSize: 10.6, marginTop: 1 }}>{t(`perks.item.${pk.id}.desc`)}</p>
                  </div>
                </div>
                {pk.benefitPct != null && <span className="pill pill-up" style={{ flexShrink: 0 }}>−{pk.benefitPct}%</span>}
              </div>
              {!pk.unlocked ? (
                <p className="faint" style={{ marginTop: 7, fontSize: 10.8 }}>
                  {t('perks.locked', { n: fmtNum(pk.pointsToGo, 0), tier: t(`rank.tier.${pk.tier}`) })}
                </p>
              ) : !pk.configured ? (
                <p className="faint" style={{ marginTop: 7, fontSize: 10.8 }}>{t('perks.notReady')}</p>
              ) : (
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => copyCode(pk.code)}>
                    {t('perks.copyCode', { code: pk.code })}
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </motion.section>

      {/* ------------------------------ referral ------------------------------ */}
      <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <p className="section-label" style={{ margin: 0 }}>{t('rewards.referralTitle')}</p>
          <span className="pill pill-up" style={{ flexShrink: 0 }}>+{fmtNum(POINT_VALUES.referral, 0)}</span>
        </div>
        <div className="card" style={{ padding: 13, borderRadius: 14 }}>
          <div className="row-between" style={{ background: 'rgba(127,127,127,.08)', border: '1px solid var(--line)', borderRadius: 11, padding: '9px 11px', gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--rgb-1)', overflow: 'hidden', textOverflow: 'ellipsis' }} dir="ltr">{refCodeLocal}</span>
            <span className="pill pill-neutral" style={{ flexShrink: 0 }}>{fmtNum(referrals?.total ?? 0, 0)}</span>
          </div>

          {mode === 'online' && !codeBound && evmConnected && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 9 }} disabled={bindBusy} onClick={() => void activateCode()}>
              <IconLink width={13} height={13} /> {bindBusy ? t('rewards.referralBinding') : t('rewards.referralBindWallet')}
            </button>
          )}
          {codeBound && (
            <p className="faint" style={{ marginTop: 8, fontSize: 11 }}>✓ {t('rewards.referralBound')}</p>
          )}
          {bindError && (
            <p className="faint" style={{ marginTop: 7, fontSize: 11, color: 'var(--down)' }}>
              {t(`rewards.err.${bindError}`, { defaultValue: t('rewards.err.BIND_FAILED') })}
            </p>
          )}

          <div className="btn-row" style={{ marginTop: 9 }}>
            <button className="btn btn-ghost btn-row-minor" onClick={() => copyCode()}>
              <IconCopy width={13} height={13} /> {t('common.copy')}
            </button>
            <button
              className="btn btn-primary btn-row-minor"
              onClick={() => void shareInvite()}
            >
              <IconUser width={13} height={13} /> {t('earn.shareInvite')}
            </button>
          </div>
          <p className="prose-sm faint" style={{ fontSize: 10.4, marginTop: 8, lineHeight: 1.7 }}>{t('rewards.referralHow')}</p>
        </div>
      </motion.section>

      {/* ---------------------------- achievements ---------------------------- */}
      {achievements.length > 0 && (
        <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <p className="section-label">{t('rewards.achievementsTitle')}</p>
          <div className="row" style={{ gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
            {achievements.map((a) => (
              <div
                key={a.id}
                className="tag"
                style={{
                  opacity: a.done ? 1 : 0.55,
                  background: a.done ? 'rgba(0,255,157,0.08)' : undefined
                }}
              >
                <span style={{ fontSize: 14 }}>{a.icon}</span> {t(a.label, { defaultValue: a.id })}
                {a.done && <IconCheck width={12} height={12} style={{ marginInlineStart: 4 }} />}
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* ----------------------------- FBT utility ----------------------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
        <p className="section-label">{t('rewards.utilityTitle')}</p>
        <div className="card" style={{ padding: 13, borderRadius: 14 }}>
          {utilities.length === 0 ? (
            <p className="prose-sm faint" style={{ fontSize: 11 }}>{t('rewards.utilityNone')}</p>
          ) : (
            <motion.div className="stack" style={{ gap: 6 }} variants={stagger} initial="hidden" animate="show">
              {utilities.map((u) => (
                <motion.div key={u.id} variants={riseIn} className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.3 }}>{t(`rewards.utility.${u.id}.title`)}</div>
                    <div className="faint" style={{ fontSize: 10.5, lineHeight: 1.6 }}>{t(`rewards.utility.${u.id}.body`)}</div>
                  </div>
                  <span className="pill pill-neutral" style={{ flexShrink: 0, fontSize: 10 }}>
                    {u.launched ? t('rewards.live') : t('rewards.notLaunched')}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </motion.section>

      {/* ------------------------------ FBT market ------------------------------ */}
      <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 10 }}>
        <div className="card" style={{ padding: 14, borderRadius: 14, borderColor: 'rgba(255,201,60,.25)' }}>
          <div className="row-between" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 9 }}>
              <span style={{ fontSize: 19 }}>📈</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t('rewards.marketTitle')}</div>
                <div className="faint" style={{ fontSize: 10.5, marginTop: 1 }}>{t('rewards.marketSub')}</div>
              </div>
            </div>
            <span className="pill pill-neutral" style={{ flexShrink: 0 }}>
              {summary?.fbt?.market === 'live' ? t('rewards.marketLive') : t('rewards.marketStatus')}
            </span>
          </div>
          <InfoBox title={t('rewards.marketInfoTitle')} tone="info" id="rwd-market">
            <p>{t('rewards.marketInfoBody')}</p>
          </InfoBox>
        </div>
      </motion.section>

      {/* ---------------------------- claim status ---------------------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 10 }}>
        <div className="card" style={{ padding: 14, borderRadius: 14 }}>
          <div className="row-between" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 9 }}>
              <IconLock width={15} height={15} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 12.8 }}>{t('rewards.claimTitle')}</div>
                <div className="faint" style={{ fontSize: 10.5, marginTop: 1 }}>{t('rewards.claimSub')}</div>
              </div>
            </div>
            <span className={`pill ${claim.status === 'READY' ? 'pill-up' : 'pill-neutral'}`} style={{ flexShrink: 0, fontSize: 10 }}>
              {claim.status === 'READY' ? t('rewards.claimReady') : t('rewards.notLaunched')}
            </span>
          </div>
          {claim.status !== 'READY' && (
            <p className="prose-sm faint" style={{ fontSize: 10.6, marginTop: 8, lineHeight: 1.7 }}>{t('rewards.claimNotLaunched')}</p>
          )}
        </div>
      </motion.section>

      {/* ---------------------------- reward history ---------------------------- */}
      {(mode === 'online' ? history.length > 0 : false) && (
        <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <p className="section-label">{t('rewards.historyTitle')}</p>
          <motion.div className="stack" style={{ gap: 5, marginTop: 7 }} variants={stagger} initial="hidden" animate="show">
            {history.slice(0, 8).map((entry) => (
              <motion.div key={`${entry.id || entry.action}-${entry.at}`} variants={riseIn} className="coin-row" style={{ padding: '7px 4px' }}>
                <span style={{ fontSize: 13 }}>✨</span>
                <div className="coin-meta">
                  <div className="coin-sym" style={{ textTransform: 'none', fontSize: 11.8 }}>{labelFor(t, entry.action)}</div>
                  <div className="coin-name" style={{ fontSize: 10.4 }}>
                    {new Date(entry.at).toLocaleString()}{entry.evidence ? ` · ${entry.evidence}` : ''}
                  </div>
                </div>
                <div className="coin-right mono up" style={{ fontSize: 11.5, fontWeight: 700 }}>+{fmtNum(entry.pts, 0)}</div>
              </motion.div>
            ))}
          </motion.div>
        </motion.section>
      )}

      {/* ------------------------------ shortcuts ------------------------------ */}
      <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="tag" style={{ flex: '1 1 130px', minHeight: 40, justifyContent: 'center', gap: 6 }} onClick={() => navigate('/swap')}>
            <IconSwap width={14} height={14} /> {t('rewards.goSwap')}
          </button>
          <button className="tag" style={{ flex: '1 1 130px', minHeight: 40, justifyContent: 'center', gap: 6 }} onClick={() => navigate('/earn')}>
            <IconPools width={14} height={14} /> {t('rewards.goEarn')}
          </button>
          <button className="tag" style={{ flex: '1 1 130px', minHeight: 40, justifyContent: 'center', gap: 6 }} onClick={() => navigate('/intent')}>
            <IconChevronRight width={14} height={14} /> {t('rewards.goGoals')}
          </button>
        </div>
      </motion.section>

      <AdBanner slot="swap" compact />
      <ShareSheet {...shareSheet} />
    </PageTransition>
  );
}
