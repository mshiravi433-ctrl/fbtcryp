import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import Sheet from '../components/Sheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { firebaseConfigured, pullSettings, pushSettings } from '../lib/firebase';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  platformAuthenticatorAvailable,
  registerBiometric,
  totpUri,
  verifyBiometric,
  verifyTotp
} from '../lib/security';
import { applyDirection } from '../i18n';
import {
  IconChevronRight,
  IconFingerprint,
  IconGlobe,
  IconInfo,
  IconTelegram,
  IconDoc,
  IconKey,
  IconLock,
  IconMoon,
  IconShield,
  IconSwap,
  IconTrend,
  IconSun,
  IconUser,
  IconWallet
} from '../components/Icons';

function Row({ icon: Icon, label, sub, right, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="set-row" onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="set-row-icon">
        <Icon width={19} height={19} />
      </span>
      <span className="set-row-label">
        <div>{label}</div>
        {sub && <div className="set-row-sub">{sub}</div>}
      </span>
      {right ?? (onClick && <IconChevronRight width={17} height={17} style={{ color: 'var(--text-3)' }} />)}
    </Tag>
  );
}

function Switch({ on, onChange }) {
  return (
    <button className="switch" data-on={on} onClick={onChange} type="button" role="switch" aria-checked={on}>
      <motion.span
        className="switch-knob"
        animate={{ x: on ? 19 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const wallet = useWallet();
  const s = useSettingsStore();

  const [twoFaSheet, setTwoFaSheet] = useState(false);
  const [totpSecret, setTotpSecret] = useState(null);
  const [totpInput, setTotpInput] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [twoFaErr, setTwoFaErr] = useState(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioErr, setBioErr] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    platformAuthenticatorAvailable().then(setBioAvailable);
  }, []);

  /* ------------------------------ handlers ------------------------------ */

  const cycleTheme = () => {
    const order = ['dark', 'light', 'auto'];
    const next = order[(order.indexOf(s.theme) + 1) % order.length];
    haptic?.('select');
    s.setTheme(next);
  };

  const startTwoFa = () => {
    if (s.twoFactorEnabled) {
      s.disable2FA();
      haptic?.('warning');
      return;
    }
    setTotpSecret(generateTotpSecret());
    setRecovery(null);
    setTotpInput('');
    setTwoFaErr(null);
    setTwoFaSheet(true);
  };

  const confirmTwoFa = async () => {
    const ok = await verifyTotp(totpSecret, totpInput);
    if (!ok) {
      setTwoFaErr(true);
      haptic?.('error');
      return;
    }
    s.enable2FA(totpSecret);
    setRecovery(generateRecoveryCodes());
    haptic?.('success');
  };

  const toggleBiometric = async () => {
    setBioErr(null);

    if (s.biometricEnabled) {
      s.disableBiometric();
      haptic?.('warning');
      return;
    }

    if (!bioAvailable) {
      setBioErr('UNSUPPORTED');
      return;
    }

    try {
      // Register, then immediately prove the same authenticator works —
      // otherwise we'd enable a lock the user can't actually open.
      const cred = await registerBiometric(s.username || 'wallet');
      const ok = await verifyBiometric(cred.rawId);
      if (!ok) throw new Error('FAILED');

      s.enableBiometric(cred.rawId);
      haptic?.('success');
    } catch (e) {
      const name = e?.name;
      setBioErr(
        e.message === 'UNSUPPORTED' ? 'UNSUPPORTED'
        : name === 'NotAllowedError' ? 'CANCELLED'
        : name === 'InvalidStateError' ? 'ALREADY_REGISTERED'
        : name === 'SecurityError' ? 'INSECURE_ORIGIN'
        : 'FAILED'
      );
      haptic?.('error');
    }
  };

  const doSync = async () => {
    setSyncing(true);
    try {
      const remote = await pullSettings();
      if (remote) s.applyRemote(remote);
      await pushSettings(s.exportSyncable());
      s.markSynced();
      haptic?.('success');
    } finally {
      setSyncing(false);
    }
  };

  const themeLabel = s.theme === 'dark' ? t('settings.themeDark') : s.theme === 'light' ? t('settings.themeLight') : t('settings.themeAuto');

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('settings.title')}</h1>
        <p className="muted">{t('settings.subtitle')}</p>
      </motion.div>

      {/* ---------------- profile ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.profile')}</p>
        <div className="set-group">
          <Row
            icon={IconWallet}
            label={t('settings.wallet')}
            sub={wallet.address ? shortAddress(wallet.address) : t('settings.noWallet')}
            onClick={() => navigate('/wallet')}
          />
          <Row
            icon={IconGlobe}
            label={t('settings.language')}
            sub={{ fa: 'فارسی', en: 'English', ar: 'العربية' }[i18n.language] ?? i18n.language}
            right={
              <div className="lang-switch">
                {['fa', 'en', 'ar'].map((lng) => (
                  <button
                    key={lng}
                    className={`lang-btn ${i18n.language === lng ? 'active' : ''}`}
                    onClick={() => {
                      i18n.changeLanguage(lng);
                      applyDirection(lng);
                    }}
                    style={{ isolation: 'isolate' }}
                  >
                    {i18n.language === lng && <motion.span layoutId="set-lang" className="lang-pill" />}
                    {lng}
                  </button>
                ))}
              </div>
            }
          />
        </div>
      </motion.section>

      {/* ---------------- appearance ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.appearance')}</p>
        <div className="set-group">
          <Row
            icon={s.theme === 'light' ? IconSun : IconMoon}
            label={t('settings.theme')}
            sub={themeLabel}
            onClick={cycleTheme}
            right={<span className="pill pill-rgb">{themeLabel}</span>}
          />
          <Row
            icon={IconGlobe}
            label={t('settings.accent')}
            right={
              <div className="row" style={{ gap: 6 }}>
                {['rgb', 'cyan', 'magenta', 'mint'].map((a) => (
                  <button
                    key={a}
                    onClick={() => {
                      haptic?.('select');
                      s.setAccent(a);
                    }}
                    aria-label={a}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: s.accent === a ? '2px solid var(--text-1)' : '1px solid var(--line)',
                      background:
                        a === 'rgb'
                          ? 'conic-gradient(#00e5ff,#7c4dff,#ff2d95,#00ff9d,#00e5ff)'
                          : a === 'cyan'
                            ? 'linear-gradient(135deg,#00e5ff,#0091ea)'
                            : a === 'magenta'
                              ? 'linear-gradient(135deg,#ff2d95,#d500f9)'
                              : 'linear-gradient(135deg,#00ff9d,#00e5ff)'
                    }}
                  />
                ))}
              </div>
            }
          />
          <Row
            icon={IconInfo}
            label={t('settings.hideBalances')}
            sub={t('settings.hideBalancesSub')}
            right={<Switch on={s.hideBalances} onChange={() => s.toggle('hideBalances')} />}
          />
          <Row
            icon={IconInfo}
            label={t('settings.reduceMotion')}
            sub={t('settings.reduceMotionSub')}
            right={<Switch on={s.reduceMotion} onChange={() => s.toggle('reduceMotion')} />}
          />
          <Row
            icon={IconTrend}
            label={t('settings.compactMode')}
            sub={t('settings.compactModeSub')}
            right={<Switch on={s.compactMode} onChange={() => s.toggle('compactMode')} />}
          />
        </div>
      </motion.section>

      {/* ---------------- trading ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.trading')}</p>
        <div className="set-group">
          <Row
            icon={IconSwap}
            label={t('settings.defaultSlippage')}
            sub={t('settings.defaultSlippageSub')}
            right={
              <select
                value={s.defaultSlippage}
                onChange={(e) => s.setSlippage(e.target.value)}
                style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
              >
                {[0.1, 0.5, 1, 3].map((v) => (
                  <option key={v} value={v}>{v}%</option>
                ))}
              </select>
            }
          />
          <Row
            icon={IconShield}
            label={t('settings.expertMode')}
            sub={t('settings.expertModeSub')}
            right={<Switch on={s.expertMode} onChange={() => s.toggle('expertMode')} />}
          />
          <Row
            icon={IconGlobe}
            label={t('settings.currency')}
            right={
              <select
                value={s.currency}
                onChange={(e) => s.setCurrency(e.target.value)}
                style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
              >
                {['USD', 'EUR', 'IRT', 'AED'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            }
          />
        </div>
      </motion.section>

      {/* ---------------- security ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.security')}</p>
        <div className="set-group">
          <Row
            icon={IconFingerprint}
            label={t('settings.biometric')}
            sub={bioAvailable ? t('settings.biometricSub') : t('settings.biometricUnavailable')}
            right={<Switch on={s.biometricEnabled} onChange={toggleBiometric} />}
          />
          <Row
            icon={IconShield}
            label={t('settings.twoFactor')}
            sub={s.twoFactorEnabled ? t('settings.enabled') : t('settings.twoFactorSub')}
            right={<Switch on={s.twoFactorEnabled} onChange={startTwoFa} />}
          />
          <Row
            icon={IconLock}
            label={t('settings.autoLock')}
            sub={s.autoLockMinutes === 0 ? t('settings.never') : t('settings.afterMinutes', { n: s.autoLockMinutes })}
            right={
              <select
                value={s.autoLockMinutes}
                onChange={(e) => s.setAutoLock(e.target.value)}
                style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
              >
                {[0, 1, 5, 15, 60].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? t('settings.never') : `${m}m`}
                  </option>
                ))}
              </select>
            }
          />
          <Row
            icon={IconKey}
            label={t('settings.txConfirm')}
            sub={t('settings.txConfirmSub')}
            right={<Switch on={s.txConfirmations} onChange={() => s.toggle('txConfirmations')} />}
          />
        </div>
        {bioErr && <p className="notice notice-danger" style={{ marginTop: 8 }}>{t(`settings.bioErr.${bioErr}`)}</p>}
        <p className="notice" style={{ marginTop: 10 }}>{t('settings.securityScope')}</p>
      </motion.section>

      {/* ---------------- sync ---------------- */}
      {firebaseConfigured && (
        <motion.section variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.sync')}</p>
          <div className="set-group">
            <Row
              icon={IconGlobe}
              label={t('settings.cloudSync')}
              sub={s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : t('settings.neverSynced')}
              right={
                <button className="btn btn-sm btn-ghost" onClick={doSync} disabled={syncing}>
                  {syncing ? '…' : t('settings.syncNow')}
                </button>
              }
            />
          </div>
          <p className="faint" style={{ marginTop: 8, lineHeight: 1.7 }}>{t('settings.syncScope')}</p>
        </motion.section>
      )}

      {/* ---------------- about ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.company')}</p>
        <div className="set-group">
          <Row icon={IconInfo} label={t('about.title')} onClick={() => navigate('/about')} />
          <Row icon={IconTelegram} label={t('contact.title')} sub="@Shiravi4333" onClick={() => navigate('/contact')} />
          <Row
            icon={IconTelegram}
            label={t('settings.support')}
            sub={t('settings.supportSub')}
            onClick={() => {
              haptic?.('light');
              const url = 'https://t.me/Shiravi4333';
              if (tg?.openLink) tg.openLink(url);
              else window.open(url, '_blank', 'noopener,noreferrer');
            }}
          />
          <Row icon={IconDoc} label={t('settings.terms')} onClick={() => navigate('/legal/terms')} />
          <Row icon={IconShield} label={t('settings.privacy')} onClick={() => navigate('/legal/privacy')} />
        </div>
      </motion.section>

      <p className="faint" style={{ textAlign: 'center', marginTop: 4 }}>FBT iran · v1.0.0</p>

      {/* ---------------- 2FA sheet ---------------- */}
      <Sheet open={twoFaSheet} onClose={() => setTwoFaSheet(false)} title={t('settings.twoFactorSetup')}>

        {!recovery ? (
          <>
            <p className="muted" style={{ marginBottom: 12 }}>{t('settings.twoFactorHow')}</p>

            <div className="card card-tight">
              <div className="field-label">{t('settings.secretKey')}</div>
              <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--rgb-1)' }}>
                {totpSecret}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 10, width: '100%' }}
                onClick={() => {
                  navigator.clipboard?.writeText(totpSecret);
                  haptic?.('success');
                }}
              >
                {t('common.copy')}
              </button>
              <a
                href={totpUri(totpSecret, s.username || 'wallet')}
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8, width: '100%', display: 'block', textAlign: 'center', textDecoration: 'none' }}
              >
                {t('settings.openInAuthApp')}
              </a>
            </div>

            <label className="field-label" style={{ marginTop: 14 }}>{t('settings.enterCode')}</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={totpInput}
              onChange={(e) => setTotpInput(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 20 }}
            />
            {twoFaErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('settings.badCode')}</p>}

            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              disabled={totpInput.length !== 6}
              onClick={confirmTwoFa}
            >
              {t('settings.verifyEnable')}
            </button>
          </>
        ) : (
          <>
            <p className="notice notice-danger" style={{ marginBottom: 12 }}>{t('settings.recoveryWarning')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {recovery.map((c) => (
                <div
                  key={c}
                  className="mono"
                  style={{ fontSize: 12.5, padding: '9px 10px', borderRadius: 10, background: 'rgba(127,127,127,.1)', textAlign: 'center' }}
                >
                  {c}
                </div>
              ))}
            </div>
            <button
              className="btn btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() => {
                navigator.clipboard?.writeText(recovery.join('\n'));
                haptic?.('success');
              }}
            >
              {t('common.copy')}
            </button>
            <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => setTwoFaSheet(false)}>
              {t('common.done')}
            </button>
          </>
        )}
      </Sheet>
    </PageTransition>
  );
}
