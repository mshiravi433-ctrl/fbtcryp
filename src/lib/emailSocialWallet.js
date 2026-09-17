/**
 * EMAIL & SOCIAL LOGIN — Reown AppKit embedded wallet, alongside WalletConnect
 * ---------------------------------------------------------------------------
 * THE FEATURE: let a user connect with an email address or a social account
 * (Google, Apple, X, …) instead of an installed wallet. AppKit provisions a
 * non-custodial embedded wallet behind that login, and the rest of the app
 * talks to it through the exact same EIP-1193 → ethers BrowserProvider path
 * an injected wallet already uses — so swap, send and signing code need no
 * special case for it.
 *
 * ─── WHY A SECOND AppKit INSTANCE, AND WHY IT IS SAFE HERE ─────────────────
 * The WalletConnect modal in this app is created by `@walletconnect/
 * ethereum-provider` itself, and that provider HARD-disables authentication
 * wallets: its options contain a literal `features: { email: false,
 * socials: false }` (measured in dist/index.js of 2.25.0). It has to: a
 * `wc.connect()` promise can only settle on a WalletConnect session, and an
 * email login never becomes one. So email/social cannot be turned on *in
 * that modal* — it needs its own `createAppKit()` with the ethers adapter.
 *
 * Two instances on one page share the controllers SINGLETONS
 * (OptionsController, PublicStateController) and the one `<w3m-modal>`
 * element (AppKit guards its creation with `querySelector('w3m-modal')` —
 * measured above in the same package). That sharing is safe ONLY under one
 * rule, and it is the contract this module and WalletContext enforce:
 *
 *   EVERY surface re-asserts its own `features` immediately before opening
 *   its modal. This file asserts `{ email: true, socials: […],
 *   emailShowWallets: false }`; WalletContext's applyAppKitWalletLinks()
 *   asserts `{ email: false, socials: false }` before a WalletConnect open,
 *   because on that surface an email row would hang the pairing promise.
 *
 * ─── WHY THE VERSION IS PINNED TO 1.8.19 ───────────────────────────────────
 * `@walletconnect/ethereum-provider@2.25.0` (already the latest) depends on
 * exactly `@reown/appkit@1.8.19`. Depending on the SAME exact version keeps
 * one copy of every `@reown/*` singleton in the dependency tree. Two copies
 * would give each instance its own private controllers — the features
 * re-assertion above would stop working, and both copies would try to
 * define the same `w3m-*` custom elements. "Latest AppKit" here would buy
 * exactly those conflicts, which is why the pin is deliberate.
 *
 * ─── WHAT THE DASHBOARD CONTROLS THAT THIS CODE CANNOT ─────────────────────
 * The Project ID in WalletContext identifies the project; the email OTP /
 * OAuth backends only serve projects whose Dashboard has "Email & Social"
 * enabled and whose Allowed Domains cover the runtime origin
 * (https://fbtswap.ir, and https://localhost inside the packaged APK). The
 * Dashboard/API secrets belong to the Dashboard and server code only — never
 * to this bundle.
 *
 * Only the pure helpers are tested directly (test/email-social-probe.mjs);
 * `getEmailSocialAppKit()` is the single impure edge, lazy by design so the
 * first paint never pays for a modal most sessions never open.
 */

import { EVM_CHAINS, DEFAULT_CHAIN } from './chains.js';

/**
 * Boot marker for the silent restore. A returning email/social user has no
 * `wc@2:` session for restoreWcSession's probe to find, so this one flag is
 * what keeps first paint free of the AppKit chunk for everyone else: only
 * its presence lazily initialises the embedded-wallet instance. It stores
 * no address, no token, nothing identifiable — AppKit keeps its own auth
 * session under `@appkit-wallet/` and re-derives the account from it.
 *
 * ITS LIFETIME IS DELIBERATELY WIDER THAN A PROVEN ACCOUNT. Email OTP and
 * social OAuth are redirect-shaped on mobile: the browser leaves the site to
 * verify and comes back as a FRESH document owning none of the listeners the
 * flow registered. So the marker is claimed when an attempt STARTS — in
 * WalletContext's connectEmailSocial, before the modal opens — which is what
 * routes that returning cold start into restoreEmailSocial(). Every path that
 * ends with nothing to restore hands it back: rollbackEmailSocialMarker()
 * below, restoreEmailSocial()'s own timeout, and clearEmailSocialSession() on
 * disconnect or when another wallet mode attaches. A marker that lies for one
 * boot and self-corrects beats a truth that arrives one page-load too late.
 */
export const EMAIL_SOCIAL_FLAG_KEY = 'fbt_email_social_connected';

/**
 * ─── THE SDK'S OWN LOGIN MARKER, AND WHY THIS MODULE ALSO HAS TO CARRY IT ──
 *
 * `@reown/appkit-wallet@1.8.19` decides whether it may even LOOK for a warm
 * embedded-wallet session from a single localStorage key it writes itself:
 *
 *   W3mFrameProvider constructor (measured, dist/esm/src/W3mFrameProvider.js):
 *
 *     if (this.getLoginEmailUsed()) { this.createFrame(); }
 *     getLoginEmailUsed() => Boolean(W3mFrameStorage.get(EMAIL_LOGIN_USED_KEY))
 *
 * `W3mFrameStorage` is the DAPP's localStorage with the `@appkit-wallet/`
 * prefix, and `setLoginSuccess()` writes that key with the literal `'true'`
 * — but only at the very END of a successful connection (`connect()` /
 * `connectSocial()` after the iframe answers). Two measured consequences:
 *
 *   1. IF THE KEY IS MISSING, THE IFRAME IS NEVER CREATED. `isConnected()`
 *      short-circuits to `{ isConnected: false }` without asking anybody, and
 *      AppKit's own `syncAuthConnector()` then marks the AUTH connector
 *      disconnected and REMOVES the stored namespace. A returning page in
 *      that state can never see the (perfectly healthy) session inside the
 *      secure site: the wallet stays invisible until the user taps the email
 *      button again — the exact «ایمیل تأیید شد، برگشتیم، والت نبود» report.
 *
 *   2. THE SDK DELETES THE KEY ON ANY TRANSIENT FAILURE. `isConnected()`'s
 *      catch — and the not-connected branch — call `deleteAuthLoginCache()`,
 *      which removes `EMAIL_LOGIN_USED_KEY`, `EMAIL`, `LAST_USED_CHAIN_KEY`
 *      and `SOCIAL_USERNAME`. A blocked or slow `secure.walletconnect.org`
 *      (its `appEvent()` waits on the iframe and gives itself 20s) therefore
 *      DESTROYS the dApp's own record of the login. Our marker is the durable
 *      copy of the same fact, so it can hand the key back before the instance
 *      is built; if the session really is gone the iframe answers
 *      `isConnected: false` and the SDK deletes it again — self-correcting,
 *      never a loop.
 *
 * Writing this key is the ONLY way to make the SDK consult a session our
 * marker says exists; it adds no authority of its own (the session still has
 * to exist inside the wallet frame) and stores no address.
 */
export const SDK_LOGIN_USED_KEY = '@appkit-wallet/EMAIL_LOGIN_USED_KEY';
export const SDK_LOGIN_USED_VALUE = 'true';

/**
 * How long a returning cold start waits for AppKit to rehydrate the embedded
 * wallet before it stops looking.
 *
 * IT MUST BE LONGER THAN THE SDK'S OWN BOUND, MEASURED: every frame request
 * awaits `w3mFrame.frameLoadPromise`, and `appEvent()` arms a 20_000 ms
 * `iframeReadyTimeout` before declaring `iframe_load_failed` (and then only
 * for events it does not consider safe). The previous bound here was 8s — a
 * value SMALLER than the SDK's own timeout for the same operation, so a
 * correct-but-slow return (cold WebView, throttled CDN) could never win the
 * race, and the losing branch then ERASED the boot marker: one slow boot
 * turned a healthy session into a permanent one, which is why the documented
 * user workaround was «یک بار دیگر بزن».
 */
export const EMAIL_RESTORE_WINDOW_MS = 30_000;

/** Read the SDK's own login marker (`'true'` after a successful login). */
export function readSdkLoginMarker(storage) {
  const target =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return '';
  try {
    return String(target.getItem(SDK_LOGIN_USED_KEY) || '');
  } catch {
    return '';
  }
}

/**
 * Hand the SDK's login marker back when OUR marker says a login was attempted
 * but the SDK's own record is missing (see the block comment above).
 *
 * @returns {'present'|'rearmed'|'not_marked'|'unavailable'} what happened —
 *   a value the trace can record, never a boolean that hides the reason.
 */
export function rearmSdkLoginMarker(storage) {
  const target =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return 'unavailable';
  if (!hasEmailSocialMarker(target)) return 'not_marked';
  if (readSdkLoginMarker(target)) return 'present';
  try {
    target.setItem(SDK_LOGIN_USED_KEY, SDK_LOGIN_USED_VALUE);
    return 'rearmed';
  } catch {
    return 'unavailable';
  }
}

/**
 * The social OAuth providers AppKit 1.8.19 knows how to render. Order is
 * display order inside the modal's social row.
 */
export const SOCIAL_PROVIDERS = Object.freeze([
  'google',
  'apple',
  'x',
  'facebook',
  'github',
  'discord',
  'farcaster'
]);

/**
 * AppKit network definitions built FROM OUR OWN REGISTRY (lib/chains.js) so
 * the email wallet sees exactly the chains the rest of the app supports —
 * including the curated, geo-friendly RPC order each chain maintains.
 * DEFAULT_CHAIN leads: AppKit treats the first network as the default.
 */
export function buildEmailNetworks() {
  const ids = [
    DEFAULT_CHAIN,
    ...Object.keys(EVM_CHAINS).map(Number).filter((id) => id !== DEFAULT_CHAIN)
  ];
  return ids
    .filter((id) => EVM_CHAINS[id])
    .map((id) => {
      const cfg = EVM_CHAINS[id];
      return {
        id,
        caipNetworkId: `eip155:${id}`,
        chainNamespace: 'eip155',
        name: cfg.name,
        nativeCurrency: {
          name: cfg.native.symbol,
          symbol: cfg.native.symbol,
          decimals: cfg.native.decimals
        },
        /* The embedded wallet's reads go through these nodes; keep the same
           ordering lib/chains.js curated for the app's own providers. */
        rpcUrls: { default: { http: cfg.rpc.slice(0, 3) } },
        blockExplorers: cfg.explorer
          ? { default: { name: cfg.name, url: cfg.explorer } }
          : undefined
      };
    });
}

/**
 * The createAppKit() options for the email/social instance — a PURE
 * function so every isolation flag is locked by test/email-social-probe.mjs:
 *
 *  • `features.emailShowWallets: false` — this modal offers ONLY email and
 *    social logins. The wallet rows are the WalletConnect surface's job;
 *    showing them here would hand a pairing to the one AppKit instance that
 *    was NOT configured with WalletConnect control semantics.
 *  • `enableInjected/enableCoinbase/enableEIP6963/enableWalletConnect` all
 *    false — the same four surfaces the app already owns elsewhere; without
 *    this, the email modal would offer the very flows it exists not to
 *    duplicate.
 *  • `manualWCControl` is NEVER set — that flag belongs to the
 *    ethereum-provider embedding; here connections belong to AppKit.
 */
export function emailSocialOptions(projectId, metadata) {
  const networks = buildEmailNetworks();
  return {
    networks,
    defaultNetwork: networks[0],
    projectId,
    metadata,
    themeMode: 'dark',
    features: {
      email: true,
      socials: [...SOCIAL_PROVIDERS],
      emailShowWallets: false
    },
    /* THE WALLET SURFACE BELONGS TO THE WALLETCONNECT MODAL — measured in
       @reown/appkit-scaffold-ui@1.8.19, w3m-connect-view.walletListTemplate():

             const isEnableWallets = this.enableWallets;   // OptionsController
             if (!isEnableWallets) return null;

       `enableWallets` is a TOP-LEVEL createAppKit option (appkit-base-client:
       `OptionsController.setEnableWallets(options.enableWallets !== false)` —
       DEFAULT TRUE). Without it this modal renders the "Continue with a
       wallet" row and, on mobile, ModalController.open()'s
       `RouterController.reset('AllWallets')` list — rows that CANNOT connect
       here: `ConnectionControllerUtil.onConnectMobile()` is
       `if (wallet?.mobile_link && wcUri)` and this instance never pairs, so
       `wcUri` is undefined and every tap is a SILENT no-op. That dead-end list
       is precisely the «پاپ‌آپ ایمیل گزینهٔ دریافت کیف پول دارد ولی بعدش هیچ
       کیفی وصل نمی‌شود» report. Email and social rows are independent of this
       flag (emailTemplate/socialListTemplate) and stay on. */
    enableWallets: false,
    enableInjected: false,
    enableCoinbase: false,
    enableEIP6963: false,
    enableWalletConnect: false
  };
}

/**
 * The pre-open re-assertION the shared-singleton contract requires (see the
 * header). updateOptions shallow-merges (`Object.assign(state, options)` in
 * OptionsController.setOptions), so passing `features` replaces the object
 * wholesale — a complete, deterministic description of this surface. Returns
 * true when the assertion actually ran (falsy modal → false, so the caller
 * can trace it instead of believing it happened).
 *
 * `manualWCControl` and `enableWallets` are re-asserted here too, because
 * BOTH are shared-singleton state the WalletConnect surface flips:
 *
 *   • manualWCControl:true (set by the ethereum-provider's AppKit) hijacks
 *     this modal's open() — ModalController.open() checks it BEFORE the
 *     requested view and routes MOBILE devices to `AllWallets` regardless of
 *     the `{ view: 'Connect' }` we asked for. That is the report of the email
 *     popup opening on a wallet list instead of the email box.
 *   • enableWallets:true (AppKit's default) renders the wallet rows this
 *     instance can never connect (see emailSocialOptions — onConnectMobile
 *     needs wcUri, which only a WalletConnect pairing creates).
 *
 * Both belong to THIS surface while its modal is open; applyAppKitWalletLinks()
 * asserts the WC values back before any WalletConnect open.
 */
export function reassertEmailFeatures(modal) {
  if (!modal || typeof modal.updateOptions !== 'function') return false;
  modal.updateOptions({
    manualWCControl: false,
    enableWallets: false,
    features: {
      email: true,
      socials: [...SOCIAL_PROVIDERS],
      emailShowWallets: false
    }
  });
  return true;
}


/** Read the boot marker (fake-storage friendly, like lib/wcStorage.js). */
export function hasEmailSocialMarker(storage) {
  const target =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return false;
  try {
    return target.getItem(EMAIL_SOCIAL_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Set ('1') or clear the boot marker. Never throws — storage can be full. */
export function setEmailSocialMarker(on, storage) {
  const target =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) return false;
  try {
    if (on) target.setItem(EMAIL_SOCIAL_FLAG_KEY, '1');
    else target.removeItem(EMAIL_SOCIAL_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand the boot marker back when a connect attempt ended with nothing to
 * restore.
 *
 * connectEmailSocial() claims the marker up front, because a flow that
 * survives can be cut off by the redirect before any attach happens in-page —
 * and the returning document only knows where to look because of that claim.
 * The cost of claiming early is the obligation to un-claim: an attempt the
 * user cancelled (or that threw inside attachEmailProvider) must not leave a
 * returning visitor paying for a restore of a session that does not exist.
 *
 * The rollback is HONEST rather than blind, and that distinction is the whole
 * point of the helper. AppKit's own answer is what decides: if the instance
 * still reports a connected account, the session is real even though THIS
 * attempt failed (an ethers chunk that refused to load, a transient RPC
 * timeout on getNetwork — cases where the next cold start is exactly the
 * recovery the marker exists for), so the marker stays. Only a definitive
 * "nothing is connected" clears it. Returns true when it cleared.
 */
export function rollbackEmailSocialMarker(modal, storage) {
  let connected = false;
  try {
    connected = Boolean(
      modal?.getIsConnectedState?.() && modal?.getAddress?.('eip155')
    );
  } catch {
    connected = false; /* an SDK that cannot answer is not an answer */
  }
  if (connected) return false;
  setEmailSocialMarker(false, storage);
  return true;
}

/* The one live instance. Module-scoped like the WC provider references in
   WalletContext: a second createAppKit() would only re-describe the same
   singletons, so there is exactly one of these per page lifetime. */
let emailAppKit = null;

/**
 * Lazily create (once) and return the email/social AppKit instance.
 *
 * BOTH the root AppKit client and the ethers adapter are dynamic imports —
 * the same deferred pattern the WalletConnect modal uses — so this feature
 * shares chunks with the WalletConnect modal instead of adding a second
 * copy to the first-paint graph. `features` is re-asserted on every call,
 * not just at creation: the WalletConnect surface flattens it before its
 * own opens, and a later email open must not inherit that flattening.
 */
export async function getEmailSocialAppKit(projectId, metadata) {
  /*
   * THE RE-ARM MUST HAPPEN BEFORE createAppKit(), NOT AFTER.
   * `W3mFrameProvider` reads the SDK's login marker in its CONSTRUCTOR to
   * decide whether to create the secure-site iframe at all, and AppKit builds
   * that provider from the OPTIONS while `createAppKit()` runs. Handing the
   * key back afterwards would be one page-load too late — the instance would
   * already have concluded there is nothing to restore. Only when OUR marker
   * is present (an attempt was started, and no other wallet has since
   * retired it) and the SDK's own copy is gone.
   *
   * If the instance ALREADY exists but the SDK marker was missing until we
   * just rearmed it, that instance's frame was born dead — its constructor
   * saw no marker and never created the secure-site iframe. A later
   * `setItem` does not resurrect it; only a new constructor does. So a
   * 'rearmed' result on an existing instance tears it down and recreates it,
   * restoring the frame before the caller waits on subscribeAccount (the
   * 30s restore window). Without this, a single slow-boot transient that
   * deleted the SDK key would make every later restore wait 30s for an
   * event an absent iframe can never emit, then rollback the boot marker and
   * lose the session permanently — the observed email_restore_failed ×2.
   */
  const rearm = rearmSdkLoginMarker();
  if (!emailAppKit) {
    const [{ createAppKit }, { EthersAdapter }] = await Promise.all([
      import('@reown/appkit'),
      import('@reown/appkit-adapter-ethers')
    ]);
    emailAppKit = createAppKit({
      ...emailSocialOptions(projectId, metadata),
      adapters: [new EthersAdapter()]
    });
  } else if (rearm === 'rearmed') {
    // The existing instance was constructed without a frame; recreate.
    try { await emailAppKit.disconnect?.(); } catch { /* best effort */ }
    try { emailAppKit.close?.(); } catch { /* best effort */ }
    // disconnect's deleteAuthLoginCache removes the key we just restored.
    try {
      const target = typeof localStorage !== 'undefined' ? localStorage : null;
      if (target && target.getItem(SDK_LOGIN_USED_KEY) !== SDK_LOGIN_USED_VALUE) {
        target.setItem(SDK_LOGIN_USED_KEY, SDK_LOGIN_USED_VALUE);
      }
    } catch { /* storage unavailable */ }
    emailAppKit = null;
    const [{ createAppKit }, { EthersAdapter }] = await Promise.all([
      import('@reown/appkit'),
      import('@reown/appkit-adapter-ethers')
    ]);
    emailAppKit = createAppKit({
      ...emailSocialOptions(projectId, metadata),
      adapters: [new EthersAdapter()]
    });
  }
  reassertEmailFeatures(emailAppKit);
  return emailAppKit;
}

/** The already-created instance, or null. For paths that must NOT initialise. */
export function emailAppKitIfCreated() {
  return emailAppKit;
}

/**
 * Forget an email/social session: clear our boot marker, and if an instance
 * EXISTS in this page lifetime ask it to disconnect too (bounded — a hung
 * auth frame must never stall a mode switch). Never initialises AppKit just
 * to disconnect it; never throws.
 */
export async function clearEmailSocialSession({
  disconnect = true,
  timeoutMs = 4_000,
  storage
} = {}) {
  setEmailSocialMarker(false, storage);
  const modal = emailAppKit;
  if (!modal || !disconnect || typeof modal.disconnect !== 'function') return true;
  try {
    await Promise.race([
      Promise.resolve(modal.disconnect()).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  } catch {
    /* logout is best-effort; the marker above is the state we own */
  }
  return true;
}
