# The Solana deep link that opened the wallet and asked for nothing — 2026-09-19

Reported:

> «نه درست نشده و دیپ لينک کار نمی‌ده یعنی وقتی میزنی روی فانتوم میره داخل اپ خود
> فانتوم نصب شده روی گوشی اما هیچ صفحه‌ای نمیاره برای تأیید وصل شدن. و سایت ما را هم
> فانتوم مثلاً مخرب شناخته، ریسک تراکنش می‌ذاره … چرا ارور می‌ذاره بخصوص وقتی بخواد
> امضا کنی»

Persian playbook: **[PROMPT-SOLANA-DEEPLINK-FA.md](PROMPT-SOLANA-DEEPLINK-FA.md)**

The previous branch built the right *request* (`phantom.app/ul/v1/connect`) and the
right *parser* for the answer. The request was never the problem. **The delivery
was**, and that is why the fix did not fix it: a correct URL handed to something
that renders it instead of routing it produces exactly the report above — the
wallet in front of the user, nothing inside it to approve.

---

## 1. Root cause — a Phantom request *is* its query string

```
https://phantom.app/ul/v1/connect?app_url=…&dapp_encryption_public_key=…&redirect_link=…&cluster=…
```

Strip or re-render that query and the wallet has nothing to show. Two of our four
surfaces did exactly that.

### 1a. Inside the APK: a Custom Tab cannot deliver an App Link

`openRequest()` handed the universal link to `@capacitor/browser`, i.e. a **Chrome
Custom Tab**. Custom Tabs deliberately render http/https themselves and never hand
an App Link to another app — custom schemes only. This is documented Chrome
behaviour and the reason "prefer a native app over a Custom Tab" is a best practice
Android had to spell out (`FLAG_ACTIVITY_REQUIRE_NON_BROWSER`).

So inside our own app the request was loaded as a **web page on phantom.app**, in
our task. If the user then tapped their way into Phantom, the app launched *without
the query* — Phantom opens on its home screen. That is the report, verbatim:
«میره داخل اپ فانتوم ولی هیچ صفحه‌ای برای تأیید نمی‌آره».

### 1b. In a browser: the page navigated itself to the wallet

The fallback was `window.location.assign(universal link)`. The wallet got the
request correctly — and this document went with it. The pending promise, the swap
that was waiting on the signature, and the React tree all died with the navigation.
The signature then came back as a **new page load** of `redirect_link`, into a
document that had never heard of the request. Nothing read the stored answer, so
the user returned to a screen that had simply forgotten what they had approved.
That is «چرا ارور می‌ذاره بخصوص وقتی بخواد امضا کنی».

### 1c. The fix — an explicit hand-off, per surface

`deeplinkOpenRoutes({ walletId, url, view })` (`src/lib/solana/deeplink.js`) is now
a table, first route first, and it is pure so the table is assertable in Node:

| Surface | Route | Why |
|---|---|---|
| **APK** | `window.FBTSolanaLink.openWalletLink(url, package)` → `ACTION_VIEW` + `setPackage` | The one route inside a WebView that delivers the URL, query and all, to the wallet's own handler. Custom Tab and `_system` stay behind it as fallbacks for an APK without the bridge. |
| **Android browser (Chromium)** | `intent://phantom.app/ul/v1/connect?…#Intent;scheme=https;package=app.phantom;S.browser_fallback_url=<store>;end`, **in place** | Chrome resolves the intent itself: wallet installed → the navigation never commits, so *this page survives* and its pending promise can still be answered; not installed → it commits to the store page, the one useful destination. |
| **Telegram Mini App** | `Telegram.WebApp.openLink` | Telegram cannot navigate its own WebView. |
| **iOS / desktop / Firefox** | the universal link | Safari offers the app switch and delivers the full URL. |

Package names were read from the store listings, not guessed — `app.phantom`,
`com.solflare.mobile`, `app.backpack.mobile`. A wrong package fails **closed**: the
intent resolves to nothing and the next route is tried. The native bridge accepts
only an https URL on one of the three hosts, under `/ul/`, paired with the package
that host belongs to; neither half is trusted alone.

---

## 2. «فانتوم سایت ما را مخرب شناخته» — three warnings, one sentence

From Phantom's own documentation (`docs.phantom.com` → *Domain and transaction
warnings*), checked rather than assumed:

| Warning | What produces it | Fixable here? |
|---|---|---|
| «This domain is new or has not been reviewed yet. Proceed with caution.» | Automatic for a newly seen domain; Phantom states it clears after review, and to use their domain-review form if it is still there after a week | ❌ No code can switch it off. §5 |
| «This app's identity could not be verified. It may be impersonating another app.» | MWA only: no `/.well-known/assetlinks.json` on the claimed domain, or an `authorize` whose `identity.uri` does not point at it | ✅ §3 |
| «This dApp could be malicious. Do not proceed unless you are certain it is safe.» | The **transaction simulation** warning — Phantom could not predict the transaction's outcome. A property of the transaction, not of the domain | ✅ §4 |

The last one is the one that fires «بخصوص وقتی بخواد امضا کنی», and it is not a
reputation problem at all.

---

## 3. App identity — `scripts/assetlinks.mjs`

Phantom verifies a native Android dApp by fetching
`https://<claimed domain>/.well-known/assetlinks.json` and matching our package name
and the SHA-256 of our **signing** certificate against it (Android's Digital Asset
Links; the same file MWA's dapp-identity spec reads). The file did not exist.

* `scripts/assetlinks.mjs` writes `public/.well-known/assetlinks.json` from the
  keystore itself (`keytool -list -v`) or from a fingerprint you already have, and
  **refuses to write a placeholder** — a wrong fingerprint verifies nothing while
  looking like it does, which is worse than no file because the next person
  believes the step is done. `--check` validates what is committed.
* `npm run assetlinks` / `npm run assetlinks:check`.
* `registerMwa`'s `appIdentity.uri` was `publicAppUrl('/')`, i.e. a URL *with a
  path*. It is now the bare **origin** (`identityOrigin()`), so the verification
  request is `https://fbtswap.ir/.well-known/assetlinks.json` and not
  `https://fbtswap.ir//.well-known/…`.

With Play App Signing, use the **app signing key** certificate from the Play
Console, not the upload key. Phantom re-verifies on the next connection; no
submission is needed.

## 4. The simulation warning, decided before the wallet opens — `src/lib/solana/signGuard.js`

Phantom's published remedies are a short list, and every item on it is a property
of the transaction: one signer; `signTransaction` first when it needs several;
split or use lookup tables near the size limit; simulate with `sigVerify: false`.

`inspectSolanaTransaction()` reads the compiled message header directly — with the
versioned-transaction prefix handled, because reading byte 0 of a versioned
transaction as `numRequiredSignatures` yields 128+ and calls every Jupiter swap
"multi-signer". It needs neither `@solana/web3.js` nor a browser, so it is
assertable in plain Node.

The verdict now travels with the request: `warnings` are stored on the pending row,
emitted with the waiting state, attached to the result, and kept on the stored
answer — so a signature that arrives as a page load can still explain itself.

And the honest failure code: on a route that navigated this document away, a sign
returns **`IN_WALLET`**, not `SIGN_FAILED`. The approval is still happening; it
simply cannot be resolved by a page that is already gone. `deeplinkSignError()`
maps the codes, and `SolanaWalletTab` reads the stored answer on the next load and
shows a card with the reason and a link to the transaction — instead of silence.

## 5. What this repository cannot do

* **The new-domain warning.** It is Phantom's, it is automatic, and it clears on
  review. If it is still there after a week: their domain-review form. The connect
  sheet now says this out loud, and says explicitly that we will never ask a user
  to dismiss a wallet warning — «continue anyway» advice is itself a scam pattern.
* **The signing fingerprint.** Only whoever holds the release keystore can produce
  it; hence the generator rather than a committed guess.

---

## Changed

| File | What |
|---|---|
| `src/lib/solana/deeplinkUri.js` | per-wallet `androidPackage` + `install`; `androidIntentRequestUrl()`; `deeplinkWalletHost()`, `deeplinkInstallUrl()` |
| `src/lib/solana/deeplink.js` | `deeplinkOpenRoutes()` + `runRoute()`; `openRequest()` returns `{ok, route, navigatedAway}`; sign guard; `IN_WALLET`; warnings on pending/result |
| `src/lib/solana/signGuard.js` | **new** — message-header inspection, `MULTI_SIGNER` / `TX_OVERSIZE`, the documented op |
| `src/lib/solanaWallet.js` | `identityOrigin()` for MWA; `deeplinkSignError()` |
| `src/components/SolanaConnectSheet.jsx` | the three-warning explainer |
| `src/components/SolanaWalletTab.jsx` | the signature that came back as a page load |
| `android/.../MainActivity.java` | **new** `FBTSolanaLink` JavascriptInterface |
| `android/.../AndroidManifest.xml` | `<queries>` for the three wallet packages |
| `scripts/assetlinks.mjs` | **new** — generator + `--check` |
| `scripts/wallet-reputation-check.mjs` | two new rows: the connect-dialog metadata origin, `assetlinks.json` |
| `src/i18n/locales/{fa,en,ar}.json` | `solana.connect.warn*`, `solana.err.IN_WALLET`, `solana.signNotice.*` |

## Verification

```
npm run test:solana-connect     # probe: all assertions passed · vitest 9/9 (was 5)
npm run test:wallet-connection  # stack probe + 26 tests, all green
npx vite build                  # ✓ built in 45.93s
npm run assetlinks:check        # ✗ absent → says so, with the fix (no placeholder)
npm run assetlinks -- --fingerprint=AA:BB:… && npm run assetlinks:check   # ✓ writes + validates
```

Newly locked behaviour (`test/solana-deeplink-probe.mjs`, `test/solana-connect-sheet.test.jsx`):

* Android Chrome hands the request over as a package-scoped intent and **does not
  navigate this page**; an Android WebView and Firefox on Android get no intent
  route; iOS falls back to the universal link; every view still ends at the
  universal link.
* Inside the APK the first route is the native bridge with the right package, and
  the Custom Tab is only ever behind it — asserted against the real
  `SolanaConnectSheet` with a stubbed bridge, and again with no bridge at all.
* A single-signer transaction is not flagged; a two-signature one is named
  `MULTI_SIGNER` **before** the wallet opens; one over 1232 bytes is `TX_OVERSIZE`.
* A route that navigates away returns `IN_WALLET`, and the signature that comes
  back is stored for the next document.
* The wallet tab tells the user a page-load signature happened, says why the wallet
  warned, and reads the record once.

## Manual checks worth doing on a phone

- [ ] **APK (rebuilt)** → Connect → Phantom: the approval screen appears with the
      request in it; Back lands in our app, still on «منتظر تأیید…».
- [ ] **Chrome on Android** → Connect → Phantom: the address bar stays on
      fbtswap.ir; approving returns to a page that is already connected.
- [ ] **iOS Safari** → Connect → Phantom → approve: the reload shows the address.
- [ ] Sign a swap on the APK: the wallet shows its transaction screen and the
      signature lands in the app without a reload.
- [ ] Sign on iOS: on return, the wallet tab shows the signature card, not silence.
- [ ] `npm run assetlinks` with the release keystore, deploy, then
      `curl --fail https://fbtswap.ir/.well-known/assetlinks.json`.
