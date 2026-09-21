/**
 * WALLETCONNECT — SHARED FACTS
 * ---------------------------------------------------------------------------
 * One place for the identity and the numbers every wallet prompt, relay probe
 * and timeout in this directory reads. Nothing here depends on the SDK, so the
 * whole stack can be reasoned about (and tested) without booting a client —
 * and the one value that does read the document (`walletIdentityUrl`, the
 * origin we introduce ourselves as) takes its window as an argument. */

import { publicAppUrl } from '../nativeShell.js';
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
  /* ── THE SIGNING BOUND ──────────────────────────────────────────────────
   * A signature is a HUMAN wait, not a network wait: the user reads a prompt
   * in another app, unlocks, decides. `signInWallet` is the budget while they
   * are doing that, and the clock PAUSES while this document is hidden (see
   * pauseBound in timing.js), so a slow decision is never punished.
   * `signHardCap` is the absolute ceiling for a tab nobody came back to.
   * `signRelayReopen` is how long we give a closed relay socket to come back
   * before we tell the user the truth instead of waiting on a dead socket.
   */
  signInWallet: 180_000,
  signHardCap: 600_000,
  signRelayReopen: 6_000,
  /*
   * The five email/embedded-wallet bounds that used to live here
   * (`emailOpen`, `emailModalOpen`, `emailRestore`, `emailCloseGrace`,
   * `emailLateGrace`) went with the surface they measured — the email/social
   * login was retired on 2026-09-18. Nothing outside that surface ever read
   * them, and a bound nobody waits on is a number that can only drift.
   */
  healthProbe: 8_000
});

/** How long a published pairing URI stays usable. */
export const PAIRING_TTL_MS = 300_000;

/**
 * THE ORIGIN THIS APP MUST INTRODUCE ITSELF AS.
 * ---------------------------------------------------------------------------
 * One function, because there are exactly two honest answers and picking the
 * wrong one is what puts «این dApp به نظر می‌رسد کلاهبرداری باشد» on the
 * wallet's screen.
 *
 * ─── WHY THIS IS NOT SIMPLY publicAppUrl() ANY MORE ─────────────────────────
 * `publicAppUrl()` answers "where does this app live in production", and for
 * every link we hand to a human that is the right answer. A session proposal
 * is not a link: it is an identity claim that the wallet CROSS-CHECKS, twice.
 *
 *  1. WalletConnect's Verify API attests the origin that actually opened the
 *     socket — `Verify.register()` sends `window.location.origin` to the
 *     attestation enclave, and the signed JWT it gets back names that origin.
 *     The SDK then derives the verdict the wallet renders:
 *
 *         validation = attestedOrigin === new URL(metadata.url).origin
 *                        ? 'VALID' : 'INVALID'
 *
 *     So a page running on a preview host that declares `fbtswap.ir` is not
 *     "showing the good domain" — it is a MISMATCH, and a mismatch is the
 *     signal wallets are built to shout about: «The application's domain
 *     doesn't match the sender of this request», with a red screen and a
 *     continue-anyway button. That is the report this fixes.
 *  2. The user compares the domain in the prompt with the domain in the
 *     address bar. Two different names for one app is indistinguishable from
 *     a phishing copy, and reviewers treat it as one.
 *
 * ─── THE TWO ANSWERS, AND WHEN EACH IS THE TRUE ONE ─────────────────────────
 *  · A real public https page → ITS OWN origin. The attestation will name it,
 *    the user's address bar already says it, and the two agree.
 *  · Anything a wallet cannot open, fetch or attest — the packaged app
 *    (`https://localhost`), a dev server, an `http://` page — → the canonical
 *    public origin. That is the only name a wallet could act on: MetaMask
 *    rejects `https://localhost` outright and Trust's scanner renders it as an
 *    unsafe domain.
 *
 * The canonical host stays the identity inside the packaged app, which is the
 * one place the two rules could disagree — and there the page origin is not a
 * domain at all.
 *
 * `view` is injectable (a window-like object) for the same reason
 * `handOffChannel()` is: this decision must be testable without a browser.
 */
export function walletIdentityUrl(view) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  const canonical = publicAppUrl('/').replace(/\/+$/, '');

  // The packaged app. Capacitor serves this page from https://localhost, which
  // a wallet cannot fetch — a pairing that introduces itself that way is
  // rejected before the user ever sees a prompt.
  if (win?.Capacitor?.isNativePlatform?.()) return canonical;

  const origin = String(win?.location?.origin ?? '').replace(/\/+$/, '');
  // A page with no public https origin: a dev server, a file:// build, an
  // http:// host. Declaring the page would hand the wallet a URL it cannot
  // reach (or must refuse), so the public identity is the honest answer.
  if (!/^https:\/\//i.test(origin)) return canonical;
  if (/^https:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) return canonical;

  // A real page on a real host — including every preview deployment. This is
  // the identity the attestation will carry, so it is the identity the wallet
  // must be told; on the canonical host it is also what production declares.
  return origin;
}

/**
 * The same decision, as evidence.
 *
 * Raw facts only — declared, page, canonical, and whether the first and second
 * agree — because the diagnostic rule in this directory is that a report ships
 * measurements, never a verdict. A support thread that says «identity mismatch»
 * and nothing else starts the investigation over; one that names both origins
 * ends it.
 */
export function walletIdentityFacts(view) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  const declared = walletIdentityUrl(win);
  const pageOrigin = String(win?.location?.origin ?? '').replace(/\/+$/, '');
  return {
    declared,
    pageOrigin,
    canonical: publicAppUrl('/').replace(/\/+$/, ''),
    packaged: Boolean(win?.Capacitor?.isNativePlatform?.()),
    matchesPage: Boolean(pageOrigin) && declared === pageOrigin
  };
}

/**
 * The identity every wallet prompt shows.
 *
 * Built through `walletIdentityUrl()` — see the block above for why a wallet
 * must be told the page's own origin rather than a constant, and why the
 * packaged app is the exception that still needs the canonical name.
 */
export function wcMetadata(view) {
  const win = view ?? (typeof window !== 'undefined' ? window : null);
  const url = walletIdentityUrl(win);
  return {
    name: WC_APP_NAME,
    description: WC_APP_DESCRIPTION,
    url,
    icons: [`${url}/icon-512.png`],
    /*
     * A redirect is an APP return address, not the dApp's identity URL.
     *
     * Giving a mobile-web session `redirect.universal = fbtswap.ir` makes
     * Trust Wallet open that URL in Trust's own dApp browser after approval.
     * The original Chrome/Safari tab (and its pending SignClient) remains in
     * the background, while the user sees a second copy of FBT inside Trust
     * asking them to connect again. That is the reported two-approval loop.
     *
     * The packaged Android app is different: its private scheme really does
     * identify the initiating application, so advertise ONLY that route. Do
     * not also advertise the website and leave the wallet two competing return
     * targets. A web dApp has no app-to-app redirect; the user returns to the
     * still-live browser tab and WalletConnect settles there through the relay.
     */
    redirect: win?.Capacitor?.isNativePlatform?.() && !isIOS()
      ? { native: 'ir.fbtswap.app://' }
      : undefined
  };
}

/** The version string AppKit's own API calls send. Informational. */
export const HEALTH_SDK_VERSION = 'html-appkit-1.8.19';
