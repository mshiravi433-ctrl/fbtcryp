import { HashRouter, Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TelegramProvider } from './context/TelegramContext';
import { WalletProvider } from './context/WalletContext';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import Home from './pages/Home';
import Analysis from './pages/Analysis';
import Trade from './pages/Trade';
import Portfolio from './pages/Portfolio';

function Shell() {
  const { t } = useTranslation();
  return (
    <div className="app-shell">
      <Header />
      <p className="risk-banner">{t('riskBanner')}</p>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/trade" element={<Trade />} />
        <Route path="/portfolio" element={<Portfolio />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <TelegramProvider>
      <WalletProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </WalletProvider>
    </TelegramProvider>
  );
}
