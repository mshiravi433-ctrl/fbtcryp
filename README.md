# FBT Swap — Decentralized Exchange

A non-custodial DEX as a Telegram Mini App **and** an Android app. Real
on-chain swaps on BNB Smart Chain, a 0.5% platform fee collected by an
audited-shaped smart contract, RGB dark/light theming, and full fa/en/ar
support with RTL.

**FBT iran** · Isfahan, Khomeyni Shahr · Project director: Dr. Mohammad Shiravi Khozani

---

## 📱 Download the Android APK

The APK is compiled by GitHub Actions (this dev sandbox has no JDK or Android
SDK, so it cannot produce one locally).

### ⚡ One-time setup — enable the workflow (phone-friendly)

GitHub doesn't allow apps to commit workflow files, so you add it once
yourself. **No computer needed** — from a mobile browser:

1. Open the repo → check the branch is `arena/019fa427-fbtcryp`
2. **Add file** → **Create new file**
3. Name it exactly `.github/workflows/build-apk.yml`
4. Copy the contents of [`ci/build-apk.yml`](ci/build-apk.yml) and paste
5. **Commit changes**

The build starts immediately. Full walkthrough with screenshots-by-step and
troubleshooting: [`ci/README.md`](ci/README.md).

This repo is public, so **Actions minutes are free and unlimited**. A build
takes about 5–8 minutes.

**Then get the build:**

1. Open the [**Actions** tab](../../actions)
2. Tap the newest run and wait for the green ✓
3. **Artifacts** → `FBT-Swap-apk` → downloads a `.zip`, extract the `.apk`

For a one-tap install with no unzipping, run the workflow manually with
**Also publish a GitHub Release** ticked — the APK is then attached directly
to the [Releases](../../releases) page.

> **Vercel/Netlify can't build APKs.** They have no Android SDK or JDK — they
> build websites. Use Vercel to host the web app and Telegram Mini App, and
> GitHub Actions to build the Android binary.

Build it yourself (needs JDK 17 + Android SDK):

```bash
npm ci && npm run android:apk
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 💰 The 0.5% fee — how it actually works

`contracts/FeeRouter.sol` takes 0.5% of the **input** token and forwards the
rest to PancakeSwap **in the same transaction**. It's atomic: a user cannot
receive their swap without the fee being paid, and there's no second
transaction they can decline.

```
user ──approve──▶ FeeRouter ──0.5%──▶ your wallet
                      └──99.5%──▶ PancakeSwap ──▶ user gets output token
```

### Which wallet address do I send? (phone-only guide)

You need a **BNB Smart Chain (EVM) address** — `0x` followed by 40 hex
characters. Any of these work, all installable on a phone:

| Wallet | Notes |
|---|---|
| **Trust Wallet** | Easiest on mobile, owned by Binance, supports BSC out of the box |
| **MetaMask** | Most common; add the BSC network on first use |
| **SafePal / TokenPocket** | Also fine, both BSC-native |
| **Ledger / Trezor** | Best for holding revenue long-term |

**Getting the address (Trust Wallet example):**

1. Install Trust Wallet → **Create a new wallet**
2. Write the 12 words on paper — this is the only backup, and whoever has it
   owns the funds
3. On the main screen tap **Receive** → choose **BNB Smart Chain (BEP20)**
4. Tap **Copy** — you'll get something like `0x71C7…976F`
5. That string is your `FEE_RECIPIENT`

Make this a **dedicated wallet used only for revenue**. It keeps business
income separate from personal funds, which matters a lot for bookkeeping and
tax, and limits the damage if a personal device is compromised.

### ⚠️ A Bitcoin address cannot receive the fee

`bc1qq937k3vl6t92jp8h3wflt26nvvl4hu7th60gm2` is a **Bitcoin** address. The fee
contract runs on BNB Smart Chain and can only pay to an EVM address.

This isn't a limitation of this code: Bitcoin and BSC are entirely separate
networks with incompatible address formats. There is no mechanism for a BEP-20
contract to send value to a bech32 address, and anything pushed that way is
**permanently unrecoverable**. The deploy script now refuses a `bc1…` value
outright rather than letting the mistake reach mainnet.

**To end up holding Bitcoin, do this instead:**

1. Collect fees into your EVM wallet (above)
2. Periodically swap BNB/USDT → BTC — in this app, or on any exchange
3. Withdraw the BTC to `bc1qq937k3vl6t92jp8h3wflt26nvvl4hu7th60gm2`

### Deploy it (one-time, ~$1–3 of gas)

```bash
npm run compile:contract

DEPLOYER_PRIVATE_KEY=0xyour_deployer_key \
FEE_RECIPIENT=0xYourFeeWallet \
NETWORK=testnet \
npm run deploy:feerouter          # test first!

# then mainnet, and put the printed address in .env:
VITE_FEE_ROUTER_ADDRESS=0x...
```

**If `VITE_FEE_ROUTER_ADDRESS` is blank the app charges nothing** and swaps
directly against PancakeSwap. It never silently falls back to a "please also
pay us" second transaction — a half-executed swap is worse than one that
doesn't run at all.

### Safety properties built into the contract

| Property | Why |
|---|---|
| `MAX_FEE_BPS = 100` (1%) hard cap | Even a stolen owner key can't set a 100% fee and drain traders |
| Reentrancy guard on every path | Standard defence against the classic drain |
| Zero balance after each swap | Contract never custodies funds between transactions |
| `SafeERC20`-style calls | Non-standard tokens (USDT) don't brick the router |
| `amountOutMin` passed through untouched | Contract cannot weaken the user's slippage protection |
| Owner can't touch user funds | `rescue()` only recovers tokens sent here by mistake |

**Verified in a real EVM** (`npm run test:feerouter`) — deploys the contract
with a mock DEX and asserts exactly 0.5% lands in the fee wallet across
token→token, BNB→token and token→BNB, plus that the fee cap and access control
hold.

### Before you route real volume

- **Get a professional audit.** The tests prove the fee works; they don't prove
  the contract is free of every exploit class. A bug here loses other people's
  money, not just yours.
- **Verify the source on BscScan** so users can read what they're approving.
- **Transfer ownership to a hardware wallet or multi-sig** right after deploy.
  The deployer key becomes the owner, and a hot deployer key is a liability.
- **Test with a tiny swap** before announcing anything.
- Charging a fee makes this a commercial financial service. Check what that
  means for FBT iran's licensing and tax obligations locally.

---

## Decentralized wallet layer

Three connection modes, all self-custody. The private key never reaches this
app's server in any of them:

| Mode | How | When to use |
|---|---|---|
| **WalletConnect v2** | QR / deep link to MetaMask, Trust, Rainbow… | The real path inside Telegram. Safest. |
| **Injected** | `window.ethereum` | Desktop browsers, wallet in-app browsers. |
| **In-app wallet** | 12-word seed generated on-device, AES-GCM encrypted | Small amounts only — see the warning below. |

Set `VITE_WALLETCONNECT_PROJECT_ID` (free at cloud.reown.com) to enable the
first mode. That ID is public by design — it is not a secret.

### About the in-app wallet

It generates a BIP-39 mnemonic in the browser and encrypts it with the user's
password using **AES-GCM + PBKDF2-SHA256 at 310,000 iterations** (OWASP 2023).
Verified by test: the plaintext phrase never appears in `localStorage`, salt
and IV are unique per encryption, and a wrong password fails closed.

It is still weaker than an external wallet, and the UI says so in plain
language rather than hiding it:

- It lives in `localStorage` inside a Telegram WebView. Any XSS in this app **or
  any dependency** can read the ciphertext and brute-force a weak password offline.
- No secure enclave, no hardware isolation, no biometric gate.
- Lose the seed phrase and the funds are gone. Nobody can restore it.

Treat it as pocket money. Real value belongs in MetaMask/Trust via
WalletConnect, or on hardware.

### Swap safety properties

`src/lib/swap.js` deliberately does these things — keep them if you edit it:

- **`amountOutMin` from a fresh on-chain quote.** A sandwich attack can't take
  more than the slippage the user explicitly accepted.
- **Exact-amount approvals, never `MaxUint256`.** The common "infinite approve"
  pattern means a later router exploit drains the user's whole balance. Verified
  by test that we approve exactly the trade amount.
- **Short deadlines (20 min).** A stuck transaction can't execute hours later at
  a completely different price.
- **Re-quote immediately before sending**, because the price moves while the
  approval transaction confirms.
- **Fee-on-transfer-tolerant router methods**, so taxed tokens don't revert.
- **Price-impact warning above 5%**, which is the tell for a thin/rugged pool.

Token addresses in `src/lib/chains.js` are checksum-verified, but **verify them
yourself** against official sources before sending real value. Fake tokens with
real names are the single most common way people get drained.

### Data flow

Every request goes to your own `/api` first, so the CoinGecko key never
reaches the browser and the TTL cache absorbs the free tier's rate limit. If
the backend is down the client falls back to public CoinGecko; if that also
fails it renders a deterministic offline snapshot and shows an
"offline data" banner. The server behaves the same way — a failed upstream
serves the last good cached copy rather than a 500.

### Design system

All colour, radius and glow values are CSS custom properties in `index.css`,
so retinting the whole app is a five-line change. The RGB look is built from
three drifting blurred orbs on a `#000` base, a perspective grid, conic-gradient
card borders animated via `@property --angle`, sheen sweeps, and
`prefers-reduced-motion` support throughout. Route transitions, list stagger,
the nav indicator and the language pill all use Framer Motion shared layout.

---

## What is real and what is simulated

**Real:** market prices, charts, global stats, trending, DEX pools, Telegram
identity and haptics, the on-chain wallet read.

**Simulated (virtual "NX" credits):** trading, investment yield, all games,
predictions and rewards. NX has no monetary value and cannot be withdrawn.

This split is deliberate, and I'd push back on changing it casually:

- **Taking deposits** to trade or invest on someone's behalf makes you a money
  services business / VASP nearly everywhere. That means registration, KYC/AML,
  segregated client money, audits and reporting. Doing it without a licence is
  a criminal offence in most jurisdictions, not a fine.
- **Fixed-APR "investment plans" funded by user deposits** with no real
  underlying strategy is the exact mechanical shape of a Ponzi scheme. If you
  want real yield, route it to an audited on-chain protocol the user signs into
  themselves (ERC-4626-style vaults) and never touch the funds.
- **Real-money betting** needs a gambling licence per jurisdiction, age and
  identity verification, an independently audited RNG (iTech Labs, GLI, eCOGRA),
  self-exclusion tooling and deposit limits. Telegram also removes bots that run
  unlicensed real-money gambling.
- **Binary options** — which is what the prediction screen is — are banned for
  retail investors in the EU and UK outright.

There is no deposit address anywhere in this codebase and none should ever be
added. `WalletContext.jsx` connects read-only and signs nothing on the app's
behalf. If you eventually get licensed, replace the store layer with your
licensed backend rather than bolting a hot wallet onto a Telegram bot.

### Provably fair — and its limit

Games use commit–reveal: a server seed is hashed and shown before you bet, you
control the client seed, and the outcome is `SHA-256(server:client:nonce)`.
After rotating you can re-hash the revealed seed and confirm it matched.

The honest caveat, which the app also states in its own UI: in this build the
seed is generated *in your browser*. That proves the interface didn't change a
result mid-round. It is not equivalent to a licensed operator's independently
audited RNG, and it doesn't make real-money betting legal.

House edge is 3% on crash, dice and wheel; the prediction payout is 1.9× (5%).
Verified by simulation — dice EV 0.973, wheel EV 0.972 per unit staked.

---

## Bot commands

| Command | Does |
|---|---|
| `/start` | Welcome + launch button (handles `?start=REFCODE` referrals) |
| `/app` | Opens the Mini App |
| `/price btc` | Spot price, 1h/24h/7d change, cap, volume |
| `/top` | Top 10 by market cap |
| `/trending` | CoinGecko trending list |
| `/global` | Total cap, volume, BTC/ETH dominance |
| inline | Type `@yourbot btc` in any chat to share a price card |

Nothing in the bot moves money or accepts deposits, by design.

---

## Verifying initData

Never trust `Telegram.WebApp.initDataUnsafe` for anything that matters — the
client controls it. Send the raw `initData` string in an
`x-telegram-init-data` header and let `server/telegramAuth.js` check the HMAC:

```js
app.get('/api/private', telegramAuth(BOT_TOKEN, { required: true }), (req, res) => {
  res.json({ userId: req.tgUser.id });   // authenticated
});
```

Tested against valid, wrong-token, tampered-payload and expired inputs.

---

## Notes on the other services you listed

- **Nobitex** — removed at your request. It was a centralized custodial
  exchange, which contradicted the decentralized architecture.
- **CoinRithm agent trading / Freetime SDK** — these place real orders. Keep
  them in a separate service that the public web tier cannot reach, on a
  trade-only key with no withdrawal permission and an IP allowlist.
- **dynamic-labs tg-bot-starter** — a good reference if you want embedded
  wallets; it's a different (custodial-ish, MPC) trust model than the
  read-only connect used here, so read their security docs first.

---

## Roadmap if you take this further

1. Move the store server-side (Postgres + the verified `tgUser.id` as the key)
   so balances survive a cache clear and can't be edited from devtools.
2. WebSocket price streaming instead of polling.
3. TON Connect for real in-Telegram wallet UX.
4. Real leaderboards and a shared game feed.
5. Legal review before *any* real value enters the system.

## Screens

```
┌─ Market ──── live prices, global cap, trending, search, sparklines
├─ Swap ────── REAL on-chain swaps, 0.5% fee, you sign from your wallet
├─ Trade ───── paper trading on virtual credits (clearly labelled)
├─ Wallet ──── net worth, allocation, WalletConnect / in-app self-custody
└─ Settings ── theme, profile, 2FA, biometrics, about & contact
```

Plus Invest / Play / Predict / Earn (all simulated, reachable in-app) and a
three-screen onboarding on first launch that ends on "your keys, your coins".

## Settings & security

- **Theme** — dark / light / follow-system, plus four accent palettes. Every
  colour is a CSS custom property, so re-theming touches one block.
- **Profile** — username (local only, never published on-chain) and wallet.
- **2FA (TOTP)** — works with Google Authenticator / Authy. Verified against
  all five official **RFC 6238 test vectors**, with ±1 step clock tolerance and
  single-use recovery codes.
- **Biometrics** — WebAuthn platform authenticator (fingerprint / face).
- **Auto-lock**, hide-balances, and mandatory transaction review.

**Scope, stated honestly:** these protect the *app on this device* — real
protection if someone picks up your unlocked phone. They cannot protect funds
on-chain, because anyone holding your seed phrase can spend from any other
wallet app. The seed phrase and wallet password remain the actual security
boundary, and the UI says exactly this rather than implying more.

## Firebase

Used for anonymous auth + settings sync (theme, accent, username, display
preferences). Configure with the `VITE_FIREBASE_*` web-config values — those
are public by design and Firebase expects them in your bundle.

**Apply these Firestore rules**, or your database is world-writable no matter
what keys you use:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Seed phrases, wallet passwords and 2FA secrets are **never** uploaded. They
stay encrypted on-device — putting them in a cloud database would hand anyone
who breaches Firebase the keys to every user's funds.

## Company

**FBT iran** — commercial trading company moving into the new digital economy.

- Director: Dr. Mohammad Shiravi Khozani
- Address: Isfahan, Khomeyni Shahr, Shahid Beheshti Blvd., next to District 4 Municipality
- Contact: Instagram [@Shiravi4333](https://instagram.com/Shiravi4333)

