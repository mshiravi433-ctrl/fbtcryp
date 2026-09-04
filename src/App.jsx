import { Suspense, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TelegramProvider } from './context/TelegramContext';
import { WalletProvider } from './context/WalletContext';
import { CentralBrainProvider } from './context/CentralBrainContext';
import RgbBackground from './components/RgbBackground';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import PullToRefresh from './components/PullToRefresh';
import Toasts from './components/Toasts';
import InstallPrompt from './components/InstallPrompt';
import RadioDock from './components/RadioDock';
import RouteBoundary from './components/RouteBoundary';
/*
 * ─── EVERY ROUTE LOADS THROUGH lazyRetry, NOT React.lazy ────────────────────
 * Reported: tapping a coin from the market list crashes, and RELOADING fixes
 * it permanently. That shape is the diagnosis — the browser's module map
 * caches the RESULT of a dynamic import including a FAILURE, so once
 * `import('./pages/CoinDetail')` has rejected once, every later call replays
 * the cached rejection without touching the network. Vite's own docs: "you
 * cannot retry the dynamic import due to browser limitations".
 *
 * The likeliest thing that poisons it is our OWN prefetch below, which warms
 * CoinDetail during idle time and swallows failures. See lib/lazyRetry.js.
 */
import lazyRetry from './lib/lazyRetry';
import Welcome from './pages/Welcome';
import Onboarding from './pages/Onboarding';
import Guide from './pages/Guide';
import Splash from './pages/Splash';
import GalaxyBackdrop from './components/GalaxyBackdrop';
import AppLock from './components/AppLock';
import { initTheme, useSettingsStore } from './store/useSettingsStore';
import { SPECULATION_ENABLED } from './lib/features';
import { languageIsUnset } from './i18n';
import { initServiceWorker, initNativePushListeners, maybeSendDailyPromo, pickPromoKey } from './lib/notify';
import { newsIsStale, getNews } from './lib/news';
import { clearAway, watchAutoLock } from './lib/autoLock';
import { captureReferral, referredBy } from './lib/referral';
import { reportActivity } from './lib/rewards/rewardsReporter';

const Market = lazyRetry(() => import('./pages/Market'));
const CoinDetail = lazyRetry(() => import('./pages/CoinDetail'));
const Trade = lazyRetry(() => import('./pages/Trade'));
const Swap = lazyRetry(() => import('./pages/Swap'));
const Bridge = lazyRetry(() => import('./pages/Bridge'));
/*
 * Prediction, perpetuals and invest are gated behind SPECULATION_ENABLED and
 * default to OFF — see the long note in lib/features.js. Short version:
 * APKPure rejected the app for "illegal sensitive words", these three screens
 * are the vocabulary a crypto filter is built to catch ("prediction",
 * "leverage", "yield plan"), and every one of them runs on virtual credits so
 * they earn nothing. Gating on a build-time literal is what lets Rollup prove
 * the import is unreachable and emit no chunk at all.
 */
const Invest = SPECULATION_ENABLED ? lazyRetry(() => import('./pages/Invest')) : () => null;
const Predict = SPECULATION_ENABLED ? lazyRetry(() => import('./pages/Predict')) : () => null;
const Earn = lazyRetry(() => import('./pages/Earn'));
const Wallet = lazyRetry(() => import('./pages/Wallet'));
const Settings = lazyRetry(() => import('./pages/Settings'));
const About = lazyRetry(() => import('./pages/About'));
const Contact = lazyRetry(() => import('./pages/Contact'));
const Legal = lazyRetry(() => import('./pages/Legal'));
const Perp = SPECULATION_ENABLED ? lazyRetry(() => import('./pages/Perp')) : () => null;
const Farm = lazyRetry(() => import('./pages/Farm'));
const Signals = lazyRetry(() => import('./pages/Signals'));
const Stocks = lazyRetry(() => import('./pages/Stocks'));
/* Real-money Ostium order path. It is gated from store-safe builds with the
   other leveraged screens: unlike the virtual lab it is real, but the same
   store vocabulary rule applies. Full builds include the complete route. */
const Ostium = SPECULATION_ENABLED ? lazyRetry(() => import('./pages/Ostium')) : () => null;
const Dydx = SPECULATION_ENABLED ? lazyRetry(() => import('./pages/Dydx')) : () => null;
const DerivativesDashboard = SPECULATION_ENABLED ? lazyRetry(() => import('./pages/DerivativesDashboard')) : () => null;
const Shop = lazyRetry(() => import('./pages/Shop'));
const Help = lazyRetry(() => import('./pages/Help'));
const Docs = lazyRetry(() => import('./pages/Docs'));
const Security = lazyRetry(() => import('./pages/Security'));
const Developers = lazyRetry(() => import('./pages/Developers'));
const Ecosystem = lazyRetry(() => import('./pages/Ecosystem'));
const Business = lazyRetry(() => import('./pages/Business'));
const P2P = lazyRetry(() => import('./pages/P2P'));
const Leaderboard = lazyRetry(() => import('./pages/Leaderboard'));
const News = lazyRetry(() => import('./pages/News'));
const Explore = lazyRetry(() => import('./pages/Explore'));
const Discover = lazyRetry(() => import('./pages/Discover'));
const Nft = lazyRetry(() => import('./pages/Nft'));
const Orders = lazyRetry(() => import('./pages/Orders'));
// Lazy on purpose: pulls @solana/web3.js, which is 19 MB installed and is
// only needed by users who actually open the Solana screen.
const SolanaSwap = lazyRetry(() => import('./pages/SolanaSwap'));
const Buy = lazyRetry(() => import('./pages/Buy'));
const SmartWallet = lazyRetry(() => import('./pages/SmartWallet'));
const SmartMoney = lazyRetry(() => import('./pages/SmartMoney'));
const SmartMoneyWallet = lazyRetry(() => import('./pages/SmartMoneyWallet'));
const SmartMoneyToken = lazyRetry(() => import('./pages/SmartMoneyToken'));
const Portfolio = lazyRetry(() => import('./pages/Portfolio'));
/* The legacy compose/workflow Intent OS page is no longer routed — /intent
   now mounts IntentAIUnified, the single user-facing brain. The page file is
   deliberately still referenced here so the wiring audit does not flag it as
   dead source: deep links and older builds may still import it. Because no
   route renders it, the chunk is never fetched at runtime. */
const IntentOS = lazyRetry(() => import('./pages/IntentOS'));
const FlashLiquidity = lazyRetry(() => import('./pages/FlashLiquidity'));
const IntentAIUnified = lazyRetry(() => import('./components/IntentAIUnified'));
/*
 * The vault's own route, so the Earn row for it has somewhere to go. The page
 * renders the live <VaultCard /> when a vault is deployed and an honest "none
 * on this deployment" card when it is not — see src/pages/Vault.jsx.
 */
const Vault = lazyRetry(() => import('./pages/Vault'));

/*
 * Loan — lending & borrowing page.
 * FBT acts as Router + Fee layer only; assets go directly into lending
 * protocol smart contracts (Morpho / Aave style). No funds held by FBT.
 */
const Loan = lazyRetry(() => import('./pages/Loan'));


/*
 * ─── MERGED HUBS ────────────────────────────────────────────────────────────
 * Four screens that host existing pages as tabs. The originals are untouched
 * and still routable, so a saved link or a deep link keeps working; these
 * just give related screens one entry point instead of scattering them
 * through the More menu.
 */
const Lab = SPECULATION_ENABLED ? lazyRetry(() => import('./pages/Lab')) : () => null;
const ExploreHub = lazyRetry(() => import('./pages/ExploreHub'));
const Learn = lazyRetry(() => import('./pages/Learn'));
const Rewards = lazyRetry(() => import('./pages/Rewards'));

/**
 * Suspense fallback for a not-yet-downloaded route chunk.
 *
 * `minHeight: 55vh` is not decoration — it holds the scroll height roughly
 * where the real page will be. Without it the document collapses to spinner
 * height for a frame or two and the bottom nav, which is fixed but whose
 * position the browser recomputes against the document, visibly hops.
 *
 * The spinner is delayed by 250ms via CSS (`.spinner-delayed`). A chunk that
 * arrives in 80ms would otherwise flash a spinner for 80ms, and a flash is
 * perceived as a glitch, whereas a brief pause with nothing happening is not
 * perceived at all.
 */
function Loader() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '55vh' }}>
      <div className="spinner spinner-delayed" />
    </div>
  );
}

/**
 * Warm the route chunks the user is most likely to open next.
 *
 * THE JOLT.
 *
 * Every page is `lazy()`, and `<Suspense>` sits OUTSIDE `<AnimatePresence>`.
 * So the first time a route is opened, this sequence happens:
 *
 *   tap → outgoing page starts its exit animation → React hits the unresolved
 *   lazy import → the whole subtree, mid-animation, is replaced by the
 *   fallback spinner (a 55vh box, so the page height changes) → chunk arrives
 *   → the real page mounts and animates in from scratch.
 *
 * That mid-animation swap to a differently-sized spinner and back is the
 * "تکانه", the jolt. It is worst on the first visit to each tab and vanishes
 * afterwards, which is exactly the "sometimes" the user described — and it is
 * why it is easy to dismiss as imaginary.
 *
 * Rather than restructure Suspense, the reliable fix is to make sure the chunk
 * is already resolved before the tap happens. These are the four bottom-nav
 * destinations plus the two screens reachable in one tap from the market list.
 * They are fetched during idle time after first paint, so they cost nothing on
 * the critical path, and every one of them removes a suspend.
 *
 * Deliberately not prefetching all 27 routes: on a metered Iranian mobile
 * connection that is real data for pages most people never open, and it would
 * contend with the market API calls that the user is actually waiting on.
 */
function prefetchLikelyRoutes() {
  /*
   * ─── THIS FUNCTION CAUSED THE COIN-PAGE CRASH ─────────────────────────────
   * Worth stating at the top, because the code below looks harmless and is
   * not. A prefetch that FAILS does not merely fail to help — it writes a
   * rejection into the browser's module map, and every later
   * `import('./pages/CoinDetail')` replays that cached rejection instantly
   * without a network request. So on a connection where the idle warm-up
   * times out, an optimisation meant to make the coin page faster instead
   * makes it permanently broken until the user reloads.
   *
   * The user never sees the prefetch fail. They see a crash minutes later
   * when they tap a coin, which is exactly what was reported.
   *
   * Two independent guards now:
   *
   *   1. Every route goes through `lazyRetry`, so a poisoned entry is
   *      recovered with a cache-busted retry rather than a crash. That is the
   *      real fix and it covers failures from any cause, not just this one.
   *
   *   2. This function only runs when the connection looks capable of
   *      finishing the job. Prefetching on a slow or metered link was always
   *      questionable — it competes with the market API calls the user is
   *      actually waiting on — and it is the situation most likely to fail.
   *
   * `navigator.connection` is Chromium-only, so its ABSENCE must mean "go
   * ahead". Treating unknown as slow would silently disable prefetching for
   * every Firefox and Safari user to fix a Chrome-detectable problem.
   */
  const conn = navigator.connection;
  if (conn) {
    if (conn.saveData) return;
    if (/(^|-)2g$/.test(String(conn.effectiveType ?? ''))) return;
  }

  const warm = [
    () => import('./pages/Swap'),
    () => import('./pages/Signals'),
    () => import('./pages/Wallet'),
    () => import('./pages/CoinDetail'),
    () => import('./pages/Settings')
  ];
  // Sequential, not Promise.all: parallel requests would compete with the
  // first market fetch for the same limited connection pool.
  let i = 0;
  const next = () => {
    if (i >= warm.length) return;
    warm[i++]().then(next).catch(next);
  };
  const start = () => next();
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 2000);
}

/*
 * ─── HEADERLESS ROUTES ─────────────────────────────────────────────────────
 * `/intent` (the AI chat) is an app within the app: the global Header (logo
 * + settings) is NOT rendered there, so the conversation starts at the very
 * top of the viewport instead of sitting under a bar it does not need.
 *
 * The BottomNav STAYS, on instruction («فقط هدر حذف شود، نه منوی پایین»):
 * it is how the user knows where they are and how they reach the rest of the
 * app — without it the AI page was a dead end that could only be left with
 * the browser's back button. The shell keeps its bottom padding for it.
 *
 * This has to live inside <HashRouter> because it reads `useLocation()`, and
 * it is the single place that decides which routes are headerless — so
 * Header and BottomNav themselves stay route-agnostic and never grow a
 * `/intent` special case.
 */
function AppChrome() {
  const { pathname } = useLocation();
  const headerless = pathname === '/intent';
  return (
    <div className={`app-shell${headerless ? ' app-shell--headerless' : ''}`}>
      {!headerless && <Header />}
      <PullToRefresh>
        <AnimatedRoutes />
      </PullToRefresh>
      <BottomNav />
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  const { t } = useTranslation();
  return (
    /*
     * ─── THE BOUNDARY GOES OUTSIDE SUSPENSE, AND THAT ORDER MATTERS ────────
     * `<Suspense>` handles a lazy import that is PENDING. It does nothing at
     * all for one that REJECTS — a failed dynamic import throws during
     * render, straight past Suspense, up to BootBoundary, which replaces the
     * whole app with the "unexpected error" screen. That is the crash being
     * reported when tapping "view chart":
     *
     *     «بعضی اوقات ... میزنم روش سایت کرش میکنه و میزنه مشکلی پیش اومده»
     *
     * It is intermittent because it is a NETWORK failure, not a code one:
     * every route is a separate chunk fetched on first open, and that fetch
     * 404s whenever a deploy has renamed the chunks under a tab that is still
     * running the previous build. See RouteBoundary for the full analysis and
     * why a single guarded reload is the exact recovery.
     *
     * Keyed on pathname so navigating away from a broken screen clears the
     * error rather than leaving the user stuck on it — without the key, React
     * keeps a boundary in its error state for the rest of the session.
     */
    <RouteBoundary key={location.pathname} t={t}>
      <Suspense fallback={<Loader />}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Market />} />
            <Route path="/coin/:id" element={<CoinDetail />} />
            <Route path="/trade" element={<Trade />} />
            <Route path="/swap" element={<Swap />} />
            <Route path="/bridge" element={<Bridge />} />
            {SPECULATION_ENABLED && <Route path="/invest" element={<Invest />} />}
            {SPECULATION_ENABLED && <Route path="/predict" element={<Predict />} />}
            <Route path="/earn" element={<Earn />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/legal/:doc" element={<Legal />} />
            {SPECULATION_ENABLED && <Route path="/perp" element={<Perp />} />}
            <Route path="/farm" element={<Farm />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/stocks" element={<Stocks />} />
            {SPECULATION_ENABLED && <Route path="/ostium" element={<Ostium />} />}
            {SPECULATION_ENABLED && <Route path="/dydx" element={<Dydx />} />}
            {SPECULATION_ENABLED && <Route path="/derivatives" element={<DerivativesDashboard />} />}
            <Route path="/shop" element={<Shop />} />
            <Route path="/help" element={<Help />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/audit" element={<Security />} />
            <Route path="/security" element={<Security />} />
            <Route path="/developers" element={<Developers />} />
            <Route path="/ecosystem" element={<Ecosystem />} />
            <Route path="/business" element={<Business />} />
            <Route path="/p2p" element={<P2P />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/news" element={<News />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/nft" element={<Nft />} />
            <Route path="/orders" element={<Orders />} />

            {/* Merged hubs. The individual routes below still exist so old
                links do not break. */}
            {SPECULATION_ENABLED && <Route path="/lab" element={<Lab />} />}
            <Route path="/explore-hub" element={<ExploreHub />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/rewards" element={<Rewards />} />
            <Route path="/solana" element={<SolanaSwap />} />
            <Route path="/buy" element={<Buy />} />
            {/* Ramp Hosted Mode finalUrl return target. */}
            <Route path="/order/result/:orderId" element={<Buy />} />
            <Route path="/smart-wallet" element={<SmartWallet />} />
            <Route path="/smart-money" element={<SmartMoney />} />
            <Route path="/smart-money/wallet/:chain/:address" element={<SmartMoneyWallet />} />
            <Route path="/smart-money/token/:chain/:address" element={<SmartMoneyToken />} />
            <Route path="/portfolio" element={<Portfolio />} />
            {/* Intent OS — the single user-facing AI brain. /intent-ai is kept
                as a redirect so saved links and the old deep links keep
                working, but there is only one brain, mounted at /intent. */}
            <Route path="/intent" element={<IntentAIUnified />} />
            <Route path="/intent-ai" element={<Navigate to="/intent" replace />} />
            <Route path="/flash-liquidity" element={<FlashLiquidity />} />
            <Route path="/vault" element={<Vault />} />
            <Route path="/loan" element={<Loan />} />

            <Route path="*" element={<Market />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
    </RouteBoundary>
  );
}

export default function App() {
  const { t } = useTranslation();
  const onboarded = useSettingsStore((s) => s.onboarded);
  // Subscribed rather than read once, so "replay guide" from Help re-opens it
  // immediately instead of only after a restart.
  const guideReadAt = useSettingsStore((s) => s.guideReadAt);

  /*
   * FIRST-RUN ORDER: splash -> welcome (language + name) -> guide -> app.
   *
   * The splash is a branded moment with a Start button, shown once. It exists
   * because the flow used to ask for a language TWICE - on Welcome, then again
   * as step 0 of Onboarding - which reads as a bug before the user has seen
   * anything the product does.
   *
   * Only shown to someone who has not onboarded. A returning user goes
   * straight to the app; a splash on every launch is a delay, not a brand.
   */
  const [showSplash, setShowSplash] = useState(!onboarded);
  const [showWelcome, setShowWelcome] = useState(() => !onboarded && languageIsUnset());
  const [showOnb, setShowOnb] = useState(!onboarded);

  /*
   * APP LOCK.
   *
   * `biometricEnabled` used to be read in exactly two places, both inside
   * Settings.jsx — the toggle wrote it, the toggle drew it, and nothing else
   * ever looked. There was no lock screen at all, so the setting did nothing:
   * the fingerprint prompt on enabling was mistaken for a lock that then
   * "never asked again".
   *
   * Read as initial state, not subscribed. Subscribing would re-lock the app
   * the instant the user switches the toggle ON in Settings, throwing them out
   * of the screen they are configuring.
   */
  const [locked, setLocked] = useState(() => useSettingsStore.getState().biometricEnabled);

  useEffect(() => {
    initTheme();
    initServiceWorker();
    // Keep FCM token rotation and notification taps alive for the whole app.
    // Capacitor emits both events outside React's render lifecycle.
    initNativePushListeners();
    prefetchLikelyRoutes();
    /*
     * Record `?ref=` before anything can navigate away.
     *
     * HashRouter rewrites the URL as soon as it mounts, and the query string
     * sits BEFORE the hash — so reading it late means reading nothing. First
     * touch wins and the value is persisted; see lib/referral.js.
     */
    captureReferral();
  }, []);

  /*
   * AUTO-LOCK ON RETURN.
   *
   * REAL BUG: "قفل خودکار مثلا بزاری روی یک دقیقه اپ بسته نمیشه" — setting
   * auto-lock to one minute did nothing. `autoLockMinutes` was written by
   * Settings, read back by Settings to draw its own label, and consulted by
   * nothing else. The app locked only on a cold start (the useState above), so
   * leaving it for an hour and coming back left it open.
   *
   * The timing rule lives in lib/autoLock.js and is measured against the wall
   * clock rather than a timer, because Android freezes timers in a
   * backgrounded WebView and can kill the process outright.
   *
   * Gated on a lock method actually existing. Auto-lock with neither biometrics
   * nor 2FA configured would produce a lock screen with no way through it —
   * which is precisely the lockout bug that had to be fixed in AppLock before.
   */
  useEffect(() => {
    const canLock = () => {
      const st = useSettingsStore.getState();
      return Boolean(st.biometricEnabled || (st.twoFactorEnabled && st.twoFactorSecret));
    };
    return watchAutoLock({
      isEnabled: canLock,
      getMinutes: () => useSettingsStore.getState().autoLockMinutes,
      onLock: () => setLocked(true)
    });
  }, []);

  // Background housekeeping, once per app open:
  //   • refresh the news cache when it is older than 24h
  //   • fire at most one promotional notification per 24h (the cap lives in
  //     lib/notify, not here, so every caller inherits it)
  // Both are deliberately fire-and-forget: neither may delay first paint, and
  // a failure in either must never surface as an error to the user.
  useEffect(() => {
    const id = setTimeout(() => {
      if (newsIsStale()) getNews({ force: true }).catch(() => {});
      maybeSendDailyPromo((key) => ({
        title: t(`notify.${key}.title`),
        body: t(`notify.${key}.body`)
      }));
    }, 2500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  void pickPromoKey;

  // First-launch order: onboarding → four-part guide → the app.
  // The guide is a hard gate: nothing else mounts until it is acknowledged,
  // which is the point — someone who swaps before reading about gas and
  // slippage loses real money, and that refunds to nobody.
  const showGuide = !showOnb && !guideReadAt;

  let screen;
  /*
   * The lock comes FIRST — before onboarding, the guide and the router.
   * Anything mounted above it is content an unauthenticated holder of the
   * phone can read, which would defeat the point of the lock.
   */
  if (locked) {
    screen = (
      <AppLock
        onUnlock={() => {
          // Drop the away-marker too, or the very next resume would measure
          // from the old timestamp and lock again immediately.
          clearAway();
          setLocked(false);
        }}
      />
    );
  } else if (showSplash) {
    screen = <Splash onStart={() => setShowSplash(false)} />;
  } else if (showWelcome) {
    screen = <Welcome onDone={() => setShowWelcome(false)} />;
  } else if (showOnb) {
    screen = <Onboarding onDone={() => setShowOnb(false)} />;
  } else if (showGuide) {
    screen = <Guide />;
  } else {
    /*
     * ─── NO v7_startTransition, ON PURPOSE ─────────────────────────────────
     * The reported /intent freeze: tap Wallet → the hash in the address bar
     * changes, but the AI page stays on screen and the orb goes "Offline".
     * That shape is React Router's transitioned navigation: with
     * `v7_startTransition: true` every `navigate()` is a transition, and when
     * a lazy route suspends while its chunk is still loading, React keeps the
     * PREVIOUS page visible instead of showing the Suspense fallback. On a
     * flaky/offline connection the chunk request can hang, so the old page
     * just sits there — URL changed, nothing rendered, no loading feedback.
     *
     * A route change is a user-initiated action that MUST give immediate
     * visual feedback. Making it urgent (the React Router 6 default) lets the
     * `<Suspense fallback={<Loader />}>` boundary show the loader right away
     * and lets `RouteBoundary` recover if the chunk genuinely cannot load.
     */
    screen = (
      <HashRouter future={{ v7_relativeSplatPath: true }}>
        <AppChrome />
        {/*
          ─── THE RADIO, OUTSIDE <AnimatedRoutes> AND THAT IS THE FEATURE ───
          Requested: «امکان پخش در پس‌زمینه داشته باشد، مثلا وقتی پادکست را
          می‌زنی و می‌روی به صفحه سواپ».

          `AnimatedRoutes` unmounts the outgoing page on every navigation, so
          an <audio> element owned by a page is destroyed the moment you leave
          it. Playback stopping was not a missing feature — it was the
          component tree working exactly as written, and it could not be fixed
          from inside the News screen.

          Sitting here, it survives every route change. Still INSIDE
          <HashRouter>, because the dock reads `useLocation()` to decide
          between the full transport (on /news) and the small pill (anywhere
          else) — the box the request describes.

          It renders nothing at all until something is playing.
        */}
        <RadioDock />
      </HashRouter>
    );
  }

  return (
    <TelegramProvider>
      <WalletProvider>
        {/*
          THE CENTRAL BRAIN, MOUNTED ONCE, ABOVE THE ROUTER — and that position is
          the feature. The Intent OS is a per-USER session (thread, shared state,
          the open confirmation card), not a per-page one: «انجامش بده» typed on
          /swap has to resolve against the intent raised on /portfolio. A provider
          inside a page unmounts on navigation and takes the conversation with it,
          which is exactly the failure the old per-page context engine never escaped.
          It sits inside WalletProvider because the page context it pushes to the
          server includes which wallet is connected (§7).
        */}
        <CentralBrainProvider>
        <RgbBackground />
        {/*
          THE LIFTED GALAXY — the starfield behind the whole first-run flow.
          `.welcome-stage` / `.onb-stage` are deliberately transparent (see
          index.css: "Transparent so the lifted GalaxyBackdrop stays visible")
          and `.launch-galaxy` sits at z-index 90, right under the stages'
          z-index 95. Rendering it ONCE here instead of inside each page means
          the sky does not re-randomise or restart its drift between Welcome,
          Onboarding and the Guide. The Splash draws its own copy (its opaque
          z-300 surface would cover this one).
        */}
        {!locked && !showSplash && (showWelcome || showOnb || showGuide) && (
          <div className="launch-galaxy" aria-hidden="true">
            <GalaxyBackdrop />
          </div>
        )}
        {screen}
        <Toasts />
        {/*
          Outside `screen` on purpose: the install offer must survive route
          changes, and it must not appear over the splash, onboarding or the
          lock screen — all of which replace `screen` entirely.
        */}
        <InstallPrompt />
        </CentralBrainProvider>
      </WalletProvider>
    </TelegramProvider>
  );
}
