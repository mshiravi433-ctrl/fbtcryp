/**
 * PAIRING-URI HYGIENE PROBE — the «Invalid Url: wc:…&amp;…» report
 * ---------------------------------------------------------------------------
 * WHAT WAS REPORTED (verbatim, from a phone):
 *
 *   Invalid Url:wc:198a4798c03ddc3bf957dfa262e79539aebc2d789da4528def4ad7eb46beed19
 *     @2?expiryTimestamp=1789475199&amp;relay-protocol=irn&amp;symKey=7cc8ed0d…
 *
 * Every `&` in that string is HTML-escaped. The URI itself is otherwise
 * EXACTLY what this app's own SDK generates — measured in this probe, in a
 * child process, against the installed `@walletconnect/core`:
 *
 *   wc:<64 hex topic>@2?expiryTimestamp=<now + 5 min>&relay-protocol=irn&symKey=<64 hex>
 *
 * (the parameter order is alphabetical because `formatUri()` sorts its keys,
 * which is why `expiryTimestamp` comes first). No part of this app and no part
 * of the SDK writes `&amp;`; the escaping is what an HTML surface does to a URL
 * it prints or stores — an error page showing the URL it refused to load, an
 * `href` read back out of page source, a wallet echoing the URI it was handed.
 * A pairing that ends up on such a surface is stuck: the app that opened it is
 * not a wallet, and the wallet never saw it.
 *
 * WHY IT IS NOT COSMETIC — also measured here: fed the escaped string, the
 * SDK's own `pairing.pair()` answers
 *
 *   Missing or invalid. pair() uri#relay-protocol
 *
 * because `&amp;relay-protocol` and `&amp;symKey` are swallowed as parameter
 * names: the relay protocol and the symmetric key both vanish. The repaired
 * twin pairs (the same call resolves). So an escaped URI is a silent,
 * un-diagnosable connection failure — and the one thing our side can always do
 * is refuse to hand it on.
 *
 * WHAT THIS PROBE LOCKS
 *   1. The reported shape is the SDK's own output, with plain `&`.
 *   2. `pair()` rejects the escaped form and accepts the repaired one.
 *   3. `repairPairingUri()` restores `&amp;` / `&#38;` / `&#x26;`, is a no-op
 *      on a healthy URI, and never touches a string that is not a pairing URI.
 *   4. `repairPairingInUrl()` repairs both a percent-encoded payload and the
 *      never-encoded form, and returns a healthy link BYTE-FOR-BYTE unchanged
 *      (a working pairing is never re-encoded).
 *   5. `walletLink()` emits `%26` between parameters — never `&amp;` — even
 *      when it is handed a damaged URI.
 *   6. A BARE `wc:` URI (the reported error, which names no app) is completed
 *      into the tapped wallet's native link with HTTPS fallback, and nothing
 *      is invented when no wallet was tapped.
 *   7. The wallet is recorded at the SDK's real hand-off (`onConnectMobile`),
 *      which is what makes (6) possible — driven against the real controllers.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  MOBILE_WALLETS,
  forgetTappedWallet,
  lastTappedWallet,
  looksLikePairingUri,
  rememberTappedWallet,
  repairPairingUri,
  walletLink
} from '../src/lib/wcWallets.js';
import {
  decideWalletOpen,
  installWalletOpenBridge,
  repairPairingInUrl
} from '../src/lib/wcDeepLink.js';

/* The reported string, verbatim: topic, expiry, relay protocol and symKey are
   the user's; only the HTML-escaped ampersands are the bug. */
const REPORTED =
  'wc:198a4798c03ddc3bf957dfa262e79539aebc2d789da4528def4ad7eb46beed19@2'
  + '?expiryTimestamp=1789475199&amp;relay-protocol=irn'
  + '&amp;symKey=7cc8ed0d3846aab9a30ad0c86eeef40e7964eddd31909581bd4ee3ebd156fad5';
const REPORTED_HEALTHY = REPORTED.replace(/&amp;/g, '&');

const TRUST = MOBILE_WALLETS.find((w) => w.key === 'trust');
const TRUST_WALLET_OBJECT = {
  id: TRUST.id,
  name: 'Trust Wallet',
  mobile_link: 'trust://',
  link_mode: null
};

/**
 * Drive the REAL SDK in a CHILD process.
 *
 * A child process because `Core.start()` installs heartbeat/expirer timers —
 * in-process they would outlive the probe and hang the suite. This also makes
 * the claim stronger: a fresh process, the shipped SDK, nothing stubbed except
 * the relay transport (this probe is offline by design and must not publish).
 */
function measurePairingUri() {
  const script = `
import { Core } from '@walletconnect/core';
const core = new Core({ projectId: '8e36eccabebf5a4567f4e974fafd6b20', relayUrl: 'wss://relay.walletconnect.com' });
for (const m of ['connect', 'transportOpen', 'subscribe', 'publish', 'restartTransport', 'transportClose']) {
  if (typeof core.relayer[m] === 'function') core.relayer[m] = async () => (m === 'subscribe' ? 'topic' : undefined);
}
await core.start();
const { uri } = await core.pairing.create();
const escaped = uri.replace(/&/g, '&amp;');
const out = { uri, escaped };
try { await core.pairing.pair({ uri: escaped }); out.escapedPair = 'resolved'; }
catch (e) { out.escapedPair = e.message; }
try { await core.pairing.pair({ uri }); out.cleanPair = 'resolved'; }
catch (e) { out.cleanPair = e.message; }
console.log('PROBE_JSON ' + JSON.stringify(out));
process.exit(0);
`;
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120_000
  });
  const line = raw.split('\n').find((l) => l.startsWith('PROBE_JSON '));
  if (!line) throw new Error('the SDK child process produced no result');
  return JSON.parse(line.slice('PROBE_JSON '.length));
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. the reported string is an SDK pairing URI with escaped `&` ---- */
  const sdk = measurePairingUri();
  t('the SDK generates the reported shape (alphabetical params, @2, irn)',
    /^wc:[0-9a-f]{64}@2\?expiryTimestamp=\d+&relay-protocol=irn&symKey=[0-9a-f]{64}$/.test(sdk.uri));
  t('the SDK NEVER escapes: every separator is a plain `&`',
    !sdk.uri.includes('&amp;') && sdk.uri.split('&').length === 3);
  t('the reported string is that shape, escaped',
    sdk.escaped === sdk.uri.replace(/&/g, '&amp;') && REPORTED.includes('&amp;relay-protocol=irn'));

  /* ---- 2. the damage is fatal, measured on the SDK's own pair() ---- */
  t('the SDK REJECTS the escaped URI (no pairing can ever be made from it)',
    sdk.escapedPair === 'Missing or invalid. pair() uri#relay-protocol');
  t('the same call succeeds once the `&`s are restored',
    sdk.cleanPair === 'resolved');

  /* ---- 3. repairPairingUri: restores, never invents ---- */
  t('`&amp;` is restored to `&`',
    repairPairingUri(REPORTED) === REPORTED_HEALTHY);
  t('a healthy pairing URI passes through unchanged (bytes, not just value)',
    repairPairingUri(REPORTED_HEALTHY) === REPORTED_HEALTHY);
  t('repair is idempotent',
    repairPairingUri(repairPairingUri(REPORTED)) === REPORTED_HEALTHY);
  t('the numeric entity twins are restored too',
    repairPairingUri(REPORTED_HEALTHY.replace(/&/g, '&#38;')) === REPORTED_HEALTHY
      && repairPairingUri(REPORTED_HEALTHY.replace(/&/g, '&#x26;')) === REPORTED_HEALTHY);
  t('a damaged URI is still RECOGNISED as a pairing URI (tolerant detector)',
    looksLikePairingUri(REPORTED) && looksLikePairingUri(REPORTED_HEALTHY));
  t('a non-pairing string is never rewritten',
    ['https://link.trustwallet.com/?a=1&amp;b=2', 'market://details?id=x', 'trust://']
      .every((u) => repairPairingUri(u) === u));

  /* ---- 4. repairPairingInUrl: the deep-link form, byte-faithful when clean ---- */
  const encodedDamaged = `trust://wc?uri=${encodeURIComponent(REPORTED)}`;
  const encodedClean = `trust://wc?uri=${encodeURIComponent(REPORTED_HEALTHY)}`;
  t('an escaped payload inside a `uri=` param is decoded, repaired, re-encoded once',
    repairPairingInUrl(encodedDamaged) === encodedClean);
  t('…and a payload that was never encoded is repaired as well',
    repairPairingInUrl(`trust://wc?uri=${REPORTED}`) === encodedClean);
  t('a HEALTHY deep link is returned byte-for-byte (no re-encoding, ever)',
    repairPairingInUrl(encodedClean) === encodedClean
      && repairPairingInUrl(`https://link.trustwallet.com/wc?uri=${encodeURIComponent(REPORTED_HEALTHY)}`)
        === `https://link.trustwallet.com/wc?uri=${encodeURIComponent(REPORTED_HEALTHY)}`);
  t('a URL that carries no pairing payload is left alone',
    repairPairingInUrl('https://example.com/?uri=https%3A%2F%2Fx.test') === 'https://example.com/?uri=https%3A%2F%2Fx.test');

  /* ---- 5. the links we build are never escaped and never double-encoded ---- */
  const healedLink = walletLink(TRUST.universal, REPORTED);
  const healedNative = walletLink(TRUST.native, REPORTED);
  t('a link built from a damaged URI carries %26 separators, not &amp;',
    healedLink === `https://link.trustwallet.com/wc?uri=${encodeURIComponent(REPORTED_HEALTHY)}`
      && !healedLink.includes('&amp;') && !healedLink.includes('&'));
  t('…exactly one encoding level in both native and universal forms',
    healedLink.includes(encodeURIComponent('%26')) === false
      && healedLink.includes(encodeURIComponent(REPORTED_HEALTHY))
      && healedNative === `trust://wc?uri=${encodeURIComponent(REPORTED_HEALTHY)}`);

  /* ---- 6. a bare `wc:` URI is completed for the tapped wallet, never guessed ---- */
  forgetTappedWallet();
  const bare = decideWalletOpen(REPORTED);
  t('a bare pairing URI with no tapped wallet is NOT guessed into a wallet link',
    bare.action === 'pass' && bare.url === null);

  rememberTappedWallet(TRUST_WALLET_OBJECT);
  const completed = decideWalletOpen(REPORTED);
  t('with a tapped wallet, the bare URI becomes that wallet\'s native link',
    completed.action === 'open'
      && completed.url === healedNative
      && completed.fallbackUrl === healedLink
      && completed.pairingUri === REPORTED_HEALTHY);
  t('…and it is flagged as both repaired and rewritten',
    completed.repaired === true && completed.rewritten === true && completed.wallet?.key === 'trust');
  const completedClean = decideWalletOpen(REPORTED_HEALTHY);
  t('a healthy bare URI reports repaired:false (the flag stays honest)',
    completedClean.url === healedNative && completedClean.repaired === false);

  const damagedDeepLink = decideWalletOpen(`trust://wc?uri=${encodeURIComponent(REPORTED)}`);
  t('an escaped custom-scheme link is repaired but remains native-first',
    damagedDeepLink.action === 'open'
      && damagedDeepLink.url === healedNative
      && damagedDeepLink.fallbackUrl === healedLink
      && damagedDeepLink.repaired === true);
  t('AppKit\'s own links are still never touched',
    decideWalletOpen('https://reown.com/').action === 'pass'
      && decideWalletOpen('market://details?id=com.trustwallet.app').action === 'pass');

  /* ---- 7. the bridge delivers the completed link (not the raw URI) ---- */
  {
    const delivered = [];
    const calls = [];
    const win = { open: (...args) => { calls.push(args); return {}; } };
    const uninstall = installWalletOpenBridge({
      win,
      openWallet: (url, opts) => delivered.push([url, opts])
    });
    win.open(REPORTED, '_self', 'noreferrer noopener');
    t('the bridge delivers the native link plus HTTPS fallback for a bare pairing URI',
      delivered.length === 1
        && delivered[0][0] === healedNative
        && delivered[0][1].fallbackUrl === healedLink
        && delivered[0][1].pairingUri === REPORTED_HEALTHY
        && delivered[0][1].walletPackage === 'com.wallet.crypto.trustapp');
    t('…and reports `repaired`, so diagnostics can name what it saw',
      delivered[0][1].repaired === true);
    t('…while AppKit\'s own links still reach the original opener',
      (win.open('https://reown.com/', '_self'), calls.length === 1));
    uninstall();
  }

  /* ---- 8. the wallet is recorded at the SDK's own hand-off ---- */
  {
    const { ConnectionController, ConnectionControllerUtil, OptionsController } =
      await import('@reown/appkit-controllers');
    const saved = {
      window: globalThis.window,
      document: globalThis.document,
      navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    };
    const win = {
      open: () => ({}),
      location: { href: 'https://fbtswap.ir/', origin: 'https://fbtswap.ir', assign() {} },
      addEventListener() {},
      removeEventListener() {}
    };
    globalThis.window = win;
    globalThis.document = {
      createElement: () => ({ setAttribute() {}, click() {}, style: {} }),
      addEventListener() {},
      removeEventListener() {}
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' },
      configurable: true
    });
    try {
      const { installAppKitLinkModePatch } = await import('../src/lib/wcAppKitPatch.js');
      t('the link-mode patch installs against the real controllers package',
        (await installAppKitLinkModePatch()) === true);
      ConnectionController.setUri(REPORTED_HEALTHY);
      OptionsController.setPreferUniversalLinks(true);
      forgetTappedWallet();
      ConnectionControllerUtil.onConnectMobile(TRUST_WALLET_OBJECT);
      t('the real onConnectMobile() call records WHICH wallet is being handed the pairing',
        lastTappedWallet()?.key === 'trust');
      ConnectionControllerUtil.onConnectMobile({ id: 'unknown', name: 'Other', mobile_link: 'other://' });
      t('an unknown wallet clears the record — no stale wallet is reused',
        lastTappedWallet() === null);
    } finally {
      if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
      if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
      if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
    }
  }

  /* ---- 9. wiring (static: this whole class of bug is wiring) ---- */
  {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(readFileSync('src/lib/wcDeepLink.js', 'utf8'));
    t('decideWalletOpen repairs the URL before applying any rule',
      code.indexOf('repairPairingInUrl(incoming)') > -1
        && code.indexOf('repairPairingInUrl(incoming)') < code.indexOf('carriesPairingUri(text)'));
    const patch = strip(readFileSync('src/lib/wcAppKitPatch.js', 'utf8'));
    t('the AppKit patch records the tapped wallet inside its wrapper',
      /rememberTappedWallet\(wallet\)/.test(patch)
        && patch.indexOf('rememberTappedWallet(wallet)') < patch.indexOf('return original.call('));
    const ctx = strip(readFileSync('src/context/WalletContext.jsx', 'utf8'));
    t('WalletContext traces a repaired URI as its own fact',
      /wcEvent\('deeplink_uri_repaired'\)/.test(ctx));
  }

  return rows;
}
