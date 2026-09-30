/**
 * THE WALLET SESSION POLICY — one place, both wallets.
 * ---------------------------------------------------------------------------
 *   «در مورد کیف مول اصلی و سولانا باید باشد روی کش دستگاه و با رفرش نباید
 *    بره یعنی حداقل یکماه باشه و اینکه با رفرش نره مهم است که هر بار کاربر
 *    نخواهد کیف پول وصل کند»
 *
 * ─── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 * Two wallets, two storage keys, two clamps, and a default that had drifted
 * apart so far that the setting the user actually chose in Settings → Security
 * NEVER REACHED SOLANA. The deeplink module read `fbt-settings`; the store has
 * written `fbt-settings-v1` since it was versioned. Every read missed, so
 * Solana silently fell back to a hardcoded 60 minutes while the EVM side
 * honoured the preference — which is why «before it worked, now it doesn't»
 * was true for one wallet and not the other, on the same device, at the same
 * time.
 *
 * A preference that reaches one of two consumers is not a preference. So the
 * key, the clamp, the choices and the default now live HERE, and both wallets
 * import them. There is no second copy to fall out of step.
 *
 * ─── WHAT THE DURATION ACTUALLY CONTROLS ──────────────────────────────────
 * It is a LEASE, not a key and not an approval. The record it produces is
 * `{ address, mode, expiresAt }` — a public address and a deadline. Nothing a
 * thief could turn into money: the worst it can do is make the app ask the
 * wallet to re-attach a session the user already approved, and an injected
 * re-attach still needs the wallet itself to be unlocked. A FIRST connection
 * always requires an explicit approval in the wallet, whatever this says, and
 * `0` («until I disconnect») is always available for anyone who wants the
 * strictest option.
 *
 * ─── WHY 30 DAYS IS THE DEFAULT NOW ───────────────────────────────────────
 * It is what was asked for, and it is defensible: a lease that lapses forces a
 * wallet round trip for a user who did nothing wrong, and on a phone that
 * round trip is the single most common reason people believe the app lost
 * their wallet. The cost is bounded — the lease is a convenience record, it
 * expires on its own, it is listed in Settings with the remaining time, and
 * one tap disconnects. Users who want less get 15 minutes; users who want the
 * strictest get `0`.
 */
/** Where the settings store persists. Bumping this abandons old settings. */
export const SETTINGS_STORAGE_KEY = 'fbt-settings-v1';

/** A month, in minutes — the default every transport now starts from. */
export const MONTH_MINUTES = 30 * 24 * 60;

/**
 * The longest lease that can be stored.
 *
 * A year, not infinity: `0` already means «never expires», so a long finite
 * upper bound is about keeping a corrupted or hand-edited record from parking
 * a re-attach decades out, not about limiting the user.
 */
export const MAX_LEASE_MINUTES = 365 * 24 * 60;

/** A fresh install, and the value a stale setting is migrated to. */
export const WALLET_LEASE_DEFAULT_MINUTES = MONTH_MINUTES;

/**
 * What Settings offers, in minutes. `0` is «until I disconnect».
 *
 * Both short and long, because the people who need a session not to lapse are
 * not the people who want it to lapse in fifteen minutes — offering only short
 * options made the requested behaviour unreachable by hand, not just by
 * default.
 */
export const WALLET_SESSION_CHOICES = Object.freeze([
  15, 60, 24 * 60, 7 * 24 * 60, MONTH_MINUTES, 0
]);

/** A readable label for a duration, for the hint line. */
export function describeLeaseMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n >= 24 * 60 && n % (24 * 60) === 0) {
    const days = n / (24 * 60);
    if (days >= 30 && days % 30 === 0) return `${days / 30}mo`;
    return `${days}d`;
  }
  if (n >= 60 && n % 60 === 0) return `${n / 60}h`;
  return `${n}m`;
}

/**
 * Normalise a lease duration.
 *
 * Anything unparseable falls back to the default rather than to 0: a corrupted
 * preference must not silently become «never expires», because that is the one
 * value that cannot be corrected by waiting.
 *
 * `null`, `''` and `[]` all pass `Number.isFinite(Number(x))` — they coerce to
 * 0, which is EXACTLY the never-expire value. Left unguarded, a settings read
 * that returned null (a missing key, a blank field, a partial object) would
 * hand every wallet a permanent session. So the coercion is checked, not
 * trusted: only a real non-negative number is a choice.
 */
export function walletLeaseMinutes(value, fallback = WALLET_LEASE_DEFAULT_MINUTES) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return fallback;
  }
  if (Array.isArray(value) || (typeof value === 'object')) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0) return 0;
  return Math.min(MAX_LEASE_MINUTES, Math.round(n));
}

/**
 * The lease the user chose, or the default.
 *
 * ─── WHY THIS READS STORAGE AND NOT THE STORE ─────────────────────────────
 * An earlier version imported the settings store here, which created a cycle
 * (the store imports this module for the clamp) and made this module
 * un-importable outside a bundled app. Neither is needed: zustand's `persist`
 * writes on EVERY state change, so the stored record is the live value by the
 * time any other module can ask. Reading storage is not a second source of
 * truth — it is the same one, reached without a dependency cycle.
 *
 * Reading BOTH key spellings is what makes the two wallets agree, and is the
 * fix for the bug documented on `readPersistedLeaseMinutes`.
 */
export function chosenLeaseMinutes() {
  return walletLeaseMinutes(readPersistedLeaseMinutes(), WALLET_LEASE_DEFAULT_MINUTES);
}

/** The persisted preference, or null. Tolerates BOTH key spellings. */
export function readPersistedLeaseMinutes() {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage : null;
    if (!ls) return null;
    /* The current key, and the pre-versioned one — a device that connected
       before the store was versioned still has its choice in the old key, and
       dropping it would silently restart that user's clock. */
    for (const key of [SETTINGS_STORAGE_KEY, 'fbt-settings']) {
      const raw = ls.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const n = Number(parsed?.state?.walletSessionMinutes ?? parsed?.walletSessionMinutes);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  } catch {
    return null;
  }
}
