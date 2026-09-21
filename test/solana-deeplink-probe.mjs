/**
 * SOLANA DEEPLINK CONNECT — the probe (no wallet, no network, no mainnet).
 * ---------------------------------------------------------------------------
 * The reported bug: «وقتی میزی روی اتصال کیف پول فقط وارد کیف پول فانتوم میشه و
 * هیچ صفحه تاییدی برای اتصال به کیف پول ما انجام نمیشود». The fix is a connect
 * REQUEST the wallet answers, so what has to be proved is exactly that exchange
 * — and it can be, completely, without a wallet app: a wallet is only a key
 * pair that decrypts what we sent and encrypts what it answers.
 *
 * This file plays the wallet:
 *
 *   1. reads the request URL our code produced, the way Phantom's handler does
 *      (query parameters, base58, no crypto in the request);
 *   2. derives the same shared key (X25519 + HSalsa20 — that is ALL `box.before`
 *      is) from the dapp public key and its own secret key, and seals an answer
 *      the way the wallet does;
 *   3. feeds that answer back through the return path and asserts the app now
 *      holds the right address, the right wallet name, and a session.
 *
 * It also locks the failure paths that matter more than the happy one:
 * a USER REJECTION (4001) must not leave a session behind, an answer that
 * arrives twice (native push plus the native inbox) must not report an error
 * over a connection that succeeded, and an answer to nothing must be named
 * rather than silently swallowed.
 *
 * Wired into test/run.mjs next to the other Solana probes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import {
  DEEPLINK_WALLETS,
  base58Decode,
  base58Encode,
  connectRequestUrl,
  isDeeplinkReturn,
  readDeeplinkReturn,
  signRequestUrl,
  stripDeeplinkReturn
} from '../src/lib/solana/deeplinkUri.js';

/* -------------------------------------------------------------------------- */
/* the browser the module thinks it is running in                              */
/* -------------------------------------------------------------------------- */

const opened = [];
const events = [];
const storage = new Map();

globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};

const locationStub = {
  href: 'https://fbtswap.ir/#/wallet?tab=solana',
  hash: '#/wallet?tab=solana',
  assign: (url) => opened.push(String(url))
};

/*
 * The four views this flow has to get right, as UA strings.
 *
 * They are not decoration: which one the app is standing in decides HOW the
 * wallet request is delivered, and two of the four used to deliver it in a way
 * that reached the wallet with nothing to approve — the bug this probe exists
 * for. Desktop is the default so the assertions below read in the order the
 * flow happens; the phone views are switched in where they are the point.
 */
const UA_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_ANDROID_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0';
const UA_IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const setUa = (ua) => { globalThis.window.navigator.userAgent = ua; };

globalThis.window = {
  location: locationStub,
  navigator: { userAgent: UA_DESKTOP },
  dispatchEvent: (event) => {
    events.push(event);
    return true;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  open: () => null
};

const deeplink = await import('../src/lib/solana/deeplink.js');

/*
 * `src/lib/solanaWallet.js` uses extensionless specifiers (`./nativeShell`),
 * which only the bundler resolves — the reason the repo's client probes are
 * built with Vite (test/vite.solana-client.mjs). This probe runs in plain Node
 * on purpose (it must be runnable with nothing installed but tweetnacl), so
 * the three places that wire the session into the wallet layer are asserted
 * against the source instead, and the runtime behaviour of those three is
 * covered by test/solana-connect-sheet.test.jsx, which mounts the real
 * components through Vite's resolver.
 */
const walletSrc = readFileSync(new URL('../src/lib/solanaWallet.js', import.meta.url), 'utf8');
const deeplinkSrc = readFileSync(new URL('../src/lib/solana/deeplink.js', import.meta.url), 'utf8');

/** The address the WALLET LAYER would report — the mirror of solanaAddress(). */
const solanaAddress = () => deeplink.deeplinkSessionAddress();

/* -------------------------------------------------------------------------- */
/* the wallet, played by the test                                              */
/* -------------------------------------------------------------------------- */

const ADDRESS = '9Z4wtiosH7JMXhKg8JpUPDCtB5ZyM8vzby14HwDidgVz';
const SESSION = 'session-token-from-the-wallet';
const utf8 = (s) => new TextEncoder().encode(s);
const fromUtf8 = (b) => new TextDecoder().decode(b);

/** A wallet: one box key pair, and the shared key it derives with a dapp. */
function newWallet() {
  const keys = nacl.box.keyPair();
  return {
    keys,
    publicKeyB58: base58Encode(keys.publicKey),
    /** THE SAME KEY the dapp derives — `box.before` is just this. */
    sharedWith: (dappPublicKeyB58) => nacl.box.before(base58Decode(dappPublicKeyB58), keys.secretKey)
  };
}

/** The answer a wallet appends to `redirect_link`. */
function answerUrl({ redirectLink, wallet, dappPublicKey, nonceB58, payload, errorCode }) {
  if (errorCode) {
    return `${redirectLink}${redirectLink.includes('?') ? '&' : '?'}errorCode=${errorCode}&errorMessage=User%20rejected`;
  }
  const nonce = nonceB58 ? base58Decode(nonceB58) : nacl.randomBytes(24);
  const sealed = nacl.box.after(
    utf8(JSON.stringify(payload)),
    nonce,
    wallet.sharedWith(dappPublicKey)
  );
  const join = redirectLink.includes('?') ? '&' : '?';
  return `${redirectLink}${join}phantom_encryption_public_key=${wallet.publicKeyB58}`
    + `&nonce=${nonceB58 ?? base58Encode(nonce)}&data=${base58Encode(sealed)}`;
}

/** Everything a request URL carries, the way a wallet reads it. */
function requestParams(url) {
  const u = new URL(url);
  return {
    host: u.host,
    path: u.pathname,
    get: (name) => u.searchParams.get(name)
  };
}

let step = 0;
const ok = (name, condition) => {
  step += 1;
  assert.ok(condition, `#${step} ${name}`);
};

/* -------------------------------------------------------------------------- */
/* 0. the wallet layer is actually wired to this session                       */
/* -------------------------------------------------------------------------- */
{
  const addressFn = /export function solanaAddress\(\) \{[\s\S]*?\n\}/.exec(walletSrc)?.[0] ?? '';
  ok('solanaAddress falls back to the deeplink session',
    addressFn.includes('deeplinkSessionAddress()'));
  const disconnectFn = /export async function disconnectSolana\(\) \{[\s\S]*?\n\}/.exec(walletSrc)?.[0] ?? '';
  ok('disconnecting clears the deeplink session', disconnectFn.includes('clearDeeplinkSession()'));
  ok('both signing paths route to the session when there is no provider',
    (walletSrc.match(/if \(!provider && !mwa && deeplinkSession\(\)\)/g) || []).length === 2);
  ok('the Solana deeplink module never touches the EVM namespace',
    !/window\.ethereum/.test(deeplinkSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')));
}

/* -------------------------------------------------------------------------- */
/* 1. the pure protocol layer                                                  */
/* -------------------------------------------------------------------------- */
{
  const bytes = nacl.randomBytes(32);
  ok('base58 round-trips 32 raw bytes', base58Decode(base58Encode(bytes)).every((b, i) => b === bytes[i]));
  ok('base58 keeps leading zero bytes as 1s', base58Encode(new Uint8Array([0, 0, 1])).startsWith('11'));
  ok('base58 rejects a character outside the alphabet', base58Decode('0OIl') === null);

  ok('every promoted wallet has an https base and a browse link',
    DEEPLINK_WALLETS.every((w) => w.base.startsWith('https://') && w.browse.startsWith('https://')));

  const phantom = connectRequestUrl({
    walletId: 'phantom',
    dappPublicKey: 'PUBKEY',
    redirectLink: 'https://fbtswap.ir/?sol=1&rid=abc',
    appUrl: 'https://fbtswap.ir'
  });
  const parsed = requestParams(phantom);
  ok('the connect request goes to the wallet host over https',
    parsed.host === 'phantom.com' && parsed.path === '/ul/v1/connect');
  /*
   * phantom.com, NOT phantom.app — and this is a delivery fact, not a
   * cosmetic one. Phantom's own `/.well-known/assetlinks.json` lives on
   * phantom.com and lists `app.phantom`; phantom.app 404s it and 301s here.
   * A request addressed at a host the wallet app never declared resolves to
   * nothing when it is handed to Android (`intent://`, ACTION_VIEW+package),
   * so the wallet — installed, unlocked, on the phone — never opens.
   */
  ok('and it is the host the wallet app actually claims',
    DEEPLINK_WALLETS.find((w) => w.id === 'phantom').hosts.includes('phantom.com'));
  ok('the connect request carries the dapp key, our identity and the redirect',
    parsed.get('dapp_encryption_public_key') === 'PUBKEY'
    && parsed.get('app_url') === 'https://fbtswap.ir'
    && parsed.get('redirect_link') === 'https://fbtswap.ir/?sol=1&rid=abc'
    && parsed.get('cluster') === 'mainnet-beta');
  ok('the dapp identity is never localhost',
    !/localhost/.test(phantom));
  ok('an unknown wallet builds nothing', connectRequestUrl({ walletId: 'nope', dappPublicKey: 'x', redirectLink: 'y' }) === null);

  const solflare = signRequestUrl({
    walletId: 'solflare',
    op: 'signAndSendTransaction',
    dappPublicKey: 'PUBKEY',
    nonce: 'NONCE',
    session: 'SESSION',
    redirectLink: 'https://fbtswap.ir/?sol=1&rid=abc',
    payload: 'TX'
  });
  ok('a signing request follows the same shape on another wallet',
    solflare.startsWith('https://solflare.com/ul/v1/signAndSendTransaction?')
    && solflare.includes('session=SESSION') && solflare.includes('transaction=TX'));
  ok('an unknown operation builds nothing',
    signRequestUrl({ walletId: 'phantom', op: 'drainEverything', dappPublicKey: 'x', nonce: 'n', session: 's', redirectLink: 'r', payload: 'p' }) === null);

  /* The concatenation bug that URLSearchParams cannot see: a wallet that
     appends with `?` instead of `&` to a link that already had a query. */
  const mangled = 'https://fbtswap.ir/?sol=1&rid=abc?phantom_encryption_public_key=KEY&nonce=NNN&data=DDD';
  const read = readDeeplinkReturn(mangled);
  ok('an answer appended with the wrong separator is still read',
    read.state === 'params' && read.params.data === 'DDD' && read.params.requestId === 'abc');
  ok('a plain page URL is not mistaken for an answer',
    isDeeplinkReturn('https://fbtswap.ir/#/wallet?tab=solana') === false);

  const rejected = readDeeplinkReturn('https://fbtswap.ir/?errorCode=4001&errorMessage=User+rejected');
  ok('a rejection is reported as an error, not as missing parameters',
    rejected.state === 'error' && rejected.error.code === '4001');

  const cleaned = stripDeeplinkReturn(mangled);
  ok('the encrypted answer is stripped from the address bar',
    !/data=/.test(cleaned) && !/rid=/.test(cleaned) && cleaned.startsWith('https://fbtswap.ir/'));
}

/* -------------------------------------------------------------------------- */
/* 1b. the tap that must not lose its gesture                                  */
/* -------------------------------------------------------------------------- */
/*
 * «اتفاقی نمی‌افتد یا خیلی طول می‌کشد که صفحهٔ تأیید کیف پول بیاید».
 *
 * Both halves came out of one design mistake. A connect request needs a key
 * pair; the key pair needs `tweetnacl`; and every one of those was awaited
 * before the wallet was opened. Chrome's own rule
 * (developer.chrome.com/docs/android/intents) is that an `intent://` is NOT
 * launched when it «was initiated without a user gesture» — a timer fired at
 * the wallet is not a tap, and the browser goes to the fallback URL instead.
 * The hand-off therefore has to leave in the same task as the tap, which is
 * only possible when the key pair was made BEFORE it.
 */
{
  setUa(UA_ANDROID_CHROME);
  ok('before anything is armed, a tap is named rather than silently ignored',
    deeplink.startDeeplinkConnectSync('phantom').code === 'NOT_ARMED');
  ok('and it leaves no half-built request behind',
    deeplink.pendingDeeplinkRequest() === null);

  ok('warming is what puts a tap-ready key pair in memory',
    (await deeplink.warmDeeplinkRequest()) === true && deeplink.deeplinkArmed() === true);

  /* THE PIN: nothing is awaited between the call and the wallet being opened. */
  const before = opened.length;
  const tapped = deeplink.startDeeplinkConnectSync('phantom');
  ok('the wallet is opened in the SAME TASK as the tap',
    tapped.ok === true && opened.length === before + 1);
  ok('over the route Android Chrome accepts: the package-scoped intent',
    tapped.route === 'intent'
    && String(opened.at(-1)).startsWith('intent://phantom.com/ul/v1/connect?'));
  ok('and the request is on record while the wallet holds it',
    deeplink.pendingDeeplinkRequest()?.id === tapped.id
    && deeplink.deeplinkState().status === 'waiting');
  deeplink.cancelDeeplinkRequest(tapped.id);
  setUa(UA_DESKTOP);
}

/* -------------------------------------------------------------------------- */
/* 1c. «I tapped and nothing happened» — said out loud                         */
/* -------------------------------------------------------------------------- */
/*
 * Until this existed, two very different situations looked identical on the
 * screen: the wallet is open in front of the user waiting to be approved, and
 * the hand-off went nowhere and this page is exactly where they left it. Both
 * said «منتظر تأیید…». The signal that separates them is free: when another
 * app comes forward, this document stops being visible.
 */
{
  setUa(UA_ANDROID_CHROME);
  globalThis.__FBT_HANDOFF_GRACE_MS = 40; // a probe cannot sit for 2.5 s per case
  await deeplink.warmDeeplinkRequest();

  const silent = deeplink.startDeeplinkConnectSync('phantom');
  ok('a fired hand-off starts out not-stuck', silent.ok === true && deeplink.deeplinkState().stuck === false);
  await new Promise((r) => setTimeout(r, 150));
  ok('a hand-off that never brought a wallet forward is reported as STUCK',
    deeplink.deeplinkState().stuck === true && deeplink.deeplinkState().status === 'waiting');
  deeplink.cancelDeeplinkRequest(silent.id);
  ok('cancelling clears the recovery state', deeplink.deeplinkState().stuck === false);

  /* The other half: the wallet DID come forward, so this document is hidden —
     no card, the user is looking at their wallet. */
  globalThis.document = { visibilityState: 'hidden' };
  const forward = deeplink.startDeeplinkConnectSync('phantom');
  await new Promise((r) => setTimeout(r, 150));
  ok('a wallet that came to the front is NOT reported as stuck',
    forward.ok === true && deeplink.deeplinkState().stuck === false);
  deeplink.cancelDeeplinkRequest(forward.id);
  delete globalThis.document;

  /* The recovery route: our page, inside the wallet's own browser. */
  const browse = deeplink.openDeeplinkBrowse('phantom');
  ok('the recovery route opens the wallet\'s own browser on our page',
    browse.ok === true
    && String(opened.at(-1)).startsWith('intent://phantom.com/ul/browse/')
    && browse.url.startsWith('https://phantom.com/ul/browse/'));
  ok('the card can also send the user to the store',
    deeplink.deeplinkInstallLink('phantom').includes('id=app.phantom'));

  delete globalThis.__FBT_HANDOFF_GRACE_MS;
  setUa(UA_DESKTOP);
}

/* -------------------------------------------------------------------------- */
/* 2. connect — the approval screen's round trip                               */
/* -------------------------------------------------------------------------- */
const wallet = newWallet();
let connectRid = null;
{
  const beforeConnect = opened.length;
  const started = await deeplink.startDeeplinkConnect('phantom');
  ok('the connect request was built and opened',
    started.ok === true && opened.length === beforeConnect + 1);

  const params = requestParams(opened.at(-1));
  ok('the wallet was asked at a real Phantom endpoint', params.host === 'phantom.com');
  const redirect = params.get('redirect_link');
  ok('the redirect carries the state id back to us', redirect.includes('rid='));
  connectRid = redirect.match(/rid=([^&]+)/)[1];
  ok('a request is pending while the wallet holds the approval',
    deeplink.pendingDeeplinkRequest()?.id === connectRid);
  ok('the sheet is told to wait', deeplink.deeplinkState().status === 'waiting');

  const answer = answerUrl({
    redirectLink: redirect,
    wallet,
    dappPublicKey: params.get('dapp_encryption_public_key'),
    payload: { public_key: ADDRESS, session: SESSION }
  });

  const done = await deeplink.completeDeeplinkReturn(answer);
  ok('the wallet\'s sealed answer is decrypted into a session',
    done.ok === true && done.op === 'connect' && done.address === ADDRESS);
  ok('the session names the wallet that answered', deeplink.deeplinkSession()?.walletId === 'phantom');
  ok('the session token from the wallet is kept', deeplink.deeplinkSession()?.session === SESSION);
  ok('no request is left waiting after a completed connect', deeplink.pendingDeeplinkRequest() === null);
  ok('the flow reports CONNECTED', deeplink.deeplinkState().status === 'connected');

  ok('the app\'s Solana address is the one the wallet approved',
    solanaAddress() === ADDRESS);
  ok('the shared wallet event fired for every screen listening',
    events.some((e) => e.type === 'solana:wallet-change' && e.detail?.address === ADDRESS));
}

/* -------------------------------------------------------------------------- */
/* 3. signing — a round trip per transaction, still approved in the wallet     */
/* -------------------------------------------------------------------------- */
/*
 * A legacy-shaped compiled transaction with ONE required signature, so the
 * sign guard reads it as a transaction Phantom can simulate. Bytes 0..2 are
 * the message header: numRequiredSignatures, then the two read-only counts.
 */
function legacyTx(sizeBytes, requiredSignatures = 1) {
  const bytes = new Uint8Array(Math.max(sizeBytes, 64));
  bytes[0] = requiredSignatures;
  bytes[1] = 0;
  bytes[2] = requiredSignatures;
  return Buffer.from(bytes).toString('base64');
}

/* 3a. ANDROID CHROME — the request goes to the wallet and THIS PAGE STAYS. */
{
  setUa(UA_ANDROID_CHROME);
  const base64Tx = legacyTx(400);
  const pendingSign = deeplink.deeplinkSignAndSendTransaction(base64Tx);

  /* Give the async flow a turn to build and open the request. */
  await new Promise((r) => setTimeout(r, 30));

  const raw = opened[opened.length - 1];
  ok('on Android the signing request is handed over as a package-scoped intent',
    raw.startsWith('intent://phantom.com/ul/v1/signAndSendTransaction?')
    && raw.includes('package=app.phantom')
    && raw.includes('scheme=https')
    && raw.endsWith(';end'));
  /*
   * The fallback is the wallet's OWN BROWSER on our page, not the store.
   *
   * It is used when the intent does not resolve — which is both "the wallet is
   * not installed" and "the wallet is installed but does not declare this
   * URL". The store link answers the second case with «install the app you
   * already have»; the browse link opens the wallet, which loads our page in
   * itself, where the provider is injected and the connection can still be
   * made.
   */
  ok('the intent falls back to the wallet\'s own browser on our page',
    raw.includes('S.browser_fallback_url=')
    && decodeURIComponent(raw).includes('https://phantom.com/ul/browse/')
    && decodeURIComponent(raw).includes(encodeURIComponent('https://fbtswap.ir')));

  const params = requestParams(raw);
  ok('the signing request goes to signAndSendTransaction', params.path === '/ul/v1/signAndSendTransaction');
  /* The wire form is base58 of the raw bytes — asserted by decoding it back,
     not by re-encoding something else and hoping the lengths look plausible. */
  const txOnTheWire = base58Decode(params.get('transaction'));
  ok('the transaction travels base58 as the wallet expects',
    txOnTheWire?.length === 400
    && txOnTheWire[0] === 1
    && params.get('nonce').length > 20
    && params.get('session') === SESSION);
  ok('a single-signer transaction is not flagged as one Phantom cannot simulate',
    deeplink.deeplinkState().warnings?.length === 0
    || deeplink.deeplinkState().warnings === undefined);

  const signature = base58Encode(nacl.randomBytes(64));
  const answer = answerUrl({
    redirectLink: params.get('redirect_link'),
    wallet,
    dappPublicKey: params.get('dapp_encryption_public_key'),
    nonceB58: params.get('nonce'),
    payload: { signature }
  });
  const applied = await deeplink.completeDeeplinkReturn(answer);
  const result = await pendingSign;
  ok('the wallet\'s signature reaches the caller that asked for it',
    applied.ok === true && result.ok === true && result.signature === signature);
  setUa(UA_DESKTOP);
}

/*
 * 3b. A VIEW THAT CAN ONLY BE GIVEN THE REQUEST BY NAVIGATING AWAY.
 *
 * iOS has no `intent://`, and Apple does not allow the inter-app channel MWA
 * needs, so Safari's only route is `location.assign` to the wallet's URL. The
 * signature then comes back into a NEW document — so the promise here can
 * never resolve, and the old code left the swap spinning until its fifteen
 * minute bound expired and reported a failure over a signature that had
 * succeeded. `IN_WALLET` is the honest answer, and the stored result is what
 * the reloaded page reads.
 */
{
  setUa(UA_IPHONE_SAFARI);
  deeplink.consumeDeeplinkResult();
  const base64Tx = legacyTx(400);
  const pendingSign = deeplink.deeplinkSignAndSendTransaction(base64Tx);
  await new Promise((r) => setTimeout(r, 30));

  const raw = opened[opened.length - 1];
  ok('iOS gets the universal link, not a scheme Safari cannot render',
    raw.startsWith('https://phantom.com/ul/v1/signAndSendTransaction?'));

  const params = requestParams(raw);
  const result = await pendingSign;
  ok('a route that navigates this page away is NAMED instead of hanging',
    result.ok === false && result.code === 'IN_WALLET');
  ok('and it is not reported as a failure the user has to act on',
    result.code !== 'SIGN_FAILED' && result.code !== 'TIMEOUT');

  /* The wallet still answers, into the next page load. */
  const signature = base58Encode(nacl.randomBytes(64));
  await deeplink.completeDeeplinkReturn(answerUrl({
    redirectLink: params.get('redirect_link'),
    wallet,
    dappPublicKey: params.get('dapp_encryption_public_key'),
    nonceB58: params.get('nonce'),
    payload: { signature }
  }));
  const stored = deeplink.consumeDeeplinkResult();
  ok('the signature is kept for the document that comes back',
    stored?.ok === true && stored.signature === signature && stored.op === 'signAndSendTransaction');
  setUa(UA_DESKTOP);
}

/*
 * 3c. WHY PHANTOM SHOWS A RISK DIALOG AT SIGNING TIME.
 *
 * «This dApp could be malicious» is Phantom's SIMULATION warning, and it is
 * a property of the transaction: one it cannot predict the outcome of. The two
 * shapes that cause it are decided here, before the wallet is opened, so the
 * user is told the reason instead of meeting a frightening dialog with no
 * explanation. Phantom's own published remedies are exactly these two rules.
 */
{
  deeplink.consumeDeeelinkResultSafe?.();
  const multi = legacyTx(400, 2);
  deeplink.deeplinkSignTransaction(multi);
  await new Promise((r) => setTimeout(r, 30));
  ok('a transaction that needs a second signature is named before the wallet opens',
    deeplink.deeplinkState().warnings?.includes('MULTI_SIGNER') === true);
  deeplink.cancelDeeplinkRequest(null);

  const huge = legacyTx(1400);
  deeplink.deeplinkSignTransaction(huge);
  await new Promise((r) => setTimeout(r, 30));
  ok('a transaction over Solana\'s 1232-byte limit is named too',
    deeplink.deeplinkState().warnings?.includes('TX_OVERSIZE') === true);
  deeplink.cancelDeeplinkRequest(null);
}

/* -------------------------------------------------------------------------- */
/* 4. a rejection leaves nothing behind                                        */
/* -------------------------------------------------------------------------- */
{
  deeplink.clearDeeplinkSession();
  const started = await deeplink.startDeeplinkConnect('solflare');
  const params = requestParams(opened[opened.length - 1]);
  ok('a second wallet can be asked after a disconnect', started.ok === true && params.host === 'solflare.com');

  const rejected = await deeplink.completeDeeplinkReturn(
    answerUrl({ redirectLink: params.get('redirect_link'), wallet, errorCode: '4001' })
  );
  ok('a user rejection is named REJECTED', rejected.ok === false && rejected.code === 'REJECTED');
  ok('a rejected connection leaves no session', deeplink.deeplinkSession() === null);
  ok('a rejected connection leaves no pending request', deeplink.pendingDeeplinkRequest() === null);
  ok('the app is not connected after a rejection', solanaAddress() === null);
}

/* -------------------------------------------------------------------------- */
/* 5. the APK path — native code hands the answer over                         */
/* -------------------------------------------------------------------------- */
{
  /* A wallet the user already approved, then the app was opened from the
     deep link while nothing pending matched: the guard must not report an
     error over a connection that exists. */
  const started = await deeplink.startDeeplinkConnect('backpack');
  ok('a third wallet can be asked', started.ok === true);

  const params = requestParams(opened[opened.length - 1]);
  const answer = answerUrl({
    redirectLink: params.get('redirect_link'),
    wallet,
    dappPublicKey: params.get('dapp_encryption_public_key'),
    payload: { public_key: ADDRESS, session: SESSION }
  });

  /* The native inbox: what MainActivity.consume() returns after the app was
     brought back by `ir.fbtswap.app://solconnect?…`. */
  deeplink.installNativeDeepLinkBridge(globalThis.window);
  globalThis.window.FBTDeepLinkBridge = { consume: () => answer };
  await deeplink.drainDeeplink({ force: true });
  await new Promise((r) => setTimeout(r, 30));

  ok('a deep link pushed in by native code completes the connection',
    deeplink.deeplinkSession()?.walletId === 'backpack');

  /* The same URL again — the double delivery MainActivity guarantees. */
  globalThis.window.FBTDeepLink(answer);
  await new Promise((r) => setTimeout(r, 30));
  ok('the same answer twice is not reported as a failure',
    deeplink.deeplinkState().status === 'connected'
    && deeplink.deeplinkSession()?.walletId === 'backpack');

  /*
   * An answer with nothing behind it is NAMED, not swallowed — but only while
   * there is no connection for it to have completed: with a live session the
   * same shape is the harmless double delivery asserted above.
   */
  deeplink.clearDeeplinkSession();
  const orphan = await deeplink.completeDeeplinkReturn(
    'https://fbtswap.ir/?sol=1&rid=nothing&phantom_encryption_public_key=K&nonce=N&data=D'
  );
  ok('an answer to no request is named', orphan.ok === false && orphan.code === 'NO_PENDING');
}

/* -------------------------------------------------------------------------- */
/* 6. the lease is the one the user chose                                      */
/* -------------------------------------------------------------------------- */
{
  deeplink.clearDeeplinkSession();
  storage.set('fbt-settings', JSON.stringify({ state: { walletSessionMinutes: 0 } }));
  await deeplink.startDeeplinkConnect('phantom');
  const params = requestParams(opened[opened.length - 1]);
  await deeplink.completeDeeplinkReturn(answerUrl({
    redirectLink: params.get('redirect_link'),
    wallet,
    dappPublicKey: params.get('dapp_encryption_public_key'),
    payload: { public_key: ADDRESS, session: SESSION }
  }));
  ok('«until I disconnect» means the session carries no expiry',
    deeplink.deeplinkSession()?.expiresAt === null);

  /* And a lapsed lease is not a connection. */
  deeplink.clearDeeplinkSession();
  storage.set('fbt:solana:session:v1', JSON.stringify({
    v: 1, walletId: 'phantom', address: ADDRESS, session: SESSION,
    dappSecretKey: base58Encode(nacl.randomBytes(32)),
    expiresAt: Date.now() - 1000
  }));
  ok('a lapsed session is not reported as connected', deeplink.deeplinkSession() === null);
  ok('and the app does not claim an address it no longer holds', solanaAddress() === null);
  deeplink.resetDeeplink();
}

/* -------------------------------------------------------------------------- */
/* 7. the route table — how the request reaches the wallet, per view           */
/* -------------------------------------------------------------------------- */
/*
 * The reported bug was not in the request; the request was always correct. It
 * was in the DELIVERY: two of these views used to hand a universal link to
 * something that renders http/https itself instead of passing it to the wallet
 * app, and the wallet duly opened with nothing in it to approve.
 */
{
  const routesFor = (ua, extra = {}) =>
    deeplink.deeplinkOpenRoutes({
      walletId: 'phantom',
      url: 'https://phantom.app/ul/v1/connect?app_url=https%3A%2F%2Ffbtswap.ir%2F',
      view: { navigator: { userAgent: ua }, ...extra }
    }).map((r) => r.route);

  ok('Android Chrome opens the wallet WITHOUT navigating this page',
    routesFor(UA_ANDROID_CHROME)[0] === 'intent');
  ok('an Android WebView gets no intent route — nothing there intercepts it',
    !routesFor(UA_ANDROID_WEBVIEW).includes('intent'));
  ok('Firefox on Android gets no intent route either',
    !routesFor(UA_ANDROID_FIREFOX).includes('intent'));
  ok('iOS falls back to the universal link',
    routesFor(UA_IPHONE_SAFARI).join(',') === 'universal');
  ok('a browser that cannot carry the request still ends at the universal link',
    routesFor(UA_ANDROID_WEBVIEW).at(-1) === 'universal');

  /*
   * A REFUSED intent is not a catchable error: Chrome just commits to the
   * fallback URL. So when the platform says the gesture is gone (a swap signed
   * after an RPC round trip), the intent is not fired at all and the universal
   * link carries the request instead — it survives in the URL, and the OS can
   * still hand it to the wallet from a normal navigation.
   */
  ok('with the gesture provably gone, Android Chrome gets the universal link '
    + 'rather than an intent Chrome would refuse',
    !routesFor(UA_ANDROID_CHROME, { navigator: { userAgent: UA_ANDROID_CHROME, userActivation: { isActive: false } } })
      .includes('intent'));

  /* Inside the APK the FIRST route must be the native ACTION_VIEW bridge: a
     Custom Tab cannot deliver an App Link, which is what made Phantom open
     with no approval screen in it. */
  const native = deeplink.deeplinkOpenRoutes({
    walletId: 'solflare',
    url: 'https://solflare.com/ul/v1/connect?x=1',
    view: { navigator: { userAgent: UA_ANDROID_WEBVIEW }, Capacitor: { isNativePlatform: () => true } }
  });
  ok('inside the APK the request goes to Android, package-scoped, first',
    native[0].route === 'native-intent' && native[0].packageName === 'com.solflare.mobile');
  ok('and a Custom Tab is only ever the fallback behind it',
    native[1].route === 'custom-tab');
}

/*
 * HAND THE PROCESS BACK AS WE FOUND IT.
 *
 * `npm test` imports every probe into ONE Node process, so a fake `window` and
 * `localStorage` left behind would change what later modules see when they ask
 * `typeof window !== 'undefined'` — a pollution bug that would surface as a
 * mysterious failure in an unrelated probe. They are deleted rather than reset
 * because they did not exist before this file ran.
 */
delete globalThis.window;
delete globalThis.localStorage;

console.log('\n✓ solana-deeplink-probe: all assertions passed (simulated wallet, no network)\n');
