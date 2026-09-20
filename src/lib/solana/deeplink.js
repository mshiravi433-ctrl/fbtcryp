/**
 * SOLANA DEEPLINK CONNECT + SIGN — the flow behind the in-app approval sheet.
 * ---------------------------------------------------------------------------
 * See ./deeplinkUri.js for the reported bug this whole path exists for. This
 * file is the stateful half: it creates the session key pair, sends the
 * request, waits for the wallet to come back, decrypts the answer and stores
 * the session so the rest of the app can sign with it.
 *
 * ─── THE THREE STATES A CONNECT CAN BE IN ───────────────────────────────────
 *   1. WAITING — the request is built and stored, the wallet app has been
 *      opened, and we are owed an answer. The stored record is what lets the
 *      answer be recognised after a reload: on a phone the wallet returns by
 *      REOPENING this page, so nothing may be kept only in React state.
 *   2. CONNECTED — a session exists: an address, the wallet's encryption
 *      public key and the session token it returned. Signing requests are
 *      addressed to that session and still require an approval IN THE WALLET
 *      for every transaction — the session authorises ASKING, never spending.
 *   3. ERROR — the wallet said no (4001), or it answered with something the
 *      session cannot be built from. Named codes, never a vague failure: the
 *      user is standing in another app and must be told what to do next.
 *
 * ─── WHY THE KEYS LIVE IN localStorage ──────────────────────────────────────
 * The dapp key pair and the session are exactly what WalletConnect keeps in
 * localStorage for the EVM side (`wc@2:…`), and for the same reason: the
 * wallet's answer arrives as a NEW PAGE LOAD, so anything held only in memory
 * is gone by the time it lands. Nothing here can move funds: every signature
 * still has to be approved by the user inside their wallet, and the record
 * expires with the same lease the user chose for WalletConnect
 * (Settings → Security → «مدت اتصال کیف پول»).
 *
 * ─── NO STATIC CRYPTO IMPORT ────────────────────────────────────────────────
 * `tweetnacl` is imported dynamically inside the two functions that need it,
 * so a user who never connects a Solana wallet never downloads it — the same
 * reasoning that keeps @solana/web3.js out of the entry chunk.
 */
import { isNativeShell, publicAppUrl } from '../nativeShell.js';
import { inspectSolanaTransaction } from './signGuard.js';
import {
  DEEPLINK_WALLETS,
  androidIntentRequestUrl,
  base58Decode,
  base58Encode,
  base64ToBytes,
  connectRequestUrl,
  deeplinkInstallUrl,
  deeplinkWallet,
  bytesToBase64,
  isDeeplinkReturn,
  randomNonce,
  randomRequestId,
  readDeeplinkReturn,
  signRequestUrl,
  stripDeeplinkReturn
} from './deeplinkUri.js';

const SESSION_KEY = 'fbt:solana:session:v1';
const PENDING_KEY = 'fbt:solana:pending:v1';
const RESULT_PREFIX = 'fbt:solana:result:';
const EVENT = 'solana:deeplink';
const WALLET_EVENT = 'solana:wallet-change';
/** A request the user never came back from stops being "waiting" after this. */
const PENDING_TTL_MS = 15 * 60 * 1000;
/** The redirect that carries the wallet's answer, on both channels. */
const RETURN_MARKER = 'sol=1';

/* -------------------------------------------------------------------------- */
/* storage — every read and write is guarded                                   */
/* -------------------------------------------------------------------------- */

function store() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    /* Safari private mode and some WebView settings throw on access. A wallet
       connection must not be the thing that breaks the screen. */
    return null;
  }
}

function readJson(key) {
  const ls = store();
  if (!ls) return null;
  try {
    const raw = ls.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  const ls = store();
  if (!ls) return false;
  try {
    ls.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key) {
  const ls = store();
  if (!ls) return;
  try {
    ls.removeItem(key);
  } catch {
    /* nothing to do — the entry expires on its own anyway */
  }
}

/* -------------------------------------------------------------------------- */
/* crypto — tweetnacl, lazily                                               */
/* -------------------------------------------------------------------------- */

async function nacl() {
  const mod = await import('tweetnacl');
  return mod.default ?? mod;
}

async function utf8(s) {
  return new TextEncoder().encode(s);
}

function fromUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

/** A fresh box key pair, base58-encoded for the URL and for storage. */
async function newBoxKeyPair() {
  const n = await nacl();
  const pair = n.box.keyPair();
  return { publicKey: base58Encode(pair.publicKey), secretKey: base58Encode(pair.secretKey) };
}

/** The shared key both sides derive — X25519 + HSalsa20, i.e. nacl's box. */
async function sharedKey(walletPublicKey, dappSecretKey) {
  const n = await nacl();
  const pk = base58Decode(walletPublicKey);
  const sk = base58Decode(dappSecretKey);
  if (!pk || pk.length !== 32 || !sk || sk.length !== 32) return null;
  return n.box.before(pk, sk);
}

/**
 * Decrypt the wallet's answer.
 *
 * ON THE WIRE THE REQUEST IS PLAIN and the ANSWER IS SEALED — that is the
 * shape Phantom's own reference implementation uses, and it is worth stating
 * because the reverse assumption looks just as reasonable: the transaction we
 * ASK about travels as base58 in the URL (over https), while the wallet's
 * reply — `{ signature }`, `{ transaction }`, `{ public_key, session }` — is
 * sealed with the shared key and the per-request nonce. Getting this backwards
 * produces a connection that "succeeds" and then cannot sign anything.
 */
async function openBox(payloadBase58, nonceBase58, key) {
  const n = await nacl();
  const data = base58Decode(payloadBase58);
  const nonce = base58Decode(nonceBase58);
  if (!data || !nonce || nonce.length !== 24) return null;
  const opened = n.box.open.after(data, nonce, key);
  return opened || null;
}

/* -------------------------------------------------------------------------- */
/* the session                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The lease the user chose for wallet connections, read at call time.
 *
 * Deliberately the SAME setting the EVM WalletConnect session uses: a user
 * who asked to be re-connected silently for 60 minutes meant it for their
 * wallets, not for one of the two namespaces. `0` means "until I disconnect",
 * which is what the security screen offers as the strict option.
 */
function leaseMinutes() {
  try {
    /* eslint-disable-next-line global-require */
    const raw = readJson('fbt-settings');
    const n = Number(raw?.state?.walletSessionMinutes ?? raw?.walletSessionMinutes);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* fall through to the default */
  }
  return 60;
}

function sessionValid(session, now = Date.now()) {
  if (!session?.address || !session?.session || !session?.dappSecretKey) return false;
  if (!session.expiresAt) return true; // 0 minutes = until disconnect
  return Number(session.expiresAt) > now;
}

/** The stored session, or null when there is none / it has lapsed. */
export function deeplinkSession() {
  const session = readJson(SESSION_KEY);
  if (!session || !sessionValid(session)) return null;
  return session;
}

/** The address this session connected, or null. Used by solanaAddress(). */
export function deeplinkSessionAddress() {
  return deeplinkSession()?.address ?? null;
}

export function clearDeeplinkSession() {
  removeKey(SESSION_KEY);
  removeKey(PENDING_KEY);
}

/* -------------------------------------------------------------------------- */
/* flow state + notifications                                                  */
/* -------------------------------------------------------------------------- */

let state = { status: 'idle', walletId: null, address: null, code: null, requestId: null };
const listeners = new Set();
let awaiters = new Map(); // requestId -> { resolve, reject }

function emit(next) {
  state = { ...state, ...next };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      /* a subscriber must never break the connection it is watching */
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: state }));
    } catch {
      /* no-op */
    }
  }
}

function emitWalletChange(address) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(WALLET_EVENT, { detail: { address: address || null } }));
  } catch {
    /* no-op */
  }
}

export function deeplinkState() {
  return state;
}

export function subscribeDeeplink(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* -------------------------------------------------------------------------- */
/* pending requests                                                            */
/* -------------------------------------------------------------------------- */

function pendingList() {
  const list = readJson(PENDING_KEY);
  const rows = Array.isArray(list) ? list : [];
  const now = Date.now();
  return rows.filter((row) => now - Number(row?.createdAt || 0) < PENDING_TTL_MS);
}

function savePending(row) {
  const rows = pendingList().filter((r) => r.id !== row.id);
  rows.push(row);
  writeJson(PENDING_KEY, rows);
}

function dropPending(id) {
  writeJson(PENDING_KEY, pendingList().filter((r) => r.id !== id));
}

function findPending(id) {
  const rows = pendingList();
  if (id) return rows.find((r) => r.id === id) ?? null;
  return rows.length ? rows[rows.length - 1] : null;
}

/** The request the sheet should show as «منتظر تأیید…», if any. */
export function pendingDeeplinkRequest() {
  return findPending(null);
}

/* -------------------------------------------------------------------------- */
/* results — how an answer survives the reload the wallet causes               */
/* -------------------------------------------------------------------------- */

const LAST_RESULT_KEY = `${RESULT_PREFIX}last`;

function saveResult(id, result) {
  if (!id) return;
  writeJson(`${RESULT_PREFIX}${id}`, { ...result, at: Date.now() });
}

function readResult(id) {
  if (!id) return null;
  return readJson(`${RESULT_PREFIX}${id}`);
}

function publishResult(result) {
  writeJson(LAST_RESULT_KEY, { ...result, at: Date.now() });
}

/**
 * The last completed answer, read once and then forgotten.
 *
 * This is what lets the WALLET PAGE show the success state: the wallet
 * returns by reloading the page, so the component that opened the sheet is
 * gone and only the stored record is left to tell it "you are connected".
 */
export function consumeDeeplinkResult() {
  const last = readJson(LAST_RESULT_KEY);
  if (last) removeKey(LAST_RESULT_KEY);
  return last ?? null;
}

/* -------------------------------------------------------------------------- */
/* URLs                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Where the wallet must deposit its answer.
 *
 * ─── WHY THE APP ROOT AND NOT THE CURRENT PAGE ──────────────────────────────
 * The wallet appends its own parameters to this string. Handing it the page we
 * are on — `https://fbtswap.ir/#/wallet?tab=solana` — makes it append after a
 * hash that already contains a query, and the answer ends up somewhere no
 * `URLSearchParams` can see (see readDeeplinkReturn). `https://fbtswap.ir/?sol=1`
 * has a plain query, so the wallet's parameters land where they are expected —
 * and the record stored in localStorage already knows which screen to put the
 * user back on (`returnTo`).
 *
 * Inside the APK the WebView reports `https://localhost`, which is useless as
 * a redirect for an app that is already running: the custom scheme registered
 * in AndroidManifest (ir.fbtswap.app://) brings the user BACK INTO THIS APP,
 * where the pending request is still waiting.
 */
export function deeplinkRedirect(requestId) {
  if (isNativeShell()) return `ir.fbtswap.app://solconnect?rid=${encodeURIComponent(requestId)}`;
  return publicAppUrl(`/?${RETURN_MARKER}&rid=${encodeURIComponent(requestId)}`);
}

function currentReturnTo() {
  if (typeof window === 'undefined') return '';
  const hash = String(window.location.hash || '');
  return /^#\//.test(hash) ? hash : '';
}

/* -------------------------------------------------------------------------- */
/* opening the wallet                                                          */
/* -------------------------------------------------------------------------- */

/**
 * An Android BROWSER (not a WebView) that speaks Chrome's `intent://` scheme.
 *
 * Mirrors `isIntentCapableBrowser` in lib/wc/handoff.js — duplicated rather
 * than imported because that module pulls in the whole WalletConnect wallet
 * table for one UA test, and this path must stay loadable in the Solana-only
 * chunk. The allowlist is a UA allowlist on purpose: Firefox on Android and
 * any embedded WebView have nothing that intercepts `intent://`, and handing
 * one to them is a navigation to a scheme they cannot render.
 */
function intentCapableView(view) {
  const ua = String(view?.navigator?.userAgent ?? '');
  if (!/Android/i.test(ua)) return false;
  /* Android's own WebView marks itself `; wv`; Telegram's Mini App injects its
     bridge on top of a plain one. Neither resolves `intent://`. */
  if (/; wv\b/i.test(ua)) return false;
  if (view?.Telegram || view?.TelegramWebviewProxy || view?.TelegramWebviewProxyProto) return false;
  return /chrome|chromium|crios|samsungbrowser|ucbrowser|opr|edg|miuibrowser|huaweibrowser|vivaldi|heyTapBrowser|oppobrowser/i.test(ua);
}

/**
 * The ordered routes one wallet request can travel by, first try first.
 *
 * ─── THE BUG THIS TABLE EXISTS TO FIX ───────────────────────────────────────
 * The report: «میره داخل اپ فانتوم ولی هیچ صفحه‌ای برای تأیید اتصال نمی‌آره».
 * Phantom's connect request IS its query string, so every route that drops or
 * re-renders the URL produces exactly that: the wallet in front of the user,
 * nothing to approve. Two routes in this app did:
 *
 *   • the APK opened the universal link in a CHROME CUSTOM TAB. Custom Tabs
 *     render http/https themselves and never hand them to another app (custom
 *     schemes only), so phantom.app was loaded as a web page inside our own
 *     app — and the "open in Phantom" tap that followed arrived at the wallet
 *     without the request.
 *   • a browser navigated the page ITSELF to the universal link. The wallet
 *     got it, but the document holding the pending request did not survive to
 *     see the answer — which is why a signature came back to an app that had
 *     already given up on it.
 *
 * So the order is: an EXPLICIT hand-off first (native bridge / `intent://`,
 * both of which name the package and keep this page alive), and the universal
 * link only where nothing else can carry it (iOS, desktop, Firefox).
 *
 * Pure — takes the view — so the table is assertable in Node.
 */
export function deeplinkOpenRoutes({ walletId, url, view }) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  const wallet = deeplinkWallet(walletId);
  const list = [];

  /*
   * The view's own answer, not `isNativeShell()`'s read of the global window.
   * They agree in a browser; reading the argument is what makes this table
   * assertable in Node, where there is no window to be native.
   */
  const native = win?.Capacitor?.isNativePlatform?.() === true;

  if (native) {
    /* 1. The native ACTION_VIEW bridge. `setPackage` + the wallet's own
          App Link filter means Android delivers the URL, query and all, to
          the wallet's handler — the one route inside an APK that does. */
    if (wallet?.androidPackage) {
      list.push({ route: 'native-intent', url, packageName: wallet.androidPackage, mode: 'bridge' });
    }
    /* 2. A Custom Tab. Cannot deliver an App Link, but it is a real browser
          with a visible address bar, so it is still better than nothing —
          and on an APK old enough to have no bridge it is all there is. */
    list.push({ route: 'custom-tab', url, mode: 'tab' });
    /* 3. Hand the URL to Android and let the OS route it. */
    list.push({ route: 'system', url, mode: 'system' });
    return list;
  }

  /* A browser that resolves `intent://`: the wallet is opened WITHOUT this
     document navigating, so the pending request survives the round trip. The
     fallback URL is the store page — the one thing worth navigating to when
     the wallet is not installed. */
  if (wallet?.androidPackage && intentCapableView(win)) {
    const intent = androidIntentRequestUrl({
      walletId,
      url,
      fallbackUrl: deeplinkInstallUrl(walletId)
    });
    if (intent) list.push({ route: 'intent', url: intent, mode: 'place' });
  }

  /* Telegram cannot navigate its Mini App, so its own opener goes first. */
  if (win?.Telegram?.WebApp?.openLink) {
    list.push({ route: 'telegram', url, mode: 'external' });
  }

  /* The universal link itself: correct on iOS (Safari offers the app switch)
     and on any browser the routes above did not cover. */
  list.push({ route: 'universal', url, mode: 'place' });
  return list;
}

/** Fire one route. Synchronous work happens before the first await so the
    user's gesture is still the reason the wallet opened. */
async function runRoute(route, win) {
  switch (route.route) {
    case 'native-intent': {
      const bridge = win?.FBTSolanaLink;
      if (!bridge?.openWalletLink) return false;
      try {
        return bridge.openWalletLink(route.url, route.packageName) === true;
      } catch {
        return false;
      }
    }
    case 'intent':
    case 'universal':
      try {
        win.location.assign(route.url);
        return true;
      } catch {
        return false;
      }
    case 'telegram':
      try {
        win.Telegram.WebApp.openLink(route.url, { try_instant_view: false });
        return true;
      } catch {
        return false;
      }
    case 'system':
      try {
        win.open(route.url, '_system');
        return true;
      } catch {
        return false;
      }
    case 'custom-tab': {
      try {
        const { openUrl } = await import('../browser.js');
        return (await openUrl(route.url, { allowSameTabFallback: false })) === true;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Open a wallet request URL, trying each route in order until one takes it.
 *
 * A route that "takes" the request is one where the URL provably reached
 * something that can act on it: the native bridge answers `true` only when
 * Android resolved the intent, and a navigation only counts when it did not
 * throw. Everything else falls through, so an APK without the new bridge and a
 * phone without the wallet still end up somewhere honest rather than silently
 * doing nothing.
 *
 * @returns {Promise<{ok:boolean, route:string|null, navigatedAway:boolean}>}
 *   `navigatedAway` answers «why does signing fail on a phone»: it is true
 *   only for the route that sends THIS document to the wallet's URL. There the
 *   pending promise cannot be resolved by this page, because this page is on
 *   its way out — so the caller is told, instead of spinning for fifteen
 *   minutes on an answer that will land in a brand-new document.
 */
async function openRequest(url, walletId = null) {
  if (typeof window === 'undefined') return { ok: false, route: null, navigatedAway: false };
  const routes = deeplinkOpenRoutes({ walletId, url, view: window });
  for (const route of routes) {
    /* eslint-disable-next-line no-await-in-loop — the order IS the behaviour */
    if (await runRoute(route, window)) {
      return { ok: true, route: route.route, navigatedAway: route.route === 'universal' };
    }
  }
  return { ok: false, route: null, navigatedAway: false };
}

/** Close the Custom Tab we opened, once the wallet has answered. */
async function closeOpenedTab() {
  if (!isNativeShell()) return;
  try {
    const mod = await import('@capacitor/browser');
    await mod?.Browser?.close?.();
  } catch {
    /* nothing open — fine */
  }
}

/* -------------------------------------------------------------------------- */
/* the native return path (APK)                                                */
/* -------------------------------------------------------------------------- */

let nativeQueue = [];
/*
 * URLs already handed in by native code.
 *
 * MainActivity delivers a deep link BOTH by pushing it into the WebView and by
 * keeping it for `consume()` (see the comment there: the push is lost if the
 * page is still booting, the inbox is empty if the WebView was alive). The two
 * channels therefore overlap, and without this set the same answer would be
 * processed twice — the second time with no pending request behind it, which
 * would flash an error over a connection that had just succeeded.
 */
const seenNativeUrls = new Set();

/**
 * Install the hook the APK calls with an incoming deep link.
 *
 * MainActivity forwards `ir.fbtswap.app://solconnect?…` here from both
 * onNewIntent (the app was already running — the normal case, because the
 * WebView was kept alive by the Custom Tab) and onCreate (the app had been
 * killed). It ALSO stores the URL natively and exposes `consume()` for the
 * cold-start race: the WebView may not have run this file yet when the first
 * deep link arrives, and a connect request answered into the void would leave
 * the user staring at «منتظر تأیید…» forever.
 */
export function installNativeDeepLinkBridge(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return;
  win.FBTDeepLink = (url) => {
    try {
      const value = url ? String(url) : '';
      if (value && !seenNativeUrls.has(value)) {
        seenNativeUrls.add(value);
        nativeQueue.push(value);
      }
      drainDeeplinkQueue();
    } catch {
      /* never throw into native code */
    }
  };
}

function takeNativeDeepLinks() {
  const win = typeof window !== 'undefined' ? window : null;
  if (!win) return [];
  const out = [];
  try {
    /* Native-side inbox: drained so a cold start cannot deliver the same
       answer twice. */
    let next = win.FBTDeepLinkBridge?.consume?.();
    let guard = 0;
    while (next && guard < 8) {
      const value = String(next);
      if (!seenNativeUrls.has(value)) {
        seenNativeUrls.add(value);
        out.push(value);
      }
      next = win.FBTDeepLinkBridge?.consume?.();
      guard += 1;
    }
  } catch {
    /* not the APK */
  }
  if (nativeQueue.length) {
    out.push(...nativeQueue);
    nativeQueue = [];
  }
  return out;
}

function drainDeeplinkQueue() {
  const urls = takeNativeDeepLinks();
  for (const url of urls) {
    Promise.resolve(completeDeeplinkReturn(url)).catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* completing an answer                                                        */
/* -------------------------------------------------------------------------- */

function errorCodeOf(code) {
  const n = String(code ?? '');
  if (n === '4001' || /user rejected|cancell?ed|declined/i.test(n)) return 'REJECTED';
  if (/not found|no such/i.test(n)) return 'WALLET_NOT_FOUND';
  return 'WALLET_ERROR';
}

async function applyConnectAnswer(pending, params) {
  const key = await sharedKey(params.walletEncryptionPublicKey, pending.dappSecretKey);
  if (!key) return { ok: false, code: 'DECRYPT_FAILED' };
  const opened = await openBox(params.data, params.nonce, key);
  if (!opened) return { ok: false, code: 'DECRYPT_FAILED' };
  let payload = null;
  try {
    payload = JSON.parse(fromUtf8(opened));
  } catch {
    return { ok: false, code: 'BAD_PAYLOAD' };
  }
  const address = payload?.public_key || payload?.publicKey || null;
  if (!address) return { ok: false, code: 'NO_ACCOUNT' };

  const minutes = leaseMinutes();
  const session = {
    v: 1,
    walletId: pending.walletId,
    address,
    dappPublicKey: pending.dappPublicKey,
    dappSecretKey: pending.dappSecretKey,
    walletEncryptionPublicKey: params.walletEncryptionPublicKey,
    session: payload.session || null,
    createdAt: Date.now(),
    expiresAt: minutes > 0 ? Date.now() + minutes * 60_000 : null
  };
  writeJson(SESSION_KEY, session);
  return { ok: true, op: 'connect', walletId: pending.walletId, address, session };
}

async function applySignAnswer(pending, params) {
  const key = await sharedKey(pending.walletEncryptionPublicKey, pending.dappSecretKey);
  if (!key) return { ok: false, code: 'DECRYPT_FAILED' };
  const opened = await openBox(params.data, params.nonce, key);
  if (!opened) return { ok: false, code: 'DECRYPT_FAILED' };
  let payload = null;
  try {
    payload = JSON.parse(fromUtf8(opened));
  } catch {
    return { ok: false, code: 'BAD_PAYLOAD' };
  }

  if (pending.op === 'signMessage') {
    const signature = payload?.signature || null;
    if (!signature) return { ok: false, code: 'NO_SIGNATURE' };
    return { ok: true, op: 'signMessage', signature, publicKey: payload.public_key ?? null };
  }

  /* signAndSendTransaction answers with the transaction signature;
     signTransaction answers with the signed transaction itself. Some builds
     return the bytes base58-encoded instead of base64 — normalise to base64,
     which is what every caller in this app already speaks. */
  const signature = payload?.signature || null;
  const transaction = payload?.transaction || null;
  if (signature) {
    return { ok: true, op: pending.op, signature, publicKey: payload.public_key ?? null };
  }
  if (transaction) {
    const looksBase58 = /^[1-9A-HJ-NP-Za-km-z]+$/.test(transaction) && !/[+/=]/.test(transaction);
    const bytes = looksBase58 ? base58Decode(transaction) : null;
    const base64 = bytes ? bytesToBase64(bytes) : transaction;
    return { ok: true, op: pending.op, transaction: base64, publicKey: payload.public_key ?? null };
  }
  return { ok: false, code: 'NO_SIGNATURE' };
}

/**
 * Turn a URL the wallet sent us back into a completed operation.
 *
 * Safe to call on any URL — a page load, a deep link from the APK, a stray
 * `hashchange` — and safe to call more than once: an answer is matched to the
 * pending request it carries the id of, and a request can only be completed
 * once.
 */
export async function completeDeeplinkReturn(rawUrl) {
  const read = readDeeplinkReturn(rawUrl);
  if (read.state === 'none') return { ok: false, code: 'NOT_A_RETURN' };

  const requestId = read.params?.requestId ?? null;
  const pending = findPending(requestId);
  if (!pending) {
    /*
     * The same answer arriving twice (native push plus inbox — see
     * seenNativeUrls) is not a failure: the connection it asked for is
     * already stored, and reporting an error over it would tell the user
     * their successful approval went wrong.
     */
    const session = read.state === 'params' ? deeplinkSession() : null;
    if (session?.address) return { ok: true, already: true, address: session.address, walletId: session.walletId };
    /* Otherwise: the record expired, the user cleared storage, or the link was
       replayed. Say so rather than pretend something happened. */
    emit({ status: 'error', code: 'NO_PENDING', requestId });
    return { ok: false, code: 'NO_PENDING' };
  }

  if (read.state === 'error') {
    const code = errorCodeOf(read.error?.code);
    dropPending(pending.id);
    saveResult(pending.id, { ok: false, code, op: pending.op, walletId: pending.walletId });
    publishResult({ ok: false, code, op: pending.op, walletId: pending.walletId });
    emit({ status: 'error', code, walletId: pending.walletId, requestId: pending.id });
    settleAwaiter(pending.id, { ok: false, code });
    return { ok: false, code };
  }

  const result =
    pending.op === 'connect'
      ? await applyConnectAnswer(pending, read.params)
      : await applySignAnswer(pending, read.params);

  dropPending(pending.id);
  /* `warnings` rides along with the stored answer: a signature that arrives as
     a page load is read by a document that never saw the request, and the
     reason Phantom showed a risk dialog is the one thing that document still
     needs in order to explain itself. */
  const stored = { ...result, walletId: pending.walletId, op: pending.op, warnings: pending.warnings ?? [] };
  saveResult(pending.id, stored);
  publishResult(stored);

  if (result.ok) {
    if (result.op === 'connect') {
      emit({ status: 'connected', address: result.address, walletId: pending.walletId, requestId: pending.id, code: null });
      emitWalletChange(result.address);
    } else {
      emit({ status: 'signed', walletId: pending.walletId, requestId: pending.id, code: null });
    }
  } else {
    emit({ status: 'error', code: result.code, walletId: pending.walletId, requestId: pending.id });
  }

  settleAwaiter(pending.id, result);

  await closeOpenedTab();

  /* Put the user back where they were when a reload is what brought them back
     to us (the browser case). A hash change only — no new document, so this
     cannot loop. */
  if (result.ok && result.op === 'connect' && pending.returnTo && typeof window !== 'undefined') {
    try {
      if (String(window.location.hash || '') !== pending.returnTo) window.location.hash = pending.returnTo;
    } catch {
      /* the connection is already stored; navigation is cosmetic */
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* public flow                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Start a connect request and open the wallet.
 *
 * Resolves immediately with what the app needs to render (the request id and
 * the wallet) — NOT when the user approves, which may be a page load later.
 * The sheet follows the `solana:deeplink` event instead. A caller that truly
 * needs the final answer can await `awaitDeeplinkRequest(id)`.
 */
export async function startDeeplinkConnect(walletId, { returnTo } = {}) {
  const wallet = deeplinkWallet(walletId);
  if (!wallet) return { ok: false, code: 'UNKNOWN_WALLET' };
  if (!store()) return { ok: false, code: 'NO_STORAGE' };

  const pair = await newBoxKeyPair();
  const id = randomRequestId();
  const url = connectRequestUrl({
    walletId,
    dappPublicKey: pair.publicKey,
    redirectLink: deeplinkRedirect(id),
    appUrl: publicAppUrl('/'),
    cluster: 'mainnet-beta'
  });
  if (!url) return { ok: false, code: 'UNKNOWN_WALLET' };

  savePending({
    id,
    op: 'connect',
    walletId,
    url,
    dappPublicKey: pair.publicKey,
    dappSecretKey: pair.secretKey,
    returnTo: returnTo ?? currentReturnTo(),
    createdAt: Date.now()
  });

  emit({ status: 'waiting', walletId, address: null, code: null, requestId: id });

  const opened = await openRequest(url, walletId);
  if (!opened.ok) {
    emit({ status: 'error', walletId, code: 'OPEN_FAILED', requestId: id });
    return { ok: false, code: 'OPEN_FAILED', id };
  }
  /* `route` is what the health report and the waiting card can name when a
     user writes «it opened the wallet and nothing happened»: which of the
     four channels actually carried the request, and whether this page is
     still here to hear the answer. */
  emit({ status: 'waiting', walletId, requestId: id, code: null, route: opened.route });
  return { ok: true, id, walletId, route: opened.route, navigatedAway: opened.navigatedAway };
}

/**
 * Re-open the wallet for a request that is still waiting.
 *
 * The same URL is re-fired, so the wallet shows the SAME approval — not a new
 * pairing the user has to reason about. This is the button that saves the flow
 * when a phone drops the wallet on its home screen instead of ours.
 */
export async function reopenDeeplinkRequest(id) {
  const pending = findPending(id ?? null);
  if (!pending?.url) return { ok: false, code: 'NO_PENDING' };
  emit({ status: 'waiting', walletId: pending.walletId, requestId: pending.id, code: null });
  const opened = await openRequest(pending.url, pending.walletId);
  if (!opened.ok) return { ok: false, code: 'OPEN_FAILED', id: pending.id };
  return { ok: true, id: pending.id, route: opened.route, inWallet: opened.navigatedAway };
}

/** Give up on the waiting request (the user closed the sheet or cancelled). */
export function cancelDeeplinkRequest(id) {
  const pending = findPending(id ?? null);
  if (!pending) {
    emit({ status: 'idle', code: null, requestId: null });
    return false;
  }
  dropPending(pending.id);
  settleAwaiter(pending.id, { ok: false, code: 'CANCELLED' });
  emit({ status: 'idle', walletId: pending.walletId, code: null, requestId: null });
  return true;
}

/**
 * Hand a result to whoever is waiting for it — ONCE — and stop the poll behind it.
 *
 * The poll below lives for up to fifteen minutes, so a waiter settled by the
 * answer arriving any OTHER way (a `storage` event, a cancel, a rejection)
 * must have its interval cleared here. Without that, every completed request
 * leaves a timer running behind it: harmless-looking in a browser, but in a
 * test process it keeps the event loop alive long after the suite has printed
 * its results, which is how this was found.
 */
function settleAwaiter(id, value) {
  const waiter = awaiters.get(id);
  if (!waiter) return false;
  awaiters.delete(id);
  if (waiter.timer) clearInterval(waiter.timer);
  waiter.resolve(value);
  return true;
}

/**
 * Wait for the stored answer of one request. Resolves, never rejects.
 *
 * The answer is looked for twice over: through the `storage` event (a second
 * tab completed it) and by polling the stored record. The poll is not
 * redundant — `storage` does not fire in the tab that wrote the value, and
 * some WebViews do not fire it at all, which would leave a swap staring at a
 * spinner for a transaction the wallet had already signed.
 */
export function awaitDeeplinkRequest(id) {
  const existing = readResult(id);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    awaiters.set(id, { resolve });
    const started = Date.now();
    const timer = setInterval(() => {
      const result = readResult(id);
      if (result) {
        settleAwaiter(id, result);
        return;
      }
      if (Date.now() - started > PENDING_TTL_MS) {
        settleAwaiter(id, { ok: false, code: 'TIMEOUT' });
      }
    }, 1200);
    /* The handle the poll above and `settleAwaiter` share, so every path that
       answers a waiter can stop the timer. */
    awaiters.get(id).timer = timer;
  });
}

/**
 * Sign (and let the wallet broadcast) through a deeplink session.
 *
 * Every call opens the wallet for a fresh approval — that is the deal with a
 * deeplink session and it is stated in the UI. Nothing here can sign on its
 * own: the session token only lets us ASK, and the wallet's own screen decides.
 */
async function signViaDeeplink(op, payloadBase58, rawTx = null) {
  const session = deeplinkSession();
  if (!session) return { ok: false, code: 'NO_SESSION' };
  const id = randomRequestId();
  /*
   * Read the transaction BEFORE the wallet is opened, not after it has already
   * frightened the user. Phantom's «this dApp could be malicious» screen is
   * its simulation warning, and for the two shapes below the wallet is right
   * to be cautious — so the reason is decided here and travels with the
   * request (see lib/solana/signGuard.js).
   */
  const guard = rawTx ? inspectSolanaTransaction(rawTx) : null;
  /* One nonce per request, shared with the wallet's encrypted answer — the
     value is generated here and never reused (see deeplinkUri.randomNonce). */
  const nonce = randomNonce();
  const url = signRequestUrl({
    walletId: session.walletId,
    op,
    dappPublicKey: session.dappPublicKey,
    nonce,
    session: session.session,
    redirectLink: deeplinkRedirect(id),
    payload: payloadBase58
  });
  if (!url) return { ok: false, code: 'UNKNOWN_WALLET' };

  const warnings = guard?.warnings ?? [];
  savePending({
    id,
    op,
    walletId: session.walletId,
    url,
    dappPublicKey: session.dappPublicKey,
    dappSecretKey: session.dappSecretKey,
    walletEncryptionPublicKey: session.walletEncryptionPublicKey,
    warnings,
    returnTo: currentReturnTo(),
    createdAt: Date.now()
  });
  emit({
    status: 'waiting',
    walletId: session.walletId,
    requestId: id,
    code: null,
    signing: true,
    warnings
  });

  const opened = await openRequest(url, session.walletId);
  if (!opened.ok) {
    dropPending(id);
    return { ok: false, code: 'OPEN_FAILED', warnings };
  }

  /*
   * THE HONEST ANSWER ON A NAVIGATING ROUTE.
   *
   * iOS Safari, Firefox on Android and any browser without `intent://` can only
   * be given the request by sending this very document to the wallet's URL.
   * The signature then comes back as a NEW PAGE LOAD of `redirect_link`, into a
   * fresh document with no memory of this promise — which is exactly how a
   * phone user came to read a successful signature as a failure. The answer is
   * not lost (it is stored under its request id and published as the last
   * result, and `consumeDeeplinkResult()` reads it on the next boot); what is
   * impossible is resolving a promise in a document that no longer exists. So
   * the caller is told, named, instead of hanging on the poll below.
   */
  if (opened.navigatedAway) {
    return { ok: false, code: 'IN_WALLET', id, warnings, route: opened.route };
  }
  const result = await awaitDeeplinkRequest(id);
  return warnings.length ? { ...result, warnings } : result;
}

/**
 * Wallet signs and broadcasts; we get the transaction signature back.
 *
 * `signAndSendTransaction` rather than sign-then-broadcast-by-us: the wallet
 * broadcasting is the pattern every security engine treats as normal, and the
 * one this project already committed to on the EVM side.
 */
export async function deeplinkSignAndSendTransaction(base64Tx) {
  return signViaDeeplink('signAndSendTransaction', base58Encode(base64ToBytes(base64Tx)), base64Tx);
}

/** Wallet signs only; the caller (Jupiter) lands the transaction itself. */
export async function deeplinkSignTransaction(base64Tx) {
  return signViaDeeplink('signTransaction', base58Encode(base64ToBytes(base64Tx)), base64Tx);
}

/** Wallet signs an arbitrary message. */
export async function deeplinkSignMessage(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : await utf8(String(bytes ?? ''));
  return signViaDeeplink('signMessage', base58Encode(raw));
}

/* -------------------------------------------------------------------------- */
/* boot + navigation drain                                                     */
/* -------------------------------------------------------------------------- */

let drained = false;

/**
 * Look for an answer everywhere one can arrive from.
 *
 * Called on boot, on `hashchange`, on `pageshow` and whenever the app comes
 * back to the foreground. All four are real: the browser case arrives as a
 * page load, the APK case as a JS callback, and a phone that switched apps
 * fires neither — only visibility.
 */
export function drainDeeplink({ force = false } = {}) {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (drained && !force) return Promise.resolve(null);
  drained = true;

  installNativeDeepLinkBridge(window);

  const url = window.location.href;
  const work = [];
  if (isDeeplinkReturn(url)) {
    work.push(
      completeDeeplinkReturn(url).then((result) => {
        /* Clean the address bar: the payload is unreadable to a human, it
           re-triggers this drain on every refresh, and a copied link would
           carry a signed payload into a chat. */
        try {
          const clean = stripDeeplinkReturn(url);
          if (clean !== url) window.history.replaceState(null, '', clean);
        } catch {
          /* history is cosmetic here — the connection is already stored */
        }
        return result;
      })
    );
  }
  drainDeeplinkQueue();
  return Promise.all(work).then((rows) => rows[0] ?? null);
}

let listenersInstalled = false;

/**
 * Watch every way an answer can come back, for the life of the document.
 *
 * The four channels are not belt-and-braces, they are four different real
 * situations:
 *
 *   • BOOT — the browser case. The wallet's redirect is a page load, so the
 *     answer is in `location` before React has mounted.
 *   • `FBTDeepLink` — the APK case. MainActivity forwards
 *     `ir.fbtswap.app://solconnect?…` into the live WebView, where the waiting
 *     sheet is still on screen.
 *   • `visibilitychange` / `pageshow` — the case neither of the above covers:
 *     the user tapped back into the app from the wallet's own back button, so
 *     the deep link never fires and the page never reloads.
 *   • `storage` — a second tab completed the request (the browser opened the
 *     redirect in a new tab). The tab that is still holding the pending
 *     promise hears about it here instead of waiting forever.
 */
export function installDeeplinkReturnListeners(win = typeof window !== 'undefined' ? window : null) {
  if (!win || listenersInstalled) return;
  listenersInstalled = true;
  installNativeDeepLinkBridge(win);

  const rescan = () => {
    drainDeeplink({ force: true });
  };
  try {
    win.addEventListener('hashchange', rescan);
    win.addEventListener('pageshow', rescan);
    win.addEventListener('focus', () => rescan());
    win.addEventListener('visibilitychange', () => {
      if (win.document?.visibilityState === 'visible') rescan();
    });
    win.addEventListener('storage', (event) => {
      const key = String(event?.key ?? '');
      if (!key.startsWith(RESULT_PREFIX)) return;
      const id = key.slice(RESULT_PREFIX.length);
      if (!event?.newValue) return;
      try {
        const result = JSON.parse(event.newValue);
        settleAwaiter(id, result);
      } catch {
        /* a result we cannot read is a result we do not have */
      }
    });
  } catch {
    /* a window without events is not a browser we can help */
  }

  drainDeeplink({ force: true });
}

/** Is any wallet still owed an answer? (Used by the sheet's waiting state.) */
export function hasPendingDeeplink() {
  return pendingList().length > 0;
}

/** The wallets a phone can actually hand a request to. */
export function deeplinkWalletOptions() {
  return DEEPLINK_WALLETS.map((w) => ({ id: w.id, label: w.label }));
}

/**
 * Forget everything, including the receiving end of the flow.
 * Called by the wallet page's disconnect so a stale record cannot resurrect a
 * connection the user just removed.
 */
export function resetDeeplink() {
  removeKey(LAST_RESULT_KEY);
  clearDeeplinkSession();
  emit({ status: 'idle', walletId: null, address: null, code: null, requestId: null });
}
