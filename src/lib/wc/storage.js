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
 * AppKit's connection-state keys, as a static list.
 *
 * The dynamic one — `@appkit/<namespace>:connected_connector_id` — cannot be
 * listed (the namespace is a random id AppKit generates per boot), so it is
 * matched by shape in `isConnectionKey` below.
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
 * Does this key hold connection state whose loss is recoverable?
 *
 * `@appkit-wallet/*` is NEVER included: that is the embedded wallet's own auth
 * session. Purging it would log a real user out of a wallet they logged into.
 */
export function isConnectionKey(key) {
  const k = String(key ?? '');
  if (!k) return false;
  if (k.startsWith(WC_PREFIX)) return true;
  if (k === DEEPLINK_CHOICE_KEY) return true;
  if (k.startsWith('@appkit-wallet/')) return false;
  if (!k.startsWith('@appkit/')) return false;
  if (CACHE_MARKERS.some((marker) => k.includes(marker))) return false;
  /* `@appkit/<ns>:connected_connector_id` — namespace is dynamic. */
  if (k.endsWith(':connected_connector_id')) return true;
  return APPKIT_CONNECTION_KEYS.includes(k);
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
      if (key && isConnectionKey(key)) keys.push(key);
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
      if (key && isConnectionKey(key)) keys.push(key);
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
