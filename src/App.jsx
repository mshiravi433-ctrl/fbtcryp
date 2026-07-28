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

function Loader() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '55vh' }}>
      <div className="spinner" />
    </div>
  );
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

  useEffect(() => {
    initTheme();
    initServiceWorker();
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
  if (showWelcome) {
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
