# Four Wallet Reports, One Branch — 2026-09-19

Requested with «با دقت انجام بده و بیار رو برنچ اصلی». Every fix below is a
change in `src/`, every change is covered by a test that runs offline, and the
whole stack probe (`node test/walletconnect-stack-probe.mjs`) is at **309
checks, 0 failures**.

| # | report (as written) | where it lives now |
|---|---|---|
| 1 | connect approves twice; Back lands on `trust://wc?uri=…` instead of the app | `src/lib/wc/handoff.js`, `src/components/WalletConnectSheet.jsx` |
| 2 | signing opens the wallet but no signature screen comes; the app says «شبکه در دسترس نیست» | `src/lib/wc/signing.js`, `src/context/WalletContext.jsx`, `src/lib/defi/farmErrors.js` |
| 3 | the wallet page's network row must be a modern dropdown with a logo per network, in both themes | `src/components/NetworkSelect.jsx`, `src/styles/network-select.css`, `src/lib/assetIconData.js` |
| 4 | balances take too long; a refresh loses the connection that should last 60 minutes | `src/hooks/useMultiChainPortfolio.js`, `src/lib/portfolioSnapshot.js`, `src/context/WalletContext.jsx`, `src/lib/wc/session.js` |

---

## 1. «اولین تأیید وصل نمی‌کند» — the double approval and the dead tab

### What was reported

> وقتی می‌زنی روی تراست والت وارد اپ تراست والت می‌شه و وقتی اپرو کردی و برگشتی،
> به جای اپ ما … وارد لینک `trust://wc?uri=…` می‌شه و پس از تأیید دوباره حالا پس
> از برگشت وارد اپ ما می‌شه.

### Root cause

The hand-off opened the deep link in a **new tab** (`window.open(url,
'_blank')`) on every platform, and cleaned that tab up only on Android, only
for the plain-scheme route, and only on a 2.5 s timer. Everything the user
described follows from that one decision:

* Chrome launches the wallet **and leaves the new tab behind**, sitting on
  `trust://wc?uri=…` — a URL it cannot render. Back out of the wallet and that
  is the tab the phone returns to. That tab *is* the «سایت خود والت» with a
  «Continue» on it.
* Meanwhile the real dApp tab — the one holding the relay socket and the
  pending `connect()` promise — has gone to the background, where a phone is
  free to throttle, freeze or discard it. An approval published in that window
  can land on a document that no longer exists.
* The only way forward the user could find was the wallet's own «Continue»,
  which opens the pairing **again**: second approval, and this time the dApp is
  in front, so it lands.

### The fix

**Android Chromium now hands the pairing to the wallet in place.** An
`intent://` URL is resolved *by the browser*: when the wallet is installed the
navigation never commits — the app launches and fbtswap.ir stays exactly where
the user left it, socket and promise intact. When the wallet is **not**
installed the navigation does commit, and it commits to
`S.browser_fallback_url`, which is the install page — the one screen that
helps. Either ending is a correct one, and neither leaves a tab behind.

The route table carries that decision as data (`mode: 'place'` vs
`'popup'`), and the in-place route is offered **only** where the browser is
provably capable of it (`isIntentCapableBrowser()`): Firefox on Android and
embedded WebViews still get a tab, never an in-place navigation to a scheme
they cannot route (asserted in the probe).

**Every tab a hand-off opens is remembered and swept.** `closeHandoffTabs()`
closes them (a) shortly after the open, (b) when this document becomes visible
again — the moment the user comes back, which is exactly when they must not
see the tab we forgot — and (c) on demand.

**The sheet now offers the way back.** While a pairing is pending, the waiting
card carries a «باز کردن دوبارهٔ Trust Wallet» button that re-fires **the same
pairing URI** — no new pairing, no second approval from scratch — and it knows
when the user has returned (`visibilitychange`), so the hint changes to «به
برنامه برگشتی…». The dot pulses rather than spins: what is happening is that we
are waiting for the user, not that the app is working.

---

## 2. «هیج صفحه امضایی نیامد» — the signature the wallet never received

### What was reported

> برای امضای کردن … گاهی ارور «شبکه ضعیفه / اتصالی وجود ندارد» می‌ده و نمی‌آره.
> مثلاً خواستیم سپرده‌گذاری کنیم، وارد تراست والت شد اما هیچ صفحه امضایی نیامد،
> فقط زد شبکه ضعیف است.

### Root cause

Two different failures arrived as one sentence about the internet:

1. **The request was never deliverable.** A WalletConnect session is a
   contract: it names the methods the wallet agreed to answer and the
   `eip155:<chainId>:<address>` accounts it agreed to answer them for. A
   deposit on Base against a session whose only account is on BSC is not a
   request the wallet can show — it is a request the wallet **drops**. No
   prompt, no error, nothing on screen.
2. **The request was published into a dead socket.** A phone that slept, a tab
   Chrome froze and thawed, a relay that dropped while the user was reading:
   `request()` resolves never, and the bound that eventually fires was
   classified as a network failure.

And the wallet app was never brought back to the front: the request was
published to the relay, and the user was left standing in the browser with no
idea anything was waiting for them.

### The fix — `src/lib/wc/signing.js`

One EIP-1193 wrapper, installed where every transport is adapted
(`attachExternal`), so the farm panels, the send sheet, the insurance flow and
Intent AI's execution path are all covered by one boundary:

* **Preflight.** Before a signing request leaves the page the session is asked
  whether it can carry it (method, chain, account) and whether the relay
  socket is open. Unknown namespaces **fail open** — a guard that refuses a
  signature because it could not read a record is worse than the bug it was
  written for.
* **Two automatic fixes, tried once each before the user is told anything.**
  A closed relay is re-opened (`transportOpen()`, bounded). A chain the
  session approves but has no account for is switched to
  (`wallet_switchEthereumChain`) — and the wallet's own answer outranks a
  session record that has not been re-derived yet, so the deposit the user
  asked for is actually sent.
* **A bound that measures the user.** The clock pauses while this document is
  hidden, because a signature is a human wait.
* **The nudge.** Once the request is published, the wallet the session belongs
  to is brought back to the front (`bringWalletToFront`) — no pairing payload
  this time, because the session already exists. Phone browsers only, a known
  wallet only, once per burst.
* **Honest codes.** `WALLET_NO_RESPONSE`, `WALLET_CHAIN_UNAPPROVED`,
  `WALLET_SESSION_GONE`, `WALLET_RELAY_DOWN`, `WALLET_METHOD_UNAPPROVED` — each
  mapped through `farmErrors.js` to a translated sentence (fa + en, English
  fallback elsewhere). «شبکه در دسترس نیست» is no longer the answer to a
  question about the wallet session.

---

## 3. The network picker

The hero used to draw sixteen chips — a 7px dot and a three-letter code each
(SCR, HOOD, LINEA…), four ragged lines deep on a phone — with «همه شبکه‌ها» as
a button that did nothing at all.

`NetworkSelect` replaces it with one 52px control: the selected network's real
logo, its full name, and a chevron; behind it a searchable listbox where
«همه شبکه‌ها» is pinned first and each row carries its artwork, the count of
assets the portfolio found there, its own figure, and a badge on the chain the
**wallet** is on (which is not the same thing as the chain being viewed).

* Icons are vendored SVG (`src/lib/assetIconData.js`) — no CDN, so it looks
  the same on a phone that cannot reach one. Three marks were missing and are
  drawn here: **Scroll**, **zkSync Era** and **Robinhood Chain**, so all
  sixteen networks have a face.
* Keyboard: ↑/↓ move, Home/End jump, Enter/Space choose, Escape closes and
  returns focus. A real listbox, with `aria-activedescendant` tracking the
  highlighted row.
* Escape and an outside pointer close **without** selecting.
* Both themes: one rule set built on the app's tokens, with explicit
  `:root[data-theme='light']` counterparts wherever a translucent white over a
  light page stops being legible.
* A view filter is not a network switch: choosing a network filters the
  portfolio, and a separate «تغییر کیف پول به …» tap moves the wallet — only
  shown while the two differ.

---

## 4. Slow balances, and a connection that must survive a refresh

### 4a. «موجودی را بخاد نمایش بده خیلی طول میکشه»

Two jobs were sharing one cycle. **Balances** are a network round trip per
chain (sixteen of them, sequential — concurrency 1 — with a `balanceOf` per
token). **Prices** are a multiplication. The market list refreshed every 30 s
and *re-read all sixteen chains with it*.

They are separate now:

* the chains are read in **parallel** (a pool of 4 — not sixteen, which would
  hammer the public RPCs and queue behind a phone's six-connections-per-origin
  ceiling anyway);
* each chain is **committed the moment it lands**, so a user holding assets on
  BSC does not wait behind Scroll, zkSync and Robinhood;
* **prices are applied at render time** from the live market map, so a market
  tick re-prices what is on screen and triggers **zero** RPC calls. That alone
  removed a full sixteen-chain read every 30 seconds from every open wallet
  page;
* the last verified read for an address is kept on the device
  (`src/lib/portfolioSnapshot.js`) and restored before the first request goes
  out, so the first paint after a reload shows the user's numbers immediately,
  tagged «آخرین مقدار ذخیره‌شده», and fills in the truth chain by chain.

A failed chain still keeps its last good read (`stale`), never zeros — an RPC
that blinked is not the user's balance going to nothing.

### 4b. «وقتی صفحه رفرش می‌شه اتصال از دست میره»

The lease (`src/lib/wc/lease.js`) was already doing its job: the connection is
written down, rolled while the app is in use, and read by the cold start. What
was missing was what the user was **told** while that happened:

* `restoring` was cleared on every exit path — including between two rungs of
  the retry ladder. A phone whose relay handshake loses the race therefore
  showed «در حال اتصال مجدد…», then «وصل نیست», while the app was in fact
  still trying and would try again sixty seconds later. A user who refreshed
  and waited a minute concluded the connection had been dropped.
  `settleRestoring()` fixes this: while a live lease exists and nothing is
  attached, the app owes the user a wallet and says so; the ladder is
  background work and no longer blinks on screen. Only a **terminal** fact
  takes the sentence down — the window the user chose lapsed, or the session is
  gone from this device — and both are explained by name.
* The cold start sets `restoring` in the **first frame**, before the first
  resume call, so a returning user never sees «وصل نیست» at all.
* A silent restore no longer blocks on `measureRelay()` — up to eight seconds
  of socket handshakes before `init()` was even allowed to start, spent on an
  ordering hint that `initProvider()`'s own host failover makes unnecessary.

---

## Verification

```
node test/walletconnect-stack-probe.mjs     # 309/309 (was 251)
npm run test:wallet-connection              # + test/network-select.test.jsx (15)
npx vite build                              # clean
```

Newly locked behaviour:

* Android Chromium navigates to the intent **in place** and opens no tab; a
  browser without `intent://` and a WebView are never navigated in place, and
  neither is an intent with no fallback URL (Chrome would commit to its own
  error page and take the dApp with it);
* the intent carries the package, the pairing payload and a fallback URL;
* every way a signature can be undeliverable is named for what it is, and a
  user rejection is left to the caller;
* an undeliverable request is never published; a closed relay is re-opened; an
  approved chain with no account for it is switched to, and a declined switch
  leaves the request refused;
* an unanswered signature ends, named, instead of hanging;
* the wallet is nudged once per published request and never for a plain read;
* the portfolio snapshot is scoped to one address, slimmer than the live read,
  refuses to be shown once it is a week old, and survives a blocked storage;
* the picker lists all sixteen networks plus «همه شبکه‌ها», gives each one
  offline artwork, answers a keyboard, and closes on Escape / outside pointer
  without selecting.

## Manual checks worth doing on a phone

- [ ] Connect → Trust Wallet → approve once → Back lands in fbtswap.ir, connected.
- [ ] Connect → approve → Back lands on the waiting card → «باز کردن دوباره» reopens
      the **same** request; no second pairing is created.
- [ ] Vault deposit on a network the wallet is not on: the wallet is switched, then
      the signature screen appears.
- [ ] Kill the relay mid-session (airplane mode, back): the failure names the wallet
      session, not the internet.
- [ ] Refresh the wallet page: the numbers are on screen immediately, the session
      re-attaches silently, and the sentence on screen is never «وصل نیست».
- [ ] Wallet page → network dropdown in dark and in light theme.
