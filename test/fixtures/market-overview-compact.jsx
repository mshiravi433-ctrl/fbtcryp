import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import i18n, { setLanguage } from '../../src/i18n/index.js';
import MarketHeatmap from '../../src/components/market/MarketHeatmap.jsx';
import MarketCapitalPulse from '../../src/components/market/MarketCapitalPulse.jsx';
import MarketDefiIntel from '../../src/components/market/MarketDefiIntel.jsx';
import MarketFbtNetworks from '../../src/components/market/MarketFbtNetworks.jsx';
import { mergeNetworkTelemetry } from '../../src/lib/fbtSwapNetworks.js';
import { overviewCompactCoins, overviewCompactGlobal, overviewCompactDefi } from './market-overview-compact-data.mjs';
import '../../src/index.css';
import '../../src/styles/market-modern.css';
import '../../src/styles/market-intelligence.css';
import '../../src/styles/market-glass-v3.css';
import '../../src/styles/market-aurora-glass.css';
import '../../src/styles/market-obsidian-glass.css';
import '../../src/styles/market-overview-phase2.css';
import '../../src/styles/market-overview-compact.css';
import '../../src/styles/market-tabs.css';
import '../../src/styles/market-perf.css';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('lang') || 'fa');
document.documentElement.dir = i18n.dir();
document.documentElement.lang = i18n.language;
document.documentElement.dataset.theme = params.get('theme') || 'dark';
const networks = mergeNetworkTelemetry({
  probes: {
    'evm:1': { key:'evm:1', ok:true, latencyMs:94, latestBlock:21888111 },
    'evm:56': { key:'evm:56', ok:true, latencyMs:112, latestBlock:45100200 },
    solana: { key:'solana', ok:true, latencyMs:145, latestBlock:312999000 },
    'evm:42161': { key:'evm:42161', ok:true, latencyMs:88, latestBlock:298001122 },
    bitcoin: { key:'bitcoin', ok:true, latencyMs:210, latestBlock:894120, feeHint:'7 sat/vB' }
  },
  chainTvls: overviewCompactDefi.topChains.map((c) => ({ name:c.name, tvl:c.tvlUsd })),
  loading:false
});
function Preview() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; setTheme(next); };
  return <MemoryRouter>
    <div className="pv-bar">
      <b>FBT Market · Overview compact QA</b>
      <button type="button" onClick={toggleTheme}>Theme</button>
      <span>Deterministic fixture data — not a live feed</span>
    </div>
    <div className="page mx-market pv-wrap">
      <div className="mx-tab-panel">
        <MarketHeatmap coins={overviewCompactCoins} vs="usd" />
        <MarketCapitalPulse coins={overviewCompactCoins} global={overviewCompactGlobal} vs="usd" />
        <MarketDefiIntel defi={overviewCompactDefi} global={overviewCompactGlobal} loading={false} offline={false} />
        <MarketFbtNetworks swapNetworks={networks} />
      </div>
    </div>
  </MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Preview />);
