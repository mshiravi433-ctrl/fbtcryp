> ⚠️ **بایگانی‌شده (۲۰۲۶-۰۹-۱۷):** این سند یک راندِ رفعِ اشکالِ قدیمی را
> توصیف می‌کند. مسیرهایی که در آن آمده (`src/lib/wcWallets.js`،
> `src/lib/emailSocialWallet.js`، `src/lib/walletHealth.js` و همراهانشان)
> دیگر وجود ندارند: کلِ ستکِ والت‌کانکت در `src/lib/wc/` از نو نوشته شده
> است. **تحلیل و علتِ این گزارش همچنان معتبر است؛ فقط محلِ کد عوض شده.**
> معماریٔ فعلی: [`WALLET-CONNECT-STACK-FA.md`](docs/WALLET-CONNECT-STACK-FA.md)

---

# WalletConnect / AppKit — Full Stack Audit
## fbtswap.ir — 2026-09-17

**Scope**: everything from `WC_PROJECT_ID` to `window.open`, as requested — "والت کاتکت را چک کن کل کد ها را از اول تا اخر". This is a read of the live code (commit `dbf4862…0bf6814` on `main`, `ea9bc18` on `arena/01a0aba0-fbtcryp`) against the four live health reports you sent (`19:42`, `19:49`, `19:53`, `19:59` on Android Chrome 151).

---

### 1. Project identity — is this app's ID the one the dashboard thinks it is?

**One-line answer: yes, and that was the old bug.**

```js
// src/context/WalletContext.jsx:77
const WC_PROJECT_ID = '8e36eccabebf5a4567f4e974fafd6b20';
```

Hard-coded in source, not `VITE_WALLETCONNECT_PROJECT_ID`. The comment explains why: three pipelines (Vercel, APK, local) each had their own env copy; a stale env shipped an old project whose allowlist still named `lawpoetics.ir`. The relay then refused, and nothing in code could explain it.

**Live proof** (`19:59`):

```json
projectConfig: { ok:true, status:200, features:{ email:true, socials:7, enabled:true } }
allowedOrigins: { list:["fbtswap.ir","https://fbtswap.ir","https://localhost"], originAllowed:true, currentOrigin:"https://fbtswap.ir" }
```

- `GET api.web3modal.org/appkit/v1/config?projectId=8e36…` → 200, `social_login.isEnabled=true` with `["email","google","x",...]` — `summarizeProjectConfig()` reads it like the SDK's own `ConfigUtil.getApiConfig()` (array, not object, with `shape:"array"`). An older revision read `features.social_login` as an object and reported `email=false` for the same payload.
- `GET /projects/v1/origins` → same 200, list covers the runtime origin exactly. `isOriginAllowed()` mirrors the SDK rule (`empty → allow all`, exact/host/`https://` match). Empty list would also be `true` via `emptyMeansAllowAll`, but here it is non-empty and explicitly covers `fbtswap.ir`.

**Verdict**: dashboard side is green. No more env drift.

---

### 2. Relay — the hop the UI cannot show

**Two hostnames, not one** — the SDK's default is measured, not guessed:

- `@walletconnect/core@2.25.0` → `RELAYER_DEFAULT_RELAY_URL = "wss://relay.walletconnect.org"` (only `wss://` literal in the bundle)
- `docs.reown.com/advanced/faq` → "set `relayUrl` to `wss://relay.walletconnect.org`" when `.com` is blocked
- `WC_RELAY_URLS = ['wss://relay.walletconnect.org','wss://relay.walletconnect.com']` in `wcTimeout.js` — default first, historical second, with the health panel probing **both** in parallel via `probeRelaySet()`.

**Preflight** (`wcRelayProbe.js`):

- Signs a real `auth` JWT (`@walletconnect/relay-auth`) — not just `?projectId=` — so a `wss://` that answers is a real relay, not a TCP echo.
- `RELAY_PREFLIGHT_TIMEOUT_MS = 5_000`, `WC_PRIMARY_RELAY_TIMEOUT_MS = 8_000`, `WC_CONNECT_TIMEOUT_MS = 20_000`, `WC_PAIRING_TTL_MS = 300_000` (the pairing's own lifetime). The two-phase bound is the fix for the worst misdiagnosis in this file: cutting a healthy pairing at 20s reported it as `WC_RELAY_UNREACHABLE`.
- `relayVerdict()` → `OPEN` when any `socket.ok`, otherwise `WS_REFUSED` (https ok, wss refused), `UNREACHABLE`, `TIMEOUT`. `relayOrderFromHosts()` then puts the open host first for `initWcProvider()`'s sequential failover.

**Live proof** (`19:59`):

```json
relays:[
  {url:"wss://relay.walletconnect.org", socket:{ok:true, ms:999}, https:{ok:true, ms:480}},
  {url:"wss://relay.walletconnect.com", socket:{ok:true, ms:985}, https:{ok:true, ms:490}}
],
relayVerdict:"OPEN", secureSite:{ok:true, ms:775}
```

Both hosts open in <1s. `probeRelay` with `auth` succeeded — this is not a filtered network. Earlier `19:53` (`org 855ms, com 881ms`) and `19:42` (`797ms/1385ms`) show the same. The one `6776ms` spike in `19:49` was a transient, but verdict stayed `OPEN`.

**Init failover** (`initWcProvider` in `WalletContext.jsx`):

Walks `relayOrder` (the preflight's `order`, or `WC_RELAY_URLS`). First entries get an 8s fuse, last gets 20s. `isRelayClassError()` gates the fallback so user-cancel (`User rejected`/4001/`connection request reset`/`WC_USER_CANCELLED`) and origin errors never waste 20s on the second host. The orphaned `EthereumProvider.init()` promise is `disconnect()`-ed via `ghost` handler.

**Verdict**: relay is not the bug for you. The instrumentation would have shown `WS_REFUSED`/`TIMEOUT` with per-host `ms` if it were, on this exact device and network.

---

### 3. Metadata — why wallets once flagged "Security risk / localhost"

`wcPublicMetadata()` builds `{ name, description, url, icons }` from `publicAppUrl('/')` — never `window.location.origin` (which is `https://localhost` inside the APK). `repairSignClientMetadata()` then patches `wc.signer.client.metadata` (the object the proposal is serialized from — verified against `sign-client@2.23.10` where `UniversalProvider.createClient → SignClient.init`) because `populateAppMetadata()` overwrites `url` with the runtime origin. Without the patch Trust's scanner saw `https://localhost` and showed the red "domain flagged unsafe" screen.

**Still in code, still tested**: the branch order is `signClient.metadata` → `signer.metadata` → `rpc.metadata`, with a return check on the live object. An earlier revision checked the dead `wc.signer.metadata` and always reported `metadata_repair_failed`.

---

### 4. Wallet registry — Trust and the four siblings

`src/lib/wcWallets.js` — authoritative table:

| key | explorer id | native | universal | package |
|---|---|---|---|---|
| metamask | `c57ca95b…72d96` | `metamask://` | `https://metamask.app.link/` | `io.metamask` |
| **trust** | `4622a2b2…a31a0` | `trust://` | `https://link.trustwallet.com/` | `com.wallet.crypto.trustapp` |
| uniswap | `c03dfee…034a` | `uniswap://` | `https://uniswap.org/app/` | `com.uniswap.mobile` |
| safepal | `0b415a7…150` | `safepalwallet://` | `https://link.safepal.io/` | `io.safepal.wallet` |
| rainbow | `1ae92b2…369` | `rainbow://` | `https://rnbwapp.com/` | `me.rainbow` |

- `appKitCustomWallets(projectId)` builds `{ id, name, mobile_link, link_mode, image_url, homepage }` — `link_mode` is the https fallback AppKit computes `redirectUniversalLink` from; `experimental_preferUniversalLinks:false` keeps **native primary**.
- `walletLinkBase()` mirrors `CoreHelperUtil.formatNativeUrl()` line for line (bare scheme → `://`, trailing `/` preserved — `trust://` → `trust://` not `trust:/`).
- `walletLink(base, uri)` encodes the **repaired** URI once (`repairPairingUri` first — `&amp;` → `&` — because `test/wc-uri-hygiene-probe.mjs` proves a double-escaped URI fails `pairing.pair() #relay-protocol`).
- `MOBILE_WALLETS` is the single source: `explorerRecommendedWalletIds:'NONE'` in `buildWcInitConfig()` clears the explorer's recommended list so the local table is never deduplicated away (old bug: 5 explorer ids were filtered from `customWallets` as duplicates, so on a filtered network the promoted rows vanished).

**Trust-specific note**: `link.trustwallet.com/wc?uri=` was observed to stop redirecting into the app and instead render a static "Have the app already? Open in Trust Wallet" page with a manual `trust://` anchor — `browser.js` header documents this. That page is harmless in a real browser (the `trust://` anchor fires), but inside **Telegram's WebView** it never fires, which is why the same wallet works in Chrome and "stays on the download page" in Telegram. The Telegram branch in `openWalletLink()` handles it (see §5).

---

### 5. Deep link — the last metre

**Where it lives**:

- `WalletContext.jsx:applyAppKitWalletLinks()` — asserts `features:{email:false,socials:false}` before a WC open, reasserts `{email:true,socials:[…]}` before an email open — the singleton-truce for the shared `<w3m-modal>` and `OptionsController`.
- `wcAppKitPatch.js` — wraps `ConnectionControllerUtil.onConnectMobile` to `rememberTappedWallet(wallet)` and `withLinkMode(wallet)` (fills `link_mode` when Explorer omits it).
- `wcDeepLink.js:decideWalletOpen()` — narrows `window.open` URLs: known `https://` → rebuilt native, bare `wc:` → completed via `lastTappedWallet()`, unknown custom → passthrough. Re-exports `repairPairingInUrl`, double-decode (`pairingUriFromWalletLink` loops 4 passes for Telegram-Android double-encoding).
- `browser.js:openWalletLink()` — the delivery:

| channel (`walletHandOffChannel`) | primary | fallback |
|---|---|---|
| `android-intent` (APK `Capacitor.isNativePlatform()`) | `FBTWalletLink.openWallet(pairingUri, package)` (package-scoped `ACTION_VIEW` with raw `wc:`) | `Browser.open({url: fallback})` (Custom Tabs) |
| `telegram` (`window.Telegram.WebApp.openLink`) | `walletLink(wallet.native, pairingUri)` via `window.open('_blank')` (double-encoded on Android: `encodeURIComponent(pairingUri)` once more, because Telegram decodes once in transit — measured, `test/wc-deeplink-probe`) | `Telegram.WebApp.openLink(fallback)` (last, because it lands on the manual page) |
| **`web-native`** (you: Android Chrome 151) | `trust://wc?uri=wc:…` via `window.open('_blank')` **or anchor** | — (currently just `native` or `fallback`) |

- `installWalletOpenBridge()` in `WalletContext.jsx` — wraps `window.open` for the pairing attempt only, with `target !== '_self'/'_top'` enforcement (`_self` would destroy the dApp and the pending `connect()` promise — the root cause of "Trust opened and nothing asked to connect" before this bridge).

**Live gap on your device** (`web-native` + Android Chrome):

- `isNativeWalletUrl('trust://wc?uri=…')` → true, `walletHandOffChannel()` → `web-native`, `launchUrl = trust://wc?uri=…`, `open(launchUrl, '_blank')`.
- On many Android Chrome builds `window.open('trust://…','_blank')` is treated as a popup if not synchronously inside the tap — even though our pre-`await` path keeps it synchronous, OEM/CSP variations still show "pop-up blocked" or silently drop the intent. When it does fire, some OEMs require an `intent://` with `package=` to route reliably; plain `trust://` can be swallowed if another app registered the same scheme or if Chrome's "intent picker" is disabled.
- The current `web-native` path has **no `intent://` builder** — it is the only channel that does not use `package`. That is the discrepancy between "works on my Pixel" and "stays on Wallet's site" on your phone / on some Samsung/MIUI Chrome.
- `fallbackUrl` is `https://link.trustwallet.com/wc?uri=…` — if native fails the user lands on the static download page (the "برمی‌گرده به سایت همون والت" you reported), not back to `fbtswap.ir`.

**Fix applied in this audit** (see §9): `web-native` + Android now tries `intent://wc?uri=…#Intent;scheme=trust;package=com.wallet.crypto.trustapp;S.browser_fallback_url=…;end` first, then `trust://`, then the anchor. `intent://` is the form Chrome documents for app launching; `S.browser_fallback_url` returns to the fallback instead of a dead intent error when the app is not installed.

---

### 6. The Relay Preflight in the report — what `trace:[]` means

`collectWalletHealth({ trace: wcTraceSnapshot })` snapshots the last 40 `wcEvent()` entries (names + optional `n`/`ok`, never URIs/topics). In `19:59` you saw `trace:[]` — expected for an idle cold start with `ourMarker:true` after the orphan guard fix (§7). A real pairing would append:

`relay_preflight_open` → `init` → `metadata_repaired` → `appkit_links_applied` → `display_uri`/`pair_uri_ready` → `session_settled` or `connect_failed_*`/`pair_cancelled`

The live failure naming you asked about is in `connectWalletConnect() catch`:

`USER_REJECTED` (`User rejected`/4001/`connection request reset`/`WC_USER_CANCELLED`)
`WC_ORIGIN_BLOCKED` (`origin not allowed`/projectId)
`WC_EXPIRED` (`WC_PAIRING_EXPIRED`/`proposal expired`)
`WC_RELAY_UNREACHABLE` (`websocket`/`socket stalled`/`network`/`relay`/`timeout` + clears relay cache)

Every branch emits a literal event name (`wcEvent('connect_failed_relay', elapsed)`) — no foreign string ever enters the trace.

---

### 7. Storage hygiene — the 5 → 4 → 4 loop you watched live

- `wcStorage.js:isConnectionArtifactKey()` covers `wc@2:`, `WALLETCONNECT_DEEPLINK_CHOICE`, static `APPKIT_CONNECTION_KEYS`, dynamic `@appkit/<ns>:connected_connector_id`, and any non-cache `@appkit/` (future-proof). Cache keys (`portfolio_cache`, `token_price_cache` …) and `recent_emails` are kept. `@appkit-wallet/*` is **never** purged here.
- `storageFacts()` counted `appkitConnectionKeys` via the same predicate (excluding `wc@2:`), and `orphanKeys = appkit>0 && sessions==0` — but that labeled **email's** `@appkit/*` (created by `getEmailSocialAppKit()` on every boot with `ourMarker:true`) as orphan.

You proved it:

- `19:42`: `appkit:5 / sessions:0 / ourMarker:false / orphan:true / trace:[]`
- `19:49`: `appkit:4 / sessions:0 / ourMarker:true / orphan:true / trace:[orphan_storage_purged n=5]` — first vault-agnostic purge (commit `9ba029a`) correctly deleted the stale WC debris, but immediately recreated 4 email keys.
- `19:53`: `appkit:4 / orphan:true / trace:[orphan_storage_purged n=2]` — purged email keys it should not have, they were recreated.
- Fix `0bf6814` (WalletContext): `if (facts.orphanKeys && !hasEmailSocialMarker() && !addressRef.current)` — vault-agnostic, email-guarded.
- Fix `dbf4862` (walletHealth): `facts.orphanKeys = appkit>0 && sessions==0 && !facts.ourMarker` — mirrors the same guard; the report no longer cries wolf.
- `19:59`: `appkit:5 / sessions:0 / ourMarker:true / orphan:false / trace:[]` — the 5 are now correctly **not** orphan, and no churn purge fired.

**Current rule**: idle cold start with nowhere to restore (`!addressRef.current`) and `!hasEmailSocialMarker()` → purge. `@appkit-wallet/*` never touched. Explicit `connectWalletConnect({force})` and `disconnect()`/`forgetLocalWallet()` always purge synchronously before `init()`.

---

### 8. Email & Social — why it "connects but doesn't sync on mobile"

- `emailSocialWallet.js` — second `createAppKit({ adapters:[new EthersAdapter()], enableWalletConnect:false,… })`, sharing the `OptionsController` singleton and `<w3m-modal>`. Every open reasserts its `features` (`email:true, socials:[…], emailShowWallets:false` vs `email:false,socials:false` on WC).
- `WC_PROJECT_ID` + `wcPublicMetadata()` shared, networks from `buildEmailNetworks()` (`DEFAULT_CHAIN` first, geo-friendly `cfg.rpc` order).
- `SDK_LOGIN_USED_KEY = '@appkit-wallet/EMAIL_LOGIN_USED_KEY'` — `W3mFrameProvider` only creates its `secure.walletconnect.org` iframe if this key is `'true'`. `rearmSdkLoginMarker()` hands it back before `createAppKit()` when `ourMarker` stands but the SDK deleted its copy (on any transient `isConnected()` failure).
- `EMAIL_RESTORE_WINDOW_MS = 30_000` (> SDK's own `iframeReadyTimeout 20_000` + `frameLoadPromise`) — `restoreEmailSocial()` waits for `subscribeAccount` after `getIsConnectedState()`. Old 8s window is why "one slow boot permanently lost the session — fix is tap again".
- `setEmailSocialMarker(true)` is claimed **before** `modal.open()` (OAuth can navigate away), rolled back only via `rollbackEmailSocialMarker()` when the instance definitively says `!isConnected`, otherwise kept (`email_restore_pending` vs `email_restore_none`).

**Why "mobile doesn't sync"**: the embedded wallet session lives in `secure.walletconnect.org`'s iframe storage + `localStorage @appkit-wallet/*` **on that device's browser origin** (`https://fbtswap.ir`). Connecting with `foo@gmail.com` on desktop does not put a session on your phone's Chrome storage; you must open `fbtswap.ir` on the phone and **log in with the same email again** — the wallet address will be the same (deterministic from the email auth), but the session is per-browser. If `probeReachable(SECURE_SITE_URL)` were failing, the iframe would never load — your `secureSite 734–775ms OK` shows it is reachable on your network.

---

### 9. What changed in this audit

1. **WalletContext.jsx** — orphan hygiene vault-agnostic, email-guarded (commit `0bf6814`).
2. **walletHealth.js** — `orphan` definition mirrors the same guard (`dbf4862`).
3. **browser.js — web-native Android intent** (new in this page): when `isAndroidView(view) && walletPackage && pairingUri`, build `intent://wc?uri=…#Intent;scheme=<scheme>;package=<package>;S.browser_fallback_url=<fallback>;end` and try it before `trust://`. This is the Chrome-documented launch path; it returns to the fallback (Play Store or universal link) instead of a blank intent error when the app is missing.

No env vars, no dashboard toggle, no new dependency. Live diagnostics still show `originAllowed:true`, `relay OPEN` on both hosts, `secureSite OK`, `orphan:false` with `ourMarker:true`.

---

### 10. How to verify the Trust fix

1. Hard-refresh `fbtswap.ir` on Android Chrome (or 1 min wait for Vercel).
2. **Health**: `Run` → expect `appkit:5 / wc:0 / ourMarker:true / orphan:false / trace:[]`, `relay org ~900ms / com ~980ms OPEN`.
3. **WC**: `Disconnect` (marker clears, `appkit:0`), then `Connect → WalletConnect → Trust`. Chrome should show the system app picker / open Trust directly (not `link.trustwallet.com` download page). Approve → `wcSessionKeys:1`, `trace:pair_uri_ready → session_settled`, back on `fbtswap.ir` with the address.
4. **Email**: on the phone, `Email & Social → same email` → `email_session_restored` within 30s, address matches desktop's same-email wallet.
5. If Trust is not installed, `intent://`'s `S.browser_fallback_url` routes to `https://link.trustwallet.com/wc?uri=…` which then shows Play Store — not `fbtswap.ir` "lost".

Raw `collectWalletHealth` JSON remains copyable from the panel for any remaining report.

---

## Round 2 — 2026-09-17 (the same report, deeper): «نه لینک نه ایمیل، دوتاش خرابه»

**Input**: the health JSON at `00:11Z` (`projectConfig ok`, `originAllowed true`, `relay OPEN` on both hosts, `secureSite ok`, `ourMarker:true`, `sdkLoginMarker:false`, `wcSessionKeys:0`, `appkitConnectionKeys:5`, **`trace:[]`**) plus the two live complaints. Everything the dashboard controls remains green — the bug is not there. This round was verified against the **actual shipped SDK sources** (`@reown/appkit@1.8.19`, `appkit-controllers`, `appkit-scaffold-ui`, `appkit-wallet`, `@walletconnect/ethereum-provider@2.25.0` — read from the published tarballs, not from memory).

### F1. The email popup showed wallet rows that can never connect (fixed)

- `w3m-connect-view.walletListTemplate()` renders the wallet surface whenever top-level `enableWallets` is on; AppKit's default is TRUE (`OptionsController.setEnableWallets(options.enableWallets !== false)`). The email instance never set it → the «Continue with a wallet» row + wallet list appeared inside the email popup.
- Every tap there is a **silent no-op, by SDK code**: `ConnectionControllerUtil.onConnectMobile()` is `if (wallet?.mobile_link && wcUri)` — and the email instance has `enableWalletConnect:false`, pairs nothing, so `state.wcUri` is undefined forever.
- **Fix**: `emailSocialOptions()` now sets `enableWallets:false`; `reassertEmailFeatures()` re-asserts it (the flag lives on the shared OptionsController singleton) together with `manualWCControl:false`.

### F2. `manualWCControl` hijacked the email modal's view (fixed)

- `ModalController.open()` checks `OptionsController.state.manualWCControl` **before** the requested `view` and routes mobile devices to `RouterController.reset('AllWallets')`. The flag is shared state, last instance wins. With it standing, the email modal's `open({view:'Connect'})` landed on the searchable wallet list instead of the email box.
- **Fix**: pre-open assertions in BOTH directions — email asserts `manualWCControl:false, enableWallets:false`; `applyAppKitWalletLinks()` now asserts `manualWCControl:true, enableWallets:true` (both updateOptions and the controllers-singleton fallback) before any WC open.

### F3. An email attach failure hung for 30s with zero feedback (fixed; regression test was RED on HEAD)

- `waitForEmailConnection` treated a THROWN attach like a transient miss: kept "retrying" until the 30s open fuse, emitting nothing. The user's report — popup connects, tap continue, wallet page shows nothing — is exactly this silence. `npx vitest run test/wallet-connection-regression.test.js` failed on HEAD (timeout).
- **Fix**: a rejected attach now settles false immediately (`onError` + trace-able `CONNECT_FAILED`); only a false-returning attach (provider null on a slow WebView's first tick) retries, bounded by `MAX_ATTACH_ATTEMPTS = 8`. All 8 regression tests pass again.

### F4. A tap could hand a wallet a DEAD pairing (fixed — measured against the real controllers)

- In `manualWCControl` mode NOTHING resets `ConnectionController.state.wcUri` between attempts: `EthereumProvider.disconnect()` only tears down a **session** (a cancelled/expired pairing emits no provider `disconnect`), and `AppKit.close()` only finalizes. The stale topic survives until the next `display_uri`.
- `w3m-connecting-wc-mobile` fires `onConnect` from its CONSTRUCTOR whenever `this.uri` is truthy — reading that stale state — so the next attempt's first tap could open the wallet on the dead pairing: **app opens to its home screen, no proposal**, while the fresh pairing sat unused. This is the exact asymmetry in the report: the QR (rendered from OUR `display_uri`) always works; the tap (built from AppKit's state) can carry a dead topic.
- **Fix**: `wcAppKitPatch` now carries the live pairing URI (`setLivePairingUri`, fed from `onPairUri`) and reconciles `ConnectionController.setUri(liveUri)` inside the wrapped `onConnectMobile` before the SDK builds any link; `resetAppKitPairingState()` runs in `connectWalletConnect`'s finally so nothing survives an attempt. `test/wc-appkit-reconcile-probe.mjs` reproduces the stale state against the real `@reown/appkit-controllers` singleton and asserts the reconcile (13 checks).

### F5. Why the report looked like "nothing ran at all" (`trace: []`)

- `ourMarker:true` + `sdkLoginMarker:false` + `trace:[]` + 0 WC sessions is the signature of a cold start whose restore path emitted nothing: the most consistent explanation on the reporting device is a **local vault present** (the mount effect skips both restores when `loadVault()` exists, silently) and/or an email attempt whose only failure mode was the F3 silence (no event on the hang, none on success either).
- **Fixes (observability)**: `restore_skipped_vault` is now emitted when a vault skips a pending email restore; `email_connected` is emitted when an email wallet actually attaches. The next health JSON will say which of these worlds we are in instead of an empty trace.

### F6. Cosmetic-but-real: an attached email wallet was labelled generically

- `providerLabel()` had no `case 'email'` — a connected embedded wallet fell through to the generic `wallet.onchain` label. Fixed (`wallet.emailSocial`, key exists in fa/en/locales).

### What was checked and found CORRECT (no change)

- Project id constant + dashboard flags + origin allowlist + both relay hosts + secure site: all proven green by the report itself and re-read from the SDK's own request builders.
- The WC→Reown pin (`@reown/appkit@1.8.19` matching ethereum-provider 2.25.0's own dependency): still correct — one copy of every `@reown/*` singleton in the tree; the F1/F2 conflicts were **state** conflicts on the shared singletons, not duplicate-instance conflicts, and are now asserted away pre-open in both directions.
- Deep-link bytes: `walletLink()` single-encodes the repaired URI exactly once; the intent builder (`intent://wc?uri=…#Intent;scheme=…;package=…`) carries the same payload the QR carries; Trust's live explorer record still advertises `trust://` + `https://link.trustwallet.com` — the registry side is unchanged.

### Verification

- `npx vitest run test/wallet-connection-regression.test.js` → 8/8 (was 7/8 + timeout).
- `node test/email-social-probe.mjs` → pass (now also asserts `enableWallets:false` + the two-way manualWCControl/enableWallets truce).
- `node test/wc-appkit-reconcile-probe.mjs` → 13/13 (new; reproduces F4 on the real SDK).
- `node test/wc-connect-probe.mjs`, `wc-deeplink-probe`, `wc-uri-hygiene-probe`, `wc-wallets-probe`, `wc-storage-probe`, `wc-chain-probe`, `wc-timeout-probe`, `wallet-health-probe`, `walletconnect-wiring` → pass.
- `vite build` → clean.
