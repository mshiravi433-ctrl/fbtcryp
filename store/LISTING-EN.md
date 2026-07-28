# Google Play — Main store listing (English, `en-US`)

Copy each block **exactly** into the matching field in
`Play Console → Grow → Store presence → Main store listing`.
Character counts are measured; each one is inside Google's limit.

---

## App name — limit 30

```
FBT Swap
```
(8 chars. Leave it short — Play truncates long names in search results, and a
name that repeats keywords like "FBT Swap — Best Crypto Exchange" is a common
rejection reason under the Store Listing policy.)

## Short description — limit 80

```
Swap crypto from your own wallet. Non-custodial, on-chain, no account needed.
```
(77 chars.)

## Full description — limit 4000

```
FBT Swap is a non-custodial crypto exchange. You connect a wallet you already
own, you swap, and your assets never leave your control. There is no account,
no email, no identity check, and no company wallet holding your money.

WHAT IT DOES

• Swap tokens on seven networks: BNB Smart Chain, Ethereum, Polygon,
  Arbitrum One, Base, Optimism and Avalanche.
• Thousands of tokens from public token lists, with search by ticker, name or
  contract address — plus import-any-contract if a token is too new to be
  listed.
• Live market data: prices, 24h change, charts and coin detail pages.
• Indicator readouts (RSI, MACD, Bollinger Bands, moving averages, volatility)
  computed on your device from public price data.
• Crypto news, refreshed daily from public feeds.
• A step-by-step guide written for people who have never used a wallet.
• 12 languages including Persian, Arabic and Urdu, with full right-to-left
  layout.
• Light and dark themes.

HOW THE SWAP WORKS

FBT Swap does not run its own order book and does not hold liquidity. It asks
a public aggregator for the best route across the decentralised exchanges on
the network you selected, shows you the quote, the price impact and the fee,
and then hands the transaction to your wallet. You are the one who signs it.
The swap settles on-chain, directly between your wallet and the protocol.

FEES, STATED PLAINLY

• Platform fee: 0.5% of the amount you are swapping, taken from the input
  token inside the same on-chain transaction. It is shown on screen before
  you sign — never after.
• Network gas: paid in the network's own coin (BNB on BNB Chain, ETH on
  Ethereum, and so on). This goes to the network's validators, not to us,
  and we cannot reduce it.

YOUR KEYS, YOUR COINS

We never receive your seed phrase, private key or wallet password. They stay
in your wallet app. This also means what you would expect it to mean: we
cannot reverse a transaction, cannot freeze funds, cannot refund a swap you
regret, and cannot recover a lost recovery phrase. Nobody can.

PRIVACY

No signup. No email or phone number. No advertising SDK. Preferences such as
theme, language and display name stay on your device unless you switch on
optional cloud sync, which stores them against an anonymous ID. Note that
blockchain activity is public by nature: every swap, including your wallet
address and the amounts, is permanently visible on the chain to anyone.

RISK

Crypto assets are volatile and on-chain transactions are irreversible. You can
lose money, including all of it. Nothing in this app is financial advice, and
the indicator readouts are arithmetic on past prices, not a prediction. Trade
only what you can afford to lose, and check the rules that apply where you
live.

Built by Fanous Bazaar Pishgam, Isfahan, Iran.
```
(2,790 chars.)

---

## Graphics

| Asset | File | Spec |
|---|---|---|
| App icon | `store/icon-512.png` | 512×512 PNG, 32-bit, 413 KB — under the 1 MB cap |
| Feature graphic | `store/feature-graphic-1024x500.png` | 1024×500 PNG, 24-bit no alpha, 467 KB |
| Phone screenshots | **you capture these** — see below | 2–8, min 2 |

### Screenshots — capture them yourself, do not fake them

Play's Store Listing policy requires screenshots to show the actual in-app
experience. A rendered mock-up that does not match the running app is grounds
for rejection or removal, so no AI-generated "screenshots" are shipped here.

Take them on your phone after installing the release build:

1. Install the signed APK/AAB build on your phone.
2. Screenshot these 6 screens, in this order:
   1. **Swap** with a real quote loaded (this is the app's core purpose — it
      must be first)
   2. **Market** list
   3. **Coin detail** with the chart
   4. **Wallet / connect** screen
   5. **Guide** or **Help**
   6. **Settings** showing language + theme
3. Upload them raw. A normal 1080×2400 phone screenshot already satisfies
   Play's rule (shortest side ≥ 320 px, longest ≤ 3840 px, ratio between 9:16
   and 9:21). Do not crop, do not add frames, do not add sales text.

Set the app language to English before capturing the `en-US` set, and to
Persian for the `fa-IR` set.

---

## Categorisation

| Field | Value |
|---|---|
| App or game | App |
| Category | **Finance** |
| Tags | Cryptocurrency, Finance, Tools (max 5) |
| Contains ads | **No** |
| In-app purchases | **No** |

Do not pick "Trading" language that implies a licensed brokerage. The app is a
routing interface to public smart contracts.

## Contact details

| Field | Value |
|---|---|
| Email | your support email (required, shown publicly) |
| Website | your Vercel URL, e.g. `https://<your-app>.vercel.app` |
| Phone | leave empty — it is optional and it becomes public |
| Privacy policy URL | `https://<your-app>.vercel.app/legal/privacy` |

The privacy policy URL is **mandatory** and Google does open it. It must be a
public page that loads without login. The app already serves that route.

---

## Data safety form — answers that match the code

Play cross-checks this against the app's actual behaviour, so these answers
are drawn from what the code really does, not from what sounds best.

| Question | Answer | Why |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Optional cloud sync and crash-free operation still touch some data |
| Is all user data encrypted in transit? | **Yes** | Every endpoint is HTTPS |
| Do you provide a way to request data deletion? | **Yes** | Turning off sync and clearing app data removes it; state your support email |

Data types to declare:

| Type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| App info & performance → Diagnostics | Yes | No | App functionality | Yes |
| Personal info → Name (display name) | Yes | No | App functionality, personalisation | **Yes — user-supplied and optional** |
| App activity → Other user-generated content (theme, language, preferences) | Yes | No | App functionality | Yes |

Declare **No** for: financial info, location, contacts, messages, photos,
files, health, calendar, device IDs for advertising.

Two things people get wrong here and get flagged for:

- **Wallet address / seed phrase**: not collected. The app never receives the
  seed phrase, and the wallet address is handled by the wallet app and the
  public chain. Do **not** tick "financial info" — but be ready to explain
  this in the review notes if asked.
- The display name is optional; you must tick the "users can choose whether
  this data is collected" box, otherwise the declaration is inaccurate.

## Content rating questionnaire

Answer **No** to every question about violence, sexual content, profanity,
controlled substances and **gambling**. The arcade/mini-game code is compiled
out of the store build (`VITE_ENABLE_GAMES` defaults to off), so there is no
simulated gambling in the artifact you upload. Do not enable it and then keep
this rating.

Expected result: **Everyone / PEGI 3**, with a "Finance" advisory.

## App content declarations

| Declaration | Answer |
|---|---|
| Financial features | Tick **"Cryptocurrency exchange or wallet"** if the country you distribute to asks. Be honest: it is a crypto app in the Finance category and hiding this is the fastest way to get pulled |
| News app | No |
| Ads | No |
| Target audience | 18+ only. Never tick any age band under 18 for a finance app |
| Government app | No |

## Release track

Start with **Internal testing**, not Production. It publishes in minutes
instead of days, installs on your own devices through a link, and lets you
find a broken `VITE_API_BASE` before a reviewer does.
