/**
 * WALLET DEEP-LINK DELIVERY PROBE — the reported «ارور دیپ لینک»
 * ---------------------------------------------------------------------------
 * The report: tapping **Open** for a wallet in the WalletConnect sheet shows a
 * deep-link error page, in the app AND on the site, and nothing pairs.
 *
 * This probe reproduces the failure against the REAL SDK (no mock of our own
 * code) and then proves the fix changes what leaves the page:
 *
 *   1. `ConnectionControllerUtil.onConnectMobile()` — the single function
 *      AppKit calls when the user taps a wallet on a phone — is driven with the
 *      exact wallet object the SDK's own explorer API returns for Trust Wallet
 *      (`mobile_link: 'trust://'`, `link_mode: null`), with
 *      `experimental_preferUniversalLinks` switched ON, as this app does.
 *      MEASURED: it opens `trust://wc?uri=…` — the custom scheme. `link_mode:
 *      null` means there is no `redirectUniversalLink`, so "prefer universal
 *      links" has nothing to prefer. A custom scheme is navigable from a real
 *      browser and from nothing else; inside a WebView it is the error page the
 *      user photographed.
 *
 *   2. With `installAppKitLinkModePatch()` applied, the same call opens
 *      `https://link.trustwallet.com/wc?uri=…` — Trust's own documented form,
 *      which every context understands.
 *
 *   3. The delivery bridge (`installWalletOpenBridge`) is exercised directly:
 *      a wallet deep link is rewritten and delivered, AppKit's own links are
 *      passed through untouched, the original opener is used for the fallback
 *      (no recursion), and uninstalling restores `window.open` exactly.
 */
import { readFileSync } from 'node:fs';
import {
  decideWalletOpen,
  installWalletOpenBridge,
  splitUrl,
  universalForWalletLink
} from '../src/lib/wcDeepLink.js';

/* A realistic v2 pairing URI: the punctuation is what encoding must preserve. */
const URI = 'wc:7f6e4f2c1c9b4a4f9e2f1a0b3c4d5e6f@2?relay-protocol=irn&symKey=9f8e7d6c5b4a';
const ENCODED = encodeURIComponent(URI);
const TRUST_SCHEME = `trust://wc?uri=${ENCODED}`;
const TRUST_HTTPS = `https://link.trustwallet.com/wc?uri=${ENCODED}`;

/* The wallet object the SDK's explorer API really returns (fetched live with
   this project's id: mobile_link `trust://`, link_mode null, id below). */
const TRUST_WALLET = {
  id: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
  name: 'Trust Wallet',
  mobile_link: 'trust://',
  link_mode: null
};

/** Minimal browser globals for the SDK, restored by the caller afterwards. */
function withBrowserGlobals(fn) {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  };
  const opened = [];
  const win = {
    open: (...args) => {
      opened.push(args);
      return {};
    },
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

  /* ---- 1. the pure rules ---- */
  t('splitUrl keeps the payload byte-for-byte',
    splitUrl(TRUST_SCHEME)?.rest === `wc?uri=${ENCODED}`);
  t('splitUrl accepts the slashless form wallets also register',
    splitUrl(`trust:wc?uri=${ENCODED}`)?.rest === `wc?uri=${ENCODED}`);
  t('a known wallet scheme becomes its https universal link',
    universalForWalletLink(TRUST_SCHEME) === TRUST_HTTPS);
  t('MetaMask maps too (no wallet-specific special case)',
    universalForWalletLink(`metamask://wc?uri=${ENCODED}`)
      === `https://metamask.app.link/wc?uri=${ENCODED}`);
  t('an https wallet link is never rewritten (no double encoding)',
    universalForWalletLink(TRUST_HTTPS) === '');
  t('an unknown scheme is not guessed at', universalForWalletLink(`other://wc?uri=${ENCODED}`) === '');

  const trustDecision = decideWalletOpen(TRUST_SCHEME);
  t('a wallet deep link is taken over for delivery',
    trustDecision.action === 'open' && trustDecision.rewritten === true);
  t('…and the URL delivered is the https one', trustDecision.url === TRUST_HTTPS);
  t('AppKit\'s own https links are passed through untouched',
    decideWalletOpen('https://reown.com/').action === 'pass');
  t('in-page schemes are never touched',
    ['blob:https://fbtswap.ir/x', 'data:text/html,x', 'about:blank']
      .every((u) => decideWalletOpen(u).action === 'pass'));
  t('a custom scheme with no pairing payload is left alone',
    decideWalletOpen('market://details?id=com.trustwallet.app').action === 'pass');
  t('a hand-off already on the wallet\'s https host is delivered as-is',
    decideWalletOpen(TRUST_HTTPS).url === TRUST_HTTPS
      && decideWalletOpen(TRUST_HTTPS).rewritten === false);

  /* ---- 2. the bridge itself ---- */
  {
    const calls = [];
    const delivered = [];
    const win = {
      open: (...args) => {
        calls.push(args);
        return {};
      }
    };
    const uninstall = installWalletOpenBridge({
      win,
      openWallet: (url, opts) => delivered.push([url, opts])
    });
    win.open(TRUST_SCHEME, '_self', 'noreferrer noopener');
    win.open('https://reown.com/', '_self');
    t('the bridge rewrites and delivers a wallet deep link',
      delivered.length === 1 && delivered[0][0] === TRUST_HTTPS && delivered[0][1].rewritten === true);
    t('the bridge keeps the target and features AppKit asked for',
      delivered[0][1].target === '_self' && delivered[0][1].features === 'noreferrer noopener');
    t('the bridge passes AppKit\'s own link to the original opener',
      calls.length === 1 && calls[0][0] === 'https://reown.com/');
    t('the delivery channel receives the ORIGINAL opener (no recursion)',
      typeof delivered[0][1].openWindow === 'function'
      && delivered[0][1].openWindow !== win.open);
    const bridged = win.open;
    uninstall();
    t('uninstalling restores window.open exactly', win.open !== bridged);
    win.open(TRUST_SCHEME, '_self');
    t('…and after uninstall a wallet deep link is no longer rewritten',
      calls[calls.length - 1][0] === TRUST_SCHEME);

    /* An opener that throws must fall back to the original call, never to a
       silent dead tap. */
    const fallbackCalls = [];
    const win2 = { open: (...args) => { fallbackCalls.push(args); return {}; } };
    const un2 = installWalletOpenBridge({
      win: win2,
      openWallet: () => {
        throw new Error('delivery channel down');
      }
    });
    win2.open(TRUST_SCHEME, '_self');
    t('a throwing opener degrades to the original window.open',
      fallbackCalls.length === 1 && fallbackCalls[0][0] === TRUST_HTTPS);
    un2();
  }

  /* ---- 3. the REAL SDK, driven end to end ---- */
  await withBrowserGlobals(async (win, opened) => {
    const { ConnectionController, ConnectionControllerUtil, OptionsController } =
      await import('@reown/appkit-controllers');

    ConnectionController.setUri(URI);
    OptionsController.setPreferUniversalLinks(true);

    /* (a) the reported failure, measured against the real SDK */
    ConnectionControllerUtil.onConnectMobile(TRUST_WALLET);
    t('BEFORE the patch the SDK opens the custom scheme (the reported bug)',
      opened.length === 1 && opened[0][0] === TRUST_SCHEME);
    t('…which is exactly what a WebView cannot navigate to',
      /^trust:\/\//.test(opened[0][0]));

    /* (b) the same call, with the fix installed */
    opened.length = 0;
    const { installAppKitLinkModePatch } = await import('../src/lib/wcAppKitPatch.js');
    t('the link-mode patch installs against the real controllers package',
      (await installAppKitLinkModePatch()) === true);
    t('installing twice is a no-op (idempotent)', (await installAppKitLinkModePatch()) === true);

    ConnectionControllerUtil.onConnectMobile(TRUST_WALLET);
    t('AFTER the patch the same tap opens Trust\'s https link',
      opened.length === 1 && opened[0][0] === TRUST_HTTPS);
    t('the wallet object itself is not mutated in place',
      TRUST_WALLET.link_mode === null);

    /* (c) a wallet the patch cannot know about is untouched by it */
    opened.length = 0;
    ConnectionControllerUtil.onConnectMobile({ id: 'unknown', name: 'Other', mobile_link: 'other://' });
    t('an unknown wallet is passed through unchanged (no invented links)',
      opened.length === 1 && opened[0][0] === `other://wc?uri=${ENCODED}`);

    /* (d) MetaMask, the other wallet in the report */
    opened.length = 0;
    ConnectionControllerUtil.onConnectMobile({
      id: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
      name: 'MetaMask',
      mobile_link: 'metamask://',
      link_mode: null
    });
    t('MetaMask gets its https link too',
      opened.length === 1 && opened[0][0] === `https://metamask.app.link/wc?uri=${ENCODED}`);

    /* (e) a wallet that already carries link_mode keeps ITS value — the patch
       fills a gap, it does not overrule the SDK or the explorer */
    opened.length = 0;
    ConnectionControllerUtil.onConnectMobile({
      ...TRUST_WALLET,
      link_mode: 'https://example.com/'
    });
    t('an object that already has link_mode keeps its own value',
      opened.length === 1 && opened[0][0] === `https://example.com/wc?uri=${ENCODED}`);

    win.open = () => ({}); /* the SDK keeps the reference it captured — harmless */
  });

  /*
   * ---- 4. THE DELIVERY TARGET — the actual cause of the standing report ---
   *
   * The URL was fixed three times and the report never moved, because the URL
   * was not the last thing wrong. `ConnectionControllerUtil.onConnectMobile()`
   * in @reown/appkit-controllers@1.8.19 opens the hand-off with:
   *
   *     const target = CoreHelperUtil.isIframe() ? '_top' : '_self';
   *     CoreHelperUtil.openHref(universalLink, target);
   *
   * `window.open(url, '_self')` REPLACES the current document: the
   * WalletConnect client, its relay socket and the pending connect() promise
   * all die in the same instant the wallet opens. The approval the user then
   * taps in Trust is published to a relay nobody is listening to any more, and
   * the tab is left on the wallet's own "download the app" page. Every byte of
   * the URL was correct and the connection still could not complete.
   *
   * So these assertions drive the REAL `openWalletLink()` (no mock of our own
   * code) against a fake window and lock the rule: a wallet hand-off never
   * navigates the page it was called from.
   */
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
          open: (...args) => {
            opened.push(args);
            return openReturns;
          },
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

    const a = makeWin();
    await openWalletLink(TRUST_HTTPS, { target: '_self', win: a.win });
    t('a hand-off asked for as _self is opened in a NEW tab instead',
      a.opened.length === 1 && a.opened[0][1] === '_blank');
    t('…and this document is never navigated to the wallet link',
      a.assigned.length === 0);

    const b = makeWin();
    await openWalletLink(TRUST_HTTPS, { target: '_top', win: b.win });
    t('_top is refused for the same reason', b.opened[0]?.[1] === '_blank');

    const c = makeWin();
    await openWalletLink(TRUST_HTTPS, { win: c.win });
    t('the default target is _blank (Trust\'s own documented call)',
      c.opened[0]?.[1] === '_blank');

    /* A pop-up blocker returns null from window.open. The old code answered
       with location.assign() — i.e. it destroyed the pairing to look useful.
       The new code clicks a real anchor, which a blocker does not apply to. */
    const d = makeWin({ openReturns: null });
    const dOk = await openWalletLink(TRUST_HTTPS, { win: d.win });
    t('a blocked pop-up falls back to a real anchor click…',
      dOk === true && d.clicked.length === 1 && d.clicked[0] === TRUST_HTTPS);
    t('…and still never navigates this page', d.assigned.length === 0);

    const e = makeWin({ openReturns: null });
    e.win.document = undefined; /* no anchor possible either */
    const eOk = await openWalletLink(TRUST_HTTPS, { win: e.win });
    t('with nothing left it reports failure instead of killing the pairing',
      eOk === false && e.assigned.length === 0);

    /* The channel picker decides when the sheet must take over from the
       anchor: only where an anchor cannot leave the context at all. */
    t('the open web is left to the anchor',
      walletHandOffChannel({}) === 'web');
    t('Telegram takes its own opener',
      walletHandOffChannel({ Telegram: { WebApp: { openLink: () => {} } } }) === 'telegram');
    t('the packaged app takes Custom Tabs',
      walletHandOffChannel({ Capacitor: { isNativePlatform: () => true } }) === 'custom-tabs');
    const tgOpened = [];
    await openWalletLink(TRUST_HTTPS, {
      win: { Telegram: { WebApp: { openLink: (u) => tgOpened.push(u) } } }
    });
    t('inside Telegram the hand-off goes through Telegram\'s opener',
      tgOpened.length === 1 && tgOpened[0] === TRUST_HTTPS);
  }

  /* ---- 5. WalletContext wiring (static: the failure class is wiring) ---- */
  {
    const src = readFileSync('src/context/WalletContext.jsx', 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(src);
    t('WalletContext installs the delivery bridge',
      /installWalletOpenBridge\(\{/.test(code));
    t('…before connect(), so the very first tap is covered',
      code.indexOf('installWalletOpenBridge({') > code.indexOf('await applyAppKitWalletLinks(wc)')
      && code.indexOf('installWalletOpenBridge({') < code.indexOf('wc.connect()'));
    t('…and removes it in the finally block (no session-long rewrite)',
      /finally\s*\{[\s\S]{0,160}uninstallWalletBridge/.test(code));
    t('the link-mode patch is installed where the modal options are applied',
      /await installAppKitLinkModePatch\(\)/.test(code));
    t('the bridge delivered through the app\'s own opener, not raw window.open',
      /openWalletLink\(url, opts\)/.test(code));
    t('WalletContext takes the wallet table from lib/wcWallets',
      /from '\.\.\/lib\/wcWallets(\.js)?'/.test(code));
  }

  return rows;
}
