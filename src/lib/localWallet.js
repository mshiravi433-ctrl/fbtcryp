/**
 * Optional in-app (self-custody) wallet.
 *
 * ─── READ THIS BEFORE ENABLING ────────────────────────────────────────────
 * The 12-word mnemonic is generated on the user's device and encrypted with
 * their password using AES-GCM + PBKDF2 (310k iterations, SHA-256). The
 * plaintext key never leaves the device and is never sent to any server.
 *
 * It is still meaningfully less safe than an external wallet, and the UI says
 * so plainly:
 *   • It lives in localStorage inside a Telegram WebView. Any XSS in this app —
 *     or in a dependency — can read the ciphertext and brute-force a weak
 *     password offline.
 *   • There is no secure enclave, no hardware isolation, no biometric gate.
 *   • Losing the seed phrase means the funds are gone. Nobody can restore it.
 *
 * Treat it as a "pocket money" wallet for small amounts. Anything of real
 * value belongs in MetaMask/Trust via WalletConnect, or a hardware wallet.
 * ──────────────────────────────────────────────────────────────────────────
 */

const STORAGE_KEY = 'fbt-wallet-v1';
const PBKDF2_ITERATIONS = 310_000; // OWASP 2023 guidance for PBKDF2-SHA256

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { v: 1, kdf: 'PBKDF2', iterations: PBKDF2_ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptSecret(blob, password) {
  const key = await deriveKey(password, fromB64(blob.salt));
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

const loadEthers = () => import('ethers');

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

/** Encrypt a mnemonic under `password` and persist it. Returns the address. */
export async function createVault(mnemonic, password) {
  const { HDNodeWallet } = await loadEthers();
  const wallet = HDNodeWallet.fromPhrase(mnemonic.trim());
  const blob = await encryptSecret(mnemonic.trim(), password);
  const vault = { ...blob, address: wallet.address, createdAt: Date.now() };
  saveVault(vault);
  return wallet.address;
}

/**
 * Decrypt and return a live signer. Keep the returned object in memory only,
 * and drop it on lock — never write it back to storage.
 */
export async function unlockVault(password, provider) {
  const vault = loadVault();
  if (!vault) throw new Error('NO_VAULT');
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
