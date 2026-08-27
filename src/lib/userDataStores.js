/**
 * PHASE 92 BROWSER ADAPTER — the real stores behind `DATA_STORES`.
 * ---------------------------------------------------------------------------
 * `src/lib/intent-ai/dataLifecycle.js` is deliberately storage-agnostic: it
 * enumerates seven logical stores and calls a reader or an eraser for each,
 * then reads everything back to prove the erasure happened. This file is the
 * only place that knows those seven names map onto actual localStorage keys in
 * this app.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------
 * The wallet. `fbt-wallet-v1` holds the encrypted vault, and no "delete my
 * data" button in a settings screen may destroy the only copy of somebody's
 * keys — that is a support ticket that ends with a person losing their money.
 * Wallet removal lives behind the wallet's own flow, with its own warnings and
 * its own backup check. The same reasoning covers the language preference:
 * wiping it mid-session drops the user into English with no explanation.
 *
 * HONESTY RULES THIS FILE MUST KEEP
 * ---------------------------------------------------------------------------
 *   · a reader returns exactly what is stored, or `null` — never a placeholder
 *     that would make verification pass over a store it could not read
 *   · a reader that CANNOT read (no localStorage, a thrown quota error) throws,
 *     so `verifyDeletion` records it as unverifiable instead of proven
 *   · an eraser reports how many keys it removed, so a partial wipe is visible
 *   · nothing here can report success for a store it did not touch
 */

/**
 * Logical store → the localStorage keys behind it.
 *
 * `prefix` entries match by `startsWith`, which is how the per-token and
 * per-symbol caches (`fbt-tokens-42161`, `fbt-news-BTC`, …) are covered without
 * naming each one. Every key in the app that holds personal data should appear
 * in exactly one row; the phase-92 probe asserts the seven names here are the
 * same seven `DATA_STORES` exports, so a new store cannot be added upstream
 * without this map being updated too.
 */
export const STORE_KEY_MAP = Object.freeze({
  memory: Object.freeze({ exact: ['fbt-intent-memory-v1', 'fbt-learning-params-v1', 'fbt-learning-optin-v1'], prefix: [] }),
  sessions: Object.freeze({ exact: ['fbt-intents-v1', 'fbt-intent-lifecycle-v1', 'fbt-policy-v1', 'fbt-quote-commit-v1'], prefix: [] }),
  audit: Object.freeze({ exact: ['fbt-audit-v1', 'fbt-learning-events-v1'], prefix: [] }),
  preferences: Object.freeze({ exact: ['fbt-notify-v1', 'fbt-radio-v1', 'fbt-swap-v1'], prefix: [] }),
  receipts: Object.freeze({ exact: ['fbt-execution-proofs-v1', 'fbt-dca-receipts-v1', 'fbt-orders-v1', 'fbt-portfolio-lots-v1', 'fbt-portfolio-snap-v1'], prefix: [] }),
  alerts: Object.freeze({ exact: ['fbt-price-alerts-v1', 'fbt-price-alert-base-v1', 'fbt-btc-watch-v1'], prefix: [] }),
  cache: Object.freeze({ exact: ['fbt-news-v1'], prefix: ['fbt-tokens-', 'fbt-token-', 'fbt-news-'] })
});

/** Keys this file refuses to touch, and why. See the header. */
export const PROTECTED_KEYS = Object.freeze(['fbt-wallet-v1', 'fbt-lang', 'fbt-settings-v1']);

function storage() {
  // Throwing (rather than returning null) is the point: an unreadable store
  // must surface as `unverifiable`, never as a store that was proven empty.
  if (typeof localStorage === 'undefined') throw new Error('NO_LOCAL_STORAGE');
  return localStorage;
}

/** Every currently-present key belonging to one logical store. */
export function keysForStore(store) {
  const spec = STORE_KEY_MAP[store];
  if (!spec) return [];
  const ls = storage();
  const found = new Set();
  for (const key of spec.exact) {
    if (ls.getItem(key) !== null && !PROTECTED_KEYS.includes(key)) found.add(key);
  }
  if (spec.prefix.length) {
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (!key || PROTECTED_KEYS.includes(key)) continue;
      if (spec.prefix.some((p) => key.startsWith(p))) found.add(key);
    }
  }
  return [...found];
}

/**
 * Readers for `exportUserData` and `verifyDeletion`.
 *
 * An empty store returns `null`, which `verifyDeletion` counts as empty. A
 * store with anything in it returns that content, so a leftover is named
 * rather than rounded away.
 */
export function buildReaders() {
  const readers = {};
  for (const store of Object.keys(STORE_KEY_MAP)) {
    readers[store] = () => {
      const ls = storage();
      const out = {};
      for (const key of keysForStore(store)) {
        const raw = ls.getItem(key);
        if (raw === null) continue;
        // Stored as JSON where possible; a raw string is still the truth.
        try { out[key] = JSON.parse(raw); } catch { out[key] = raw; }
      }
      return Object.keys(out).length ? out : null;
    };
  }
  return readers;
}

/** Erasers for `deleteUserData`, each reporting what it actually removed. */
export function buildErasers() {
  const erasers = {};
  for (const store of Object.keys(STORE_KEY_MAP)) {
    erasers[store] = () => {
      const ls = storage();
      const keys = keysForStore(store);
      let removed = 0;
      for (const key of keys) {
        ls.removeItem(key);
        removed += 1;
      }
      return { ok: true, removed };
    };
  }
  return erasers;
}

/**
 * A stable per-install id for the lifecycle calls, which require a userId.
 *
 * This is NOT an account and NOT a tracking id: it never leaves the device and
 * it is itself removed when the user deletes their data, so a wipe followed by
 * a new export cannot be correlated with the old one.
 */
export const LOCAL_USER_KEY = 'fbt-local-user-v1';

export function localUserId() {
  try {
    const ls = storage();
    const existing = ls.getItem(LOCAL_USER_KEY);
    if (existing) return existing;
    const created = `local_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    ls.setItem(LOCAL_USER_KEY, created);
    return created;
  } catch {
    // No storage: still return something so the export can be attempted and
    // fail honestly on the individual readers, rather than silently no-op.
    return 'local_unavailable';
  }
}

export function forgetLocalUserId() {
  try { storage().removeItem(LOCAL_USER_KEY); } catch { /* nothing to forget */ }
}
