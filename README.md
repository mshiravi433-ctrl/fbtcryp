# NEXUS — Crypto Terminal Mini App

A Telegram Mini App: pure-black RGB theme, heavy motion, live crypto market
data, paper trading, yield plans, provably-fair arcade games, price prediction
and a daily-rewards loop. Persian / English / Arabic with automatic RTL.

```
┌─ Market ──── live prices, global cap, trending, search, filters, sparklines
├─ Swap ────── REAL on-chain swaps via PancakeSwap V2, you sign from your wallet
├─ IRT ─────── Nobitex toman prices + optional spot trading with your own key
├─ Trade ───── paper spot trading with positions, P&L and order history
├─ Invest ──── fixed-term yield plans with maturity tracking
├─ Play ────── crash / dice / wheel, commit–reveal fairness
├─ Predict ─── up-down rounds settled on real market prices
├─ Earn ────── daily streak, XP levels, quests, referral links
└─ Wallet ──── net worth, allocation, WalletConnect / in-app self-custody wallet
```

**Two clearly separated halves.** The Swap and IRT screens move *real value*.
Trade, Invest, Play, Predict and Earn are *simulations* on virtual NX credits.
The UI labels which is which on every screen — never blur that line.

---

## 🔴 Read this first — your API keys are burned

You pasted these into a chat message, which means they must be treated as
public. **Revoke and regenerate every one of them before doing anything else:**

| Key | Where to revoke |
|---|---|
| Telegram bot token `8860183907:AAF…` | @BotFather → `/revoke` → then `/token` for a new one |
| Kraken API key + secret | https://www.kraken.com/c/account-settings/api → delete the key |
| CoinGecko API key | CoinGecko dashboard → regenerate |
| CoinRithm `crk_live_…` | CoinRithm agent studio → rotate |
| The `Private key: B0u8dq…` blob | Whatever issued it — assume total compromise |

The Kraken key is the urgent one: a leaked trading key can drain an account.
Log in, delete it, and check your recent activity. Nothing in this repository
reads any of those values — they are not committed anywhere, and `.env` is
gitignored — but they were exposed the moment they were typed into a chat.

**Never put a key in a `VITE_*` variable.** Vite inlines those into the
JavaScript bundle, so anyone can read them with View Source. Secrets belong in
`.env` on the server only.

---

## Quick start

```bash
npm install
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN + COINGECKO_API_KEY
npm run dev               # vite on :5173, API + bot on :8787
```

Expose it over HTTPS (Telegram will not load an HTTP URL):

```bash
ngrok http 5173           # or: cloudflared tunnel --url http://localhost:5173
```

Then in @BotFather: `/newapp` → pick your bot → paste the HTTPS URL. Put the
same URL in `WEBAPP_URL` in `.env` so the bot's "Open NEXUS" button works.

Production:

```bash
npm run serve             # builds, then serves dist/ + /api from one Node process
```

---

## Architecture

```
src/
  lib/api.js          three-tier data fetch: backend → public CoinGecko → offline
  lib/offlineData.js  deterministic snapshot so the UI never shows a blank screen
  lib/fairness.js     commit–reveal RNG (SHA-256)
  store/useAppStore   zustand + localStorage: balance, positions, plans, bets
  hooks/useMarket     polling that pauses when the tab is hidden
  components/         RgbBackground, AnimatedNumber, Sparkline, Sheet, Toasts…
  games/              CrashGame, DiceGame, WheelGame
  pages/              Market, CoinDetail, Trade, Invest, Play, Predict, Earn, Wallet

server/
  index.js            Express: /api/*, rate limiting, SPA hosting
  providers.js        CoinGecko / CoinLore / GeckoTerminal, keys stay here
  cache.js            TTL cache + single-flight + stale-on-error
  telegramAuth.js     verifies Mini App initData HMAC (tested)
  bot.js              Telegraf: /price /top /global /trending + inline mode
```

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

- **Nobitex** — now integrated, but deliberately constrained. Public IRT prices
  are proxied and cached by our server (no key needed). Trading is
  **bring-your-own-key**: each user's token is AES-GCM encrypted on their own
  device and sent straight to Nobitex — it never touches our backend, because
  relaying user exchange keys would make you a custodian of their accounts.
  **Withdrawal endpoints are intentionally not implemented** (`withdraw()` throws
  with an explanation), and the UI tells users to issue trade-only keys.
  Note that Nobitex is centralized and custodial, which is the opposite of the
  rest of this app, and that trading on an Iranian exchange raises
  sanctions-compliance questions depending on where you and your users are.
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
