import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TelegramProvider } from './context/TelegramContext';
import { WalletProvider } from './context/WalletContext';
import RgbBackground from './components/RgbBackground';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import Toasts from './components/Toasts';
import Welcome from './pages/Welcome';
import Onboarding from './pages/Onboarding';
import Guide from './pages/Guide';
import AppLock from './components/AppLock';
import { initTheme, useSettingsStore } from './store/useSettingsStore';
import { GAMES_ENABLED } from './lib/features';
import { languageIsUnset } from './i18n';
import { initServiceWorker, maybeSendDailyPromo, pickPromoKey } from './lib/notify';
import { newsIsStale, getNews } from './lib/news';

const Market = lazy(() => import('./pages/Market'));
const CoinDetail = lazy(() => import('./pages/CoinDetail'));
const Trade = lazy(() => import('./pages/Trade'));
const Swap = lazy(() => import('./pages/Swap'));
const Invest = lazy(() => import('./pages/Invest'));
// Conditional so the chunk isn't emitted at all in a store-safe build —
// an unreachable route still leaves the code inside the APK for a reviewer
// (or anyone) to find by unzipping it.
const Play = GAMES_ENABLED ? lazy(() => import('./pages/Play')) : () => null;
const Predict = lazy(() => import('./pages/Predict'));
const Earn = lazy(() => import('./pages/Earn'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Settings = lazy(() => import('./pages/Settings'));
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));
const Legal = lazy(() => import('./pages/Legal'));
const Perp = lazy(() => import('./pages/Perp'));
const Farm = lazy(() => import('./pages/Farm'));
const Signals = lazy(() => import('./pages/Signals'));
const Stocks = lazy(() => import('./pages/Stocks'));
const Help = lazy(() => import('./pages/Help'));
const Docs = lazy(() => import('./pages/Docs'));
const Audit = lazy(() => import('./pages/Audit'));
const Developers = lazy(() => import('./pages/Developers'));
const Ecosystem = lazy(() => import('./pages/Ecosystem'));
const Business = lazy(() => import('./pages/Business'));
const P2P = lazy(() => import('./pages/P2P'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const News = lazy(() => import('./pages/News'));
const Explore = lazy(() => import('./pages/Explore'));
const Discover = lazy(() => import('./pages/Discover'));
const Nft = lazy(() => import('./pages/Nft'));
const Orders = lazy(() => import('./pages/Orders'));

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

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <Suspense fallback={<Loader />}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Market />} />
          <Route path="/coin/:id" element={<CoinDetail />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/swap" element={<Swap />} />
          <Route path="/invest" element={<Invest />} />
          {GAMES_ENABLED && <Route path="/play" element={<Play />} />}
          <Route path="/predict" element={<Predict />} />
          <Route path="/earn" element={<Earn />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/legal/:doc" element={<Legal />} />
          <Route path="/perp" element={<Perp />} />
          <Route path="/farm" element={<Farm />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/stocks" element={<Stocks />} />
          <Route path="/help" element={<Help />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/audit" element={<Audit />} />
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
          <Route path="*" element={<Market />} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}

export default function App() {
  const { t } = useTranslation();
  const onboarded = useSettingsStore((s) => s.onboarded);
  // Subscribed rather than read once, so "replay guide" from Help re-opens it
  // immediately instead of only after a restart.
  const guideReadAt = useSettingsStore((s) => s.guideReadAt);

  // Welcome (language) comes before onboarding, and only for someone who has
  // never picked a language. Returning users never see it again.
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
    prefetchLikelyRoutes();
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
    screen = <AppLock onUnlock={() => setLocked(false)} />;
  } else if (showWelcome) {
    screen = <Welcome onDone={() => setShowWelcome(false)} />;
  } else if (showOnb) {
    screen = <Onboarding onDone={() => setShowOnb(false)} />;
  } else if (showGuide) {
    screen = <Guide />;
  } else {
    screen = (
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <div className="app-shell">
          <Header />
          <AnimatedRoutes />
          <BottomNav />
        </div>
      </HashRouter>
    );
  }

  return (
    <TelegramProvider>
      <WalletProvider>
        <RgbBackground />
        {screen}
        <Toasts />
      </WalletProvider>
    </TelegramProvider>
  );
}
