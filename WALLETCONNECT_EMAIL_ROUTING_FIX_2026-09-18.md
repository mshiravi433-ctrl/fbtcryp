# Email/Social Routing Fix — fbtswap.ir (2026-09-18)

## Bug Reported (Persian)
- When you press the email/social option, nothing connects.
- Sometimes it does connect, but then only the WalletConnect wallet popup (the
  wallet list) appears, and it never attaches to our app.
- The WalletConnect wallet connection itself works correctly and must not be
  touched.

## Reproduction (deterministic, no device needed)
`node test/email-routing-probe.mjs` — jsdom (Android UA) + the REAL shipped
singletons (`@reown/appkit@1.8.19` + `@reown/appkit-controllers`), fetch
stubbed to the dashboard-withheld shape:

| step | what happens | shared flags after |
|---|---|---|
| 1. cold start, tap **Email** | opens `Connect` → email form | `noAdapters=false` |
| 2. tap **WalletConnect** | its AppKit boots via `@reown/appkit/core` with **zero adapters** | `noAdapters=true`, `manualWCControl=true`, `enableWallets=true` |
| 3. tap **Email** (pre-fix) | re-assert clears the Options flags, but **nobody resets `noAdapters`** | `noAdapters=true` |
| 4. modal opens | `ModalController.open()` routes to the **wallet grid** (mobile: `AllWallets`, desktop: `ConnectingWalletConnectBasic`) instead of `Connect` | — |

The grid is dead on the email surface: its rows need a `wcUri` that only a
WalletConnect pairing creates, and the email AppKit instance pairs nothing —
hence «the WalletConnect popup appears and nothing connects».

## Root Cause
`@walletconnect/ethereum-provider` creates the WalletConnect modal's AppKit
instance with no adapters. Its `initialize()`:

1. `initControllers()` → `ChainController.initialize([])` sets
   `ChainController.state.noAdapters = true`. **The SDK has no code that ever
   sets it back to false** — a later adapter-bearing `initialize()` only ever
   sets it true. (The only other write is the adapter-listener
   `setNoAdapters(adapters.length === 0)` — for an adapter-less instance no
   adapter listeners exist at all.)
2. `initializeUniversalAdapter()` → `OptionsController.setManualWCControl(true)`.

And `ModalController.open({ view })` (scaffold-ui, `ModalController.open`)
reads those flags **before** the requested view:

```js
if (ConnectorController.isConnected())           → 'Account'
else if (manualWCControl || (noAdapters && !caipAddress))
                                             → 'AllWallets' / 'ConnectingWalletConnectBasic'
else                                            → the requested view ('Connect')
```

Why it is intermittent («sometimes it connects»): the app's email boot is
`fresh` only when its boot marker is **absent** — the fresh path runs the full
shared reset (storage purge + `resetSharedConnectionState()`, which does clear
`noAdapters`). A standing marker (a login was attempted, so a frame session is
owed) is exactly the state where the full reset is skipped *on purpose* —
correct for storage, wrong for the in-memory routing flags. So:

- email tap **without** prior WalletConnect use (or with a fresh marker) →
  fresh path → reset → works;
- email tap **after** WalletConnect use with a standing marker →
  `fresh=false` → no reset → `noAdapters` latched → wallet grid → «nothing
  connects».

## Fix
`assertEmailRouting()` in `src/lib/wc/appkit.js` — the email surface's claim
on the routing flags, **in-memory only, never storage**:

- `ChainController.state.noAdapters` → `false` (if latched)
- `OptionsController.state.manualWCControl` → `false` (if claimed)
- `OptionsController.state.enableWallets` → `false` (if left on)
- returns `'fixed' | 'clean' | 'unavailable'` (never a boolean that hides
  which one); traced as `email_routing_fixed` / `email_routing_unavailable`.

Called in `src/lib/wc/embedded.js`:

1. `getAppKit()` — **unconditionally, on every path** (fresh or not), before
   any other decision. This is what separates the storage policy (untouched:
   the fresh block still purges only when the marker is absent) from the
   routing flags (always ours on this surface).
2. `open()` — again immediately before `modal.open({ view: 'Connect' })`,
   because a WalletConnect init that outran its bound keeps running in the
   background (the ghost handler only disconnects the result) and its
   `initialize()` writes the flags when it settles — possibly between
   `getAppKit` and `open`.

Why it is safe:

- The flags describe *the last instance that initialised*, not a session.
  This surface always carries the ethers adapter, so `noAdapters: false` is
  the truth for it.
- **The WalletConnect path is untouched**: its open routing keys on
  `manualWCControl: true` (re-asserted by `applyWalletSurface` before each WC
  open), and the *next* WC `initialize([])` sets `noAdapters` back to true for
  itself — the probe locks both directions (`the next WC surface re-sets its
  own flags`).
- It touches no address, no connection list, no storage key: a live frame
  session the marker describes is left exactly as it is.
- Best-effort: a controllers chunk that cannot load returns
  `'unavailable'` and the flow continues (`reassertFeatures` still re-asserts
  the Options half through the instance).

## Verification
- `node test/email-routing-probe.mjs` — 17/17, 3 consecutive runs. Locks the
  SDK contract the fix relies on (the latch, the hijack) **and** the fix
  (flags released, `Connect` restored, nothing else touched, WC re-sets its
  own flags).
- `node test/walletconnect-stack-probe.mjs` — 268/268 (incl. new §15b: the
  assertion clears exactly the three flags, leaves a live address / owed
  connection / storage key untouched, idempotent, wired into `getAppKit` and
  `open`).
- `npx vitest run test/wallet-health-panel.test.jsx` — 4/4.
- connect-sheet mount probe — 8/8.
- `npm run build` — clean.

## Files
- `src/lib/wc/appkit.js` — `assertEmailRouting()` (new).
- `src/lib/wc/embedded.js` — calls it in `getAppKit()` and `open()`.
- `src/lib/wc/index.js` — exports it.
- `test/email-routing-probe.mjs` — end-to-end regression probe (new).
- `test/walletconnect-stack-probe.mjs` — §15b + import.
- `test/run.mjs` — runner wiring (section 0b₂).
