import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../../src/i18n/index.js';
import i18n from '../../src/i18n/index.js';
import fa from '../../src/i18n/locales/fa.json';
i18n.addResourceBundle('fa', 'translation', fa);
import { SignalsHeroScene, SignalsHeroWords } from '../../src/components/SignalsHeroCinema.jsx';
import OrdersHero from '../../src/components/OrdersHero.jsx';
import RampProviderList from '../../src/components/RampProviderList.jsx';
import P2P from '../../src/pages/P2P.jsx';
import '../../src/index.css';
import '../../src/styles/signals-intel.css';
import '../../src/styles/signals-hero-cinema.css';
import '../../src/styles/orders-hero.css';
import '../../src/styles/buy-sell.css';
const params = new URLSearchParams(location.search);
await i18n.changeLanguage(params.get('lang') || 'fa');
document.documentElement.dir = i18n.dir();
document.documentElement.dataset.theme = params.get('theme') || 'dark';
const mode = params.get('mode');
createRoot(document.getElementById('root')).render(<MemoryRouter><div style={{maxWidth:900, margin:'24px auto',padding:16,display:'grid',gap:24}}>
{mode === 'p2p' ? <P2P /> : <><section className="sic-page-hero has-cinema"><SignalsHeroScene /><span className="sic-hero-icon">✦</span><div className="sic-hero-copy"><h1>{i18n.t('signals.title')}</h1><p className="sic-hero-tagline">{i18n.t('signals.hero.tagline')}</p><SignalsHeroWords /></div><div className="sic-hero-status">AI · Signals</div></section><OrdersHero watching={4} ready={1} queuedUsd={1200} bars={[]} /><RampProviderList country="DE" side="BUY" asset="ETH" network="ethereum" fiatCurrency="EUR" fiatAmount={100} walletAddress="0x1111111111111111111111111111111111111111" /></>}
</div></MemoryRouter>);
