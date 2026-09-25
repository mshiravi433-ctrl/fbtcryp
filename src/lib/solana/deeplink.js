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
  encodeReturnBlob,
  isDeeplinkReturn,
  randomNonce,
  randomRequestId,
  readDeeplinkReturn,
  readReturnBlob,
  readUrlParam,
  signRequestPayload,
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
 * Seal a post-connect request the way the wallet will open it.
 *
 * ─── ONLY THE CONNECT REQUEST IS PLAIN ─────────────────────────────────────
 * `connect` carries our public key in the clear because there is no shared
 * secret yet. EVERY request after it — signTransaction,
 * signAndSendTransaction, signMessage, disconnect — travels as
 * `payload=<base58(box(JSON, nonce, sharedKey))>` next to the same `nonce`;
 * the session token and the transaction are inside that box, never in the
 * URL. This is what Phantom's, Solflare's and Backpack's reference
 * implementations do (`nacl.box.after(Buffer.from(JSON.stringify(payload)),
 * nonce, sharedSecret)`), and getting it backwards produces exactly the
 * reported symptom: a connection that "succeeds" and a signing request the
 * wallet refuses before showing anything — Phantom on Android answers a
 * request with no `payload` with errorCode -32603 «Unexpected error».
 *
 * Synchronous when the crypto module is already here (it is, once a session
 * exists: the connect answer was opened with it), so a signing hand-off can
 * still fire in the same task as its caller.
 */
function sealRequest(n, json, nonceBase58, key) {
  const nonce = base58Decode(nonceBase58);
  if (!nonce || nonce.length !== 24 || !key) return null;
  const sealed = n.box.after(utf8(json), nonce, key);
  return sealed ? base58Encode(sealed) : null;
}

/** sharedKey(), for a caller that already holds the module. */
function sharedKeySync(n, walletPublicKey, dappSecretKey) {
  const pk = base58Decode(walletPublicKey);
  const sk = base58Decode(dappSecretKey);
  if (!pk || pk.length !== 32 || !sk || sk.length !== 32) return null;
  return n.box.before(pk, sk);
}

/**
 * Decrypt the wallet's answer: `{ signature }`, `{ transaction }`,
 * `{ public_key, session }` — sealed with the shared key and the per-request
 * nonce, the mirror of sealRequest above.
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
  /* Same rule for the wallet's own error words: they describe ONE answer. */
  state = { ...state, ...next, stuck: next.stuck === true, wallet: next.wallet ?? null };
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
/* the return blob — completing an answer the wallet brought to ANOTHER        */
/* browser                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * ─── THE iOS ROUND TRIP, HANDLED ────────────────────────────────────────────
 *
 * «در ایفون وقتی میزنی روی اتصال کیف پول سولنا و امضا میکنی و تایید، به جای
 * برگشت به مثلا مرورگر کروم که رفته، میره به مرورگر دیگر روی ایفون».
 *
 * What happens, per the wallet's own documentation: the HTTPS redirect opens
 * in the phone's DEFAULT browser. Started from Chrome, defaulted to Safari,
 * the answer arrives in a document whose localStorage never held the pending
 * request — and the old code had exactly two answers for that: a trampoline
 * to the ANDROID APK's custom scheme (a dead end on iPhone), or NO_PENDING
 * over a signature the user actually gave.
 *
 * Now the redirect itself carries the state (`fbt=` on the URL — built where
 * the request is built, read here), and this section rebuilds a minimal
 * pending row from it so the completion below runs exactly as if the request
 * had been fired from this browser. The saved session/signature then works
 * in the browser the user is standing in, and the return target from the
 * blob puts them back on the screen they were on.
 *
 * A blob is only accepted when every check passes — a URL is input:
 *   · v1, with an age inside the same 15-minute window the pending rows use
 *     (a few minutes of clock skew forward are tolerated, nothing older);
 *   · naming a wallet this app actually talks to;
 *   · naming an operation this app can complete;
 *   · matching the request id the URL itself carries;
 *   · never consumed before (a replayed URL must not complete twice).
 */
const BLOB_USED_KEY = 'fbt:solana:blob-used:v1';

/* The rebuilt pending row carries the id as `id` and the stamp as
   `createdAt`; the raw blob carries `rid` and `t`. The marker must key off
   both shapes, or a consumed blob would be spendable once more. */
const blobKeyOf = (rec) => `${rec.rid ?? rec.id}:${rec.t ?? rec.createdAt}`;

function blobAlreadyUsed(blob) {
  const rec = readJson(BLOB_USED_KEY) ?? {};
  return rec[blobKeyOf(blob)] === true;
}

function markBlobUsed(blob) {
  const rec = readJson(BLOB_USED_KEY) ?? {};
  rec[blobKeyOf(blob)] = true;
  const keys = Object.keys(rec);
  if (keys.length > 24) for (const k of keys.slice(0, keys.length - 24)) delete rec[k];
  writeJson(BLOB_USED_KEY, rec);
}

/** The pending row a return blob stands in for — or null when any check fails. */
function pendingFromBlob(rawUrl, requestId) {
  const text = readUrlParam(rawUrl, 'fbt');
  const blob = text ? readReturnBlob(text) : null;
  if (!blob) return null;

  const now = Date.now();
  const t = Number(blob.t);
  if (!Number.isFinite(t)) return null;
  if (t > now + 5 * 60_000) return null; // from the future beyond any real skew
  if (now - t > PENDING_TTL_MS) return null; // the same window the rows use
  if (!blob.rid || (requestId && blob.rid !== requestId)) return null;
  if (!deeplinkWallet(blob.w)) return null; // a wallet this app never names
  if (blobAlreadyUsed(blob)) return null; // one blob, one completion

  if (blob.op === 'connect') {
    if (!blob.pk || !blob.sk) return null;
    return {
      id: blob.rid,
      op: 'connect',
      walletId: blob.w,
      dappPublicKey: blob.pk,
      dappSecretKey: blob.sk,
      returnTo: blob.rt || '',
      createdAt: t,
      rescued: true
    };
  }
  if (blob.op === 'signTransaction' || blob.op === 'signAndSendTransaction' || blob.op === 'signMessage') {
    if (!blob.pk || !blob.sk || !blob.wek) return null;
    return {
      id: blob.rid,
      op: blob.op,
      walletId: blob.w,
      dappPublicKey: blob.pk,
      dappSecretKey: blob.sk,
      walletEncryptionPublicKey: blob.wek,
      returnTo: blob.rt || '',
      createdAt: t,
      rescued: true
    };
  }
  return null;
}

/** The blob a connect request should ship with its redirect. */
function connectBlob({ id, pair, walletId, returnTo }) {
  return encodeReturnBlob({
    v: 1,
    op: 'connect',
    rid: id,
    w: walletId,
    pk: pair.publicKey,
    sk: pair.secretKey,
    t: Date.now(),
    rt: returnTo || null
  });
}

/** The blob a signing request should ship with its redirect. */
function signBlob({ id, op, session, returnTo }) {
  return encodeReturnBlob({
    v: 1,
    op,
    rid: id,
    w: session.walletId,
    pk: session.dappPublicKey,
    sk: session.dappSecretKey,
    wek: session.walletEncryptionPublicKey,
    t: Date.now(),
    rt: returnTo || null
  });
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
 * The answer to ONE request, if it has arrived. Not consumed.
 *
 * `consumeDeeplinkResult()` answers «what was the last thing that happened»,
 * which is all a sheet needs when it is the only thing on screen. A page that
 * handed over a signature and then had its document replaced by the wallet's
 * return needs the precise question instead: «has MY request id been
 * answered?» — without it the only way to ask is to await, and awaiting an id
 * nobody ever answers leaves a poll running for the life of the PENDING_TTL.
 */
export function deeplinkResultFor(id) {
  return readResult(id);
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
 * Both on the web and inside the native APK, the redirect link must share the
 * exact origin of `app_url` (`https://fbtswap.ir`).
 *
 * Phantom (and Solana Pay origin verification) strictly compares the origin
 * of `redirect_link` with the origin of `app_url`. If the APK sends a custom
 * scheme like `ir.fbtswap.app://solconnect` while `app_url` is `https://fbtswap.ir`,
 * the wallet immediately rejects the request with code -32000:
 * «Redirect link origin does not match app origin».
 *
 * By using `https://fbtswap.ir/?sol=1&rid=...`, the origins match 100%.
 * When the wallet returns:
 *   1. If Android routes the App Link to the APK, MainActivity captures it.
 *   2. If Android opens Chrome, the web document detects no local pending
 *      request and trampolines to `ir.fbtswap.app://solconnect?...`, bringing
 *      the APK back to the front to complete the connection.
 */
/**
 * `blob` is the return blob (see the `fbt` parameter, deeplinkUri.js): the
 * state the answer needs, riding the redirect so the completion works in
 * whichever browser the wallet opens it in. The base64url alphabet is
 * URL-safe, so no further encoding is needed — and none may be added: the
 * wallet appends its own parameters to this exact string.
 */
export function deeplinkRedirect(requestId, blob = null) {
  let base = publicAppUrl(`/?${RETURN_MARKER}&rid=${encodeURIComponent(requestId)}`);
  /*
   * THE ANDROID APK RETURN TAG.
   *
   * A connect/sign request fired from inside the APK builds its redirect link
   * here — and on most builds the APK's App Link for `fbtswap.ir` is NOT
   * verified (the installed signing cert does not match the published
   * `assetlinks.json`, or that file is absent), so the wallet's https
   * redirect opens in CHROME instead of the app. The generic blob rescue in
   * `completeDeeplinkReturn` then completes the connection in Chrome's own
   * storage — leaving the APK, which holds the real pending request, staring
   * at «منتظر تأیید…» while the address lives somewhere the user is not.
   *
   * Tagging the link with `apk=1` lets `completeDeeplinkReturn` recognise an
   * APK-originated return that has landed in a browser and TRAMPOLINE it back
   * into the app before the blob rescue runs (see the `apk=1` branch there).
   * The tag is a query parameter only: it does not touch the origin that
   * Phantom compares against `app_url`, so the request is never rejected.
   */
  if (isNativeShell()) base += '&apk=1';
  if (blob) return `${base}&fbt=${blob}`;
  return base;
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
/**
 * The route that would deliver a request to this wallet in the CURRENT view —
 * the first door of `deeplinkOpenRoutes`, as a name (`native-intent`,
 * `intent`, `universal`, …). The sheet asks it to decide whether the waiting
 * card must say the iOS default-browser note: `universal` is the one route
 * whose answer comes back in the phone's default browser.
 */
export function deeplinkRouteFor(walletId) {
  try {
    const list = deeplinkOpenRoutes({ walletId, url: publicAppUrl('/') });
    return list?.[0]?.route ?? null;
  } catch {
    return null;
  }
}

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

/** The door the native bridge last reported taking (diagnostics only). */
let lastNativeRoute = '';
export function lastNativeHandoffRoute() {
  return lastNativeRoute;
}

function parseBridgeAnswer(raw) {
  if (raw === true) return { ok: true, route: 'bridge' };
  if (raw === false) return { ok: false, route: 'none', reason: 'refused' };
  if (typeof raw !== 'string' || !raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Fire one route, in this task. Returns false when it cannot be synchronous. */
function runRouteSync(route, win) {
  switch (route.route) {
    case 'native-intent': {
      const bridge = win?.FBTSolanaLink;
      if (!bridge) return false;
      try {
        /*
         * The newer bridge answers with WHICH door the wallet took
         * (`{"ok":true,"route":"https:phantom.app"}`): it tries the https
         * URL as built, the wallet's alias host and the wallet's own custom
         * scheme, each package-scoped, before an unscoped launch — the old
         * single explicit try fell to the unscoped launch on the first
         * ActivityNotFoundException, and Android gave the request to a
         * browser. The route is kept for the diagnostics of the next report.
         */
        if (typeof bridge.openWalletRequest === 'function') {
          const raw = bridge.openWalletRequest(route.url, route.packageName);
          const answer = parseBridgeAnswer(raw);
          if (answer) {
            lastNativeRoute = answer.ok ? answer.route : `none:${answer.reason || 'unknown'}`;
            return answer.ok === true;
          }
        }
        if (typeof bridge.openWalletLink !== 'function') return false;
        /*
         * A boolean, not a promise. If a future build of the bridge returned a
         * promise, `=== true` would be false and the flow would fall through
         * to the Custom Tab — a wallet page inside our own app, which is the
         * exact bug this whole path was rewritten for. So an unreadable answer
         * is treated as "did not hand over".
         */
        const ok = bridge.openWalletLink(route.url, route.packageName) === true;
        lastNativeRoute = ok ? 'legacy-bridge' : 'none:legacy';
        return ok;
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

function nativeAppReturnUrl(rawUrl) {
  try {
    let search = '';
    let hash = '';
    try {
      const parsed = new URL(rawUrl, 'https://fbtswap.ir');
      search = parsed.search || '';
      hash = parsed.hash || '';
    } catch {
      const q = String(rawUrl).indexOf('?');
      if (q >= 0) search = String(rawUrl).slice(q);
    }
    return `ir.fbtswap.app://solconnect${search}${hash}`;
  } catch {
    return 'ir.fbtswap.app://solconnect';
  }
}

function mountNativeReturnFallback(nativeUrl) {
  if (typeof document === 'undefined') return;
  try {
    const existing = document.getElementById('fbt-solconnect-fallback');
    if (existing) return;
    const el = document.createElement('div');
    el.id = 'fbt-solconnect-fallback';
    el.style.cssText =
      'position:fixed;bottom:24px;left:20px;right:20px;z-index:999999;' +
      'background:#181B20;border:1px solid #00E5FF;border-radius:16px;' +
      'padding:16px 20px;box-shadow:0 10px 30px rgba(0,0,0,0.6);' +
      'text-align:center;direction:rtl;font-family:sans-serif;color:#FFFFFF;';
    el.innerHTML =
      '<div style="font-size:15px;font-weight:600;margin-bottom:8px;color:#00E5FF;">اتصال کیف پول سولانا</div>' +
      '<div style="font-size:13px;color:#94A3B8;margin-bottom:14px;">در حال انتقال اطلاعات به اپلیکیشن FBT Swap...</div>' +
      '<a href="' + nativeUrl.replace(/"/g, '&quot;') + '" style="display:inline-block;width:100%;box-sizing:border-box;' +
      'background:#00E5FF;color:#0B0E14;font-weight:700;padding:10px 16px;border-radius:10px;' +
      'text-decoration:none;font-size:14px;">باز کردن در اپلیکیشن</a>';
    document.body.appendChild(el);
  } catch {
    /* DOM not ready or restricted */
  }
}

function trampolineToNativeApp(rawUrl) {
  try {
    const nativeTarget = nativeAppReturnUrl(rawUrl);
    try {
      window.location.replace(nativeTarget);
    } catch {
      window.location.href = nativeTarget;
    }
    mountNativeReturnFallback(nativeTarget);
  } catch {
    /* best effort */
  }
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

  /*
   * THE ANDROID APK RETURN — KEPT INSIDE THE APK.
   *
   * A request fired from the APK carries `apk=1` on its redirect link (see
   * `deeplinkRedirect`). When that link reaches a BROWSER instead of the app —
   * the APK's App Link for `fbtswap.ir` is not verified on this build, or the
   * wallet opened the https redirect in Chrome — the request's own pending row
   * lives in the APK's WebView storage, NOT in this browser's. `pendingFromBlob`
   * would otherwise rescue the connection HERE, in the browser, so the app the
   * user came from is left unconnected while the address exists only in Chrome.
   *
   * So, before the blob rescue, hand the answer straight back to the APK via
   * its custom scheme `ir.fbtswap.app://solconnect?…` (the trampoline). The
   * whole URL — `sol`, `rid`, `fbt`, and the wallet's own encryption key,
   * nonce and data — rides in the query, so the APK receives exactly the
   * answer the wallet sent and completes the connection where the user is
   * standing.
   *
   * The marker is what keeps the genuine in-browser flow working: a real
   * Android-Chrome user's request has no `apk=1`, so it still rescues here as
   * before. Only an APK-originated return is sent home. `isNativeShell()` being
   * true means we ARE the APK already, in which case the App Link delivered the
   * answer directly and the branch below handles it — so we skip the trampoline
   * entirely there.
   */
  if (
    typeof window !== 'undefined' &&
    !isNativeShell() &&
    /[?&]apk=1(?:&|#|$)/.test(String(rawUrl)) &&
    read.state !== 'none'
  ) {
    const ua = String(
      window.navigator?.userAgent ||
      (typeof navigator !== 'undefined' ? navigator.userAgent : '') ||
      ''
    );
    if (/Android/i.test(ua)) {
      trampolineToNativeApp(rawUrl);
      return { ok: false, code: 'TRAMPOLINED_TO_APP', requestId };
    }
  }

  let pending = findPending(requestId);

  if (!pending) {
    /*
     * The same answer arriving twice (native push plus inbox — see
     * seenNativeUrls) is not a failure: the connection it asked for is
     * already stored, and reporting an error over it would tell the user
     * their successful approval went wrong.
     */
    const session = read.state === 'params' ? deeplinkSession() : null;
    if (session?.address) return { ok: true, already: true, address: session.address, walletId: session.walletId };

    /*
     * THE iOS RESCUE. No pending row in THIS browser's storage: the wallet
     * answered in the phone's default browser, which is not the browser the
     * request was fired from (started in Chrome, answered in Safari). The
     * redirect link carries the request's own state as `fbt=`, so the answer
     * is completed right here, in this browser — connected in the place the
     * user is actually standing in, instead of stranded in the wrong one
     * with a «back to app» bar that goes nowhere.
     *
     * On Android, an `apk=1` return has already been trampolined home by the
     * branch above, so reaching here means this is a genuine browser round
     * trip (or a replay): complete the connection in the browser the user is
     * in, as before.
     */
    pending = pendingFromBlob(rawUrl, requestId);
  }

  if (!pending) {
    /*
     * Trampoline for native app returns — ANDROID ONLY.
     * When connecting from the native Android app, the wallet redirects to
     * `https://fbtswap.ir/?sol=1&rid=...` so that the origin strictly matches `app_url`.
     * If Android hands that https redirect to Chrome instead of the APK, this web
     * document has no pending request in its own storage (the pending request is in
     * the APK's WebView storage).
     * Forward the return into the APK via its registered custom scheme
     * `ir.fbtswap.app://solconnect`, bringing the app to the foreground.
     *
     * NEVER on iPhone: `ir.fbtswap.app` is the ANDROID APK's scheme. There is
     * no app on iOS that owns it, so the old `isMobile` gate fired a
     * navigation into a void on exactly the phone the report is about — the
     * dead end the user then saw as «به اپلیکیشن برگردید، میزنی نمیاد».
     */
    if (typeof window !== 'undefined' && !isNativeShell()) {
      const ua = String(window.navigator?.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '');
      const isAndroid = /Android/i.test(ua);
      if (isAndroid && read.state !== 'none') {
        trampolineToNativeApp(rawUrl);
      }
    }

    /* Otherwise: the record expired, the user cleared storage, or the link was
       replayed. Say so rather than pretend something happened. */
    emit({ status: 'error', code: 'NO_PENDING', requestId });
    return { ok: false, code: 'NO_PENDING' };
  }

  if (read.state === 'error') {
    const code = errorCodeOf(read.error?.code);
    /*
     * THE WALLET'S OWN WORDS TRAVEL WITH THE CODE. Everything that is not
     * 4001 used to collapse into WALLET_ERROR and the message was dropped —
     * so Phantom's `-32603 Unexpected error` (a request it could not parse)
     * and a real rejection read the same on our screen, and the report said
     * «رد میشود» about a request the user never saw. The sheet shows this
     * line under the error, and the diagnostics keep it.
     */
    const wallet = {
      code: String(read.error?.code ?? ''),
      message: String(read.error?.message ?? '').slice(0, 200)
    };
    const failed = { ok: false, code, op: pending.op, walletId: pending.walletId, wallet };
    dropPending(pending.id);
    saveResult(pending.id, failed);
    publishResult(failed);
    emit({ status: 'error', code, walletId: pending.walletId, requestId: pending.id, wallet });
    settleAwaiter(pending.id, { ok: false, code, wallet });
    return { ok: false, code, wallet };
  }

  const result =
    pending.op === 'connect'
      ? await applyConnectAnswer(pending, read.params)
      : await applySignAnswer(pending, read.params);

  dropPending(pending.id);
  /*
   * A rescue succeeds here, in the browser the user is standing in. Mark the
   * blob consumed ONLY on success — a failed opening (impossible with our
   * own keys, but a URL is input) must stay retryable rather than spent.
   */
  if (result.ok && pending.rescued) markBlobUsed(pending);
  /* `warnings` rides along with the stored answer: a signature that arrives as
     a page load is read by a document that never saw the request, and the
     reason Phantom showed a risk dialog is the one thing that document still
     needs in order to explain itself. `rescued` is the same story one level
     up: the document that shows the result never saw the REQUEST either, and
     the host uses the flag to say so instead of playing it as routine. */
  const stored = {
    ...result,
    walletId: pending.walletId,
    op: pending.op,
    rescued: pending.rescued === true,
    warnings: pending.warnings ?? []
  };
  saveResult(pending.id, stored);
  publishResult(stored);

  if (result.ok) {
    if (result.op === 'connect') {
      emit({ status: 'connected', address: result.address, walletId: pending.walletId, requestId: pending.id, code: null, rescued: pending.rescued === true });
      emitWalletChange(result.address);
    } else {
      emit({ status: 'signed', walletId: pending.walletId, requestId: pending.id, code: null, rescued: pending.rescued === true });
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
  /* `stored`, not `result`: the same answer, plus the `rescued` flag and the
     wallet name the host's toast and diagnostics read from the returned
     object. Every field `result` had is in `stored`. */
  return stored;
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
  const returnToHash = returnTo ?? currentReturnTo();
  const url = connectRequestUrl({
    walletId,
    dappPublicKey: pair.publicKey,
    /*
     * The redirect carries the return blob (`fbt=`): on iOS the wallet opens
     * the redirect in the phone's DEFAULT browser — often not the one that
     * fired the request — and there the blob is what lets the answer
     * complete (see pendingFromBlob).
     */
    redirectLink: deeplinkRedirect(id, connectBlob({ id, pair, walletId, returnTo: returnToHash })),
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
    returnTo: returnToHash,
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
    const returnToHash = returnTo ?? currentReturnTo();
    const url = connectRequestUrl({
      walletId,
      dappPublicKey: pair.publicKey,
      redirectLink: deeplinkRedirect(id, connectBlob({ id, pair, walletId, returnTo: returnToHash })),
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
      returnTo: returnToHash,
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
  /* One nonce per request, used for the sealed request AND expected on the
     wallet's sealed answer — generated here and never reused. */
  const nonce = randomNonce();
  /* The module is already loaded whenever a session exists (its answer was
     opened with it); the await is only a safety net for a restored session. */
  const n = naclReady() ?? await nacl();
  const key = sharedKeySync(n, session.walletEncryptionPublicKey, session.dappSecretKey);
  if (!key) return { ok: false, code: 'NO_SESSION' };
  const plain = signRequestPayload(op, { session: session.session, payload: payloadBase58 });
  const sealed = plain ? sealRequest(n, plain, nonce, key) : null;
  if (!sealed) return { ok: false, code: 'BAD_TRANSACTION' };
  const url = signRequestUrl({
    walletId: session.walletId,
    op,
    dappPublicKey: session.dappPublicKey,
    nonce,
    /*
     * The signing round trip navigates too (iOS: universal route,
     * `navigatedAway`), so the redirect carries the session's own blob: a
     * signature that comes back into the default browser can still be
     * opened and stored where the user is standing.
     */
    redirectLink: deeplinkRedirect(id, signBlob({ id, op, session, returnTo: currentReturnTo() })),
    payload: sealed
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
export async function deeplinkSignAndSendTransaction(base64Tx, { broadcast = null } = {}) {
  const res = await signViaDeeplink('signAndSendTransaction', base58Encode(base64ToBytes(base64Tx)), base64Tx);
  /*
   * Phantom marks `signAndSendTransaction` deprecated in its deeplink docs
   * and a build may one day answer it with «method not found» / «unsupported»
   * rather than a prompt. That is not a rejection and not a network failure:
   * the same request as `signTransaction` gets the user the SAME approval
   * screen, and the caller (which owns the RPC) broadcasts the signed bytes.
   * Only when the caller can broadcast, and never after a user's «no».
   */
  if (!res.ok && typeof broadcast === 'function' && looksUnsupported(res)) {
    const signed = await signViaDeeplink('signTransaction', base58Encode(base64ToBytes(base64Tx)), base64Tx);
    if (!signed.ok || !signed.transaction) return signed;
    try {
      const signature = await broadcast(signed.transaction);
      return { ...signed, signature, broadcastBy: 'app' };
    } catch (err) {
      return { ok: false, code: 'SEND_FAILED', detail: String(err?.message ?? err).slice(0, 160) };
    }
  }
  return res;
}

/** A wallet answer that says «I do not have this method», not «no». */
function looksUnsupported(res) {
  if (!res || res.ok || res.code === 'REJECTED') return false;
  const code = String(res.wallet?.code ?? '');
  const message = String(res.wallet?.message ?? '');
  if (code === '-32601' || code === '-32603') return true;
  return /not (?:found|supported)|unsupported|deprecated|unknown method|invalid method/i.test(message);
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
