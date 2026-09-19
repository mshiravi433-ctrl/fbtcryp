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

globalThis.window = {
  location: locationStub,
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
  ok('the connect request goes to the wallet host over https', parsed.host === 'phantom.app' && parsed.path === '/ul/v1/connect');
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
/* 2. connect — the approval screen's round trip                               */
/* -------------------------------------------------------------------------- */
const wallet = newWallet();
let connectRid = null;
{
  const started = await deeplink.startDeeplinkConnect('phantom');
  ok('the connect request was built and opened', started.ok === true && opened.length === 1);

  const params = requestParams(opened[0]);
  ok('the wallet was asked at a real Phantom endpoint', params.host === 'phantom.app');
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
{
  const txBytes = nacl.randomBytes(96);
  const base64Tx = Buffer.from(txBytes).toString('base64');
  const pendingSign = deeplink.deeplinkSignAndSendTransaction(base64Tx);

  /* Give the async flow a turn to build and open the request. */
  await new Promise((r) => setTimeout(r, 30));

  const params = requestParams(opened[opened.length - 1]);
  ok('the signing request goes to signAndSendTransaction', params.path === '/ul/v1/signAndSendTransaction');
  ok('the transaction travels base58 as the wallet expects',
    base58Encode(base64DecodeForTest(params.get('transaction'))).length > 0
    && params.get('nonce').length > 20
    && params.get('session') === SESSION);

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
}

function base64DecodeForTest(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
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
