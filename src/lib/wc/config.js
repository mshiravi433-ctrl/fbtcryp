/**
 * WALLETCONNECT — SHARED FACTS
 * ---------------------------------------------------------------------------
 * One place for the identity and the numbers every wallet prompt, relay probe
 * and timeout in this directory reads. Nothing here is derived at runtime and
 * nothing here depends on the SDK, so the whole stack can be reasoned about
 * (and tested) without booting a client.
 */

import { isNativeShell, publicAppUrl } from '../nativeShell.js';
import { isIOS } from '../platform.js';

/**
 * The Reown (WalletConnect) project id.
 *
 * A constant in source, deliberately NOT an environment variable. The id is
 * public by design — it ships in every client bundle — so there is nothing to
 * hide. What burned this app was the opposite: three build pipelines (Vercel,
 * the APK workflow, local dev) each read their own copy of
 * VITE_WALLETCONNECT_PROJECT_ID, and a stale value in any one of them shipped
 * an OLD project whose dashboard allowlist named a retired domain. The relay
 * then refused and nothing in the code could explain it, because the code was
 * correct — the environment wasn't.
 *
 * Same rule as publicAppUrl(): production identity lives in source, where a
 * change is reviewable and deploys atomically with the code that uses it.
 *
 * Dashboard requirement: Allowed Domains must cover https://fbtswap.ir and
 * https://localhost (the WebView origin inside the APK), and App IDs must
 * include ir.fbtswap.app.
 */
export const WC_PROJECT_ID = '5997d5aee8bb42f43ddec4b1a5f94eb1';

export const WC_APP_NAME = 'FBT Swap';
export const WC_APP_DESCRIPTION = 'Non-custodial decentralized exchange';

/**
 * Relay hosts, in the order the SDK itself prefers.
 *
 * `@walletconnect/core` declares `RELAYER_DEFAULT_RELAY_URL` as the `.org`
 * host; the `.com` host is the historical one and stays second so a filtered
 * network still has a second name to resolve. Both are measured before a
 * pairing is offered (relay.js), and the measurement — not this list — decides
 * the order an actual init() walks.
 */
export const RELAY_URLS = Object.freeze([
  'wss://relay.walletconnect.org',
  'wss://relay.walletconnect.com'
]);

/** The embedded-wallet frame (`DEFAULT_SDK_URL` in @reown/appkit-wallet). */
export const SECURE_SITE_URL = 'https://secure.walletconnect.org/sdk';

/** The AppKit/Explorer API host (appkit-common `W3M_API_URL`). */
export const W3M_API_URL = 'https://api.web3modal.org';

/**
 * Every bound in the flow, in one object.
 *
 * The connect bound is deliberately two-phase: a short fuse on each relay host
 * but the last, and the full budget on the last one. A single 20s fuse on the
 * first host is what made a blocked network feel like "it spins forever"; one
 * short fuse on every host would cut a healthy but slow pairing.
 */
export const TIMEOUT = Object.freeze({
  relayProbe: 5_000,
  relayCacheTtl: 90_000,
  initFirst: 8_000,
  initLast: 20_000,
  connect: 20_000,
  teardown: 4_000,
  emailOpen: 30_000,
  emailRestore: 30_000,
  emailCloseGrace: 3_000,
  healthProbe: 8_000
});

/** How long a published pairing URI stays usable. */
export const PAIRING_TTL_MS = 300_000;

/**
 * The identity every wallet prompt shows.
 *
 * Built from `publicAppUrl()` — never from `window.location.origin`, which is
 * `https://localhost` inside the APK. A wallet is a separate app: it cannot
 * fetch a localhost URL, it rejects the proposal, and Trust's scanner shows
 * the red "domain flagged unsafe" screen for a dApp that claims to be one.
 */
export function wcMetadata() {
  const url = publicAppUrl('/').replace(/\/+$/, '');
  return {
    name: WC_APP_NAME,
    description: WC_APP_DESCRIPTION,
    url,
    icons: [`${url}/icon-512.png`],
    /*
     * `redirect.native` must ONLY be set inside the packaged app. Sent
     * unconditionally, a wallet approving a WEB session on Android tries to
     * bounce back to ir.fbtswap.app:// — an intent that either fails (no APK)
     * or yanks the user out of the browser tab they were connecting from. On
     * iOS there is no app scheme registered at all (no ios/ folder in this
     * repo), so only the universal link applies there in every case.
     */
    redirect: {
      native: isNativeShell() && !isIOS() ? 'ir.fbtswap.app://' : undefined,
      universal: url
    }
  };
}

/** The version string AppKit's own API calls send. Informational. */
export const HEALTH_SDK_VERSION = 'html-appkit-1.8.19';
