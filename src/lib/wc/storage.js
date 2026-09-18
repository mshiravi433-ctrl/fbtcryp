/**
 * STORAGE HYGIENE
 * ---------------------------------------------------------------------------
 * The SDK and AppKit persist connection state in localStorage: sessions, the
 * "which wallet did you tap last" choice, the connected-connector id. All of it
 * is meant to survive a reload — and all of it becomes a trap when the pairing
 * it described is dead.
 *
 * The failure it produces is specific: on the next Connect, `init()` resurrects
 * the old session, AppKit answers `isConnected() === true` and refuses to open
 * the modal, while the stored deep-link choice still funnels the user into a
 * wallet app with a pairing that no longer exists. From the outside that reads
 * as "the Connect button is dead".
 *
 * So an explicit connect purges those keys synchronously, before init(). The
 * predicate below is the single definition of what "connection state" means,
 * shared by the purge and by the health report, so the two can never disagree.
 */

/** The SDK's own namespace (`wc@2:client:0.3//session`, pairings, …). */
export const WC_PREFIX = 'wc@2:';

/** The SDK's stored "open this wallet" choice. */
export const DEEPLINK_CHOICE_KEY = 'WALLETCONNECT_DEEPLINK_CHOICE';

/**
 * AppKit's connection-state keys, as a static list — KEPT ONLY FOR THE DOC
 * COMMENT below. The predicate (`isConnectionKey`) deliberately does NOT use
 * this list any more: a static inventory drifts, and the drift was the bug.
 *
 * ─── THE «DISCONNECT, THEN A PHANTOM WITH A BALANCE» REPORT ─────────────────
 * AppKit 1.8.x writes connection state under keys the old list had never heard
 * of. `purgeConnectionKeys()` ran, reported success, and LEFT behind:
 *
 *   • `@appkit/connections`          — the persisted connection list. Its
 *     reader, `ConnectionController.hasAnyConnection('AUTH')`, is exactly what
 *     DISABLES the email input box on the Connect view («hasConnection →
 *     disabled») and what the ethers adapter's boot-time `syncConnections()`
 *     reads to auto-reattach a wallet nobody asked for. Left behind after a
 *     disconnect, the next email login opens on a phantom account — address,
 *     balance, an input that cannot be typed into — instead of the email form.
 *   • `@appkit/connection_status`    — a stale 'connected' makes the next boot
 *     open in `connecting` (`listenAdapter()` reads it before anything else).
 *   • `@appkit/connected_namespaces`, `@appkit/active_namespace`,
 *     `@appkit/social_provider`, `@appkit/connected_social`,
 *     `@appkit/disconnected_connector_ids`, `@appkit/recent_wallets` — the rest
 *     of the 1.8.19 inventory the six-key list predated.
 *
 * So the predicate is SHAPE-BASED now: every `@appkit/` key is connection state
 * UNLESS it names a cache or a preference. Losing a cache costs a refetch;
 * losing a connection key costs the next attempt its honesty.
 */
export const APPKIT_CONNECTION_KEYS = Object.freeze([
  '@appkit/recent_wallet',
  '@appkit/connected_wallet_image',
  '@appkit/connected_connector',
  '@appkit/active_caip_network_id',
  '@appkit/wallet_id',
  '@appkit/wallet_name'
]);

/** Keys that are caches, not connection state, and must survive a purge. */
const CACHE_MARKERS = Object.freeze(['cache', 'portfolio', 'token_price', 'recent_emails']);

/**
 * Keys under `@appkit/` that are neither connection state nor cache —
 * bookkeeping whose loss changes nothing about any wallet:
 *   • `latest_version`          — the SDK's "newer AppKit exists" check result;
 *   • `preferred_account_types` — the user's EOA/smart-account display choice.
 * Counting them as connection state would make every idle page that ever
 * booted AppKit look permanently «orphaned» and purge-churn every cold start.
 */
const APPKIT_NEUTRAL_KEYS = Object.freeze([
  '@appkit/latest_version',
  '@appkit/preferred_account_types'
]);

/**
 * Does this key hold connection state whose loss is recoverable?
 *
 * `@appkit-wallet/*` is NEVER included: that is the embedded wallet's own auth
 * session. Purging it would log a real user out of a wallet they logged into.
 *
 * `@appkit/connection_status` is VALUE-AWARE when a storage is given: AppKit
 * rewrites it to 'disconnected' on every clean boot, and a 'disconnected' value
 * describes nothing any purge needs to remove — counting it would make the
 * health report scream «orphan» on every page. A 'connected' value with no
 * session behind it, on the other hand, is precisely the phantom this purge
 * exists to kill.
 */
export function isConnectionKey(key, storage) {
  const k = String(key ?? '');
  if (!k) return false;
  if (k.startsWith(WC_PREFIX)) return true;
  if (k === DEEPLINK_CHOICE_KEY) return true;
  if (k.startsWith('@appkit-wallet/')) return false;
  if (!k.startsWith('@appkit/')) return false;
  if (CACHE_MARKERS.some((marker) => k.includes(marker))) return false;
  if (APPKIT_NEUTRAL_KEYS.includes(k)) return false;
  /* `@appkit/<ns>:connected_connector_id` — namespace is dynamic (kept for the
     older SDK revisions that still write it). */
  if (k.endsWith(':connected_connector_id')) return true;
  if (k === '@appkit/connection_status') {
    try {
      return String(storage?.getItem(k) ?? '') === 'connected';
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Remove every recoverable connection artifact.
 *
 * @returns {number} how many keys were removed.
 */
export function purgeConnectionKeys(storage) {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return 0;
  let purged = 0;
  try {
    const keys = [];
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i);
      if (key && isConnectionKey(key, target)) keys.push(key);
    }
    for (const key of keys) {
      target.removeItem(key);
      purged += 1;
    }
  } catch {
    /* storage unavailable — nothing was purged, nothing else to do */
  }
  return purged;
}

/** The keys the purge would remove, without removing them. For diagnostics. */
export function listConnectionKeys(storage) {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const keys = [];
  if (!target) return keys;
  try {
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i);
      if (key && isConnectionKey(key, target)) keys.push(key);
    }
  } catch {
    /* empty list is the honest answer */
  }
  return keys;
}

/**
 * Is a WalletConnect session actually on disk?
 *
 * This probe is what keeps the relay quiet for visitors who have never
 * connected a wallet: `init()` opens a relay WebSocket, and doing that for
 * every page view would spend the project's relay quota on nothing. Restoring
 * therefore starts by looking for a session, and stops when there isn't one.
 *
 * Only KEY NAMES and an array LENGTH are read — never a topic, URI or account.
 */
export function hasStoredSession(storage) {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return false;
  try {
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i) || '';
      if (!key.startsWith(WC_PREFIX) || !key.endsWith('//session')) continue;
      const raw = target.getItem(key);
      const sessions = raw ? JSON.parse(raw) : null;
      if (Array.isArray(sessions) && sessions.length > 0) return true;
    }
  } catch {
    /* unreadable storage: no session we can prove exists */
  }
  return false;
}
