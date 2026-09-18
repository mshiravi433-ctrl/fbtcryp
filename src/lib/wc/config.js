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
  /*
   * 8s. Measured on a real phone — 2026-09-17, Samsung Internet 30 / Android 10,
   * mobile data: wss://relay.walletconnect.org opened in 4344ms while HTTPS to
   * the same host answered in 220ms, i.e. the wss handshake, not the network.
   * 5s left that healthy socket at 87% of the budget, so a small hiccup read as
   * «relay blocked». Do not lower it back to 5s: that edge is why it moved.
   */
  relayProbe: 8_000,
  relayCacheTtl: 90_000,
  initFirst: 8_000,
  initLast: 20_000,

  /*
   * ── THE CONNECT BOUND ─────────────────────────────────────────────────
   * Measured on the report of 2026-09-17 20:36 UTC: the wallet row was tapped
   * 4.5s after `init`, and the attempt was killed 20s after that — while the
   * user was standing in Trust Wallet reading the approval screen. The whole
   * mobile round trip (app switch → unlock → read → approve → relay publish)
   * does not fit in 20 seconds, so EVERY deep-link pairing was settled as a
   * failure, the provider was torn down underneath it, and the failure was
   * then classified as «the relay is unreachable» — the sentence that sent
   * this investigation looking for VPNs for four days.
   *
   * Three numbers, and the difference between them is the fix:
   *   connect         — the budget while THIS DOCUMENT is on screen. The user
   *                     is looking at our sheet, so waiting is cheap.
   *   connectInWallet — granted the moment a pairing is handed to a wallet
   *                     app. From then on the clock belongs to the user, not
   *                     to the network.
   *   connectHardCap  — never waits past the pairing URI's own expiry. A
   *                     pairing that can no longer be approved has to fail
   *                     with a reason instead of spinning.
   *
   * And the clock PAUSES while the document is hidden (see pauseBound in
   * timing.js): a user reading an approval in another app must not burn the
   * dApp's patience while they decide.
   */
  connect: 75_000,
  connectInWallet: 240_000,
  connectHardCap: 300_000,
  /*
   * How long a tab opened for a custom scheme is allowed to live before it is
   * closed. Chrome leaves that tab behind with the dead `trust://wc?uri=…`
   * URL in its address bar, and it is what the user sees when they press Back
   * out of the wallet — «I never get back to fbtswap.ir». See handoff.js.
   */
  handoffClose: 2_500,
  teardown: 4_000,
  /*
   * 30s. KEPT AS THE RESTORE WINDOW AND THE OLD OPEN BUDGET — but the open
   * wait itself is now event-driven and capped by `connectHardCap` (the 2026-
   * 09-18 Telegram report: a 30s one-shot fuse against an OTP that takes
   * 30–120s on a phone, after which nobody was listening for the login that
   * arrived a minute later). See awaitAccount in embedded.js.
   */
  emailOpen: 30_000,
  /*
   * The bound on `modal.open()` itself — NOT on the login.
   *
   * In AppKit 1.8.19 `open()` awaits `ApiController.prefetch()` (a fan of
   * explorer API calls) BEFORE it resets the router to the Connect view. On a
   * slow mobile network one stalled call used to hold the whole flow — the
   * trace showed `email_wait_timeout` a full minute after the tap while the
   * user stared at nothing. The bound releases the flow to keep WAITING for
   * the account (the modal may still appear); it only refuses to let a hung
   * prefetch own the spinner forever.
   */
  emailModalOpen: 20_000,
  emailRestore: 30_000,
  emailCloseGrace: 3_000,
  /*
   * The grace AFTER the login modal closes without an account: a slow WebView
   * answers a beat after the close (the provider lands 1–2s after the
   * address), and the event-driven wait in awaitAccount gives that beat room
   * before the verdict — instead of the old 3s, because the login that
   * finishes LATE (OTP typed while the modal was dismissed on a flaky
   * WebView) is exactly the one this grace exists to catch.
   */
  emailLateGrace: 8_000,
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
