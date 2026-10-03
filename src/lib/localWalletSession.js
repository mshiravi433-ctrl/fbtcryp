/**
 * THE IN-APP WALLET'S DEVICE SESSION — why a refresh used to cost a password.
 * ---------------------------------------------------------------------------
 * THE REPORT: «اتصال به کیف پول EVM هم داخلی هم تراست‌ولت با رفرش صفحه از دست
 * می‌ره و باید دوباره از اول اتصال را برقرار کنیم» — both the built-in wallet
 * and Trust Wallet lost their connection on a reload.
 *
 * ─── WHAT WAS HAPPENING ───────────────────────────────────────────────────
 * The in-app wallet is an encrypted vault on disk (`fbt-wallet-v1`, see
 * localWallet.js). A reload has no memory of the password that unlocked it, so
 * the cold start could only re-attach the ADDRESS in a LOCKED state — and a
 * locked wallet is not a connected wallet anywhere in this app
 * (`isConnected = Boolean(address) && !locked`). The screen said «وصل نیست»,
 * and the only way back was to type the password again: exactly the «reconnect
 * from scratch» the report describes.
 *
 * ─── WHAT THIS MODULE IS ──────────────────────────────────────────────────
 * A "remember me" record with a **device-bound, non-extractable** key:
 *
 *   • On first unlock, a random AES-GCM-256 key is generated with
 *     `extractable: false` and kept in IndexedDB. Because it is
 *     non-extractable, the raw key BYTES cannot be read back by any script in
 *     this origin — not by this module, not by an injected one. It can only be
 *     USED, here, by the crypto engine.
 *   • The seed phrase is re-encrypted under that key and stored next to it,
 *     with an expiry copied from the same lease the EVM side already uses
 *     (`walletSessionMinutes`, default 30 days — lib/walletSessionPolicy.js).
 *   • A reload inside the window decrypts the seed in memory, rebuilds the
 *     signer, and the wallet comes back OPEN — no password, no re-import.
 *
 * ─── THE HONEST BOUNDARY ──────────────────────────────────────────────────
 * This is the same trade every hot wallet makes when it offers "stay unlocked".
 * It does not make the vault weaker — the vault stays encrypted on disk with
 * the user's password — it adds a second, temporary envelope that only exists
 * on this device and only until the window the user chose lapses. Two things
 * follow, and both are deliberate:
 *
 *   • The record is dropped the moment the user locks, disconnects, forgets
 *     the wallet, or the window lapses. «قفل» means locked, on the next
 *     document too.
 *   • It is never written to a server, never synced, and never sent anywhere;
 *     it lives in this origin's IndexedDB.
 *
 * Nothing here throws at a caller: IndexedDB is absent in some private modes,
 * and a storage refusal must degrade to «enter your password once», never to a
 * broken wallet screen.
 */
import { walletLeaseMinutes, WALLET_LEASE_DEFAULT_MINUTES } from './walletSessionPolicy.js';

const DB_NAME = 'fbt-wallet-device';
const DB_VERSION = 1;
const STORE = 'session';
const KEY_ID = 'device-key';
const RECORD_ID = 'record';

/** The record itself is tiny and non-secret; localStorage survives a DB wipe. */
export const LOCAL_SESSION_KEY = 'fbt-wallet-device-session-v1';

const hasIDB = () => typeof indexedDB !== 'undefined' && indexedDB !== null;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!hasIDB()) {
      reject(new Error('NO_IDB'));
      return;
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IDB_OPEN_FAILED'));
    request.onblocked = () => reject(new Error('IDB_BLOCKED'));
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try {
        result = run(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result?.__request ? result.__request.result : result);
      tx.onerror = () => reject(tx.error || new Error('IDB_TX_FAILED'));
      tx.onabort = () => reject(tx.error || new Error('IDB_TX_ABORTED'));
    });
  } finally {
    try { db.close(); } catch { /* closing a finished handle is a no-op */ }
  }
}

const idbGet = (id) => withStore('readonly', (store) => ({ __request: store.get(id) }));
const idbPut = (id, value) => withStore('readwrite', (store) => { store.put(value, id); });
const idbDelete = (id) => withStore('readwrite', (store) => { store.delete(id); });

/**
 * The device key: generated once, non-extractable, and reused forever after.
 *
 * `extractable: false` is the whole point — the key cannot leave the browser's
 * crypto implementation, so a copy of this origin's storage yields ciphertext
 * and a key handle that is useless anywhere else.
 */
async function deviceKey() {
  const existing = await idbGet(KEY_ID);
  if (existing && existing.type === 'secret') return existing;
  if (!globalThis.crypto?.subtle?.generateKey) throw new Error('NO_WEBCRYPTO');
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  await idbPut(KEY_ID, key);
  return key;
}

const toB64 = (bytes) => {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
};

const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Read the (non-secret) record: address + expiry. Never throws. */
export function readLocalSession() {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(parsed.address)) return null;
    const expiresAt = Number(parsed.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt < 0) return null;
    const now = Date.now();
    const permanent = expiresAt === 0;
    return {
      address: parsed.address.toLowerCase(),
      expiresAt,
      issuedAt: Number(parsed.issuedAt) || 0,
      alive: permanent || expiresAt > now,
      permanent
    };
  } catch {
    return null;
  }
}

/** Is there a device session this document may use right now? */
export function localSessionAlive() {
  const record = readLocalSession();
  return Boolean(record?.alive);
}

/**
 * Persist the seed phrase for the window the user chose.
 *
 * @param {string} mnemonic  the phrase that unlocked/created the vault
 * @param {object} opts      { address, minutes }
 * @returns {Promise<boolean>} false when the device cannot hold a session —
 *          the wallet still works, it just asks for the password next reload.
 */
export async function saveLocalSession(mnemonic, { address, minutes } = {}) {
  if (typeof mnemonic !== 'string' || !mnemonic.trim()) return false;
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  try {
    const mins = walletLeaseMinutes(minutes, WALLET_LEASE_DEFAULT_MINUTES);
    const key = await deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(mnemonic.trim())
    );
    await idbPut(RECORD_ID, { v: 1, iv: toB64(iv), ct: toB64(cipher), address: address.toLowerCase() });
    const at = Date.now();
    try {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({
        v: 1,
        address: address.toLowerCase(),
        issuedAt: at,
        minutes: mins,
        expiresAt: mins > 0 ? at + mins * 60_000 : 0
      }));
    } catch {
      /* The envelope is stored but the expiry is not — drop it rather than
         leave a session with no clock on it. */
      await idbDelete(RECORD_ID).catch(() => {});
      return false;
    }
    return true;
  } catch {
    /* No IndexedDB, no WebCrypto, storage refused: the vault path stands. */
    return false;
  }
}

/**
 * Decrypt the remembered phrase — only inside a live window, and only if the
 * address still matches the vault the app is about to attach.
 *
 * @returns {Promise<string|null>}
 */
export async function readLocalSessionMnemonic({ address } = {}) {
  const record = readLocalSession();
  if (!record?.alive) return null;
  if (address && String(address).toLowerCase() !== record.address) return null;
  try {
    const stored = await idbGet(RECORD_ID);
    if (!stored || typeof stored.ct !== 'string' || typeof stored.iv !== 'string') return null;
    if (stored.address && address && stored.address !== String(address).toLowerCase()) return null;
    const key = await deviceKey();
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(stored.iv) },
      key,
      fromB64(stored.ct)
    );
    const phrase = new TextDecoder().decode(plain);
    return phrase || null;
  } catch {
    /* A wiped DB, a rotated key or a tampered envelope: forget it quietly. */
    return null;
  }
}

/** Drop the device session. Idempotent, and never throws. */
export function clearLocalSession() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch { /* storage blocked — nothing recorded to clear */ }
  /* The envelope goes too, asynchronously: a leftover ciphertext under a key we
     no longer track is dead weight, not a risk. */
  void Promise.resolve()
    .then(() => idbDelete(RECORD_ID))
    .catch(() => {});
}

/** Whole minutes left on the device session, or null when it never expires. */
export function localSessionRemainingMinutes() {
  const record = readLocalSession();
  if (!record?.alive || record.permanent) return null;
  return Math.max(0, Math.ceil((record.expiresAt - Date.now()) / 60_000));
}
