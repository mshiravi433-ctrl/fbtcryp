import { lazy, Suspense, useEffect, useState } from 'react';

const GAMES_ENABLED_STATIC = import.meta.env?.VITE_DISABLE_GAMES !== 'true';
import { AnimatePresence } from 'framer-motion';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TelegramProvider } from './context/TelegramContext';
import { WalletProvider } from './context/WalletContext';
import RgbBackground from './components/RgbBackground';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import Toasts from './components/Toasts';
import Onboarding from './pages/Onboarding';
import { initTheme, useSettingsStore } from './store/useSettingsStore';

const Market = lazy(() => import('./pages/Market'));
const CoinDetail = lazy(() => import('./pages/CoinDetail'));
const Trade = lazy(() => import('./pages/Trade'));
const Swap = lazy(() => import('./pages/Swap'));
const Invest = lazy(() => import('./pages/Invest'));
// Conditional so the chunk isn't emitted at all in a store-safe build —
// an unreachable route still leaves the code inside the APK for a reviewer
// (or anyone) to find by unzipping it.
const Play = GAMES_ENABLED_STATIC
  ? lazy(() => import('./pages/Play'))
  : () => null;
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

function Loader() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '55vh' }}>
      <div className="spinner" />
    </div>
  );
}

/**
 * Iranian app stores (Bazaar, Myket) restrict gambling-styled content, and the
 * arcade — even on valueless points — looks like gambling to a reviewer. This
 * flag builds a store-safe variant with those routes removed entirely rather
 * than merely hidden, so a reviewer can't reach them.
 */
const GAMES_ENABLED = GAMES_ENABLED_STATIC;

export { GAMES_ENABLED };

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
          <Route path="*" element={<Market />} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}

export default function App() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const [showOnb, setShowOnb] = useState(!onboarded);

  useEffect(() => {
    initTheme();
  }, []);

  return (
    <TelegramProvider>
      <WalletProvider>
        <RgbBackground />
        {showOnb ? (
          <Onboarding onDone={() => setShowOnb(false)} />
        ) : (
          <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <div className="app-shell">
              <Header />
              <AnimatedRoutes />
              <BottomNav />
            </div>
          </HashRouter>
        )}
        <Toasts />
      </WalletProvider>
    </TelegramProvider>
  );
}
