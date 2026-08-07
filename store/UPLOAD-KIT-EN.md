# FBT Swap — Store Upload Kit

**Everything you paste into a store form, in one file.**
Every fact below was re-checked against the code and the published release on
**8 August 2026**. Where the previous version of this file was wrong, the wrong
value is named so you do not paste it from an old screenshot.

| | |
|---|---|
| Version | **1.27.0** (versionCode **55**) |
| Package | `ir.fbt.swap` |
| File to upload | `app-release.apk` — **9.57 MB**, release-signed |
| minSdk / targetSdk | 23 / 35 |
| Website | `https://fbtswap.ir` |
| Support email | `fbtswap@gmail.com` |
| Privacy policy | `https://fbtswap.ir/#/legal/privacy` |
| Terms | `https://fbtswap.ir/#/legal/terms` |
| Developer | Fanous Bazaar Pishgam Co. — Khomeyni Shahr, Isfahan, Iran |

> ### ⚠️ Two corrections to the older version of this file
>
> 1. **The website was `lawpoetics.ir`. It is now `fbtswap.ir`.** Do not paste
>    the old domain into a store form.
> 2. **The `#` in the policy URL is load-bearing.** The app uses a HashRouter,
>    so `https://fbtswap.ir/legal/privacy` returns a **404** — measured, not
>    assumed. Only the `/#/legal/privacy` form loads. A privacy URL is a
>    mandatory field that reviewers really do open, and a 404 there is an
>    automatic rejection.

---

## 1. WHICH FILE TO UPLOAD

Three files are attached to every release. They are not interchangeable.

| File | Upload it to | Never upload it to |
|---|---|---|
| **`app-release.apk`** ← **this is the one** | APKPure, Uptodown, Cafe Bazaar, Myket, IzzyOnDroid, direct download | — |
| `app-release.aab` | Google Play **only** | Any other store — none of them accept AAB |
| `FBT-Swap-full.apk` | Nowhere. Direct download / GitHub only | **Any store** |

**Why `FBT-Swap-full.apk` must never go to a store:** it is built with
`VITE_ENABLE_SPECULATION=true`, which re-enables the prediction, perpetuals and
invest screens. Those screens are exactly what got the app rejected before for
"illegal sensitive words". The store build has them compiled out — routes *and*
their text in all twelve locale bundles. An automated test greps the built
bundle for the flagged vocabulary in English, Persian and Arabic on every
commit, and it currently passes.

**Direct link to the store APK:**
```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/download/latest/app-release.apk
```

**Release page (all three files):**
```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/latest
```

---

## 2. WHERE TO UPLOAD — ordered by what is worth your time

| # | Store | Sign-up link | Cost | Review | Verdict |
|---|---|---|---|---|---|
| 1 | **APKPure** | https://developer.apkpure.com | Free | ≤ 3 business days | ✅ **Start here** |
| 2 | **Uptodown** | https://www.uptodown.dev/#/sign-up | Free | ~1 week | ✅ Best Google traffic |
| 3 | **GitHub Releases** | https://github.com/mshiravi433-ctrl/fbtcryp/releases/latest | Free | — | ✅ **Already live** |
| 4 | **IzzyOnDroid** | https://gitlab.com/IzzyOnDroid/repo/-/issues | Free | ~2 weeks | ⚠️ Firebase may block us |
| 5 | **Myket** (Iran) | https://developer.myket.ir | Free | ~1 week | ⚠️ Likely rejected — see §7 |
| 6 | **Cafe Bazaar** (Iran) | https://pishkhan.cafebazaar.ir | Free | ~1 week | ⚠️ Likely rejected — see §7 |

**Ruled out, with the reason — do not spend time on these:**

| Store | Why not |
|---|---|
| Amazon Appstore | Shut down 20 Aug 2025. Not a closed door — no door. |
| Aptoide | $69/year. |
| Samsung Galaxy Store | Commercial sellers only — needs a registered business entity. |
| F-Droid | FLOSS-only. Our licence is all-rights-reserved and they refuse Firebase. |
| Huawei AppGallery | No developer registration with Iranian identity. |
| APKMirror | A mirror, not a store — only re-hosts apps already on Google Play. |
| Apple App Store | $99/yr account, not purchasable from Iran. Impossible, not hard. |

---

## 3. COPY-PASTE FIELDS

### App name — 8 characters
```
FBT Swap
```
Keep it short. Play truncates long names in search, and stuffing keywords
("FBT Swap — Best Crypto Exchange") is a documented rejection reason.

### Short description — 77 characters (the limit is 80 almost everywhere)
```
Swap crypto from your own wallet. Non-custodial, on-chain, no account needed.
```

### Category
```
Finance
```
Second choice if Finance is not offered: `Tools`.

**Do not** choose "Trading", "Investing" or "Brokerage". That language implies
a licensed financial service and is one of the most common rejection reasons
for a crypto app. The honest description is a routing interface to public smart
contracts.

### Tags / keywords — max 5
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
| News app | **No** |
| Government app | **No** |

The arcade code was **deleted from the repository** — not merely disabled by a
flag — so "No" to gambling is accurate for every build. The prediction and
perpetuals screens are compiled out of the store build specifically.

---

## 4. FULL DESCRIPTION (English)

Fits every store: Play allows 4,000 characters, APKPure and Uptodown allow more.

This version leads with **on-device** features on purpose. Uptodown's rules
reject "low-quality webviews" — apps that only display a website. Ours is built
with Capacitor, so it technically *is* a WebView, and the defence is to be
specific about what a plain website cannot do: an encrypted on-device wallet,
biometric lock, camera QR scanning, push notifications and offline operation.

```
FBT Swap is a non-custodial wallet interface for Android. You connect a wallet
you already own, you exchange one token for another through public smart
contracts, and your assets never leave your control. There is no account, no
email, no identity check, and no company wallet holding your money.

WHAT IT DOES

• Swap tokens across ten networks: BNB Smart Chain, Ethereum, Polygon,
  Arbitrum One, Base, Optimism, Avalanche, Linea, Sonic and Solana.
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
• Chart history: how often a price level has held, the largest fall in the
  period, and how today's volume compares with normal.
• Crypto news, refreshed daily from public feeds.
• A step-by-step guide written for people who have never used a wallet.
• 12 languages including Persian, Arabic and Urdu, with full right-to-left
  layout, plus light and dark themes.
• Works offline for everything that does not need live prices.

HOW THE SWAP WORKS

FBT Swap does not run an order book and holds no liquidity of its own. It
compares routes from public aggregators across the decentralised protocols on
the network you chose, shows you the quote, the price impact and the fee, then
hands the transaction to your wallet. You are the one who signs it. The
exchange settles on-chain, directly between your wallet and the protocol.

There is no leverage, no derivatives, no prediction market and no game of
chance anywhere in this app.

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

No signup. No email or phone number. No advertising SDK. Your preferences and
your reward points stay on your device — nothing about your activity is
published anywhere, and your score is not shared or compared with anyone.
Blockchain activity is public by nature: every swap, including your wallet
address and the amounts, is permanently visible on-chain to anyone.

RISK

Crypto assets are volatile and on-chain transactions are irreversible. You can
lose money, including all of it. Nothing in this app is financial advice, and
the indicator readouts are arithmetic on past prices — they describe what has
already happened and forecast nothing. Use only what you can afford to lose,
and check the rules that apply where you live.

Built by Fanous Bazaar Pishgam, Isfahan, Iran.
```

> **Two lines changed from the previous kit, because they had become false:**
> "eight networks" → **ten** (Linea and Sonic were added and verified paying
> fees), and the privacy paragraph no longer mentions optional cloud sync of a
> display name — the public leaderboard and its upload endpoint were removed in
> v1.27.0, so nothing is uploaded at all now.

---

## 5. WHAT'S NEW (release notes for v1.27.0)

```
• Fixed the white box around the app icon on the home screen.
• The launch screen is now our own logo on black — it used to be a white
  placeholder screen left over from the build tool.
• The points screen now shows your own points and where each one came from,
  with the date. It no longer ranks you against other people.
• Your score is no longer uploaded anywhere. It stays on your device.
```

---

## 6. IMAGES

| What | File in this repo | Size |
|---|---|---|
| App icon | `store/icon-512.png` | 512×512, 413 KB |
| Feature graphic / banner | `store/feature-graphic-1024x500.png` | 1024×500, 467 KB |
| Small icon | `store/dappradar-logo-250.png` | 250×250, 27 KB |

### Screenshots — you must take these yourself

I cannot generate them, and you should not let anyone else either. A rendered
mock-up that does not match the running app is an explicit rejection reason on
both APKPure ("low-quality images") and Uptodown.

**Five minutes, on your phone:**

1. Install `app-release.apk`.
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

## 7. STORE-SPECIFIC NOTES

### APKPure — do this one first
Fastest, no ID document, review ≤ 3 business days.
Console → `MANAGE VERSIONS` → `SELECT FILES` → upload `app-release.apk`. The
icon and version are read out of the APK automatically. If you hear nothing
after 3 business days, email `developer@apkpure.com`.

**If it is rejected for "sensitive words" again:** that is an automated content
filter, and the words it used to find are gone from the store build. The
description in §4 says "wallet interface", not "exchange", and states plainly
that there is no leverage, no derivatives, no prediction market and no game of
chance. All of that is true of `app-release.apk`. It is **not** true of
`FBT-Swap-full.apk` — which is why that file must never be uploaded.

### Uptodown — the one that brings Google traffic
Their app pages rank well in search, which is free organic traffic.
Set **Country Restriction** to its default (worldwide) — do not touch it.
Author: `Fanous Bazaar Pishgam Co.` · PEGI: `18` · Nationality: `Iran`.

The real risk here is the "low-quality webviews" rule. Use the description in
§4 exactly as written; it leads with on-device features to answer that
objection directly.

### Myket / Cafe Bazaar — expect rejection, and know why
Iran's Supreme Council of Cyberspace resolution (14 Feb 2025) restricts
promoting crypto asset services to **licensed** providers. Myket's rules require
the developer to hold any necessary licence *before* submitting, and
registration asks for your national ID, national number, postcode and IBAN —
under your real legal identity.

If you submit anyway:
- Describe it as a **market-viewing and wallet-management tool**, not an
  "exchange". This is not a dodge: the app runs no order book and holds no
  liquidity; it routes to public contracts.
- **Never** use the words "investment", "profit" or "returns" — those are the
  exact terms the resolution restricts.

### Google Play
Requires the `app-release.aab`, not the APK. Developer verification starts
30 September 2026 in Brazil, Indonesia, Singapore and Thailand, the rest of the
world in 2027 — **Iran is not in the first wave**, so there is time. The fee is
**$25 once**, not annual.

---

## 8. DATA SAFETY / PRIVACY FORM

Play cross-checks these answers against what the app actually does, so they are
drawn from the code.

| Question | Answer |
|---|---|
| Does the app collect or share required user data types? | **Yes** (diagnostics only) |
| Is all user data encrypted in transit? | **Yes** — every endpoint is HTTPS |
| Can users request data deletion? | **Yes** — clearing app data removes everything; give the support email |

| Type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| App info & performance → Diagnostics | Yes | No | App functionality | Yes |

Declare **No** for: financial info, location, contacts, messages, photos, files,
health, calendar, and device IDs for advertising.

**Two things people get flagged for:**

- **Wallet address / recovery phrase — not collected.** The app never receives
  the recovery phrase; the address is handled by the wallet app and the public
  chain. Do **not** tick "financial info", but be ready to explain this in the
  review notes.
- **Display name — no longer uploaded.** Older versions of this kit told you to
  declare "Personal info → Name". That is now wrong: v1.27.0 removed the
  leaderboard and the endpoint it posted to, so the name never leaves the
  device. Declaring collection that does not happen is itself an inaccurate
  declaration.

## 9. CONTENT RATING QUESTIONNAIRE

Answer **No** to every question about violence, sexual content, profanity,
controlled substances and **gambling**.

Expected result: **Everyone / PEGI 3**, with a "Finance" advisory. You still set
the store-listing target audience to 18+ — those are two different fields.
