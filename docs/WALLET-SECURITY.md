# Wallet connection security posture — Trust Wallet warning analysis

Status of the red "security risk / unverified domain" warning shown by Trust Wallet,
and the exact checklist of what is guaranteed in code versus what needs action
outside it. Written 2026-08-17 alongside the WalletConnect lifecycle fixes.

## What the code guarantees (verified in this repo)

| Layer | State | Where |
|---|---|---|
| `metadata.url` is always the canonical production origin | `https://fbtswap.ir` via `publicAppUrl()`, never `window.location.origin`, never `https://localhost`, never a Vercel preview host (the e2b exception only applies when the app is ACTUALLY running on that e2b host) | `src/lib/nativeShell.js`, `src/context/WalletContext.jsx` (`buildWcInitConfig`) |
| SDK overwrite repair | The SDK's `populateAppMetadata()` re-stamps `https://localhost` inside the APK; `repairSignClientMetadata()` corrects the live SignClient to the canonical URL + icon before any proposal is sent, on BOTH connect and restore | `src/context/WalletContext.jsx` |
| Icon | `icon-512.png` exists in `public/`, is HTTPS, same origin as `metadata.url` | pinned by `test/walletconnect-wiring.mjs` |
| Redirect | `redirect.native` = `ir.fbtswap.app://` inside the APK only (matches `@string/custom_url_scheme` in `android/app/src/main/res/values/strings.xml`); `redirect.universal` = canonical URL everywhere | pinned by the same suite |
| projectId | single source constant `WC_PROJECT_ID` in source; env override is retired and banned | pinned by the same suite |
| No sensitive logging | the event trace (`src/lib/wcTrace.js`) stores event NAMES + timestamps (+ one number/boolean) only — never URI/topic/accounts/keys; printed only in dev builds | pinned by `test/wc-connect-probe.mjs` |
| Session restore | a persisted session is re-attached on cold start and on foreground return WITHOUT a new pairing | `restoreWcSession()` |
| Steady session | transient `accountsChanged: []` on WC no longer tears down the session; relay drop/reconnect is traced, never treated as teardown; only `session_delete`, `session_expire`, explicit user disconnect or a real account removal clear the connection | `attachWcListeners()` |

## What a red Trust Wallet warning can mean, and what to check

Trust Wallet rates a WalletConnect session via WalletConnect Verify:

1. **Domain match** — the origin the wallet believes it is talking to vs
   `metadata.url`. Inside the APK this used to disagree (`https://localhost`
   vs `fbtswap.ir`) until the repair above; verify on a device that the
   approval sheet now says **fbtswap.ir**.
2. **Reown project registration** — dashboard project
   `8e36eccabebf5a4567f4e974fafd6b20` currently has the identities required by
   both distributions:
   - verified web origins: **`https://fbtswap.ir`** and
     **`https://localhost`** (the latter is the Capacitor WebView origin);
   - verified Android application/bundle ID: **`ir.fbtswap.app`**.
   Keep those entries together on this project. An allowlist naming only the
   website or a retired domain can reject APK pairings because the relay sees
   the packaged page's origin as `https://localhost`. The wallet-facing
   `metadata.url` must nevertheless remain `https://fbtswap.ir`.
3. **Threat feeds** — if the warning is red ("Security risk", "website
   blocked"), the domain is likely in a phishing/reputation feed (Blockaid or
   the WalletConnect Data Lake). This cannot be fixed in code and must not be
   papered over. The appeal path:
   - Blockaid false positive: https://report.blockaid.io
   - Trust Wallet: https://support.trustwallet.com → security review for the
     domain, referencing the WalletConnect project id above
   - Evidence to attach: this file's guarantee table, the non-custodial
     design (no custody, no seed collection anywhere), the store listing.

If you are testing on a PREVIEW domain (e.g. `*.vercel.app`), some wallets
warn regardless of registration — test acceptance only on `fbtswap.ir`.

## The auto-disconnect report (root-caused in code)

"پس از اتصال موفق چند دقیقه بعد Trust Wallet خودش قطع می‌کند" had three
code-side contributors, all fixed in this release:

1. **The session was never restored.** init() only ran from the Connect
   button, so any WebView restart (Android process reclaim, refresh, bouncing
   back from the Trust approval screen) showed "not connected" while the WC
   session in storage was still alive. `restoreWcSession()` now re-attaches it.
2. **Transient `accountsChanged: []`** from the wallet was treated as a full
   disconnect. It is now ignored on the WC transport (authoritative events
   are `session_delete` / `session_expire`).
3. **Stale provider handlers.** Events from a replaced provider instance could
   act on the new connection. Every handler is now instance-scoped
   (`wcRef.current !== wc` → ignore), and a stale instance's listeners are
   detached BEFORE it is disconnected during a reconnect.

To answer "was it Trust, the relay, or us?" next time: the in-memory
`wcTrace` ring (`wcEvent`) now records display_uri, session_proposal,
session_event, session_delete, session_expire, relay_connect,
relay_disconnect, session_restored, session_settled, connect_failed and
local_disconnect — names and timestamps only.
