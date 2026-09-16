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
 */
export const EMAIL_SOCIAL_FLAG_KEY = 'fbt_email_social_connected';

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
    enableInjected: false,
    enableCoinbase: false,
    enableEIP6963: false,
    enableWalletConnect: false
  };
}

/**
 * The pre-open re-assertION the shared-singleton contract requires (see the
 * header). updateOptions shallow-merges, so passing `features` replaces the
 * object wholesale — a complete, deterministic description of this surface.
 * Returns true when the assertion actually ran (falsy modal → false, so the
 * caller can trace it instead of believing it happened).
 */
export function reassertEmailFeatures(modal) {
  if (!modal || typeof modal.updateOptions !== 'function') return false;
  modal.updateOptions({
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
  if (!emailAppKit) {
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
