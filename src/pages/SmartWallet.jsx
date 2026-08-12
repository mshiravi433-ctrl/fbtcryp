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

export default function SmartWallet() {
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

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('smart.title')}</h1>
      </motion.div>
      <p className="muted" style={{ lineHeight: 1.85 }}>{t('smart.subtitle')}</p>

      <InfoBox title={t('smart.whatTitle')} tone="info" id="smart-what">
        <p>{t('smart.whatBody')}</p>
      </InfoBox>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="set-row" style={{ padding: 0 }}>
          <span className="set-row-label">
            <div>{t('smart.enable')}</div>
            <div className="set-row-sub">{t('smart.enableSub')}</div>
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
      </motion.section>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', color: '#fff' }}>
            <IconShield width={18} height={18} />
          </span>
          <div>
            <div style={{ fontWeight: 800 }}>{t('smart.today')}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 900 }}>${spend.usd.toFixed(2)}</div>
            <div className="faint" style={{ fontSize: 11.5 }}>{t('smart.remaining', { n: remaining.toFixed(0) })}</div>
          </div>
        </div>

        <label className="field-label">{t('smart.daily')}</label>
        <input
          type="number"
          inputMode="decimal"
          value={policy.dailyLimitUsd}
          onChange={(e) => {
            savePolicy({ dailyLimitUsd: e.target.value });
            refresh();
          }}
        />
        <label className="field-label" style={{ marginTop: 10 }}>{t('smart.perTx')}</label>
        <input
          type="number"
          inputMode="decimal"
          value={policy.perTxLimitUsd}
          onChange={(e) => {
            savePolicy({ perTxLimitUsd: e.target.value });
            refresh();
          }}
        />
        <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>{t('smart.example')}</p>
      </motion.section>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{t('smart.sessionTitle')}</div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.75 }}>{t('smart.sessionBody')}</p>
        {session ? (
          <>
            <p className="mono" style={{ marginTop: 8 }}>{t('smart.sessionUntil', { t: new Date(session.expiresAt).toLocaleTimeString() })}</p>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => { endSession(); refresh(); }}>{t('smart.endSession')}</button>
          </>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => {
              startSession({ minutes: 30, bonusUsd: 250 });
              haptic?.('success');
              refresh();
            }}
          >
            {t('smart.startSession')}
          </button>
        )}
      </motion.section>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{t('smart.guardiansTitle')}</div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.75 }}>{t('smart.guardiansBody')}</p>
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
        {policy.guardians.map((g) => (
          <div key={g} className="row-between" style={{ marginTop: 8 }}>
            <span className="mono" style={{ fontSize: 11 }}>{g.slice(0, 6)}…{g.slice(-4)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { removeGuardian(g); refresh(); }}>{t('common.close')}</button>
          </div>
        ))}
      </motion.section>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{t('smart.allowTitle')}</div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.75 }}>{t('smart.allowBody')}</p>
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
        {policy.allowlist.map((g) => (
          <div key={g} className="row-between" style={{ marginTop: 8 }}>
            <span className="mono" style={{ fontSize: 11 }}>{g.slice(0, 6)}…{g.slice(-4)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { removeAllowlist(g); refresh(); }}>{t('common.close')}</button>
          </div>
        ))}
      </motion.section>

      {err && <p className="notice notice-danger">{t(`smart.err.${err}`, { defaultValue: err })}</p>}

      <InfoBox title={t('smart.gasTitle')} tone="info" id="smart-gas">
        <p>{t('smart.gasBody')}</p>
      </InfoBox>
    </PageTransition>
  );
}
