// @vitest-environment jsdom
/**
 * THE WALLET SESSION MUST SURVIVE A REFRESH — FOR BOTH WALLETS.
 * ---------------------------------------------------------------------------
 *   «قبلا درست بود ولی الان درست نیست … اتصال ولت روی همین دستگاه نمیاد»
 *   «کیف مول اصلی و سولانا باید باشد روی کش دستگاه و با رفرش نباید بره،
 *    یعنی حداقل یک ماه باشه»
 *
 * Every case below is a bug that shipped and was invisible in review, because
 * each one is a mismatch BETWEEN two files that are individually correct:
 *
 *   1. The deeplink module read `fbt-settings`; the store writes
 *      `fbt-settings-v1`. Every read missed, so the user's chosen session
 *      length never reached Solana and a hardcoded 60 minutes won instead.
 *   2. The lease duration was clamped to 24 HOURS, so a month was not merely
 *      unset — it was unrepresentable, and the picker offered no way to ask.
 *   3. The MWA address lived only in a module variable, so every refresh
 *      disconnected Solana even though the wallet's own authorization cache
 *      still held the grant.
 *   4. The default was an hour — a lapse the user did nothing to cause.
 *
 * Storage is real and the store is the real store, so the "a refresh is not a
 * clear" claim is tested against the same bytes a reload would read. No
 * network, no wallet, no browser.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_LEASE_MINUTES,
  MONTH_MINUTES,
  SETTINGS_STORAGE_KEY,
  WALLET_LEASE_DEFAULT_MINUTES,
  WALLET_SESSION_CHOICES,
  chosenLeaseMinutes,
  describeLeaseMinutes,
  readPersistedLeaseMinutes,
  walletLeaseMinutes
} from '../src/lib/walletSessionPolicy.js';
import * as lease from '../src/lib/wc/lease.js';
import { useSettingsStore } from '../src/store/useSettingsStore.js';

const ADDR = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().setWalletSessionMinutes(WALLET_LEASE_DEFAULT_MINUTES);
});
afterEach(() => localStorage.clear());

describe('the lease policy is ONE policy', () => {
  it('allows a month, a year, and never-expiry', () => {
    expect(walletLeaseMinutes(MONTH_MINUTES)).toBe(MONTH_MINUTES);
    expect(walletLeaseMinutes(MAX_LEASE_MINUTES)).toBe(MAX_LEASE_MINUTES);
    expect(walletLeaseMinutes(0)).toBe(0);
  });

  it('does NOT silently cap a month at a day — the old clamp did exactly that', () => {
    /* The bug: `Math.min(24 * 60, …)`. A user who asked for a month was stored
       as 24h, with no way to find out. */
    expect(MONTH_MINUTES).toBeGreaterThan(24 * 60);
    expect(walletLeaseMinutes(MONTH_MINUTES)).not.toBe(24 * 60);
  });

  it('offers a long option in the picker, not only short ones', () => {
    expect(WALLET_SESSION_CHOICES).toContain(MONTH_MINUTES);
    expect(WALLET_SESSION_CHOICES).toContain(0);
    expect(WALLET_SESSION_CHOICES).toContain(15);
  });

  it('never turns a corrupted value into «never expires»', () => {
    expect(walletLeaseMinutes('nonsense', 60)).toBe(60);
    expect(walletLeaseMinutes(-5, 60)).toBe(60);
  });

  it('does not read an ABSENT preference as «never expires»', () => {
    /* `Number(null)`, `Number('')` and `Number([])` are all 0 — which is the
       never-expire value. A settings read that came back empty (missing key,
       blank field, partial object) would otherwise hand every wallet a
       permanent session. This is the one coercion that must never be trusted. */
    for (const empty of [null, undefined, '', [], {}, true, NaN]) {
      expect(walletLeaseMinutes(empty, 60)).toBe(60);
    }
  });

  it('the EVM lease and the policy agree, so the two cannot drift again', () => {
    for (const v of [15, 60, 1440, MONTH_MINUTES, 0, 99999999]) {
      expect(lease.walletLeaseMinutes(v)).toBe(walletLeaseMinutes(v));
    }
  });

  it('describes a month legibly instead of printing «43200»', () => {
    expect(describeLeaseMinutes(MONTH_MINUTES)).toBe('1mo');
    expect(describeLeaseMinutes(7 * 24 * 60)).toBe('7d');
    expect(describeLeaseMinutes(60)).toBe('1h');
    expect(describeLeaseMinutes(15)).toBe('15m');
    expect(describeLeaseMinutes(0)).toBeNull();
  });
});

describe('the chosen duration REACHES the wallet it was chosen for', () => {
  it('reads the value the user actually picked, not a fallback', () => {
    useSettingsStore.getState().setWalletSessionMinutes(MONTH_MINUTES);
    expect(chosenLeaseMinutes()).toBe(MONTH_MINUTES);
  });

  it('looks in the store\'s REAL storage key — the bug in one line', () => {
    /* `fbt-settings` was read; the store writes `fbt-settings-v1`; so the
       preference was invisible to Solana forever. */
    expect(SETTINGS_STORAGE_KEY).toBe('fbt-settings-v1');
    expect(SETTINGS_STORAGE_KEY).not.toBe('fbt-settings');
  });

  it('finds a preference written under the pre-versioned key too', () => {
    /* A device that connected before the store was versioned has ONLY the old
       key; its choice must not be dropped by the rename. */
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    localStorage.setItem('fbt-settings', JSON.stringify({ state: { walletSessionMinutes: 180 } }));
    expect(readPersistedLeaseMinutes()).toBe(180);
    expect(chosenLeaseMinutes()).toBe(180);
  });

  it('prefers the current key when a device somehow has both', () => {
    /* Migration writes the new key but never deletes the old, so a half-migrated
       device can carry both. The live one is the truth. */
    localStorage.setItem('fbt-settings', JSON.stringify({ state: { walletSessionMinutes: 180 } }));
    useSettingsStore.getState().setWalletSessionMinutes(24 * 60);
    expect(readPersistedLeaseMinutes()).toBe(24 * 60);
  });

  it('honours «until I disconnect» rather than rounding it to a day', () => {
    useSettingsStore.getState().setWalletSessionMinutes(0);
    expect(chosenLeaseMinutes()).toBe(0);
  });
});

describe('a lease survives a refresh', () => {
  it('is still there, alive, a month later', () => {
    const at = Date.now();
    expect(lease.writeWalletLease({ address: ADDR, mode: 'injected', minutes: MONTH_MINUTES, at })).toBeTruthy();

    /* A refresh is a new document reading the same bytes — nothing above
       touched storage, exactly as a reload does not. */
    const monthLater = at + MONTH_MINUTES * 60_000;
    const still = lease.readWalletLease({ at: monthLater - 60_000 });
    expect(still).toBeTruthy();
    expect(still.alive).toBe(true);
    expect(still.address).toBe(ADDR);
    expect(still.mode).toBe('injected');

    /* and it does lapse eventually, so a lease is not a permanent grant */
    expect(lease.readWalletLease({ at: monthLater + 86_400_000 }).alive).toBe(false);
  });

  it('an injected wallet is re-attached SILENTLY, never with a prompt', () => {
    const at = Date.now();
    lease.writeWalletLease({ address: ADDR, mode: 'injected', minutes: MONTH_MINUTES, at });
    const plan = lease.walletRestorePlan({ lease: lease.readWalletLease({ at: at + 1000 }) });
    expect(plan.action).toBe('injected');
  });

  it('a FIRST connection still needs the wallet, whatever a lease says', () => {
    /* The lease is a convenience record, never an approval. */
    expect(lease.walletRestorePlan({})).toEqual({ action: 'none', expired: false });
  });
});

describe('the store agrees with the policy', () => {
  it('accepts a month, where it used to clamp to a day', () => {
    useSettingsStore.getState().setWalletSessionMinutes(MONTH_MINUTES);
    expect(useSettingsStore.getState().walletSessionMinutes).toBe(MONTH_MINUTES);
  });

  it('still refuses a value beyond a year', () => {
    useSettingsStore.getState().setWalletSessionMinutes(10 * MAX_LEASE_MINUTES);
    expect(useSettingsStore.getState().walletSessionMinutes).toBe(MAX_LEASE_MINUTES);
  });

  it('the old hour-long default is migrated, or the fix ships and does nothing', () => {
    /* Changing a DEFAULT only helps a fresh install. Every device that had
       already connected had 60 in its own storage and would keep it forever,
       so the behaviour the report asked for would appear to do nothing. */
    const store = useSettingsStore.persist.getOptions();
    const migrated = store.migrate({ walletSessionMinutes: 60 });
    expect(migrated.walletSessionMinutes).toBe(MONTH_MINUTES);
  });

  it('the migration leaves a deliberate choice alone', () => {
    const store = useSettingsStore.persist.getOptions();
    /* 0 is «until I disconnect» and 15 is the strict window — neither is the
       old default, so neither may be overwritten. */
    expect(store.migrate({ walletSessionMinutes: 0 }).walletSessionMinutes).toBe(0);
    expect(store.migrate({ walletSessionMinutes: 15 }).walletSessionMinutes).toBe(15);
  });

  it('the migration also clamps a value that outran the new maximum', () => {
    const store = useSettingsStore.persist.getOptions();
    expect(store.migrate({ walletSessionMinutes: 99 * MAX_LEASE_MINUTES }).walletSessionMinutes)
      .toBe(MAX_LEASE_MINUTES);
  });
});
