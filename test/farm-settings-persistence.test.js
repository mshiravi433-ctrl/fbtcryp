// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../src/store/useSettingsStore.js';
import { SETTINGS_STORAGE_KEY, WALLET_LEASE_DEFAULT_MINUTES } from '../src/lib/walletSessionPolicy.js';

const POOL_ID = '7d33d57d-36dc-414b-9538-22a223250468';

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().setFarmWatchlist([]);
});
afterEach(() => localStorage.clear());

describe('Farm preferences in the general settings persistence layer', () => {
  it('persists and sanitizes a wallet-free watchlist and threshold alert config', () => {
    const store = useSettingsStore.getState();
    store.setFarmWatchlist([POOL_ID, 'bad id', POOL_ID]);
    useSettingsStore.getState().setFarmRateAlert(POOL_ID, { threshold: 5.5, direction: 'above', enabled: true });

    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
    expect(saved.version).toBe(3);
    expect(saved.state.farmWatchlist).toEqual([POOL_ID]);
    expect(saved.state.farmRateAlerts[POOL_ID]).toEqual({ enabled: true, direction: 'above', threshold: 5.5 });
    expect(useSettingsStore.getState().exportSyncable()).toMatchObject({
      farmWatchlist: [POOL_ID],
      farmRateAlerts: { [POOL_ID]: { enabled: true, direction: 'above', threshold: 5.5 } }
    });
  });

  it('removing a pool clears its alert and remote settings stay allowlisted', () => {
    useSettingsStore.getState().setFarmWatchlist([POOL_ID]);
    useSettingsStore.getState().setFarmRateAlert(POOL_ID, { threshold: 10, direction: 'below', enabled: true });
    useSettingsStore.getState().toggleFarmWatchlist(POOL_ID);
    expect(useSettingsStore.getState().farmWatchlist).toEqual([]);
    expect(useSettingsStore.getState().farmRateAlerts).toEqual({});

    useSettingsStore.getState().applyRemote({
      farmWatchlist: [POOL_ID, 'unsafe id'],
      farmRateAlerts: {
        [POOL_ID]: { threshold: 12, direction: 'below', enabled: true },
        'not-watched': { threshold: 99, direction: 'above', enabled: true }
      },
      twoFactorSecret: 'must-not-sync'
    });
    expect(useSettingsStore.getState().farmWatchlist).toEqual([POOL_ID]);
    expect(useSettingsStore.getState().farmRateAlerts).toEqual({
      [POOL_ID]: { enabled: true, direction: 'below', threshold: 12 }
    });
    expect(useSettingsStore.getState().twoFactorSecret).not.toBe('must-not-sync');
  });

  it('adds Farm defaults without disturbing the existing wallet-session migration', () => {
    const migrated = useSettingsStore.persist.getOptions().migrate({
      walletSessionMinutes: 60,
      farmWatchlist: [POOL_ID],
      farmRateAlerts: { [POOL_ID]: { threshold: 4, direction: 'above', enabled: true } }
    });
    expect(migrated.walletSessionMinutes).toBe(WALLET_LEASE_DEFAULT_MINUTES);
    expect(migrated.farmWatchlist).toEqual([POOL_ID]);
    expect(migrated.farmRateAlerts[POOL_ID].enabled).toBe(true);
  });
});
