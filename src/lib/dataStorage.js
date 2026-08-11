/**
 * Data and storage helpers for Settings:
 *   • clearAppCache: clear prices, charts, and token lists without touching wallet/security
 *   • exportSettingsBackup: export personal preferences & watchlist to JSON file
 */

import { useSettingsStore } from '../store/useSettingsStore';
import { useAppStore } from '../store/useAppStore';
import { clearApiCache } from './api';
import { clearTokenListCache } from './tokenLists';
import { clearNewsCache } from './news';

const isNative = () => typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
export const SETTINGS_BACKUP_FILENAME = 'fbt-settings-backup.json';

const PRESERVED_KEYS = new Set([
  'fbt-settings-v1',
  'fbt-wallet-v1',
  'fbt-app-v1',
  'fbt-price-alerts-v1',
  'fbt-orders-v1',
  'fbt-lang',
  'fbt-auto-lock-away',
  'fbt-install-dismiss',
  'fbt-install-dismissed',
  'fbt-swap-v1',
  'fbt-radio-v1',
  'fbt-referred-by',
  'fbt-referred-at'
]);

/**
 * Clear temporary caches (prices, charts, token lists).
 * Fully preserves wallet keys, password, and user security settings.
 */
export function clearAppCache() {
  clearApiCache();
  clearTokenListCache();
  clearNewsCache();

  if (typeof localStorage !== 'undefined') {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (!PRESERVED_KEYS.has(key)) {
          if (
            key.startsWith('fbt-tokens-') ||
            key.startsWith('fbt-token-') ||
            key.startsWith('fbt-news-') ||
            key.includes('cache') ||
            key.includes('chart') ||
            key.includes('temp') ||
            key.includes('market')
          ) {
            toRemove.push(key);
          }
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch {}
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.clear();
    } catch {}
  }
}

function buildSettingsPayload() {
  const s = useSettingsStore.getState();
  const app = useAppStore.getState();

  return JSON.stringify(
    {
      _type: 'fbt-swap-settings-backup',
      _version: 1,
      exportedAt: Date.now(),
      settings: {
        theme: s.theme,
        accent: s.accent,
        currency: s.currency,
        username: s.username,
        reduceMotion: s.reduceMotion,
        compactMode: s.compactMode,
        hideBalances: s.hideBalances,
        autoLockMinutes: s.autoLockMinutes,
        defaultSlippage: s.defaultSlippage,
        defaultDeadlineMin: s.defaultDeadlineMin || 20,
        expertMode: s.expertMode,
        evmChainId: s.evmChainId,
        solanaCluster: s.solanaCluster,
        customEvmRpc: s.customEvmRpc
      },
      watchlist: app.favorites || []
    },
    null,
    2
  );
}

/**
 * Save settings backup to a JSON file.
 */
export async function exportSettingsBackup() {
  const json = buildSettingsPayload();

  if (isNative()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');

    await Filesystem.writeFile({
      path: SETTINGS_BACKUP_FILENAME,
      data: json,
      directory: Directory.External,
      encoding: Encoding.UTF8,
      recursive: true
    });

    const { uri } = await Filesystem.getUri({
      directory: Directory.External,
      path: SETTINGS_BACKUP_FILENAME
    });

    return { ok: true, native: true, path: SETTINGS_BACKUP_FILENAME, uri };
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = SETTINGS_BACKUP_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  return { ok: true, native: false, path: SETTINGS_BACKUP_FILENAME };
}
