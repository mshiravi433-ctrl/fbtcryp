# Changelog

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
