/**
 * User preferences: theme, profile, security, onboarding state.
 *
 * Persisted locally first. Firebase sync (see src/lib/firebase.js) is layered
 * on top and is optional — the app is fully functional with no account, which
 * matters for a DEX where forcing a signup would be a privacy regression.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { currencyOf } from '../lib/currency';
import { setDisplaySymbol, setHideBalances } from '../lib/format';

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      /* ---------------- appearance ---------------- */
      /*
       * ─── DARK IS THE DEFAULT ────────────────────────────────────────────
       * Requested: «تم مشکی هم تم دیفالت باشد».
       *
       * It is also the right default for this product rather than only a
       * preference. The whole visual system — the RGB accent spectrum, the
       * animated backdrop, the neon up/down colours, the card sheen — was
       * designed against a black canvas. Light theme is a careful adaptation
       * of it; dark is the original.
       *
       * ─── THIS VALUE IS COUPLED TO index.html ────────────────────────────
       * The boot overlay paints before React exists, so its colours are
       * hard-coded in the HTML. If the two disagree, every fresh install
       * shows one frame of the wrong colour and then snaps — which reads as
       * a rendering fault rather than a theme.
       *
       * Both were changed together: index.html now boots dark and its
       * pre-paint script overrides to LIGHT for a user who chose it, which is
       * the exact mirror of what it did before.
       */
      theme: 'dark', // 'light' | 'dark' | 'auto'
      accent: 'rgb', // 'rgb' | 'cyan' | 'magenta' | 'mint'
      reduceMotion: false,
      compactMode: false,
      currency: 'USD',

      /* ---------------- profile ---------------- */
      username: '',
      avatarSeed: null,

      /* ---------------- security ---------------- */
      biometricEnabled: false,
      biometricCredentialId: null,
      twoFactorEnabled: false,
      twoFactorSecret: null, // TOTP secret, stored encrypted by the caller
      autoLockMinutes: 5,
      hideBalances: false,
      txConfirmations: true,
      expertMode: false,
      defaultSlippage: 0.5,
      defaultDeadlineMin: 20,

      /* ---------------- networks ---------------- */
      // Testnet is opt-in and off by default: this is a commercial product and
      // the default experience must be the real one.
      testnetMode: false,
      evmChainId: 56,
      solanaCluster: 'mainnet-beta',
      solanaRpc: '',
      customEvmRpc: '', // always show the review sheet before signing

      /* ---------------- onboarding ---------------- */
      onboarded: false,
      termsAcceptedAt: 0,
      // The four-part guide (swap / predict / wallet / security) is shown once
      // on first launch and gates the rest of the app until acknowledged.
      // Kept separate from `onboarded` so an existing install that already
      // finished onboarding still sees the guide once.
      guideReadAt: 0,

      /* ---------------- privacy ---------------- */
      /*
       * STRICTLY OPT-IN: the learning core only ever receives telemetry from
       * users who enabled this here. The token is the consent proof sent
       * with every submission — the server rejects anything without it (401).
       * It is generated on THIS device, is never uploaded (exportSyncable
       * and applyRemote both ignore it) and is wiped on opt-out.
       */
      contributeTelemetry: false,
      telemetryToken: '',

      /* ---------------- sync ---------------- */
      cloudSync: false,
      lastSyncedAt: 0,

      /* ---------------- actions ---------------- */
      setTheme(theme) {
        set({ theme });
        applyTheme(theme);
      },
      setAccent(accent) {
        set({ accent });
        applyAccent(accent);
      },
      setUsername(username) {
        set({ username: String(username).slice(0, 24) });
      },
      toggle(key) {
        set((s) => ({ [key]: !s[key] }));
      },
      setSlippage(v) {
        set({ defaultSlippage: Math.min(50, Math.max(0.05, Number(v) || 0.5)) });
      },
      setDefaultDeadlineMin(minutes) {
        const allowed = [5, 10, 20, 30, 60];
        const val = Number(minutes);
        set({ defaultDeadlineMin: allowed.includes(val) ? val : 20 });
      },
      setEvmChain(id) {
        set({ evmChainId: Number(id) || 56 });
      },
      setSolanaCluster(c) {
        set({ solanaCluster: c });
      },
      setRpc(key, url) {
        set({ [key]: String(url).slice(0, 200) });
      },
      setCurrency(currency) {
        set({ currency });
      },
      setAutoLock(minutes) {
        set({ autoLockMinutes: Math.max(0, Math.min(120, Number(minutes) || 0)) });
      },
      enableBiometric(credentialId) {
        set({ biometricEnabled: true, biometricCredentialId: credentialId });
      },
      disableBiometric() {
        set({ biometricEnabled: false, biometricCredentialId: null });
      },

      enable2FA(secret) {
        set({ twoFactorEnabled: true, twoFactorSecret: secret });
      },
      disable2FA() {
        set({ twoFactorEnabled: false, twoFactorSecret: null });
      },
      acceptTerms() {
        set({ termsAcceptedAt: Date.now() });
      },
      /**
       * Opt in/out of anonymous telemetry. Enabling mints a device-local
       * consent token (`ct1:` + 32 hex) that the telemetry hook sends with
       * every submission; disabling wipes it so no further record can be
       * written. crypto.getRandomValues where available, Math.random as the
       * jsdom/test fallback — this is consent evidence, not a secret.
       */
      setContributeTelemetry(on) {
        if (!on) {
          set({ contributeTelemetry: false, telemetryToken: '' });
          return;
        }
        let hex = '';
        try {
          const buf = new Uint8Array(16);
          crypto.getRandomValues(buf);
          hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch {
          for (let i = 0; i < 32; i += 1) hex += Math.floor(Math.random() * 16).toString(16);
        }
        set({ contributeTelemetry: true, telemetryToken: `ct1:${hex}` });
      },
      completeOnboarding() {
        set({ onboarded: true });
      },
      resetOnboarding() {
        set({ onboarded: false, guideReadAt: 0 });
      },
      markGuideRead() {
        set({ guideReadAt: Date.now() });
      },
      /** Lets the user replay the guide from Help without redoing onboarding. */
      replayGuide() {
        set({ guideReadAt: 0 });
      },
      markSynced() {
        set({ lastSyncedAt: Date.now() });
      },

      /** Everything safe to mirror to the cloud — never keys or secrets. */
      exportSyncable() {
        const s = get();
        return {
          theme: s.theme,
          accent: s.accent,
          username: s.username,
          reduceMotion: s.reduceMotion,
          hideBalances: s.hideBalances,
          autoLockMinutes: s.autoLockMinutes,
          defaultSlippage: s.defaultSlippage,
          defaultDeadlineMin: s.defaultDeadlineMin
        };
      },

      applyRemote(remote = {}) {
        const allowed = ['theme', 'accent', 'username', 'reduceMotion', 'hideBalances', 'autoLockMinutes', 'defaultSlippage', 'defaultDeadlineMin'];
        const patch = {};
        allowed.forEach((k) => {
          if (remote[k] !== undefined) patch[k] = remote[k];
        });
        set(patch);
        if (patch.theme) applyTheme(patch.theme);
        if (patch.accent) applyAccent(patch.accent);
      }
    }),
    {
      name: 'fbt-settings-v1',
      // 2FA secret stays out of the synced payload by construction
      partialize: (s) => {
        const { twoFactorSecret, ...rest } = s;
        return { ...rest, twoFactorSecret };
      }
    }
  )
);

/* -------------------------------------------------------------------------- */
/* DOM application                                                            */
/* -------------------------------------------------------------------------- */

export function resolveTheme(theme) {
  if (theme === 'auto') {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  return theme;
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute('data-theme', resolved);
  // keep the Telegram chrome in step with the app
  const tg = window.Telegram?.WebApp;
  const bg = resolved === 'light' ? '#f4f5fa' : '#000000';
  tg?.setHeaderColor?.(bg);
  tg?.setBackgroundColor?.(bg);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

/*
 * ─── ACCENT PALETTES ────────────────────────────────────────────────────────
 * `pastel` was added on request: the same hue family as the default, softened.
 *
 * It is an EXTRA option rather than a replacement, and that is deliberate.
 * Measured against white, the pastel tones land at 1.5-2.2:1 — WCAG AA wants
 * 4.5:1 for text — so making them the default would have quietly broken every
 * place the accent is used as a text or icon colour in light theme (16 rules
 * in index.css). The light theme therefore remaps them to darker `--ink-*`
 * counterparts of the same hue, all measured at 5.4-6.6:1 against white.
 *
 * On dark they need no help: 9.5-14:1 against black.
 */
const ACCENTS = {
  rgb: ['#00e5ff', '#7c4dff', '#ff2d95'],
  cyan: ['#00e5ff', '#0091ea', '#00b8d4'],
  magenta: ['#ff2d95', '#d500f9', '#ff6d00'],
  mint: ['#00ff9d', '#00e5ff', '#64dd17'],
  pastel: ['#7fd8e8', '#b3a4f5', '#f5a3c7']
};

export function applyAccent(accent) {
  if (typeof document === 'undefined') return;
  const key = ACCENTS[accent] ? accent : 'rgb';
  const [a, b, c] = ACCENTS[key];
  const root = document.documentElement;
  root.style.setProperty('--rgb-1', a);
  root.style.setProperty('--rgb-2', b);
  root.style.setProperty('--rgb-3', c);
  /*
   * Let CSS know which palette is active. The light theme needs it to swap in
   * the readable --ink-* variants: a pastel used as TEXT on white measures
   * ~2:1, which is unreadable, while the same pastel as a BACKGROUND behind
   * black text is fine. Only CSS knows which role each usage plays, so the
   * decision belongs there rather than here.
   */
  root.setAttribute('data-accent', key);
}

/** Call once at boot. */
export function applyCompact(on) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-compact', on ? 'true' : 'false');
}

/**
 * Mark the document when running inside the packaged app.
 *
 * CSS needs to know: a Capacitor WebView composites through the host app and
 * shares a GPU with the native layer, so effects a browser tab absorbs without
 * complaint (full-screen backdrop blurs, permanently animating 70px-blurred
 * orbs) are what make the APK feel heavier than the website while running
 * identical code.
 *
 * Set on <html> rather than derived with a sibling selector, because the
 * elements that need it - sheet backdrops - are portalled into <body>, outside
 * the React tree where the background field lives. A `.rgb-still ~ *` rule
 * would have looked right and matched nothing.
 */
/**
 * Push the chosen currency's symbol into the formatter.
 *
 * Without this the selector wrote a value nobody read: every price kept its
 * hardcoded `$`. Legacy stores may still hold 'IRT' - currencyOf() maps
 * anything unsupported back to USD so those installs do not render
 * `undefined` beside every number after upgrading.
 */
export function applyCurrency(code) {
  setDisplaySymbol(currencyOf(code).symbol);
}

/*
 * Push `hideBalances` into the formatter.
 *
 * The toggle used to write the flag and stop there — Settings drew its own
 * switch from it and no balance on any screen ever consulted it, so the
 * feature did nothing at all. Masking now happens inside fmtUsd/fmtCompact/
 * fmtQty, and this is what tells them.
 */
export function applyHideBalances(on) {
  setHideBalances(on);
}

export function applyNativeFlag() {
  if (typeof document === 'undefined') return;
  const native = Boolean(window.Capacitor?.isNativePlatform?.());
  document.documentElement.setAttribute('data-native', native ? 'true' : 'false');
}

export function initTheme() {
  const { theme, accent, compactMode } = useSettingsStore.getState();
  applyTheme(theme);
  applyAccent(accent);
  applyCompact(compactMode);
  applyCurrency(useSettingsStore.getState().currency);
  applyHideBalances(useSettingsStore.getState().hideBalances);
  applyNativeFlag();
  // Re-apply whenever the user changes it, so prices update without a reload.
  useSettingsStore.subscribe((st) => applyCurrency(st.currency));
  useSettingsStore.subscribe((st) => applyHideBalances(st.hideBalances));
  useSettingsStore.subscribe((st) => applyCompact(st.compactMode));

  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
      if (useSettingsStore.getState().theme === 'auto') applyTheme('auto');
    });
  }
}
