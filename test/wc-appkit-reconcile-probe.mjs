/**
 * APPKIT PAIRING-STATE RECONCILE PROBE
 * ---------------------------------------------------------------------------
 * The «wallet opens, home screen, no approval prompt» report, measured against
 * the real @reown/appkit-controllers@1.8.19 singleton:
 *
 *   • In `manualWCControl` mode NOTHING resets `ConnectionController.state.
 *     wcUri` between attempts (EthereumProvider.disconnect only tears down a
 *     session; AppKit.close only finalizes). A cancelled attempt leaves the
 *     DEAD pairing topic in AppKit state, and the connecting widget
 *     (`w3m-connecting-wc-mobile`) fires `onConnectMobile` from its
 *     constructor whenever that state is truthy — so the next tap can hand a
 *     wallet a pairing that no longer exists, while the FRESH pairing our
 *     provider published on `display_uri` sits unused (which is why the QR
 *     always connects and the tap sometimes opens nothing).
 *
 *   • The fix under test: WalletContext reports the live pairing URI
 *     (`setLivePairingUri`), and the wrapped `onConnectMobile` points
 *     AppKit's state at it BEFORE the SDK builds the deep link — plus
 *     `resetAppKitPairingState()` clears everything when an attempt settles.
 */
import { JSDOM } from 'jsdom';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* A DOM for the controllers (they touch window/localStorage at import). */
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fbtswap.ir/' });
  const w = dom.window;
  global.window = w;
  global.document = w.document;
  for (const k of ['HTMLElement', 'Element', 'localStorage', 'CustomEvent', 'Node']) {
    if (w[k]) global[k] = w[k];
  }
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: w.localStorage, configurable: true });

  const {
    ConnectionController,
    ConnectionControllerUtil,
    OptionsController
  } = await import('@reown/appkit-controllers');
  const {
    installAppKitLinkModePatch,
    resetAppKitPairingState,
    setLivePairingUri
  } = await import('../src/lib/wcAppKitPatch.js');

  /* The util must be the real SDK one — a renamed export would make every
     assertion below pass vacuously. */
  t('the SDK exports ConnectionControllerUtil.onConnectMobile (signature drift trips every check below)',
    typeof ConnectionControllerUtil.onConnectMobile === 'function');
  t('the SDK exposes ConnectionController.setUri/resetUri/state (the reconcile surface)',
    typeof ConnectionController.setUri === 'function'
      && typeof ConnectionController.resetUri === 'function'
      && typeof ConnectionController.state === 'object');

  /* The patch wraps the singleton ONCE and stays idempotent. */
  const first = await installAppKitLinkModePatch();
  const again = await installAppKitLinkModePatch();
  t('installAppKitLinkModePatch wraps the SDK util and is idempotent', first === true && again === true);

  /* ── THE STALE-URI HAND-OFF, MEASURED ─────────────────────────────────────
     Simulate attempt #1 dying without a session: state.wcUri still names the
     dead pairing. WalletContext publishes the FRESH pairing uri, then the
     user taps a wallet row → the wrapper must hand the SDK the fresh URI. */
  const DEAD_URI = 'wc:deadbeefdeadbeef@2?expiryTimestamp=1&relay-protocol=irn&symKey=aaaa';
  const LIVE_URI = 'wc:1a2b3c4d5e6f7788@2?expiryTimestamp=9999999999&relay-protocol=irn&symKey=bbbb';
  ConnectionController.setUri(DEAD_URI);
  t('reproduction: a dead pairing survives in AppKit state after a failed attempt',
    ConnectionController.state.wcUri === DEAD_URI);

  setLivePairingUri(LIVE_URI);
  const taps = [];
  const realSetUri = ConnectionController.setUri;
  const original = ConnectionControllerUtil.onConnectMobile;
  try {
    /* Observe what the SDK actually reads at hand-off time WITHOUT replacing
       the wrapped util: the reconcile calls the SDK's own setUri, so spying
       there shows both the drift correction and the bytes the link is built
       from (onConnectMobile reads state.wcUri right after it). */
    ConnectionController.setUri = (u) => { taps.push(u); return realSetUri(u); };
    ConnectionControllerUtil.onConnectMobile(
      { id: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', name: 'Trust Wallet', mobile_link: 'trust://' },
      undefined
    );
    t('a tap reconciles AppKit state to the LIVE pairing before the link is built',
      taps.length === 1 && taps[0] === LIVE_URI && ConnectionController.state.wcUri === LIVE_URI);
  } finally {
    ConnectionController.setUri = realSetUri;
    ConnectionControllerUtil.onConnectMobile = original;
  }

  /* When the live URI already matches, the state must be left untouched
     (no needless setUri churn on every tap). */
  let setUriCalls = 0;
  try {
    ConnectionController.setUri = (u) => { setUriCalls += 1; return realSetUri(u); };
    ConnectionControllerUtil.onConnectMobile(
      { id: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', name: 'Trust Wallet', mobile_link: 'trust://' },
      undefined
    );
    t('a matching state is not rewritten on every tap (setUri only on drift)',
      setUriCalls === 0 && ConnectionController.state.wcUri === LIVE_URI);
  } finally {
    ConnectionController.setUri = realSetUri;
  }

  /* No live pairing → the SDK's own behaviour is preserved untouched. */
  setLivePairingUri(null);
  try {
    ConnectionController.setUri(DEAD_URI);
    ConnectionControllerUtil.onConnectMobile(
      { id: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', name: 'Trust Wallet', mobile_link: 'trust://' },
      undefined
    );
    t('with no live pairing recorded, AppKit state is left exactly as the SDK kept it',
      ConnectionController.state.wcUri === DEAD_URI);
  } finally {
    ConnectionController.setUri = realSetUri;
  }

  /* The settle path forgets everything: the live record AND AppKit's stale
     state, so the NEXT attempt's first tap cannot ride a dead topic. */
  setLivePairingUri(LIVE_URI);
  const cleared = await resetAppKitPairingState();
  t('resetAppKitPairingState clears AppKit wcUri and the live record',
    cleared === true && ConnectionController.state.wcUri === undefined);

  /* ── wiring: WalletContext reports the live URI from display_uri and
        forgets it when the attempt settles ───────────────────────────────── */
  const ctx = strip(await (await import('node:fs')).promises.readFile('src/context/WalletContext.jsx', 'utf8'));
  t('WalletContext publishes the live pairing on display_uri (setLivePairingUri)',
    /setLivePairingUri\(uri\)/.test(ctx) && /import \{ installAppKitLinkModePatch, resetAppKitPairingState, setLivePairingUri \}/.test(ctx));
  t('WalletContext clears AppKit pairing state when an attempt settles (finally → resetAppKitPairingState)',
    /void resetAppKitPairingState\(\)/.test(ctx));
  t('the reconcile runs before the SDK builds the link (inside the onConnectMobile wrapper)',
    strip(await (await import('node:fs')).promises.readFile('src/lib/wcAppKitPatch.js', 'utf8')).includes('ConnectionController.setUri(livePairingUri)'));

  /* The email surface must not inherit the WC surface's manualWCControl /
     enableWallets flags (and vice versa) — the other half of the truce. */
  const emailSrc = strip(await (await import('node:fs')).promises.readFile('src/lib/emailSocialWallet.js', 'utf8'));
  t('the email surface re-asserts manualWCControl:false + enableWallets:false before its modal opens',
    /manualWCControl: false/.test(emailSrc) && /enableWallets: false/.test(emailSrc)
      && /reassertEmailFeatures\(emailAppKit\)/.test(emailSrc));
  t('the WalletConnect surface re-asserts manualWCControl:true + enableWallets:true before its modal opens',
    /manualWCControl: true/.test(ctx) && /enableWallets: true/.test(ctx));

  try { OptionsController.resetOptions?.(); } catch { /* older SDKs lack it */ }
  return rows;
}
