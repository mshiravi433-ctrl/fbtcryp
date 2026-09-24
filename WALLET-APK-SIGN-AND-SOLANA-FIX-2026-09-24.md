# APK-only wallet failures — root causes and the fix (2026-09-24)

گزارش (فارسی): «تو سایت درست کار می‌کنه، فقط تو اپ اندروید (APK):
۱) اتصال کیف پول سولانا رد می‌شود و وصل نمی‌شود؛
۲) کیف پول EVM وصل می‌شود ولی موقع امضا (پل، dYdX و …) داخل کیف پول
WalletConnect می‌گوید «اتصال برقرار نیست».»

Both symptoms are real, both are **APK-only by construction**, and neither is a
network problem. Version bumped to **1.39.1 / versionCode 63** — the fix has a
Java half, so a new APK build is required.

---

## 1 · Solana: «رد می‌شود»

The deeplink path (`src/lib/solana/deeplink*.js`) is the **only** Solana path
inside the APK: `canInjectSolana()` and `canUseMwa()` are both `false` in the
native shell. On the website a phone uses Mobile Wallet Adapter and never
enters this code — which is why the bugs below were invisible on the site.

| # | Root cause | Fix |
|---|------------|-----|
| 1 | **Every post-connect request (sign/send/message) was built with `session=` and `transaction=` in the URL as plaintext.** The protocol (Phantom, Solflare, Backpack alike) takes exactly `dapp_encryption_public_key`, `nonce`, `redirect_link` and an **encrypted `payload`** (`box({transaction, session}, nonce, sharedSecret)`). Phantom on Android answers such a malformed request with `errorCode=-32603 "Unexpected error"` **before any approval screen** — the «رد می‌شود» of the report. | `deeplinkUri.signRequestPayload()` builds the documented JSON, `deeplink.sealRequest()` seals it with the session's shared key and the per-request nonce, `signRequestUrl()` now **refuses** to build a URL without a sealed payload (no `session` parameter exists any more). The probe plays the wallet and **decrypts the request** to assert its content. |
| 2 | **Solflare's connect answer was never read.** Solflare returns its key as `solflare_encryption_public_key`; the parser only knew `phantom_` and `wallet_` (Backpack). A Solflare user approved, came back, and the sheet stayed «waiting» until it declared the round trip stuck. | `readDeeplinkReturn()` accepts any `<name>_encryption_public_key` (except our own `dapp_`), `stripDeeplinkReturn()` scrubs it from the address bar. |
| 3 | **The Java bridge tried one explicit intent, then fell to an unscoped one.** `FBTSolanaLink.openWalletLink` fired `https://phantom.com/ul/…` with `setPackage(app.phantom)`; if that host is not in the installed build's intent-filter the `ActivityNotFoundException` sent the request to an **unscoped** `ACTION_VIEW` — a browser tab or a chooser, i.e. a wallet that opens with nothing to approve, or no wallet at all. | New `FBTSolanaLink.openWalletRequest(url, pkg)` tries, **each package-scoped**: the https URL as built → the alias host (`phantom.com` ⇄ `phantom.app`) → the wallet's own scheme (`phantom://v1/…`, `solflare://ul/v1/…`, `backpack://ul/v1/…`) → only then unscoped, and **reports which door worked** as JSON. The JS side (`runRouteSync`) understands both the new answer and the old boolean (`openWalletLink` kept for older APKs) and keeps the route for diagnostics (`lastNativeHandoffRoute()`). |
| 4 | **`MAX_DEEPLINK_LENGTH = 4096`** in `MainActivity.captureDeepLink`: a connect reply fits, a signed transaction (encrypted base58 of up to 1232 bytes) does not — the answer was silently dropped. | 65536, the same bound `SolanaLink` already used for requests. |
| 5 | **The wallet's own `errorCode`/`errorMessage` were dropped**; every non-4001 code read as `WALLET_ERROR` with a generic sentence, so «could not parse the request» and «user tapped reject» were indistinguishable in the report. | The code stays named; `wallet: {code, message}` travels with the result/state, and `SolanaConnectSheet` shows «پیام خود کیف پول: … (کد …)» under the error (i18n `solana.connect.walletSaid`, fa/en/ar). |
| 6 | Phantom marks `signAndSendTransaction` deprecated in its deeplink docs. | `deeplinkSignAndSendTransaction(tx, { broadcast })`: if the wallet answers «unsupported / -32601 / -32603» (never on a user's «no»), the same request is re-issued as `signTransaction` and the app broadcasts the signed bytes on its own RPC (`sendRawSolana`). |

## 2 · EVM WalletConnect: «اتصال برقرار نیست» at signing

A session has **two** deep links. The pairing (`wc:…`, owned by
`handoff.js`) worked — the wallet connects. The second is fired by the SDK for
**every signing request** on a phone:

```
<wallet-scheme>://wc?requestId=<id>&sessionTopic=<topic>
```

The wallet opens it and looks the request up **on the relay by id**. In
`@walletconnect/sign-client` 2.25 `Engine.request` runs that redirect in
`Promise.all` **next to** `sendRequest`, i.e. before the relay has acknowledged
the publish. Two APK-specific facts turned that race into a guaranteed failure:

1. **The relay socket is dead while `relayer.connected` is still `true`.**
   Android freezes the WebView's network while the wallet has the screen; the
   socket that comes back is open in name only (`readyState === 1`). The SDK
   has **no browser-side ping** (`startPingTimeout` is Node-only), so
   `transportOpen()`/`wakeWcTransport()` are no-ops, and the publish sits in
   the dead socket until the SDK's stall detector restarts the transport
   ~10 s later. The wallet, opened immediately with the requestId, finds
   nothing → «connection not established».
2. **Two unscoped launches raced.** The SDK's `window.open(link, '_self')`
   became a Capacitor navigation → implicit `ACTION_VIEW` with no package,
   while our own «bring the wallet back» nudge fired a second bare-scheme
   intent 120 ms later.

On the website a tab is a real browser: the socket is closed cleanly and
reopened by the SDK, and Chrome resolves the scheme itself — hence «works on
the site».

### The fix — `src/lib/wc/requestHandoff.js`

* **`verifyRelayLive(relayer)`** — proves the socket with one real, bounded
  RPC (`irn_batchFetchMessages` on the session's topics). A live socket
  answers in < 1 s **and any response the wallet already published is
  delivered through `handleBatchMessageEvents`**; a socket that does not
  answer is restarted through the SDK's own `restartTransport()`
  (resubscribe + history fetch). One probe in flight per relayer.
  * `guardEip1193({ relayLiveness })` (phones): runs it **before every signing
    request** and **on every return** from the wallet (`visibilitychange` and
    the APK's `fbt:app-resume`, which the WebView needs because
    `visibilityState` can stay stale).
  * `wakeWcTransport()` (connect path, foreground): proves a «connected»
    socket instead of trusting the flag.
* **`installSessionRequestGate()`** (native channel only) — a persistent
  `window.open` gate that **holds** the SDK's requestId link until the sign
  client's `session_request_sent` event says the relay has the request, then
  opens it **once**, package-scoped, through the new Java
  `FBTWalletLink.openSessionLink(url, pkg)` (scheme ⇄ package table, strict
  `requestId`/`sessionTopic` validation, explicit intent, `false` on
  `ActivityNotFoundException` → browser fallback). If the SDK handed us no
  link (`document.hasFocus()` false, missing choice key) the link is built
  from the registry. Fallbacks: timer release when no event bus is
  observable; drop after 45 s.
* `WalletContext`: arms the gate where the WalletConnect provider is adapted
  (`armNativeRequestHandoff`), passes `relayLiveness` on phones, and **defers
  the bare-scheme nudge to the gate inside the APK** (web behaviour
  unchanged).

## Tests

* `test/solana-deeplink-probe.mjs` — updated: the simulated wallet now
  **decrypts the request** and asserts `{transaction, session}` inside;
  plaintext `session=`/`transaction=` are asserted absent; Solflare key name;
  wallet error words; the APK bridge's JSON answer, its refusal (falls through
  to the tab route) and the legacy boolean.
* `test/wc-request-handoff-probe.mjs` — **new** (42 checks): link parsing,
  proof-of-socket (live / dead → restart / shared in-flight / delivery of held
  messages), the gate (held → released once on ack, built link when none was
  captured, pass-through, uninstall), fail-open paths, `guardEip1193` order
  (probe → restart → publish), and source-level wiring guards including the
  Java doors. Wired into `test/run.mjs`.
* Ran green: both probes, `walletconnect-stack-probe` (409),
  `wallet-diagnostics-probe` (154), `solana-connect-sheet`, `bridge-solana-ui`,
  `wallet-health-panel`, `wallet-session-lease`.
* Note: `npm test` as a whole currently dies at HEAD (before this change) in
  `test/etf-gold-provider-probe.mjs` (`GOLD_SPOT_SHAPE_UNUSABLE`) when run
  inside the combined process — unrelated to wallets; it passes standalone.

## What to look at on the phone if anything remains

The diagnostics ring now carries: `sign_relay_live | sign_relay_restarted |
sign_relay_dead`, `sign_request_link_held | _opened | _failed | _dropped`,
`sign_wallet_nudge_deferred`, `pairing_relay_live | _restarted`; the Solana
sheet shows the wallet's own error text, and `lastNativeHandoffRoute()` says
which door (`https:phantom.com`, `https:phantom.app`, `scheme:phantom`,
`system`) the request took.
