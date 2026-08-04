# Changelog

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
