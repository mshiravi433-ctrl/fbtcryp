/**
 * SOLANA WALLET CONNECTION
 * ---------------------------------------------------------------------------
 * Solana wallets inject a provider on `window` exactly like EVM wallets do,
 * but the interface is different enough that none of the WalletContext code
 * applies: there is no chainId, no eth_requestAccounts, and signing takes a
 * transaction object rather than a hex payload.
 *
 * This module is deliberately small and dependency-light at import time.
 * `@solana/web3.js` is 19 MB installed and is only needed to deserialise the
 * transaction Jupiter returns, so it is imported dynamically inside the signing
 * path. A user who never opens the Solana tab never downloads it — the same
 * reasoning that keeps eleven locale files out of the entry chunk.
 */


/* -------------------------------------------------------------------------- */
/* MOBILE: opening the dapp inside the wallet's own browser                    */
/* -------------------------------------------------------------------------- */

/**
 * True when we are inside the packaged Android app.
 *
 * Mirrors isNativeApp() in lib/notify.js rather than importing it, because
 * that module pulls in the whole push-notification surface for one boolean.
 */
const isNativeShell = () =>
  typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());

/**
 * Can this environment ever have an injected Solana provider?
 *
 * ─── THE GAP THIS EXPOSES ───────────────────────────────────────────────────
 * Phantom and Solflare inject `window.solana` from a BROWSER EXTENSION. A
 * Capacitor WebView has no extensions, and neither does an ordinary mobile
 * browser — extensions do not exist on mobile at all. So inside our APK the
 * provider is permanently null and the Connect button was permanently
 * disabled, with a message telling the user to install a wallet they may
 * already have installed.
 *
 * That is the whole reason the EVM side uses WalletConnect on mobile. Solana
 * has no equivalent that works from a WebView:
 *
 *   • Mobile Wallet Adapter is Android-native (Kotlin) and is only wired up
 *     automatically in Chrome for Android. It is not available to a Capacitor
 *     WebView without a native plugin, and the only community Capacitor
 *     plugin for it is explicitly "not ready for production use".
 *   • Phantom's deeplink API can sign, but every call round-trips through the
 *     wallet app and back, which reloads the page and wipes React state — the
 *     library that wraps it warns about exactly this.
 *
 * The honest, working answer is the one Phantom itself recommends: send the
 * user into the wallet's own in-app browser, where the provider IS injected
 * and everything behaves like a desktop extension.
 */
export const canInjectSolana = () => !isNativeShell();

/**
 * Build a Phantom "browse" deeplink that reopens a page inside Phantom.
 *
 * Format is from Phantom's published spec; both parameters are required and
 * both must be URL-encoded:
 *
 *   https://phantom.app/ul/browse/<url>?ref=<ref>
 *
 * Note these links cannot be pasted into a browser address bar — they must be
 * tapped or opened by an app, which is why the UI renders it as a button.
 */
export function phantomBrowseLink(url, ref = url) {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`;
}

/** The same idea for Solflare, which uses its own host. */
export function solflareBrowseLink(url) {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(url)}`;
}

/**
 * The public URL of this app, for the deeplinks above.
 *
 * `window.location` is wrong inside the APK: Capacitor serves from
 * https://localhost, and sending the wallet to localhost would open the
 * wallet's browser on nothing. The configured public origin is used instead.
 */
export function publicAppUrl(path = '/#/solana') {
  const base =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_URL) ||
    'https://www.lawpoetics.ir';
  return `${String(base).replace(/\/+$/, '')}${path}`;
}

/**
 * Find an injected Solana provider.
 *
 * Phantom namespaces itself under `window.phantom.solana` and ALSO sets
 * `window.solana`, while Solflare and Backpack set only their own. Checking
 * the namespaced one first matters: some wallets set `window.solana` as a
 * compatibility shim and then refuse to sign, so preferring the explicit
 * namespace picks the provider that actually works.
 */
export function getSolanaProvider() {
  if (typeof window === 'undefined') return null;
  const w = window;
  return (
    w.phantom?.solana ??
    w.solflare ??
    w.backpack ??
    (w.solana?.isPhantom || w.solana?.isSolflare ? w.solana : null) ??
    w.solana ??
    null
  );
}

export const solanaWalletAvailable = () => Boolean(getSolanaProvider());

/** Human name for the connected wallet, for the UI. */
export function solanaWalletName() {
  const p = getSolanaProvider();
  if (!p) return null;
  if (p.isPhantom) return 'Phantom';
  if (p.isSolflare) return 'Solflare';
  if (p.isBackpack) return 'Backpack';
  return 'Solana wallet';
}

/**
 * Connect and return the public key as a base58 string.
 *
 * Throws a stable error KEY rather than the wallet's own message, because
 * those differ per wallet and are not translatable. The caller maps the key to
 * localised copy.
 */
export async function connectSolana() {
  const provider = getSolanaProvider();
  if (!provider) throw new Error('NO_WALLET');

  try {
    const res = await provider.connect();
    const pk = res?.publicKey ?? provider.publicKey;
    const address = pk?.toString?.();
    if (!address) throw new Error('NO_ACCOUNT');
    return address;
  } catch (err) {
    // 4001 is the universal "user rejected" code, mirrored from EIP-1193.
    if (err?.code === 4001 || /reject|denied|cancel/i.test(String(err?.message))) {
      throw new Error('REJECTED');
    }
    throw new Error(err?.message === 'NO_ACCOUNT' ? 'NO_ACCOUNT' : 'CONNECT_FAILED');
  }
}

export async function disconnectSolana() {
  try {
    await getSolanaProvider()?.disconnect?.();
  } catch {
    /* a wallet that cannot disconnect is not an error worth surfacing */
  }
}

/** The currently connected address, or null. */
export function solanaAddress() {
  const p = getSolanaProvider();
  return p?.publicKey?.toString?.() ?? null;
}

/**
 * Sign a base64 transaction from Jupiter and return it base64-encoded again.
 *
 * ─── WHY PARTIAL SIGNING, NOT signAndSendTransaction ────────────────────────
 * The obvious call is `provider.signAndSendTransaction()`, and it is wrong
 * here. Jupiter's `/execute` needs the signed transaction handed back to IT so
 * it can land the trade through its own pipeline — and for JupiterZ (RFQ)
 * orders a market maker must add a second signature after ours. Broadcasting
 * ourselves would bypass Jupiter's landing infrastructure and break RFQ routes
 * outright, which are the ones that price best on major pairs.
 *
 * So: sign only, then return. Jupiter sends it.
 */
export async function signSolanaTransaction(base64Tx) {
  const provider = getSolanaProvider();
  if (!provider) throw new Error('NO_WALLET');
  if (typeof provider.signTransaction !== 'function') throw new Error('CANNOT_SIGN');

  // Dynamic import: keeps 19 MB of Solana SDK out of the entry chunk for the
  // majority of users, who never touch this path.
  const { VersionedTransaction } = await import('@solana/web3.js');

  let tx;
  try {
    tx = VersionedTransaction.deserialize(base64ToBytes(base64Tx));
  } catch {
    throw new Error('BAD_TRANSACTION');
  }

  let signed;
  try {
    signed = await provider.signTransaction(tx);
  } catch (err) {
    if (err?.code === 4001 || /reject|denied|cancel/i.test(String(err?.message))) {
      throw new Error('REJECTED');
    }
    throw new Error('SIGN_FAILED');
  }

  return bytesToBase64(signed.serialize());
}

/*
 * base64 <-> bytes without Buffer.
 *
 * `Buffer` does not exist in a browser or in an Android WebView; relying on a
 * Vite polyfill for something this small would be another dependency in the
 * critical path of a money transaction.
 */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000; // avoid "too many arguments" on large transactions
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
