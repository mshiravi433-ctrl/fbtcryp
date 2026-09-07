import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Switch from '../components/Switch';
import Sheet from '../components/Sheet';
import { useStill } from '../components/AnimatedIcon';
import { SETTINGS_ICONS, SetIconAutoTheme, SetIconBack, SetIconPrivacy, SetIconSections, SetIconTick, SetIconTileNext, SetChipBolt } from '../components/SettingsIcons';
import '../styles/settings-hub.css';
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
  IconSparkle,
  IconCopy,
  IconChevronRight,
  IconClock,
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
  IconTrend,
  IconSun,
  IconUser,
  IconWallet
} from '../components/Icons';

/*
 * ─── SETTINGS IS A HUB NOW, NOT A 1500-PIXEL SCROLL ─────────────────────────
 * Asked for: «در تنظیمات هر بخش را یک صفحه با پاپ‌آپ بشه با ایکون قشنگ و مدرن
 * و اندازه درست در تم روشن و تیره … مثلاً باکس پروفایل که وقتی روش میزنی
 * پاپ‌آپ باز بشه و زیرگزینه‌هایش را نشان بدهد».
 *
 * The screen was eleven section labels followed by sixty-odd rows, all
 * rendered at once. Two things were wrong with that, and only one of them was
 * aesthetics:
 *
 *   · FINDING. To change slippage you scrolled past security, privacy, region
 *     policy and the data-deletion dialog; on a 360px phone the trading section
 *     began below the third screenful. A setting nobody finds is a setting that
 *     does not exist — and hide-balances, auto-lock and 2FA only protect
 *     someone who can reach them.
 *   · THE LIGHT THEME. The hero's status chips were painted with a literal
 *     `rgba(255,255,255,0.06)`, which on a white panel is nothing at all, and
 *     every selector was a native <select> that leaves the app's theme for the
 *     OS's chrome. Both are fixed here: colours come from tokens declared per
 *     tone for both themes (styles/settings-hub.css), and the selects are chip
 *     grids the app draws itself.
 *
 * Each section became one tile — icon, name, what is inside it, and its
 * CURRENT value — and the rows live behind it in a popup. Nothing moved into a
 * second file: a section's handlers, its store writes and its copy stay
 * together in this file, because the recurring failure here is a control that
 * writes a value nobody reads. Proximity is the cheapest guard against it.
 *
 * Two behaviours worth knowing before editing:
 *   · `?section=<id>` opens that popup on mount, so the assistant and the
 *     notification centre can send someone straight to the control they need
 *     rather than to the top of a long page.
 *   · the deeper choices (language, display name, the 2FA flow, the RPC
 *     editor) are a SECOND LEVEL OF THE SAME POPUP rather than a second Sheet.
 *     Two stacked sheets both listen for Escape, so one keypress would close
 *     the one behind the one in front and take both surfaces at once.
 */

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

/*
 * The accent palettes, drawn with the same gradients the store writes into
 * --rgb-*. Data rather than markup so the swatch row and the tile chip cannot
 * disagree, and so adding a palette is one line here instead of a JSX edit.
 */
const ACCENTS = [
  { id: 'rgb', name: 'RGB', css: 'conic-gradient(#00e5ff,#7c4dff,#ff2d95,#00ff9d,#00e5ff)' },
  { id: 'pastel', name: 'Pastel', css: 'conic-gradient(#7fd8e8,#b3a4f5,#f5a3c7,#8fe3c2,#7fd8e8)' },
  { id: 'cyan', name: 'Cyan', css: 'linear-gradient(135deg,#00e5ff,#0091ea)' },
  { id: 'magenta', name: 'Magenta', css: 'linear-gradient(135deg,#ff2d95,#d500f9)' },
  { id: 'mint', name: 'Mint', css: 'linear-gradient(135deg,#00ff9d,#00e5ff)' }
];

const SLIPPAGE_PRESETS = [0.1, 0.5, 1, 3];
const DEADLINES = [5, 10, 20, 30, 60];
const AUTOLOCKS = [0, 1, 5, 15, 60];
/* The five switches a user can meaningfully turn on or off, in one order, so
   the tile's "n/5" chip counts the same things the popup shows. */
const NOTIFY_KEYS = ['sound', 'vibrate', 'tradeAlerts', 'dailyPromo', 'news'];

/**
 * A settings row.
 *
 * `...rest` is spread onto the element on purpose: the region-availability rows
 * have to carry `data-state={feature.state}` so the state is exposed as data
 * and not only as a colour, and a component that swallows unknown props is how
 * an accessibility attribute quietly stops being rendered.
 */
function Row({ icon: Icon, label, sub, right, onClick, ...rest }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className="set-row"
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      {...rest}
    >
      {Icon && (
        <span className="set-row-icon">
          <Icon width={19} height={19} />
        </span>
      )}
      <span className="set-row-label">
        <div>{label}</div>
        {sub && <div className="set-row-sub">{sub}</div>}
      </span>
      {right ?? (onClick && (
        /* A class, not an inline style, because the chevron has to flip with
           the writing direction — «next» points left when the page reads right
           to left, and an inline style cannot carry that rule. */
        <span className="set-row-next" aria-hidden="true">
          <IconChevronRight width={17} height={17} />
        </span>
      ))}
    </Tag>
  );
}

/** A small state pill. Tokens only — a literal white wash disappears in the
 *  light theme, which is exactly how the old hero chips went invisible.
 *  `dot` paints a coloured disc, `icon` renders a tiny drawn mark — the
 *  chips used emoji («⚡ 0.5%», «🔒 2FA») and emoji cannot be recoloured,
 *  so the live values now ride on small SVGs like everything else here. */
function Chip({ children, tone, dot, icon: Icon }) {
  return (
    <span className={`set-chip${tone ? ` is-${tone}` : ''}`}>
      {dot ? <span className="set-chip-dot" style={{ background: dot }} /> : null}
      {Icon ? <Icon width={11} height={11} /> : null}
      {children}
    </span>
  );
}

/** A labelled block of options, with the current value on the other side. */
function Field({ label, hint, note, children }) {
  return (
    <div className="set-field">
      {(label || hint) && (
        <div className="set-field-label">
          <span>{label}</span>
          {hint ? <span className="set-field-hint">{hint}</span> : null}
        </div>
      )}
      {children}
      {note ? <p className="set-field-note">{note}</p> : null}
    </div>
  );
}

/**
 * The chip grid that replaced every <select> in this screen.
 *
 * A native select hides the current value behind one word, leaves the app's
 * theme for the OS, and — in Persian — is the only part of the screen the app
 * cannot control. These show the value, its unit and a tick, and they are one
 * tap. A tick is drawn rather than relying on the tint, because a selected
 * state that is only a colour is invisible to a colour-blind user and to a
 * phone in sunlight.
 *
 * `opt.on` overrides the comparison, which is what turns the same grid into a
 * multi-select (the notification switches) instead of a single choice.
 */
function OptionGrid({ options, value, onChange, cols, flat = false, ariaLabel }) {
  return (
    <div className="set-opts" data-cols={cols} data-flat={flat ? 'true' : 'false'} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const on = opt.on !== undefined ? Boolean(opt.on) : String(opt.value) === String(value);
        const OptIcon = opt.icon;
        return (
          <button
            key={String(opt.value)}
            type="button"
            className={`set-opt${on ? ' is-on' : ''}`}
            onClick={() => onChange?.(opt.value, opt)}
            aria-pressed={on}
            title={opt.title || opt.sub || undefined}
          >
            {opt.dot ? <span className="set-opt-dot" style={{ background: opt.dot }} aria-hidden="true" /> : null}
            {OptIcon ? (
              <span className="set-opt-ico" aria-hidden="true">
                <OptIcon width={19} height={19} />
              </span>
            ) : null}
            <span>{opt.label}</span>
            {opt.sub ? <span className="set-opt-sub">{opt.sub}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const s = useSettingsStore();
  const still = useStill();

  /* ─── WHICH POPUP IS OPEN ────────────────────────────────────────────────
     The section id lives in the URL as well as in state, but the URL is only
     ever WRITTEN with `replace`, so a popup never leaves a history entry for
     the back button to walk through before it can leave the screen. */
  const [params, setParams] = useSearchParams();
  const [active, setActive] = useState(null);
  const [sub, setSub] = useState(null);

  const openSection = useCallback((id) => {
    setSub(null);
    setActive(id);
    haptic?.('select');
  }, [haptic]);

  const closeSection = useCallback(() => {
    setActive(null);
    setSub(null);
  }, []);

  /* Deep link: /settings?section=security opens with that popup already up. */
  useEffect(() => {
    const want = params.get('section');
    if (want && SETTINGS_ICONS[want]) openSection(want);
    // Mount-only on purpose: clearing the param must not close a popup the
    // user opened by hand one second later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const have = params.get('section');
    if (active && have !== active) {
      const next = new URLSearchParams(params);
      next.set('section', active);
      setParams(next, { replace: true });
      return;
    }
    if (!active && have) {
      const next = new URLSearchParams(params);
      next.delete('section');
      setParams(next, { replace: true });
    }
  }, [active, params, setParams]);

  /* The 2FA setup flow: secret → verified code → recovery codes, in that
     order, and the recovery codes only ever exist after a verified code. */
  const [totpSecret, setTotpSecret] = useState(null);
  const [totpInput, setTotpInput] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [twoFaErr, setTwoFaErr] = useState(null);

  /* The RPC editor is a second level of the networks popup; the draft is the
     input's value while it is open, and null when it is not. */
  const [rpcDraft, setRpcDraft] = useState(null);
  const [slipCustom, setSlipCustom] = useState('');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioErr, setBioErr] = useState(null);
  const [syncing, setSyncing] = useState(false);
  /* The outcome of the last sync attempt. Null until one has been made. */
  const [syncResult, setSyncResult] = useState(null);
  const [copied, setCopied] = useState(false);

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
   * ─── PHASE 87 — WHAT IS ACTUALLY AVAILABLE WHERE THIS PERSON IS ─────────
   *
   * The region comes from the browser's own locale, which is a hint and not a
   * legal determination — so when it yields nothing recognisable,
   * `featureState` falls back to the STRICTEST policy rather than the most
   * permissive, and the map says out loud that the region could not be
   * determined. Nothing here grants a feature; it can only ever show one as
   * restricted or blocked.
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
   * THE EXTRA CONFIRMATION A RESTRICTED FEATURE PROMISES.
   *
   * Reported: «خودکارسازی — در اینجا با یک تایید اضافه در دسترس است» sitting
   * next to a «محدود» badge with nothing to press. The gate accepted
   * `acknowledged: true` for months and the screen never offered a way to
   * acknowledge — the map rendered the promise, and the button to make good on
   * it did not exist.
   *
   * So the popup now renders what the gate already honours: a restricted
   * feature gets a real confirm action, and once acknowledged the row reads as
   * permitted-with-extra-confirmation, because that is literally what the gate
   * returns for it. Two rules kept from the lib:
   *   · this can only UNLOCK what policy already allows. Geo-gating may only
   *     ever subtract, so no amount of acknowledging here turns a blocked
   *     feature into an available one.
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
    setSub('twofa');
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

  const openRpc = () => {
    setRpcDraft(s.customEvmRpc || '');
    setSub('rpc');
  };

  const closeRpc = () => {
    setRpcDraft(null);
    setSub(null);
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
        closeSection();
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
        closeSection();
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
   * synced" timestamp after a sync that had failed — anonymous sign-in refused,
   * Firestore rules rejecting the write, no network, any of them. The timestamp
   * was not evidence that anything had been saved; it was evidence that a
   * button had been pressed.
   *
   * The push result is now the thing that decides. And the line beside it says
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

  const copyAddress = async () => {
    if (!wallet.address) return;
    try {
      await navigator.clipboard?.writeText(wallet.address);
      setCopied(true);
      haptic?.('success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      useAppStore.getState().notify('toast.error', 'error');
    }
  };

  const themeLabel = s.theme === 'dark' ? t('settings.themeDark') : s.theme === 'light' ? t('settings.themeLight') : t('settings.themeAuto');
  const chain = EVM_CHAINS[wallet.chainId ?? s.evmChainId];
  const lang = langMeta(i18n.language);
  const notifyOn = NOTIFY_KEYS.filter((k) => notif[k]).length;
  const regionNeedsAck = regionRows.filter((r) => r.needsAck).length;

  /* ═══════════════════════════ THE SECTION BODIES ═════════════════════════
     One body per tile, and each body IS the section's sub-options. They are
     plain consts rather than components on purpose: a component declared
     inside the render would remount its inputs on every keystroke, which is
     how a text field loses focus mid-word. */

  const bodyProfile = (
    <>
      <div className="set-group">
        <Row
          icon={IconWallet}
          label={t('settings.wallet')}
          sub={wallet.address ? shortAddress(wallet.address) : t('wallet.notConnected')}
          right={
            <span className={`pill ${wallet.isConnected ? 'pill-up' : 'pill-neutral'}`}>
              {wallet.isConnected ? t('onboarding.wallet.connected') : t('settings.noWallet')}
            </span>
          }
          onClick={() => { closeSection(); navigate('/wallet'); }}
        />
        {/* Display name — how the app greets you. Stays on the device now that
            the public board is gone. Not an account, no password. */}
        <Row
          icon={IconUser}
          label={t('profile.username')}
          sub={s.username || t('profile.usernameUnset')}
          onClick={() => setSub('name')}
        />
        {/* Twelve languages no longer fit in an inline three-button strip, so
            this opens the same picker the welcome screen uses. */}
        <Row
          icon={IconGlobe}
          label={t('settings.language')}
          sub={`${lang.flag} ${lang.endonym}`}
          onClick={() => setSub('lang')}
        />
      </div>

      {wallet.address ? (
        <Field label={t('settings.hub.address')}>
          <div className="set-group" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 9 }}>
            <code className="mono" style={{ flex: '1 1 auto', minWidth: 0, fontSize: 11.5, wordBreak: 'break-all', color: 'var(--text-2)' }}>
              {wallet.address}
            </code>
            <button type="button" className="btn btn-sm btn-ghost" onClick={copyAddress}>
              {copied ? t('common.copied') : t('settings.hub.copy')}
            </button>
          </div>
        </Field>
      ) : null}

      <p className="set-note">{t('settings.hub.profileNote')}</p>
    </>
  );

  const bodyProfileName = (
    <>
      <p className="set-sheet-blurb">{t('profile.usernameHelp')}</p>
      <UsernameField autoFocus />
      <div className="set-sheet-foot">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => { haptic?.('success'); setSub(null); }}
        >
          {t('common.done')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setSub(null)}>
          {t('intentAI.lifecycle.cancel')}
        </button>
      </div>
    </>
  );

  const bodyProfileLang = (
    <>
      <p className="set-sheet-blurb">{t('settings.hub.langNote')}</p>
      <LanguagePicker onPick={() => setSub(null)} />
    </>
  );

  const bodyNotify = (
    <>
      <Field label={t('settings.hub.alerts')} hint={`${notifyOn}/5`} note={t('settings.hub.alertsNote')}>
        <OptionGrid
          cols={2}
          ariaLabel={t('settings.hub.alerts')}
          onChange={(key) => {
            haptic?.('select');
            patchNotif({ [key]: !notif[key] });
            /* Sound. Tapping it plays the chime, because a toggle whose effect
               you only discover during a real trade is untestable. */
            if (key === 'sound' && !notif.sound) {
              primeAudio();
              setTimeout(() => playSound('success'), 60);
            }
            if (key === 'vibrate' && !notif.vibrate) vibrate([40, 60, 40], haptic);
          }}
          options={[
            { value: 'sound', label: t('notify.sound'), sub: t('notify.soundSub'), icon: IconVolume, on: Boolean(notif.sound) },
            { value: 'vibrate', label: t('notify.vibrate'), sub: t('notify.vibrateSub'), icon: IconVibrate, on: Boolean(notif.vibrate) },
            { value: 'tradeAlerts', label: t('notify.tradeAlerts'), sub: t('notify.tradeAlertsSub'), icon: IconBell, on: Boolean(notif.tradeAlerts) },
            { value: 'dailyPromo', label: t('notify.daily'), sub: pmode === 'server' ? t('notify.dailySub') : t('notify.dailySubLocal'), icon: IconSparkle, on: Boolean(notif.dailyPromo) },
            { value: 'news', label: t('notify.news'), sub: t('notify.newsSub'), icon: IconNews, on: Boolean(notif.news) }
          ]}
        />
      </Field>

      {/* iOS-specific guidance: Apple only allows push for pinned PWAs */}
      {(iosNeedPin || iosInWebView) && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 10 }}>
          <InfoBox title="اعلان‌ها در آیفون" tone="warn" id="ios-notify">
            <p style={{ fontSize: 12.5, lineHeight: 1.85, margin: 0 }}>
              {iosInWebView ? t('notify.iosWebView') : t('notify.iosNeedPin')}
            </p>
          </InfoBox>
        </motion.div>
      )}

      {/* Permission state, described exactly as it is. */}
      <Field label={t('notify.permission')}>
        <div className="set-group">
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
              right={iosNeedPin || iosInWebView
                ? <span className="pill pill-neutral">iOS</span>
                : <button type="button" className="btn btn-sm btn-primary" style={{ width: 'auto' }} onClick={askPermission}>{t('notify.permissionAsk')}</button>}
            />
          )}
        </div>
      </Field>
    </>
  );

  const bodyAppearance = (
    <>
      <Field label={t('settings.theme')} hint={themeLabel}>
        <OptionGrid
          cols={3}
          ariaLabel={t('settings.theme')}
          value={s.theme}
          onChange={(v) => { haptic?.('select'); s.setTheme(v); }}
          options={[
            { value: 'light', label: t('settings.themeLight'), icon: IconSun },
            { value: 'dark', label: t('settings.themeDark'), icon: IconMoon },
            { value: 'auto', label: t('settings.themeAuto'), sub: t('settings.hub.themeAutoSub'), icon: SetIconAutoTheme }
          ]}
        />
      </Field>

      {/*
        Pastel is an EXTRA palette rather than the default, and the reason is
        measurement: against white the pastel tones land at 1.5–2.2:1, where
        WCAG AA wants 4.5:1. The light theme therefore remaps them to the
        darker --ink-* variants of the same hue, which is why picking a palette
        here stays readable instead of quietly washing out.
      */}
      <Field label={t('settings.accent')} hint={ACCENTS.find((a) => a.id === s.accent)?.name || 'RGB'} note={t('settings.hub.accentNote')}>
        <div className="set-swatches" role="radiogroup" aria-label={t('settings.accent')}>
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={s.accent === a.id}
              className={`set-swatch${s.accent === a.id ? ' is-on' : ''}`}
              aria-label={a.name}
              title={a.name}
              onClick={() => { haptic?.('select'); s.setAccent(a.id); }}
              style={{ background: a.css }}
            >
              <span className="set-swatch-tick" aria-hidden="true">
                <SetIconTick width={11} height={11} />
              </span>
            </button>
          ))}
        </div>
      </Field>

      <div className="set-group">
        <Row
          icon={IconInfo}
          label={t('settings.hideBalances')}
          sub={t('settings.hideBalancesSub')}
          right={<Switch on={s.hideBalances} onChange={() => s.toggle('hideBalances')} label={t('settings.hideBalances')} />}
        />
        <Row
          icon={IconInfo}
          label={t('settings.reduceMotion')}
          sub={t('settings.reduceMotionSub')}
          right={<Switch on={s.reduceMotion} onChange={() => s.setReduceMotion(!s.reduceMotion)} label={t('settings.reduceMotion')} />}
        />
        <Row
          icon={IconTrend}
          label={t('settings.compactMode')}
          sub={t('settings.compactModeSub')}
          right={<Switch on={s.compactMode} onChange={() => s.toggle('compactMode')} label={t('settings.compactMode')} />}
        />
      </div>
    </>
  );

  const slipIsCustom = !SLIPPAGE_PRESETS.includes(Number(s.defaultSlippage));

  const bodyTrading = (
    <>
      <Field
        label={t('settings.defaultSlippage')}
        hint={`${s.defaultSlippage}%`}
        note={t('settings.defaultSlippageSub')}
      >
        <OptionGrid
          flat
          ariaLabel={t('settings.defaultSlippage')}
          value={slipIsCustom ? 'custom' : s.defaultSlippage}
          onChange={(v) => {
            if (v === 'custom') {
              setSlipCustom(String(s.defaultSlippage));
              return;
            }
            haptic?.('select');
            s.setSlippage(v);
          }}
          options={[
            ...SLIPPAGE_PRESETS.map((v) => ({ value: v, label: `${v}%` })),
            { value: 'custom', label: t('settings.hub.custom'), sub: t('settings.hub.customRange') }
          ]}
        />
        {slipIsCustom && (
          <input
            className="set-input"
            style={{ marginTop: 8 }}
            type="number"
            inputMode="decimal"
            step="0.05"
            min="0.05"
            max="50"
            value={slipCustom}
            placeholder="0.5"
            aria-label={t('settings.defaultSlippage')}
            onChange={(e) => {
              setSlipCustom(e.target.value);
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) s.setSlippage(n);
            }}
          />
        )}
      </Field>

      <Field
        label={t('settings.defaultDeadline')}
        hint={`${s.defaultDeadlineMin || 20} ${t('settings.minutesShort', 'min')}`}
        note={t('settings.defaultDeadlineSub')}
      >
        <OptionGrid
          flat
          ariaLabel={t('settings.defaultDeadline')}
          value={s.defaultDeadlineMin || 20}
          onChange={(v) => { haptic?.('select'); s.setDefaultDeadlineMin(Number(v)); }}
          options={DEADLINES.map((v) => ({ value: v, label: `${v} ${t('settings.minutesShort', 'min')}` }))}
        />
      </Field>

      {/*
        No rial option, on purpose: none of the price feeds we use quotes it,
        so it could only ever have been a rial label sitting over a dollar
        number. currencyOf() maps any legacy stored code back to USD, so an
        existing install does not render a blank selection after upgrading.
      */}
      <Field label={t('settings.currency')} hint={currencyOf(s.currency).code}>
        <OptionGrid
          cols={4}
          flat
          ariaLabel={t('settings.currency')}
          value={currencyOf(s.currency).code}
          onChange={(v) => { haptic?.('select'); s.setCurrency(v); }}
          options={CURRENCIES.map((c) => ({ value: c.code, label: c.code, sub: c.symbol.trim() || c.name }))}
        />
      </Field>

      <div className="set-group">
        <Row
          icon={IconShield}
          label={t('settings.expertMode')}
          sub={t('settings.expertModeSub')}
          right={<Switch on={s.expertMode} onChange={() => s.toggle('expertMode')} label={t('settings.expertMode')} />}
        />
      </div>
    </>
  );

  const bodySecurity = (
    <>
      <div className="set-group">
        <Row
          icon={IconFingerprint}
          label={t('settings.biometric')}
          sub={bioAvailable ? t('settings.biometricSub') : t('settings.biometricUnavailable')}
          right={<Switch on={s.biometricEnabled} onChange={toggleBiometric} label={t('settings.biometric')} />}
        />
        <Row
          icon={IconShield}
          label={t('settings.twoFactor')}
          sub={s.twoFactorEnabled ? t('settings.enabled') : t('settings.twoFactorSub')}
          right={
            s.twoFactorEnabled
              ? <Switch on onChange={startTwoFa} label={t('settings.twoFactor')} />
              : undefined
          }
          onClick={s.twoFactorEnabled ? undefined : startTwoFa}
        />
        <Row
          icon={IconKey}
          label={t('nav.smartWallet')}
          sub={t('smart.enableSub')}
          onClick={() => { closeSection(); navigate('/smart-wallet'); }}
        />
      </div>

      <Field
        label={t('settings.autoLock')}
        hint={s.autoLockMinutes === 0 ? t('settings.never') : t('settings.afterMinutes', { n: s.autoLockMinutes })}
        note={t('settings.hub.autoLockNote')}
      >
        <OptionGrid
          cols={5}
          ariaLabel={t('settings.autoLock')}
          value={s.autoLockMinutes}
          onChange={(v) => { haptic?.('select'); s.setAutoLock(v); }}
          options={AUTOLOCKS.map((m) => ({
            value: m,
            label: m === 0 ? t('settings.never') : String(m),
            sub: m === 0 ? t('settings.hub.autoLockOff') : t('settings.minutesShort', 'min')
          }))}
        />
      </Field>

      {bioErr && <p className="set-note is-danger">{t(`settings.bioErr.${bioErr}`)}</p>}

      {/*
        "Confirm every transaction" was removed rather than wired.

        It was dead — txConfirmations was read nowhere — and it is also the
        exact inverse of Expert mode, which now really does control whether the
        review step is skipped. Keeping both would be two switches fighting
        over one behaviour, and the losing one would look broken.
      */}
      <InfoBox title={t('settings.securityScopeTitle')} tone="warn" id="set-scope">
        <p>{t('settings.securityScope')}</p>
      </InfoBox>
    </>
  );

  /*
   * The 2FA flow, inside the security popup. The secret is shown once, nothing
   * is stored until the code verifies, and the recovery codes appear only
   * AFTER that verification — they are the way back in, so handing them out
   * for an unverified secret would be a lock plus a key to nothing.
   */
  const bodyTwoFa = recovery ? (
    <>
      <p className="set-note is-danger">{t('settings.recoveryWarning')}</p>
      <div className="set-code-grid">
        {recovery.map((c) => (
          <div key={c} className="set-code-cell">{c}</div>
        ))}
      </div>
      <div className="set-sheet-foot">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            navigator.clipboard?.writeText(recovery.join('\n'));
            haptic?.('success');
          }}
        >
          {t('common.copy')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setSub(null)}>
          {t('common.done')}
        </button>
      </div>
    </>
  ) : (
    <>
      <p className="set-sheet-blurb">{t('settings.twoFactorHow')}</p>

      <Field label={t('settings.secretKey')}>
        <div className="set-mono" style={{ padding: 12, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--bg-raised)' }}>
          {totpSecret}
        </div>
      </Field>

      <div className="set-sheet-foot" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
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
          style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}
        >
          {t('settings.openInAuthApp')}
        </a>
      </div>

      <Field label={t('settings.enterCode')}>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={totpInput}
          onChange={(e) => setTotpInput(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          className="set-input"
          style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 20 }}
        />
      </Field>
      {twoFaErr && <p className="set-note is-danger">{t('settings.badCode')}</p>}

      <div className="set-sheet-foot">
        <button type="button" className="btn btn-primary" disabled={totpInput.length !== 6} onClick={confirmTwoFa}>
          {t('settings.verifyEnable')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setSub(null)}>
          {t('intentAI.lifecycle.cancel')}
        </button>
      </div>
    </>
  );

  const bodyPrivacy = (
    <>
      {telemetryPromptVisible && !s.contributeTelemetry && (
        /*
         * The prompt is a quiet inline line, never a modal. The text runs
         * FULL-WIDTH below a small corner `×`, so a long Persian sentence wraps
         * as a normal paragraph instead of being squeezed into a narrow flex
         * column next to the close button (which is what made the box grow
         * tall and the words break one under another).
         */
        <div className="set-note" style={{ marginTop: 0, position: 'relative', paddingInlineEnd: 34 }}>
          <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.85, margin: 0, textWrap: 'pretty' }}>
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

      {/*
        The learning core is STRICTLY opt-in. Everything the model can learn is
        explained inside the collapsed box, and the switch lives inside it, so
        nobody enables it without having read what it shares. The record
        carries no address, key, IP or user id — see lib/learning.js.
      */}
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

      <p className="set-note" style={{ lineHeight: 1.7 }}>{t('settings.walletPrivacyLine')}</p>

      <div className="set-group">
        <Row
          icon={IconShield}
          label={t('intentAI.compliance.sectionTitle')}
          sub={regionNeedsAck ? t('settings.hub.regionNeedsAck', { n: regionNeedsAck, defaultValue: '{{n}} need your confirmation' }) : t('settings.hub.hints.region')}
          onClick={() => { setSub(null); setActive('region'); }}
        />
      </div>
    </>
  );

  const bodyNetworks = (
    <>
      <Field
        label={t('settings.evmNetwork')}
        hint={chain?.short || 'EVM'}
        note={t('settings.evmNetworkSub')}
      >
        <OptionGrid
          ariaLabel={t('settings.evmNetwork')}
          value={wallet.chainId ?? s.evmChainId}
          onChange={async (id) => {
            /*
             * Switches the LIVE chain, not just a stored number.
             *
             * This used to only call setEvmChain(), and nothing read
             * evmChainId — the Swap screen takes its chain from wallet.chainId.
             * So picking "Ethereum" here changed a value in storage and left
             * every swap on BNB Chain.
             *
             * The wallet switch is best-effort: no wallet connected, or the
             * wallet refusing the chain, must not undo the stored preference or
             * throw inside a click handler — the next quote reads the stored
             * chain, and the wallet will be asked again when it connects.
             */
            haptic?.('select');
            s.setEvmChain(id);
            try {
              await wallet.switchChain?.(id);
            } catch {
              /* the wallet is not switching right now — the choice still stands */
            }
          }}
          options={EVM_CHAIN_ORDER.map((id) => {
            const c = EVM_CHAINS[id];
            if (!c) return null;
            return { value: id, label: c.short, sub: c.name, dot: c.color, title: c.name };
          }).filter(Boolean)}
        />
      </Field>

      {/*
        THE TESTNET TOGGLE WAS REMOVED, NOT FIXED.

        It rendered "Using test networks — funds are not real" while
        `testnetMode` was read by nothing: every quote, every signature and
        every swap stayed on mainnet with real money. A switch that tells
        someone their funds are fake, while they are not, is the most dangerous
        control this app could ship. Building it properly means testnet RPCs,
        testnet router addresses and testnet token lists for nine EVM chains —
        real work, worth doing only if someone asks. Until then, showing nothing
        is honest and showing the switch is not.
      */}
      <Field label={t('settings.solana')} note={t('settings.solanaSub')}>
        <OptionGrid
          cols={2}
          flat
          ariaLabel={t('settings.solana')}
          value={s.solanaCluster}
          onChange={(v) => { haptic?.('select'); s.setSolanaCluster(v); }}
          options={[
            { value: 'mainnet-beta', label: 'Mainnet', sub: t('settings.hub.mainnetSub', { defaultValue: 'Real funds' }) },
            { value: 'devnet', label: 'Devnet', sub: t('settings.hub.devnetSub', { defaultValue: 'Test funds only' }) }
          ]}
        />
      </Field>

      <div className="set-group">
        <Row
          icon={IconSettings2}
          label={t('settings.customRpc')}
          sub={s.customEvmRpc || t('settings.customRpcSub')}
          onClick={openRpc}
        />
      </div>
    </>
  );

  const bodyRpc = (
    <>
      <p className="set-sheet-blurb">{t('settings.customRpcHelp')}</p>

      <Field label="EVM RPC">
        <input
          type="text"
          className="set-input"
          value={rpcDraft ?? ''}
          onChange={(e) => setRpcDraft(e.target.value)}
          placeholder="https://bsc-dataseed.binance.org"
          aria-label="EVM RPC"
        />
      </Field>

      <Field label="Solana RPC">
        <input
          type="text"
          className="set-input"
          defaultValue={s.solanaRpc}
          onChange={(e) => s.setRpc('solanaRpc', e.target.value)}
          placeholder="https://api.mainnet-beta.solana.com"
          aria-label="Solana RPC"
        />
      </Field>

      <InfoBox title={t('settings.rpcWarnTitle')} tone="warn" id="set-rpc">
        <p>{t('settings.rpcWarn')}</p>
      </InfoBox>

      <div className="set-sheet-foot">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (rpcDraft) s.setRpc('customEvmRpc', rpcDraft);
            else s.setRpc('customEvmRpc', '');
            closeRpc();
            haptic?.('success');
          }}
        >
          {t('common.confirm')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={closeRpc}>
          {t('intentAI.lifecycle.cancel')}
        </button>
      </div>
    </>
  );

  const bodyData = (
    <>
      <div className="set-group">
        <Row
          icon={IconSparkle}
          label={t('settings.clearCache')}
          sub={t('settings.clearCacheSub')}
          right={
            <button
              type="button"
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
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                haptic?.('light');
                try {
                  await exportSettingsBackup();
                  useAppStore.getState().notify('settingsBackedUp', 'success');
                } catch {
                  useAppStore.getState().notify('toast.error', 'error');
                }
              }}
            >
              {t('settings.backup')}
            </button>
          }
        />
      </div>

      <p className="set-note">{t('settings.dataStorageNote')}</p>

      {/* ---------------- phase 92: my data ---------------- */}
      <div data-testid="my-data-section" style={{ marginTop: 10 }}>
        <InfoBox title={t('intentAI.lifecycle.title')} tone="info" id="set-my-data" defaultOpen>
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
      </div>

      {/*
        Phase 100 — the exit path. It existed in this file as four states, two
        handlers and a confirmation dialog, with nothing that could set
        `exitOpen`. That is the same shape as every other dead control this
        repo has had to fix: built, wired, unreachable. The two rows below are
        the missing wire — prepare first, then leave.
      */}
      <div style={{ marginTop: 10 }}>
        <InfoBox title={t('intentAI.sovereignty.title')} tone="warn" id="set-exit">
          <p className="muted" style={{ fontSize: 12.3, margin: '0 0 6px', lineHeight: 1.7 }}>
            {t('intentAI.sovereignty.exitExplained')}
          </p>
          <p className="faint" style={{ fontSize: 11.5, margin: '0 0 10px', lineHeight: 1.7 }}>
            {t('intentAI.sovereignty.exitDetails', {
              steps: exitPath.stepsRequired,
              fee: exitPath.requiresFee ? '—' : '0'
            })}
            {' · '}
            {DATA_STORES.length} {t('settings.hub.storesUnit', { defaultValue: 'stores' })}
          </p>
          <div className="set-group">
            <Row
              icon={IconDoc}
              label={t('intentAI.sovereignty.prepareTitle')}
              sub={t('intentAI.sovereignty.prepareBody')}
              right={
                <button type="button" className="btn btn-sm btn-ghost" onClick={doPrepareExit} data-testid="sovereignty-prepare">
                  {t('intentAI.sovereignty.prepareAction')}
                </button>
              }
            />
            <Row
              icon={IconLock}
              label={t('intentAI.sovereignty.leaveTitle')}
              sub={t('intentAI.sovereignty.leaveBody')}
              right={
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => { haptic?.('light'); setExitProblem(null); setExitOpen(true); }}
                  data-testid="sovereignty-open"
                >
                  {t('intentAI.sovereignty.leaveAction')}
                </button>
              }
            />
          </div>
          {exitReceipt && (
            <p className="set-note" data-testid="sovereignty-receipt">
              {t('intentAI.sovereignty.exitComplete')}
              {exitReceipt.proof ? ` · ${t('intentAI.sovereignty.receiptRef', { proof: exitReceipt.proof })}` : ''}
            </p>
          )}
          {exitProblem && (
            <p className="set-note is-danger" data-testid="sovereignty-problem">
              {t(exitProblem.i18nKey, exitProblem.params || {})}
            </p>
          )}
        </InfoBox>
      </div>
    </>
  );

  const bodySync = (
    <>
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
      <p className="set-note" style={{ lineHeight: 1.7 }}>{t('settings.syncScope')}</p>
    </>
  );

  const bodyRegion = (
    <>
      {/* An undetermined region is admitted in words, never quietly treated as
          a permissive one. */}
      {!regionMap.regionKnown && (
        <p className="set-note is-danger" role="status" data-testid="region-unknown-note">
          {t('intentAI.compliance.regionUnknown')}
        </p>
      )}

      <div className="set-group" data-testid="region-availability-section">
        {regionMap.features.map((feature) => {
          const row = regionRows.find((r) => r.feature === feature.feature) || {};
          const needsAck = row.needsAck === true;
          return (
            <Row
              key={feature.feature}
              icon={IconShield}
              label={t(`intentAI.compliance.feature.${feature.feature}`)}
              sub={t(feature.i18nKey)}
              data-state={feature.state}
              right={needsAck ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ width: 'auto' }}
                  onClick={() => { haptic?.('light'); setAckFeature(feature.feature); }}
                  data-testid={`region-feature-${feature.feature}-ack`}
                >
                  {t('intentAI.compliance.confirmExtra')}
                </button>
              ) : (
                <span
                  className={`region-state region-state-${feature.state}`}
                  data-testid={`region-feature-${feature.feature}-state`}
                >
                  {t(`intentAI.compliance.state.${feature.state}`)}
                </span>
              )}
            />
          );
        })}
      </div>

      <p className="set-field-note" style={{ marginTop: 8 }}>
        {t('settings.hub.regionNote', { defaultValue: 'This list only reports what your region allows. Confirming here never authorises a transaction.' })}
      </p>

      {/* A granted acknowledgement is withdrawable, and it says when it was given. */}
      {regionRows.filter((r) => r.ack).length > 0 && (
        <div className="set-group" style={{ marginTop: 10 }}>
          {regionRows.filter((r) => r.ack).map((r) => (
            <Row
              key={`ack-${r.feature}`}
              icon={IconInfo}
              label={t(`intentAI.compliance.feature.${r.feature}`)}
              sub={t('intentAI.compliance.ackedAt', { defaultValue: 'Acknowledged {{when}}', when: fmtSyncedAt(r.ack.at) })}
              right={
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => withdrawFeature(r.feature)}>
                  {t('intentAI.compliance.withdraw')}
                </button>
              }
            />
          ))}
        </div>
      )}
    </>
  );

  const bodyAbout = (
    <>
      <div className="set-group">
        <Row icon={IconInfo} label={t('about.title')} onClick={() => { closeSection(); navigate('/about'); }} />
        <Row icon={IconMail} label={t('contact.title')} sub={SUPPORT_EMAIL} onClick={() => { closeSection(); navigate('/contact'); }} />
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
        <Row icon={IconDoc} label={t('settings.terms')} onClick={() => { closeSection(); navigate('/legal/terms'); }} />
        <Row icon={IconShield} label={t('settings.privacy')} onClick={() => { closeSection(); navigate('/legal/privacy'); }} />
        <Row icon={IconDoc} label={t('disclaimer.title')} onClick={() => { closeSection(); navigate('/legal/disclaimer'); }} />
      </div>
      <p className="faint" style={{ textAlign: 'center', marginTop: 14 }}>{t('about.companyFull')} · v{APP_VERSION}</p>
    </>
  );

  /* ═══════════════════════════ THE TILES ═════════════════════════════════
     One array drives the grid, the popup header and the popup body, so a
     section cannot appear in one of the three and be missing from another. */
  const sections = [
    {
      id: 'profile',
      tone: 'cyan',
      label: t('settings.profile'),
      chips: [
        chain ? <Chip key="chain" dot={chain.color}>{chain.short}</Chip> : null,
        <Chip key="lang">{lang.flag}&nbsp;{lang.endonym}</Chip>,
        s.username ? <Chip key="name">{s.username}</Chip> : null
      ].filter(Boolean)
    },
    {
      id: 'notify',
      tone: 'violet',
      label: t('notify.title'),
      alert: notificationsSupported() && perm !== 'granted',
      chips: [
        <Chip key="count" tone={notifyOn > 0 ? 'good' : undefined}>{notifyOn}/5</Chip>,
        perm === 'denied' ? <Chip key="denied" tone="warn">{t('settings.hub.notifyBlocked')}</Chip> : null,
        perm === 'granted' && pmode === 'server' ? <Chip key="push">{t('notify.modeServer')}</Chip> : null
      ].filter(Boolean)
    },
    {
      id: 'appearance',
      tone: 'magenta',
      label: t('settings.appearance'),
      chips: [
        <Chip key="theme">{themeLabel}</Chip>,
        <Chip key="accent">{ACCENTS.find((a) => a.id === s.accent)?.name || 'RGB'}</Chip>,
        s.hideBalances ? <Chip key="hide" tone="warn">{t('settings.hideBalances')}</Chip> : null
      ].filter(Boolean)
    },
    {
      id: 'trading',
      tone: 'mint',
      label: t('settings.trading'),
      chips: [
        <Chip key="slip" icon={SetChipBolt}>{s.defaultSlippage}%</Chip>,
        <Chip key="dl" icon={IconClock}>{s.defaultDeadlineMin || 20}{t('settings.minutesShort', 'min')}</Chip>,
        <Chip key="cur">{currencyOf(s.currency).code}</Chip>,
        s.expertMode ? <Chip key="exp" tone="warn">{t('settings.expertMode')}</Chip> : null
      ].filter(Boolean)
    },
    {
      id: 'security',
      tone: 'amber',
      label: t('settings.security'),
      alert: !s.twoFactorEnabled,
      chips: [
        <Chip key="2fa" icon={IconLock} tone={s.twoFactorEnabled ? 'good' : undefined}>2FA</Chip>,
        <Chip key="bio" icon={IconFingerprint} tone={s.biometricEnabled ? 'good' : undefined}>{t('settings.biometric')}</Chip>,
        <Chip key="lock" icon={IconClock}>{s.autoLockMinutes === 0 ? t('settings.never') : `${s.autoLockMinutes}m`}</Chip>
      ]
    },
    {
      id: 'privacy',
      tone: 'purple',
      label: t('settings.privacySection'),
      chips: [<Chip key="tel" tone={s.contributeTelemetry ? 'good' : undefined}>{t('settings.contributeTelemetry')}</Chip>]
    },
    {
      id: 'networks',
      tone: 'orange',
      label: t('settings.networks'),
      chips: [
        <Chip key="evm">{chain?.name || 'EVM'}</Chip>,
        <Chip key="sol">{s.solanaCluster === 'devnet' ? 'Devnet' : 'Mainnet'}</Chip>,
        s.customEvmRpc ? <Chip key="rpc" tone="warn">RPC</Chip> : null
      ].filter(Boolean)
    },
    {
      id: 'data',
      tone: 'cyan',
      label: t('settings.dataStorage'),
      chips: deleteProof ? [<Chip key="del" tone="good">{t('intentAI.lifecycle.deleted')}</Chip>] : []
    },
    ...(firebaseConfigured ? [{
      id: 'sync',
      tone: 'violet',
      label: t('settings.sync'),
      chips: [<Chip key="last" tone={s.lastSyncedAt ? 'good' : undefined}>{s.lastSyncedAt ? fmtSyncedAt(s.lastSyncedAt) : t('settings.neverSynced')}</Chip>]
    }] : []),
    {
      id: 'region',
      tone: 'mint',
      label: t('intentAI.compliance.sectionTitle'),
      alert: regionNeedsAck > 0,
      chips: [
        <Chip key="states" tone={regionNeedsAck ? 'warn' : undefined}>
          {t('settings.hub.regionCount', {
            ok: regionRows.filter((r) => r.state === 'available').length,
            wait: regionNeedsAck,
            off: regionRows.filter((r) => r.state === 'blocked').length,
            defaultValue: '{{ok}} on · {{wait}} to confirm · {{off}} off'
          })}
        </Chip>
      ]
    },
    {
      id: 'about',
      tone: 'magenta',
      label: t('settings.company'),
      chips: [<Chip key="ver">v{APP_VERSION || '—'}</Chip>]
    }
  ];

  const BODIES = {
    profile: bodyProfile,
    notify: bodyNotify,
    appearance: bodyAppearance,
    trading: bodyTrading,
    security: bodySecurity,
    privacy: bodyPrivacy,
    networks: bodyNetworks,
    data: bodyData,
    sync: bodySync,
    region: bodyRegion,
    about: bodyAbout
  };

  const SUB_BODIES = {
    profile: { name: bodyProfileName, lang: bodyProfileLang },
    security: { twofa: bodyTwoFa },
    networks: { rpc: bodyRpc }
  };

  const SUB_TITLES = {
    name: t('profile.username'),
    lang: t('common.language'),
    twofa: t('settings.twoFactorSetup'),
    rpc: t('settings.customRpc')
  };

  const current = sections.find((x) => x.id === active) || null;
  const CurrentIcon = current ? SETTINGS_ICONS[current.id] : null;
  const body = active ? (sub ? SUB_BODIES[active]?.[sub] : BODIES[active]) : null;

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('settings.title')}</h1>
        <p className="muted">{t('settings.subtitle')}</p>
      </motion.div>

      {/* ─── THE PROFILE BOX ────────────────────────────────────────────────
          The example named in the request: one box, one nice icon, and the
          sub-options behind a tap. The avatar is the brand logo in an animated
          ring that flips to a bell when unread notifications exist — see
          components/ProfileBadge.jsx. The two buttons on the other side are the
          only actions kept on the surface, because theme and privacy-peek are
          the two things a person reaches for while standing at this screen. */}
      <motion.section
        className="card set-hero st-tone-cyan"
        variants={riseIn}
        initial="hidden"
        animate="show"
      >
        <div className="set-hero-top">
          {/*
            The badge is a SIBLING of the open button, never inside it.
            ProfileBadge is itself a button (it opens the unread-notifications
            popup), and a <button> inside a <button> is invalid HTML: browsers
            un-nest it, so the avatar either vanished or its tap silently opened
            the profile popup as well. The wrapper only carries the ring's glow.
          */}
          <span className="set-hero-avatar">
            <ProfileBadge />
          </span>
          <button
            type="button"
            className="set-hero-open"
            onClick={() => openSection('profile')}
            aria-haspopup="dialog"
            aria-expanded={active === 'profile'}
            aria-label={t('settings.hub.open', { name: t('settings.profile') })}
          >
            <span className="set-hero-id">
              <span className="set-hero-name">{s.username || t('profile.usernameUnset')}</span>
              <span className="set-hero-sub">
                <strong>{wallet.address ? shortAddress(wallet.address) : t('settings.noWallet')}</strong>
                {' · '}
                {t('settings.hub.openShort')}
              </span>
            </span>
            <span className="set-hero-next" aria-hidden="true">
              <IconChevronRight width={18} height={18} />
            </span>
          </button>

          <div className="set-hero-actions">
            <button
              type="button"
              className={`set-mini${s.theme === 'light' ? ' is-on' : ''}`}
              onClick={cycleTheme}
              title={themeLabel}
              aria-label={`${t('settings.theme')}: ${themeLabel}`}
            >
              {s.theme === 'dark'
                ? <IconMoon width={17} height={17} />
                : s.theme === 'light'
                  ? <IconSun width={17} height={17} />
                  : <SetIconAutoTheme width={17} height={17} />}
            </button>
            <button
              type="button"
              className={`set-mini${s.hideBalances ? ' is-on' : ''}`}
              onClick={() => { haptic?.('light'); s.toggle('hideBalances'); }}
              title={t('settings.hideBalances')}
              aria-label={t('settings.hideBalances')}
              aria-pressed={Boolean(s.hideBalances)}
            >
              <SetIconPrivacy width={17} height={17} />
            </button>
          </div>
        </div>

        <div className="set-hero-chips">
          {chain ? <Chip dot={chain.color}>{chain.short}</Chip> : <Chip>EVM</Chip>}
          <Chip icon={SetChipBolt}>{t('swap.slippage')}: {s.defaultSlippage}%</Chip>
          <Chip icon={IconClock}>{s.defaultDeadlineMin || 20} {t('settings.minutesShort', 'min')}</Chip>
          {s.twoFactorEnabled && <Chip icon={IconLock} tone="good">2FA</Chip>}
          {s.biometricEnabled && <Chip icon={IconFingerprint} tone="good">{t('settings.biometric')}</Chip>}
        </div>
      </motion.section>

      {/* ─── THE LIST: one full-width box per section ────────────────────────
          The heading is a designed part of the screen now: its own SVG glyph
          (a 2×2 layout mark, the active cell ticked), the section count and
          the tap hint — not faint uppercase text with nothing to look at. */}
      <div className="set-hub-label">
        <span className="set-hub-label-ico" aria-hidden="true">
          <SetIconSections width={18} height={18} />
        </span>
        <h2>{t('settings.hub.groups')}</h2>
        <span className="set-hub-label-count" aria-hidden="true">{sections.length}</span>
        <span className="set-hub-label-hint">
          <SetIconSections width={12} height={12} />
          {t('settings.hub.tapHint')}
        </span>
      </div>

      <div className="set-hub">
        {sections.map((sec) => {
          const TileIcon = SETTINGS_ICONS[sec.id];
          return (
            <button
              key={sec.id}
              type="button"
              className={`set-tile set-hub-in st-tone-${sec.tone}`}
              data-alert={sec.alert ? 'true' : 'false'}
              onClick={() => openSection(sec.id)}
              aria-haspopup="dialog"
              aria-expanded={active === sec.id}
              aria-label={t('settings.hub.open', { name: sec.label })}
            >
              <span className="set-tile-ico" aria-hidden="true">
                <TileIcon />
              </span>
              <span className="set-tile-body">
                <span className="set-tile-title">{sec.label}</span>
                <span className="set-tile-sub">{t(`settings.hub.hints.${sec.id}`)}</span>
                {sec.chips && sec.chips.length > 0 && (
                  <span className="set-tile-chips">
                    {sec.chips.slice(0, 3)}
                  </span>
                )}
              </span>
              <span className="set-tile-next" aria-hidden="true">
                <SetIconTileNext width={15} height={15} />
              </span>
            </button>
          );
        })}
      </div>

      {/*
        The extra confirmation a restricted feature promises. It names the
        feature and the reason the region restricts it, and it says outright
        that it does not authorise execution — acknowledging a restriction is
        not a signature, and a sheet that implied otherwise would be worse than
        no button at all.
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

      {/* ─── THE SECTION POPUP ─────────────────────────────────────────────
          The header (icon + name + close) is fixed and only the body scrolls,
          so a long section can never push the close button out of reach. */}
      <Sheet
        open={Boolean(active)}
        onClose={closeSection}
        size="lg"
        /* The popup is portalled to <body>, outside every tone element, so
           the section's tone class travels ON the sheet itself — that is what
           paints the header icon, the row wells and the chosen chips in the
           same colour as the box that opened them. */
        className={current ? `st-tone-${current.tone}` : undefined}
        title={
          current ? (
            <span className="set-sheet-title">
              {sub ? (
                <button type="button" className="set-sheet-back" onClick={() => setSub(null)} aria-label={t('common.back')}>
                  <SetIconBack width={16} height={16} />
                </button>
              ) : null}
              <span className="set-sheet-title-ico" aria-hidden="true">
                <CurrentIcon width={17} height={17} />
              </span>
              <span className="set-sheet-title-text">{sub ? SUB_TITLES[sub] : current.label}</span>
            </span>
          ) : null
        }
      >
        <div className={`set-sheet${sub ? ' set-subview' : ''}`} role="region" aria-label={current?.label}>
          {/*
            The body is keyed, so switching section or level remounts it and the
            popup starts scrolled at the top of the new content. It is animated
            IN only, with no exit and no AnimatePresence mode="wait": waiting for
            the old body to finish fading meant that opening the next tile showed
            the PREVIOUS section for ~160ms — long enough that a fast follower
            taps what they can see, which is the wrong section.
          */}
          <motion.div
            key={sub || active || 'none'}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={still ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {body}
          </motion.div>

          {sub ? null : (
            <div className="set-sheet-foot">
              <button type="button" className="btn btn-ghost" onClick={closeSection}>
                {t('settings.hub.done')}
              </button>
            </div>
          )}
        </div>
      </Sheet>

      {/*
        Phase 92 — deletion is irreversible, so it gets its own dialog with an
        explicit affirmative ("Yes, delete everything") rather than a bare OK.
        Sheet supplies role="dialog", aria-modal="true" and Escape-to-close.
        It stays a dialog of its own rather than a level of the section popup,
        because closing the section must never look like dismissing the warning.
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

      {/*
        Phase 100: explicit confirmation for the full exit, same rules as
        deletion — no affirmative, no exit. The cancel button used to read
        `intentAI.sovereignty.cancel`, a key that exists in no locale, so the
        dialog printed the raw key where the word "Cancel" should have been.
      */}
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
          <button type="button" className="btn btn-ghost" onClick={() => setExitOpen(false)} data-testid="sovereignty-cancel-button">
            {t('intentAI.lifecycle.cancel')}
          </button>
        </div>
      </Sheet>
    </PageTransition>
  );
}
