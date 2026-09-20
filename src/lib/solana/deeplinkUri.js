/**
 * SOLANA WALLET DEEPLINKS — the request we build, and the answer we read back.
 * ---------------------------------------------------------------------------
 * THE REPORTED BUG THIS EXISTS FOR
 *
 *   «کیف پول سولانا فقط داخل خود اپ مثل فانتوم باز میشه و داخل خود اپ ما وقتی
 *   میزنی روی اتصال کیف پول فقط وارد کیف پول فانتوم میشه و هیچ صفحه تاییدی
 *   برای اتصال به کیف پول ما انجام نمیشود»
 *
 * On a phone the Solana wallet could only ever be reached through the
 * «browse» link — a URL that asks Phantom to open our page inside its own
 * browser. Phantom opens (sometimes on its home screen, when the browse link
 * is not routed), and nothing in it ever asks the user to approve a
 * connection to US. The user is left in the wallet, with no approval screen
 * and no way to grant anything, and if they DO happen to land on our page
 * inside that browser, the connection belongs to that browser — not to the
 * app they started from.
 *
 * What was missing is the other half of Phantom's mobile API: the CONNECT
 * REQUEST. `https://phantom.app/ul/v1/connect` is an ordinary https URL that
 * any mobile browser (and any WebView) can open. The wallet treats it as a
 * connect request, shows its own native approval screen — «FBT Swap wants to
 * connect» — and, once the user approves, sends the account back to the
 * `redirect_link` we supplied, encrypted to a key pair only this session
 * knows.
 *
 * That is the approval screen the report is about, and it is the only wallet
 * approval that can reach us on a phone: extensions do not exist there, and
 * MWA (Android Chrome only) cannot complete inside our own APK.
 *
 * ─── SCOPE OF THIS FILE ─────────────────────────────────────────────────────
 * Pure functions only: base58, the request URLs, and the parser for the
 * wallet's answer. No crypto, no storage, no DOM — so every string below can
 * be asserted byte-for-byte in Node, and the flow module (./deeplink.js) owns
 * everything that needs a browser.
 *
 * ─── THE THREE WALLETS ──────────────────────────────────────────────────────
 * Solflare and Backpack implement the same deeplink protocol on their own
 * hosts, so the request shape is shared and only the base URL differs. Every
 * URL below was checked against the wallet's own published spec:
 * Phantom `docs.phantom.app/developer-powertools/deeplinks`,
 * Solflare `docs.solflare.com/.../deeplinks`, Backpack `backpack.app/.../ul`.
 */

/** The one alphabet Solana uses, in the standard order (Bitcoin's). */
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_INDEX = (() => {
  const map = new Map();
  for (let i = 0; i < B58_ALPHABET.length; i += 1) map.set(B58_ALPHABET[i], i);
  return map;
})();

/**
 * Encode bytes as base58.
 *
 * Hand-written rather than pulled from `bs58`: this runs in the critical path
 * of a connection (the dapp's public key and the nonce are base58 in the URL)
 * and the algorithm is twenty lines. `bs58` is already in the dependency tree,
 * so the size argument is weak — the real reason is that a byte-level encoder
 * is something this project can and should be able to test on its own.
 */
export function base58Encode(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (input.length === 0) return '';
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  /* Leading zero bytes are '1' in base58 — Solana addresses and keys both
     depend on that, so it is not an edge case to skip. */
  let out = '';
  for (let i = 0; i < input.length - 1 && input[i] === 0; i += 1) out += '1';
  for (let i = digits.length - 1; i >= 0; i -= 1) out += B58_ALPHABET[digits[i]];
  return out;
}

/** Decode base58. Returns null for anything that is not valid base58. */
export function base58Decode(text) {
  const s = String(text ?? '');
  if (!s) return null;
  const bytes = [0];
  for (const ch of s) {
    const value = B58_INDEX.get(ch);
    if (value === undefined) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < s.length - 1 && s[i] === '1'; i += 1) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/*
 * base64 without Buffer — the same reasoning as lib/solanaWallet.js: `Buffer`
 * does not exist in a browser or an Android WebView.
 */
export function base64ToBytes(b64) {
  const bin = atob(String(b64 ?? ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000; // avoid "too many arguments" on a large transaction
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * A fresh 24-byte nonce, base58-encoded.
 *
 * TWENTY-FOUR, not the 32 every other value on this wire uses — XSalsa20's
 * nonce is 24 bytes, and `nacl.box.after` throws `bad nonce size` on anything
 * else. Getting this wrong is invisible until the first request is built, and
 * then it fails on the user's phone rather than here, which is why the probe
 * asserts the length of the nonce a request carries.
 *
 * Every request carries one, and the wallet's answer is encrypted with it —
 * reusing a nonce across requests is the one mistake that makes the box cipher
 * stop protecting the payload, so it is generated here, per request, and never
 * stored as a constant.
 */
export function randomNonce() {
  const bytes = new Uint8Array(24);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return base58Encode(bytes);
}

/** A short, URL-safe id so an answer can be matched to the request it fills. */
export function randomRequestId() {
  const bytes = new Uint8Array(8);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return base58Encode(bytes);
}

/**
 * The wallets whose mobile apps answer these deeplinks.
 *
 * ─── WHY EACH ROW CARRIES AN ANDROID PACKAGE ────────────────────────────────
 * `base` is a UNIVERSAL LINK (https). A universal link only reaches the wallet
 * app when something resolves it as an Android App Link / iOS Universal Link —
 * and two of the surfaces this app runs on deliberately do not:
 *
 *   • A Chrome CUSTOM TAB (what `@capacitor/browser` opens inside our APK)
 *     renders http/https in the tab and never hands them to another app. It
 *     supports custom schemes only. So inside the APK the request was loaded
 *     as a web page on phantom.app instead of being delivered to Phantom.
 *   • A WebView that navigates to the URL commits the navigation and loads the
 *     wallet's web page inside OUR app.
 *
 * Either way the user ends up looking at Phantom — its web page, or the app
 * after they tapped "open in app" and lost the query string on the way — with
 * no approval dialog, which is precisely the report this path exists for:
 * «میره داخل اپ فانتوم اما هیچ صفحه‌ای برای تأیید نمی‌آره».
 *
 * The package name is what makes the delivery EXPLICIT instead of a hope:
 * Android's `intent://` form and the native `ACTION_VIEW` bridge both scope the
 * request to one package, so the full URL (query string included — the request
 * IS the query string) lands in the wallet's own handler.
 *
 * Verified against each store listing, not guessed:
 *   Phantom  `app.phantom`          · Solflare `com.solflare.mobile`
 *   Backpack `app.backpack.mobile`
 * A wrong package fails CLOSED (the intent resolves to nothing and the next
 * route is tried), never open — nothing here can launch an arbitrary app.
 */
export const DEEPLINK_WALLETS = Object.freeze([
  Object.freeze({
    id: 'phantom',
    label: 'Phantom',
    /* https, not phantom:// — a universal link is the only form a plain
       browser will route without an intent:// wrapper. */
    base: 'https://phantom.app/ul/v1',
    /* The wallet's own «open this page in me» link, kept for the desktop and
       iOS paths where a real connect deeplink cannot complete. */
    browse: 'https://phantom.app/ul/browse/',
    androidPackage: 'app.phantom',
    install: 'https://play.google.com/store/apps/details?id=app.phantom'
  }),
  Object.freeze({
    id: 'solflare',
    label: 'Solflare',
    base: 'https://solflare.com/ul/v1',
    browse: 'https://solflare.com/ul/v1/browse/',
    androidPackage: 'com.solflare.mobile',
    install: 'https://play.google.com/store/apps/details?id=com.solflare.mobile'
  }),
  Object.freeze({
    id: 'backpack',
    label: 'Backpack',
    base: 'https://backpack.app/ul/v1',
    browse: 'https://backpack.app/ul/v1/browse/',
    androidPackage: 'app.backpack.mobile',
    install: 'https://play.google.com/store/apps/details?id=app.backpack.mobile'
  })
]);

/** The store page for a wallet that is not installed — the intent's fallback. */
export function deeplinkInstallUrl(id) {
  return deeplinkWallet(id)?.install ?? null;
}

/**
 * Wrap one request URL in Chrome's `intent://` form, scoped to the wallet.
 *
 *   intent://phantom.app/ul/v1/connect?…#Intent;scheme=https;package=app.phantom;S.browser_fallback_url=…;end
 *
 * ─── WHY THIS IS THE FORM THAT WORKS ON ANDROID ─────────────────────────────
 * An `intent://` URL is resolved BY THE BROWSER, before any navigation commits:
 *
 *   • wallet installed → Android fires ACTION_VIEW at exactly that package with
 *     the FULL https URL as data. Phantom's handler parses `/ul/v1/connect` and
 *     draws its own approval screen. Our page never navigated, so the pending
 *     request — and the swap that is waiting on the signature — is still alive
 *     when the answer comes back.
 *   • wallet NOT installed → the browser commits to `S.browser_fallback_url`,
 *     the store page. One tap from installing it, instead of a dead end.
 *
 * A plain `location.assign('https://phantom.app/ul/v1/connect?…')` also works
 * in a real browser, but it takes the page with it: the document holding the
 * promise is gone, which is how a signature came back to an app that had
 * already forgotten it was waiting. So the intent is tried first and the
 * universal link stays as the fallback for browsers that cannot resolve it
 * (Firefox on Android has no `intent://`; a WebView has nothing to intercept
 * it and would navigate itself away).
 *
 * @returns {string|null} null when the URL is not an https request for a wallet
 *   we know — the caller must then use the universal link unchanged.
 */
export function androidIntentRequestUrl({ walletId, url, fallbackUrl = null }) {
  const wallet = deeplinkWallet(walletId);
  if (!wallet?.androidPackage) return null;
  let parsed = null;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  /* Everything the wallet needs lives in the query, so it is carried verbatim:
     re-encoding here would double-encode values that are already encoded. */
  const target = `${parsed.host}${parsed.pathname}${parsed.search}`;
  const parts = [`intent://${target}#Intent`, 'scheme=https', `package=${wallet.androidPackage}`];
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(String(fallbackUrl))}`);
  parts.push('end');
  return parts.join(';');
}

export function deeplinkWallet(id) {
  return DEEPLINK_WALLETS.find((w) => w.id === id) ?? null;
}

/** Build one request URL. All parameters are URL-encoded exactly once. */
function requestUrl(wallet, endpoint, params) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${wallet.base}/${endpoint}?${q}`;
}

/**
 * The connect request.
 *
 * `app_url` is our public identity inside the wallet's approval screen — it
 * must be the canonical public origin, never `https://localhost` (which is
 * what a Capacitor WebView reports), or the wallet shows the user a domain
 * that does not exist. Callers pass it from lib/nativeShell.publicAppUrl.
 */
export function connectRequestUrl({
  walletId,
  dappPublicKey,
  redirectLink,
  appUrl,
  cluster = 'mainnet-beta'
}) {
  const wallet = deeplinkWallet(walletId);
  if (!wallet) return null;
  return requestUrl(wallet, 'connect', {
    app_url: appUrl,
    dapp_encryption_public_key: dappPublicKey,
    redirect_link: redirectLink,
    cluster
  });
}

/**
 * A signing request.
 *
 * `op` picks the endpoint: `signAndSendTransaction` (the wallet signs AND
 * broadcasts — the shape the security engines expect from a dapp that is not
 * behaving like a drainer), `signTransaction` (sign only, for a route that
 * lands the trade itself, like Jupiter), or `signMessage`.
 */
export function signRequestUrl({
  walletId,
  op,
  dappPublicKey,
  nonce,
  session,
  redirectLink,
  payload
}) {
  const wallet = deeplinkWallet(walletId);
  if (!wallet) return null;
  const endpoint = {
    signAndSendTransaction: 'signAndSendTransaction',
    signTransaction: 'signTransaction',
    signMessage: 'signMessage',
    disconnect: 'disconnect'
  }[op];
  if (!endpoint) return null;
  const params = {
    dapp_encryption_public_key: dappPublicKey,
    nonce,
    redirect_link: redirectLink,
    session
  };
  if (op === 'signAndSendTransaction' || op === 'signTransaction') params.transaction = payload;
  if (op === 'signMessage') params.message = payload;
  return requestUrl(wallet, endpoint, params);
}

/** The query string of a URL, hash included — wallets append to either. */
function queryPairs(raw) {
  const out = [];
  /*
   * SPLIT, DO NOT MATCH — and this is the whole reason the parser exists.
   *
   * A return URL is not necessarily well-formed. The wallet appends its own
   * parameters to whatever string we gave it as `redirect_link`, and when that
   * link already carried a query (ours does: `?sol=1&rid=…`) some builds append
   * with `?` instead of `&` — producing
   * `…&rid=abc?phantom_encryption_public_key=KEY&nonce=…&data=…`.
   *
   * A `key=value` regex with a "value until & or #" character class reads that
   * as rid = `abc?phantom_encryption_public_key=KEY`, swallowing the answer;
   * `URLSearchParams` reads the first `?` as the query and drops the rest for
   * the same reason. Splitting on both separators first is what makes the
   * mangled form readable, and it costs nothing on a well-formed URL: base58
   * and percent-encoded values can never contain a raw `?` or `&`.
   */
  for (const part of String(raw ?? '').split(/[?&]/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    try {
      out.push([decodeURIComponent(key), decodeURIComponent(value)]);
    } catch {
      /* A malformed escape sequence must not lose the parameter entirely. */
      out.push([key, value]);
    }
  }
  return out;
}

/**
 * Read the wallet's answer out of a URL.
 *
 * ─── WHY A REGEX AND NOT URLSearchParams ────────────────────────────────────
 * A return URL is not necessarily well-formed. The wallet appends its own
 * parameters to whatever string we gave it as `redirect_link`, and when that
 * link already carried a query (ours does: `?sol=1&rid=…`) some builds append
 * with `?` instead of `&` — producing `…?sol=1&rid=x?phantom_encryption_…`.
 * `URLSearchParams` reads the first `?` as the query and silently drops the
 * rest, which is precisely the answer we are waiting for; scanning the raw
 * string for `key=` pairs finds them all.
 *
 * The result distinguishes three states, because the caller must treat them
 * differently: `none` (not a wallet return at all), `error` (the wallet says
 * no — user rejected, or a wallet-side failure) and `params` (a real answer
 * that still has to be decrypted).
 */
export function readDeeplinkReturn(rawUrl) {
  const raw = String(rawUrl ?? '');
  const pairs = queryPairs(raw);
  const get = (name) => pairs.find(([k]) => k === name)?.[1] ?? null;

  const errorCode = get('errorCode') ?? get('error_code');
  const errorMessage = get('errorMessage') ?? get('error_message');
  if (errorCode) {
    /* 4001 is the universal "user rejected" code — the same number EIP-1193
       uses, and the same one the rest of this app maps to REJECTED. */
    return {
      state: 'error',
      error: { code: String(errorCode), message: errorMessage || '' },
      params: null
    };
  }

  const walletKey = get('phantom_encryption_public_key') ?? get('wallet_encryption_public_key');
  const nonce = get('nonce');
  const data = get('data');
  if (!walletKey || !nonce || !data) return { state: 'none', error: null, params: null };

  return {
    state: 'params',
    error: null,
    params: {
      walletEncryptionPublicKey: walletKey,
      nonce,
      data,
      /* Optional extras some wallets echo — carried through, never trusted. */
      walletId: get('walletId') ?? get('wallet_id') ?? null,
      requestId: get('rid') ?? null
    }
  };
}

/**
 * Is this URL a wallet's answer to one of our requests?
 *
 * Used on boot and on every navigation, so it must answer fast and never
 * throw on a URL it does not recognise.
 */
export function isDeeplinkReturn(rawUrl) {
  return readDeeplinkReturn(rawUrl).state !== 'none';
}

/**
 * The same URL with the wallet's parameters removed.
 *
 * The address bar must not keep `?data=<encrypted payload>` after we have
 * consumed it: it is unreadable to a human, it re-triggers the boot drain on
 * every refresh, and a copied link would leak a signed payload into a chat.
 * `sol`/`rid` markers are removed too, for the same reason.
 */
export function stripDeeplinkReturn(rawUrl) {
  const raw = String(rawUrl ?? '');
  const drop = new Set([
    'phantom_encryption_public_key',
    'wallet_encryption_public_key',
    'nonce',
    'data',
    'errorCode',
    'errorMessage',
    'error_code',
    'error_message',
    'rid',
    'sol',
    'walletId',
    'wallet_id'
  ]);
  const [beforeHash, ...hashParts] = raw.split('#');
  const hash = hashParts.length ? `#${hashParts.join('#')}` : '';
  const [path, query] = beforeHash.split('?');
  if (!query) return raw;
  const kept = query
    .split('&')
    .filter(Boolean)
    .filter((pair) => !drop.has(decodeURIComponent(pair.split('=')[0] || '')));
  return `${path}${kept.length ? `?${kept.join('&')}` : ''}${hash}`;
}
