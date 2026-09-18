# Wallet Session Lease + Balance Stability + Connect-Popup Restyle — 2026-09-18

Three reports, one branch. Requested with «کارهای مهم با بهترین هوش خود انجام بده».

## Bugs Reported (Persian)

1. **«پس از رفرش کیف پول متصل دیسکانکت می‌شه»** — refresh the page and the connected
   wallet is gone. It must stay connected for the duration configured in Settings
   (the example given: 60 minutes) and must not disconnect on a refresh.
2. **«هر چند ثانیه یکبار عدد موجودی کیف پول به سه نقطه تبدیل می‌شود»** — every few
   seconds the balance number turns into three dots. It must stay on the current
   number and only show the new number when the update actually arrives.
3. **«در ظاهر پاپ‌آپ برای وصل شدن کیف پول باید ایکون‌ها و باکس مدرن‌تر شود»** — the
   connect popup needs modern icons and a modern box, correct in dark **and** light
   theme, with correct spacing and correct language.

## Root Causes

### 1. Nothing remembered the connection (`src/lib/wc/lease.js`, new)

Two holes, one symptom:

- `connectInjected()` attached a provider to React state and wrote **nothing** to
  storage. The injected wallet — MetaMask on desktop, Trust's dApp browser on
  mobile — was therefore connected *for the lifetime of the document*. A reload is
  a new document, so the wallet was simply not there any more, and no record said
  it ever had been.
- `restoreWcSession()` ran **once**, opportunistically: a single relay init that
  could lose an 8-second race on a phone still loading its own JS chunks, and no
  retry behind it. The `wc@2:` session stayed on disk while the app showed
  «وصل نیست».

A third case had no path at all: a **local vault** unlocked before the reload was
re-attached synchronously, but nothing carried the fact that the user expects a
wallet to be there.

### 2. The portfolio total really did move — and the UI paid for it

`useMultiChainPortfolio()` re-runs its whole multi-chain read whenever `priceMap`
moves, i.e. on every 30-second market tick (`useMarkets(250)`), and its aggregate
`loading` flag is true for the whole of every cycle. The wallet hero rendered its
placeholder while `portfolio.loading && portfolio.totalValue === 0` — so any chain
whose RPC happened to time out zeroed its contribution, the total dipped, and the
number the user was reading was replaced by `…`. On a slower connection the retry
seconds later brought it back: the reported flicker.

### 3. The popup was built from inline literals

The connect sheet mixed `rgba(255,255,255,.04)` and `rgba(0,0,0,.4)` inline styles,
which are invisible-as-a-group and muddy-as-a-chip on a light page, a single flat
list of six identically-shaped rows, and a generic link glyph stacked underneath
each wallet's real logo.

## The Fixes

### The session lease (`src/lib/wc/lease.js`)

One small localStorage record — no key, no signature, no secret:

```js
{ v: 1, mode: 'injected'|'wc'|'local', address, chainId, rdns, minutes, issuedAt, expiresAt }
```

- **Granted** by every attach path (`connectInjected`, `attachExternal` for
  WalletConnect, `attachLocal`, `attachCreatedLocal`, `unlockLocal`).
- **Rolled forward** while the app is open and connected (30 s tick, soft refresh,
  visibility resume, and when the user changes the setting) — a connection in use
  must not lapse under the user's hands. One write a minute, not one a second.
- **Dropped first** in `disconnect()`, before any SDK teardown, so «قطع اتصال»
  means it on the next document too.
- `walletRestorePlan({ lease, hasVault, hasStoredSession })` turns the cold start
  into data, unit-testable without a browser: `local` | `wc` | `injected` | `none`,
  plus `adopt` (an install from before this feature) and `expired` (purge the
  stored session so the next Connect is a clean first attempt).
- `scheduleWalletRestore()` retries on a bounded ladder
  `[1.5s, 4s, 10s, 25s, 60s]`, skipping hidden documents, restarting on the next
  visibility change or a tap on «تلاش دوباره».
- The injected path re-attaches **silently**: `eth_accounts` only, never
  `eth_requestAccounts`. A live `wc` lease with no `wc@2:` session behind it fails
  fast and says so instead of spending a hundred seconds pretending to reconnect.
- `walletSessionMinutes` in Settings → Security (15 / 30 / 60 / 180 / ∞), default
  60, `0` = «تا قطع دستی». The hub tile carries the current value.

Every ending is explained on the sheet: a lapsed window
(`wallet.sessionLapsed`) and a session gone from the device (`wallet.sessionGone`).
An unexplained return to «not connected» *is* the reported bug.

### The balance that stays put

- `useMultiChainPortfolio()` keeps the last good read per chain (`goodRef`); a
  failed chain reports `stale: true` with its previous rows instead of zeros, so
  the total never dips because an RPC blinked. The coverage badge is not allowed
  to call stale rows fresh (`partial`, `staleChains`).
- It exposes `loaded` — "has a cycle ever completed" — which is the *only* state
  in which the hero shows a placeholder, and that placeholder is now a shimmer
  skeleton rather than a bare ellipsis.
- Once a number is on screen it stays through every refresh; a quiet
  «در حال به‌روزرسانی…» cue sits beside it, and `AnimatedNumber` tweens to the new
  figure when one arrives.
- The refresh control is an icon + label with a spinner, not a `…` where a word
  belongs.

### The popup (`src/styles/wallet-connect.css`, new)

- Grouped sections («کیف پول خودت» / «کیف پول درون‌برنامه‌ای»), one wallet per row,
  an icon tile per row (the wallet's own EIP-6963 icon when it announces one, the
  wallet's real brand logo from the same Explorer CDN AppKit reads in the pairing
  view).
- Every colour is a token and every horizontal offset is **logical**
  (`padding-inline`, `inset-inline`, `text-align: start`), which is what makes the
  same markup correct in Persian; the chevron flips under `[dir='rtl']`.
- Light theme is handled explicitly: card surfaces, the header mark's gradient
  (white on neon cyan is a 1.2:1 pair), and the pill inks are restated against ink
  instead of against black.
- The seed grid and the phrase box lost their literal `rgba()` styles — twelve
  words the user was told to write down must be legible in both themes.
- Reduce-motion is respected (`data-reduce-motion='true'`).

## Files

| File | What |
|------|------|
| `src/lib/wc/lease.js` | **new** — the record, the restore plan, the retry clock, the choices |
| `src/lib/wc/index.js` | re-exports the lease surface |
| `src/context/WalletContext.jsx` | grant/roll/drop on every path, cold start, ladder, lapse handling, `restoring`/`lease`/`leaseMinutesLeft`/`reconnectWallet` |
| `src/hooks/useMultiChainPortfolio.js` | `loaded`, per-chain last-good reads, `staleChains` |
| `src/pages/Wallet.jsx` | skeleton only before the first read, revaluation cue, refresh button, lease chip, reconnecting hero |
| `src/pages/Settings.jsx` | «مدت اتصال کیف پول» picker + hub chip |
| `src/store/useSettingsStore.js` | `walletSessionMinutes` (default 60, sync + remote allowlists) |
| `src/components/WalletConnectSheet.jsx` | grouped rows, icon tiles, resume banner, explained endings |
| `src/styles/wallet-connect.css` | **new** — the popup's own stylesheet, dark + light + RTL |
| `src/index.css` | wallet skeleton / revaluation / spinner / lease / reconnect styles |
| `src/i18n/locales/{en,fa,ar}.json` | the new sentences, in the three complete locales |
| `test/walletconnect-stack-probe.mjs` | lease suite + retargeted wiring guards |
| `test/wallet-connect-sheet-probe.jsx` | structural assertions for the restyle |
| `test/wallet-session-lease.test.jsx` | **new** — mounts the real `WalletProvider` twice, as a reload does |

## Verification

```
node test/walletconnect-stack-probe.mjs         → All 251 wallet-connect checks passed
npx vitest run test/wallet-session-lease.test.jsx
                                                → passed 5/5  (the real provider, a real reload)
npx vite build -c test/vite.wcsheet.mjs && \
  node test/run-one-probe.mjs ./.out/wcsheet/wallet-connect-sheet-probe.js
                                                → passed 17/17
npm run test:wallet-connection                  → 251 + 6 vitest
npm run test:iran-buy                           → passed 33/33 (uses the sheet)
npm run test:settings-hub                       → passed 60/60
npm run build                                   → ✓ built
```
