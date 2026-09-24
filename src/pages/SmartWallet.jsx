import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import DisclosureCard from '../components/DisclosureCard.jsx';
import InfoBox from '../components/InfoBox';
import Switch from '../components/Switch';
import { IconChevronLeft, IconShield } from '../components/Icons';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../lib/chains';
import { loadIntentMemory, saveIntentMemory } from '../lib/intentOS';
import {
  activeSession,
  addAllowlist,
  addGuardian,
  endSession,
  loadPolicy,
  loadSpend,
  removeAllowlist,
  removeGuardian,
  savePolicy,
  startSession
} from '../lib/smartWallet';
import { useTelegram } from '../context/TelegramContext';
import {
  IconCeiling,
  IconChain,
  IconIntentOS,
  IconPrivate,
  IconProof,
  IconSession,
  IconSlippage
} from '../components/SmartWalletIcons';
import '../styles/smart-wallet-icons.css';

const SESSION_MINUTES = 30;
const SESSION_BONUS_USD = 500;

const fmtClock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * Smart Wallet — prettier, more modern layout.
 *
 * Hero card with gradient + live daily-meter, then three bento-style cards
 * (Session · Guardians · Allowlist) instead of one long flat stack.
 */
export default function SmartWallet({ embedded = false, onBack }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [tick, setTick] = useState(0);
  const policy = useMemo(() => loadPolicy(), [tick]);
  const spend = useMemo(() => loadSpend(), [tick]);
  /*
   * Active-session fix: `session` used to be computed once per render with
   * the render-time clock and nothing ever re-rendered the page, so the
   * countdown froze and an expired session kept showing as «active» (with
   * the End button) until you touched another control. A 1-second clock now
   * drives the countdown while a session is open, the expired record is
   * cleaned out of storage, and edits from another tab (storage event) or
   * a swap/send that recorded spend are picked up when the tab regains focus.
   */
  const [now, setNow] = useState(() => Date.now());
  const session = activeSession(policy, now);
  const [sessionErr, setSessionErr] = useState(null);
  const [guardian, setGuardian] = useState('');
  const [allow, setAllow] = useState('');
  const [err, setErr] = useState(null);
  /*
   * The rules Intent OS compiles against used to be edited on that screen, in
   * a tab called «Memory Wallet» — a second place to set the same ceilings,
   * with a switch (quiet hours) that nothing in the app ever read. They live
   * here now, next to the policy that actually blocks a signature, so one
   * number cannot disagree with the other depending on which tab you opened.
   */
  const [intentMem, setIntentMem] = useState(() => loadIntentMemory());
  const [rulesSaved, setRulesSaved] = useState(false);

  const patchRules = (patch) => {
    const next = saveIntentMemory({ ...intentMem, ...patch });
    setIntentMem(next);
    setRulesSaved(true);
  };
  /* The strictest of the two ceilings is the one that will actually stop a
     signature — say that number, not the one the user typed. */
  const effectivePerIntentUsd = policy.enabled
    ? Math.min(Number(intentMem.maxPerIntentUsd) || 0, Number(policy.perTxLimitUsd) || 0)
    : Number(intentMem.maxPerIntentUsd) || 0;

  const refresh = () => { setNow(Date.now()); setTick((n) => n + 1); };

  useEffect(() => {
    if (!session) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session?.expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps

  /* once the window closes, drop the stale record so every reader agrees */
  useEffect(() => {
    if (policy.session && !session) {
      endSession();
      setTick((n) => n + 1);
    }
  }, [policy.session, session]);

  useEffect(() => {
    const sync = (e) => {
      if (e && e.type === 'storage' && e.key && !String(e.key).startsWith('fbt-smart-wallet')) return;
      setNow(Date.now());
      setTick((n) => n + 1);
    };
    const onVis = () => { if (document.visibilityState === 'visible') sync(); };
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  /* the cap checkPolicy() really enforces right now — includes the session bonus */
  const sessionBonus = session ? Number(session.bonusUsd) || 0 : 0;
  const effectiveDaily = policy.dailyLimitUsd + sessionBonus;
  const remaining = Math.max(0, effectiveDaily - spend.usd);
  const spentPct = Math.min(100, (spend.usd / Math.max(1, effectiveDaily)) * 100);
  const sessionLeftMs = session ? Math.max(0, session.expiresAt - now) : 0;
  const sessionTotalMs = session ? Math.max(1, session.expiresAt - (session.startedAt || session.expiresAt - SESSION_MINUTES * 60_000)) : 1;
  const sessionPct = session ? sessionLeftMs / sessionTotalMs : 0;

  const onStartSession = () => {
    const r = startSession({ minutes: SESSION_MINUTES, bonusUsd: SESSION_BONUS_USD });
    if (r?.error) {
      setSessionErr(r.error);
      haptic?.('error');
      return;
    }
    setSessionErr(null);
    haptic?.('success');
    refresh();
  };
  const onEndSession = () => {
    endSession();
    setSessionErr(null);
    haptic?.('select');
    refresh();
  };

  const goBack = () => (onBack ? onBack() : navigate(-1));

  const content = (
    <>
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={goBack} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('smart.title')}</h1>
        </motion.div>
      )}

      {/* ── HERO ────────────────────────────────────────────── */}
      <motion.section
        className="wallet-hero-modern"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{
          marginTop: embedded ? 0 : 12,
          padding: 20,
          borderRadius: 22,
          background: 'linear-gradient(135deg, rgba(124,77,255,0.22), rgba(0,229,255,0.12) 55%, rgba(255,45,149,0.18))',
          border: '1px solid rgba(255,255,255,0.08)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div className="wallet-hero-aurora" aria-hidden="true" />
        <div className="row-between" style={{ position: 'relative' }}>
          <span className="row" style={{ gap: 10 }}>
            <span
              style={{
                width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center',
                background: 'linear-gradient(135deg,#7c4dff,#00e5ff)',
                color: '#0b0f1a', boxShadow: '0 10px 26px rgba(124,77,255,0.35)'
              }}
            >
              <IconShield width={22} height={22} />
            </span>
            <span>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{t('smart.title')}</div>
              <div className="faint" style={{ fontSize: 11.5 }}>{t('smart.subtitle')}</div>
            </span>
          </span>
          <Switch
            on={policy.enabled}
            label={t('smart.enable')}
            onChange={() => {
              haptic?.('select');
              savePolicy({ enabled: !policy.enabled });
              refresh();
            }}
          />
        </div>

        {/* Live spend meter */}
        <div style={{ marginTop: 18, position: 'relative' }}>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6 }}>
              {t('smart.today')}
            </span>
            <span className="faint" style={{ fontSize: 11 }}>
              ${spend.usd.toFixed(2)} / ${effectiveDaily}{sessionBonus > 0 ? ` (+${sessionBonus})` : ''}
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${spentPct}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              style={{
                height: '100%',
                borderRadius: 999,
                background: spentPct > 80
                  ? 'linear-gradient(90deg,#ff2d95,#ff6b6b)'
                  : 'linear-gradient(90deg,#00e5ff,#7c4dff)',
                boxShadow: spentPct > 80
                  ? '0 0 16px rgba(255,45,149,0.55)'
                  : '0 0 16px rgba(0,229,255,0.45)'
              }}
            />
          </div>
          <div className="row-between" style={{ marginTop: 8 }}>
            <span className="faint" style={{ fontSize: 11 }}>
              {t('smart.remaining', { n: remaining.toFixed(0) })}
            </span>
            {session && (
              <span className="pill pill-up" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="sw-session-dot" />
                <span style={{ direction: 'ltr', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(sessionLeftMs)}</span>
              </span>
            )}
          </div>
        </div>
      </motion.section>

      {/* ── LIMITS BENTO ────────────────────────────────────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{
          marginTop: 14,
          padding: 18,
          borderRadius: 20,
          background: 'linear-gradient(168deg, rgba(20, 24, 42, 0.75), rgba(10, 14, 26, 0.85))',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 12, color: 'var(--text-1)' }}>
          {t('smart.daily')} & {t('smart.perTx')}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.035)', padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
            <label className="field-label" style={{ marginTop: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>{t('smart.daily')}</label>
            <div style={{ position: 'relative', marginTop: 6 }}>
              <input
                type="number"
                inputMode="decimal"
                value={policy.dailyLimitUsd}
                onChange={(e) => { savePolicy({ dailyLimitUsd: e.target.value }); refresh(); }}
                style={{ width: '100%', padding: '8px 24px 8px 10px', borderRadius: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line)', color: 'var(--text-1)', fontSize: 13, fontWeight: 700 }}
              />
              <span style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-3)' }}>$</span>
            </div>
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.035)', padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
            <label className="field-label" style={{ marginTop: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>{t('smart.perTx')}</label>
            <div style={{ position: 'relative', marginTop: 6 }}>
              <input
                type="number"
                inputMode="decimal"
                value={policy.perTxLimitUsd}
                onChange={(e) => { savePolicy({ perTxLimitUsd: e.target.value }); refresh(); }}
                style={{ width: '100%', padding: '8px 24px 8px 10px', borderRadius: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line)', color: 'var(--text-1)', fontSize: 13, fontWeight: 700 }}
              />
              <span style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-3)' }}>$</span>
            </div>
          </div>
        </div>
        <p className="faint" style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.7 }}>{t('smart.example')}</p>
      </motion.section>

      {/* ── SESSION CARD ────────────────────────────────────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        data-testid="smart-wallet-session"
        style={{ marginTop: 14, padding: 16, borderRadius: 18 }}
      >
        <div className="row-between" style={{ marginBottom: 8, gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <IconSession size={38} active={Boolean(session)} pct={sessionPct} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{t('smart.sessionTitle')}</div>
              <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                {session
                  ? t('smart.sessionActive', { defaultValue: 'نشست فعال' })
                  : t('smart.sessionIdle', { defaultValue: 'غیرفعال' })}
              </div>
            </div>
          </div>
          {session && (
            <span className="pill pill-up" style={{ fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="sw-session-dot" />
              {t('smart.sessionLive', { defaultValue: 'فعال' })}
            </span>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.75, margin: 0 }}>{t('smart.sessionBody')}</p>
        {!policy.enabled && (
          <p className="notice" style={{ marginTop: 10, fontSize: 11.5 }}>
            {t('smart.sessionPolicyOff', { defaultValue: 'اعمال سقف‌ها خاموش است؛ تا روشنش نکنید نشست تأثیری روی امضا ندارد.' })}
          </p>
        )}
        {session ? (
          <>
            <div className="sw-session-live">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="faint" style={{ fontSize: 10.5, fontWeight: 700 }}>
                  {t('smart.sessionLeft', { defaultValue: 'زمان باقی‌مانده' })}
                </div>
                <span className="sw-session-clock" aria-live="off">{fmtClock(sessionLeftMs)}</span>
                <p className="mono faint" style={{ margin: '2px 0 0', fontSize: 11 }}>
                  {t('smart.sessionUntil', { t: new Date(session.expiresAt).toLocaleTimeString() })}
                </p>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div className="faint" style={{ fontSize: 10.5, fontWeight: 700 }}>
                  {t('smart.sessionCap', { defaultValue: 'سقف امروز' })}
                </div>
                <div style={{ fontWeight: 900, fontSize: 15, direction: 'ltr' }}>${effectiveDaily}</div>
                <div style={{ fontSize: 10.5, color: '#3AE8B0', fontWeight: 800, direction: 'ltr' }}>+${sessionBonus}</div>
              </div>
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 10, width: '100%' }} onClick={onEndSession}>
              {t('smart.endSession')}
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, borderRadius: 14, minHeight: 44, width: '100%' }}
            onClick={onStartSession}
          >
            {t('smart.startSession')}
          </button>
        )}
        {sessionErr && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t(`smart.err.${sessionErr}`, { defaultValue: sessionErr })}
          </p>
        )}
      </motion.section>

      {/* ── GUARDIANS ───────────────────────────────────────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, padding: 16, borderRadius: 18 }}
      >
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>{t('smart.guardiansTitle')}</div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.75, marginTop: 0 }}>{t('smart.guardiansBody')}</p>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="0x…" style={{ flex: 1 }} />
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              const r = addGuardian(guardian);
              setErr(r.error || null);
              if (!r.error) setGuardian('');
              refresh();
            }}
          >
            {t('common.confirm')}
          </button>
        </div>
        {policy.guardians.length > 0 && (
          <div className="stack" style={{ gap: 7, marginTop: 10 }}>
            {policy.guardians.map((g) => (
              <div key={g} className="row-between" style={{
                padding: '8px 10px', borderRadius: 12,
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)'
              }}>
                <span className="mono" style={{ fontSize: 11 }}>{g.slice(0, 8)}…{g.slice(-6)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { removeGuardian(g); refresh(); }}>
                  {t('common.close')}
                </button>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      {/* ── ALLOWLIST ───────────────────────────────────────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, padding: 16, borderRadius: 18 }}
      >
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>{t('smart.allowTitle')}</div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.75, marginTop: 0 }}>{t('smart.allowBody')}</p>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="0x…" style={{ flex: 1 }} />
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              const r = addAllowlist(allow);
              setErr(r.error || null);
              if (!r.error) setAllow('');
              refresh();
            }}
          >
            {t('common.confirm')}
          </button>
        </div>
        {policy.allowlist.length > 0 && (
          <div className="stack" style={{ gap: 7, marginTop: 10 }}>
            {policy.allowlist.map((g) => (
              <div key={g} className="row-between" style={{
                padding: '8px 10px', borderRadius: 12,
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)'
              }}>
                <span className="mono" style={{ fontSize: 11 }}>{g.slice(0, 8)}…{g.slice(-6)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { removeAllowlist(g); refresh(); }}>
                  {t('common.close')}
                </button>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      {err && <p className="notice notice-danger" style={{ marginTop: 12 }}>{t(`smart.err.${err}`, { defaultValue: err })}</p>}

      {/* ── INTENT OS RULES (moved off that screen) ─────────────────── */}
      <motion.section
        className="wallet-pie-card smart-intent-box"
        variants={riseIn}
        initial="hidden"
        animate="show"
        data-testid="smart-wallet-intent-rules"
        style={{
          marginTop: 14,
          padding: 18,
          borderRadius: 20,
          background: 'linear-gradient(168deg, rgba(20, 24, 42, 0.75), rgba(10, 14, 26, 0.85))',
          border: '1px solid rgba(0, 229, 255, 0.18)',
          boxShadow: '0 12px 34px rgba(0, 0, 0, 0.35)',
          position: 'relative'
        }}
      >
        <div className="row-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <IconIntentOS size={40} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--text-1)' }}>
                {t('smart.rulesTitle', { defaultValue: 'قوانین شرطی Intent OS' })}
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                {t('smart.rulesSub', { defaultValue: 'تنظیم شروط زنجیره، لغزش مجاز، سقف هر اینتنت و اثبات اجرا' })}
              </div>
            </div>
          </div>
          <span
            className={`pill ${rulesSaved ? 'pill-up' : 'pill-neutral'}`}
            style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}
          >
            {rulesSaved ? `✓ ${t('smart.rulesSaved', { defaultValue: 'ذخیره شد' })}` : t('smart.rulesBadge', { defaultValue: 'تنظیمات محلی' })}
          </span>
        </div>

        {/* Micro-boxes grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 10,
            marginTop: 14
          }}
        >
          {/* Micro-box 1: Preferred Chain */}
          <div
            className="smart-micro-box"
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'rgba(255, 255, 255, 0.035)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <IconChain size={28} />
              <span className="field-label" style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>
                {t('smart.ruleChain', { defaultValue: 'زنجیره ترجیحی' })}
              </span>
            </div>
            <select
              value={intentMem.preferredChainId}
              onChange={(e) => patchRules({ preferredChainId: Number(e.target.value) })}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 10,
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid var(--line)',
                color: 'var(--text-1)',
                fontSize: 12.5,
                fontWeight: 600
              }}
            >
              {EVM_CHAIN_ORDER.map((id) => (
                <option key={id} value={id}>{EVM_CHAINS[id]?.name || id}</option>
              ))}
            </select>
          </div>

          {/* Micro-box 2: Max Slippage */}
          <div
            className="smart-micro-box"
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'rgba(255, 255, 255, 0.035)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <IconSlippage size={28} />
              <span className="field-label" style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>
                {t('smart.ruleSlippage', { defaultValue: 'حداکثر لغزش مجاز (٪)' })}
              </span>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="5"
                value={intentMem.maxSlippagePct}
                onChange={(e) => patchRules({ maxSlippagePct: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 24px 8px 10px',
                  borderRadius: 10,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--line)',
                  color: 'var(--text-1)',
                  fontSize: 12.5,
                  fontWeight: 600
                }}
              />
              <span style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-3)' }}>%</span>
            </div>
          </div>

          {/* Micro-box 3: Per-intent ceiling */}
          <div
            className="smart-micro-box"
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'rgba(255, 255, 255, 0.035)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <IconCeiling size={28} />
              <span className="field-label" style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>
                {t('smart.rulePerIntent', { defaultValue: 'سقف هر اینتنت (دلار)' })}
              </span>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                min="1"
                inputMode="decimal"
                value={intentMem.maxPerIntentUsd}
                onChange={(e) => patchRules({ maxPerIntentUsd: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 24px 8px 10px',
                  borderRadius: 10,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--line)',
                  color: 'var(--text-1)',
                  fontSize: 12.5,
                  fontWeight: 600
                }}
              />
              <span style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-3)' }}>$</span>
            </div>
          </div>

          {/* Micro-box 4: Route privately above */}
          <div
            className="smart-micro-box"
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'rgba(255, 255, 255, 0.035)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <IconPrivate size={28} />
              <span className="field-label" style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>
                {t('smart.rulePrivateAbove', { defaultValue: 'مسیر خصوصی بالای (دلار)' })}
              </span>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                min="0"
                inputMode="decimal"
                value={intentMem.privateAboveUsd}
                onChange={(e) => patchRules({ privateAboveUsd: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 24px 8px 10px',
                  borderRadius: 10,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--line)',
                  color: 'var(--text-1)',
                  fontSize: 12.5,
                  fontWeight: 600
                }}
              />
              <span style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-3)' }}>$</span>
            </div>
          </div>
        </div>

        {/* Micro-box 5: Execution Proof Switch */}
        <div
          style={{
            marginTop: 12,
            padding: '12px 14px',
            borderRadius: 14,
            background: 'rgba(255, 255, 255, 0.035)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <div className="row" style={{ gap: 10, flex: 1 }}>
            <IconProof size={34} />
            <div>
              <strong style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
                {t('smart.ruleProof', { defaultValue: 'الزام به رسید و اثبات اجرای آنچین' })}
              </strong>
              <div className="faint" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
                {t('smart.ruleProofBody', { defaultValue: 'اینتنت پیش از اینکه نهایی فرض شود، نیازمند رسید تأییدشدهٔ بلاکچین است.' })}
              </div>
            </div>
          </div>
          <Switch
            on={intentMem.requireExecutionProof}
            label={t('smart.ruleProof', { defaultValue: 'اثبات اجرا' })}
            onChange={() => patchRules({ requireExecutionProof: !intentMem.requireExecutionProof })}
          />
        </div>

        {/* Effective summary note */}
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 12,
            background: 'rgba(0, 229, 255, 0.05)',
            border: '1px solid rgba(0, 229, 255, 0.12)',
            fontSize: 11.5,
            lineHeight: 1.6,
            color: 'var(--text-2)'
          }}
        >
          {t('smart.ruleEffective', {
            defaultValue: 'این سقف به Intent OS هشدار می‌دهد وقتی یک اینتنت از {{intent}} بیشتر شود؛ سیاستِ بالا امضا را در {{policy}} به‌طور قطعی متوقف می‌کند. عددی که واقعاً جلوگیری می‌کند سخت‌گیرانه‌ترِ این دو است: {{effective}}.',
            intent: `$${intentMem.maxPerIntentUsd}`,
            policy: policy.enabled ? `$${policy.perTxLimitUsd}` : (t('smart.rulePolicyOff') || 'غیرفعال'),
            effective: `$${effectivePerIntentUsd}`
          })}
          {' · '}
          {t('smart.ruleHardFloor', {
            defaultValue: 'هر عملیات بالای {{n}} همچنان تأیید مستقیم خودتان را لازم دارد.',
            n: `$${policy.requireConfirmAboveUsd}`
          })}
        </div>
      </motion.section>

      <InfoBox title={t('smart.gasTitle')} tone="info" id="smart-gas" >
        <p>{t('smart.gasBody')}</p>
      </InfoBox>
    </>
  );

  if (embedded) return <div>{content}</div>;

  return <PageTransition>{content}</PageTransition>;
}
