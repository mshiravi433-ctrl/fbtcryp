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
import { langMeta } from '../i18n/languages';
import LanguagePicker from '../components/LanguagePicker';
import UsernameField from '../components/UsernameField';
import {
  getNotifySettings,
  notificationPermission,
  notificationsSupported,
  playSound,
  primeAudio,
  pushConfigured,
  registerPush,
  requestNotificationPermission,
  setNotifySettings,
  vibrate
} from '../lib/notify';
import {
  IconBell,
  IconChevronRight,
  IconFingerprint,
  IconNews,
  IconVibrate,
  IconVolume,
  IconGlobe,
  IconInfo,
  IconTelegram,
  IconSettings as IconSettings2,
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
  // The knob is positioned with `inset-inline-start`, which flips sides in
  // RTL — but `x` is a physical transform that always moves right. In Persian
  // the knob therefore started at the right edge and slid further right, out
  // of the track. Travel must follow the writing direction.
  const rtl = typeof document !== 'undefined' && document.documentElement.getAttribute('dir') === 'rtl';
  const travel = rtl ? -19 : 19;

  return (
    <button className="switch" data-on={on} onClick={onChange} type="button" role="switch" aria-checked={on}>
      <motion.span
        className="switch-knob"
        animate={{ x: on ? travel : 0 }}
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
  const [rpcSheet, setRpcSheet] = useState(false);
  const [rpcDraft, setRpcDraft] = useState('');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioErr, setBioErr] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);

  // Notification prefs live outside the zustand store on purpose: lib/notify
  // is also called from a service worker context and from module scope before
  // React mounts, so localStorage is the only shared surface both can use.
  const [notif, setNotif] = useState(() => getNotifySettings());
  const [perm, setPerm] = useState(() => notificationPermission());

  useEffect(() => {
    platformAuthenticatorAvailable().then(setBioAvailable);
  }, []);

  const patchNotif = (patch) => setNotif(setNotifySettings(patch));

  const askPermission = async () => {
    const result = await requestNotificationPermission();
    setPerm(result);
    if (result === 'granted' && pushConfigured()) await registerPush();
  };

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
          {/* Display name — the label next to your score on the leaderboard.
              Not an account, no password, nothing reserved. */}
          <Row
            icon={IconUser}
            label={t('profile.username')}
            sub={s.username || t('profile.usernameUnset')}
            onClick={() => setNameOpen(true)}
          />
          {/* Twelve languages no longer fit in an inline three-button strip,
              so this opens the same picker the welcome screen uses. */}
          <Row
            icon={IconGlobe}
            label={t('settings.language')}
            sub={`${langMeta(i18n.language).flag} ${langMeta(i18n.language).endonym}`}
            onClick={() => setLangOpen(true)}
          />
        </div>
      </motion.section>

      {/* ---------------- notifications & feedback ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('notify.title')}</p>
        <div className="set-group">
          {/* Sound. Tapping the row plays the chime, because a toggle whose
              effect you only discover during a real trade is untestable. */}
          <Row
            icon={IconVolume}
            label={t('notify.sound')}
            sub={t('notify.soundSub')}
            right={
              <Switch
                on={notif.sound}
                onChange={() => {
                  const next = !notif.sound;
                  patchNotif({ sound: next });
                  if (next) {
                    primeAudio();
                    setTimeout(() => playSound('success'), 60);
                  }
                }}
              />
            }
          />
          <Row
            icon={IconVibrate}
            label={t('notify.vibrate')}
            sub={t('notify.vibrateSub')}
            right={
              <Switch
                on={notif.vibrate}
                onChange={() => {
                  const next = !notif.vibrate;
                  patchNotif({ vibrate: next });
                  if (next) vibrate([40, 60, 40], haptic);
                }}
              />
            }
          />
          <Row
            icon={IconBell}
            label={t('notify.tradeAlerts')}
            sub={t('notify.tradeAlertsSub')}
            right={<Switch on={notif.tradeAlerts} onChange={() => patchNotif({ tradeAlerts: !notif.tradeAlerts })} />}
          />
          <Row
            icon={IconBell}
            label={t('notify.daily')}
            sub={t('notify.dailySub')}
            right={<Switch on={notif.dailyPromo} onChange={() => patchNotif({ dailyPromo: !notif.dailyPromo })} />}
          />
          <Row
            icon={IconNews}
            label={t('notify.news')}
            sub={t('notify.newsSub')}
            right={<Switch on={notif.news} onChange={() => patchNotif({ news: !notif.news })} />}
          />

          {/* Permission state, described exactly as it is. */}
          {!notificationsSupported() ? (
            <Row icon={IconInfo} label={t('notify.permission')} sub={t('notify.unsupported')} />
          ) : perm === 'granted' ? (
            <Row
              icon={IconInfo}
              label={t('notify.permission')}
              sub={pushConfigured() ? t('notify.pushOn') : t('notify.pushLocal')}
              right={<span className="pill pill-up">{t('notify.permissionGranted')}</span>}
            />
          ) : perm === 'denied' ? (
            <Row icon={IconInfo} label={t('notify.permission')} sub={t('notify.permissionDenied')} />
          ) : (
            <Row
              icon={IconBell}
              label={t('notify.permission')}
              sub={t('notify.dailySub')}
              onClick={askPermission}
              right={<span className="pill pill-rgb">{t('notify.permissionAsk')}</span>}
            />
          )}
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

      {/* ---------------- networks ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.networks')}</p>
        <div className="set-group">
          <Row
            icon={IconGlobe}
            label={t('settings.testnet')}
            sub={s.testnetMode ? t('settings.testnetOn') : t('settings.testnetOff')}
            right={<Switch on={s.testnetMode} onChange={() => s.toggle('testnetMode')} />}
          />
          <Row
            icon={IconKey}
            label={t('settings.evmNetwork')}
            sub={t('settings.evmNetworkSub')}
            right={
              <select
                value={s.evmChainId}
                onChange={(e) => s.setEvmChain(e.target.value)}
                style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
              >
                <option value={56}>BSC</option>
                <option value={1}>Ethereum</option>
                <option value={137}>Polygon</option>
                <option value={42161}>Arbitrum</option>
                <option value={8453}>Base</option>
              </select>
            }
          />
          <Row
            icon={IconGlobe}
            label={t('settings.solana')}
            sub={t('settings.solanaSub')}
            right={
              <select
                value={s.solanaCluster}
                onChange={(e) => s.setSolanaCluster(e.target.value)}
                style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
              >
                <option value="mainnet-beta">Mainnet</option>
                <option value="devnet">Devnet</option>
              </select>
            }
          />
          <Row
            icon={IconSettings2}
            label={t('settings.customRpc')}
            sub={s.customEvmRpc || t('settings.customRpcSub')}
            onClick={() => setRpcSheet(true)}
          />
        </div>
        {s.testnetMode && <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('settings.testnetWarn')}</p>}
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

      <p className="faint" style={{ textAlign: 'center', marginTop: 4 }}>{t('about.companyFull')} · v1.0.0</p>

      {/* ---------------- custom RPC ---------------- */}
      <Sheet open={rpcSheet} onClose={() => setRpcSheet(false)} title={t('settings.customRpc')}>
        <p className="muted" style={{ fontSize: 12.3 }}>{t('settings.customRpcHelp')}</p>
        <label className="field-label" style={{ marginTop: 11 }}>EVM RPC</label>
        <input
          type="text"
          value={rpcDraft || s.customEvmRpc}
          onChange={(e) => setRpcDraft(e.target.value)}
          placeholder="https://bsc-dataseed.binance.org"
          style={{ fontSize: 13 }}
        />
        <label className="field-label" style={{ marginTop: 11 }}>Solana RPC</label>
        <input
          type="text"
          defaultValue={s.solanaRpc}
          onChange={(e) => s.setRpc('solanaRpc', e.target.value)}
          placeholder="https://api.mainnet-beta.solana.com"
          style={{ fontSize: 13 }}
        />
        <p className="notice" style={{ marginTop: 11 }}>{t('settings.rpcWarn')}</p>
        <button
          className="btn btn-primary"
          style={{ marginTop: 11 }}
          onClick={() => {
            if (rpcDraft) s.setRpc('customEvmRpc', rpcDraft);
            setRpcSheet(false);
            haptic?.('success');
          }}
        >
          {t('common.confirm')}
        </button>
      </Sheet>

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
      <Sheet open={nameOpen} onClose={() => setNameOpen(false)} title={t('profile.username')}>
        <UsernameField autoFocus />
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setNameOpen(false)}>
          {t('common.done')}
        </button>
      </Sheet>

      <Sheet open={langOpen} onClose={() => setLangOpen(false)} title={t('common.language')}>
        <LanguagePicker onPick={() => setLangOpen(false)} />
      </Sheet>
    </PageTransition>
  );
}
