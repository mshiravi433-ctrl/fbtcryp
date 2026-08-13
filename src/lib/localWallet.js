/**
 * Optional in-app (self-custody) wallet.
 *
 * The 12-word mnemonic is generated on the user's device and encrypted with
 * their password using AES-GCM + PBKDF2-SHA256. The plaintext key never leaves
 * the device and is never sent to any server.
 *
 * ─── WHY ITERATIONS ARE ADAPTIVE ──────────────────────────────────────────
 * 310k is OWASP 2024 guidance for PBKDF2-SHA-256. On a modern laptop that's
 * ~100ms. On a mid-range iPhone in Safari the same call was measuring 2–4
 * SECONDS of synchronous WebCrypto work on the main thread — long enough for
 * the unlock button to look frozen while iOS couldn't paint any "busy" state.
 * Users reported this as "کیف پول گیر می‌کند" / "wallet hangs on iPhone".
 *
 * The vault stores `iterations` in its own blob, so new wallets on slow mobile
 * hardware pick a lower count while desktops stay higher, and old vaults keep
 * whatever count they were created with.
 */

const STORAGE_KEY = 'fbt-wallet-v1';
const PBKDF2_ITERATIONS_DESKTOP = 250_000;
const PBKDF2_ITERATIONS_MOBILE = 140_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const s = String(navigator.userAgent || '');
  if (/iPad|iPhone|iPod/.test(s)) return true;
  return /Macintosh/.test(s) && (navigator.maxTouchPoints || 0) > 1;
}

function pickIterations() {
  if (typeof navigator === 'undefined') return PBKDF2_ITERATIONS_DESKTOP;
  if (isIOS()) return PBKDF2_ITERATIONS_MOBILE;
  if (/Android/.test(String(navigator.userAgent || ''))) {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    if (mem <= 2 || cores <= 4) return PBKDF2_ITERATIONS_MOBILE;
  }
  return PBKDF2_ITERATIONS_DESKTOP;
}

/** Yield a paint frame before heavy crypto so "busy" UI actually shows up. */
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(plaintext, password, iterations) {
  const iters = iterations || pickIterations();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iters);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { v: 1, kdf: 'PBKDF2', iterations: iters, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptSecret(blob, password) {
  const iterations = blob.iterations || PBKDF2_ITERATIONS_DESKTOP;
  const key = await deriveKey(password, fromB64(blob.salt), iterations);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) },
    key,
    fromB64(blob.ct)
  );
  return dec.decode(pt);
}

/* ----------------------------- vault storage ----------------------------- */

export function loadVault() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveVault(vault) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

export function clearVault() {
  localStorage.removeItem(STORAGE_KEY);
}

export const hasVault = () => Boolean(loadVault());

/* ------------------------------ wallet ops ------------------------------- */

/*
 * `ethers` is one of the largest lazy chunks in the app. Start fetching and
 * parsing it while the password sheet is open so an iPhone does not pay that
 * cost only after the final Create tap. A rejected load is not cached forever.
 */
let ethersPromise = null;
function loadEthers() {
  if (!ethersPromise) {
    ethersPromise = import('ethers').catch((error) => {
      ethersPromise = null;
      throw error;
    });
  }
  return ethersPromise;
}

export function preloadWalletCrypto() {
  return loadEthers().then(() => true).catch(() => false);
}

/** Create a brand-new random mnemonic. Nothing is persisted yet. */
export async function generateMnemonic() {
  const { Wallet } = await loadEthers();
  return Wallet.createRandom().mnemonic.phrase;
}

export async function validateMnemonic(phrase) {
  const { Mnemonic } = await loadEthers();
  try {
    return Mnemonic.isValidMnemonic(phrase.trim());
  } catch {
    return false;
  }
}

/**
 * Encrypt and persist a mnemonic while returning the signer we already built.
 *
 * Creation previously threw this signer away and immediately decrypted the new
 * vault to build the exact same object again. That duplicate PBKDF2 pass was
 * the largest avoidable delay on iPhone. The signer remains memory-only.
 */
export async function createVaultWithSigner(mnemonic, password, provider) {
  await yieldFrame();
  const { HDNodeWallet } = await loadEthers();
  const phrase = mnemonic.trim();
  // WebCrypto derives on its own implementation thread; let it overlap the
  // synchronous HD-address derivation instead of putting the two waits in line.
  const [blob, wallet] = await Promise.all([
    encryptSecret(phrase, password),
    Promise.resolve().then(() => HDNodeWallet.fromPhrase(phrase))
  ]);
  const vault = { ...blob, address: wallet.address, createdAt: Date.now() };
  saveVault(vault);
  return {
    address: wallet.address,
    signer: provider ? wallet.connect(provider) : wallet
  };
}

/** Backward-compatible address-only API for callers that do not need a signer. */
export async function createVault(mnemonic, password) {
  const { address } = await createVaultWithSigner(mnemonic, password);
  return address;
}

/**
 * Decrypt and return a live signer. Keep the returned object in memory only,
 * and drop it on lock — never write it back to storage.
 */
export async function unlockVault(password, provider) {
  const vault = loadVault();
  if (!vault) throw new Error('NO_VAULT');
  await yieldFrame();
  let mnemonic;
  try {
    mnemonic = await decryptSecret(vault, password);
  } catch {
    throw new Error('BAD_PASSWORD');
  }
  const { HDNodeWallet } = await loadEthers();
  const wallet = HDNodeWallet.fromPhrase(mnemonic);
  return provider ? wallet.connect(provider) : wallet;
}

/** Reveal the seed phrase for backup — always re-prompt for the password. */
export async function revealMnemonic(password) {
  const vault = loadVault();
  if (!vault) throw new Error('NO_VAULT');
  await yieldFrame();
  try {
    return await decryptSecret(vault, password);
  } catch {
    throw new Error('BAD_PASSWORD');
  }
}

/** Rough password strength meter used by the create-wallet screen. */
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: 'empty' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['veryWeak', 'weak', 'fair', 'good', 'strong', 'strong'];
  return { score, label: labels[score] };
}
