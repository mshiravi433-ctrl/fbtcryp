/**
 * WALLETCONNECT STORAGE HYGIENE PROBE (runtime, no DOM needed)
 * ---------------------------------------------------------------------------
 * Reported: after building the in-app wallet and disconnecting it, the next
 * WalletConnect attempt no longer showed the QR modal — it opened MetaMask
 * directly and errored there. The residue of previous attempts (the AppKit
 * deep-link choice, the persisted session, the recent-wallet keys) survived
 * every disconnect and steered the next connect into a dead pairing.
 *
 * This proves `purgeWcStorage()` removes EXACTLY the connection artifacts and
 * nothing else, against a fake Storage object — the same shape the real
 * localStorage has. It is the runtime counterpart of the structural checks in
 * wc-connect-probe.mjs.
 */
import {
  APPKIT_CONNECTION_KEYS,
  WC_DEEPLINK_CHOICE_KEY,
  WC_STORAGE_PREFIX,
  isConnectionArtifactKey,
  listWcStorageKeys,
  purgeWcStorage
} from '../src/lib/wcStorage.js';

/** Minimal Storage stand-in. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(k); },
    get snapshot() { return Object.fromEntries(map); }
  };
}

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. every key the purge must reach is classified as ours ---- */
  const owned = [
    'wc@2:client:0.3//session',
    'wc@2:core:0.3//keychain',
    'wc@2:client:0.3//pairing',
    WC_DEEPLINK_CHOICE_KEY,
    ...APPKIT_CONNECTION_KEYS
  ];
  const foreign = [
    '@appkit/portfolio_cache',   // cached balances: cheap to keep
    '@appkit/token_price_cache', // cached prices: cheap to keep
    'fbt:vault',                 // the local vault — MUST survive
    'fbt:settings',
    'unrelated'
  ];
  t('every SDK/AppKit connection key is classified as ours',
    owned.every((k) => isConnectionArtifactKey(k)));
  t('cached data and app-owned keys are classified as foreign',
    foreign.every((k) => !isConnectionArtifactKey(k)));

  /* ---- 2. the purge removes ours and leaves foreign keys untouched ---- */
  const storage = fakeStorage({ ...Object.fromEntries(owned.map((k) => [k, '{"fake":"value"}'])), ...Object.fromEntries(foreign.map((k) => [k, 'x'])) });
  const removed = purgeWcStorage(storage);
  const after = storage.snapshot;
  t(`the purge removed every connection artifact (${removed}/${owned.length})`,
    removed === owned.length && owned.every((k) => !(k in after)));
  t('the purge left cached + app keys intact',
    foreign.every((k) => k in after));

  /* ---- 3. a storage API that throws degrades to a no-op, never a crash ---- */
  let threw = false;
  try {
    purgeWcStorage(null);
    purgeWcStorage(undefined);
  } catch {
    threw = true;
  }
  t('purging with no storage available is a silent no-op', !threw);

  /* ---- 4. listing reports names only (values stay private) ---- */
  const listed = listWcStorageKeys(storage);
  t('listWcStorageKeys returns names, never values',
    Array.isArray(listed) && listed.every((k) => typeof k === 'string'));

  /* ---- 5. the prefix constants match the SDK's real persistence schema ---- */
  t('the purge prefix matches the SignClient storage schema (wc@2:…)',
    WC_STORAGE_PREFIX === 'wc@2:'
      && owned.filter((k) => k.startsWith(WC_STORAGE_PREFIX)).length >= 3);

  return rows;
}
