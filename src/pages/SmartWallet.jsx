import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Switch from '../components/Switch';
import { IconChevronLeft, IconShield } from '../components/Icons';
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
  const session = activeSession(policy);
  const [guardian, setGuardian] = useState('');
  const [allow, setAllow] = useState('');
  const [err, setErr] = useState(null);

  const refresh = () => setTick((n) => n + 1);
  const remaining = Math.max(0, policy.dailyLimitUsd - spend.usd);
  const spentPct = Math.min(100, (spend.usd / Math.max(1, policy.dailyLimitUsd)) * 100);

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
              ${spend.usd.toFixed(2)} / ${policy.dailyLimitUsd}
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
              <span className="pill pill-up" style={{ fontSize: 10 }}>
                ⏱ {Math.max(0, Math.round(((session.expiresAt - Date.now()) / 60000)))}m
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
        style={{ marginTop: 14, padding: 16, borderRadius: 18 }}
      >
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12 }}>{t('smart.daily')} & {t('smart.perTx')}</div>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label" style={{ marginTop: 0 }}>{t('smart.daily')}</label>
            <input
              type="number"
              inputMode="decimal"
              value={policy.dailyLimitUsd}
              onChange={(e) => { savePolicy({ dailyLimitUsd: e.target.value }); refresh(); }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label" style={{ marginTop: 0 }}>{t('smart.perTx')}</label>
            <input
              type="number"
              inputMode="decimal"
              value={policy.perTxLimitUsd}
              onChange={(e) => { savePolicy({ perTxLimitUsd: e.target.value }); refresh(); }}
            />
          </div>
        </div>
        <p className="faint" style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.7 }}>{t('smart.example')}</p>
      </motion.section>

      {/* ── SESSION CARD ────────────────────────────────────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, padding: 16, borderRadius: 18 }}
      >
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>{t('smart.sessionTitle')}</div>
          <span style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center',
            background: 'linear-gradient(135deg,rgba(0,229,255,0.18),rgba(124,77,255,0.18))' }}>⏱</span>
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.75, margin: 0 }}>{t('smart.sessionBody')}</p>
        {session ? (
          <>
            <p className="mono" style={{ marginTop: 10, fontSize: 12 }}>
              {t('smart.sessionUntil', { t: new Date(session.expiresAt).toLocaleTimeString() })}
            </p>
            <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => { endSession(); refresh(); }}>
              {t('smart.endSession')}
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, borderRadius: 14, minHeight: 44 }}
            onClick={() => {
              startSession({ minutes: 30, bonusUsd: 500 });
              haptic?.('success');
              refresh();
            }}
          >
            {t('smart.startSession')}
          </button>
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

      <InfoBox title={t('smart.gasTitle')} tone="info" id="smart-gas" >
        <p>{t('smart.gasBody')}</p>
      </InfoBox>
    </>
  );

  if (embedded) return <div>{content}</div>;

  return <PageTransition>{content}</PageTransition>;
}
