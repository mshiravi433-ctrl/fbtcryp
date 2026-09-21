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
  browseRequestUrl,
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

/*
 * The deeplink flow has its own emit point (the address arrives from a wallet
 * app, not from a provider), so the unified state bus has to be told here as
 * well — otherwise a deeplink connection is invisible to Intent OS until the
 * next EVM change. Lazy import: `walletState.js` reads this module back.
 */
function notifyUnifiedWalletState() {
  try {
    import('../walletState.js').then((mod) => mod.notifyWalletState('solana')).catch(() => {});
  } catch {
    /* never break the connection over a notification */
  }
}
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
/* crypto — tweetnacl, lazily, and WARM BEFORE THE TAP                         */
/* -------------------------------------------------------------------------- */

/*
 * ─── THE SECOND BUG: EVERYTHING WAS AWAITED BEFORE THE WALLET OPENED ────────
 *
 * The report: «اتفاقی نمی‌افتد یا خیلی طول می‌کشد که صفحهٔ تأیید کیف پول بیاید».
 *
 * Both halves are one design mistake. A connect request is built from a FRESH
 * box key pair, and `import('tweetnacl')` is a separate chunk: on a phone that
 * is a network round trip, and only then can the key be generated and the URL
 * built. The wallet was therefore opened seconds after the tap — and, worse,
 * out of a timer rather than out of the gesture:
 *
 *   • Chrome refuses to launch an app for an `intent://` that was «initiated
 *     without a user gesture»; it commits to the fallback URL instead, so the
 *     wallet is installed, the fallback page is on screen, and nothing came to
 *     the front.
 *   • iOS Safari hands a Universal Link to the wallet only while the tap is
 *     still «recent»; after an await the navigation is just a web page load,
 *     and the wallet is never asked.
 *
 * So the module no longer generates the pair at tap time: it ARMS one ahead of
 * the tap (`warmDeeplinkRequest`, called when a screen with a connect button
 * mounts, and again on `pointerdown`), and the tap itself builds the URL and
 * fires the route in the same task (`startDeeplinkConnectSync`). The lazy
 * import is kept for the users who never open this screen.
 *
 * A pair is session material with no funds attached — it only has to be
 * unpredictable and single-use, which is why a small pool of ready pairs is
 * safe to hold in memory and why each one is used exactly once.
 */
let naclModule = null;

async function nacl() {
  if (naclModule) return naclModule;
  const mod = await import('tweetnacl');
  naclModule = mod.default ?? mod;
  return naclModule;
}

/** The module if it is already here — the only way to build a key pair in the
    same task as the tap. */
function naclReady() {
  return naclModule;
}

/*
 * SYNCHRONOUS on purpose: this sits between a user's tap and the hand-off to
 * the wallet, and an `await` here — even one that resolves immediately — ends
 * the gesture the platforms check for. (The old version was declared `async`
 * and awaited by its caller, which put a microtask, and therefore a lost user
 * gesture, in the middle of every `signMessage`.)
 */
function utf8(s) {
  return new TextEncoder().encode(String(s ?? ''));
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

/** The same, without the await — null when the module is not loaded yet. */
function newBoxKeyPairNow() {
  const n = naclReady();
  if (!n?.box?.keyPair) return null;
  const pair = n.box.keyPair();
  return { publicKey: base58Encode(pair.publicKey), secretKey: base58Encode(pair.secretKey) };
}

/*
 * Two pairs, because one connect tap can be immediately followed by another
 * (the user picks the wrong wallet, the first wallet refuses) and the second
 * tap deserves the same instant hand-off as the first.
 */
const ARM_POOL_SIZE = 2;
let armedPairs = [];
let warming = null;

function fillPool() {
  return (async () => {
    try {
      while (armedPairs.length < ARM_POOL_SIZE) {
        await nacl();
        /* The Custom Tab an APK without the bridge falls back to is a dynamic
           import too. A tab does not have to be opened from the gesture, but
           loading it now means that fallback fires immediately instead of
           after a chunk request. */
        preloadBrowserModule();
        const pair = newBoxKeyPairNow();
        if (!pair?.publicKey) break;
        armedPairs.push(pair);
      }
    } catch {
      /* No pool: the tap takes the awaited path instead and still works —
         it is simply slower, which is the bug this exists to remove. */
    }
    return armedPairs.length > 0;
  })();
}

/**
 * Put a tap-ready key pair in memory, in the background.
 *
 * Idempotent and safe to call from a render effect or a `pointerdown`: the
 * work happens once, and every later call returns the same promise.
 */
export function warmDeeplinkRequest() {
  if (!warming) warming = fillPool();
  return warming;
}

/** Is a tap-ready key pair already in memory? (Health report + tests.) */
export function deeplinkArmed() {
  return armedPairs.length > 0;
}

/** Take the ready pair — or make one, if the module happened to be loaded. */
function takeArmedPair() {
  const pair = armedPairs.shift() ?? newBoxKeyPairNow();
  if (pair && armedPairs.length < ARM_POOL_SIZE) {
    /* Short by one: refill off the tap's critical path, so the NEXT tap is
       as instant as this one was. */
    warming = null;
    Promise.resolve()
      .then(() => warmDeeplinkRequest())
      .catch(() => {});
  }
  return pair;
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

let state = { status: 'idle', walletId: null, address: null, code: null, requestId: null, stuck: false };
const listeners = new Set();
let awaiters = new Map(); // requestId -> { resolve, reject }

function emit(next) {
  /*
   * `stuck` belongs to the CURRENT waiting state, not to the flow: every state
   * change that does not explicitly say «still stuck» clears it, so a recovery
   * card can never survive the answer it was waiting for.
   */
  state = { ...state, ...next, stuck: next.stuck === true };
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
  /* The unified snapshot Intent OS reads, told on the same edge — a deeplink
     connection goes through no provider, so nothing else would notify it. */
  notifyUnifiedWalletState();
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
 *     schemes only), so the wallet's own site was loaded as a web page in our
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
          and on an APK old enough to have no bridge it is all there is.
          DEFERRED: opening it needs a dynamic import, and a browser tab is
          the one route that does not have to come out of the tap. */
    list.push({ route: 'custom-tab', url, mode: 'tab', deferred: true });
    /* 3. Hand the URL to Android and let the OS route it. DEFERRED as well,
          for ORDER rather than for cost: it must only be reached after the
          Custom Tab has been tried, and a `window.open(…, '_system')` that
          quietly does nothing must never be mistaken for a hand-off that
          happened — a wallet that was never asked is exactly the bug. */
    list.push({ route: 'system', url, mode: 'system', deferred: true });
    return list;
  }

  /*
   * A browser that resolves `intent://`: the wallet is opened WITHOUT this
   * document navigating, so the pending request survives the round trip.
   *
   * `S.browser_fallback_url` is the wallet's OWN BROWSER on our page, not the
   * store. It is reached when the intent does not resolve — which happens both
   * when the wallet is missing and when the wallet is installed but does not
   * declare this exact URL — and only one of those is an install problem. The
   * own-browser link works in both cases: either the wallet opens our page
   * inside itself (provider injected, connection still possible), or its own
   * site shows the download. A store link would have answered the second case
   * with «install the app you already have».
   */
  /*
   * `navigator.userActivation` is the platform telling us whether this call is
   * still inside the gesture Chrome requires. It matters because a REFUSED
   * `intent://` is not an error we can catch — the browser simply commits to
   * `S.browser_fallback_url` instead — so firing one without a gesture means
   * navigating the user to the fallback page and calling it a day. When the
   * gesture is provably gone (a swap signed after an RPC round trip), the
   * universal link is the better route: it carries the request in its URL and
   * Android/iOS can still hand it to the wallet from a normal navigation.
   * A browser without the API keeps the intent, which is the older behaviour.
   */
  const inGesture = win?.navigator?.userActivation?.isActive !== false;

  if (wallet?.androidPackage && inGesture && intentCapableView(win)) {
    /* A browse link is already the last resort, so its own fallback is the
       store page; anything else falls back to the browse link. */
    const isBrowseLink = /\/ul\/(?:v1\/)?browse\//.test(String(url));
    const fallbackUrl = isBrowseLink
      ? deeplinkInstallUrl(walletId)
      : browseRequestUrl(walletId, publicAppUrl('/')) ?? deeplinkInstallUrl(walletId);
    const intent = androidIntentRequestUrl({ walletId, url, fallbackUrl });
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

/*
 * The Custom Tab module, loaded ahead of the tap.
 *
 * `runRouteSync` cannot await, so this is the only way the tab route can be
 * taken in the same task as the gesture. It is a fallback (the APK has the
 * native bridge), so a miss here costs nothing: the route is deferred and
 * tried right after.
 */
let browserOpener = null;
let browserLoad = null;

function preloadBrowserModule() {
  if (browserLoad) return browserLoad;
  browserLoad = import('../browser.js')
    .then((mod) => {
      browserOpener = mod?.openUrl ?? null;
      /*
       * The plugin BEHIND `openUrl` is its own dynamic import — pre-loading
       * only the wrapper would move the round trip one level down instead of
       * removing it. The promise it returns carries no plugin object (see
       * lib/browser.js), and its rejection is swallowed here so a platform
       * without the plugin cannot produce an unhandled rejection.
       */
      const pending = mod?.preloadBrowserPlugin?.();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      return Boolean(browserOpener);
    })
    .catch(() => false);
  return browserLoad;
}

/** Fire one route, in this task. Returns false when it cannot be synchronous. */
function runRouteSync(route, win) {
  switch (route.route) {
    case 'native-intent': {
      const bridge = win?.FBTSolanaLink;
      if (!bridge?.openWalletLink) return false;
      try {
        /*
         * A boolean, not a promise. If a future build of the bridge returned a
         * promise, `=== true` would be false and the flow would fall through
         * to the Custom Tab — a wallet page inside our own app, which is the
         * exact bug this whole path was rewritten for. So an unreadable answer
         * is treated as "did not hand over".
         */
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
      if (!browserOpener) {
        preloadBrowserModule();
        return false;
      }
      try {
        /* `openUrl` is async because the plugin call is; the CALL is what
           opens the tab, and it happens here, inside the gesture. Its
           rejection is swallowed — a tab that could not open must not become
           an unhandled rejection off the back of a click. */
        const pending = browserOpener(route.url, { allowSameTabFallback: false });
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        return true;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/** Fire one deferred route (needs a dynamic import, or must come after one). */
async function runRouteDeferred(route, win) {
  switch (route.route) {
    case 'custom-tab':
      try {
        await preloadBrowserModule();
        if (!browserOpener) return false;
        return (await browserOpener(route.url, { allowSameTabFallback: false })) === true;
      } catch {
        return false;
      }
    case 'system':
      return runRouteSync(route, win);
    default:
      return false;
  }
}

/**
 * Open a wallet request URL — SYNCHRONOUSLY, inside the caller's event handler.
 *
 * This is the fix for «نمی‌شود یا خیلی طول می‌کشد». Chrome's own rule
 * (developer.chrome.com/docs/android/intents) is that an `intent://` is not
 * launched when it «was initiated without a user gesture» — a timer fired at
 * the wallet is not a tap, and the browser goes to the fallback URL instead.
 * iOS has the same shape: a Universal Link is handed to the app while the
 * touch is still fresh, and after an `await` it is only a page load.
 *
 * So every route that can be taken synchronously IS taken synchronously here,
 * and only the routes that provably cannot (the Custom Tab's dynamic import)
 * are left for `openRequest` to finish afterwards.
 *
 * @returns {{ok:boolean, route:string|null, navigatedAway:boolean, deferred:boolean}}
 *   `navigatedAway` answers «why does signing fail on a phone»: it is true
 *   only for the route that sends THIS document to the wallet's URL. There the
 *   pending promise cannot be resolved by this page, because this page is on
 *   its way out — so the caller is told, instead of spinning for fifteen
 *   minutes on an answer that will land in a brand-new document.
 */
export function openRequestNow(url, walletId = null, view = typeof window !== 'undefined' ? window : null) {
  if (!view) return { ok: false, route: null, navigatedAway: false, deferred: false };
  const routes = deeplinkOpenRoutes({ walletId, url, view });
  for (const route of routes) {
    if (route.deferred) continue;
    if (runRouteSync(route, view)) {
      return { ok: true, route: route.route, navigatedAway: route.route === 'universal', deferred: false };
    }
  }
  /* Nothing synchronous took it: leave the deferred routes to `openRequest`,
     which runs in the same turn's microtask queue and returns the same shape. */
  const next = routes.find((r) => r.deferred);
  if (next) return { ok: true, route: next.route, navigatedAway: false, deferred: true };
  return { ok: false, route: null, navigatedAway: false, deferred: false };
}

/**
 * The same hand-off, awaited to completion (used by callers whose gesture has
 * already been spent — signing after an RPC round trip, and the fallback path
 * when no key pair was armed).
 */
async function openRequest(url, walletId = null) {
  if (typeof window === 'undefined') return { ok: false, route: null, navigatedAway: false };
  const routes = deeplinkOpenRoutes({ walletId, url, view: window });
  for (const route of routes) {
    /* eslint-disable-next-line no-await-in-loop — the order IS the behaviour */
    const fired = route.deferred ? await runRouteDeferred(route, window) : runRouteSync(route, window);
    if (fired) {
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
/* the hand-off watchdog: «I tapped and nothing happened»                       */
/* -------------------------------------------------------------------------- */

/*
 * How long a fired hand-off gets to take the screen before we assume it did
 * not. Long enough for a slow phone to switch apps (Android's own app-start
 * animation), short enough that a user who is staring at an unchanged screen
 * is told something instead of nothing.
 */
const HANDOFF_GRACE_MS = 2500;

/**
 * The grace period, with an override for probes.
 *
 * A probe cannot wait 2.5 s per case and still be part of a suite that runs on
 * every commit, so the value can be shortened (never lengthened past 30 s, and
 * never set to a value that would switch the watchdog off — a stuck card that
 * cannot appear is exactly the bug being fixed).
 */
function handoffGraceMs() {
  const override = Number(globalThis?.__FBT_HANDOFF_GRACE_MS);
  if (Number.isFinite(override) && override >= 10 && override <= 30_000) return override;
  return HANDOFF_GRACE_MS;
}

let handoffTimer = null;

function clearHandoffWatch() {
  if (handoffTimer) {
    clearTimeout(handoffTimer);
    handoffTimer = null;
  }
}

/**
 * Ask, a moment later, whether the wallet actually came to the front.
 *
 * This is the answer to the first half of the report — «اتفاقی نمی‌افتد» —
 * because until now nothing in the app could tell the difference between
 *
 *   • the wallet is open in front of the user, waiting to be approved, and
 *   • the hand-off went nowhere and this page is exactly where they left it.
 *
 * Both looked identical on screen: «منتظر تأیید…» and a spinner. The signal
 * that separates them is the one every phone gives us for free — when another
 * app comes forward, this document stops being visible. So: if the document is
 * still visible when the grace period ends and the request is still unanswered,
 * the state is set to `stuck`, and the sheet offers the routes that remain
 * (open it again, open it inside the wallet's own browser, or install it).
 */
function watchHandoff(id, walletId, route) {
  clearHandoffWatch();
  if (typeof setTimeout !== 'function') return;
  handoffTimer = setTimeout(() => {
    handoffTimer = null;
    if (!findPending(id)) return; // answered, cancelled or expired already
    const doc = typeof document !== 'undefined' ? document : null;
    if (doc && doc.visibilityState === 'hidden') return; // the wallet came forward
    emit({ status: 'waiting', walletId, requestId: id, code: null, route, stuck: true });
  }, handoffGraceMs());
}

/**
 * Finish a hand-off whose last routes needed a dynamic import.
 *
 * Called only when `openRequestNow` reported `deferred: true`, i.e. NOTHING was
 * fired synchronously. If the deferred routes fail too, the request is dropped
 * and named — the failure mode this replaces was a spinner that never ended
 * because a route reported success for a wallet that was never asked.
 */
function completeDeferredHandoff(id, walletId, url) {
  Promise.resolve()
    .then(() => openRequest(url, walletId))
    .then((late) => {
      /* No id: this is the browse recovery, which is not tied to a request. */
      if (!id) return;
      if (!findPending(id)) return; // already answered/cancelled meanwhile
      if (late.ok) {
        emit({ status: 'waiting', walletId, requestId: id, code: null, route: late.route });
        watchHandoff(id, walletId, late.route);
        return;
      }
      dropPending(id);
      settleAwaiter(id, { ok: false, code: 'OPEN_FAILED' });
      emit({ status: 'error', walletId, code: 'OPEN_FAILED', requestId: id });
    })
    .catch(() => {});
}

/* -------------------------------------------------------------------------- */
/* public flow                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Start a connect request and hand it to the wallet — IN THIS TASK.
 *
 * ─── WHY THIS IS SYNCHRONOUS ────────────────────────────────────────────────
 * «اتفاقی نمی‌افتد یا خیلی طول می‌کشد که صفحهٔ تأیید بیاید». Chrome will not
 * launch an app for an `intent://` that was not produced by a user gesture, and
 * iOS hands a Universal Link over while the touch is still fresh; both rules
 * are stated by the platforms and both were broken by awaiting a key pair
 * first. So the pair is armed ahead of time (`warmDeeplinkRequest`) and this
 * function does no awaiting at all: it builds the URL, stores the request and
 * fires the route between the user's finger going down and coming up.
 *
 * Returns `{ok:false, code:'NOT_ARMED'}` when no pair is ready yet — the caller
 * then awaits `startDeeplinkConnect`, which is slower but never fails for this
 * reason.
 *
 * The return shape matches `startDeeplinkConnect`; `deferred` means the route
 * that will carry it needs a dynamic import (an APK without the native bridge)
 * and is being finished in the background.
 */
export function startDeeplinkConnectSync(walletId, { returnTo } = {}) {
  const wallet = deeplinkWallet(walletId);
  if (!wallet) return { ok: false, code: 'UNKNOWN_WALLET' };
  if (!store()) return { ok: false, code: 'NO_STORAGE' };

  const pair = takeArmedPair();
  if (!pair?.publicKey) return { ok: false, code: 'NOT_ARMED' };

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

  const opened = openRequestNow(url, walletId);
  if (!opened.ok) {
    dropPending(id);
    emit({ status: 'error', walletId, code: 'OPEN_FAILED', requestId: id });
    return { ok: false, code: 'OPEN_FAILED', id };
  }
  if (opened.deferred) completeDeferredHandoff(id, walletId, url);
  watchHandoff(id, walletId, opened.route);

  /* `route` is what the health report and the waiting card can name when a
     user writes «it opened the wallet and nothing happened»: which of the
     channels actually carried the request, and whether this page is still
     here to hear the answer. */
  emit({ status: 'waiting', walletId, requestId: id, code: null, route: opened.route });
  return {
    ok: true,
    id,
    walletId,
    route: opened.route,
    navigatedAway: opened.navigatedAway,
    deferred: opened.deferred
  };
}

/**
 * Start a connect request and open the wallet.
 *
 * Resolves immediately with what the app needs to render (the request id and
 * the wallet) — NOT when the user approves, which may be a page load later.
 * The sheet follows the `solana:deeplink` event instead. A caller that truly
 * needs the final answer can await `awaitDeeplinkRequest(id)`.
 *
 * WARM-UP FIRST, then the same code the tap path uses: this exists for the
 * click that arrives before the key pair was armed (a cold boot straight into
 * the sheet), so the wait is the chunk load and nothing else.
 */
export async function startDeeplinkConnect(walletId, { returnTo } = {}) {
  if (!deeplinkWallet(walletId)) return { ok: false, code: 'UNKNOWN_WALLET' };
  if (!store()) return { ok: false, code: 'NO_STORAGE' };
  await warmDeeplinkRequest();
  const started = startDeeplinkConnectSync(walletId, { returnTo });
  if (started.code === 'NOT_ARMED') {
    /* The pool could not be filled (no tweetnacl — an ancient or locked-down
       WebView). Build the pair the awaited way; the hand-off is later than the
       gesture, which is exactly the case `stuck` exists to recover from. */
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
      dropPending(id);
      emit({ status: 'error', walletId, code: 'OPEN_FAILED', requestId: id });
      return { ok: false, code: 'OPEN_FAILED', id };
    }
    watchHandoff(id, walletId, opened.route);
    emit({ status: 'waiting', walletId, requestId: id, code: null, route: opened.route });
    return { ok: true, id, walletId, route: opened.route, navigatedAway: opened.navigatedAway };
  }
  return started;
}

/**
 * Re-open the wallet for a request that is still waiting.
 *
 * The same URL is re-fired, so the wallet shows the SAME approval — not a new
 * pairing the user has to reason about. This is the button that saves the flow
 * when a phone drops the wallet on its home screen instead of ours.
 *
 * Synchronous for the same reason the first tap is: «باز کردن دوباره» is a tap,
 * and the routes that need a gesture must take it from THAT tap.
 */
export function reopenDeeplinkRequest(id) {
  const pending = findPending(id ?? null);
  if (!pending?.url) return { ok: false, code: 'NO_PENDING' };
  emit({ status: 'waiting', walletId: pending.walletId, requestId: pending.id, code: null, stuck: false });
  const opened = openRequestNow(pending.url, pending.walletId);
  if (!opened.ok) return { ok: false, code: 'OPEN_FAILED', id: pending.id };
  if (opened.deferred) completeDeferredHandoff(pending.id, pending.walletId, pending.url);
  watchHandoff(pending.id, pending.walletId, opened.route);
  return { ok: true, id: pending.id, route: opened.route, inWallet: opened.navigatedAway };
}

/**
 * The recovery route: open OUR page inside the wallet's own browser.
 *
 * Offered on the «stuck» card, never fired silently. It is the one hand-off
 * that still works when the connect request cannot be delivered at all — the
 * wallet loads us in its in-app browser, where the provider IS injected — and
 * it is also what Phantom's own browser SDK does on a phone. The honest
 * caveat, which the card says out loud: the connection it produces lives in
 * THAT browser, so it is a way to connect, not a way to be connected here.
 */
export function openDeeplinkBrowse(walletId, targetUrl = null) {
  const url = browseRequestUrl(walletId, targetUrl || publicAppUrl('/'));
  if (!url) return { ok: false, code: 'UNKNOWN_WALLET' };
  const opened = openRequestNow(url, walletId);
  if (!opened.ok) return { ok: false, code: 'OPEN_FAILED' };
  if (opened.deferred) completeDeferredHandoff(null, walletId, url);
  return { ok: true, route: opened.route, url, inWallet: opened.navigatedAway };
}

/** The store page for this wallet — the last item on the stuck card. */
export function deeplinkInstallLink(walletId) {
  return deeplinkInstallUrl(walletId);
}

/** Give up on the waiting request (the user closed the sheet or cancelled). */
export function cancelDeeplinkRequest(id) {
  clearHandoffWatch();
  const pending = findPending(id ?? null);
  if (!pending) {
    emit({ status: 'idle', code: null, requestId: null, stuck: false });
    return false;
  }
  dropPending(pending.id);
  settleAwaiter(pending.id, { ok: false, code: 'CANCELLED' });
  emit({ status: 'idle', walletId: pending.walletId, code: null, requestId: null, stuck: false });
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

  /*
   * SYNCHRONOUS, like the connect tap — and here it matters even more. A swap
   * is signed after the quote came back from the network, which means the
   * user's last touch was seconds or minutes ago; every await between it and
   * the hand-off is another reason for Chrome to refuse to launch the wallet
   * («a JavaScript timer tried to open an application without a user
   * gesture»). Building the request and firing the route happens here, with
   * only synchronous work in between.
   */
  const opened = openRequestNow(url, session.walletId);
  if (!opened.ok) {
    dropPending(id);
    return { ok: false, code: 'OPEN_FAILED', warnings };
  }
  if (opened.deferred) completeDeferredHandoff(id, session.walletId, url);
  watchHandoff(id, session.walletId, opened.route);

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
  const raw = bytes instanceof Uint8Array ? bytes : utf8(bytes);
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
