/**
 * THE SOLANA WALLET CONNECTION LAYER — one API over four transports.
 * ---------------------------------------------------------------------------
 * A Solana wallet can reach this app in four different ways, and until now each
 * one was wired where it was needed instead of being one layer with one
 * contract:
 *
 *   · Wallet Standard  — anything that registers itself (`window.navigator`
 *                        wallets, `@wallet-standard/app`). MWA presents itself
 *                        here, and so does any future standard wallet.
 *   · Mobile Wallet Adapter — the official `@solana-mobile/wallet-standard-mobile`
 *                        registration; Android Chrome only, because the intent
 *                        result has nowhere to return to on iOS or in a WebView.
 *   · injected providers — Phantom (`window.phantom.solana`), Solflare, Backpack
 *                        from a browser EXTENSION, or from inside the wallet's
 *                        own in-app browser.
 *   · deep links        — the wallet app opens, shows its approval screen and
 *                        returns to `redirect_link`. The only route that works
 *                        inside the APK and on a phone browser whose wallet was
 *                        never opened in our page.
 *
 * ─── WHY A LAYER AND NOT A REPLACEMENT ──────────────────────────────────────
 * Every transport below is ALREADY implemented, tested and shipped
 * (`lib/solanaWallet.js`, `lib/solana/deeplink.js`, `lib/solana/signGuard.js`).
 * This module does not re-implement any of them: it detects what is actually
 * available, picks the transport, delegates, and normalises the answer — so a
 * caller never has to know whether the address came from an extension, an
 * intent, or an encrypted deeplink round trip.
 *
 * ─── CAPABILITIES ARE MEASURED, NOT ASSUMED ─────────────────────────────────
 * `capabilities()` reports, per method, whether the CURRENT transport can really
 * do it. Phantom's deeplink protocol has no `signAllTransactions`; Wallet
 * Standard exposes `solana:signTransaction` / `solana:signAndSendTransaction` /
 * `solana:signMessage` and nothing else. Claiming a method a wallet does not
 * implement is how a user ends up staring at a button that throws, so a method
 * that is not there is reported as `unsupported` with a reason.
 *
 * ─── NON-CUSTODIAL, BY CONSTRUCTION ─────────────────────────────────────────
 * Nothing in this file can produce a signature. It asks a wallet that holds a
 * key. It never sees, stores, transmits or requests a seed phrase, a private
 * key or a wallet password — the only values that leave a wallet are a public
 * address, a signature and a signed transaction.
 */

import {
  canUseMwa,
  connectSolana,
  disconnectSolana,
  getMwaWallet,
  getSolanaProvider,
  getStandardWallets,
  registerMobileWalletAdapter,
  solanaAddress,
  solanaWalletName
} from '../solanaWallet.js';
import { deeplinkSession, deeplinkWalletOptions, pendingDeeplinkRequest } from './deeplink.js';

/** The three wallets with a documented mobile deep link protocol. */
export const DEEPLINK_WALLET_IDS = Object.freeze(['phantom', 'solflare', 'backpack']);

/** Stable, translatable failure codes. Never a wallet's own error string. */
export const SOLANA_WALLET_ERRORS = Object.freeze({
  NO_WALLET: 'NO_WALLET',
  REJECTED: 'REJECTED',
  TIMEOUT: 'TIMEOUT',
  UNSUPPORTED: 'UNSUPPORTED',
  NO_ACCOUNT: 'NO_ACCOUNT',
  NO_SESSION: 'NO_SESSION',
  IN_WALLET: 'IN_WALLET',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  SIGN_FAILED: 'SIGN_FAILED',
  CONNECT_FAILED: 'CONNECT_FAILED'
});

/** Every method the unified API exposes. */
export const SOLANA_WALLET_METHODS = Object.freeze([
  'connect',
  'disconnect',
  'getPublicKey',
  'signMessage',
  'signTransaction',
  'signAllTransactions',
  'signAndSendTransaction'
]);

/**
 * Which wallet, if any, is injected on this window.
 *
 * Namespaced globals first, exactly like `getSolanaProvider()`: some wallets set
 * `window.solana` as a compatibility shim and then refuse to sign.
 */
export function detectInjectedWallets(win) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  if (!w) return [];
  const found = [];
  const flag = (value) => value === true;
  if (w.phantom?.solana || flag(w.solana?.isPhantom)) {
    found.push({ id: 'phantom', name: 'Phantom', provider: w.phantom?.solana ?? w.solana });
  }
  if (w.solflare || flag(w.solana?.isSolflare)) {
    found.push({ id: 'solflare', name: 'Solflare', provider: w.solflare ?? w.solana });
  }
  if (w.backpack || flag(w.solana?.isBackpack)) {
    found.push({ id: 'backpack', name: 'Backpack', provider: w.backpack ?? w.solana });
  }
  if (found.length === 0 && w.solana) {
    found.push({ id: 'unknown', name: 'Solana wallet', provider: w.solana });
  }
  return found;
}

/**
 * Every wallet this device can be asked for a connection, with the transport
 * that would be used. A DETECTION, not a claim about capabilities: an installed
 * extension is `injected`, Android Chrome's MWA registration is `standard`, and
 * the deep-link routes are always listed because a phone can always try to open
 * a wallet app even when nothing is injected.
 */
export function detectSolanaWallets({ win, includeDeeplink = true } = {}) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  const list = [];
  for (const injected of detectInjectedWallets(w)) {
    list.push({ ...injected, transport: 'injected', installed: true });
  }
  const standard = getStandardWallets();
  const mwa = getMwaWallet();
  if (mwa) {
    list.push({ id: 'mwa', name: mwa.name || 'Mobile Wallet Adapter', transport: 'standard', installed: true, wallet: mwa });
  }
  for (const other of standard) {
    if (other === mwa) continue;
    list.push({ id: String(other?.name ?? 'wallet').toLowerCase(), name: other?.name ?? 'Wallet Standard wallet', transport: 'standard', installed: true, wallet: other });
  }
  if (includeDeeplink) {
    for (const option of deeplinkWalletOptions()) {
      if (list.some((entry) => entry.id === option.id && entry.transport === 'injected')) continue;
      list.push({ id: option.id, name: option.label, transport: 'deeplink', installed: false });
    }
  }
  return list;
}

/**
 * The injected provider, resolved from the window this call was given.
 *
 * `getSolanaProvider()` reads the GLOBAL window, which is correct in the app and
 * useless in a test or in any caller that passes its own window. The passed
 * window wins; the global is the fallback. Same precedence as
 * `detectInjectedWallets()` uses, so detection and signing can never disagree
 * about which provider is «the» provider.
 */
function resolveProvider(win) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  if (w) {
    const injected = w.phantom?.solana
      ?? w.solflare
      ?? w.backpack
      ?? (w.solana?.isPhantom || w.solana?.isSolflare || w.solana?.isBackpack ? w.solana : null);
    if (injected) return injected;
  }
  return getSolanaProvider();
}

/** Which transport a connected address came from — decided by what is live. */
export function activeSolanaTransport({ win } = {}) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  const provider = resolveProvider(w);
  if (provider) {
    const injected = detectInjectedWallets(w)[0];
    return {
      transport: 'injected',
      walletId: injected?.id ?? null,
      name: injected?.name ?? solanaWalletName(),
      /* The provider's own key first: `solanaAddress()` reads the global window,
         so a caller that passed its own window would otherwise be told the
         address of a different one. */
      address: provider.publicKey?.toString?.() ?? solanaAddress()
    };
  }
  if (getMwaWallet() && solanaAddress()) {
    return { transport: 'standard', walletId: 'mwa', name: 'Mobile Wallet Adapter', address: solanaAddress() };
  }
  const session = deeplinkSession();
  if (session?.address) {
    return { transport: 'deeplink', walletId: session.walletId ?? null, name: solanaWalletName(), address: session.address };
  }
  return { transport: null, walletId: null, name: null, address: null };
}

/**
 * What the CURRENT transport can do, method by method.
 *
 * @returns {{transport:string|null, walletId:string|null, methods:object}}
 *   each method is `{ supported:boolean, reason?:string }`.
 */
export function walletCapabilities({ win } = {}) {
  const active = activeSolanaTransport({ win });
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  const injected = detectInjectedWallets(w)[0]?.provider ?? resolveProvider(w);
  const standard = getMwaWallet();
  const session = deeplinkSession();
  const methods = {};

  const supported = (reason) => ({ supported: true, ...(reason ? { reason } : {}) });
  const unsupported = (reason) => ({ supported: false, reason });

  /* connect is always possible while a wallet can be opened at all. */
  methods.connect = supported();
  methods.disconnect = supported();

  if (active.transport === 'injected' && injected) {
    methods.getPublicKey = supported();
    methods.signMessage = typeof injected.signMessage === 'function' ? supported() : unsupported('the injected wallet implements no signMessage');
    methods.signTransaction = typeof injected.signTransaction === 'function' ? supported() : unsupported('the injected wallet implements no signTransaction');
    methods.signAllTransactions = typeof injected.signAllTransactions === 'function'
      ? supported()
      : unsupported('the injected wallet implements no signAllTransactions');
    methods.signAndSendTransaction = typeof injected.signAndSendTransaction === 'function'
      ? supported()
      : unsupported('the injected wallet implements no signAndSendTransaction');
    return { ...active, methods };
  }

  if (active.transport === 'standard' && standard) {
    methods.getPublicKey = supported();
    methods.signMessage = standard.features?.['solana:signMessage'] ? supported() : unsupported('this wallet exposes no solana:signMessage');
    methods.signTransaction = standard.features?.['solana:signTransaction'] ? supported() : unsupported('this wallet exposes no solana:signTransaction');
    methods.signAllTransactions = unsupported('Wallet Standard defines no signAllTransactions feature');
    methods.signAndSendTransaction = standard.features?.['solana:signAndSendTransaction']
      ? supported()
      : unsupported('this wallet exposes no solana:signAndSendTransaction');
    return { ...active, methods };
  }

  if (active.transport === 'deeplink' && session) {
    methods.getPublicKey = supported();
    /* The deeplink protocol mirrors the provider API on three endpoints. */
    methods.signMessage = supported();
    methods.signTransaction = supported();
    methods.signAllTransactions = unsupported('the wallet deep-link protocol has no signAllTransactions request');
    methods.signAndSendTransaction = supported();
    return { ...active, methods };
  }

  /* Nothing connected: everything that needs an account is unsupported, and the
     reason names the thing to do first. */
  for (const method of SOLANA_WALLET_METHODS) {
    if (methods[method]) continue;
    methods[method] = unsupported('no Solana wallet is connected');
  }
  return { ...active, methods };
}

/**
 * Should the MWA registration be attempted on this device?
 * (Wrapped so a caller never has to know the platform rules itself.)
 */
export function walletStandardSupported({ win } = {}) {
  return canUseMwa() || getStandardWallets().length > 0;
}

/**
 * Connect through the best available transport.
 *
 * Order: an injected provider first (inside a wallet's own browser that is the
 * wallet the user chose), then a Wallet Standard wallet (MWA on Android Chrome),
 * then — only when `walletId` names one — the deep-link flow, which needs a user
 * gesture and therefore cannot be the silent default.
 *
 * @returns {Promise<{ok:boolean, code?:string, address?:string, transport?:string, walletId?:string, inWallet?:boolean}>}
 */
export async function connectSolanaWallet({ win, walletId = null, returnTo = '' } = {}) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  try {
    if (w && !resolveProvider(w) && !getMwaWallet()) {
      /* Best-effort MWA registration: on a device that cannot use it this is a
         no-op, and the deeplink route below is unaffected either way. */
      try {
        await registerMobileWalletAdapter(w.location?.origin);
      } catch { /* silent by design — see solanaWallet.js */ }
    }
    const address = await connectSolana();
    const active = activeSolanaTransport({ win: w });
    return { ok: true, address, transport: active.transport, walletId: active.walletId ?? walletId };
  } catch (error) {
    const code = String(error?.message || error);
    if (code === 'REJECTED') return { ok: false, code: SOLANA_WALLET_ERRORS.REJECTED };
    if (code === 'NO_ACCOUNT') return { ok: false, code: SOLANA_WALLET_ERRORS.NO_ACCOUNT };
    if (code === 'NO_WALLET') {
      /*
       * Nothing injected and no standard wallet. On a phone that is not a dead
       * end: the deeplink flow hands the request to Phantom / Solflare /
       * Backpack, which shows its own approval screen. It is only started when
       * the caller named a wallet, because the hand-off needs a user gesture.
       */
      if (walletId && DEEPLINK_WALLET_IDS.includes(walletId)) {
        const { startDeeplinkConnect } = await import('./deeplink.js');
        const res = await startDeeplinkConnect(walletId, { returnTo });
        if (res?.ok && res.address) {
          return { ok: true, address: res.address, transport: 'deeplink', walletId };
        }
        if (res?.code === 'IN_WALLET') return { ok: false, code: SOLANA_WALLET_ERRORS.IN_WALLET, walletId };
        return { ok: false, code: res?.code ?? SOLANA_WALLET_ERRORS.NO_WALLET, walletId };
      }
      return { ok: false, code: SOLANA_WALLET_ERRORS.NO_WALLET };
    }
    return { ok: false, code: SOLANA_WALLET_ERRORS.CONNECT_FAILED, error: code };
  }
}

/** Disconnect whichever transport is live. Never throws. */
export async function disconnectSolanaWallet() {
  try {
    await disconnectSolana();
    return { ok: true };
  } catch (error) {
    return { ok: false, code: SOLANA_WALLET_ERRORS.CONNECT_FAILED, error: String(error?.message || error) };
  }
}

/**
 * The connected public address, or null. Synchronous — no wallet is asked.
 *
 * Reads the provider the caller's window holds BEFORE the global one: a hook or
 * a test that was handed its own window must be answered about THAT window, and
 * the deep-link session is the fallback for the transport that has no provider
 * at all (which is every deeplink connection).
 */
export function getSolanaPublicKey({ win } = {}) {
  const provider = resolveProvider(win);
  if (provider) return provider.publicKey?.toString?.() ?? null;
  const session = deeplinkSession();
  return session?.address ?? solanaAddress();
}

/** A pending deep-link request, if one is owed an answer. */
export function pendingSolanaRequest() {
  return pendingDeeplinkRequest();
}

function unsupportedResult(method, { win } = {}) {
  return {
    ok: false,
    code: SOLANA_WALLET_ERRORS.UNSUPPORTED,
    reason: walletCapabilities({ win }).methods[method]?.reason ?? `${method} is not available on this transport`
  };
}

/**
 * Sign a message with the connected wallet.
 *
 * @param {Uint8Array|string} message bytes, or a string to be UTF-8 encoded
 * @returns {Promise<{ok:boolean, code?:string, signature?:string}>} base58 (deeplink)
 *   or base64 (injected/standard) — the transport's own encoding, named in `encoding`.
 */
export async function signSolanaMessage(message, { win } = {}) {
  const caps = walletCapabilities({ win });
  if (!caps.methods.signMessage?.supported) return unsupportedResult('signMessage', { win });
  const bytes = message instanceof Uint8Array ? message : new TextEncoder().encode(String(message ?? ''));

  const provider = resolveProvider(win);
  if (caps.transport === 'injected' && provider) {
    try {
      const res = await provider.signMessage(bytes, 'utf8');
      const signature = res?.signature ?? res;
      return { ok: true, signature: toBase64(signature), encoding: 'base64' };
    } catch (error) {
      return signError(error);
    }
  }
  if (caps.transport === 'standard') {
    const wallet = getMwaWallet();
    const feature = wallet?.features?.['solana:signMessage'];
    const account = wallet?.accounts?.[0];
    if (!feature?.signMessage || !account) return unsupportedResult('signMessage', { win });
    try {
      const [out] = await feature.signMessage({ account, message: bytes });
      return { ok: true, signature: toBase64(out?.signature ?? out), encoding: 'base64' };
    } catch (error) {
      return signError(error);
    }
  }
  const { deeplinkSignMessage } = await import('./deeplink.js');
  const res = await deeplinkSignMessage(bytes);
  if (res?.ok) return { ok: true, signature: res.signature, encoding: 'base58' };
  return { ok: false, code: res?.code ?? SOLANA_WALLET_ERRORS.SIGN_FAILED };
}

/**
 * Sign a transaction WITHOUT broadcasting (Jupiter lands it itself).
 * @param {string} base64Tx
 */
export async function signSolanaTransaction(base64Tx, { win } = {}) {
  const caps = walletCapabilities({ win });
  if (!caps.methods.signTransaction?.supported) return unsupportedResult('signTransaction', { win });
  if (caps.transport === 'deeplink') {
    const { deeplinkSignTransaction } = await import('./deeplink.js');
    const res = await deeplinkSignTransaction(base64Tx);
    return res?.ok
      ? { ok: true, transaction: res.transaction, encoding: 'base64' }
      : { ok: false, code: res?.code ?? SOLANA_WALLET_ERRORS.SIGN_FAILED };
  }
  try {
    /* The shipped implementation already covers injected + Wallet Standard +
       deeplink, including the versioned-transaction deserialiser. Delegating
       keeps ONE signing path instead of two that can disagree. */
    const { signSolanaTransaction: sign } = await import('../solanaWallet.js');
    return { ok: true, transaction: await sign(base64Tx), encoding: 'base64' };
  } catch (error) {
    return signError(error);
  }
}

/**
 * Sign several transactions.
 *
 * Only the injected transport implements this (Phantom, Solflare, Backpack from
 * an extension or an in-app browser). Everywhere else the honest answer is
 * `UNSUPPORTED` — signing them one by one through a deeplink would open the
 * wallet app N times, which is not the same operation and must not be presented
 * as one.
 */
export async function signAllSolanaTransactions(list, { win } = {}) {
  const caps = walletCapabilities({ win });
  if (!caps.methods.signAllTransactions?.supported) return unsupportedResult('signAllTransactions', { win });
  const provider = resolveProvider(win);
  if (!provider || typeof provider.signAllTransactions !== 'function') return unsupportedResult('signAllTransactions', { win });
  const transactions = await Promise.all(
    (Array.isArray(list) ? list : []).map(async (entry) => {
      if (entry && typeof entry === 'object' && typeof entry.serialize === 'function') return entry;
      const { VersionedTransaction } = await import('@solana/web3.js');
      return VersionedTransaction.deserialize(toBytesFromBase64(String(entry)));
    })
  );
  try {
    const signed = await provider.signAllTransactions(transactions);
    return {
      ok: true,
      transactions: (signed ?? []).map((tx) => toBase64(tx?.serialize?.() ?? tx)),
      encoding: 'base64'
    };
  } catch (error) {
    return signError(error);
  }
}

/** Sign AND broadcast — the wallet sends it. Returns the transaction signature. */
export async function signAndSendSolanaTransaction(base64Tx, { versioned = true, win } = {}) {
  const caps = walletCapabilities({ win });
  if (!caps.methods.signAndSendTransaction?.supported) return unsupportedResult('signAndSendTransaction', { win });
  if (caps.transport === 'deeplink') {
    const { deeplinkSignAndSendTransaction } = await import('./deeplink.js');
    const res = await deeplinkSignAndSendTransaction(base64Tx);
    if (res?.ok) return { ok: true, signature: res.signature, encoding: 'base58' };
    /* `id` and `warnings` must survive this hop. The caller that gets IN_WALLET
       is looking at a REQUEST, not a failure: the signature it is about to
       receive arrives in a different document, and the request id is the only
       handle that document has on it (see SolanaLendingPanel).` */
    return {
      ok: false,
      code: res?.code ?? SOLANA_WALLET_ERRORS.SIGN_FAILED,
      ...(res?.id ? { id: res.id } : {}),
      ...(res?.warnings?.length ? { warnings: res.warnings } : {})
    };
  }
  try {
    const { signAndSendSolana } = await import('../solanaWallet.js');
    const signature = await signAndSendSolana(base64Tx, versioned);
    return { ok: true, signature, encoding: 'base58' };
  } catch (error) {
    return signError(error);
  }
}

function signError(error) {
  const raw = String(error?.message || error);
  if (raw === 'REJECTED' || error?.code === 4001 || /reject|denied|cancel/i.test(raw)) {
    return { ok: false, code: SOLANA_WALLET_ERRORS.REJECTED };
  }
  if (raw === 'NO_WALLET') return { ok: false, code: SOLANA_WALLET_ERRORS.NO_WALLET };
  if (raw === 'NO_SESSION') return { ok: false, code: SOLANA_WALLET_ERRORS.NO_SESSION };
  if (raw === 'UNSUPPORTED_TRANSACTION' || raw === 'CANNOT_SIGN') return { ok: false, code: SOLANA_WALLET_ERRORS.UNSUPPORTED, reason: raw };
  return { ok: false, code: SOLANA_WALLET_ERRORS.SIGN_FAILED, error: raw };
}

function toBase64(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
}

function toBytesFromBase64(value) {
  if (typeof atob === 'function') {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/**
 * THE WHOLE LAYER, AS ONE OBJECT.
 *
 * The React tree keeps using the hooks it always used; this is the surface for
 * everything that is not a component — the Intent OS execution path, the health
 * panel and the tests — so there is one place to read «can we sign, and with
 * what» instead of four.
 */
export function createSolanaWalletLayer({ win } = {}) {
  return {
    detect: () => detectSolanaWallets({ win }),
    active: () => activeSolanaTransport({ win }),
    capabilities: () => walletCapabilities({ win }),
    connect: (options = {}) => connectSolanaWallet({ win, ...options }),
    disconnect: () => disconnectSolanaWallet(),
    getPublicKey: () => getSolanaPublicKey({ win }),
    pendingRequest: () => pendingSolanaRequest(),
    signMessage: (message) => signSolanaMessage(message, { win }),
    signTransaction: (tx) => signSolanaTransaction(tx, { win }),
    signAllTransactions: (list) => signAllSolanaTransactions(list, { win }),
    signAndSendTransaction: (tx, options = {}) => signAndSendSolanaTransaction(tx, { ...options, win })
  };
}
