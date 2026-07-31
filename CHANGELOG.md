# Changelog

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
