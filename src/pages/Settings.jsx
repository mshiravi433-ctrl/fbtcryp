import { useEffect, useMemo, useState } from 'react';

/*
 * The footer read a hardcoded 'v1.0.0' while the app shipped 1.5.x — a version
 * string nobody updates is worse than none, because a bug report quoting it
 * points at the wrong build.
 */
/*
 * The `typeof` guard matters: test harnesses bundle with their own vite
 * configs that do not carry our `define`, so a bare `__APP_VERSION__` threw
 * "ReferenceError: __APP_VERSION__ is not defined" and crashed the whole app
 * at boot. lib/features.js already guards __GAMES_ENABLED__ the same way for
 * exactly this reason - I should have followed that pattern first time.
 */
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Switch from '../components/Switch';
import Sheet from '../components/Sheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppStore } from '../store/useAppStore';
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
import { CURRENCIES, currencyOf } from '../lib/currency';
import LanguagePicker from '../components/LanguagePicker';
import UsernameField from '../components/UsernameField';
import ProfileBadge from '../components/ProfileBadge';
import {
  getNotifySettings,
  notificationPermission,
  notificationsSupported,
  playSound,
  primeAudio,
  pushMode,
  pushReallySubscribed,
  registerPushAnywhere,
  requestNotificationPermission,
  setNotifySettings,
  vibrate
} from '../lib/notify';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../lib/contact';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../lib/chains';
import { isIOS, isWebView, isStandalone } from '../lib/platform';
import { clearAppCache, exportSettingsBackup } from '../lib/dataStorage';
/* Phase 92 — export, delete, and prove the deletion. */
import {
  exportUserData, deleteUserData, verifyDeletion, DATA_STORES,
  availabilityMap, assertFeaturePermitted
} from '../lib/intent-ai';
/* Phase 100 — user sovereignty: take everything and leave, proven empty. */
import { describeExitPath, buildExitPackage, performExit } from '../lib/intent-ai';
import { buildReaders, buildErasers, localUserId, forgetLocalUserId } from '../lib/userDataStores';
import {
  IconBell,
  IconClock,
  IconSparkle,
  IconCopy,
  IconChevronRight,
  IconFingerprint,
  IconNews,
  IconVibrate,
  IconVolume,
  IconGlobe,
  IconInfo,
  IconMail,
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

/*
 * Region acknowledgements live in localStorage, not the settings store: they
 * are a per-device record of a decision the person made here, never something
 * to sync to another phone or to a cloud profile. A malformed record degrades
 * to "nothing acknowledged", which is the strict reading — the same direction
 * every fail-closed path in this file takes.
 */
/*
 * "27/08/2026, 0" — a raw `toLocaleString()` wedged into a narrow row reads as
 * a truncated, broken value. Two-digit, fixed-length, and the same shape in
 * every locale so the row cannot reflow when the language changes.
 */
function fmtSyncedAt(ts) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

const REGION_ACK_KEY = 'fbt-region-ack-v1';

function loadRegionAcks() {
  try {
    const raw = localStorage.getItem(REGION_ACK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveRegionAcks(acks) {
  try { localStorage.setItem(REGION_ACK_KEY, JSON.stringify(acks)); } catch { /* storage full/blocked */ }
}

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
  /* The outcome of the last sync attempt. Null until one has been made. */
  const [syncResult, setSyncResult] = useState(null);
  const [langOpen, setLangOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);

  /*
   * Phase 92 — "My data". `deleteOpen` gates the irreversible action behind an
   * explicit confirmation dialog; `deleteProof` holds the verified receipt,
   * which is only ever set from `verifyDeletion` after every store has been
   * read back. It is never set optimistically: no proof, no proof shown.
   */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteProof, setDeleteProof] = useState(null);
  const [deleteProblem, setDeleteProblem] = useState(null);

  /*
   * Phase 100 — user sovereignty, the last phase. One explicit confirmation,
   * no fee, no waiting period; the package is built BEFORE anything is erased,
   * and the receipt is only shown after every store has been read back empty.
   */
  const [exitOpen, setExitOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitReceipt, setExitReceipt] = useState(null);
  const [exitProblem, setExitProblem] = useState(null);
  const exitPath = useMemo(() => describeExitPath(), []);

  /*
   * Phase 87 — what is actually available where this person is.
   *
   * The region comes from the browser's own locale, which is a hint and not a
   * legal determination — so when it yields nothing recognisable, `featureState`
   * falls back to the STRICTEST policy rather than the most permissive, and the
   * map says out loud that the region could not be determined. Nothing here
   * grants a feature; it can only ever show one as restricted or blocked.
   */
  const regionMap = useMemo(() => {
    let region = null;
    try {
      const tag = typeof navigator !== 'undefined' ? (navigator.language || '') : '';
      const parts = String(tag).split('-');
      region = parts.length > 1 ? parts[parts.length - 1] : null;
    } catch {
      region = null;
    }
    return availabilityMap({ region });
  }, []);

  /*
   * ─── THE EXTRA CONFIRMATION A RESTRICTED FEATURE PROMISES ─────────────────
   * Reported: «خودکارسازی — در اینجا با یک تایید اضافه در دسترس است» sitting
   * next to a «محدود» badge with nothing to press. `featureState` had been
   * returning `requiresAcknowledgement: true` for months and
   * `assertFeaturePermitted` had been accepting `acknowledged: true` — the
   * gate was built, and the screen simply never offered the acknowledgement.
   *
   * So the map now renders what the gate already honours: a restricted feature
   * gets a real confirm action, and once acknowledged the row reads as
   * permitted-with-extra-confirmation because that is literally what
   * `assertFeaturePermitted` returns for it.
   *
   * Two rules kept from the lib, on purpose:
   *   · this can only UNLOCK what policy already allows. `assertGateOnlyRestricts`
   *     is the invariant — geo-gating may only ever subtract, so no amount of
   *     acknowledging here turns a blocked feature into an available one.
   *   · an acknowledgement is recorded with the time it was given and can be
   *     withdrawn, so it is a decision with a visible state, not a permanent
   *     grant buried in localStorage.
   */
  const [regionAcks, setRegionAcks] = useState(() => loadRegionAcks());
  const [ackFeature, setAckFeature] = useState(null);

  const regionRows = useMemo(() => regionMap.features.map((feature) => {
    const ack = regionAcks[feature.feature] || null;
    const verdict = assertFeaturePermitted({
      feature: feature.feature,
      region: regionMap.region,
      acknowledged: Boolean(ack)
    });
    return {
      ...feature,
      ack,
      permitted: verdict.permitted === true,
      restricted: verdict.restricted === true,
      needsAck: feature.state === 'restricted' && !ack
    };
  }), [regionMap, regionAcks]);

  const acknowledgeFeature = (feature) => {
    const next = { ...regionAcks, [feature]: { at: Date.now() } };
    setRegionAcks(next);
    saveRegionAcks(next);
    setAckFeature(null);
    haptic?.('success');
  };

  const withdrawFeature = (feature) => {
    const next = { ...regionAcks };
    delete next[feature];
    setRegionAcks(next);
    saveRegionAcks(next);
  };

  /*
   * One-time telemetry prompt state. localStorage (not the store) because it
   * is a per-device "have I seen this line" bit, never synced anywhere.
   */
  const [telemetryPromptVisible, setTelemetryPromptVisible] = useState(() => {
    try {
      return !localStorage.getItem('fbt-telemetry-prompt-seen');
    } catch {
      return false;
    }
  });
  const dismissTelemetryPrompt = () => {
    setTelemetryPromptVisible(false);
    try {
      localStorage.setItem('fbt-telemetry-prompt-seen', '1');
    } catch {
      /* private mode: the prompt shows again next session — harmless */
    }
  };

  // Notification prefs live outside the zustand store on purpose: lib/notify
  // is also called from a service worker context and from module scope before
  // React mounts, so localStorage is the only shared surface both can use.
  const [notif, setNotif] = useState(() => getNotifySettings());
  const [perm, setPerm] = useState(() => notificationPermission());
  // 'server' | 'local' | 'unsupported'. Resolved from the API, not from a
  // build flag, so we never promise push the backend cannot actually send.
  const [pmode, setPmode] = useState('local');

  useEffect(() => {
    pushMode().then(setPmode);
  }, []);

  useEffect(() => {
    platformAuthenticatorAvailable().then(setBioAvailable);
  }, []);

  const patchNotif = (patch) => setNotif(setNotifySettings(patch));

  const iosNeedPin = isIOS() && !isStandalone() && !isWebView() && typeof window !== 'undefined' && !window.Capacitor?.isNativePlatform?.();
  const iosInWebView = isIOS() && isWebView();

  const askPermission = async () => {
    if (iosInWebView) return; // in-app browsers on iOS can't grant push
    const result = await requestNotificationPermission();
    setPerm(result);
    if (result !== 'granted') return;

    const mode = await pushMode(true);
    setPmode(mode);

    try {
      const reg = await registerPushAnywhere();
      if (reg?.ok === false && reg.reason === 'IOS_NEEDS_PIN') {
        setPmode('local');
      }
    } catch (e) {
      console.warn('Push registration failed:', e);
    }
  };

  // Auto-register push when permission is already granted (on app open)
  useEffect(() => {
    if (perm === 'granted' && pmode === 'server' && !iosInWebView && !iosNeedPin) {
      registerPushAnywhere().catch(() => {});
    }
  }, [perm, pmode, iosInWebView, iosNeedPin]);

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
    /*
     * The Earn screen advertises "+60, enable 2FA" and nothing ever marked it
     * done. Fired here, after the code has been VERIFIED — enabling on an
     * unverified secret would lock the user out and still pay them for it.
     */
    useAppStore.getState().completeQuest('enable2fa');
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

  /*
   * Phase 92 — export everything we hold, as a file the user keeps.
   *
   * `exportUserData` refuses a partial export rather than handing over
   * something that looks complete but is not, so an unreadable store here
   * produces an honest error toast and no download at all.
   */
  const doExportMyData = async () => {
    haptic?.('light');
    try {
      const result = await exportUserData({ userId: localUserId(), readers: buildReaders() });
      if (!result.ok || !result.complete) {
        useAppStore.getState().notify('toast.error', 'error');
        return;
      }
      const payload = JSON.stringify(
        {
          _type: 'fbt-my-data-export',
          _version: 1,
          exportedAt: result.at,
          checksum: result.checksum,
          stores: result.data
        },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fbt-my-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      useAppStore.getState().notify('settingsBackedUp', 'success');
    } catch {
      useAppStore.getState().notify('toast.error', 'error');
    }
  };

  /*
   * Phase 92 — delete, then PROVE it. The confirmation flag is passed
   * explicitly (`deleteUserData` refuses without it), and the receipt is only
   * rendered once `verifyDeletion` has re-read every store and found them
   * empty. An unproven or partial deletion shows what remains instead of a
   * green tick.
   */
  const doDeleteMyData = async () => {
    setDeleteBusy(true);
    setDeleteProblem(null);
    try {
      const userId = localUserId();
      const deletion = await deleteUserData({ userId, erasers: buildErasers(), confirmed: true });
      const verification = await verifyDeletion({ userId, readers: buildReaders(), deletion });
      if (verification.proven && deletion.complete) {
        // The local id goes last, so a wipe cannot be linked to what came before.
        forgetLocalUserId();
        setDeleteProof(verification.receipt);
        setDeleteOpen(false);
        haptic?.('success');
        useAppStore.getState().notify('cacheCleared', 'success');
        return;
      }
      setDeleteProof(null);
      setDeleteProblem({
        i18nKey: verification.proven ? deletion.i18nKey : verification.i18nKey,
        leftovers: [...(verification.leftovers || []), ...(verification.unverifiable || [])].map((l) => l.store)
      });
      haptic?.('error');
    } catch {
      setDeleteProof(null);
      setDeleteProblem({ i18nKey: 'intentAI.lifecycle.deleteFailed', leftovers: [] });
      haptic?.('error');
    } finally {
      setDeleteBusy(false);
    }
  };

  /*
   * Phase 100 — prepare the take-everything package. `buildExitPackage` is
   * complete-or-refused, so a hole in any store means no download at all
   * rather than a partial file that pretends to be the whole truth.
   */
  const doPrepareExit = async () => {
    haptic?.('light');
    try {
      const pkg = await buildExitPackage({ userId: localUserId(), readers: buildReaders() });
      if (!pkg.ok || !pkg.complete) {
        setExitProblem({ i18nKey: pkg.i18nKey || 'intentAI.sovereignty.exportIncomplete', params: { missing: (pkg.failedStores || []).length } });
        return;
      }
      const payload = JSON.stringify({
        _type: 'fbt-sovereignty-exit',
        _version: 1,
        schema: pkg.schema,
        exportedAt: pkg.payload.exportedAt,
        checksum: pkg.checksum,
        stores: pkg.payload.stores,
        data: pkg.payload.data
      }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fbt-my-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setExitProblem(null);
      useAppStore.getState().notify('settingsBackedUp', 'success');
    } catch {
      setExitProblem({ i18nKey: 'intentAI.sovereignty.exportFailed' });
    }
  };

  /*
   * Phase 100 — leave. The package is built first (you cannot lose data on
   * the way out), then everything is erased, then the erasure is verified by
   * reading every store back. The receipt only exists when nothing remains.
   */
  const doPerformExit = async () => {
    setExitBusy(true);
    setExitProblem(null);
    try {
      const exit = await performExit({
        userId: localUserId(),
        readers: buildReaders(),
        erasers: buildErasers(),
        confirmed: true
      });
      if (exit.exited && exit.receipt) {
        forgetLocalUserId();
        setExitReceipt(exit.receipt);
        setExitOpen(false);
        haptic?.('success');
        useAppStore.getState().notify('cacheCleared', 'success');
        return;
      }
      setExitReceipt(null);
      setExitProblem({
        i18nKey: exit.i18nKey || 'intentAI.sovereignty.exitIncomplete',
        params: exit.i18nParams || { remaining: (exit.leftovers || []).length + (exit.unverifiable || []).length }
      });
      haptic?.('error');
    } catch {
      setExitReceipt(null);
      setExitProblem({ i18nKey: 'intentAI.sovereignty.exitFailed' });
      haptic?.('error');
    } finally {
      setExitBusy(false);
    }
  };

  /*
   * ─── CLOUD SYNC USED TO CLAIM SUCCESS WITHOUT CHECKING ────────────────────
   * Reported: «همگام‌سازی ابری 27/08/2026, 0 — اصلا کار نمیده و فقط دکمش هست».
   *
   * `pushSettings` returns a BOOLEAN and the old handler threw it away, then
   * called `markSynced()` unconditionally. So the row showed a fresh "last
   * synced" timestamp after a sync that had failed — anonymous sign-in
   * refused, Firestore rules rejecting the write, no network, any of them. The
   * timestamp was not evidence that anything had been saved; it was evidence
   * that a button had been pressed.
   *
   * The push result is now the thing that decides. And the row's sub-line says
   * which of the two it is, because "3 hours ago" and "never — it failed" must
   * not look alike on a screen whose whole job is trust.
   */
  const doSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const remote = await pullSettings();
      if (remote) s.applyRemote(remote);
      const pushed = await pushSettings(s.exportSyncable());
      if (pushed !== true) {
        setSyncResult({ ok: false, code: 'PUSH_REJECTED' });
        haptic?.('error');
        return;
      }
      s.markSynced();
      setSyncResult({ ok: true, at: Date.now(), pulled: Boolean(remote) });
      haptic?.('success');
    } catch (e) {
      setSyncResult({ ok: false, code: String(e?.code || e?.message || 'SYNC_FAILED').slice(0, 60) });
      haptic?.('error');
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

      {/* ---------------- modern settings hero / status banner ---------------- */}
      <motion.section
        className="card settings-hero"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, marginBottom: 16, position: 'relative', overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(500px 180px at 20% 0%, rgba(0,229,255,0.12), transparent 70%), radial-gradient(400px 160px at 90% 100%, rgba(124,77,255,0.10), transparent 70%)', pointerEvents: 'none' }} />
        <div className="row-between" style={{ position: 'relative', gap: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            {/* Brand logo in an animated ring; flips to a bell when unread
                notifications exist — see components/ProfileBadge.jsx. */}
            <ProfileBadge />
            <div>
              <div style={{ fontWeight: 900, fontSize: 15 }}>
                {s.username || t('profile.usernameUnset')}
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                {wallet.address ? shortAddress(wallet.address) : t('settings.noWallet')}
              </div>
            </div>
          </div>

          <div className="row settings-quick-actions" style={{ gap: 8 }}>
            <button
              className="btn btn-sm btn-ghost settings-quick-action"
              onClick={() => {
                haptic?.('light');
                s.setTheme(s.theme === 'dark' ? 'light' : 'dark');
              }}
              title={t('settings.theme')}
            >
              {s.theme === 'dark' ? '🌙' : '☀️'}
            </button>
            <button
              className="btn btn-sm btn-ghost settings-quick-action"
              onClick={() => {
                haptic?.('light');
                s.toggle('hideBalances');
              }}
              title={t('settings.hideBalances')}
            >
              {s.hideBalances ? '👁️‍🗨️' : '👁️'}
            </button>
          </div>
        </div>

        {/* Status badges row */}
        <div className="row settings-status-pills" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap', position: 'relative' }}>
          <span className="pill pill-rgb" style={{ fontSize: 11, fontWeight: 700 }}>
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: EVM_CHAINS[wallet.chainId ?? s.evmChainId]?.color || 'var(--rgb-1)',
                marginRight: 5
              }}
            />
            {EVM_CHAINS[wallet.chainId ?? s.evmChainId]?.short || 'EVM'}
          </span>
          <span className="pill" style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)' }}>
            ⚡ {t('swap.slippage')}: {s.defaultSlippage}%
          </span>
          <span className="pill" style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)' }}>
            ⏱ {s.defaultDeadlineMin || 20} {t('settings.minutesShort', 'min')}
          </span>
          {s.twoFactorEnabled && (
            <span className="pill pill-up" style={{ fontSize: 11 }}>
              🔒 2FA
            </span>
          )}
          {s.biometricEnabled && (
            <span className="pill pill-up" style={{ fontSize: 11 }}>
              🛡️ Bio
            </span>
          )}
        </div>
      </motion.section>

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
          {/* Display name — how the app greets you. Stays on the device now
              that the public board is gone. Not an account, no password. */}
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
            sub={pmode === 'server' ? t('notify.dailySub') : t('notify.dailySubLocal')}
            right={<Switch on={notif.dailyPromo} onChange={() => patchNotif({ dailyPromo: !notif.dailyPromo })} />}
          />
          <Row
            icon={IconNews}
            label={t('notify.news')}
            sub={t('notify.newsSub')}
            right={<Switch on={notif.news} onChange={() => patchNotif({ news: !notif.news })} />}
          />

          {/* iOS-specific guidance: Apple only allows push for pinned PWAs */}
          {(iosNeedPin || iosInWebView) && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 6, marginBottom: 4 }}>
              <InfoBox title="اعلان‌ها در آیفون" tone="warn" id="ios-notify">
                <p style={{ fontSize: 12.5, lineHeight: 1.85, margin: 0 }}>
                  {iosInWebView ? t('notify.iosWebView') : t('notify.iosNeedPin')}
                </p>
              </InfoBox>
            </motion.div>
          )}

          {/* Permission state, described exactly as it is. */}
          {!notificationsSupported() ? (
            <Row icon={IconInfo} label={t('notify.permission')} sub={t('notify.unsupported')} />
          ) : perm === 'granted' ? (
            <Row
              icon={IconInfo}
              label={t('notify.permission')}
              sub={pmode === 'server' && pushReallySubscribed() ? t('notify.pushOn') : t('notify.pushLocal')}
              right={
                <span className={`pill ${pmode === 'server' && pushReallySubscribed() ? 'pill-up' : 'pill-rgb'}`}>
                  {pmode === 'server' && pushReallySubscribed() ? t('notify.modeServer') : t('notify.modeLocal')}
                </span>
              }
            />
          ) : perm === 'denied' ? (
            <Row icon={IconInfo} label={t('notify.permission')} sub={t('notify.permissionDenied')} />
          ) : (
            <Row
              icon={IconBell}
              label={t('notify.permission')}
              sub={iosNeedPin || iosInWebView ? t('notify.iosNeedPin') : t('notify.dailySub')}
              onClick={iosNeedPin || iosInWebView ? undefined : askPermission}
              right={iosNeedPin || iosInWebView
                ? <span className="pill" style={{ background: 'rgba(255,179,0,.15)', color: '#ffb300' }}>iOS</span>
                : <span className="pill pill-rgb">{t('notify.permissionAsk')}</span>}
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
              <div className="row settings-accent-picker" style={{ gap: 6 }}>
                {['rgb', 'pastel', 'cyan', 'magenta', 'mint'].map((a) => (
                  <button
                    key={a}
                    className="settings-accent-option"
                    onClick={() => {
                      haptic?.('select');
                      s.setAccent(a);
                    }}
                    aria-label={a}
                    style={{
                      cursor: 'pointer',
                      border: s.accent === a ? '2px solid var(--text-1)' : '1px solid var(--line)',
                      background:
                        a === 'rgb'
                          ? 'conic-gradient(#00e5ff,#7c4dff,#ff2d95,#00ff9d,#00e5ff)'
                          : a === 'pastel'
                            ? 'conic-gradient(#7fd8e8,#b3a4f5,#f5a3c7,#8fe3c2,#7fd8e8)'
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
            icon={IconClock}
            label={t('settings.defaultDeadline')}
            sub={t('settings.defaultDeadlineSub')}
            right={
              <select
                value={s.defaultDeadlineMin || 20}
                onChange={(e) => s.setDefaultDeadlineMin(Number(e.target.value))}
                style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
              >
                {[5, 10, 20, 30, 60].map((v) => (
                  <option key={v} value={v}>
                    {v} {t('settings.minutesShort', 'min')}
                  </option>
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
              /*
                IRT is gone: no price feed we use quotes Iranian rial, so it
                could only ever have been a rial label over a dollar number -
                the most dangerous kind of wrong on a money screen.
                
                currencyOf() maps any stored legacy value (including 'IRT')
                back to USD, so existing installs do not render a blank
                selection after upgrading.
              */
              <select
                value={currencyOf(s.currency).code}
                onChange={(e) => s.setCurrency(e.target.value)}
                style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code}</option>
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
            icon={IconKey}
            label={t('nav.smartWallet')}
            sub={t('smart.enableSub')}
            onClick={() => navigate('/smart-wallet')}
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
          {/*
            "Confirm every transaction" was removed rather than wired.

            It was dead — txConfirmations was read nowhere — and it is also the
            exact inverse of Expert mode, which now really does control whether
            the review step is skipped. Keeping both would be two switches
            fighting over one behaviour, and the losing one would look broken.
            One control, and it works.
          */}
        </div>
        {bioErr && <p className="notice notice-danger" style={{ marginTop: 8 }}>{t(`settings.bioErr.${bioErr}`)}</p>}
        <InfoBox title={t('settings.securityScopeTitle')} tone="warn" id="set-scope">
          <p>{t('settings.securityScope')}</p>
        </InfoBox>
      </motion.section>

      {/* ---------------- privacy ---------------- */}
      {/*
        The learning core is STRICTLY opt-in. Everything the model can learn
        is explained inside the collapsed box; the switch lives inside it, so
        nobody enables it without having read what it shares. The record
        carries no address, key, IP or user id — see lib/learning.js.
      */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.privacySection')}</p>
        <div className="set-group">
          {/*
            One-time prompt — a quiet inline line inside the privacy box,
            NEVER a modal on first open. Dismissed forever with one tap;
            stored in localStorage so it survives the session but is not
            synced (the prompt is about this device's choice).
          */}
          {telemetryPromptVisible && !s.contributeTelemetry && (
            /*
             * The prompt is a quiet inline line, never a modal. The text runs
             * FULL-WIDTH below a small corner `×`, so a long Persian sentence
             * wraps as a normal paragraph instead of being squeezed into a
             * narrow flex column next to the close button (which is what made
             * the box grow tall and the words break one under another).
             */
            <div
              style={{
                position: 'relative',
                padding: '11px 13px',
                marginBottom: 8,
                borderRadius: 12,
                border: '1px solid var(--line)',
                background: 'var(--bg-raised)'
              }}
            >
              <p
                className="faint"
                style={{ fontSize: 11.5, lineHeight: 1.85, margin: 0, paddingInlineEnd: 26, textWrap: 'pretty' }}
              >
                {t('settings.telemetryPrompt')}
              </p>
              <button
                type="button"
                aria-label={t('common.close')}
                title={t('common.close')}
                onClick={dismissTelemetryPrompt}
                style={{
                  position: 'absolute',
                  top: 7,
                  insetInlineEnd: 7,
                  width: 26,
                  height: 26,
                  display: 'grid',
                  placeItems: 'center',
                  padding: 0,
                  border: 'none',
                  borderRadius: 8,
                  background: 'transparent',
                  color: 'var(--text-3)',
                  fontSize: 17,
                  lineHeight: 1,
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
          )}
          <InfoBox title={t('settings.telemetryTitle')} tone="info" id="set-telemetry">
            <p>{t('settings.telemetryBody')}</p>
            <div className="set-row" style={{ marginTop: 6 }}>
              <span className="set-row-label">
                <div>{t('settings.contributeTelemetry')}</div>
                <div className="set-row-sub">{t('settings.contributeTelemetrySub')}</div>
              </span>
              <Switch
                on={s.contributeTelemetry}
                onChange={() => s.setContributeTelemetry(!s.contributeTelemetry)}
                label={t('settings.contributeTelemetry')}
              />
            </div>
            <p className="faint" style={{ marginTop: 10, lineHeight: 1.7, fontSize: 11.5 }}>
              {t('settings.telemetryNote')}
            </p>
          </InfoBox>

          <p className="faint" style={{ marginTop: 10, lineHeight: 1.7, fontSize: 11.5, padding: '0 2px' }}>
            {t('settings.walletPrivacyLine')}
          </p>
        </div>
      </motion.section>

      {/* ---------------- networks ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.networks')}</p>
        <div className="set-group">
          {/*
            THE TESTNET TOGGLE WAS REMOVED, NOT FIXED.

            It rendered "Using test networks — funds are not real" while
            `testnetMode` was read by nothing: every quote, every signature and
            every swap stayed on mainnet with real money. A switch that tells
            someone their funds are fake, while they are not, is the most
            dangerous control this app could ship.

            Building it properly means testnet RPCs, testnet router addresses
            and testnet token lists for nine EVM chains — real work, and worth
            doing only if someone asks. Until then, showing nothing is honest
            and showing the switch is not.
          */}
          <Row
            icon={IconKey}
            label={t('settings.evmNetwork')}
            sub={t('settings.evmNetworkSub')}
            right={
              <select
                value={wallet.chainId ?? s.evmChainId}
                /*
                 * Switches the LIVE chain, not just a stored number.
                 *
                 * This used to only call setEvmChain(), and nothing read
                 * evmChainId — the Swap screen takes its chain from
                 * wallet.chainId. So picking "Ethereum" here changed a value
                 * in storage and left every swap on BNB Chain.
                 */
                onChange={async (e) => {
                  const id = Number(e.target.value);
                  s.setEvmChain(id);
                  haptic?.('select');
                  await wallet.switchChain?.(id);
                }}
                style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }}
              >
                {EVM_CHAIN_ORDER.map((id) => {
                  const c = EVM_CHAINS[id];
                  if (!c) return null;
                  return (
                    <option key={id} value={id}>
                      {c.name} ({c.short})
                    </option>
                  );
                })}
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
      </motion.section>

      {/* ---------------- data & storage ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.dataStorage')}</p>
        <div className="set-group">
          <Row
            icon={IconSparkle}
            label={t('settings.clearCache')}
            sub={t('settings.clearCacheSub')}
            right={
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  haptic?.('light');
                  clearAppCache();
                  useAppStore.getState().notify('cacheCleared', 'success');
                }}
              >
                {t('settings.clear')}
              </button>
            }
          />
          <Row
            icon={IconCopy}
            label={t('settings.backupSettings')}
            sub={t('settings.backupSettingsSub')}
            right={
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  haptic?.('light');
                  try {
                    await exportSettingsBackup();
                    useAppStore.getState().notify('settingsBackedUp', 'success');
                  } catch (e) {
                    useAppStore.getState().notify('toast.error', 'error');
                  }
                }}
              >
                {t('settings.backup')}
              </button>
            }
          />
        </div>
        <p className="faint" style={{ marginTop: 8, lineHeight: 1.7 }}>
          {t('settings.dataStorageNote')}
        </p>
      </motion.section>

      {/* ---------------- phase 92: my data — in an expandable box ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show" data-testid="my-data-section">
        <InfoBox title={t('intentAI.lifecycle.title')} tone="info" id="set-my-data">
          <p className="muted" style={{ fontSize: 12.3, margin: '0 0 8px', lineHeight: 1.7 }}>
            {t('intentAI.lifecycle.subtitle')}
          </p>
          <div className="set-group">
            <Row
              icon={IconDoc}
              label={t('intentAI.lifecycle.exportDownload')}
              sub={t('intentAI.lifecycle.subtitle')}
              right={
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={doExportMyData}
                  data-testid="my-data-export"
                >
                  {t('intentAI.lifecycle.exportAction')}
                </button>
              }
            />
            <Row
              icon={IconShield}
              label={t('intentAI.lifecycle.deleteTitle')}
              sub={t('intentAI.lifecycle.deleteBody')}
              right={
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => { haptic?.('light'); setDeleteProblem(null); setDeleteOpen(true); }}
                  data-testid="my-data-delete"
                >
                  {t('intentAI.lifecycle.deleteAction')}
                </button>
              }
            />
          </div>

          {/* The proof, shown only after every store was read back and was empty. */}
          {deleteProof && (
            <div className="card card-tight" style={{ marginTop: 10 }} data-testid="deletion-proof">
              <div className="field-label">{t('intentAI.lifecycle.proofTitle')}</div>
              <p className="muted" style={{ fontSize: 12.3, margin: '4px 0 0', lineHeight: 1.7 }}>
                {t('intentAI.lifecycle.proofStores', { stores: deleteProof.stores })}
              </p>
              <p className="mono faint" style={{ fontSize: 11.5, margin: '6px 0 0', wordBreak: 'break-all' }}>
                {t('intentAI.lifecycle.proofRef', { proof: deleteProof.proof })}
              </p>
            </div>
          )}

          {/* A deletion we could not prove says so, and names what is left. */}
          {deleteProblem && (
            <InfoBox title={t('intentAI.lifecycle.deleteTitle')} tone="warn" id="set-my-data-problem">
              <p data-testid="deletion-problem">{t(deleteProblem.i18nKey, { cleared: 0, remaining: deleteProblem.leftovers.length })}</p>
            </InfoBox>
          )}
        </InfoBox>
      </motion.section>

      {/*
        The extra confirmation itself. It names the feature and the reason the
        region restricts it, and it says outright that it does not authorise
        execution — acknowledging a restriction is not a signature, and a sheet
        that implied otherwise would be worse than no button at all.
      */}
      <Sheet
        open={Boolean(ackFeature)}
        onClose={() => setAckFeature(null)}
        title={t('intentAI.compliance.confirmTitle', { defaultValue: 'One extra confirmation' })}
      >
        <p className="muted" style={{ fontSize: 12.3, lineHeight: 1.75 }} data-testid="region-ack-body">
          {t('intentAI.compliance.confirmBody', {
            defaultValue: '{{feature}} is restricted where you are. Confirming here records that you understand the restriction. It does not authorise any transaction — every action still goes through its own confirmation and your wallet.',
            feature: ackFeature ? t(`intentAI.compliance.feature.${ackFeature}`) : ''
          })}
        </p>
        <p className="faint" style={{ marginTop: 10, lineHeight: 1.7 }}>
          {t(regionRows.find((r) => r.feature === ackFeature)?.i18nKey || 'intentAI.compliance.restricted')}
        </p>
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => acknowledgeFeature(ackFeature)}
            data-testid="region-ack-confirm"
          >
            {t('intentAI.compliance.confirmExtra', { defaultValue: 'Confirm' })}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setAckFeature(null)}>
            {t('intentAI.compliance.cancel', { defaultValue: 'Cancel' })}
          </button>
        </div>
      </Sheet>

      {/*
        The 21-kind evidence dashboard is GONE from settings on purpose: it
        described the legacy activation curriculum that predates the current
        Intent OS and only produced stale "blocked/pending" noise here. The
        assistant no longer gates on it (see server/intentSandboxEvidence.js);
        operators who need the raw evidence state still have the
        /api/intents/v1/phase-status and evidence-status endpoints.
      */}

      {/* ---------------- sync ---------------- */}
      {firebaseConfigured && (
        <motion.section variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.sync')}</p>
          <div className="set-group">
            <Row
              icon={IconGlobe}
              label={t('settings.cloudSync')}
              sub={s.lastSyncedAt
                ? t('settings.syncedAt', { defaultValue: 'Last synced {{when}}', when: fmtSyncedAt(s.lastSyncedAt) })
                : t('settings.neverSynced')}
              right={
                <button className="btn btn-sm btn-ghost" onClick={doSync} disabled={syncing} data-testid="cloud-sync-now">
                  {syncing ? '…' : t('settings.syncNow')}
                </button>
              }
            />
          </div>
          {syncResult && (
            <p
              className={`sync-result${syncResult.ok ? ' is-ok' : ' is-bad'}`}
              role="status"
              data-testid="cloud-sync-result"
            >
              {syncResult.ok
                ? t('settings.syncDone', { defaultValue: 'Saved to the cloud just now. Settings from this account were pulled first.' })
                : t('settings.syncFailed', { defaultValue: 'Sync failed — nothing was saved. {{code}}', code: syncResult.code || 'SYNC_FAILED' })}
            </p>
          )}
          <p className="faint" style={{ marginTop: 8, lineHeight: 1.7 }}>{t('settings.syncScope')}</p>
        </motion.section>
      )}

      {/* ---------------- about ---------------- */}
      <motion.section variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('settings.company')}</p>
        <div className="set-group">
          <Row icon={IconInfo} label={t('about.title')} onClick={() => navigate('/about')} />
          <Row icon={IconMail} label={t('contact.title')} sub={SUPPORT_EMAIL} onClick={() => navigate('/contact')} />
          {/*
            Support goes to email, not Telegram - the owner's choice, and the
            more durable channel: an email address does not depend on an app
            that is blocked or renamed in some markets.
          */}
          <Row
            icon={IconMail}
            label={t('settings.support')}
            sub={t('settings.supportSub')}
            onClick={() => {
              haptic?.('light');
              window.location.href = SUPPORT_MAILTO;
            }}
          />
          <Row icon={IconDoc} label={t('settings.terms')} onClick={() => navigate('/legal/terms')} />
          <Row icon={IconShield} label={t('settings.privacy')} onClick={() => navigate('/legal/privacy')} />
          <Row icon={IconDoc} label={t('disclaimer.title')} onClick={() => navigate('/legal/disclaimer')} />
        </div>
      </motion.section>

      <p className="faint" style={{ textAlign: 'center', marginTop: 4 }}>{t('about.companyFull')} · v{APP_VERSION}</p>

      {/* ---------------- custom RPC ---------------- */}
      {/*
        Phase 92 — deletion is irreversible, so it gets its own dialog with an
        explicit affirmative ("Yes, delete everything") rather than a bare OK.
        Sheet supplies role="dialog", aria-modal="true" and Escape-to-close.
      */}
      <Sheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('intentAI.lifecycle.deleteTitle')}>
        <p className="muted" style={{ fontSize: 12.3, lineHeight: 1.75 }} data-testid="delete-confirm-body">
          {t('intentAI.lifecycle.deleteBody')}
        </p>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={deleteBusy}
            onClick={doDeleteMyData}
            data-testid="delete-confirm-button"
          >
            {t('intentAI.lifecycle.deleteConfirmLabel')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDeleteOpen(false)}
            data-testid="delete-cancel-button"
          >
            {t('intentAI.lifecycle.cancel')}
          </button>
        </div>
      </Sheet>

      {/* Phase 100: explicit confirmation for the full exit, same rules as
          deletion — no affirmative, no exit. */}
      <Sheet open={exitOpen} onClose={() => setExitOpen(false)} title={t('intentAI.sovereignty.leaveTitle')}>
        <p className="muted" style={{ fontSize: 12.3, lineHeight: 1.75 }} data-testid="sovereignty-confirm-body">
          {t('intentAI.sovereignty.needsConfirmation')}
        </p>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={exitBusy}
            onClick={doPerformExit}
            data-testid="sovereignty-confirm-button"
          >
            {t('intentAI.sovereignty.confirmLabel')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setExitOpen(false)}
            data-testid="sovereignty-cancel-button"
          >
            {t('intentAI.lifecycle.cancel')}
          </button>
        </div>
      </Sheet>

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
        <InfoBox title={t('settings.rpcWarnTitle')} tone="warn" id="set-rpc">
          <p>{t('settings.rpcWarn')}</p>
        </InfoBox>
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
