/**
 * EMAIL ROUTING PROBE
 * ---------------------------------------------------------------------------
 * The 2026-09-18 report: «when you press the email/social option nothing
 * connects; sometimes it does, but then only the WalletConnect wallet popup
 * (the wallet list) appears and it never attaches to the app».
 *
 * Reproduced against the REAL shipped singletons (@reown/appkit 1.8.19 +
 * @reown/appkit-controllers, jsdom, no bundler): the WalletConnect surface
 * boots its AppKit instance through `@reown/appkit/core` with ZERO adapters,
 * and its `initialize()` writes two flags the SDK has no code to release:
 *
 *   • ChainController.state.noAdapters      = true  (ChainController.initialize([]))
 *   • OptionsController.state.manualWCControl = true (initializeUniversalAdapter)
 *
 * `ModalController.open({ view: 'Connect' })` reads them BEFORE the requested
 * view:
 *
 *     manualWCControl || (noAdapters && !activeCaipAddress)
 *         → 'AllWallets' on mobile / 'ConnectingWalletConnectBasic' on desktop
 *
 * So after ANY WalletConnect use, an email tap whose boot marker still stands
 * (the fresh=false path, which skips the full reset on purpose — it purges
 * state a live frame session is owed) opens the wallet grid instead of the
 * email form. The grid is dead on that surface: its rows need a `wcUri` only
 * a pairing creates, and the email instance pairs nothing. That is the
 * «the WalletConnect popup appears and nothing connects» half; the marker-less
 * (fresh, fully reset) taps are the «sometimes it connects» half.
 *
 * The fix is `assertEmailRouting()` in src/lib/wc/appkit.js, called on every
 * email-surface boot (getAppKit) and again right before the modal opens. This
 * probe locks both the SDK contract the fix relies on (the poison, and the
 * hijack it causes) and the fix itself (the flags released, the Connect view
 * restored, nothing else touched).
 *
 * Standalone:  node test/email-routing-probe.mjs
 * Runner:      imported by test/run.mjs (reuses the runner's DOM, stubs the
 *              fetch boundary for the duration of the run only).
 */

const PROJECT_ID = '5997d5aee8bb42f43ddec4b1a5f94eb1';
const METADATA = {
  name: 'FBT Swap',
  description: 'Non-custodial decentralized exchange',
  url: 'https://fbtswap.ir',
  icons: ['https://fbtswap.ir/icon-512.png'],
  redirect: { universal: 'https://fbtswap.ir' }
};

const EMAIL_NETWORK = {
  id: 56,
  caipNetworkId: 'eip155:56',
  chainNamespace: 'eip155',
  name: 'BNB Smart Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: { default: { http: ['https://bsc-dataseed.binance.org'] } }
};
const EMAIL_DEFAULT_NETWORK = { id: 56, caipNetworkId: 'eip155:56', chainNamespace: 'eip155' };
const EMAIL_FEATURES = {
  email: true,
  socials: ['google', 'apple', 'x', 'facebook', 'github', 'discord', 'farcaster'],
  emailShowWallets: false
};

/* The same shape src/lib/wc/embedded.js#emailOptions() asks for. */
const emailSurfaceOptions = () => ({
  networks: [EMAIL_NETWORK],
  defaultNetwork: EMAIL_DEFAULT_NETWORK,
  projectId: PROJECT_ID,
  metadata: METADATA,
  themeMode: 'dark',
  features: { ...EMAIL_FEATURES },
  enableWallets: false,
  enableInjected: false,
  enableCoinbase: false,
  enableEIP6963: false,
  enableWalletConnect: false
});

/* Standalone installs a full Android browser; under the runner the DOM is
   already installed (a desktop jsdom) and the assertions are written to be
   UA-independent: the poison routes the open SOMEWHERE ELSE, the fix routes
   it back to Connect. */
const STANDALONE = typeof globalThis.document === 'undefined';

async function installStandaloneDom() {
  const { JSDOM } = await import('jsdom');
  const ua =
    'Mozilla/5.0 (Linux; Android 13; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36';
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://fbtswap.ir/',
    userAgent: ua,
    pretendToBeVisual: true
  });
  const { window } = dom;
  for (const key of [
    'document',
    'localStorage',
    'location',
    'history',
    'customElements',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'MessageChannel',
    'MutationObserver',
    'DOMParser',
    'XMLSerializer',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'getComputedStyle'
  ]) {
    try {
      if (!(key in globalThis) || globalThis[key] === undefined) {
        Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
      }
    } catch { /* best effort */ }
  }
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  try {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  } catch { /* Node 21+ navigator is a getter; the default one is fine */ }
  return window;
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const window = STANDALONE ? await installStandaloneDom() : globalThis.window;

  /* ── fetch boundary: every Reown endpoint answers fast and empty, so the
     SDK falls back to its defaults (email stays ON via local features).
     Installed for the duration of the run, restored afterwards — the test
     runner runs real-HTTP probes after this one. */
  const json = (body) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body)
    });
  const stubFetch = async (url) => {
    const u = String(url);
    if (u.includes('/config?') || u.includes('appkit/v1/config')) return json([]);
    if (u.includes('/usage/')) return json({ limit: 0, used: 0, exceeded: false, plan: { name: 'free', hasExceededUsageLimit: false } });
    if (u.includes('/recommended-wallets')) return json([]);
    if (u.includes('/all-wallets')) return json([]);
    if (u.includes('/featured-wallets')) return json([]);
    if (u.includes('/images')) return json({});
    return json([]);
  };
  const origWindowFetch = window.fetch;
  const origGlobalFetch = globalThis.fetch;
  window.fetch = stubFetch;
  globalThis.fetch = stubFetch;

  if (!window.matchMedia) {
    window.matchMedia = (q) => ({
      matches: false,
      media: q,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false
    });
  }
  const needsResizeObserver = !window.ResizeObserver;
  if (needsResizeObserver) {
    window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    globalThis.ResizeObserver = window.ResizeObserver;
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  if (!window.scrollTo) window.scrollTo = () => {};

  /* jsdom brand-checks `signal` in addEventListener options; Node's
     AbortController would fail it (the w3m-modal keyboard listener crashes).
     Strip the signal for the duration of the run only. */
  const ET = window.EventTarget.prototype;
  const origAddListener = ET.addEventListener;
  ET.addEventListener = function (type, fn, opts) {
    if (typeof opts === 'object' && opts !== null) {
      const { capture, once, passive } = opts;
      opts = { capture: Boolean(capture), once: Boolean(once), passive: Boolean(passive) };
    }
    return origAddListener.call(this, type, fn, opts);
  };

  /* Lit's css-tag references the CSSStyleSheet global unconditionally in one
     branch; jsdom has the interface object but not the constructable API. A
     bare class keeps the `in`/`instanceof` checks honest (unsupported path). */
  const hadCSSStyleSheet = 'CSSStyleSheet' in globalThis;
  if (!hadCSSStyleSheet) globalThis.CSSStyleSheet = class CSSStyleSheet {};

  if (!window.crypto?.subtle) {
    const { webcrypto } = await import('node:crypto');
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
  }

  const {
    ChainController,
    RouterController,
    ModalController,
    OptionsController
  } = await import('@reown/appkit-controllers');
  const { createAppKit: createEmailAppKit } = await import('@reown/appkit');
  const { createAppKit: createCoreAppKit } = await import('@reown/appkit/core');
  const { EthersAdapter } = await import('@reown/appkit-adapter-ethers');
  const { assertEmailRouting } = await import('../src/lib/wc/appkit.js');

  /* The shared state the probe will read and restore — snapshot first. */
  const before = {
    noAdapters: ChainController.state.noAdapters,
    manualWCControl: OptionsController.state.manualWCControl,
    enableWallets: OptionsController.state.enableWallets,
    view: RouterController.state.view
  };

  try {
    /* ═══ STEP 1 — cold start, NO WalletConnect yet: email opens Connect ═══ */
    const email = createEmailAppKit({ ...emailSurfaceOptions(), adapters: [new EthersAdapter()] });
    await email.readyPromise.catch(() => {});
    t('a cold email surface leaves noAdapters false', ChainController.state.noAdapters === false);
    t('a cold email surface leaves manualWCControl false', OptionsController.state.manualWCControl === false);
    t('email stays on with the dashboard withheld (local features win)',
      Boolean(OptionsController.state.remoteFeatures?.email));
    email.updateOptions({ manualWCControl: false, enableWallets: false, features: { ...EMAIL_FEATURES } });
    await email.open({ view: 'Connect' }).catch(() => {});
    t('a cold email tap opens the Connect view (the email form)', RouterController.state.view === 'Connect');
    ModalController.close();

    /* ═══ STEP 2 — the user taps WalletConnect: the surface boots adapter-less ═══ */
    const wc = createCoreAppKit({
      networks: [EMAIL_NETWORK],
      defaultNetwork: EMAIL_DEFAULT_NETWORK,
      themeMode: 'dark',
      enableExplorer: true,
      explorerExcludedWalletIds: 'ALL',
      explorerRecommendedWalletIds: 'NONE',
      metadata: METADATA,
      projectId: PROJECT_ID,
      manualWCControl: true
    });
    void wc; /* the instance is the point; the singletons keep its state */
    /* initialize() is async; poll for the full poison instead of a fixed
       sleep (noAdapters lands in initControllers, manualWCControl later, in
       the universal-adapter init). */
    for (
      let i = 0;
      i < 60 && (ChainController.state.noAdapters !== true || OptionsController.state.manualWCControl !== true);
      i += 1
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    t('the adapter-less WC surface latches noAdapters true (the SDK never releases it)',
      ChainController.state.noAdapters === true);
    t('the WC surface claims manualWCControl', OptionsController.state.manualWCControl === true);
    t('the WC surface leaves the wallet list enabled', OptionsController.state.enableWallets === true);

    /* ═══ STEP 3 — WITHOUT the fix: the email tap opens the wallet view ═══
       The re-assert the app performs (updateOptions) clears the Options
       flags, but noAdapters has no setter — the pre-fix outcome. This locks
       the SDK contract the fix relies on: if the SDK ever clears noAdapters
       itself, this row fails and says the fix can be simplified. */
    email.updateOptions({ manualWCControl: false, enableWallets: false, features: { ...EMAIL_FEATURES } });
    await email.open({ view: 'Connect' }).catch(() => {});
    t('without the fix the email tap is hijacked away from Connect',
      RouterController.state.view !== 'Connect');
    t('the hijacked view is the wallet list, not the email form',
      RouterController.state.view === 'AllWallets'
        || RouterController.state.view === 'ConnectingWalletConnectBasic');
    ModalController.close();

    /* ═══ STEP 4 — WITH the fix: assertEmailRouting() restores the surface ═══ */
    const verdict = await assertEmailRouting();
    t('the fix reports a dirty routing state as fixed', verdict === 'fixed');
    t('the one-way noAdapters latch is released', ChainController.state.noAdapters === false);
    t('the WC surface claim on open() routing is released', OptionsController.state.manualWCControl === false);
    t('the email popup does not inherit the wallet list', OptionsController.state.enableWallets === false);
    await email.open({ view: 'Connect' }).catch(() => {});
    t('with the fix the email tap opens the Connect view again', RouterController.state.view === 'Connect');
    t('the email widget can render (feature on, latch released)',
      Boolean(OptionsController.state.remoteFeatures?.email) && ChainController.state.noAdapters === false);
    ModalController.close();
    t('a second assertion on clean state is a no-op that says so',
      (await assertEmailRouting()) === 'clean');

    /* The WalletConnect surface is untouched by the fix's contract: the next
       WC initialize() re-sets the flags for itself. */
    for (let i = 0; i < 60 && ChainController.state.noAdapters === false; i += 1) {
      /* re-boot the WC surface; initialize([]) must set the latch back */
      if (i === 0) {
        const wc2 = createCoreAppKit({
          networks: [EMAIL_NETWORK],
          defaultNetwork: EMAIL_DEFAULT_NETWORK,
          themeMode: 'dark',
          metadata: METADATA,
          projectId: PROJECT_ID,
          manualWCControl: true
        });
        void wc2;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    t('the next WC surface re-sets its own flags (the WC path is unaffected)',
      ChainController.state.noAdapters === true && OptionsController.state.manualWCControl === true);
  } finally {
    /* Restore the fetch boundary and the shared singletons for whatever the
       runner runs after this probe. */
    try {
      ModalController.close();
    } catch { /* not open */ }
    ChainController.state.noAdapters = before.noAdapters;
    OptionsController.state.manualWCControl = before.manualWCControl;
    OptionsController.state.enableWallets = before.enableWallets;
    RouterController.state.view = before.view;
    ET.addEventListener = origAddListener;
    if (window.fetch !== origWindowFetch) window.fetch = origWindowFetch;
    if (globalThis.fetch !== origGlobalFetch) globalThis.fetch = origGlobalFetch;
    if (!hadCSSStyleSheet) delete globalThis.CSSStyleSheet;
  }

  return rows;
}

/* Standalone run: node test/email-routing-probe.mjs */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rows = await run();
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} FAILED of ${rows.length}\n` : `\nAll ${rows.length} email-routing checks passed.\n`);
  process.exit(failed ? 1 : 0);
}
