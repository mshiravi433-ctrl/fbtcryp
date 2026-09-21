# Wallet connection — audit, fixes, diagnostics, and test matrix (2026-09-21)

## خلاصهٔ فارسی

هر دو مسیر کیف پول بررسی و تعمیر شد: **EVM (WalletConnect/Reown)** و **سولانا
(Deep Link + Mobile Wallet Adapter + Wallet Standard)**. هیچ صفحه‌ای حذف نشد،
هیچ سیستمی از صفر بازنویسی نشد و هیچ رفتاری با دمو/ماک جایگزین نشد.

سه موردی که در همین پاس پیدا و تعمیر شد:

1. **`src/lib/wc/health.js`** دو تابع `configProbeUrl`/`originsProbeUrl` را
   دوباره export می‌کرد ولی import نمی‌کرد → هر اجرای Health Panel با خطای
   `configProbeUrl is not defined` تمام می‌شد و همهٔ ردیف‌ها «نامشخص» می‌شد.
2. `codeStatus`/`dashboardStatus` در گزارش Health Panel همیشه `—` بود (فقط CLI
   آن‌ها را می‌ساخت) → حالا از **همان** موتور verdict می‌آید: `CODE STATUS: PASS`
   / `DASHBOARD STATUS: DOMAIN NOT REGISTERED`، با نام دقیق origin و لینک داشبورد.
3. `getSolanaPublicKey()` همیشه `window` سراسری را می‌خواند؛ حالا پنجرهٔ
   فراخوان را می‌خواند، پس لایه و تست‌ها یک حرف را از دو منبع نمی‌گیرند.

**کاری که فقط شما می‌توانید انجام دهید (از کد قابل حل نیست):**
`dashboard.reown.com → project 5997d5aee8bb42f43ddec4b1a5f94eb1 → Configuration →
Domain → «+ Domain»` و افزودن `https://fbtswap.ir`, `https://www.fbtswap.ir`,
`https://localhost`، سپس Allowlist. تا آن زمان خروجی درست این است:

```
CODE STATUS      : PASS
DASHBOARD STATUS : DOMAIN NOT REGISTERED
```

**assetlinks.json** بدون اثر انگشت SHA-256 **واقعی** گواهی امضا ساخته نمی‌شود؛
اسکریپت `--ensure` عمداً چیزی نمی‌نویسد تا فینگرپرینت از خود گواهی استخراج شود.

---

## 1. What was wrong (found and fixed in this pass)

| # | Defect | Where | Effect before the fix | Fix |
|---|--------|-------|-----------------------|-----|
| 1 | `configProbeUrl` / `originsProbeUrl` re-exported but never imported | `src/lib/wc/health.js` | every panel run threw `configProbeUrl is not defined`; the report came back as `{error}` and the UI blamed the network | both are now imported as well as re-exported (a `export … from` does **not** create a local binding) |
| 2 | `codeStatus` / `dashboardStatus` only existed in the CLI's report | `health.js`, `diagnostics.js` | panel printed `CODE STATUS: — · DASHBOARD STATUS: UNKNOWN` even when the registry had answered | extracted into `diagnosisStatuses()` and used by **both** the CLI and the panel, so the two can never disagree |
| 3 | The panel did not name the origin needing registration | `WalletHealthPanel.jsx` | «Invalid domain» with no actionable row | a `DOMAIN_NOT_REGISTERED` row prints the measured origin + the dashboard link (`wallet.healthVerifyFix`) |
| 4 | `getSolanaPublicKey()` read the global window only | `src/lib/solana/walletLayer.js` | a caller that passed its own window got `null` (or another window's address) | resolves the passed window's provider → deeplink session → `solanaAddress()` |
| 5 | Solana connections never notified the unified wallet state | `src/lib/solanaWallet.js`, `src/lib/solana/deeplink.js` | Intent OS planned against a snapshot that never learned a Solana wallet connected | both emit points now call `notifyWalletState('solana')` |
| 6 | `walletStateForIntent()` had no normalised `wallets` object | `src/lib/walletState.js` | `drivers.wallets` threw `Cannot read properties of undefined (reading 'evm')` | returns `wallets: { evm, solana, bitcoin }` (the shape the audit asks for) **and** keeps the flat aliases |
| 7 | Explicit wallet contexts were ignored by the driver set | `src/lib/intent-ai/autonomy/browserDrivers.js` | `buildAutonomyDrivers({ wallet, solana })` reported «not connected» in Node/tests | per-channel merge: an injected channel defines that channel, an absent one falls back to the live read |
| 8 | Two stale panel tests asserted the **removed** `/.well-known/walletconnect.txt` row | `test/wallet-health-panel.test.jsx` | red suite (also red at `041ae23`) | rewritten: the fixture now runs the **real** verdict engine, and the tests assert the deprecated row is *absent* |
| 9 | The futures probe expected a silent connect (no approval step) | `test/futures-onchain-probe.jsx` | red at `041ae23` (58/59) | asserts the shipped two-tap flow instead: Connect → **our** sheet → approve → return to the order (61/61) |

Nothing was removed: every route (Wallet, Swap, Intent OS, Market, Earn, Signal,
Bridge, Lending, Farm, Futures, RWA, Rewards, Ecosystem, Explore, Discover,
Security, Lab) still exists and is asserted by the probe.

## 2. The diagnostic you asked for

```bash
npm run walletconnect:check            # exit 1 unless the verdict is OK
npm run walletconnect:check -- --origin=https://www.fbtswap.ir
npm run walletconnect:check -- --packaged      # the Capacitor WebView
npm run walletconnect:check -- --json
```

It prints (verbatim, from this repository, with no network):

```
Registry (project domain allowlist)
  ⚠️  unreadable — fetch failed

Metadata the wallet receives
  url       = https://fbtswap.ir
  verifyUrl = https://fbtswap.ir
  icons[0]  = https://fbtswap.ir/icon-512.png

Measured facts
  projectId              : 5997d5aee8bb42f43ddec4b1a5f94eb1
  window.location.origin : https://fbtswap.ir
  metadata.url           : https://fbtswap.ir
  metadata.verifyUrl     : https://fbtswap.ir
  allowed origins (code) : https://fbtswap.ir, https://www.fbtswap.ir, https://localhost
  origin match           : PASS (metadata.url === origin)
  project config         : fetch failed
  allowlist              : unreadable — fetch failed
  verify service         : unreachable — fetch failed · attestation not measured (no document)
  relay                  : UNREACHABLE (0/2 socket(s) open)
  final diagnosis        : RELAY_UNREACHABLE
  CODE STATUS            : PASS
  DASHBOARD STATUS       : UNKNOWN
```

The three machine-readable states the order asked for are produced by
`diagnosisStatuses()`:

| fact | value |
|------|-------|
| code is right, domain registered | `CODE STATUS: PASS` · `DASHBOARD STATUS: REGISTERED` |
| code is right, dashboard missing the origin | `CODE STATUS: PASS` · `DASHBOARD STATUS: DOMAIN NOT REGISTERED` |
| the registry could not be read | `CODE STATUS: PASS` · `DASHBOARD STATUS: UNKNOWN` |

### The eight verdicts (`src/lib/wc/diagnostics.js`)

| code | owner | meaning |
|------|-------|---------|
| `OK` | — | every measured hop answered and agrees |
| `ORIGIN_MISMATCH` | CODE | `metadata.url` ≠ the page origin (the packaged WebView is exempt: it declares the canonical public origin) |
| `DOMAIN_NOT_REGISTERED` | DASHBOARD | the registry answered and this origin is not in it (or is empty) |
| `VERIFY_SERVICE_UNREACHABLE` | NETWORK | the enclave could not be reached **and** no attestation exists |
| `PROJECT_ID_MISMATCH` | CODE_OR_CONFIG | the dashboard answers 403/404 for this project id |
| `METADATA_MISMATCH` | CODE | name/description/https url/icons/verifyUrl or the declared origins are wrong |
| `RELAY_UNREACHABLE` | NETWORK | no relay host opened a **WebSocket** socket |
| `SDK_CONFIGURATION_ERROR` | CODE | the SDK facts fail their own shape checks (`PROJECT_ID_SHAPE`, `METADATA_*`, …) |

Everything non-OK carries `findings[]`, and only `CODE` / `CODE_OR_CONFIG` are
allowed to print `CODE STATUS: FAIL` — a dashboard problem is never reported as a
code failure, and a code problem is never excused as «somebody forgot to click».

### Relay measurement

`wss://relay.walletconnect.org` **and** `wss://relay.walletconnect.com` are both
probed with a real, authenticated WebSocket (JWT via `@walletconnect/relay-auth`),
never inferred from HTTPS. The existing failover order is preserved
(`relayOrderFromHosts`), a probe timeout never tears down a healthy pairing, and
no pairing/session lifetime was shortened.

## 3. WalletConnect test matrix (19 items)

| # | Item | Where it is locked |
|---|------|--------------------|
| 1 | exactly one metadata builder | `test/wallet-diagnostics-probe.mjs` §1 |
| 2 | `metadata.url` = `window.location.origin` on `fbtswap.ir` | §1, §3 |
| 3 | same on `www.fbtswap.ir` (its own origin, not the parent) | §2 |
| 4 | packaged Android declares the canonical origin, never claims `localhost` is public | §1, §2 |
| 5 | dev server does not claim localhost either | §1 |
| 6 | project id is a source constant, never a `VITE_*` env read | §1 |
| 7 | the hard-coded public project id is preserved (`5997d5aee8bb42f43ddec4b1a5f94eb1`) | §1 |
| 8 | `verifyUrl` agrees with `metadata.url`, icon is same-origin | §1 |
| 9 | the code-declared allowlist names all three origins | §1, §3 |
| 10 | an empty registry is `DOMAIN_NOT_REGISTERED` even when everything else answers | §2 |
| 11 | the domain cause is owned by DASHBOARD, never by CODE | §2 |
| 12 | 403/404 on the project config is `PROJECT_ID_MISMATCH` | §2 |
| 13 | no relay socket anywhere is `RELAY_UNREACHABLE`; one open host is enough | §2 |
| 14 | a malformed SDK configuration is `SDK_CONFIGURATION_ERROR` | §2 |
| 15 | both relay hosts are measured, over WebSocket, in the configured order | §3 |
| 16 | the CLI prints projectId / origin / metadata.url / verifyUrl / allowed origins / origin match / project config / allowlist / verify reachability / verdict | §3, `npm run walletconnect:check` |
| 17 | no pairing URL is handed to same-tab navigation (`location.assign` / `href` / `_self` / `openHref`) | §8 (asserts `mode: 'place'` exists **only** for `intent://`) |
| 18 | the lifecycle is NAMED: IDLE / CONNECTING / WALLET_OPENED / AWAITING_APPROVAL / APPROVED / PROVIDER_ATTACHING / CONNECTED / REJECTED / TIMEOUT / FAILED / RECOVERABLE, derived from measured facts, with a legal-move table | `src/lib/wc/flowState.js`, probe §7c |
| 19 | no verification file / DNS record is fabricated, and «verified» is never claimed when the service says otherwise | §1, §8 |
| — | the AppKit opener can never use `_self` | §8 |

## 4. Solana test matrix (21 items)

| # | Item | Where it is locked |
|---|------|--------------------|
| 1 | a deep link carries a **real approval request** (`app_url`, `dapp_encryption_public_key`, `redirect_link`, `cluster`) | `test/solana-deeplink-probe.mjs` (simulated wallet) |
| 2 | not Phantom-only: Phantom, Solflare, Backpack routes | same + `wallet-diagnostics-probe` §4 |
| 3 | Wallet Standard wallets are detected and usable | §4, `walletLayer.detectSolanaWallets()` |
| 4 | MWA preferred on Android Chrome; never claimed on iOS | `canUseMwa()` gate (not native shell, Android, Chrome/CriOS) + §4 |
| 5 | unified layer exposes `connect/disconnect/getPublicKey/signMessage/signTransaction/signAllTransactions/signAndSendTransaction` | §4, §7b |
| 6 | capabilities are measured per transport, unsupported methods refused **with a reason** | §4, §7b |
| 7 | `getPublicKey()` reads the caller's window before the global one | §7b |
| 8 | `signMessage` returns base64 and names its encoding | §7b |
| 9 | a user rejection maps to `REJECTED`, not to prose | §7b |
| 10 | `signAllTransactions` is `UNSUPPORTED` where the transport has no such request | §7b |
| 11 | `signAndSendTransaction` refuses rather than throwing when unavailable | §7b |
| 12 | no signature without an explicit user action | §7b (`SolanaConnectSheet`, futures probe) |
| 13 | simulate-before-sign / non-simulable transaction detection | `src/lib/solana/signGuard.js`, `src/lib/launch/solana/signing.js` (`simulateTransaction`) |
| 14 | never requests a seed phrase, private key or password; no hidden custodial signer | §7b, `walletLayer.js` |
| 15 | pending request survives navigation / refresh / activity recreation | `fbt:solana:pending:v1` store + `solana-deeplink-probe` |
| 16 | expired requests are cleared safely | same (15-min TTL, `NO_PENDING`) |
| 17 | the return flow answers on the callback route (`ir.fbtswap.app://solconnect?rid=…`) | `solana-deeplink-probe`, `test/solana-connect-sheet.test.jsx` |
| 18 | `assetlinks.json` uses the **real** signing cert SHA-256; identity URI is the bare origin | `src/lib/solana/assetlinks.js`, `scripts/assetlinks.mjs`, probe §5 |
| 19 | reputation warning ≠ identity verification ≠ simulation risk | `WALLET-SCAM-WARNING-2026-09-19.md`, `scripts/wallet-reputation-check.mjs`, `signGuard.js` |
| 20 | EVM / Solana / Bitcoin state never overwrite each other; Intent OS can query them | probe §7, `test/intent-ai/autonomy-drivers-probe.mjs` |
| 21 | device tests (documented below) | this document |

## 5. What only a device / the dashboard can finish

**Dashboard (must be done by hand, no code can do it):**
`https://dashboard.reown.com/project/5997d5aee8bb42f43ddec4b1a5f94eb1` →
Configuration → Domain → add `https://fbtswap.ir`, `https://www.fbtswap.ir`,
`https://localhost` → Allowlist → add App ID `ir.fbtswap.app`.
After that, `npm run walletconnect:check` must print `REGISTERED` from a machine
with network access; until then the honest answer is `DOMAIN NOT REGISTERED` /
`UNKNOWN`.

**assetlinks.json (needs the real certificate):**

```bash
# upload key (Termux/desktop):
npm run assetlinks -- --keystore=release.jks --storepass=… --alias=… --keypass=…
# Play App Signing: add Google's certificate as a second entry
FBT_ANDROID_SHA256_PLAY=AA:BB:… npm run assetlinks -- --keystore=… 
npm run assetlinks:check     # local file
npm run assetlinks:remote    # the deployed file
```

`ci/make-keystore.sh` now prints **both** the SHA-1 (to compare with the Play
Console) and the SHA-256 (the one `assetlinks.json` needs) and the exact command.
The identity URI written is the bare `https://fbtswap.ir/` — never a path.

**Device tests (cannot be automated here):**

1. Android Chrome → `https://fbtswap.ir` → Phantom → Connect: a **real approval
   screen** appears in Phantom, approving returns to fbtswap.ir with the address.
2. The same with Solflare, and with Backpack.
3. APK round trip: connect in the packaged app (`https://localhost`), background
   the app, return — the pairing must still be alive (it is not declared to be a
   verified public domain, and the diagnostic says so).
4. Desktop WalletConnect/EVM: QR pairing + deep-link wallet, unchanged.
5. iOS: WalletConnect/Reown works; **MWA is not claimed and not advertised**.

## 6. Deploy paths verified

| path | check |
|------|-------|
| `vercel.json` | `buildCommand: npm run build:full`; `build:full` now runs `node scripts/assetlinks.mjs --ensure` **before** the vite build, so `/.well-known/assetlinks.json` ships whenever `FBT_ANDROID_SHA256` / `FBT_ANDROID_SHA256_PLAY` is set — and is silently skipped (never invented, never fatal) when it is not. |
| static serving | Vite copies `public/` recursively, dot-directories included — verified: `public/.well-known/assetlinks.json` → `dist/.well-known/assetlinks.json`. |
| `capacitor.config.json` | `appId ir.fbtswap.app`, `androidScheme: https` ⇒ the packaged origin is `https://localhost`, and there is **no** `server.url`, so the WebView loads the shipped bundle. |
| APK signing | `android/app/build.gradle` attaches the release signing config only when `ANDROID_KEYSTORE_PATH` exists; `.github/workflows/build-apk.yml` passes the four keystore secrets through an explicit `env:` block (a workflow that relies on secrets being auto-exported silently falls back to a debug APK). |
| `ci/make-keystore.sh` | now prints the SHA-256 and the exact `npm run assetlinks -- --keystore=…` command, plus the Play App Signing note (the installed APK is signed by Google's certificate, so both entries are needed). |

## 7. Evidence from this environment (2 vCPU / 4 GiB, no network)

| command | result |
|---------|--------|
| `node test/wallet-diagnostics-probe.mjs` | **154 / 154** |
| `node test/walletconnect-stack-probe.mjs` | **381 / 381** |
| `node test/solana-deeplink-probe.mjs` | all assertions passed (simulated wallet) |
| `npx vitest run test/wallet-health-panel.test.jsx test/wallet-session-lease.test.jsx test/network-select.test.jsx test/solana-connect-sheet.test.jsx` | **41 / 41** |
| `node test/intent-ai/autonomy-drivers-probe.mjs` | **37 / 37** |
| `node test/futures-onchain-run.mjs` | **61 / 61** (58/59 at `041ae23`) |
| `NODE_OPTIONS=--max-old-space-size=3072 npm run build` | **exit 0** — `✓ built in 39.07s`, 7 landing pages + sitemap |
| `npm run walletconnect:check` | exit 1 — `VERIFY_SERVICE_UNREACHABLE` / `RELAY_UNREACHABLE` (no network here), `CODE STATUS: PASS` |
| `npm run walletconnect:register:check` | exit 0 — checklist + honest «registry could not be read from this host» |
| `npm run assetlinks:check` | exit 1 — the file is generated from the real keystore, and there is none in this checkout |
| connect-sheet mount probe (`test/.out/wcsheet`, used by `npm test`) | **17 / 17** |
| the suite's own speculation build, run on its own (`VITE_ENABLE_SPECULATION=true npx vite build`) | **exit 0** |
| `npm test` | **not completable in this sandbox**: every suite up to the in-suite `dist/` builds is green, then the 4 GiB / 2 vCPU box kills the last child build — `status 137` (kernel) with the default 3072 MB heap, still `status 137` with `FBT_TEST_BUILD_HEAP=--max-old-space-size=2560`, and a V8 abort (`status 134`) at 2048 MB. That same build passes on its own (row above), so the limit is the box, not the build. Run `npm test` on a machine with ≥8 GiB (`FBT_TEST_BUILD_HEAP` exists for exactly this). |

Nothing above is reported as green that was not actually run.

## 8. Files touched in this pass

```
src/lib/wc/flowState.js              NEW — the eleven named lifecycle states + legal moves
src/lib/wc/health.js                 the missing imports, the two status lines, the flow state
src/lib/wc/diagnostics.js            diagnosisStatuses() extracted (one source for CLI + panel)
src/lib/wc/index.js                  exports diagnosisStatuses and the flow-state API
src/components/WalletHealthPanel.jsx the DOMAIN_NOT_REGISTERED row (origin + dashboard link)
src/lib/solana/walletLayer.js        getPublicKey({win}), unsupportedResult(method,{win})
src/lib/solana/assetlinks.js         normalizeFingerprint accepts the bare 64-hex form too
src/lib/solanaWallet.js              notifies the unified wallet state on every change
src/lib/solana/deeplink.js           same, for the deeplink transport
src/lib/walletState.js               the normalised wallets:{evm,solana,bitcoin} object
src/lib/intent-ai/autonomy/browserDrivers.js   per-channel merge of injected + live state
src/hooks/useSolanaWallet.js         signing + capabilities through the unified layer
scripts/walletconnect-domain-verify.mjs        measures the origin as if served there
scripts/assetlinks.mjs               --check | --remote | --ensure (never invents a value)
ci/make-keystore.sh                  prints SHA-256 + the exact assetlinks command
test/wallet-diagnostics-probe.mjs    NEW — 144 assertions, the whole matrix above
test/wallet-health-panel.test.jsx    fixture runs the real verdict engine
test/futures-onchain-probe.jsx       the approval-sheet step (was red at HEAD)
test/run.mjs                         registers the diagnostics probe in `npm test`
```
