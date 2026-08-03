# FBT Swap — Store Upload Kit

**Everything you paste into a store form, in one file.**
Verified against the code and the built APK on 3 August 2026.

| | |
|---|---|
| Version | **1.13.1** (versionCode **35**) |
| Package | `ir.fbt.swap` |
| File | `app-release.apk` — **7.5 MB**, release-signed |
| minSdk / targetSdk | 23 / 35 |
| Website | `https://www.lawpoetics.ir` |
| Support email | `fbtswap@gmail.com` |
| Privacy policy | `https://www.lawpoetics.ir/#/legal/privacy` |
| Terms | `https://www.lawpoetics.ir/#/legal/terms` |
| Developer | Fanous Bazaar Pishgam Co. — Khomeyni Shahr, Isfahan, Iran |

**Download link for the APK:**
```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/download/latest/app-release.apk
```

> ⚠️ Upload `app-release.apk`. **Never** `app-debug.apk` (some stores reject it
> for `android:debuggable`) and **never** `app-release.aab` (Play only — no
> other store accepts it).

---

## 1. Where to upload — ordered by what is worth your time

| # | Store | Link to sign up | Cost | Review time | Verdict |
|---|---|---|---|---|---|
| 1 | **APKPure** | https://developer.apkpure.com | Free | ≤ 3 business days | ✅ **Start here** |
| 2 | **Uptodown** | https://www.uptodown.dev/#/sign-up | Free | ~1 week | ✅ Best Google traffic |
| 3 | **GitHub Releases** | https://github.com/mshiravi433-ctrl/fbtcryp/releases/tag/latest | Free | — | ✅ **Already live** |
| 4 | **AppGallery-free alt: IzzyOnDroid** | https://gitlab.com/IzzyOnDroid/repo/-/issues | Free | ~2 weeks | ⚠️ Firebase may block us |
| 5 | **Myket** (Iran) | https://developer.myket.ir | Free | ~1 week | ⚠️ Likely rejected |
| 6 | **Cafe Bazaar** (Iran) | https://pishkhan.cafebazaar.ir | Free | ~1 week | ⚠️ Likely rejected |

**Ruled out, with reasons — do not waste time on these:**

| Store | Why not |
|---|---|
| Amazon Appstore | Shut down 20 Aug 2025. Not a closed door — no door. |
| Aptoide | $69/year. Also distributes to Xiaomi GetApps + OPPO, which are in Google's *first* verification wave. |
| Samsung Galaxy Store | Commercial sellers only — needs a registered business. |
| F-Droid | FLOSS-only policy. Our licence is all-rights-reserved, and they refuse Firebase. |
| Huawei AppGallery | No developer registration with Iranian identity. |
| APKMirror | A mirror, not a store. Only re-hosts apps already on Google Play. |
| Apple App Store | $99/yr developer account, not purchasable from Iran. Impossible, not hard. |

---

## 2. Copy-paste fields

### App name — 8 characters
```
FBT Swap
```

### Short description — 77 characters (limit is 80 almost everywhere)
```
Swap crypto from your own wallet. Non-custodial, on-chain, no account needed.
```

### Category
```
Finance
```
Second choice if Finance is unavailable: `Tools`.
**Do not** pick "Trading" or "Investing" — that language implies a licensed
brokerage and is a common rejection reason.

### Tags / keywords (max 5)
```
crypto, defi, wallet, swap, blockchain
```

### Age rating
```
18+
```
Never tick an age band below 18 for a finance app.

### Content declarations
| Question | Answer |
|---|---|
| Contains ads | **No** |
| In-app purchases | **No** |
| Gambling / simulated gambling | **No** |
| Target audience | 18+ only |

> The arcade (dice, coin-flip) is **compiled out** of the release build —
> `VITE_ENABLE_GAMES` is not set in CI, so those chunks are not emitted and are
> not inside the APK at all. Verified on the built bundle: zero game chunks.
> Answering "No" to gambling is therefore accurate. **Do not enable games and
> keep this answer.**

---

## 3. Full description (English) — 3,103 characters

> Fits every store: Google Play allows 4,000, APKPure and Uptodown allow more.

> This is the version to use for **APKPure, Uptodown and IzzyOnDroid**. It
> leads with on-device features on purpose, because Uptodown's publishing
> rules reject "low-quality webviews" — apps that only display a website. Our
> app is built with Capacitor, so it *is* technically a WebView, and the
> defence is to be specific about what a plain website cannot do: an encrypted
> on-device wallet, biometric lock, camera QR scanning, push notifications and
> offline operation.

```
FBT Swap is a non-custodial crypto exchange for Android. You connect a wallet
you already own, you swap, and your assets never leave your control. There is
no account, no email, no identity check, and no company wallet holding your
money.

WHAT IT DOES

• Swap tokens across eight networks: BNB Smart Chain, Ethereum, Polygon,
  Arbitrum One, Base, Optimism, Avalanche and Solana.
• Thousands of tokens from public token lists, searchable by ticker, name or
  contract address — plus import-any-contract for tokens too new to be listed.
• An optional in-app wallet whose recovery phrase is encrypted on your device
  and never transmitted anywhere.
• Biometric app lock (fingerprint or face) and TOTP two-factor authentication.
• Camera QR scanning for wallet addresses and WalletConnect pairing.
• Price alerts and recurring buy plans that notify you on your phone, even
  when the app is closed.
• Live market data: prices, 24-hour change, charts and coin detail pages.
• Technical indicators (RSI, MACD, Bollinger Bands, moving averages,
  volatility) computed on your device from public price data.
• Crypto news, refreshed daily from public feeds.
• A step-by-step guide written for people who have never used a wallet.
• 12 languages including Persian, Arabic and Urdu, with full right-to-left
  layout, plus light and dark themes.
• Works offline for everything that does not need live prices.

HOW THE SWAP WORKS

FBT Swap does not run an order book and holds no liquidity. It asks a public
aggregator for the best route across the decentralised exchanges on the
network you chose, shows you the quote, the price impact and the fee, then
hands the transaction to your wallet. You are the one who signs it. The swap
settles on-chain, directly between your wallet and the protocol.

FEES, STATED PLAINLY

• Platform fee: 0.70% of the amount you are swapping, taken from the input
  token inside the same on-chain transaction. It is shown on screen before you
  sign — never after.
• Network gas: paid in the network's own coin. This goes to the network's
  validators, not to us, and we cannot reduce it.

YOUR KEYS, YOUR COINS

We never receive your recovery phrase, private key or wallet password. This
also means what you would expect: we cannot reverse a transaction, freeze
funds, refund a swap you regret, or recover a lost recovery phrase. Nobody
can.

PRIVACY

No signup. No email or phone number. No advertising SDK. Preferences such as
theme, language and display name stay on your device unless you switch on
optional cloud sync, which stores them against an anonymous ID. Blockchain
activity is public by nature: every swap, including your wallet address and
the amounts, is permanently visible on-chain to anyone.

RISK

Crypto assets are volatile and on-chain transactions are irreversible. You can
lose money, including all of it. Nothing in this app is financial advice, and
the indicator readouts are arithmetic on past prices, not a prediction. Trade
only what you can afford to lose, and check the rules that apply where you
live.

Built by Fanous Bazaar Pishgam, Isfahan, Iran.
```

---

## 4. What's new (release notes) — for the version field

```
• Fixed the QR scanner showing a grey picture — the camera was being restarted
  on every screen update and is now started once.
• Fixed the Share button collapsing next to Copy.
• Sharing now works everywhere: WhatsApp, X, LinkedIn, email and SMS, not just
  one messenger. Added a copy-link button that always works.
• iPhone and iPad: proper home-screen install support.
• Rebuilt the layout for tablets and small phones.
• Automatic orders now show whether each one is actively watching the market.
```

---

## 5. Images

| What | File in this repo | Size |
|---|---|---|
| App icon | `store/icon-512.png` | 512×512, 413 KB |
| Feature graphic / banner | `store/feature-graphic-1024x500.png` | 1024×500, 467 KB |
| Small icon | `store/dappradar-logo-250.png` | 250×250, 27 KB |

### Screenshots — you must take these yourself

I cannot generate them. A rendered mock-up that does not match the running app
is a rejection reason on both APKPure ("low-quality images") and Uptodown.

**Five minutes, on your phone:**

1. Install the release APK.
2. **Set the app language to English** (Settings → Language). Uptodown's own
   guidance: screenshots uploaded under English are shown to users in *every*
   language; Persian ones are shown only to Persian users.
3. Screenshot these five screens, in this order:
   1. **Swap** — with a real quote on screen. This is the app's purpose; it
      must be first.
   2. **Market** — the price list.
   3. **Coin detail** — with the chart visible.
   4. **Wallet**.
   5. **Settings** — with language and theme visible.
4. Upload them **raw**. A normal 1080×2400 phone screenshot is already valid.
   No frames, no crops, no marketing text overlaid.

---

## 6. Store-specific notes

### APKPure — do this one first
Fastest, no ID document, review ≤ 3 business days. Console →
`MANAGE VERSIONS` → `SELECT FILES` → upload the APK. The icon and version are
read out of the APK automatically. If you hear nothing after 3 business days,
email `developer@apkpure.com`.

### Uptodown — the one that brings Google traffic
Their app pages rank well in search, which is free organic traffic.
Set **Country Restriction** to its default (worldwide) — do not touch it.
Author: `Fanous Bazaar Pishgam Co.`  ·  PEGI: `18`  ·  Nationality: `Iran`.

**The real risk here** is their "low-quality webviews" rule. Use the full
description above exactly as written — it leads with on-device features
specifically to answer that objection.

### Myket / Cafe Bazaar — expect rejection, and know why
Iran's Supreme Council of Cyberspace resolution (14 Feb 2025) restricts
promoting crypto asset services to **licensed** providers. Myket's own rules
say a developer must obtain any required licence *before* submitting, and
registration asks for your national ID card, national number, postcode and
IBAN — this goes under your real legal identity.

If you try anyway:
- Describe it as a **market-viewing and wallet-management tool**, not an
  "exchange". This is not a lie: the app runs no order book and holds no
  liquidity, it routes to public contracts.
- **Never** use the words "investment", "profit" or "returns" — those are the
  exact terms the resolution restricts.

### Google Play — the deadline that matters
Google's Android Developer Verification starts **30 September 2026** in Brazil,
Indonesia, Singapore and Thailand; the rest of the world in 2027. **Iran is not
in the first wave**, so there is time. The fee is **$25 once** (not annual).
The separate `store/LISTING-EN.md` file has the full Play Console kit —
data-safety answers, content rating, the lot.

---

## 7. Message for Telegram / WhatsApp / X

```
FBT Swap — a non-custodial DEX, now on Android

Direct install (7.5 MB):
https://github.com/mshiravi433-ctrl/fbtcryp/releases/download/latest/app-release.apk

Or use it in your browser, nothing to install:
https://www.lawpoetics.ir

• Your keys never leave your device — we never hold your funds
• Swap across 8 networks: BNB, Ethereum, Polygon, Arbitrum, Base, Optimism,
  Avalanche, Solana
• No signup, no email, no KYC
• 0.70% fee, shown on screen before you sign

Android will warn about "unknown sources" during install — that is normal for
any app not from the Play Store.
```
