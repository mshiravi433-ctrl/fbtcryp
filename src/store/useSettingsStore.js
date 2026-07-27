/**
 * User preferences: theme, profile, security, onboarding state.
 *
 * Persisted locally first. Firebase sync (see src/lib/firebase.js) is layered
 * on top and is optional — the app is fully functional with no account, which
 * matters for a DEX where forcing a signup would be a privacy regression.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      /* ---------------- appearance ---------------- */
      theme: 'dark', // 'dark' | 'light' | 'auto'
      accent: 'rgb', // 'rgb' | 'cyan' | 'magenta' | 'mint'
      reduceMotion: false,

      /* ---------------- profile ---------------- */
      username: '',
      avatarSeed: null,

      /* ---------------- security ---------------- */
      biometricEnabled: false,
      twoFactorEnabled: false,
      twoFactorSecret: null, // TOTP secret, stored encrypted by the caller
      autoLockMinutes: 5,
      hideBalances: false,
      txConfirmations: true, // always show the review sheet before signing

      /* ---------------- onboarding ---------------- */
      onboarded: false,

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
      setAutoLock(minutes) {
        set({ autoLockMinutes: Math.max(0, Math.min(120, Number(minutes) || 0)) });
      },
      enable2FA(secret) {
        set({ twoFactorEnabled: true, twoFactorSecret: secret });
      },
      disable2FA() {
        set({ twoFactorEnabled: false, twoFactorSecret: null });
      },
      completeOnboarding() {
        set({ onboarded: true });
      },
      resetOnboarding() {
        set({ onboarded: false });
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
          autoLockMinutes: s.autoLockMinutes
        };
      },

      applyRemote(remote = {}) {
        const allowed = ['theme', 'accent', 'username', 'reduceMotion', 'hideBalances', 'autoLockMinutes'];
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

const ACCENTS = {
  rgb: ['#00e5ff', '#7c4dff', '#ff2d95'],
  cyan: ['#00e5ff', '#0091ea', '#00b8d4'],
  magenta: ['#ff2d95', '#d500f9', '#ff6d00'],
  mint: ['#00ff9d', '#00e5ff', '#64dd17']
};

export function applyAccent(accent) {
  if (typeof document === 'undefined') return;
  const [a, b, c] = ACCENTS[accent] ?? ACCENTS.rgb;
  const root = document.documentElement;
  root.style.setProperty('--rgb-1', a);
  root.style.setProperty('--rgb-2', b);
  root.style.setProperty('--rgb-3', c);
}

/** Call once at boot. */
export function initTheme() {
  const { theme, accent } = useSettingsStore.getState();
  applyTheme(theme);
  applyAccent(accent);

  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
      if (useSettingsStore.getState().theme === 'auto') applyTheme('auto');
    });
  }
}
