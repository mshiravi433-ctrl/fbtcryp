/**
 * WALLETCONNECT MOBILE HAND-OFF PROBE
 * ---------------------------------------------------------------------------
 * A successful app launch is not a successful pairing. HTTPS redirectors can
 * open a wallet after dropping `uri=wc:…`, producing the reported Trust and
 * Uniswap home screens with no Connect proposal. This probe locks the current
 * last-mile contract: native first, universal fallback, raw URI + exact package
 * for the packaged Android application, and a live dapp page underneath.
 */
import { readFileSync } from 'node:fs';
import {
  decideWalletOpen,
  installWalletOpenBridge,
  pairingUriFromWalletLink,
  splitUrl,
  universalForWalletLink
} from '../src/lib/wcDeepLink.js';

const URI =
  'wc:7f6e4f2c1c9b4a4f9e2f1a0b3c4d5e6f9e2f1a0b3c4d5e6f9e2f1a0b3c4d5e6f@2'
  + '?relay-protocol=irn&symKey=9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';
const ENCODED = encodeURIComponent(URI);
const TRUST_NATIVE = `trust://wc?uri=${ENCODED}`;
const TRUST_HTTPS = `https://link.trustwallet.com/wc?uri=${ENCODED}`;
const TRUST_WALLET = {
  id: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
  name: 'Trust Wallet',
  mobile_link: 'trust://',
  link_mode: null
};

/** Minimal browser globals required by the real AppKit controllers package. */
function withBrowserGlobals(fn) {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  };
  const opened = [];
  const win = {
    open: (...args) => { opened.push(args); return {}; },
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
    value: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile' },
    configurable: true
  });
  return Promise.resolve()
    .then(() => fn(win, opened))
    .finally(() => {
      if (saved.window === undefined) delete globalThis.window;
      else globalThis.window = saved.window;
      if (saved.document === undefined) delete globalThis.document;
      else globalThis.document = saved.document;
      if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
    });
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. pure URL decisions -------------------------------------------- */
  t('splitUrl preserves the encoded pairing payload byte-for-byte',
    splitUrl(TRUST_NATIVE)?.rest === `wc?uri=${ENCODED}`);
  t('the universal fallback builder preserves the same payload',
    universalForWalletLink(TRUST_NATIVE) === TRUST_HTTPS);
  t('a wallet link decodes to the raw pairing URI exactly once',
    pairingUriFromWalletLink(TRUST_NATIVE) === URI
      && pairingUriFromWalletLink(TRUST_HTTPS) === URI);

  const nativeDecision = decideWalletOpen(TRUST_NATIVE);
  t('a native wallet hand-off is intercepted without being rewritten',
    nativeDecision.action === 'open'
      && nativeDecision.url === TRUST_NATIVE
      && nativeDecision.rewritten === false);
  t('the decision carries HTTPS fallback, raw pairing URI and Android package',
    nativeDecision.fallbackUrl === TRUST_HTTPS
      && nativeDecision.pairingUri === URI
      && nativeDecision.wallet?.androidPackage === 'com.wallet.crypto.trustapp');

  const httpsDecision = decideWalletOpen(TRUST_HTTPS);
  t('a known universal hand-off is normalized BACK to the native route',
    httpsDecision.action === 'open'
      && httpsDecision.url === TRUST_NATIVE
      && httpsDecision.fallbackUrl === TRUST_HTTPS
      && httpsDecision.rewritten === true);
  t('ordinary HTTPS, in-page schemes and store links are untouched',
    decideWalletOpen('https://reown.com/').action === 'pass'
      && ['blob:https://fbtswap.ir/x', 'data:text/html,x', 'about:blank']
        .every((u) => decideWalletOpen(u).action === 'pass')
      && decideWalletOpen('market://details?id=com.trustwallet.app').action === 'pass');

  /* ---- 2. window.open bridge -------------------------------------------- */
  {
    const originalCalls = [];
    const delivered = [];
    const win = { open: (...args) => { originalCalls.push(args); return {}; } };
    const uninstall = installWalletOpenBridge({
      win,
      openWallet: (url, opts) => delivered.push([url, opts])
    });
    win.open(TRUST_HTTPS, '_self', 'noreferrer noopener');
    win.open('https://reown.com/', '_self');
    t('the bridge delivers the native URL even when AppKit supplied HTTPS',
      delivered.length === 1 && delivered[0][0] === TRUST_NATIVE);
    t('the bridge forwards the complete channel-aware hand-off metadata',
      delivered[0][1].fallbackUrl === TRUST_HTTPS
        && delivered[0][1].pairingUri === URI
        && delivered[0][1].walletPackage === 'com.wallet.crypto.trustapp'
        && delivered[0][1].target === '_self');
    t('non-wallet links still use the original opener',
      originalCalls.length === 1 && originalCalls[0][0] === 'https://reown.com/');
    t('the delivery channel receives the ORIGINAL opener (no recursion)',
      typeof delivered[0][1].openWindow === 'function'
        && delivered[0][1].openWindow !== win.open);

    const bridged = win.open;
    uninstall();
    t('uninstall restores window.open exactly', win.open !== bridged);
    win.open(TRUST_NATIVE, '_self');
    t('after uninstall the native URL passes through unchanged',
      originalCalls.at(-1)?.[0] === TRUST_NATIVE);

    const fallbackCalls = [];
    const win2 = { open: (...args) => { fallbackCalls.push(args); return {}; } };
    const un2 = installWalletOpenBridge({
      win: win2,
      openWallet: () => { throw new Error('delivery channel down'); }
    });
    win2.open(TRUST_HTTPS, '_self');
    t('a throwing delivery layer fails open to the native URL, not a dead tap',
      fallbackCalls.length === 1 && fallbackCalls[0][0] === TRUST_NATIVE);
    un2();
  }

  /* ---- 3. installed AppKit behavior ------------------------------------- */
  await withBrowserGlobals(async (_win, opened) => {
    const { ConnectionController, ConnectionControllerUtil, OptionsController } =
      await import('@reown/appkit-controllers');
    ConnectionController.setUri(URI);
    OptionsController.setPreferUniversalLinks(false);

    ConnectionControllerUtil.onConnectMobile(TRUST_WALLET);
    t('the real SDK chooses Trust native when universal preference is off',
      opened.length === 1 && opened[0][0] === TRUST_NATIVE);

    opened.length = 0;
    const { installAppKitLinkModePatch } = await import('../src/lib/wcAppKitPatch.js');
    t('the link-mode compatibility patch installs idempotently',
      (await installAppKitLinkModePatch()) === true
        && (await installAppKitLinkModePatch()) === true);
    ConnectionControllerUtil.onConnectMobile(TRUST_WALLET);
    t('adding an HTTPS fallback does not override the native-first policy',
      opened.length === 1 && opened[0][0] === TRUST_NATIVE);
    t('the explorer wallet object is not mutated in place', TRUST_WALLET.link_mode === null);

    /* Telegram can opt into the fallback without rebuilding or re-encoding it. */
    opened.length = 0;
    OptionsController.setPreferUniversalLinks(true);
    ConnectionControllerUtil.onConnectMobile(TRUST_WALLET);
    t('the same patched entry retains the exact HTTPS fallback for restricted channels',
      opened.length === 1 && opened[0][0] === TRUST_HTTPS);
    OptionsController.setPreferUniversalLinks(false);

    opened.length = 0;
    ConnectionControllerUtil.onConnectMobile({
      id: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
      name: 'MetaMask',
      mobile_link: 'metamask://',
      link_mode: null
    });
    t('MetaMask follows the same native-first path (no wallet special case)',
      opened[0]?.[0] === `metamask://wc?uri=${ENCODED}`);
  });

  /* ---- 4. actual delivery channels -------------------------------------- */
  {
    const { openWalletLink, walletHandOffChannel } = await import('../src/lib/browser.js');
    const makeWin = ({ openReturns = {} } = {}) => {
      const opened = [];
      const assigned = [];
      const clicked = [];
      return {
        opened,
        assigned,
        clicked,
        win: {
          open: (...args) => { opened.push(args); return openReturns; },
          location: { assign: (u) => assigned.push(u) },
          document: {
            createElement: () => ({
              style: {},
              click() { clicked.push(this.href); },
              remove() {}
            }),
            body: { appendChild: () => {} }
          }
        }
      };
    };

    const browser = makeWin();
    await openWalletLink(TRUST_NATIVE, {
      target: '_self', win: browser.win, fallbackUrl: TRUST_HTTPS
    });
    t('mobile web opens the native scheme in a NEW tab/context',
      browser.opened[0]?.[0] === TRUST_NATIVE && browser.opened[0]?.[1] === '_blank');
    t('the pending dapp document is never navigated away', browser.assigned.length === 0);

    const blocked = makeWin({ openReturns: null });
    const blockedOk = await openWalletLink(TRUST_NATIVE, {
      win: blocked.win, fallbackUrl: TRUST_HTTPS
    });
    t('a blocked scripted window falls back to a real native-link anchor',
      blockedOk === true && blocked.clicked[0] === TRUST_NATIVE && blocked.assigned.length === 0);

    t('channel detection distinguishes web, Telegram and native Android',
      walletHandOffChannel({}) === 'web-native'
        && walletHandOffChannel({ Telegram: { WebApp: { openLink() {} } } }) === 'telegram'
        && walletHandOffChannel({ Capacitor: { isNativePlatform: () => true } }) === 'android-intent');

    const tgOpened = [];
    await openWalletLink(TRUST_NATIVE, {
      fallbackUrl: TRUST_HTTPS,
      win: { Telegram: { WebApp: { openLink: (u) => tgOpened.push(u) } } }
    });
    t('Telegram alone receives the HTTPS universal fallback',
      tgOpened.length === 1 && tgOpened[0] === TRUST_HTTPS);

    const intents = [];
    const androidOk = await openWalletLink(TRUST_NATIVE, {
      fallbackUrl: TRUST_HTTPS,
      pairingUri: URI,
      walletPackage: 'com.wallet.crypto.trustapp',
      win: {
        Capacitor: { isNativePlatform: () => true },
        FBTWalletLink: {
          openWallet: (...args) => { intents.push(args); return true; }
        }
      }
    });
    t('the APK sends raw wc: bytes and the exact wallet package to Android',
      androidOk === true
        && intents.length === 1
        && intents[0][0] === URI
        && intents[0][1] === 'com.wallet.crypto.trustapp');
  }

  /* ---- 5. wiring and Android defense in depth --------------------------- */
  {
    const src = readFileSync('src/context/WalletContext.jsx', 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(src);
    t('WalletContext installs the bridge before connect and removes it in finally',
      code.indexOf('installWalletOpenBridge({') > code.indexOf('await applyAppKitWalletLinks(wc)')
        && code.indexOf('installWalletOpenBridge({') < code.indexOf('wc.connect()')
        && /finally\s*\{[\s\S]{0,160}uninstallWalletBridge/.test(code));
    t('WalletContext explicitly disables global universal-link preference',
      /experimental_preferUniversalLinks:\s*false/.test(code));
    t('the bridge uses the platform-aware opener', /openWalletLink\(url, opts\)/.test(code));

    const main = readFileSync('android/app/src/main/java/ir/fbtswap/app/MainActivity.java', 'utf8');
    const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    t('MainActivity exposes a narrow WalletConnect ACTION_VIEW bridge',
      /"FBTWalletLink"/.test(main)
        && /new Intent\(Intent\.ACTION_VIEW, uri\)/.test(main)
        && /intent\.setPackage\(packageName\)/.test(main));
    t('the native bridge validates wc v2 + symKey and allowlists package/scheme pairs',
      /PAIRING_URI/.test(main)
        && /symKey=\[0-9a-fA-F\]\{64\}/.test(main)
        && /com\.wallet\.crypto\.trustapp/.test(main)
        && /com\.uniswap\.mobile/.test(main));
    t('Android 11 package visibility covers every promoted wallet',
      ['io.metamask', 'com.wallet.crypto.trustapp', 'com.uniswap.mobile', 'io.safepal.wallet', 'me.rainbow']
        .every((pkg) => manifest.includes(`<package android:name="${pkg}" />`)));
  }

  return rows;
}
