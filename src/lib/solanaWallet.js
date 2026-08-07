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
export const canInjectSolana = () => {
  if (typeof window === 'undefined') return false;
  // The packaged app has no extensions, ever.
  if (isNativeShell()) return false;

  /*
   * REAL BUG this replaces: the check was `!isNativeShell()` alone, so any
   * MOBILE BROWSER reported true. Chrome on Android and Safari on iOS then got
   * the "install a wallet and open this page in its browser" message with no
   * button to actually do that — a dead end that told the user to perform a
   * step the UI was hiding from them. Reported as
   * «نه میشه وصل نه مرورگر داریم».
   *
   * Browser extensions do not exist on ANY mobile browser. The only place a
   * Solana provider can be injected on a phone is inside a wallet's own
   * in-app browser — and there the provider is already present, so
   * `solanaWalletAvailable()` is true and this branch is never reached.
   *
   * Therefore: if we are on a phone and there is no provider, the answer is
   * always "open this in the wallet app", never "install something".
   */
  const ua = String(window.navigator?.userAgent ?? '');
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (isMobile) return false;

  // Desktop: an extension is genuinely possible, so "install it" is correct.
  return true;
};

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

// publicAppUrl moved to lib/nativeShell.js — it is needed by the referral
// invite too, and importing this module for it would pull in the Solana stack.
export { publicAppUrl } from './nativeShell';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── MOBILE WALLET ADAPTER: A ROUTE THAT DID NOT EXIST WHEN THIS WAS WRITTEN
 * ═══════════════════════════════════════════════════════════════════════════
 * Asked whether there are other ways to connect a Solana wallet. There is now
 * one more than when the comment above was written, and it is worth having.
 *
 * `@solana-mobile/wallet-standard-mobile` is the OFFICIAL Solana Mobile
 * package for web apps. It registers MWA as a Wallet Standard wallet, so
 * Chrome for Android can open Phantom, Solflare or Backpack over an Android
 * intent and get a signature back — no extension, no in-app browser detour.
 *
 * Checked before adding rather than assumed:
 *   • npm version 0.5.3, published 2026-07-30 — actively maintained, not the
 *     2022 hackathon plugin the note below correctly rejected.
 *   • Solana Mobile's own platform table: Android full, MOBILE WEB (Chrome for
 *     Android) SUPPORTED, iOS NOT SUPPORTED — "due to platform restrictions on
 *     inter-app communication".
 *
 * ─── WHAT THIS DOES AND DOES NOT FIX ────────────────────────────────────────
 * It fixes Chrome on Android, which previously had no path at all. It does
 * NOT fix iOS — Apple does not permit the inter-app channel MWA needs — and it
 * does not fix our own APK, because a Capacitor WebView is not Chrome and
 * cannot receive the intent result. Both of those keep the in-app-browser
 * deeplink, which remains the only thing that works there.
 *
 * ─── WHY REGISTRATION IS LAZY AND GUARDED ───────────────────────────────────
 * `registerMwa` must run in a browser and only once. It is imported
 * dynamically so the package is not in the initial bundle for the majority of
 * users who will never use it, and it is skipped entirely outside Android
 * Chrome so an iOS user cannot end up with a wallet option that opens nothing.
 * A failure here must never break the screen: Solana swapping still works
 * through an injected provider, so the catch is deliberately silent.
 */
let mwaRegistered = false;
/* The address from an MWA session. See connectSolana for why this is needed. */
let mwaAddress = null;

/** True only where MWA can actually complete a round trip. */
export function canUseMwa() {
  if (typeof window === 'undefined') return false;
  /* A Capacitor WebView is not Chrome; the intent result never comes back. */
  if (isNativeShell()) return false;
  const ua = String(window.navigator?.userAgent ?? '');
  if (!/Android/i.test(ua)) return false; // iOS cannot, desktop does not need it
  /* Firefox and other Android browsers are not covered by the official
     support statement, so they keep the deeplink rather than a maybe. */
  return /Chrome|CriOS/i.test(ua);
}

export async function registerMobileWalletAdapter(appUrl) {
  if (mwaRegistered || !canUseMwa()) return false;
  try {
    const mod = await import('@solana-mobile/wallet-standard-mobile');
    mod.registerMwa({
      appIdentity: {
        name: 'FBT Swap',
        uri: appUrl || window.location.origin,
        icon: 'icon-192.png'
      },
      authorizationCache: mod.createDefaultAuthorizationCache(),
      /* Mainnet only. Offering devnet here would let somebody authorise a
         chain their real funds are not on and wonder where the balance went. */
      chains: ['solana:mainnet'],
      chainSelector: mod.createDefaultChainSelector(),
      onWalletNotFound: mod.createDefaultWalletNotFoundHandler()
    });
    mwaRegistered = true;
    return true;
  } catch {
    /* Silent by design — see the header. The injected path is unaffected. */
    return false;
  }
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
/**
 * Find a Wallet Standard wallet, which is how MWA presents itself.
 *
 * ─── WHY THIS IS SEPARATE FROM getSolanaProvider ────────────────────────────
 * An injected wallet sets a global object. A Wallet Standard wallet instead
 * REGISTERS itself and is discovered through `window.navigator.wallets`, so
 * `getSolanaProvider()` cannot see it no matter what it checks. After
 * `registerMwa` runs on Android Chrome the MWA wallet exists only here.
 *
 * The shapes also differ: Wallet Standard exposes numbered feature strings
 * (`standard:connect`) rather than a `.connect()` method, which is why the
 * caller below cannot simply treat one as the other.
 */
export function getStandardWallets() {
  if (typeof window === 'undefined') return [];
  const api = window.navigator?.wallets;
  if (!api) return [];
  try {
    /* `get()` is the documented accessor; some builds expose an array. */
    const list = typeof api.get === 'function' ? api.get() : api;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** The registered MWA wallet, if `registerMobileWalletAdapter` succeeded. */
export function getMwaWallet() {
  return getStandardWallets().find((w) =>
    /mobile wallet adapter/i.test(String(w?.name ?? ''))
    && w?.features?.['standard:connect']) ?? null;
}

export async function connectSolana() {
  const provider = getSolanaProvider();

  /*
   * Prefer an injected provider when one exists — inside Phantom's own browser
   * that is the wallet the user deliberately opened us in, and routing them
   * back out through an intent would be a worse experience than the one they
   * chose. MWA is the fallback for Android Chrome, where nothing is injected.
   */
  if (!provider) {
    const mwa = getMwaWallet();
    if (mwa) {
      const res = await mwa.features['standard:connect'].connect();
      /*
       * Wallet Standard returns accounts as an ARRAY and the address is
       * already a base58 string — not a PublicKey with `.toString()` like the
       * injected path. Reusing that assumption here would produce
       * "[object Object]" as an address, which is the kind of bug that only
       * surfaces after somebody has sent funds.
       */
      const address = res?.accounts?.[0]?.address;
      if (!address) throw new Error('NO_ACCOUNT');
      /*
       * Held here because MWA does NOT populate `window.solana.publicKey` the
       * way an injected wallet does — `solanaAddress()` below reads that, and
       * would report null immediately after a successful MWA connection,
       * making the screen look like the connection had failed.
       */
      mwaAddress = address;
      return address;
    }
    throw new Error('NO_WALLET');
  }

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
  /* Cleared FIRST and unconditionally: if the wallet's own disconnect throws,
     the catch below swallows it, and leaving this set would keep the UI
     showing a connected address the user just asked to remove. */
  mwaAddress = null;
  try {
    await getSolanaProvider()?.disconnect?.();
  } catch {
    /* a wallet that cannot disconnect is not an error worth surfacing */
  }
  try {
    await getMwaWallet()?.features?.['standard:disconnect']?.disconnect?.();
  } catch {
    /* same reasoning */
  }
}

/**
 * The currently connected address, or null.
 *
 * The injected provider is authoritative when present. `mwaAddress` is the
 * fallback for an Android Chrome session, where no provider object exists at
 * all and the address is only known from the connect response.
 */
export function solanaAddress() {
  const p = getSolanaProvider();
  return p?.publicKey?.toString?.() ?? mwaAddress ?? null;
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

/**
 * Sign AND broadcast — the OpenOcean path.
 *
 * ─── WHY THIS IS A SEPARATE FUNCTION FROM signSolanaTransaction ─────────────
 * The two aggregators have opposite responsibilities for landing the trade,
 * and using the wrong helper fails in a way that looks like success.
 *
 *   Jupiter    returns a transaction and lands it ITSELF via /execute. We must
 *              sign only; broadcasting ourselves breaks RFQ routes, which are
 *              the ones that price best.
 *   OpenOcean  returns an unsigned transaction and nothing else. Nobody sends
 *              it but us. Signing only would leave the user staring at a
 *              spinner for a swap that was never submitted.
 *
 * Folding these into one function with a flag was the obvious tidy option and
 * is rejected deliberately: the failure mode of getting the flag wrong is a
 * silently unsent money transaction, and two named functions cannot be
 * confused at the call site.
 *
 * `signAndSendTransaction` is part of the Solana wallet standard and is
 * implemented by both Phantom and Solflare. Where a wallet somehow lacks it we
 * fall back to sign-then-send through the wallet's own connection rather than
 * failing outright.
 *
 * @param {string}  base64Tx    the transaction from /api/solana/oo/swap
 * @param {boolean} [versioned] whether to use VersionedTransaction. Passed
 *        through from the API's `isVersioned` rather than guessed — the wrong
 *        deserialiser throws at signing time, after the user has committed.
 * @returns {Promise<string>} the transaction signature
 */
export async function signAndSendSolana(base64Tx, versioned = true) {
  const provider = getSolanaProvider();
  if (!provider) throw new Error('NO_WALLET');

  const { Transaction, VersionedTransaction } = await import('@solana/web3.js');

  let tx;
  try {
    const bytes = base64ToBytes(base64Tx);
    tx = versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes);
  } catch {
    throw new Error('BAD_TRANSACTION');
  }

  try {
    if (typeof provider.signAndSendTransaction === 'function') {
      const res = await provider.signAndSendTransaction(tx);
      // Phantom returns { signature }, some wallets return the string directly.
      const sig = typeof res === 'string' ? res : res?.signature;
      if (!sig) throw new Error('NO_SIGNATURE');
      return sig;
    }
    if (typeof provider.signTransaction === 'function') {
      const signed = await provider.signTransaction(tx);
      return await sendRawSolana(bytesToBase64(signed.serialize()));
    }
    throw new Error('CANNOT_SIGN');
  } catch (err) {
    if (err?.code === 4001 || /reject|denied|cancel/i.test(String(err?.message))) {
      throw new Error('REJECTED');
    }
    if (err?.message === 'CANNOT_SIGN' || err?.message === 'NO_SIGNATURE') throw err;
    throw new Error('SEND_FAILED');
  }
}

/**
 * Last-resort broadcast for a wallet that can sign but not send.
 *
 * Uses Solana's public RPC. That endpoint is heavily rate limited and is not a
 * production path — it exists only so an unusual wallet is not a dead end. The
 * common wallets all implement signAndSendTransaction and never reach here.
 */
/**
 * The Solana RPC to broadcast through.
 *
 * ─── A DEAD SETTING, NOW LIVE ───────────────────────────────────────────────
 * Settings has both a cluster selector (Mainnet/Devnet) and a custom Solana
 * RPC field. Both were stored, both were redrawn in the UI from what was
 * stored, and NOTHING read either one — this function had the public mainnet
 * endpoint hard-coded. So a user who pointed the app at their own node, or
 * switched to devnet to test, got neither, while the screen told them it had
 * taken effect. Exactly the same defect the custom EVM RPC had before it was
 * fixed, and the same one `expertMode` and `autoLockMinutes` each had.
 *
 * The store is read at call time rather than imported as a constant so a
 * change in Settings applies to the very next transaction without a reload.
 *
 * https only, for the reason spelled out in WalletContext: the Android
 * WebView blocks cleartext anyway, and quietly downgrading a wallet's RPC to
 * plaintext is worth refusing outright rather than failing obscurely.
 */
async function solanaRpcUrl() {
  try {
    const { useSettingsStore } = await import('../store/useSettingsStore');
    const st = useSettingsStore.getState();
    const custom = String(st.solanaRpc || '').trim();
    if (/^https:\/\//i.test(custom)) return custom;
    return st.solanaCluster === 'devnet'
      ? 'https://api.devnet.solana.com'
      : 'https://api.mainnet-beta.solana.com';
  } catch {
    return 'https://api.mainnet-beta.solana.com';
  }
}

async function sendRawSolana(base64Signed) {
  const res = await fetch(await solanaRpcUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [base64Signed, { encoding: 'base64', maxRetries: 3 }]
    })
  });
  const body = await res.json().catch(() => null);
  if (body?.error) throw new Error(body.error.message || 'SEND_FAILED');
  if (!body?.result) throw new Error('SEND_FAILED');
  return body.result;
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
