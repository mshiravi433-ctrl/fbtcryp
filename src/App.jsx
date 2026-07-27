import { lazy, Suspense, useEffect, useState } from 'react';
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
const Play = lazy(() => import('./pages/Play'));
const Predict = lazy(() => import('./pages/Predict'));
const Earn = lazy(() => import('./pages/Earn'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Settings = lazy(() => import('./pages/Settings'));
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));

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
          <Route path="/play" element={<Play />} />
          <Route path="/predict" element={<Predict />} />
          <Route path="/earn" element={<Earn />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
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
