# Changelog

## 1.29.0 — Intent OS Phase 2c: transactional admission + independent completeness watcher

Phase 2c closes the last honesty gap of the signed auction protocol documented
in `docs/INTENT-OS-FA.md`: before this phase, a coordinator could verify a
quote at admission and silently drop it from the sealed close, and nobody
could prove it. Now omission is cryptographic evidence.

- **Transactional admission receipts** (`server/intentAdmissions.js`,
  `fbt.admission-receipt.v1`): every 201 from `POST /api/intents/v1/commitments`
  now embeds a coordinator-signed receipt binding exactly
  `intentHash · entryHash · acceptedAt · solverId`, minted inside the admission
  lock after the post-write seal re-check. Receipts are deterministic (same
  stored row + Ed25519 → same bytes), so they are **reclaimable** from the new
  immutable `GET /api/intents/v1/admissions/{intentHash}/{entryHash}` and
  watchtowers can re-derive them for every logged entry. A receipt never
  claims execution, close inclusion, or fund authority.
- **Independent completeness watcher protocol** (`server/intentWatcher.js`,
  `fbt.completeness-report.v1`): registered watcher keys submit verdicts
  comparing observed admission receipts to the signed close — `complete`,
  `inconclusive`, `misconduct-evident`, `unmonitored`. A receipted bid from
  before the seal window missing from the close (or marked late) is hard
  misconduct evidence; receipts inside the ±skew boundary (`INTENT_WATCHER_SKEW_MS`,
  default 2000ms) stay honestly inconclusive. The server **re-evaluates
  deterministically** before storing: signature, close binding, per-receipt
  classifications, counts and verdict must recompute or the report is
  rejected even with a valid key. Storage is immutable; reportId replay is
  idempotent.
- **Live per-auction status**: `GET /api/intents/v1/auctions/:intentHash` now
  surfaces `completeness` (`watcher-verified` / `misconduct-reported` /
  `inconclusive` / `unmonitored`) plus the watcher report feed, re-verified
  against the signed close on every read. The close's own
  `auctionCompletenessProof` stays `false` by design — completeness is
  per-auction watcher evidence, never a close-time claim.
- **Offline watchtower CLI** (`scripts/intent-watchtower.mjs`):
  `verify-receipt`, `verify`, `report`, `verify-report`, `collect` — full
  verification of closes, receipts and reports without contacting FBT.
- Client + UI: `intentNetwork` gains receipt/watcher getters; the Network tab
  shows admission-receipt status, registered watcher count and the
  evidence-based completeness model (fa + en). `.env.example` documents
  `INTENT_WATCHER_KEYS`, `INTENT_WATCHER_RATE_LIMIT`, `INTENT_WATCHER_SKEW_MS`.
- Tests: 26 new unit rows (receipt determinism, skew-boundary verdicts,
  report recompute rejection, summary precedence) and 13 new HTTP probe rows
  (byte-identical reclaim, 404 for non-admissions, idempotent replay, rogue
  watcher refusal, end-to-end misconduct evidence on public state).

## 1.28.4 — swap "no route" bug fixed: OpenOcean executable, proxy fallback, Iran-friendly RPCs

Reported: «در سواپ اصلی وقتی دوتا توکن را انتخاب کردی و مقدار را وارد کردی
میگه مسیری برای این تراکنش وجود ندارد». The swap screen's entire quoting
stack rested on ONE executable aggregator (KyberSwap); OpenOcean and Velora
were quoted but could never win the comparison because they were marked
non-executable. So whenever KyberSwap's API was unreachable — geo-filtering,
ISP blocks, national censorship, the exact conditions Iranian customers hit —
the app answered "no route between these two tokens" even though OpenOcean
had found one. Every aggregator outage was a total swap outage.

- **OpenOcean is now executable** (`lib/openocean.js`): its quote can win the
  comparison and `executeSwap` signs its calldata. The 0.7% platform fee
  survives via `referrer` + `referrerFee`, and it is VERIFIED before signing
  by decoding the calldata (their `/decodeInputData`) and checking the
  referrer is our payout address — fail-closed, same discipline as the
  KyberSwap extraFee echo. `minOutput` is passed on BSC/ETH/Base for
  on-chain slippage protection; gasLimit gets the documented 1.25–2.5×
  headroom.
- **Same-origin proxy fallback** (`server/swapProxy.js` + new `/api/swap/*`
  routes): when a direct call to KyberSwap or OpenOcean fails at the NETWORK
  layer, the identical request is retried through our own server, which
  forwards it from a datacenter. The app's origin is reachable by anyone who
  can open the app at all, so this turns a hard "no route" into a working
  quote for exactly the users who were locked out. No open proxy: fixed
  upstream allowlist, no SSRF.
- **BSC RPCs are Iran-friendly** (`lib/chains.js`): the list now leads with
  neutral community endpoints (PublicNode, Ankr, 1RPC, ninicoin.io) and keeps
  the Binance-hosted seeds as tail redundancy — Binance's domains are blocked
  for Iranian users, and blocked RPCs meant every on-chain read stalled and
  the direct path failed.
- **Honest errors + retry** (`lib/swap.js`, `Swap.jsx`, locales): when every
  routing source is unreachable the app now says so (`QUOTE_NETWORK`, with a
  VPN hint) instead of a false "no route", and a retry button re-quotes
  without retyping the amount. Genuine no-route verdicts are still reported
  as no-route.
- **Approval fix** (`Swap.jsx`): the pre-signing re-quote can now come from a
  different executable router than the one approved; the spender is
  re-checked and approved if it changed, so a source flip can no longer
  revert at the transfer step after the user paid gas.

## 1.28.3 — SOL tradeable from the market, modern Lab/Trade/Buy/Swap surfaces, revenue roadmap

### SOL is no longer "not on this network"

Reported: «در بازار بعضی از کویین ها میگه هنوز روی این شبکه نداری مثل توکن
سولنا». SOL is the native coin of Solana — it sat in every market list, but
the curated swap table (`coinToSwap.js`) only covered EVM tokens, so the
market showed no swap button for it and the coin page fell back to
«قابل سواپ نیست … روی شبکهای که پشتیبانی نمیکنیم». We have a working Solana
swap screen (Jupiter/OpenOcean routing), so that refusal was a leak:

- `swapTargetFor('solana')` now resolves instantly and offline to a curated
  Solana target; the market list shows the swap button and the coin page's
  Buy/Sell go straight to `/solana?to=SOL&side=…`.
- **Sell handoff bug fixed on the Solana screen**: `side=sell` was read and
  then discarded, so every "Sell" tap on a coin page opened a BUY order.
  Both the `?to=` and `?toMint=` handoffs now honour the side and flip the
  pair (asset leaves, stablecoin received).
- The wallet's "no token balances on this network" empty state now says
  balances are per-network and offers a one-tap route to the Solana swap
  instead of ending the conversation.

### Lab — prediction & invest, modernised

- New `lab-modern.css` language (glass cards, aurora glow, lit rims) shared
  by Lab, Trade and Swap.
- Predict: live-price hero with aurora, big tabular price, 24h badge,
  full-width ▲/▼ direction cards with payout sub-labels, duration segmented
  control, payout preview bar against balance, live countdown chips and
  status dots on open rounds.
- Invest: gradient summary hero, plan cards with per-plan glow tiles and APR
  display, chips for lock/min/risk, progress bars tinted per plan.

### Buy & Sell — both tabs, both screens

- Trade (practice spot): glass order ticket, gradient buy/sell segmented
  indicator, tinted CTA (mint for buy / pink for sell), cleaner fee rows and
  a modernised portfolio hero.
- Buy (fiat in/out): the two tabs share a new hero, glass route rows with
  tinted icon tiles, and the address/safety cards are in the new surface
  language.

### Swap — modern ticket, fee confirmed on both sides

- The EVM ticket is now a glass card with the signature gradient rim, an
  aurora wash, focused field glow, and a dominant cyan→violet CTA.
- Platform fee verified end-to-end on every path: EVM swap 70 bps
  (KyberSwap integrator), gasless 70 bps (0x), Solana 70 bps (OpenOcean
  referrer), bridge 30 bps (LI.FI). The quote card and the review sheet
  both itemise the exact amount before anything is signed.

### Revenue — what is still missing

- New `docs/REVENUE-REMAINING-FA.md` answers «چه راههای درآمدی هنوز
  نداریم»: what is already live (table), what remains (THORName ~$9 for
  native BTC, GMX referral ~2¢, Morpho vault ~$25, Hyperliquid builder code
  $100 lock, Ledger affiliate, AADS ads, own P2P escrow, staking doorway),
  and what is permanently blocked and why.

### Tests

All suites pass; wiring audit now at 1807 checks, including the new
predict/invest translation keys and the SOL curated-target + sell-handoff
assertions (section 103).

- Rebuilt the Settings screen (`Settings.jsx`) with a modern hero summary banner featuring interactive status badges for network, slippage, deadline, and security, plus one-tap controls for theme and balance visibility.
- Expanded EVM Networks default chain selection from 5 to all 9 active chains: BNB Smart Chain (BSC), Ethereum, Polygon, Arbitrum One, Base, Optimism, Avalanche, Linea, and Sonic, synchronized across Settings and Swap (`EVM_CHAIN_ORDER`).
- Added Default Transaction Deadline (`defaultDeadlineMin`) to Trading Settings with options for 5, 10, 20, 30, and 60 minutes, automatically protecting swaps on congested networks from delayed execution at outdated prices.
- Added a new Data & Storage (`settings.dataStorage`) section with safe cache clearing (`clearAppCache`) for prices, charts, and token lists without affecting wallet keys or security preferences.
- Added Backup Settings (`exportSettingsBackup`) allowing users to download a portable JSON file containing their Watchlist, theme, username, and display preferences.
- Updated bilingual translations (`fa.json` and `en.json`) for all new titles, subtitles, and confirmation toast notifications.

## 1.28.1 — Ostium, dYdX and storefront refresh

- Rebuilt the Shop as a modern mobile storefront: image-first campaign hero,
  five-item icon navigation, trust chips, integrated search, two-column mobile
  product grid (three on wide web), cleaner brand cards and stronger product
  hierarchy. The existing country restrictions and external-checkout honesty
  remain unchanged.
- Added `/dydx`: official EVM-signature onboarding, memory-only dYdX signing
  session, 200+ live markets, account/position reads and IOC market orders with
  the supplied `dydx1…` Builder Code at 500 ppm. The official client is pinned
  exactly to known-good 3.4.0 because multiple adjacent npm releases were
  compromised in the January 2026 supply-chain incident.
- Added full Ostium position management: partial/full close, TP, SL, exact-
  approval collateral top-up and collateral removal.
- Added a public derivatives dashboard for funding, perp basis, open interest,
  spread, and bid/ask depth within 1%.
- Fixed the Ostium → Swap handoff: it now selects Arbitrum USDC, and the generic
  network-reset effect can no longer overwrite a token supplied by a deep link.
- Fixed Solana Mobile Wallet Adapter end-to-end. The app now uses the current
  Wallet Standard registry and can sign/send after connecting instead of
  looking only for `window.solana` and reporting that the transaction was not
  signed.
- Added exact Solana source/SOL balance checks before opening the signing
  prompt, plus always-visible Phantom, Solflare and Backpack launch links.
- Wallet identity links now reject the retired `lawpoetics.ir` environment
  value and always identify the production dapp as `fbtswap.ir`.
- Added the complete `/ostium` wallet-signed order flow for gold, oil, forex,
  stocks, indices, ETFs and crypto: live prices and market hours, current
  pair-specific leverage limits, long/short ticket, TP/SL, and an itemised fee
  preview.
- Added exact-amount Arbitrum USDC approval, a final real-money confirmation,
  fresh-price revalidation immediately before signing, Arbiscan tracking and a
  read-only open-position list.
- Kept the leveraged route and its locale copy out of store-safe builds. It is
  included by `build:full` with `VITE_ENABLE_SPECULATION=true`, matching the
  existing app-store vocabulary policy.
- Fixed local-wallet network switching: the in-memory ethers signer now
  reconnects to the target RPC instead of merely changing the network label.

## 1.27.0 — versionCode 55

### The white box around the logo — three causes, all fixed

Reported as a PWA problem. It was three separate defects that produced the same
white plate, and each was measured before being touched.

**1 · No maskable icon at the size a phone actually asks for.** The manifest
declared `purpose: maskable` at 512 only. The launcher requests 192 on almost
every phone, and at 192 the only candidates were `purpose: any`. Android Oreo
and later force one silhouette on every home-screen icon, and an icon it cannot
mask is shrunk and placed **on a white plate**. That plate is the report.

This survived a long time because the Lighthouse audit "has a maskable icon"
*passed* — it only checks that some entry declares the purpose, never that the
right size does. Added `icon-maskable-192.png` and `-384.png`, both flattened
onto the brand black so they carry **no alpha channel at all** (a transparent
maskable icon gets filled with the OS's own grey or white before masking, which
is the same bug by another route). The three long-press shortcuts pointed at
the full-bleed icon too, so a long-press menu showed three more white boxes;
they now use the maskable file.

**2 · The native app's launch screen was a white Capacitor placeholder.** Every
`splash.png` under `android/` measured **98.8% pure #FFFFFF** and carried the
stock blue Capacitor "X" — not our mark, never replaced since `cap add android`.
Cold start was: white screen, a stranger's logo, then a black app. Replaced with
a layer-list (flat brand colour + centred mark at each density), so nothing is
stretched and one definition covers every screen — the eleven fixed-aspect
bitmaps distorted the artwork on any phone that did not match one of their
hard-coded ratios.

**3 · Android 12 and later ignored all of the above.** From API 31 the system
draws its own splash and does not read `android:windowBackground` when it is a
drawable. With no `windowSplashScreenBackground` set it derives the colour from
the theme — and the theme's parent was `Theme.AppCompat.**Light**.DarkActionBar`.
A Light parent under an all-black app is a white window background, so the flash
returned on exactly the devices most people own. The theme is now DayNight, the
Android 12 splash attributes are set explicitly, and `postSplashScreenTheme`
hands over to the running theme so the launch drawable does not linger behind
the WebView.

### One black instead of four

`#00030F` is now declared once and referenced by the adaptive icon background,
the launch screen, the app theme and Capacitor's `backgroundColor`. When those
drift the launch reads as a hand-off between different apps. `colorAccent` also
resolved to Capacitor's stock Material indigo `#3F51B5`, a colour that appears
nowhere in this product; it is now the brand cyan.

### Twenty-eight new guards

Section 92 of the wiring audit pins the literal sizes rather than asking
"is there a maskable icon" — the generic form is what passed while broken. It
also fails if a Light theme parent, an `any maskable` combined purpose, or the
fixed-aspect splash buckets ever come back. One of these guards caught a real
mistake during this change: the first pass at the 192 and 384 icons kept an
alpha channel.

## 1.22.0 — versionCode 50

### The Buy screen no longer complains about MoonPay

Removed the sentence naming the on-ramps that refuse this region. Naming
providers who rejected us is a complaint, not information: the reader learns
nothing they can act on, and it makes a first impression sound defensive. The
screen now just lists the routes that work.

### Six more companies, including SpaceX

Verified against the live API before listing: SPCXx (SpaceX), GOOGLx
(Alphabet), MSTRx (MicroStrategy), COINx (Coinbase), CRCLx (Circle), METAx
(Meta). Sixteen curated assets now.

**SpaceX is the interesting one.** It is a *private* company — no exchange
listing, no broker anywhere sells it, no public quote. The token is a claim on
pre-IPO shares held by the issuer, which makes it access that genuinely does
not otherwise exist, and also strictly riskier than the rest: everything else
here can be checked against a live market price and this cannot. The row says
so.

### What was left out, and why it matters more than what went in

Silver, copper and European stocks were all requested by name. Each was checked
against the live API and rejected on **measurement**:

| Asked for | What the API actually returns |
|---|---|
| Silver (XAG) | Eight results, **all** pump.fun clones with `mintAuthorityDisabled` and $1.5k–$6k of fake liquidity. No legitimate silver token exists on Solana. |
| Novo Nordisk | Real token, verified issuer, **$122 of liquidity**. A $200 order is larger than the entire book. |
| ASML / SAP / Nestlé | Same state as Novo Nordisk. European tokenized equity exists on paper with essentially no on-chain market. |
| Copper | Nothing with real depth. Every "XCU" candidate was a clone. |
| Bronze | An alloy. Not traded as a financial instrument anywhere, by anyone. |

These omissions are now **enforced by tests**, including one that asserts the
listing floor is high enough to have excluded Novo Nordisk's $122 book. That
guard exists because "the owner asked for it" is precisely the pressure under
which a scam token gets added six months from now.

A listing is a recommendation to consider something. Listing an asset nobody
can exit is worse than omitting it.

### On the futures engine

Not built, and it would be dishonest to ship a version of it. A real perpetuals
venue needs an oracle, a margin engine, a liquidation keeper and an insurance
fund. Jupiter Perps exists and works, but its integrator revenue runs through
the same referral programme our spot fee does — which is still unconfigured, so
wiring perps in today would add leverage to the product and earn exactly
nothing.

The speculation screens (`/perp`) already explain funding, liquidation and
leverage honestly, and remain the right shape until the referral account is set
up.

### Tests

1285 checks, up from 1276. Ten sabotages verified, including adding the real
Novo Nordisk token, adding a real silver clone, and dropping the listing floor
below $122 — all three caught.

## 1.21.0 — versionCode 49

### Two bugs on the tokenized-equity screen

**Profile pictures were blank.** `iconCandidates` only read `logoURI`, but
Jupiter's API spells the field `icon` — so every equity and staking token fell
straight through to the monogram. Both screens also rendered a bare `<img>`
with no `onError`, which leaves an *empty circle* when a CDN fails: worse than
the monogram, because it reads as broken rather than as a placeholder. That is
the exact failure documented at the top of `lib/tokenIcon.jsx`, reappearing
because a second data source names the field differently.

No symbol-keyed Solana icon CDN was added, deliberately. The EVM path can use
TrustWallet and CoinGecko because both are keyed by contract address; every
Solana equivalent available is keyed by symbol, which is precisely how a fake
AAPLx would inherit Apple's logo. A missing picture is cosmetic; a fake token
wearing the real one's face is financial.

**The $100 / $1,000 / $10,000 buttons showed nothing.** Two separate causes:

- On Farm the selector sat *inside* the pools section, several hundred pixels
  below the staking rows that already read `amount`. The control was driving
  numbers the user could not see without scrolling past them. It now sits above
  everything that depends on it.
- On Stocks the amount fed *only* the depth gate, so changing it silently
  toggled a button's enabled state and displayed no figure at all. Each row now
  states what the amount buys — the quantity, not a projected return, because
  inventing an expected return for Apple stock would be a forecast and this
  codebase does not emit those.

Wiring check 43 now asserts selector-before-content ordering on both screens,
so this cannot come back silently.

### Gold

Requested directly. Two tokens, each backed one-for-one by a troy ounce in a
vault: PAXG (Paxos, New York trust charter, OCC-regulated — listed first for
that reason, not for liquidity) and XAUt0 (Tether). Verified with a live quote:
`USDC → PAXG` returns `platformFee { feeBps: 70 }`.

Its own section rather than mixed into the equities, because gold is not a
company — no earnings, no dividend, no shareholder register — but inside the
same tab, under the same freeze warning. Splitting it into its own tab would
mean either repeating that warning or, worse, not repeating it.

The clone problem is identical: searching `PAXG` returns eight tokens including
"PAX Gold Punk", "Oro Tempis" and a Wormhole-bridged version with $308 of
liquidity trading 37% away from spot. Same defence — verified mints only,
issuer authority re-checked on every fetch. Commodities carry their *own*
authorities rather than a shared one, since Paxos and Tether are different
companies, and a missing authority fails closed.

Liquidity is thin (PAXG $471k, XAUt0 $268k — an order of magnitude below SPYx),
so the existing depth gate binds much sooner here. That is correct and visible
on the row.

### Tests

1276 checks, up from 1264. Changing `issuerMatches` from a boolean third
argument to a kind string broke two existing equity tests — which is what they
are for, and they were updated rather than the signature being worked around.
Eleven sabotages verified across icons, selector placement and the gold issuer
check.

## 1.20.0 — versionCode 48

### Tokenized equities and liquid staking

Two new ways to earn, both routed through the existing Solana swap so nothing
new touches custody.

**Liquid staking.** Swapping into jitoSOL or mSOL *is* staking — no deposit, no
lock-up, no impermanent loss. The token's rate against SOL grows every epoch and
swapping back out is how you stop. It is the only real yield this app can offer
without holding anyone's funds, and unlike the pool rows below it the user stays
inside the app instead of being sent to DefiLlama and lost.

Yields are **joined live** from the DefiLlama feed the Farm screen already
fetches, matched on both project and symbol. Hard-coding `apy: 7.5` would be
wrong within a week and nobody would notice — exactly the bug the old
"15–40%" ranges had. An asset with no matching pool shows no yield at all
rather than a stale one.

**Tokenized equities.** SPYx, QQQx, NVDAx, TSLAx, AAPLx and MSFTx — real shares
held 1:1 by a regulated Swiss custodian, issued by Backed Finance. Verified with
a live quote before any of this was built: `USDC → AAPLx` returns
`platformFee { feeBps: 70 }`.

This also corrects a false claim. The screen previously said "why you can't buy
Apple stock here" and linked out to three issuers. That stopped being true and
the copy is gone — a screen contradicting its own capability is the same class
of error as the old "9 Chains" claim.

#### The safety work, which is most of this release

Searching Jupiter for `AAPLx` returns **seven tokens**. One is real. The others
are pump.fun clones with the same name, the same symbol, and in two cases the
same logo scraped from Google:

| | mint | liquidity |
|---|---|---|
| real | `XsbEhLAtcf6…RLJzJp` | $79,912 |
| clone | `GQfQ2avnmJB…pxWh4` | $3.44 |
| clone | `2qAq8FC9B2y…pnnKA` | $0 |

There is no ranking that fixes this — the fakes copy whatever signal you rank
on. So:

- **A hard-coded mint list, never a search.** Every address verified against
  the live API before commit. This caught one of my own errors: the QQQx mint I
  first wrote shared a 20-character prefix with the real one and resolved to
  nothing.
- **Issuer verification on every fetch.** The server re-checks each mint's
  authority against Backed's own key. A clone cannot pass this because passing
  it requires the issuer's private key. Fails **closed** — a mismatch removes
  the row rather than showing it with a warning.
- **Handoffs carry the mint, never the symbol**, and `?to=` only accepts
  curated mints. Otherwise sharing a `?to=<scam mint>` link would be a one-tap
  phishing vector.
- **A depth gate.** SPYx has $2.8m of liquidity; AAPLx has $80k. A $2,000 order
  is nothing against one and 2.5% of the entire book on the other — thirty-five
  times the price impact, invisible from a $309 share price. Orders above 2% of
  pool depth are refused, and the message names the largest size that would
  work.

**The freeze warning renders above the buy list, not below it.** The issuer
holds a live freeze authority over these tokens, and issuers use it — Tether has
frozen over $5bn across ~10,000 wallets under the same kind of power. A risk
notice placed below the thing it warns about is the pattern that produced the
APKPure rejection.

### Correcting something I got wrong last session

I said the Solana fee was one config change away because Jupiter had dropped the
referral requirement. **That was wrong.** I had tested `/swap/v1/quote` and
generalised to `/swap/v2/order`, which this app actually uses. The current docs
for that endpoint are explicit:

> "Use the Jupiter Referral Program to earn fees on `/order` swaps. This
> requires setting up referral accounts before you can collect fees."

The existing `referralAccount` + `referralFee` parameters in `src/lib/solana.js`
are correct, and the trap documented at the top of that file is real: without an
initialised `referralTokenAccount` the swap succeeds and our fee is silently
zero. Fixing it needs on-chain setup with the owner's own key — it cannot be
done from here.

### A bug the new tests caught

`projectStake(null, 1000)` returned `{ year: 0 }` instead of `null`, because
`Number(null)` is `0` rather than `NaN` and slipped straight past
`Number.isFinite`. An unknown yield would have projected a confident "$0 a
year". Zero is a claim about the rate; null is the absence of one.

### Tests

1247 checks, up from 1194. Every new check verified by sabotage — eight
deliberate breakages of the safety layer, all caught. The clone fixtures are
copied verbatim from the live API rather than invented, because an invented fake
is fake in whatever way happens to make the test pass.

## 1.19.0 — versionCode 47

### The arcade is gone from every build

It used to be a build flag: off for the store APK, on for the website and the
direct-download APK. That was the wrong shape.

A gambling-styled screen sitting one tap from a screen that moves real money
damages the product wherever it appears, and the website is what Google indexes
and what a first-time user judges. It also earned nothing — every round ran on
virtual NX credits — so it was a permanent rejection risk and a permanent
maintenance cost with no upside on either side of the trade.

Deleted: `src/games/`, `src/pages/Play.jsx`, `src/lib/fairness.js`,
`src/hooks/useFairSession.js`, the whole `game.*` locale namespace in all twelve
languages, `nav.play`, the `firstGame` quest, and `VITE_ENABLE_GAMES` from
`package.json`, `vite.config.js`, `ci/build-full.sh` and `ci/build-both.sh`.

There is no flag to turn it back on. A flag would just be the same problem
waiting for someone to set an environment variable.

The build test was rewritten to match. Asserting "the default build excludes
the arcade" would pass forever while someone re-added a Play route, so it now
asserts the files are gone, that neither build emits an arcade chunk, and that
the **full** build ships none of the arcade vocabulary either — the locale JSON
is inlined by Rollup, which is exactly how "removed" screens kept shipping
their words last time.

This also surfaced a live bug: `Predict.jsx` was borrowing `game.stake` from
the arcade namespace. Deleting the namespace turned that label into the raw
string `game.stake` on screen, in the build where Predict is enabled — the
website. Caught by the i18n probe.

### The signal engine now looks past the chart

Everything the app computed before this read **one price series in isolation**.
RSI, MACD, Bollinger and the moving averages are all arithmetic transforms of
the same numbers, which is why they agree with each other and why "indicator
agreement" was a worthless measure of confidence: they agree loudest when they
are all wrong together.

Four independent layers now, and they are allowed to disagree:

| Layer | Source | Answers |
|---|---|---|
| Technical | `lib/ai.js` | what the chart is doing today |
| Historical | `lib/backtest.js` | how often this setup has actually paid, on this asset |
| Structural | `lib/history.js` | levels, drawdown, range position |
| Macro | `lib/macro.js` | market regime, beta to Bitcoin, cycle position |

**The macro layer is the new capability.** An altcoin does not move on its own
chart; the dominant term is what Bitcoin is doing and whether money is rotating
into or out of everything else. It measures the market regime (`riskOn` /
`btcLed` / `rotationOut` / `riskOff`), this asset's beta to Bitcoin with an R²
gate so a beta fitted to noise is never printed, and how far it is from its
all-time high.

`rotationOut` is the case that matters: a falling market with money moving into
Bitcoin is when altcoins are sold first and hardest, and **no chart of theirs
shows it coming**.

**Two horizons, computed differently rather than scaled.** Most "1D / 7D / 30D"
toggles are one number with three labels, which is a lie by presentation. The
monthly view drops the oscillators entirely — RSI is noise over a month — and
lets regime and cycle position dominate. Whether the two horizons agree is then
stated in a sentence, because nobody can derive "weak this week, constructive
over a month" by comparing two gauges.

Every output is a translation key plus numbers, never a sentence, so no claim
can be machine-translated into something we did not say. Stances are
deliberately non-directive — `tailwind` / `mildUp` / `unclear` / `mildDown` /
`headwind` — and **`unclear` is the default that requires evidence to move away
from**. A signal engine whose honest answer is usually "we don't know" is worth
more than one that always has an opinion, because the user learns which of the
two to act on.

#### Two real bugs, found by measuring rather than reading

Both surfaced from printing the numbers for a deliberately conflicted fixture.

1. **The disagreement override never fired.** It compared the standard
   deviation across layers to a threshold of 65. A +95 chart inside a
   rotation-out market — the single most dangerous configuration in the engine,
   and precisely what the macro layer was built to catch — produces a spread of
   59, so it came out as "slightly in its favour". Standard deviation is a poor
   detector here because it is scale-dependent. Replaced with a direct
   sign-conflict test between layers that clear both a weight bar and a
   magnitude bar.

2. **The confidence ceiling was dead code.** The formula's base was 72, so the
   product could never reach the clamp of 75 and the "ceiling" was a comment
   rather than a constraint — a promise the code was not keeping, it just
   happened to be true. The base is now 96 so the clamp actually binds, and the
   ceilings are exported and imported by both the UI and the tests instead of
   being copied.

### Farm shows live yields instead of figures from months ago

The screen was four hard-coded pools with hand-written APR ranges like
"15–40%". The ranges were honest about being ranges and completely disconnected
from what those pools actually paid. A yield figure that never moves is not a
yield figure, and a range that wide cannot be wrong — which is worse than being
wrong.

Live rates now, from DefiLlama through our own backend. The upstream is free
and needs no key, which is the only reason this is possible; it also returns
every pool DefiLlama tracks, 20,000+ of them and several megabytes, so the
server filters it to a few dozen rows and caches for an hour. One upstream
request per hour serves everybody.

**The filter is the entire feature.** An unfiltered yield list sorted by APY is
a list sorted by scam: anyone can deploy a pool advertising 90,000% paid in a
token that cannot be sold, and it will top any yield ranking on earth. Pools
must be on a protocol allow-list, on a chain the app supports, hold at least
$10m, pay between 0.5% and 60%, not be flagged as an outlier upstream, and be
no more than 70% token emissions.

Three things this shows that other yield screens do not:

- **The real/emissions split**, on every row. `apyBase` is interest and fees
  actually paid; `apyReward` is governance tokens minted and handed out. A
  "24%" that is 22% emissions is a countdown, not an income, and the combined
  headline gives you no way to tell.
- **Today versus the 30-day average.** A pool at 40% today with a 6% average is
  not a 40% pool.
- **How many pools were rejected.** "40 of 312 tracked" makes the filtering
  visible rather than implicit.

Ranking is *not* by APY — that would put the riskiest surviving row on top and
undo every filter above it. It is by yield weighted by how much of it is real
and by pool size, so a 12% all-revenue pool with a billion in deposits outranks
a 20% mostly-emissions pool with $12m.

**On revenue, honestly:** we take nothing from anyone's yield and the screen
says so — skimming it would require custody, which this app does not have and
will not take. The revenue is upstream of the deposit: you cannot enter a
CAKE-BNB pool without holding both tokens, and most people arriving here hold
neither. The "get the tokens" button routes that swap through our own screen at
the standard 0.7%. Single-asset pools get no such button, because there is
nothing to pair up and adding one would be manufacturing a swap the user does
not need.

### Tests

1189 checks, up from 1060 + 308. Every new check was verified by sabotage, and
five of them failed that verification on the first attempt and were rewritten:

- `confidence <= 75` passed on a fixture that scored 30, and passed with the
  clamp deleted. It now sweeps 400 synthetic markets and requires that
  something *reaches* the ceiling as well as that nothing exceeds it.
- The 90,000%-APY fixture was rejected by the emissions rule, not the ceiling —
  raising `MAX_APY` to a billion changed nothing. A separate fixture now claims
  300% and books all of it as real revenue, which only the ceiling stops.
- `/getYields/` matched the import line, so replacing the *call* with
  `Promise.resolve(null)` left a dead screen looking wired.

## 1.18.0 — versionCode 46

### The website is now the full version

`vercel.json` builds with `build:full`, so lawpoetics.ir carries every feature.
Only the app-store APK strips the speculation screens, because that is the
only place a content filter applies.

### Four screens became tabbed hubs

| Hub | Contains |
|---|---|
| **Lab** | prediction + invest |
| **Explore** | explorer + discover |
| **Learn** | help + docs |
| **Points & Ranking** | earn + leaderboard |

"Lab" is named that on purpose: both tabs run on virtual credits, and a
container name does the honest work that a disclaimer three paragraphs into
each screen cannot.

Built as one reusable shell rather than five rewrites — splicing pages into
each other risks a hook order or a dropped effect for a change that is purely
navigational. The originals are untouched and still routable, so bookmarks
keep working.

Only the active tab mounts. Rendering both and hiding one would run both
screens' polling at once, doubling API traffic for a tab nobody is looking at.

The tab lives in `?tab=`, so Android's back button steps between tabs, links
can target one, and a crash-reload returns where you were.

### Tab sizing

New `.seg-lg`. The base control is 12px text in 9px of padding — drawn for a
filter inside a card. As a page's primary navigation it read as a footnote and
the tap target was under the 44px minimum.

### Signals: confidence is now measured, not assumed

The old confidence came from **indicator agreement**. That was a bad number,
and worth explaining: every indicator here is a different arithmetic transform
of the *same* price series, so they are correlated by construction — in a
strong downtrend they all shout "oversold" in unison, agree perfectly, and are
wrong together. It reported "how similar are my formulas" as "how sure am I".

`lib/backtest.js` replays the signal over the coin's own history and counts.
Three rules make it honest:

- **No look-ahead.** Each historical signal uses only the bars that existed at
  that moment.
- **Compared against doing nothing.** A 60% hit rate is worthless if the coin
  rose on 62% of all days. `edge` is hit rate minus base rate, it is often
  negative, and it is shown.
- **Small samples are refused**, not rounded into a percentage.

The ceiling dropped from 88 to **75**. No chart rule on a volatile asset
deserves a figure that reads like certainty. With no history to measure,
confidence is capped at 40 — without evidence we are guessing, and the number
should say so.

### Perpetuals, properly explained

The page was honest about what we do not run, but taught nothing — and it
sends people to venues where real money is at stake. It now explains what a
perpetual is, what funding costs, what liquidation means, and what 100x
actually does, plus a table of how far price must move against you to
liquidate at each leverage. 50× is **2%**.

## 1.17.2 — versionCode 45

### I deleted the wallet button styles and did not notice

Reported: the refresh / lock / disconnect buttons were uneven, too small and
an ugly grey.

All true, and it was not a design choice. Rewriting a block of `index.css` two
commits ago dropped `.wal-utils` and `.wal-util` entirely while `Wallet.jsx`
kept using them — so those three buttons rendered **completely unstyled**:
browser-default size, browser-default grey, no spacing. Confirmed against git
history rather than guessed: the rules existed in `e269e7c` and were gone in
`f65a24e`.

Nothing caught it. The build passed, every render test passed, the class names
were spelled correctly — the styles simply were not there.

Restored and sized properly: **40px** min-height, `flex: 1 1 0` so all three
are exactly equal regardless of label width (Persian «بروزرسانی» is far wider
than «قفل», which is what made them uneven), and `--text-2` instead of the
faint caption grey.

**A new audit now fails the build if any project class used in JSX has no
styles.** It immediately found a second one I had missed —
`.wal-action-label`, the Send/Receive caption.

That check took three attempts to get right, and each failure is worth
recording: it passed on its own comment (the note names `.wal-utils`), it was
satisfied by `.wal-util:hover` surviving after the base rule was deleted, and
`includes('.wal-util')` was satisfied by `.wal-utils`. It now strips comments
and requires a real declaration block.

### The Start screen background was half missing

`.galaxy-neb` had **both** `inset: -12%` and `width/height: 124%`. Those fight:
`inset` already stretches the box to 124%, so the explicit width made it
resolve from the left edge and stop at 112% — off-centre, and no longer the
shape of the screen.

That is what made it look cut in half. The SVG uses a **square** viewBox with
`preserveAspectRatio="slice"`, so on a 9:19.5 phone a box of the wrong aspect
shows a narrow vertical band of the artwork instead of the middle of it.

`inset` alone now. The star planes also got an `-8%` overhang, because they
drift up to 5% and were pulling an empty edge into view at the end of each
cycle.

### …and why it may have looked frozen

A global rule sets `animation-duration: 0.001ms` under
`prefers-reduced-motion` — and **Android's battery saver forces that setting
on**. A star's brightness is carried by its twinkle keyframes, so with the
animation killed the dimmest stars sat at `opacity: 0.25` and effectively
vanished.

The stars now pin to `opacity: 0.7` when motion is reduced: the scene stays
visible, nothing moves.

## 1.17.1 — versionCode 44

### The full build existed but nothing ever built it

This is why "امکانات کم شده" was still true after the last release.

`ci/build-full.sh` was added, and it worked — but **CI only ever ran
`ci/build-apk.sh`**. So the only APK that reached GitHub Releases was the store
build, with prediction, perpetuals, invest and the arcade stripped out. A build
variant nothing executes is a deletion with extra steps.

`ci/build-both.sh` now produces both in one run:

| File | For |
|---|---|
| `app-release.apk` / `.aab` | app stores — no speculation screens |
| `FBT-Swap-full.apk` | GitHub Releases, direct download — **everything** |

The full build runs **first** and is renamed immediately, so the stable
`app-release.apk` name is left holding the store artifact. Reversed, an
automated upload grabbing that filename would send the full build to a store
and earn a second rejection.

The flags are exported inside a **subshell**, so they cannot leak into the
store build — a leak would silently produce two identical full builds, one of
them labelled as the store one. Verified.

⚠️ **One line to change** — in `.github/workflows/channel-post.yml`'s sibling
`build-apk.yml`, replace `bash ci/build-apk.sh` with `bash ci/build-both.sh`.
The upload globs are already `out/*.apk`, so they pick up both files with no
other edit.

### The wallet fixes were real — the APK was older than them

The panel work shipped in 1.17.0. A DOM probe now asserts the structure on
every test run, because the failure was a *cascade* outcome: `.card` and
`.wal-hero` each set a different padding while the divider hard-coded `-18px`,
so both rules were individually reasonable and only their combination was
wrong. Reading the CSS would not have caught it.

Verified in the DOM: the hero is no longer also a `.card`, the SVG mesh and
empty-state mark render, and there are **zero** inline `width: 100%` overrides
fighting the stylesheet.

## 1.17.0 — versionCode 43

### The wallet panel was broken by three sources of truth

Reported: the buttons were the wrong size and the screen looked wrong. It was,
and the cause was measurable rather than aesthetic:

- The panel carried **both** `.card` and `.wal-hero`. `.card` sets
  `padding: 15px`, `.wal-hero` set `18px`, and the divider under the balance
  used `margin: -18px` to reach the edges — so whichever won the cascade, the
  hairline **overhung or fell short by 3px on each side**.
- The Buy button was `.btn.btn-sm` with an inline `width: 100%`, while
  `.btn-sm` itself declares `width: auto`. An inline style fighting the
  stylesheet is exactly why it looked mis-sized.

There is now **one** source of truth, `--wal-pad`, and every child derives
from it. A test fails the build if the `.card` class or a literal `-18px`
comes back.

### And it is properly distinctive now

Built with SVG, as asked:

- **A perspective mesh** receding to a vanishing point. A CSS gradient cannot
  do this — parallel lines read as a floor tile, converging ones read as a
  plane.
- **Custom Receive / Send icons** drawn at this panel's weight. The shared
  nav set is stroked for 21px and looks coarse at 20px inside a filled tile.
- **An empty-state mark**: a wallet with a card lifting out, which says
  "nothing in here yet" before anyone reads a word.
- 28px corners against a card's 16px, a lit top rim, and a horizon line
  separating what you *have* from what you can *do*.

Nothing animates except the 7px connection dot. A balance behind moving
decoration is a balance that is hard to read.

### Everything removed is back — in a second build

`npm run build:full` and `ci/build-full.sh` produce an APK with prediction,
perpetuals, invest and the arcade all included.

The default build still leaves them out, because that vocabulary is what
APKPure rejected. **Do not upload the full build to a store** — the script
says so in a banner, and a test asserts the warning is there.

### Tutorials that actually open in Iran

Every tutorial link was a **YouTube search**, and YouTube does not load on
most Iranian networks. The button opened a page that never appeared, which
reads as a broken app rather than a blocked site.

Each section now offers **Aparat (Persian)** first and YouTube second, labelled
by language. Still searches rather than pinned videos: a pinned video can be
deleted or edited into something we would not endorse, and we would never know.

### A galaxy behind the Start screen

Drawn, not filmed — and the reasoning matters:

| A video file | This |
|---|---|
| 2–5 MB, on a 7.5 MB app | a few kB |
| still buffering on a slow connection, on the **first** screen | renders on frame one |
| iOS blocks autoplay in Low Power Mode | always plays |
| stock footage needs a licence | ours |

An SVG nebula with real cloud structure from `feTurbulence`, plus two parallax
star planes. **Individual stars never move** — only `opacity` on each star and
`transform` on the two planes, both compositor-only, so the browser animates
two elements rather than sixty. Positions come from a seeded PRNG so a
re-render cannot reshuffle the sky.

Reduced motion keeps the scene and stops the movement.

## 1.16.0 — versionCode 42

### APKPure rejected us. Here is exactly why, and what changed

> *"Not involve illegal sensitive words."*

That is the standard wording for an automated content filter, and the app was
giving it plenty to find:

| What the filter saw | Where |
|---|---|
| "Price prediction" · "Call the next candle — up or down" | an entire screen — that is a **binary option** |
| "Perpetuals" · "Leveraged futures" · 100x leverage | an entire screen |
| "Invest" · "fixed-term yield plans" | an entire screen |
| "gambling-style games" · "house edge" | arcade copy |

Every one of those was simulated and carried an honest risk notice saying so.
**That does not help.** A reviewer — and certainly an automated filter — reads
the words on the screen, not the disclaimer three paragraphs below them.

They were also earning **nothing**: every one runs on virtual credits, so they
could not produce a single unit of revenue while being the specific reason the
app could not be distributed. Bad trade in every direction.

Prediction, perpetuals and invest are now behind `SPECULATION_ENABLED`, off by
default, exactly like the arcade. A release build that forgets an env var fails
**safe**.

### Removing the screens was not enough

This is the part that would have caused a second rejection.

The routes were gated and **zero** Predict/Perp/Invest chunks were emitted —
that part worked first time. But the **words were still in the bundle**,
because locale files are *static imports*: Rollup inlines the whole JSON long
before any runtime code could delete a key. I tried the runtime filter first
and measured that it changed nothing.

A content filter scans strings, not routes. The keys are now stripped from the
JSON at **build** time, before bundling. Verified on the built output in all
twelve languages — including one Persian quest string
(«یک پیش‌بینی قیمت ثبت کن») that survived after everything else looked clean,
and was only found by grepping the compiled bundle.

A test now greps the built output for that vocabulary and fails the build if
any of it returns. Disabling the stripper makes it report all ten terms.

### The wallet, properly this time

The last attempt kept it a `.card` with a wash behind it, and the verdict was
that it still did not feel special. Correct — a card with a gradient behind it
is still a card, and every other surface in the app is one too.

Three changes, none of them "more colour":

- **A different shape.** 28px corners and a darker base than any card, so the
  eye reads it as a different *kind* of object.
- **Light with a source.** A glow at the top-left *plus* a lit rim along the
  top edge. That pairing is what makes a flat rectangle look like a physical
  panel; the wash alone was just a coloured smudge.
- **A horizon.** A hairline across the full width under the balance,
  separating what you *have* from what you can *do*. One pixel, and it does
  more for the structure than the gradient does.

### Auto Orders removed from the More menu

It is the raised centre button in the bottom nav. A menu entry for the same
destination makes the list worth reading less.

## 1.15.1 — versionCode 41

### We were advertising a chain that does not exist

The `<title>` said **"9 Chains"** and the description listed **Tron**. We
support seven EVM chains plus Solana — eight — and there is no Tron swap route
at all; `chains.js` mentions Tron only to warn that sending an EVM address to
it burns the funds.

This mattered more than a typo, because **that text was what Google had
indexed**. The one thing search engines knew about us was partly false, and
anyone arriving to swap on Tron would have found nothing and left. An
advertised capability that does not exist is also exactly what a store
reviewer checks.

A test now derives the real chain count from the source, so the claim cannot
drift again.

### The site had exactly one indexable page

Measured, not guessed: `site:lawpoetics.ir` on Google returns **one** result,
while the app has **33 routes**.

That is arithmetic. Every route is behind a hash (`/#/swap`), and nothing
after the `#` is ever sent to the server — so a crawler receives the identical
document for every screen. The sitemap honestly listed one URL, because
inventing hash entries would just resolve to the same page.

Meanwhile `watches: 0`. Zero real users. Search is the only arrival channel
that costs nothing and keeps working while nobody is watching it, so one
indexable page was the most expensive fact about this project.

There are now three real static pages, generated at build time:

- `/non-custodial-crypto-swap`
- `/crypto-price-alerts-and-dca`
- `/crypto-market-history-analysis`

Each is genuine prose about a feature that actually works, loads with **zero
external requests**, and links into the app with a normal anchor.

**Why not SSR:** a rendering server costs money every month. These are plain
files on hosting that already costs nothing.

**Why this is not cloaking:** a crawler and a person are served the same file.
There is no user-agent branching anywhere — a test asserts that — and no
meta-refresh, because an instant redirect turns a landing page into a doorway
page that Google penalises.

Three pages, not thirty. A handful about things people search for beats many
thin ones, which search engines count against the whole domain.

## 1.15.0 — versionCode 40

### The history engine

Requested: «سابقه روی این نمودار چی بوده و گذشته به ما چی میگه» — what has
happened on this chart before, and what does the past tell us.

The app already had `analyze()`: RSI, MACD, a moving average, one nearest
support and resistance. Every one of those is a **snapshot**. None can answer
*"has this level held before, and how often"* — which is the question a person
actually asks before setting a limit order at a price.

`lib/history.js` measures repeated behaviour across the whole series:

- **Levels the market keeps returning to**, with a touch count. Bands are a
  percentage of price, not a fixed amount — 1% of BTC and 1% of a sub-cent
  token are wildly different numbers, and a fixed step would give one coin
  three bands and another three thousand.
- **How each level behaved**: `held 3 of 4 tests`, counted, never a
  probability.
- **Worst fall in the window** — the number people most under-estimate before
  committing to a schedule of recurring buys.
- **Volume against this coin's own normal**, using the **median**. One listing
  pump can drag a mean so high that every later day looks quiet by comparison,
  which is exactly backwards.
- **A base rate**: "58 of 90 days were followed by a higher price 7 days
  later". Withheld below 30 samples, because a percentage from a dozen
  observations invites someone to treat noise as an edge.

### Nothing in it predicts anything

Every value is a count, a frequency or a distance measured from data that
already happened. *"This level was tested 4 times and held 3"* is a fact.
*"This level will hold"* is a forecast, and a forecast dressed as analysis is
how someone loses money believing they were told something reliable.

The `kind` field on each fact is `neutral | caution | notable` — for colour
only. It deliberately has no bullish/bearish value: the moment the module
emits "bullish", it has started forecasting. A test asserts that.

There is no green and red on the panel for the same reason. Colouring "price
held support 3 of 4 times" green would turn a measurement into a
recommendation.

### The one that mattered most

A price that *sits* at a level for twenty bars is **one** event, not twenty
tests. Counting each bar would turn a single sideways drift into a fabricated
pattern. Verified by sabotage: removing that guard makes the test report
`got 10` instead of `1`.

Two other sabotages were checked — swapping the median for a mean, and showing
a thin base rate — and both fail their tests.

### Where it appears

- **Coin detail**, between the metrics and the buy/sell buttons: the last
  thing read before a decision. Uses the chart already on screen, so no extra
  request, and follows whichever range is selected.
- **Automatic orders**, inside the limit-order form. This is where the
  question is really being asked — someone typing a target price was
  previously shown only the current rate, with no context at all. It follows
  whichever side of the pair they chose to watch.

When a coin has too little history, the panel renders **nothing** rather than
a spinner implying data that will never come, or filler.

## 1.14.3 — versionCode 39

### The drop looked stuck to the floor

Reported: «توپ به کف چسبیده، یکم فاصله بگیره».

Measuring first was worth it, because the geometry was already right: the
drop's bottom sat at 57px and the notch floor at 49px — eight clear pixels.
**The shadow was hiding them.** At `0 4px 12px` it fell four pixels downward
and blurred twelve, which spanned the entire gap and visually welded the drop
to the rim.

Two changes: the shadow is now `0 2px 6px` — half the drop, half the spread,
so it grounds the shape without bridging to the bar — and the hollow is 2px
wider at every breakpoint, taking the clearance to 10px. The drop stays
centred on the notch centre, so the ring of air is even all the way round.

### A test that had stopped testing

While fixing the above, the geometry test reported success on values it was
no longer reading — it had the small-phone and landscape numbers **hardcoded**
from an earlier version. It now parses every breakpoint out of the stylesheet
and fails loudly if a regex stops matching, rather than comparing against
`NaN` and passing.

The shadow check was hardcoded too, asserting exact pixels. It now asserts the
two properties that actually matter: the shadow must be neutral (a coloured
one reads as a glow) and tight (offset ≤ 2, blur ≤ 8), so any future value
that bridges the gap fails regardless of the exact numbers.

### Wallet: the disconnected state

The first thing a new user sees on this tab was **a single bare button on an
empty card** — on the screen that has to earn enough trust for someone to
connect a wallet holding real money.

It now uses the same hero surface as the connected state, so the page does not
change shape at the moment of connecting, and it answers the two questions
people actually have before tapping: what is this for, and are you going to
hold my keys. The reassurance sits next to the button rather than in a notice
below the fold.

### Wallet: housekeeping separated from money

Refresh, Lock and Disconnect were four same-weight ghost buttons directly
under the holdings, so **"disconnect" carried exactly as much visual weight as
"refresh"** — and one of them is destructive.

They are now a quieter row behind a hairline. Disconnect is tinted because it
is destructive, but not alarming: a red button on a wallet screen makes people
uneasy about the whole page, not just that control. Unlock stays primary when
the wallet is locked, because then it is the only thing worth doing.

## 1.14.2 — versionCode 38

### The centre button jumped right when tapped

Reported: «دکمه پس از زدن به سمت راست میرود، نمیخواد همونجا بمونه».

The button is centred with `transform: translateX(-50%)`. **Framer Motion does
not add to an existing transform — it writes the whole property.** So the
instant a tap began, `transform` became `scale(0.88)` and the `-50%` was gone,
shoving the button 21px to the right. Framer kept owning the property
afterwards, so it never came back.

The press now scales the inner `.nav-centre-drop`, which has no centring of
its own, so Framer can own *its* transform completely. Nothing in JS touches
the button's transform again.

The active state had the same latent bug — it used `transform: translateY(2px)`,
which the first tap would have wiped permanently. It is a brightness change
now.

Both are guarded by tests that fail against the old code.

### Everything else that was asked

- **RGB, like the rest of the app.** A single flat colour looked foreign next
  to the RGB spectrum every other accent uses. It is a two-stop
  `--rgb-1 → --rgb-2` ramp — the app palette in its calmest form. Two stops,
  not three: a busy ramp on a 42px circle is detail nobody can resolve, which
  is why the gradient came off in the first place. A test pins it at two.
- **Goes to Auto Orders**, not Buy & sell.
- **New icon** — two crossing arrows, the standard "scheduled / recurring"
  mark and the same family as the swap icon already in the bar. Stroked and
  17px rather than filled and 18: on a small circle a light outline reads as
  more delicate.
- **42px**, down from 44. Two pixels lighter without dropping below the
  comfortable-tap threshold.

### A test that was lying

While adding the checks above, one reported a failure on a correct
stylesheet: it sliced a fixed number of characters after the selector, and the
long comments inside these rules pushed the declarations outside the window.
Same brittle-window trap as the button-row check earlier. It now finds the
rule's real closing brace, so there is nothing to outgrow.

## 1.14.1 — versionCode 37

### The centre button is minimal now

The reference image made the gap obvious. Four things were making it heavy:

| | before | now |
|---|---|---|
| Fill | 3-stop neon gradient | one flat colour |
| Shape | teardrop, rotated 45° | plain circle |
| Shadow | coloured glow | neutral black |
| Size | 48px | **44px** |

A gradient on a 44px circle is detail nobody can resolve — it only makes the
shape look inflated. The coloured glow was the single heaviest thing on the
element. And the pointed corner was over-drawing the metaphor: the reference
reads as "a drop about to fall" purely from being round and sitting above the
surface.

The active state now *sinks* two pixels and changes hue instead of glowing
brighter, because a flat fill has nowhere brighter to go without becoming a
glow again.

### …and it was eight pixels out of place

Found while re-measuring: the drop's centre sat at 70px while the notch's
centre is at 78px, so it was **sinking into the bar** rather than resting in
the hollow — the same "merged into the menu" look that was reported, but
reintroduced by arithmetic rather than styling. It looked entirely plausible
in the CSS.

The relationship is now derived and asserted at all three breakpoints:

```
bottom + diameter/2  ===  barOffset + barHeight
56     + 44/2        ===  14        + 64        = 78 ✓
```

The test fails with the old value, so this cannot drift again.

### The glyph matches where it goes

The first pass put a home icon on a button that navigates to Buy & sell. It is
now a filled plus — and filled rather than stroked because a 2px stroke on a
saturated 44px circle reads as faint.

## 1.14.0 — versionCode 36

### The centre button now separates from the menu

Reported: «این بزرگه داخل منو ادغام شده جالب نیست» — the raised button looked
merged into the bar rather than resting in it.

It was a child of the bar, sitting on top of it with a ring painted in the
bar's own colour. That ring can never match: the bar is semi-transparent with
a backdrop blur, so an opaque patch over it reads as a lighter disc.

There is now a **real hollow**. A radial-gradient `mask` removes pixels from
the middle of the bar's top edge, so the page shows through and the droplet
floats in genuine empty space. Because it is a mask rather than a cover, the
blur, the border and the shadow all follow the new outline for free.

That forced a structural change worth knowing about: **a CSS mask clips every
descendant**, so a button inside the bar would have been sliced in half by the
very notch meant to frame it. The droplet is now a *sibling* of the bar,
positioned to the same centre line, with a zero-content spacer holding the gap
so the four tabs still space themselves evenly. A DOM test asserts it stays
outside the bar, because moving it back in would look subtly wrong rather than
throw.

Also smaller — 48px, down from 56. The old one filled the bar's height, which
is what made it read as part of the bar; at 48px inside a 64px hollow there is
8px of clear air all the way round, and that visible gap is what says
"separate".

### Wallet: a hero instead of a list of cards

Requested: a distinct treatment «مثل wallet connect».

Stripped of branding, that look is three things — one tall surface instead of
stacked cards, a soft colour wash *behind* the content rather than on it, and a
single bright pair of actions with nothing competing.

**The reordering is most of the design.** The old card led with a section
label, then a small address row, then the buttons, and the balance came
*fourth*. The number people open a wallet to see now leads.

- A blurred aurora sits in its own layer, so the blur never touches the text.
- The address became a bordered chip — it reads as an object you could copy
  rather than a stray string.
- A live wallet's status dot pulses slowly. It is the only looping animation
  on the screen and it is 7px wide; a locked wallet does not pulse, so the
  absence is information too.
- The balance uses `tabular-nums`, so digits stop jittering sideways as the
  value refreshes.

### Discover: live, and searchable

It was sixteen static links, so there was no reason to open it twice.

- **Trending now** — a live strip of the top movers. It reuses `getTrending`,
  which Market already polls and the server already caches for 120 seconds, so
  on a device that has visited Market this costs **zero** extra requests. It
  polls every 5 minutes, not 30 seconds: trending coins do not turn over in
  half a minute.
- **Search** over the curated list, with a proper empty state — an unexplained
  blank screen reads as broken rather than as a filter with no results.

Search deliberately **cannot** navigate to a typed address. A free-typing URL
field inside a wallet is a phishing delivery mechanism, and adding one would
undo the single most valuable property of this screen.

## 1.13.1 — versionCode 35

### The QR scanner's grey picture — found, and it was not the camera

Reported: «گاهی تصویر طوسی نشون میده».

The camera effect listed `onClose` and `onResult` in its dependency array, and
**both call sites pass inline arrow functions**:

```jsx
<QrScanner onClose={() => setScanOpen(false)} onResult={(p) => …} />
```

A new arrow function is a new identity on every render. So the effect re-ran on
every parent re-render — and its cleanup calls `stop()`, which sets
`video.srcObject = null` and stops the camera track. A `<video>` with no source
paints its own background: **grey**.

**Why it was intermittent, which is what made it hard to pin down:**
WalletContext refreshes the balance on a `setInterval(…, 30000)`, and every
refresh re-renders each consumer — SendSheet included. So the camera was torn
down and rebuilt roughly **every 30 seconds**. Scan quickly and you never saw
it; hesitate over the code and the camera died under you. On some Android
devices the reopen fails outright because the previous track has not released
yet — that is the "sometimes it never comes back" version of the same fault.

The callbacks now live in refs and the effect depends on `open` alone, so the
camera starts once and stops once.

A new probe suite drives the real component with an instrumented
`getUserMedia` and counts hardware opens. With the old dependency array it
measures **6 opens and 5 stops** across five re-renders; it now measures **1
and 0**. A static check on the dependency array could not have proved this —
it proves the array was *written* correctly, not that the camera survives.

Second half of the fix: even a legitimate cold start takes a second or two, and
an unexplained grey box during it is indistinguishable from a failure. There is
now a spinner and «در حال روشن کردن دوربین…» until the first real frame
arrives (`readyState >= 2` — `play()` resolves before any pixels exist), and
the reticle stays hidden until then, because brackets over a blank box imply a
running camera when there is none.

### The Share button that collapsed next to Copy

Reported: «دکمه اشتراک‌گذاری و کپی متناسب نیست و دکمه اشتراک‌گذاری خیلی کوچک و
جمع شده است».

`.btn` sets `width: 100%`. For a flex item, **`flex-basis: auto` resolves to
that width** — so a button with no flex declaration has a basis of the entire
row and `flex-grow: 0`, while its neighbour with `flex: 1` has a basis of `0`:

```
Share   flex: 1     → basis   0px, grow 1
Copy    (no flex)   → basis 340px, grow 0
```

The bases already exceed the container, so free space is **negative** and
`flex-grow` has nothing to distribute. Share stays at 0 and collapses to its
longest word; Copy keeps almost the whole row. **The button that asked to
expand is the one that got squeezed.**

New `.btn-row` helper sets `flex: 1 1 0` and `width: auto` on every child, so
the split is even regardless of label length — which matters across twelve
languages, where "Share", "اشتراک" and "Compartir" are very different widths.
Below 340px they stack instead of cramming.

Wiring check #31 fails any row that mixes the two styles. Its **first version
was itself buggy** — it capped the search at 900 characters and the invite row
is 1126, so it reported PASS while the bug was live. It now balances the `div`
tags instead of guessing a length, and correctly ignores `.btn-sm` rows
(`.btn-sm` sets `width: auto`, so the trap does not apply — the Orders action
row mixes the two styles *correctly*).

### Solana: the fee we quoted was not the fee we charged

The Solana screen unconditionally announced a **0.70% platform fee**. But the
fee is only requested when a Jupiter referral account is configured, and it is
deliberately not — setting one up costs SOL, and with no users there is nothing
to collect. So every visitor was told they would pay 0.70% while paying
**nothing**.

Overstating a fee is the safer direction to be wrong in, but "the fee I was
quoted is not the fee I paid" is exactly the discrepancy that makes someone
distrust a swap they cannot reverse. The notice is now gated on the *same*
flag that decides whether to request the fee, so the two cannot drift apart.
When a referral account is set, the 0.70% copy returns on its own.

## 1.13.0 — versionCode 34

### The selection that was invisible

Reported: on **Automatic Orders**, choosing "price falls to" or "price rises
to" appeared to change nothing.

`.segmented button.active` sets exactly one property: `color: #000`. The
coloured pill behind it is a *separate* component, `<SegIndicator>`, and each
screen has to render it. Orders never did — so a selected button was black text
on a near-black panel: **less** visible than the unselected state. The class was
being applied correctly the whole time, which is why nothing caught it.

Three independent fixes, because a selection indicator must not depend on any
one of them:

1. The missing indicator is now rendered.
2. `.segmented button.active` carries a flat background as a fallback, so a
   future omission degrades to "less pretty" rather than "invisible".
3. A **✓** before the label and `aria-pressed` on the button. Colour is not
   available to everyone.

**Wiring check #26** now fails the build if any `.segmented` control in the app
ships without an indicator, and a render test asserts the pill is really in the
DOM and moves when you tap — a check on the CSS class alone would have passed
while the bug was live.

### Is this order actually watching?

Every active or paused order now carries a state badge in its header:
**در حال پایش** / **آماده** / **متوقف**, with a dot that pulses only for a
ready one. Before this the pause/resume *button label* was the only clue, so
you had to read a button to learn a row's state — and a paused order that looks
live is the failure that costs a user the price they were waiting for.

### Three more bugs on the same screen

- **`--ink-dim` was never defined.** Not in `:root`, not in the light theme.
  The "paused" badge therefore had no colour of its own and looked identical to
  an active one. Two other rules already wrote `var(--ink-dim, #9aa3b2)` with a
  fallback, which is how it went unnoticed.
- **Paused rows were never dimmed.** The rule keyed off `.ord-paused`, a class
  that only appears on a badge which is rendered *exclusively* for orders that
  are neither active nor paused. It could never match.
- **The percentage was the wrong colour half the time.** It painted green when
  the price was above target — correct for "sell when it rises", exactly
  backwards for "buy when it falls", where a falling price is the good news.
  It also crashed on a legacy order with no target (`null.toFixed`).
- **`BAD_TRAIL` had no message.** An out-of-range trailing distance showed the
  literal string `orderErr.BAD_TRAIL` as the explanation. The text existed
  under `orders.err.BAD_TRAIL` — written, translated, read by nothing. Wiring
  check #30 now derives the code list from the source, so any future error code
  fails the build until it has a message.

### Sharing works outside Telegram

The **only** share implementation in the app built a `t.me/share/url` link and
opened it. On most Iranian networks t.me does not resolve, so the tap did
nothing; without Telegram installed you landed on an install-Telegram page; and
anyone whose friends use WhatsApp, iMessage, X or SMS had no route at all.

Sharing is the only zero-cost growth channel this project has, so every failed
tap was a user who tried to bring us another user and could not.

`lib/share.js` now walks a ladder: the **Capacitor share sheet** inside the
APK → the **Web Share API** (this is what makes Safari on iPhone work) →
Telegram, but only when genuinely running inside Telegram → an in-app list of
WhatsApp / Telegram / X / LinkedIn / email / SMS. Copy sits beside share and
never fails. A dismissed OS sheet is treated as a decision, not an error, so
nothing pops up behind it.

### iPhone and iPad are supported platforms now

There is no iOS build of this app and there cannot be one without an Apple
Developer account, so the home-screen PWA is the **only** way an iPhone user can
keep FBT Swap.

- Safari ignores the web manifest almost entirely. Without
  `apple-mobile-web-app-capable` the "installed" app opened in a normal Safari
  tab with the address bar; without `apple-mobile-web-app-title` the icon was
  captioned with the 60-character SEO `<title>`. Both are set.
- Safari **never** fires `beforeinstallprompt` — Apple has not implemented it —
  so the install banner rendered nothing at all on iOS. It now shows the
  Share → Add to Home Screen instruction, and only in real Safari: Chrome and
  Firefox on iOS cannot add to the home screen, so telling their users to look
  for the option would send them hunting for a menu item that does not exist.
- **iPadOS 13+ reports a Macintosh user-agent**, so every naive `/iPad/` test
  classifies an iPad as a desktop. `maxTouchPoints` is the reliable tell.
- `format-detection: telephone=no` stops Safari turning wallet addresses and
  token amounts into blue "call" links.

### Responsive: phone, tablet, desktop

The shell was 520px wide with breakpoints at 900px and 1400px. **An iPad in
portrait is 768–834px — below 900** — so every tablet got the phone layout: a
520px strip of content with the fixed bottom nav stretched across the full
820px beneath it. The nav and the content it belonged to were visibly different
widths.

- New breakpoints at **≤360px** (small phones: three-up grids become two-up),
  **600–899px** (tablet portrait) and **landscape phone** (a phone on its side
  has ~350px of height; full-height sheets swallowed the screen).
- Hover effects are gated on `@media (hover: none)` — the *capability*, not the
  screen size. A tapped card used to stay stuck in its hover state until you
  tapped elsewhere, and looked selected when it was not.
- Third-party images (token logos, NFT art) can no longer overflow and push the
  page sideways.
- Horizontal overflow uses `overflow-x: clip`, **not** `hidden`: `hidden` turns
  the element into a scroll container, and a scroll container between a sticky
  element and the viewport silently kills the stickiness — the header would
  have scrolled away.

### The maskable icon was being cropped

One square image was declared for both `purpose: "any"` and
`purpose: "maskable"`. A launcher crops a maskable icon to its own shape and
only the middle 80% is guaranteed to survive, so on Android the outer neon ring
— the entire recognisable part of the logo — was sliced off. There is now a
separate `icon-maskable-512.png` with the art inside the safe zone.

## 1.5.2 — versionCode 16

### Fake money removed from the chrome

The header showed `useAppStore.balance` — **NX credits**, the play money used
by the arcade and paper-trading screens — next to the brand on *every* page.
So the first number a user saw on a non-custodial exchange was a fake balance
that looked like theirs. On a product whose entire promise is "you hold your
own keys", that was the most misleading pixel in the app. It is gone.

On **/wallet**, the real on-chain wallet now renders **above** the virtual
balance, the allocation pie and the paper history. Order is a claim about what
matters, and the real one leads.

### Fixed: intermittent freezing

`AdBanner` ran **eight** `repeat: Infinity` animations plus a ninth CSS sweep —
and it renders on **nine pages**, including Market, Swap and Wallet. Every one
of those screens therefore carried nine permanent animation timers *on top of*
the three blurred background orbs fixed in 1.5.1.

`useStill()` already existed for exactly this purpose and the banner simply
never called it. Not a missing feature — an unused one. All nine now freeze on
native and under `prefers-reduced-motion`.

### Contact

- **Telegram removed**; email is the contact route, in Contact *and* Settings.
- Added **X** ([@CompanyFbt](https://x.com/CompanyFbt)) and **LinkedIn**, with
  a proper X logo — `IconX` is the close/dismiss cross, and reusing it would
  have put a "close" glyph on a social link.
- The LinkedIn URL is stored **without** its `utm_source`/`utm_content`/
  `utm_medium` parameters, which would have told LinkedIn every visit came
  from an Android share sheet.

### Fixed: stale version string

Settings printed a hardcoded **`v1.0.0`** while the app shipped 1.5.x — a
version nobody updates points bug reports at the wrong build. It now comes
from `package.json` at build time.

## 1.5.1 — versionCode 15

### Fixed: the app could lock you out permanently

Reported as *"I went into settings, the app crashed, and it never worked
again."* The crash and the lockout were two different things, and the second
was the serious one.

Enabling biometrics persists `biometricEnabled: true`, and `AppLock` mounts
before everything else on every launch. A user with **no in-app vault and no
2FA** then had no way past it once the sensor stopped recognising them — and
because the flag survives a restart, force-quitting did not help. The only
exit was reinstalling, which for anyone who *did* have a vault destroys the
encrypted seed.

The lock screen now offers **"turn off the lock and open the app"** when no
other factor exists. That is safe precisely *because* there is no vault and no
second factor: there is no secret the button could expose. A settings toggle
must never be able to brick the app.

### Fixed: severe slowness, and the More-menu jitter

Both had the same root cause, and it was not the menu.

Three background orbs sized 60/55/48vw, each with `filter: blur(70px)`, drift
**forever behind every screen** — `RgbBackground` sits above the router and
never unmounts. That is roughly **a million blurred pixels recomposited every
frame, for the entire session**. On top of that, `.sheet-backdrop` blurs the
whole viewport, so opening any sheet stacked a full-screen backdrop capture on
those moving orbs.

A browser tab absorbs this. A Capacitor WebView cannot: it composites through
the host app, shares a GPU with the native layer, and gets none of the
browser's page-visibility optimisations. **This is why the APK felt heavier
than the website while running identical code.**

On native the orbs now render static — same palette, same depth, zero
per-frame cost — and the full-screen backdrop blur is dropped. The More menu's
own animation was already reduced to opacity+y with no per-tile springs; the
cost was always in what sat behind it. `prefers-reduced-motion` now freezes
the field everywhere, which it should have done from the start.

### Splash

- The mark is now an **F** for FBT. It was drawing a **B**.
- **Social links** under Start — Telegram, Instagram, email, reusing the exact
  accounts Contact already links to rather than a second invented list.
  `mailto:` is handled separately because `openUrl` accepts https only by
  design, so that button would have looked live and done nothing.

## 1.5.0 — versionCode 14

### New first-run experience

- **Splash screen.** Logo, app name and a single **Start** button. Animated
  entrances plus one slow orbiting ring — deliberately restrained, because the
  Ecosystem page shipped with nine permanent blur pulses and felt broken on a
  mid-range phone. Nothing here keeps running once the screen unmounts, and
  `prefers-reduced-motion` is honoured: a spinning first screen is a real
  accessibility problem on the one screen nobody can skip.

- **The language question is no longer asked twice.** Welcome asked for a
  language, then onboarding asked again as step 0. Two consecutive screens
  posing the same question read as a bug — before the user had seen anything
  the product does. Onboarding now opens on the first feature slide, and the
  language switch in its header opens a sheet instead (it had briefly been
  left with no handler at all, which is precisely the dead-control failure
  this project keeps hitting).

- **Default language is now English.** It was Persian, which meant anyone
  whose device gave no usable hint opened a right-to-left app in a script they
  might not read, and had to find the language control before doing anything.
  English is already the fallback locale, so it is the one language guaranteed
  to have every key translated — and Persian is one tap away on the next
  screen.

Flow is now: **splash → language + name → features → wallet → terms → guide → app**
(six steps, down from seven).

### Testing

Three existing suites asserted the old behaviour and correctly failed:
`boot-e2e` demanded Persian on first paint, `first-launch-flow` expected
Welcome first, `i18n-probe` expected `fa` to autoload. All three were updated
to the new intent rather than relaxed. Verified non-vacuous by disabling the
splash — five checks fail, including the real-browser boot test.

## 1.4.1 — versionCode 12

### Fee raised to 0.70% — no configuration needed

The default was 50 bps with a comment saying "set `VITE_FEE_BPS=70`". That
variable was never set, so **every build ever shipped at 0.50%** while the
reasoning sat in the source unused. A default nobody changes *is* the
configuration, so the default is now the intended rate.

Measured in-wallet rates, 2026: MetaMask 0.875%, Phantom 0.85%, Rainbow 0.85%,
Trust 0.70%, ZenGo 0.50%, Rabby 0.25% — median **0.70%**. We are now at the
median and still cheaper than the three largest wallets. **+40% revenue on
identical volume.**

`VITE_FEE_BPS` still overrides it, and the 100 bps hard cap is unchanged. A
unit test now asserts the default, so a silent revert fails CI instead of
quietly costing money.

### Removed: the fiat on-ramp

Shipped in 1.4.0 and removed one version later, because it could not work for
this app's actual users. MoonPay, Transak and Ramp all block Iran under OFAC
sanctions — the screen would have been a dead end for the primary audience.

The alternative was worse. On **2 June 2026** OFAC designated Nobitex, Wallex,
Bitpin and Ramzinex with **secondary sanctions**, meaning any non-US
institution that processes for them risks being cut off from the US financial
system. Integrating an Iranian exchange would expose the app, Google Play
distribution and the company itself. Neither path is available, so the honest
move is to ship neither rather than a button that fails.

What remains is the P2P screen, which already routes users to external desks
without us holding funds or acting as an intermediary.

## 1.4.0 — versionCode 11

### New: Buy crypto (fiat on-ramp) — the second revenue stream

A swap-only app can only earn from people who **already hold crypto**. This is
the step where someone with none becomes someone with a funded wallet, and
every future swap fee depends on it happening.

Measured 2026 wallet monetisation: swap fees run 0.4–1.0% of volume, on-ramp
referral pays roughly 0.3–1% of purchase value — and card buyers move far more
per transaction than the same person swapping later. It costs nothing to
build: the provider handles KYC, payments, fraud and compliance.

Three providers (MoonPay, Transak, Ramp) so users can compare rates, which
differ substantially. **We never take custody** — the coins go straight to the
user's own address, which is why a non-custodial app may do this at all: we
are an introducer, not a money transmitter.

Safety rules enforced in code, not just copy:
- A malformed or non-EVM address **refuses to build a URL**. A widget opened
  with no destination lets the *provider* pick one, and the user would buy
  into an address they do not control — unrecoverable.
- Amounts are capped and negatives dropped before reaching the provider.
- Chains the providers cannot settle on are blocked, rather than producing a
  failed purchase *after* payment.
- Opens in a Custom Tab so the real domain is visible. A payment page inside a
  WebView we draw is indistinguishable from a phishing page.
- The disclosure — that a third party takes the money and we cannot refund,
  cancel or trace it — appears *before* the user leaves.

### Fixed

- **NFT screen showed a meaningless error.** The live cause is `Alchemy 403`
  (the API key is revoked), but `serve()` flattened every failure into
  `UPSTREAM_FAILED`, for which no translation existed — so it rendered as a
  generic "something went wrong". Now 401/403 → "our key needs renewing",
  429 → rate limited, 5xx → provider down, each translated.

  `serve()` also leaked the raw upstream message into `detail`, and for
  Alchemy **the API key sits in the URL path** — so an error string could
  carry it to the browser. This route now emits fixed codes only.

- **Ecosystem restyled as glass**, for both themes. Not with
  `backdrop-filter`: see the note above `.card` explaining why it was stripped
  from repeating elements — the compositor must capture and blur the region
  behind *every* instance, every frame, and the background never stops moving.
  17 tiles of that would reintroduce exactly that stutter. The frost is built
  from a translucent tint, a top-left sheen and a hairline highlight, which
  cost nothing to composite. Light theme is defined separately because
  translucent white over white is invisible.

### Testing

- 18 new checks (266 unit + 72 wiring). One wiring check initially **passed
  when the code was deliberately broken** — the env var is built from a
  template literal, which defeated the regex. Rewritten to scan string
  literals; now verified to fail on the sabotaged version. A check that cannot
  fail is worse than no check, because it is trusted.

## 1.3.1 — versionCode 10

### Ecosystem screen rebuilt

The "buggy" feel was real and measurable, not cosmetic:

- **Nine permanent GPU animations.** Every card pulsed a `repeat: Infinity`
  halo built on an 80px `filter: blur(30px)`. Blur is the most expensive
  filter to composite, and nine running forever kept the GPU busy the entire
  time the screen was open — visible scroll jank on a mid-range phone, plus a
  real battery cost. Replaced with a static border and a cheap gradient wash.

- **It bypassed the safe link path.** It called `window.open` directly instead
  of `openUrl` (Custom Tabs). Inside the packaged app that opens a WebView
  with no address bar, so the user cannot see which domain they landed on and
  we are implicitly vouching for it. In a wallet that is a phishing surface,
  not a styling preference.

- **Real logos** instead of letter tiles, with a monogram fallback so a failed
  icon never leaves a hole in the grid.

- **Search**, and **17 entries** instead of 9 — added Uniswap, Arbitrum, Base,
  DefiLlama, DEX Screener, Chainlist, Rabby and Safe.

### Fixed

- **No web manifest existed.** The site could not be installed to a home
  screen at all, and wallets that read a dapp's manifest when drawing the
  connection dialog found a 404 where the name and icon should be.

### Notes on the AI assistant

"Ask" is wired correctly — the server reports `{"enabled":false}` because no
AI key is set. It is not broken code: with no key it falls back to the
hand-written FAQ, which is deliberate (a generated answer about our own fee
would be worse than a checked one). Setting `GROQ_API_KEY` in Vercel turns on
the general-question path. Groq has a free tier and is not geo-blocked.

### Testing

- 10 new wiring checks: no permanent animations, links go through the safe
  helper, every entry named in both languages, all links https, manifest
  present with icons that exist on disk, and the WalletConnect metadata icon
  resolving to a real file. 63 checks pass.
- The first version of the animation check matched its own explanatory
  comment and failed on correct code; it now strips comments before scanning.
  A test that flags prose teaches people to ignore it.

## 1.3.0 — versionCode 9

**"Orders & plans" is now "Auto Orders"** (`سفارش خودکار`) — the old name
described a filing cabinet; the feature is an assistant that watches the market
while you don't.

### New

- **Trailing stop.** Follows the price up and sells only after it falls a set
  percentage from the best level seen. This is what people actually mean by
  "let it run but don't give the gains back" — a fixed limit either sells too
  early or never triggers.

  The dangerous parts are the ones tested hardest: the peak **only ever rises**
  (a feed hiccup must not ratchet the stop downward and quietly disable it),
  the first observation can never trigger a sale (no drawdown exists yet), and
  an unknown price neither updates the peak nor fires.

- **Pause / resume.** Previously the only way to silence an alert was to delete
  it, discarding the settings — so anyone waiting out a volatile week had to
  rebuild the order afterwards, and most wouldn't. Resuming resets a stale
  trailing peak, otherwise a week-old high would trigger an instant sell, and
  reschedules a DCA from *now* rather than firing every missed run at once.

- **Trade size and fee, shown per order.** A DCA reports the value of *all
  remaining runs* — "$600 over six weeks" is the number needed before
  committing, not "$100". Unpriced tokens show nothing rather than `$0.00`,
  because a confident wrong number about money is worse than an absent one.

- **Scheduled summary** — how many orders are live and their total value.

### Honest limitations

- Trailing stops are tracked **only while the app is open**, and the screen
  says so before you create one. A trailing peak needs per-order state the
  server would have to keep, and the free-plan cron runs once a day; a
  trailing stop checked daily would miss the entire move. Target-price orders
  are still watched server-side and reach you with the app closed.

### Fixed

- **WalletConnect metadata pointed at a dead host.** The fallback URL was
  `fbtcryp.vercel.app`, which now returns `DEPLOYMENT_NOT_FOUND`. Wallets
  *fetch* this URL to draw "who is asking to connect", and a 404 is grounds to
  reject the request outright — so an unset `VITE_PUBLIC_URL` would have broken
  every connection with no visible cause.

### Testing

- 30 new engine tests covering the ratchet, the first-tick guard, feed
  outages, pause/resume state, and fee maths. Verified non-vacuous: breaking
  the ratchet fails four unit tests and one wiring check; breaking peak
  persistence fails another.
- 10 new wiring checks: every order type must be labelled *and* creatable, the
  fee must be disclosed, the trailing limitation must be stated, and the WC
  fallback must not be the dead host. 53 checks pass.

## 1.2.5 — versionCode 8

Five device-reported bugs. Four share one root cause: **a native capability
gated behind a web-only API check**, now the seventh and eighth instance of
that class in this project.

### Fixed

- **Notifications said "not available on this device."** `notificationsSupported()`
  tested only `'Notification' in window`, which a Capacitor WebView does not
  have. `pushMode()` had already been fixed to check native first — but
  Settings calls `notificationsSupported()` **directly**, re-implementing the
  same gate one level above the fix. Fixing a helper is not enough when a
  caller repeats its logic. Native now reports supported and uses FCM.

- **The QR scanner never asked for the camera.** Two independent causes, either
  alone sufficient:
  1. `CAMERA` was missing from `AndroidManifest.xml` — an app cannot prompt for
     a permission it never declared, so the OS refuses `getUserMedia()` before
     any dialog can appear.
  2. `scannerSupported()` required `BarcodeDetector`, absent from Android's
     WebView, so it returned UNSUPPORTED before even reaching the camera call.

  `BarcodeDetector` is now an optimisation rather than a requirement, with a
  **jsQR** fallback that runs anywhere a canvas does. Frames are downscaled to
  640px before decoding — scanning a full 8 MP frame in JS stutters the preview
  badly enough to look frozen. Verified by decoding a QR produced by our own
  generator.

- **WalletConnect approved but never came back.** `metadata.redirect` was
  absent, so the wallet had no route back to us. The session really was
  established; the user was just left sitting in the wallet app while
  `wc.connect()` awaited in a backgrounded WebView that Android may freeze
  before it settles. Now declares `ir.fbt.swap://`, matching the manifest
  scheme, with an https universal link for wallets that reject custom schemes.

- **The lock screen could strand its owner.** The password fallback was gated
  on `hasVault()`. A WalletConnect-only user has no vault, so a failed
  fingerprint left *no* way in — and reinstalling, the only escape, destroys
  the encrypted seed for anyone who does have one.

- **Two-factor codes are now useful.** TOTP was set up in Settings and then
  never asked for anywhere. It is now the lock fallback when no vault exists.
  When neither is configured, the screen says so and explains that reinstalling
  is safe *because* there is no vault to lose, rather than silently trapping
  the user.

### Testing

- Nine new wiring checks covering the capability probes themselves (not just
  their callers), both Android permissions, the WC redirect matching the
  manifest scheme, and the lock's fallbacks. Verified non-vacuous by
  reintroducing all three regressions — each fails its own check. 43 pass.

## 1.2.4 — versionCode 7

Release build for Google Play.

### Build

- **A signed build now refuses to ship without a working API base.**
  `VITE_API_BASE` is inlined by Vite at build time. If it is unset — or set as
  a repository *secret* when the workflow reads `vars.*` — the bundle silently
  keeps its `/api` default. Inside the APK that resolves against
  `https://localhost`, i.e. the phone itself, so every market, push and order
  request fails on a device while working perfectly in a browser.

  The previous check printed a warning, which is invisible in a 200-line log
  on a phone. It now **fails the build**, and not by trusting the environment
  variable: it greps the built bundle for the actual origin, so a value that
  never reached Vite is caught rather than assumed. Verified in both
  directions — present when set, absent when not.

  Only enforced for signed builds. An unsigned local build against a relative
  `/api` is legitimate, because the dev server shares the origin.

## 1.2.3 — versionCode 6

### Fixed

- **Biometric unlock never locked anything.** Settings had a working toggle:
  flipping it really did read the fingerprint and really did persist
  `biometricEnabled: true`. That was the entire feature. The flag was read in
  exactly two places, both inside `Settings.jsx` — once to prompt on flip,
  once to draw the switch. **No lock screen existed anywhere in the codebase.**

  Both reported symptoms follow exactly:
  - *"it reads the finger but the screen never closes"* — that prompt was for
    **enabling** the toggle, not for unlocking. There was nothing to close.
  - *"it never asks me to log in"* — nothing asked, because nothing was built
    to ask.

  This is worse than a missing feature. The user believed the app was locked
  and behaved accordingly while it was not, which makes a security setting
  that silently does nothing an active hazard rather than a cosmetic gap.

  Adds `src/components/AppLock.jsx`, mounted **before** onboarding, the guide
  and the router — anything above it would be readable by whoever picked up
  the phone. Locks on app open only (chosen deliberately: re-locking on every
  return from background trains people to dismiss the prompt reflexively).

  Falls back to the **wallet password**, verified by actually decrypting the
  vault rather than comparing a stored hash. Without a second door, a broken
  sensor or a removed fingerprint would lock the owner out permanently, and
  reinstalling destroys the encrypted vault.

  A cancelled OS prompt is reported neutrally rather than as "authentication
  failed" — cancelling is the common case, and the rejection must never read
  as a successful unlock.

### Testing

- New wiring check: every persisted security flag must be consumed **outside**
  the screen that sets it, plus assertions that the lock is mounted, ordered
  before any content screen, has a non-biometric fallback, and does not unlock
  from a `catch`. Verified non-vacuous by unmounting the lock — two checks
  fail. 34 checks pass.

## 1.2.2 — versionCode 5

Three API routes the app calls every day did not exist on the server. All
three were verified live against the production domain, and all three returned
`{"error":"NOT_FOUND"}`.

### Fixed

- **`GET /api/search`** — `fetchSearch` was imported in `server/app.js` and
  never routed. Coin search silently fell through to the public CoinGecko
  endpoint, which is rate-limited per user IP, so search bypassed our cache
  and spent the user's own quota instead of ours.
- **`GET /api/news`** — same shape: `fetchNews` imported, no route. Every
  device fetched public RSS directly, which is precisely the per-user fan-out
  that aggregating on the server exists to prevent (one upstream request a day
  for everyone, not one per user per open).
- **`GET /api/push/status`** — never written at all, though `src/lib/notify.js`
  has always called it. The 404 read back as `undefined`, so **every web user
  was pinned to device-only notifications** even with push fully configured.
  This is a second, independent cause of "notifications don't work", separate
  from the Android WebView gating fixed in 1.2.1 — that one was native-only,
  this one was web-only, and each hid the other.

  The route reports the **web** channel only. Native Android short-circuits to
  server mode before ever calling it, so answering with `web || fcm` would
  tell a browser the server can reach it over a channel a browser cannot
  receive on.

Why none of this showed up as an error: the client degrades instead of
failing. Search still returned results, news still filled the page,
notifications still appeared to be "on". The app just quietly ran slower,
rate-limited, and undeliverable, with nothing in any log to say so.

### Testing

- New wiring check: every `${API_BASE}/...` template in `src/` must resolve to
  a real route in `server/app.js`, plus the mirror check for a handler that is
  imported but never mounted — the exact shape this bug takes in a diff.
  Verified non-vacuous by renaming a route and confirming the check fails.
  This is the sixth time this bug class has shipped (push subscribe/unsubscribe,
  leaderboard, OTC send, swap prefill, order watch, and now these three), so it
  is now enforced rather than remembered. 25 wiring checks pass.

## 1.2.0 — versionCode 3

The theme of this release is that several features looked finished and were
not. Each item below names the failure, because "improved notifications" would
hide the part worth knowing.

### New

- **Limit orders and DCA plans** (`/orders`). Set a target price, or buy a
  fixed amount on a schedule. Alerts arrive with the app closed; the swap is
  one tap from the notification, pre-filled.
  These are alerts, not automatic fills. The server holds no key and never
  will, so nothing can sign for a user — the screen says so before an order is
  created, because a limit order that silently does not fill is worse than no
  feature at all.
- **Receive** with a QR code, so the in-app wallet can be funded. Uses a tested
  encoder: a subtly wrong QR still scans, it just decodes to a different
  address, and the funds are gone. The generated code is verified against our
  own scanner's parser in the test suite.
- **NFT viewer** — read-only, over five networks. Every string is
  attacker-supplied (anyone can mint into any wallet), so markup, control
  characters and Unicode bidi overrides are stripped server-side, and images
  must be https.
- **Explorer** (`/explore`) — identifies what you pasted and opens the right
  chain's explorer. Deliberately not a real indexer: one that misses a
  transaction convinces a user their money vanished, and the usual reaction is
  to send again.
- **Discover** (`/discover`) — curated sites opened in the system browser via
  Custom Tabs, with no address bar. Free typing inside a wallet is a phishing
  delivery mechanism, and an embedded WebView is a window we draw, so we would
  be the ones vouching for a site's identity.
- **Ask** in Help now answers general crypto questions too, with web search,
  while staying locked to our own documentation for anything about this app.

### Fixed

- **Order alerts never worked in the Android app.** A Capacitor WebView has no
  Push API, so registration returned UNSUPPORTED and exited. The toggle
  appeared to succeed and no APK user ever registered anything. Now routed over
  FCM. Requires `android/app/google-services.json`.
- **The swap screen claimed "this app takes no fee"** twenty lines above a line
  reading "Platform fee 0.5%". A user who catches the app being wrong about its
  own fee has no reason to trust the irreversibility warnings either.
- **"Buy when it rises" was unusable.** The rate is always `1 FROM = ? TO`, so
  buying BNB above 700 meant entering `0.00142857` and picking *below*. The
  obvious attempt set the exact opposite. Targets can now be priced in either
  token.
- **P2P crashed on open** — `chain.tokens[0]`, but the token lists live in a
  separate map. The page was not in the smoke tests; eight more screens are now.
- **The leaderboard could never load.** `readLeaderboard` was imported but no
  route was ever mounted, so the client reported a network failure for an
  endpoint that did not exist. Push had the same bug.
- **Nested modals froze scrolling permanently.** The scroll lock restored a
  saved value, so out-of-order release left `overflow: hidden` forever.
  Reference-counted now.
- **A button showed the literal text `common.close`** after a successful
  transfer.

### Performance

- Entry chunk **528 KB → 168 KB**. All twelve locales were static imports, so a
  Persian user downloaded eleven languages before the first frame could paint.
- Removed a full-page `filter: blur()` on every navigation and eleven stacked
  `backdrop-filter`s per screen. Neither is a compositor property, so both
  forced a full repaint each frame.
- Fixed scrolling: `height: 100%` pinned the document to one viewport, so long
  pages were unreachable below the fold.

### Store & compliance

- targetSdk 35, `POST_NOTIFICATIONS`, AAB output.
- Arcade code is compiled out of the store build, verified by asserting on the
  emitted files rather than trusting a flag.
- Play listing copy, icon and feature graphic in `store/`.

### Revenue

- The platform fee is now configurable via `VITE_FEE_BPS`, capped at 1%.
  Measured peer fees: MetaMask 0.875%, Phantom 0.85%, Trust Wallet 0.70%. At
  0.50% we are below market; `VITE_FEE_BPS=70` is +40% on identical volume.
- Documented why Hyperliquid builder codes and an NFT revenue share are not
  viable for an Iranian company, with the arithmetic, rather than leaving them
  on a wishlist.

---

## 1.1.1 and earlier

See the GitHub releases page.
