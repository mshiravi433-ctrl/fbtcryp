/**
 * WALLETCONNECT / APPKIT STORAGE HYGIENE
 * ---------------------------------------------------------------------------
 * The WalletConnect SDK (SignClient + the bundled AppKit modal) persists state
 * into localStorage under three families of keys:
 *
 *   • `wc@2:client:…` — sessions, pairings, proposals, expirations
 *   • `wc@2:core:…`   — the client keychain / identity seed
 *   • `WALLETCONNECT_DEEPLINK_CHOICE` — AppKit's last mobile deep-link choice
 *   • `@appkit/…`     — AppKit modal state (recent wallets, connection status)
 *
 * All of it is written asynchronously by the SDK. A disconnect that only
 * nulls our own refs therefore leaves a corpse behind: the next
 * `EthereumProvider.init()` resurrects the old session, AppKit's
 * `ConnectorController.isConnected()` answers "connected" from stale storage
 * and refuses to open the modal, and a stored mobile deep-link choice can
 * still drag the user straight into a wallet app with a pairing that no
 * longer exists. The report "after disconnecting the in-app wallet,
 * WalletConnect just opens MetaMask and it errors there" is exactly that
 * corpse waking up.
 *
 * `purgeWcStorage()` removes every key that describes a CONNECTION. It is
 * deliberately NOT called by the opportunistic session-restore path (restore
 * must keep the persisted session it is trying to resume) — only by explicit
 * disconnect / forget / fresh-connect, where a clean slate is the contract.
 *
 * Kept as its own tiny module (no React, no SDK imports) so the purge logic
 * is unit-testable against a fake Storage — see test/wc-storage-probe.mjs.
 */

/** Every SDK persistence key starts with this prefix. */
export const WC_STORAGE_PREFIX = 'wc@2:';

/** AppKit's single mobile deep-link choice key (its own constant name). */
export const WC_DEEPLINK_CHOICE_KEY = 'WALLETCONNECT_DEEPLINK_CHOICE';

/**
 * AppKit connection-identity keys. Cached balances/prices (`@appkit/*_cache`)
 * are intentionally NOT purged — they are harmless and expensive to refetch.
 */
export const APPKIT_CONNECTION_KEYS = [
  '@appkit/wallet_id',
  '@appkit/wallet_name',
  '@appkit/recent_wallet',
  '@appkit/recent_wallets',
  '@appkit/connection_status',
  '@appkit/connections',
  '@appkit/connected_namespaces',
  '@appkit/active_namespace',
  '@appkit/active_caip_network_id'
];

/**
 * Is this key one of the connection-artifact keys we own?
 * Exported so diagnostics can report what WOULD be purged without touching it.
 */
export function isConnectionArtifactKey(key) {
  if (!key) return false;
  if (key.startsWith(WC_STORAGE_PREFIX)) return true;
  if (key === WC_DEEPLINK_CHOICE_KEY) return true;
  return APPKIT_CONNECTION_KEYS.includes(key);
}

/**
 * Remove every WalletConnect/AppKit connection artifact from `storage`.
 * Returns the number of keys removed. Never throws: a storage API that is
 * unavailable or partially broken degrades to a no-op (the SDK will simply
 * start from whatever it finds, as it did before).
 *
 * @param {Storage} storage  defaults to the global localStorage when omitted
 */
export function purgeWcStorage(storage) {
  const target =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return 0;
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < target.length; i += 1) {
      const k = target.key(i);
      if (k) keys.push(k);
    }
    for (const key of keys) {
      if (!isConnectionArtifactKey(key)) continue;
      try {
        target.removeItem(key);
        removed += 1;
      } catch {
        /* one dead key must not abort the purge */
      }
    }
  } catch {
    /* storage length/key() unavailable — nothing we can do */
  }
  return removed;
}

/**
 * Diagnostic snapshot: the NAMES of stored connection artifacts (never their
 * values — a session key's value contains topics and the client seed).
 * Used by the support export in Settings.
 */
export function listWcStorageKeys(storage) {
  const target =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return [];
  const out = [];
  try {
    for (let i = 0; i < target.length; i += 1) {
      const k = target.key(i);
      if (isConnectionArtifactKey(k)) out.push(k);
    }
  } catch {
    /* noop */
  }
  return out;
}
